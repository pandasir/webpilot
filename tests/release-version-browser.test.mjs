import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,cp,readdir,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {packagePlugin} from '../scripts/package-plugin.mjs';
import {checkPackagedVersion} from '../scripts/release-version.mjs';
import {runPlan} from '../dist/core/runner.js';
import {WebPilotService,dispatch} from '../dist/core/service.js';
import {Store,markdownReport} from '../dist/artifacts/store.js';
import {PlanSchema} from '../dist/core/schema.js';
import {PROTOCOL} from '../dist/dashboard/protocol.js';
import {coverageFromPlan} from '../dist/core/coverage.js';
import {exportPlan,verifyExport} from '../dist/artifacts/export.js';
import {fixture,plan,selector,source} from './helpers.mjs';

const execute=promisify(execFile),json=async file=>JSON.parse(await readFile(file,'utf8'));
const expected=(await json(resolve('package.json'))).version;
async function temp(t){const root=await mkdtemp(join(tmpdir(),'webpilot-release-integration-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
const input=url=>plan(url,[{id:'heading',op:'expectText',locator:selector('h1'),expected:'Test frontend',source}],{target:{evidence:{video:false,live:false}},case:{version:7}});
async function reports(dir){const result=[];for(const entry of await readdir(dir,{withFileTypes:true})){if(entry.name==='node_modules')continue;const file=join(dir,entry.name);if(entry.isDirectory())result.push(...await reports(file));else if(entry.name==='report.json')result.push(await json(file));}return result;}

test('a real candidate package reports the release through its own MCP handshake, tools and CLI', {timeout:60000},async t=>{
  const root=await temp(t),packaged=await packagePlugin({destination:join(root,'marketplace')});
  assert.equal(await checkPackagedVersion(packaged.plugin),expected);
  for(const file of ['package.json','plugin.json','.codex-plugin/plugin.json'])assert.equal((await json(join(packaged.plugin,file))).version,expected);
  const lock=await json(join(packaged.plugin,'package-lock.json'));assert.equal(lock.version,expected);assert.equal(lock.packages[''].version,expected);
  async function checkRuntime(version){const client=new Client({name:'release-integration-test',version:'1'});
  try{
    await client.connect(new StdioClientTransport({command:process.execPath,args:[join(packaged.plugin,'dist/mcp/index.js')],cwd:packaged.plugin,env:{...process.env,WEBPILOT_DASHBOARD:'0',WEBPILOT_DATA_DIR:join(root,'mcp-data')},stderr:'pipe'}));
    assert.equal(client.getServerVersion().version,version);
    const info=(await client.callTool({name:'runtime_info',arguments:{}})).structuredContent;assert.equal(info.data.version,version);assert.equal(info.apiVersion,1);assert.equal(info.data.apiVersion,1);
    const doctor=(await client.callTool({name:'runtime_doctor',arguments:{}})).structuredContent;assert.equal(doctor.data.version,version);
    const cli=await execute(process.execPath,[join(packaged.plugin,'dist/cli/index.js'),'doctor','--data-dir',join(root,'cli-data')],{cwd:root,env:{...process.env,WEBPILOT_DASHBOARD:'0'}});
    assert.equal(JSON.parse(cli.stdout).version,version);
  }finally{await client.close();}}
  await checkRuntime(expected);
  // Change only this temporary candidate's release metadata to exercise actual
  // MCP/doctor code with a different version, rather than asserting constants.
  const prerelease=expected==='0.3.0-beta.1+build.5'?'0.4.0-beta.1+build.5':'0.3.0-beta.1+build.5';
  for(const file of ['package.json','plugin.json','.codex-plugin/plugin.json']){const data=await json(join(packaged.plugin,file));data.version=prerelease;await writeFile(join(packaged.plugin,file),JSON.stringify(data));}
  lock.version=prerelease;lock.packages[''].version=prerelease;await writeFile(join(packaged.plugin,'package-lock.json'),JSON.stringify(lock));
  await writeFile(join(packaged.plugin,'dist/core/release.json'),JSON.stringify({schemaVersion:1,version:prerelease}));
  assert.equal(await checkPackagedVersion(packaged.plugin),prerelease);await checkRuntime(prerelease);
});

test('suite, planned sessions and replay report the actual release while old reports and compatibility versions stay unchanged',async t=>{
  const f=await fixture();t.after(()=>f.close());const p=input(f.url),store=new Store(f.dataDir),service=new WebPilotService(f.dataDir);t.after(()=>service.closeAll());
  const suite=await runPlan(p,{dataDir:f.dataDir,dashboard:false});assert.equal(suite.exitCode,0);assert.equal(suite.environment.runner,expected);
  assert.ok((await readFile(join(store.runDir(suite.id),'report.md'),'utf8')).includes(`运行器版本：${expected}`));
  const created=await service.coverageStore.create(coverageFromPlan(PlanSchema.parse(p))),ref={id:created.manifest.id,revision:1};await service.coverageStore.adopt(ref,'published');
  const opened=await service.open(created.manifest.draft.target,{coverage:ref,dashboard:false});
  await service.planned.begin(opened.sessionId,'feature',ref);
  await service.step(opened.sessionId,created.manifest.draft.items[0].executable.steps[0],true,undefined,{caseId:'feature',revision:1,attempt:1});
  await service.planned.end(opened.sessionId);const closed=await service.close(opened.sessionId);assert.equal(closed.report.exitCode,0);assert.equal(closed.report.environment.runner,expected);
  assert.ok((await readFile(join(store.runDir(opened.runId),'report.md'),'utf8')).includes(`运行器版本：${expected}`));
  const legacy={...suite,id:'run-old-release',environment:{...suite.environment,runner:'0.1.0'}};
  await store.beginRun(legacy.id);await store.saveRun(legacy,markdownReport(legacy));
  const oldReport=await readFile(join(store.runDir(legacy.id),'report.json'),'utf8');
  const oldExport=join(f.dataDir,'old-export');await mkdir(oldExport);await writeFile(join(oldExport,'manifest.json'),JSON.stringify({schemaVersion:1,generator:'0.1.0',verified:true}));
  const oldManifest=await readFile(join(oldExport,'manifest.json'),'utf8');
  assert.equal((await dispatch(service,'report_read',{runId:legacy.id})).environment.runner,'0.1.0');
  const saved=await json(join(store.runDir(suite.id),'plan.json')),replay=await runPlan(saved,{dataDir:f.dataDir,dashboard:false});assert.equal(replay.environment.runner,expected);
  assert.equal(await readFile(join(store.runDir(legacy.id),'report.json'),'utf8'),oldReport);assert.equal(await readFile(join(oldExport,'manifest.json'),'utf8'),oldManifest);
  assert.equal(replay.schemaVersion,1);assert.equal(saved.schemaVersion,1);assert.equal(replay.cases[0].version,7);assert.equal(ref.revision,1);assert.equal(PROTOCOL,1);
});

test('standalone exports retain the executor release with a different outer package and without access to the repository',async t=>{
  const f=await fixture();t.after(()=>f.close());const root=await temp(t),destination=join(root,'independent');
  const exported=await exportPlan(input(f.url),destination);assert.equal(exported.manifest.generator,expected);
  for(const name of ['@playwright/test','playwright','playwright-core','zod'])await cp(resolve('node_modules',name),join(destination,'node_modules',name),{recursive:true});
  const pkg=await json(join(destination,'package.json'));assert.equal(pkg.version,'1.0.0');pkg.version='9.8.7';await writeFile(join(destination,'package.json'),JSON.stringify(pkg));
  // The version module must load when filesystem permission only includes this
  // independent package. Explicitly prove that reading the source is denied.
  const canonical=await realpath(destination),versionUrl=pathToFileURL(join(canonical,'runtime/core/version.js')).href;
  const permissionFlag=process.allowedNodeEnvironmentFlags.has('--permission')?'--permission':'--experimental-permission';
  const isolated=await execute(process.execPath,[permissionFlag,`--allow-fs-read=${canonical}`,'--input-type=module','-e',
    `import {readFileSync} from 'node:fs';let denied=false;try{readFileSync(process.argv[2]);}catch(e){denied=e.code==='ERR_ACCESS_DENIED';}if(!denied)throw new Error('Source repository must be inaccessible');process.stdout.write((await import(process.argv[1])).VERSION);`,versionUrl,resolve('package.json')],{cwd:canonical,env:{...process.env,WEBPILOT_VERSION:'99.99.99'}});
  assert.equal(isolated.stdout,expected);
  const verified=await verifyExport(destination,{url:f.url});assert.equal(verified.exitCode,0);assert.equal(verified.manifest.generator,expected);
  const runs=await reports(join(destination,'test-results'));assert.equal(runs.length,1);assert.equal(runs[0].environment.runner,expected);assert.equal(runs[0].cases[0].version,7);
  const metadata=join(destination,'runtime/core/release.json');await rm(metadata);
  const missing=await verifyExport(destination,{url:f.url});assert.notEqual(missing.exitCode,0);assert.equal(missing.manifest.verified,false);assert.equal(missing.manifest.generator,expected);
});
