import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,cp,rm,symlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {validVersion,checkSourceVersions,syncVersions,generateVersion,checkBuiltVersion,checkPackagedVersion} from '../scripts/release-version.mjs';
import {stageMarketplace,publishMarketplace,packagePlugin} from '../scripts/package-plugin.mjs';

const execute=promisify(execFile),json=async file=>JSON.parse(await readFile(file,'utf8'));
const writeJson=(file,value)=>writeFile(file,JSON.stringify(value,null,2)+'\n');
async function temp(t){const root=await mkdtemp(join(tmpdir(),'webpilot-release-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
async function fixture(t,version='0.3.0-beta.1+build.5'){
  const root=await temp(t);
  await writeJson(join(root,'package.json'),{name:'webpilot',type:'module',version,description:'preserve this',scripts:{'check:version':'node scripts/release-version.mjs check','version:sync':'node scripts/release-version.mjs sync'}});
  await writeJson(join(root,'package-lock.json'),{name:'webpilot',version,lockfileVersion:3,packages:{'':{name:'webpilot',version,dependencies:{other:'99.9.9'}},'node_modules/other':{version:'99.9.9',integrity:'unchanged'}}});
  for(const file of ['plugin.json','plugin-compat.json'])await writeJson(join(root,file),{name:'webpilot',version,description:'preserve manifest fields'});
  await mkdir(join(root,'dist','core'),{recursive:true});await cp(resolve('dist/core/version.js'),join(root,'dist/core/version.js'));
  await writeFile(join(root,'dist/core/schema.js'),"export {VERSION} from './version.js';\n");
  for(const dir of ['dist/mcp','dist/cli','dist/dashboard/public','node_modules','docs','skills','scripts'])await mkdir(join(root,dir),{recursive:true});
  for(const file of ['dist/mcp/index.js','dist/cli/index.js','dist/dashboard/public/index.html','README.md'])await writeFile(join(root,file),'fixture');
  for(const file of ['release-version.mjs','package-plugin.mjs'])await cp(resolve('scripts',file),join(root,'scripts',file));
  await writeJson(join(root,'mcp.json'),{$schema:'fixture',mcpServers:{webpilot:{type:'stdio',command:'node',args:['./dist/mcp/index.js']}}});
  await generateVersion(root);return root;
}
async function bytes(root){const result={};for(const name of ['package.json','package-lock.json','plugin.json','plugin-compat.json'])result[name]=await readFile(join(root,name),'utf8');return result;}
async function moduleVersion(root,env={}){return execute(process.execPath,['--input-type=module','-e','process.stdout.write((await import(process.argv[1])).VERSION)',pathToFileURL(join(root,'dist/core/version.js')).href],{cwd:tmpdir(),env:{...process.env,...env}});}

test('release SemVer checks accept complete prerelease/build strings and reject malformed values',()=>{
  for(const value of ['0.2.0','12.34.56','0.3.0-beta.1+build.5','1.0.0-0','1.0.0-x-y.0.z.92+001'])assert.equal(validVersion(value),true,value);
  for(const value of [undefined,null,1,'','v0.2.0','01.2.3','1.2','1.2.3-01','1.2.3-','1.2.3+','1.2.3\n',' 1.2.3','1.2.3.4'])assert.equal(validVersion(value),false,String(value));
});

test('source checks report every own-version mismatch without rewriting source or dependency versions',async t=>{
  const root=await fixture(t);assert.equal(await checkSourceVersions(root),'0.3.0-beta.1+build.5');
  const lock=await json(join(root,'package-lock.json'));lock.version='0.1.0';lock.packages[''].version='0.1.0';await writeJson(join(root,'package-lock.json'),lock);
  for(const file of ['plugin.json','plugin-compat.json'])await writeJson(join(root,file),{version:'0.1.0'});
  const before=await bytes(root);
  await assert.rejects(()=>checkSourceVersions(root),error=>['package-lock.json.version','packages[""].version','plugin.json.version','plugin-compat.json.version','expected 0.3.0-beta.1+build.5','got "0.1.0"'].every(text=>error.message.includes(text)));
  await assert.rejects(()=>execute(process.execPath,[join(root,'scripts/release-version.mjs'),'check']),error=>error.code===1&&error.stderr.includes('plugin.json.version'));
  assert.deepEqual(await bytes(root),before);
  const pkg=await json(join(root,'package.json'));pkg.version='1.2.3-01';await writeJson(join(root,'package.json'),pkg);
  await assert.rejects(()=>checkSourceVersions(root),/package.json.version/);
});

test('explicit sync updates only mirror fields and rejects missing structures before writing',async t=>{
  const root=await fixture(t),before=await bytes(root),pkg=await json(join(root,'package.json'));pkg.version='2.4.6-rc.2+ci.9';await writeJson(join(root,'package.json'),pkg);
  const result=await execute(process.execPath,[join(root,'scripts/release-version.mjs'),'sync']);assert.equal(JSON.parse(result.stdout).version,pkg.version);
  assert.equal(await checkSourceVersions(root),pkg.version);
  const expected=JSON.parse(before['package-lock.json']);expected.version=pkg.version;expected.packages[''].version=pkg.version;
  assert.deepEqual(await json(join(root,'package-lock.json')),expected);
  for(const file of ['plugin.json','plugin-compat.json'])assert.deepEqual(await json(join(root,file)),{...JSON.parse(before[file]),version:pkg.version});
  assert.deepEqual(await json(join(root,'package.json')),pkg);
  await writeJson(join(root,'package-lock.json'),{version:pkg.version});const invalid=await bytes(root);
  await assert.rejects(()=>syncVersions(root),/packages\[""\].version/);assert.deepEqual(await bytes(root),invalid);
  await rm(join(root,'plugin.json'));await assert.rejects(()=>checkSourceVersions(root),/plugin.json/);
});

test('build snapshot and compiled exports must match release source, including direct stale-build checks',async t=>{
  const root=await fixture(t),version=await checkBuiltVersion(root);assert.equal((await moduleVersion(root)).stdout,version);
  const pkg=await json(join(root,'package.json'));pkg.version='9.8.7';await writeJson(join(root,'package.json'),pkg);await syncVersions(root);
  assert.equal((await moduleVersion(root,{WEBPILOT_VERSION:'99.99.99'})).stdout,version);
  await assert.rejects(()=>checkBuiltVersion(root),/expected 9.8.7/);
  await generateVersion(root);assert.equal(await checkBuiltVersion(root),'9.8.7');
  await writeFile(join(root,'dist/core/schema.js'),"export const VERSION='0.1.0';\n");await assert.rejects(()=>checkBuiltVersion(root),/Compiled VERSION/);
});

test('a loaded version stays fixed and invalid/missing metadata never falls back to an outer package',async t=>{
  const root=await fixture(t),version=await checkSourceVersions(root),module=pathToFileURL(join(root,'dist/core/version.js')).href;
  const result=await execute(process.execPath,['--input-type=module','-e',`import {writeFileSync} from 'node:fs';const m=await import(process.argv[1]);writeFileSync(new URL('./release.json',process.argv[1]),JSON.stringify({schemaVersion:1,version:'7.8.9'}));process.stdout.write(m.VERSION);try{m.assertVersionSnapshot();process.exitCode=2;}catch{}`,module]);
  assert.equal(result.stdout,version);assert.equal((await moduleVersion(root)).stdout,'7.8.9');
  for(const metadata of ['{',JSON.stringify({schemaVersion:2,version}),JSON.stringify({schemaVersion:1,version:'1.2.3\n'}),JSON.stringify({schemaVersion:1,version:42})]){
    await writeFile(join(root,'dist/core/release.json'),metadata);
    await assert.rejects(()=>moduleVersion(root),error=>error.stderr.includes('Run npm run build or reinstall')&&!error.stdout);
  }
  await rm(join(root,'dist/core/release.json'));await assert.rejects(()=>moduleVersion(root),error=>error.stderr.includes('metadata is missing or invalid'));
});

test('direct packaging rejects stale builds before touching an existing marketplace',async t=>{
  const root=await fixture(t),destination=join(root,'output');await mkdir(destination);await writeFile(join(destination,'keep'),'existing valid package');
  await writeJson(join(root,'dist/core/release.json'),{schemaVersion:1,version:'0.1.0'});const before=await bytes(root);
  await assert.rejects(()=>execute(process.execPath,[join(root,'scripts/package-plugin.mjs'),destination]),error=>error.code===1&&error.stderr.includes('expected 0.3.0-beta.1+build.5'));
  assert.equal(await readFile(join(destination,'keep'),'utf8'),'existing valid package');assert.deepEqual(await bytes(root),before);
  assert.deepEqual(await readdir(destination),['keep']);
});

test('candidate validation rejects mixed versions before replacement and valid packages retain the existing interface',async t=>{
  const root=await fixture(t),destination=join(root,'output');await mkdir(destination);await writeFile(join(destination,'keep'),'valid previous');
  await mkdir(join(destination,'.agents/plugins'),{recursive:true});await mkdir(join(destination,'plugins/webpilot'),{recursive:true});
  await writeJson(join(destination,'.agents/plugins/marketplace.json'),{name:'webpilot-local',plugins:[{name:'webpilot',source:{source:'local',path:'./plugins/webpilot'}}]});
  await writeJson(join(destination,'plugins/webpilot/plugin.json'),{name:'webpilot',version:'0.1.0'});
  const candidate=await stageMarketplace({root,destination});const plugin=join(candidate.stage,'plugins/webpilot');
  await writeJson(join(plugin,'.codex-plugin/plugin.json'),{name:'webpilot',version:'0.1.0'});
  await assert.rejects(()=>publishMarketplace(candidate),/\.codex-plugin\/plugin.json.version/);assert.equal(await readFile(join(destination,'keep'),'utf8'),'valid previous');
  await rm(candidate.stage,{recursive:true,force:true});
  const result=await packagePlugin({root,destination});assert.deepEqual(result,{marketplace:destination,plugin:join(destination,'plugins/webpilot')});
  assert.equal(await checkPackagedVersion(result.plugin),'0.3.0-beta.1+build.5');
  const manifest=await json(join(destination,'.agents/plugins/marketplace.json'));assert.equal(manifest.plugins[0].source.path,'./plugins/webpilot');
  const mcp=await json(join(result.plugin,'.mcp.json'));assert.equal(mcp.$schema,undefined);assert.equal(mcp.mcpServers.webpilot.type,undefined);
  assert.ok(!(await readdir(root)).some(name=>name.includes('-stage-')||name.includes('-previous-')));
  const unrelated=join(root,'unrelated');await mkdir(unrelated);await writeFile(join(unrelated,'keep'),'user files');
  await assert.rejects(()=>packagePlugin({root,destination:unrelated}),/not a WebPilot Local marketplace/);
  assert.deepEqual(await readdir(unrelated),['keep']);assert.equal(await readFile(join(unrelated,'keep'),'utf8'),'user files');
});

test('packaging refuses to replace source directories or recurse into copied trees',async t=>{
  const root=await fixture(t),before=await bytes(root);
  for(const destination of [root,join(root,'dist','marketplace'),join(root,'node_modules','marketplace'),join(root,'docs')])await assert.rejects(()=>packagePlugin({root,destination}),/destination must not replace/);
  const parent=await temp(t),alias=join(parent,'alias');await symlink(root,alias,process.platform==='win32'?'junction':'dir');
  await assert.rejects(()=>packagePlugin({root,destination:alias}),/must be a real directory/);
  await assert.rejects(()=>packagePlugin({root,destination:join(alias,'dist','marketplace')}),/destination must not replace/);
  assert.deepEqual(await bytes(root),before);
});

test('typechecking a clean source copy does not require generated release metadata',async t=>{
  const root=await temp(t);await cp(resolve('src'),join(root,'src'),{recursive:true});await cp(resolve('tsconfig.json'),join(root,'tsconfig.json'));
  await writeJson(join(root,'package.json'),{type:'module'});
  await symlink(resolve('node_modules'),join(root,'node_modules'),process.platform==='win32'?'junction':'dir');
  await execute(process.execPath,[resolve('node_modules/typescript/bin/tsc'),'-p',join(root,'tsconfig.json'),'--noEmit'],{cwd:root});
  await assert.rejects(()=>readFile(join(root,'dist/core/release.json')),error=>error.code==='ENOENT');
  await assert.rejects(()=>readFile(join(root,'src/core/release.json')),error=>error.code==='ENOENT');
});
