import {mkdtemp,readFile,writeFile,readdir,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
import {runPlan,saveCase} from '../dist/core/runner.js';
import {inspectProject,prepareService} from '../dist/project/index.js';
import {exportPlan,verifyExport} from '../dist/artifacts/export.js';
import {fixture,plan,loginSteps,selector,label,source,role} from '../tests/helpers.mjs';
const root=resolve('tests/fixtures'),dataDir=await mkdtemp(join(tmpdir(),'webpilot-matrix-'));
async function port(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function hashes(dir,prefix=''){const result={};for(const entry of await readdir(dir,{withFileTypes:true})){if(['node_modules','.next','test-results','.vite','.cache'].includes(entry.name))continue;const name=prefix+entry.name,path=join(dir,entry.name);if(entry.isDirectory())Object.assign(result,await hashes(path,name+'/'));else result[name]=createHash('sha256').update(await readFile(path)).digest('hex');}return result;}
async function exportedDependencies(dir){for(const name of ['@playwright/test','playwright','playwright-core','zod'])await cp(resolve('node_modules',name),join(dir,'node_modules',name),{recursive:true});}
const before=await hashes(root),records=[];
const login=loginSteps();login.at(-1).locator.scope=['form'];
const steps=[...login,{id:'search',op:'fill',locator:label('Search'),value:'app'},{id:'filtered',op:'expectCount',locator:selector('li:visible'),expected:1,source},{id:'apple',op:'expectText',locator:selector('li:visible'),expected:'Apple',source}];
const targets=[
 ['React/Vite','apps/react','vite'],['Vue/Vite','apps/vue','vite'],['Next.js','apps/next','next'],['Static HTML','static','static'],['Monorepo','apps/react','vite']
];
try{
 for(const [name,app,engine] of targets){
  const started=Date.now();let service;
  try{
   const p=await port(),url=`http://127.0.0.1:${p}`;
   const target=engine==='static'?{projectPath:root,staticDir:'static'}:{projectPath:name==='Monorepo'?root:join(root,app),...(name==='Monorepo'?{application:app}:{}),url,command:{executable:process.execPath,args:[join(root,'node_modules',engine==='vite'?'vite/bin/vite.js':'next/dist/bin/next'),...(engine==='next'?['dev','--webpack']:[]),'--port',String(p),...(engine==='vite'?['--host','127.0.0.1']:['--hostname','127.0.0.1'])],cwd:join(root,app)},ready:{timeoutMs:90000}};
   const inspection=await inspectProject(target);assert.equal(inspection.ready,true);service=await prepareService(inspection);
   const acceptance=plan(service.target.url,steps,{target:{projectPath:join(root,app)},budget:{assertionMs:15000}});acceptance.id='matrix-'+engine;
   const run=await runPlan(acceptance,{dataDir});assert.equal(run.exitCode,0,JSON.stringify(run.cases.map(c=>({outcome:c.outcome,reason:c.attempts.at(-1).reason}))));
   const c={...acceptance.cases[0],id:'matrix-'+records.length};
   const saved=await saveCase(c,acceptance.target,{dataDir,promote:true});assert.equal(saved.case.state,'regression-ready');
   const replay=await runPlan({...acceptance,cases:[saved.case]},{dataDir});assert.equal(replay.exitCode,0);
   const exported=await exportPlan({...acceptance,cases:[saved.case]},join(dataDir,'export-'+records.length));await exportedDependencies(exported.directory);
   assert.equal((await verifyExport(exported.directory,{url:service.target.url})).exitCode,0);
   records.push({name,status:'passed',durationMs:Date.now()-started,runId:run.id,promotionRun:saved.verifiedBy,replayRun:replay.id,exportVerified:true});
   if(name==='Static HTML'){
    const lifecycle=join(dataDir,'repeat-lifecycle.txt');
    const command=line=>({executable:process.execPath,args:['-e',`require('node:fs').appendFileSync(${JSON.stringify(lifecycle)},${JSON.stringify(line+'\n')})`]});
    const repetitions=[];for(let i=0;i<5;i++){const r=await runPlan({...acceptance,target:{...acceptance.target,data:{prepare:command('prepare'),cleanup:command('cleanup')}},cases:[saved.case]},{dataDir});assert.equal(r.exitCode,0);assert.equal(r.unstable,false);repetitions.push({runId:r.id,outcome:r.outcome,attempts:r.cases[0].attempts.length});}
    assert.equal(await readFile(lifecycle,'utf8'),'prepare\ncleanup\n'.repeat(5));
    records.at(-1).lifecycle={prepares:5,cleanups:5};
    records.at(-1).repetitions=repetitions;
   }
  }finally{await service?.close();}
 }
 assert.deepEqual(await hashes(root),before,'Target sources/dependency declarations/locks must be unchanged');
 const f=await fixture();try{
  const defects=[];
  for(const [name,p,expected] of [
   ['button no response',plan(f.url+'/?defect=button',loginSteps()),'failed'],
   ['missing message',plan(f.url+'/?defect=message',loginSteps()),'failed'],
   ['request failure',plan(f.url,[{id:'request',op:'click',locator:selector('#network')},{id:'response',op:'expectText',locator:selector('#network-result'),expected:'Request succeeded',source}]),'failed'],
   ['ambiguous locator',plan(f.url,[{id:'same',op:'click',locator:role('button','Same')},...loginSteps()]),'inconclusive'],
   ['delayed loading',plan(f.url,[{id:'delay',op:'expectText',locator:selector('#delay'),expected:'Ready',source}]),'passed'],
   ['expired login',plan(f.url,loginSteps(),{case:{role:'expired'},target:{roles:{expired:{required:true,storageStateRef:'state',verify:[{id:'role',op:'expectText',locator:selector('#role'),expected:'Role: admin',source}]}}}}),'blocked'],
   ['preparation failure',plan(f.url,loginSteps(),{target:{data:{prepare:{executable:process.execPath,args:['-e','process.exit(1)']}}}}),'blocked']
  ]){
   const start=Date.now();const state=join(f.dataDir,'state.json');await writeFile(state,JSON.stringify({cookies:[],origins:[]}));
   const run=await runPlan(p,{dataDir,bindings:name==='expired login'?{state}:{}});assert.equal(run.outcome,expected,name);
   defects.push({name,outcome:run.outcome,durationMs:Date.now()-start,runId:run.id,networkEvidence:run.cases.some(c=>c.attempts.some(a=>a.steps.some(s=>s.evidence.some(e=>e.type==='network'))))});
  }
  const result={date:new Date().toISOString(),platform:process.platform,node:process.versions.node,versions:JSON.parse(await readFile(join(root,'package.json'),'utf8')).dependencies,records,defects,targetHashesUnchanged:true,hashes:before,dataDir};
  await writeFile(resolve('docs/compatibility-results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
 }finally{await f.close();}
}catch(error){console.error(error);process.exitCode=1;}
