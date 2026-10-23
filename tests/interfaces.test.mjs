import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp,mkdir,readFile,writeFile,readdir,access} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {WebPilotService,dispatch} from '../dist/core/service.js';
import {runPlan,saveCase} from '../dist/core/runner.js';
import {exportPlan,verifyExport} from '../dist/artifacts/export.js';
import {Store} from '../dist/artifacts/store.js';
import {TargetSchema} from '../dist/core/schema.js';
import {coverageFromPlan} from '../dist/core/coverage.js';
import {PlanSchema} from '../dist/core/schema.js';
import {BrowserSession} from '../dist/browser/session.js';
import {Budget} from '../dist/core/budget.js';
import {StepSchema} from '../dist/core/schema.js';
import {fixture,plan,loginSteps,selector,source} from './helpers.mjs';

async function cli(args){
  return new Promise((ok,fail)=>{
    const child=spawn(process.execPath,['dist/cli/index.js',...args],{env:{...process.env,OPENAI_API_KEY:'',ANTHROPIC_API_KEY:''}});let stdout='',stderr='';
    child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',fail);child.on('close',code=>ok({code,stdout,stderr}));
  });
}
async function copyExportDeps(directory){
  for(const name of ['@playwright/test','playwright','playwright-core','zod'])await cp(resolve('node_modules',name),join(directory,'node_modules',name),{recursive:true});
}
test('MCP stdio schema, structured errors, suite and CLI replay agree without model credentials',async()=>{
  const f=await fixture();const client=new Client({name:'test',version:'1'});
  try{
    await client.connect(new StdioClientTransport({command:process.execPath,args:['dist/mcp/index.js'],env:{...process.env,WEBPILOT_DATA_DIR:f.dataDir},stderr:'pipe'}));
    const inventory=await client.listTools();assert.equal(inventory.tools.length,23);assert.ok(inventory.tools.find(t=>t.name==='session_act').inputSchema.properties.step);for(const name of ['coverage_create','coverage_read','coverage_update','coverage_adopt','session_case_begin','session_case_end','session_case_sync'])assert.ok(inventory.tools.some(t=>t.name===name));
    const expired=await client.callTool({name:'session_observe',arguments:{sessionId:'absent'}});assert.equal(expired.isError,true);assert.equal(expired.structuredContent.error.code,'SESSION_EXPIRED');
    const p=plan(f.url,loginSteps());
    const preview=(await client.callTool({name:'coverage_create',arguments:{draft:coverageFromPlan(PlanSchema.parse(p))}})).structuredContent;assert.equal(preview.metadata,undefined);
    const coverage={id:preview.data.manifest.id,revision:1};assert.equal((await client.callTool({name:'coverage_read',arguments:{id:coverage.id}})).structuredContent.data.currentRevision,1);
    const refused=await client.callTool({name:'suite_run',arguments:{coverage}});assert.equal(refused.structuredContent.error.code,'PLAN_NOT_ADOPTED');
    await client.callTool({name:'coverage_adopt',arguments:{coverage,reference:'已发布清单'}});
    const mcp=(await client.callTool({name:'suite_run',arguments:{plan:p,coverage}})).structuredContent.data;
    const file=join(f.dataDir,'plan.json');await writeFile(file,JSON.stringify(p));
    const c=await cli(['replay','--plan',file,'--data-dir',f.dataDir,'--json']);assert.equal(c.code,0,c.stderr);
    const replay=JSON.parse(c.stdout);assert.equal(replay.outcome,mcp.outcome);assert.equal(replay.unstable,mcp.unstable);
    assert.deepEqual(replay.cases.map(c=>[c.version,c.outcome,c.attempts.map(a=>[a.outcome,a.steps.map(s=>[s.op,s.outcome,s.actual])])]),mcp.cases.map(c=>[c.version,c.outcome,c.attempts.map(a=>[a.outcome,a.steps.map(s=>[s.op,s.outcome,s.actual])])]));
    const failed=await cli(['run','--plan',file,'--url',f.url+'/?defect=button','--data-dir',f.dataDir]);assert.equal(failed.code,1);assert.equal(JSON.parse(failed.stdout).outcome,'failed');
    await writeFile(file,JSON.stringify(plan(f.url,[{id:'canvas',op:'unsupported',capability:'canvas'}])));
    const incomplete=await cli(['replay','--plan',file,'--data-dir',f.dataDir]);assert.equal(incomplete.code,2);assert.equal(JSON.parse(incomplete.stdout).outcome,'inconclusive');
    const internal=await cli(['report','--run','absent','--data-dir',f.dataDir]);assert.equal(internal.code,3);assert.equal(internal.stdout,'');assert.equal(JSON.parse(internal.stderr).code,'INTERNAL_ERROR');
  }finally{await client.close();await f.close();}
});
test('incremental sessions persist evidence, share budgets, isolate roles and expire on cancellation',async()=>{
  const f=await fixture();const s=new WebPilotService(f.dataDir);
  try{
    const opened=await s.open({url:f.url,budget:{maxSteps:1}});
    assert.ok((await s.observe(opened.sessionId)).snapshot.includes('Test frontend'));
    const a=await s.step(opened.sessionId,{id:'title',op:'expectText',locator:selector('h1'),expected:'Test frontend',source},true);
    assert.equal(a.outcome,'passed');assert.ok(a.evidence.some(e=>e.type==='snapshot'));
    const b=await s.step(opened.sessionId,{id:'over-budget',op:'expectText',locator:selector('h1'),expected:'Test frontend',source},true);assert.equal(b.error.code,'BUDGET_EXHAUSTED');
    const persisted=JSON.parse(await readFile(join(s.store.runDir(opened.runId),'session.json'),'utf8'));assert.equal(persisted.steps.length,2);
    await s.close(opened.sessionId);await assert.rejects(()=>s.observe(opened.sessionId),e=>e.code==='SESSION_EXPIRED');
    await assert.rejects(()=>dispatch(s,'constructor',{}),e=>e.code==='UNKNOWN_TOOL');
    await assert.rejects(()=>s.open({url:f.url},{role:'constructor'}),e=>e.code==='ROLE_MISSING');
    const controller=new AbortController();const cancel=await s.open({url:f.url},{signal:controller.signal});controller.abort();
    await new Promise(r=>setTimeout(r,100));await assert.rejects(()=>s.observe(cancel.sessionId),e=>e.code==='SESSION_EXPIRED');
    const active=await s.open({url:f.url,budget:{assertionMs:3000}});const stop=new AbortController();
    setTimeout(()=>stop.abort(),150);
    const result=await dispatch(s,'session_check',{sessionId:active.sessionId,step:{id:'cancel',op:'expectText',locator:selector('h1'),expected:'never',source}},stop.signal);
    assert.equal(result.outcome,'inconclusive');assert.ok(result.evidence.some(e=>e.type==='omitted'));await assert.rejects(()=>s.observe(active.sessionId),e=>e.code==='SESSION_EXPIRED');
  }finally{await s.closeAll();await f.close();}
});
test('independent Playwright export runs good and broken flows, protects files and exposes missing prerequisites',async()=>{
  const f=await fixture();try{
    const p=plan(f.url,loginSteps());const destination=join(f.dataDir,'standalone');const e=await exportPlan(p,destination);
    assert.equal(e.manifest.verified,false);await copyExportDeps(destination);
    await assert.rejects(()=>access(join(destination,'node_modules','webpilot')));
    const good=await verifyExport(destination,{url:f.url});assert.equal(good.exitCode,0);assert.equal(good.manifest.verified,true);
    const bad=await verifyExport(destination,{url:f.url+'/?defect=message'});assert.notEqual(bad.exitCode,0);assert.equal(bad.manifest.verified,false);
    const direct=await runPlan({...p,target:{...p.target,url:f.url+'/?defect=message'}},{dataDir:f.dataDir});assert.equal(direct.outcome,'failed');
    await assert.rejects(()=>exportPlan(p,destination),e=>e.code==='EXPORT_EXISTS');
    const external=join(f.dataDir,'external');const ep=plan(f.url,loginSteps(),{target:{data:{prepare:{executable:process.execPath,args:['-e','process.exit(0)']}}}});
    const ex=await exportPlan(ep,external);assert.equal(ex.manifest.requiresPrepare,true);await copyExportDeps(external);
    const missing=await verifyExport(external,{url:f.url});assert.notEqual(missing.exitCode,0);assert.equal(missing.manifest.verified,false);
    const unsupported=await exportPlan(plan(f.url,[{id:'canvas',op:'unsupported',capability:'canvas'}]),join(f.dataDir,'unsupported'));assert.ok(unsupported.manifest.gaps.some(g=>g.includes('unsupported')));
    const cancelled=new AbortController();cancelled.abort();const interrupted=await verifyExport(destination,{url:f.url,signal:cancelled.signal});assert.notEqual(interrupted.exitCode,0);
  }finally{await f.close();}
});
test('cleanup runs after preparation failure, assertions, cancellation and clean promotion; retries retain instability',async()=>{
  const f=await fixture();try{
    const log=join(f.dataDir,'lifecycle.txt');
    const command=(line,code=0)=>({executable:process.execPath,args:['-e',`require('node:fs').appendFileSync(${JSON.stringify(log)},${JSON.stringify(line+'\n')});process.exit(${code})`]});
    const target={data:{prepare:command('prepare'),cleanup:command('cleanup')}};
    const failed=await runPlan(plan(f.url+'/?defect=message',loginSteps(),{target}),{dataDir:f.dataDir});assert.equal(failed.outcome,'failed');
    assert.equal(await readFile(log,'utf8'),'prepare\ncleanup\n');
    const prep=await runPlan(plan(f.url,loginSteps(),{target:{data:{prepare:command('bad-prepare',1),cleanup:command('cleanup')}}}),{dataDir:f.dataDir});assert.equal(prep.outcome,'blocked');
    const cleanup=await runPlan(plan(f.url,loginSteps(),{target:{data:{cleanup:command('bad-cleanup',1)}}}),{dataDir:f.dataDir});assert.equal(cleanup.outcome,'inconclusive');assert.ok(cleanup.cleanupErrors.length);
    const controller=new AbortController();setTimeout(()=>controller.abort(),300);
    const cancellation=await runPlan(plan(f.url,[{id:'wait',op:'expectText',locator:selector('h1'),expected:'never',source}],{target,budget:{assertionMs:5000}}),{dataDir:f.dataDir,signal:controller.signal});assert.equal(cancellation.outcome,'inconclusive');
    assert.ok((await readFile(log,'utf8')).endsWith('prepare\ncleanup\n'));
    const retry=await runPlan(plan(f.url+'/retry',[{id:'title',op:'expectText',locator:selector('h1'),expected:'Test frontend',source}],{budget:{attempts:2}}),{dataDir:f.dataDir});
    assert.equal(retry.outcome,'passed');assert.equal(retry.exitCode,2);assert.equal(retry.unstable,true);assert.deepEqual(retry.cases[0].attempts.map(a=>a.outcome),['failed','passed']);
    const saved=await saveCase({...plan(f.url,loginSteps()).cases[0],id:'lifecycle'},target.url?target:{url:f.url,...target},{dataDir:f.dataDir,promote:true});assert.equal(saved.case.state,'regression-ready');assert.ok((await readFile(log,'utf8')).endsWith('prepare\ncleanup\n'));
  }finally{await f.close();}
});
test('raw traces stay local and pruning only removes marked runs; maintenance needs adoption',async()=>{
  const f=await fixture();try{
    const normal=await runPlan(plan(f.url,loginSteps()),{dataDir:f.dataDir});const store=new Store(f.dataDir);assert.ok(!(await readdir(store.runDir(normal.id))).some(n=>n.endsWith('.zip')));
    const traced=await runPlan(plan(f.url,loginSteps(),{target:{evidence:{rawTrace:true}}}),{dataDir:f.dataDir});assert.ok((await readdir(store.runDir(traced.id))).some(n=>n.endsWith('.zip')));assert.ok(!JSON.stringify(traced).includes('sensitive-trace'));
    const c={...plan(f.url,loginSteps()).cases[0],id:'maintenance'};await saveCase(c,TargetSchema.parse({url:f.url}),{dataDir:f.dataDir});
    const locatorChange=structuredClone(c);locatorChange.version=2;locatorChange.steps[2].locator={kind:'selector',value:'#login button'};locatorChange.change={reason:'Button accessible label changed; candidate reviewed'};
    const next=await saveCase(locatorChange,TargetSchema.parse({url:f.url}),{dataDir:f.dataDir});assert.equal(next.difference.assertionsChanged,false);
    const weaker=structuredClone(locatorChange);weaker.version=3;weaker.steps.at(-1).contains=true;
    await assert.rejects(()=>saveCase(weaker,TargetSchema.parse({url:f.url}),{dataDir:f.dataDir}),e=>e.code==='ASSERTION_ADOPTION_REQUIRED');
    weaker.change={reason:'Adopt revised expectation',adoptedBy:'fixture owner',source:{type:'user',reference:'New requirement'}};assert.equal((await saveCase(weaker,TargetSchema.parse({url:f.url}),{dataDir:f.dataDir})).difference.assertionsChanged,true);
    const user=join(f.dataDir,'runs','user-files');await mkdir(user);await writeFile(join(user,'keep.txt'),'user');
    const removed=await store.prune(1,Date.now()+3*86400000);assert.ok(removed>=2);assert.equal(await readFile(join(user,'keep.txt'),'utf8'),'user');assert.equal((await store.readCase(c.id,1)).version,1);
  }finally{await f.close();}
});
test('clean promotion rejects exploration state and missing files/scope remain explicit gaps',async()=>{
 const f=await fixture();let session;
 try{
  const target=TargetSchema.parse({url:f.url,budget:{assertionMs:500}});
  session=new BrowserSession(target,new Budget(target.budget));await session.open();
  await session.perform(StepSchema.parse({id:'prime',op:'click',locator:selector('#prime')}));
  const check={id:'primed',op:'expectText',locator:selector('#primed'),expected:'Primed',source};
  await session.perform(StepSchema.parse(check));
  const c={...plan(f.url,[check]).cases[0],id:'leftover'};
  const saved=await saveCase(c,target,{dataDir:f.dataDir,promote:true});assert.equal(saved.case.state,'draft');assert.ok(saved.verifiedBy);
  await assert.rejects(()=>session.perform(StepSchema.parse({id:'outside',op:'navigate',path:'https://example.invalid/'})),e=>e.code==='TARGET_OUT_OF_SCOPE');
  const missing=await runPlan(plan(f.url,[{id:'upload',op:'upload',locator:selector('#upload'),file:{ref:'file'}}]),{dataDir:f.dataDir,bindings:{file:join(f.dataDir,'absent.txt')}});assert.equal(missing.outcome,'blocked');assert.equal(missing.cases[0].attempts[0].steps[0].error.code,'FILE_MISSING');
  await session.close();await assert.rejects(()=>session.observe(),e=>e.code==='SESSION_EXPIRED');
  for(const url of ['file:///etc/passwd','javascript:alert(1)','https://user:password@example.test'])assert.equal(TargetSchema.safeParse({url}).success,false);
  const store=new Store(f.dataDir);const old='run-expired';await store.beginRun(old,1,true);await writeFile(join(store.runDir(old),'.owner.json'),JSON.stringify({owner:'webpilot',id:old,createdAt:Date.now()-2*86400000,retentionDays:1,sensitiveRawTrace:true}));
  await runPlan(plan(f.url,loginSteps()),{dataDir:f.dataDir});await assert.rejects(()=>access(store.runDir(old)));
 }finally{await session?.close();await f.close();}
});
