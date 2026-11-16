import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {createServer} from 'node:http';
import {promisify} from 'node:util';
import {chromium} from 'playwright';
import {runPlan,saveCase} from '../dist/core/runner.js';
import {WebPilotService,dispatch} from '../dist/core/service.js';
import {PlanSchema,TargetSchema} from '../dist/core/schema.js';
import {coverageFromPlan,coveragePlan} from '../dist/core/coverage.js';
import {CoverageStore} from '../dist/artifacts/coverage.js';
import {Store} from '../dist/artifacts/store.js';
import {resolvePlan} from '../dist/project/target.js';
import {exportPlan,verifyExport} from '../dist/artifacts/export.js';
import {fixture,plan,selector,source} from './helpers.mjs';

const execute=promisify(execFile),json=async file=>JSON.parse(await readFile(file,'utf8'));
async function cli(args){return execute(process.execPath,['dist/cli/index.js',...args,'--no-dashboard'],{env:{...process.env,WEBPILOT_DASHBOARD:'0'},timeout:30000});}
async function project(t){
  const root=await mkdtemp(join(tmpdir(),'webpilot-replay-config-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const app=join(root,'app');await mkdir(app);const lifecycle=join(root,'lifecycle.txt');
  await writeFile(join(app,'index.html'),`<h1>Test frontend</h1><output id="viewport"></output><script>document.querySelector('#viewport').textContent=innerWidth+'x'+innerHeight;</script>`);
  const command=value=>({executable:process.execPath,args:['-e',`require('node:fs').appendFileSync(${JSON.stringify(lifecycle)},${JSON.stringify(value+'\n')})`]});
  const config={staticDir:'.',viewport:{width:390,height:844},evidence:{video:false,live:false,retentionDays:2},budget:{totalMs:15000,maxSteps:10,assertionMs:1000,attempts:1},data:{prepare:command('prepare'),cleanup:command('cleanup')},roles:{reader:{required:false}}};
  const configPath=join(app,'webpilot.config.json');await writeFile(configPath,JSON.stringify(config));
  const raw={...plan('http://unused.test',[{id:'viewport',op:'expectText',locator:selector('#viewport'),expected:'390x844',source}],{case:{role:'reader'}}),target:{projectPath:app}};
  return {root,app,config,configPath,lifecycle,raw,data:join(root,'data')};
}
async function assertMobile(run,data){
  assert.equal(run.exitCode,0,JSON.stringify(run.cases));assert.deepEqual(run.environment.viewport,{width:390,height:844});
  assert.equal(run.cases[0].attempts[0].steps[0].actual,'390x844');assert.equal(run.playbackPath,undefined);
  assert.equal(run.cases.flatMap(c=>c.attempts.flatMap(a=>a.recordings??[])).length,0);
  const dir=join(data,'runs',run.id),saved=await json(join(dir,'plan.json')),snapshot=await json(join(dir,'coverage.json')),owner=await json(join(dir,'.owner.json'));
  assert.equal(saved.target.evidence.video,false);assert.equal(saved.target.evidence.live,false);assert.equal(owner.sensitiveVideo,false);assert.equal(owner.retentionDays,2);
  assert.deepEqual(saved.target,snapshot.manifest.draft.target);assert.deepEqual(saved.target.viewport,run.environment.viewport);
  assert.ok(saved.targetResolution);assert.equal(run.target.sources.viewport,'config');
  assert.equal((await readdir(dir)).includes('videos'),false);return saved;
}

test('first execution and CLI run/file replays preserve actual mobile viewport, policies and lifecycle after config deletion',async t=>{
  const p=await project(t),first=await runPlan(p.raw,{dataDir:p.data,dashboard:false});
  const saved=await assertMobile(first,p.data),original=await readFile(join(p.data,'runs',first.id,'plan.json'),'utf8');
  assert.equal(saved.target.url,undefined);
  // Occupy the old port to prove replay starts its own static service instead of
  // treating the first runtime URL as a reusable saved target.
  const oldPort=createServer((req,res)=>res.end('old port occupied'));
  await new Promise((ok,fail)=>{oldPort.once('error',fail);oldPort.listen(Number(new URL(first.target.url).port),'127.0.0.1',ok);});
  t.after(()=>new Promise(ok=>{oldPort.closeAllConnections();oldPort.close(ok);}));
  const linked=await json(join(p.data,'runs',first.id,'coverage.json'));assert.deepEqual(saved.targetResolution,linked.manifest.draft.targetResolution);
  await writeFile(p.configPath,JSON.stringify({...p.config,viewport:{width:900,height:600},evidence:{video:true}}));
  const byRun=JSON.parse((await cli(['replay','--run',first.id,'--data-dir',p.data])).stdout);await assertMobile(byRun,p.data);
  assert.notEqual(byRun.target.url,first.target.url); // New owned static service, rather than the closed first port.
  await rm(p.configPath);
  const byFile=JSON.parse((await cli(['replay','--plan',join(p.data,'runs',first.id,'plan.json'),'--data-dir',p.data])).stdout);await assertMobile(byFile,p.data);
  assert.equal(await readFile(join(p.data,'runs',first.id,'plan.json'),'utf8'),original);
  assert.equal(await readFile(p.lifecycle,'utf8'),'prepare\ncleanup\n'.repeat(3));
});

test('CLI preview resolves config without browser/data side effects and explicit config overrides form a new baseline',async t=>{
  const p=await project(t),file=join(p.root,'raw-plan.json');await writeFile(file,JSON.stringify(p.raw));
  const preview=JSON.parse((await cli(['run','--plan',file,'--preview-only','--data-dir',p.data])).stdout);
  assert.equal(preview.manifest.draft.target.viewport.width,390);assert.equal(preview.manifest.draft.target.evidence.video,false);assert.ok(preview.manifest.draft.targetResolution);
  await assert.rejects(()=>readFile(p.lifecycle),e=>e.code==='ENOENT');await assert.rejects(()=>readdir(join(p.data,'runs')),e=>e.code==='ENOENT');
  const first=await runPlan(p.raw,{dataDir:p.data,dashboard:false});
  const other=join(p.root,'new.json');await writeFile(other,JSON.stringify({budget:{totalMs:12000,maxSteps:10,assertionMs:1000,attempts:1}}));
  const overridden=JSON.parse((await cli(['replay','--run',first.id,'--config',other,'--data-dir',p.data])).stdout);
  await assertMobile(overridden,p.data);const saved=await json(join(p.data,'runs',overridden.id,'plan.json'));
  assert.equal(saved.target.budget.totalMs,12000);assert.equal(saved.targetResolution.sources.budget,'config');
});

test('adopted coverage is authoritative and conflicting suite/session targets reject before any environment side effects',async t=>{
  const p=await project(t),service=new WebPilotService(p.data);t.after(()=>service.closeAll());
  const resolved=await resolvePlan(p.raw),draft=coverageFromPlan(resolved),created=await service.coverageStore.create(draft),ref={id:created.manifest.id,revision:1};
  await service.coverageStore.adopt(ref,'published');const revision=await readFile(join(service.coverageStore.dir(ref.id),'revisions','1.json'),'utf8');
  await writeFile(p.configPath,'{');let launches=0;const launch=chromium.launch.bind(chromium);
  t.mock.method(chromium,'launch',(...args)=>{launches++;return launch(...args);});
  const conflict={...resolved,target:{...resolved.target,viewport:{width:1280,height:720}}};
  await assert.rejects(()=>runPlan(conflict,{dataDir:p.data,coverage:ref,dashboard:false}),e=>e.code==='COVERAGE_MISMATCH');
  await assert.rejects(()=>service.open(conflict.target,{coverage:ref,dashboard:false}),e=>e.code==='COVERAGE_MISMATCH');
  assert.equal(launches,0);await assert.rejects(()=>readFile(p.lifecycle),e=>e.code==='ENOENT');await assert.rejects(()=>readdir(join(p.data,'runs')),e=>e.code==='ENOENT');
  const opened=await service.open({projectPath:p.app},{coverage:ref,dashboard:false});assert.deepEqual(opened.viewport,{width:390,height:844});
  assert.equal(service.planned.sessions.get(opened.sessionId).service.target.budget.totalMs,15000);
  await service.planned.begin(opened.sessionId,'feature',ref);
  const step=await service.step(opened.sessionId,resolved.cases[0].steps[0],true,undefined,{caseId:'feature',revision:1,attempt:1});assert.equal(step.actual,'390x844');
  await service.planned.end(opened.sessionId);const closed=await service.close(opened.sessionId);await assertMobile(closed.report,p.data);
  assert.equal(await readFile(p.lifecycle,'utf8'),'prepare\ncleanup\n');assert.equal(await readFile(join(service.coverageStore.dir(ref.id),'revisions','1.json'),'utf8'),revision);
});

test('legacy run replay freezes saved target with honest provenance and URL-only overrides preserve policies',async t=>{
  const f=await fixture();t.after(()=>f.close());const p=await project(t);
  const legacy=PlanSchema.parse(plan(f.url,[{id:'heading',op:'expectText',locator:selector('h1'),expected:'Test frontend',source}],{target:{projectPath:p.app,evidence:{video:false,live:false}}}));
  const store=new Store(p.data);await store.beginRun('run-legacy');await writeFile(join(store.runDir('run-legacy'),'plan.json'),JSON.stringify(legacy));
  const bytes=await readFile(join(store.runDir('run-legacy'),'plan.json'),'utf8');await writeFile(p.configPath,'{');
  const result=await cli(['replay','--run','run-legacy','--url',f.url+'/?replay=true','--data-dir',p.data]);const replay=JSON.parse(result.stdout);
  assert.equal(replay.exitCode,0);assert.equal(replay.environment.viewport.width,1280);assert.equal(replay.playbackPath,undefined);assert.ok(result.stderr.includes('旧运行'));assert.ok(replay.gaps.some(g=>g.includes('旧运行')));
  assert.equal(replay.target.url,f.url+'/?replay=true');assert.equal(replay.target.sources.url,'explicit');assert.equal(await readFile(join(store.runDir('run-legacy'),'plan.json'),'utf8'),bytes);
  const drafts=new CoverageStore(p.data),legacyDraft=coverageFromPlan(legacy);const created=await drafts.create({...legacyDraft,targetResolution:{schemaVersion:1,sources:{}}});
  const revision=join(drafts.dir(created.manifest.id),'revisions','1.json'),old=await json(revision);delete old.draft.targetResolution;await writeFile(revision,JSON.stringify(old));
  const ref={id:created.manifest.id,revision:1};await drafts.adopt(ref,'legacy adoption');
  const run=await runPlan(coveragePlan(await drafts.snapshot(ref)),{dataDir:p.data,coverage:ref,dashboard:false});assert.equal(run.environment.viewport.width,1280);assert.equal(run.exitCode,0);
});

test('configuration and input persistence failures prevent environment effects; promotion and exploration keep configured settings',async t=>{
  const p=await project(t);let launches=0;const launch=chromium.launch.bind(chromium);t.mock.method(chromium,'launch',(...args)=>{launches++;return launch(...args);});
  const plannedService=new WebPilotService(p.data);t.after(()=>plannedService.closeAll());
  const draft=coverageFromPlan(await resolvePlan(p.raw)),created=await plannedService.coverageStore.create(draft),coverage={id:created.manifest.id,revision:1};await plannedService.coverageStore.adopt(coverage,'published');
  const save=CoverageStore.prototype.saveSnapshot;
  const mock=t.mock.method(CoverageStore.prototype,'saveSnapshot',async()=>{throw new Error('injected snapshot failure');});
  await assert.rejects(()=>runPlan(p.raw,{dataDir:p.data,dashboard:false}),/injected snapshot/);
  await assert.rejects(()=>plannedService.open(draft.target,{coverage,dashboard:false}),/injected snapshot/);mock.mock.restore();
  assert.equal(launches,0);await assert.rejects(()=>readFile(p.lifecycle),e=>e.code==='ENOENT');assert.equal(CoverageStore.prototype.saveSnapshot,save);
  await writeFile(p.configPath,'{');await assert.rejects(()=>runPlan(p.raw,{dataDir:p.data,dashboard:false}),e=>e.code==='CONFIG_INVALID');assert.equal(launches,0);
  await writeFile(p.configPath,JSON.stringify(p.config));
  const promoted=await saveCase(p.raw.cases[0],p.raw.target,{dataDir:p.data,promote:true,dashboard:false});assert.equal(promoted.case.state,'regression-ready');
  await assertMobile(await new Store(p.data).readRun(promoted.verifiedBy),p.data);
  const service=new WebPilotService(p.data);t.after(()=>service.closeAll());const opened=await service.open(p.raw.target,{exploratory:true,dashboard:false});
  const live=service.sessions.get(opened.sessionId);assert.equal(live.session.page.viewportSize().width,390);assert.equal(live.session.target.evidence.video,false);
  const closed=await service.close(opened.sessionId);assert.equal(closed.playbackPath,undefined);assert.deepEqual(closed.recordings,[]);
  const missing={...p.raw.cases[0],id:'missing-state',role:'admin'};
  const blocked=await saveCase(missing,{...p.raw.target,roles:{admin:{storageStateRef:'state',verify:[{id:'auth',op:'expectVisible',locator:selector('h1'),source}]}}},{dataDir:p.data,promote:true,dashboard:false});assert.equal(blocked.case.state,'draft');
});

test('independent export executes the fixed mobile policy and retains external lifecycle/reference requirements',async t=>{
  const p=await project(t),resolved=await resolvePlan(p.raw),destination=join(p.root,'export');
  const secret='disposable-sensitive-export-value';
  const exported=await exportPlan(resolved,destination,{credential:secret});assert.equal(exported.manifest.requiresPrepare,true);assert.equal(exported.manifest.requiresCleanup,true);
  for(const name of ['@playwright/test','playwright','playwright-core','zod'])await cp(resolve('node_modules',name),join(destination,'node_modules',name),{recursive:true});
  const saved=await json(join(destination,'plan.json'));assert.equal(saved.target.viewport.width,390);assert.equal(saved.target.evidence.video,false);assert.equal(saved.target.evidence.rawTrace,false);assert.equal(saved.target.evidence.live,false);assert.equal(saved.target.projectPath,undefined);assert.equal(saved.target.data,undefined);assert.ok(saved.targetResolution);
  assert.ok(!JSON.stringify(saved).includes(secret));assert.ok(!JSON.stringify(exported.manifest).includes(secret));
  // Supply a ready equivalent target; the standalone package must not start the original local directory.
  const {inspectProject,prepareService}=await import('../dist/project/index.js');const server=await prepareService(await inspectProject({staticDir:p.app}));t.after(()=>server.close());
  const external=join(p.root,'external.json');await writeFile(external,JSON.stringify({data:resolved.target.data}));
  assert.notEqual((await verifyExport(destination,{url:server.target.url})).exitCode,0);
  assert.equal((await verifyExport(destination,{url:server.target.url,targetConfig:external})).exitCode,0);
  async function reports(dir){let result=[];for(const e of await readdir(dir,{withFileTypes:true})){if(e.name==='node_modules')continue;const file=join(dir,e.name);if(e.isDirectory())result.push(...await reports(file));else if(e.name==='report.json')result.push(await json(file));}return result;}
  const runs=await reports(join(destination,'test-results'));assert.equal(runs.length,1);const run=runs[0];assert.equal(run.environment.viewport.width,390);assert.equal(run.cases[0].attempts[0].steps[0].actual,'390x844');assert.equal(run.playbackPath,undefined);assert.equal(run.target.sources.url,'explicit');assert.equal(run.target.sources.data,'explicit');
  await writeFile(external,JSON.stringify({data:resolved.target.data,roles:{reader:{storageStateRef:'readerState',verify:[{id:'identity',op:'expectVisible',locator:selector('h1'),source}]}}}));
  assert.notEqual((await verifyExport(destination,{url:server.target.url,targetConfig:external})).exitCode,0);
  const missingState=(await reports(join(destination,'test-results')))[0];assert.equal(missingState.outcome,'blocked');assert.ok(missingState.cases[0].attempts[0].reason.includes('readerState'));
  const rawExport=await exportPlan(p.raw,join(p.root,'raw-export'));assert.equal((await json(join(rawExport.directory,'plan.json'))).target.viewport.width,390);
});
