import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fixture,plan,loginSteps,source,selector} from './helpers.mjs';
import {PlanSchema} from '../dist/core/schema.js';
import {coverageFromPlan,coveragePlan} from '../dist/core/coverage.js';
import {CoverageStore} from '../dist/artifacts/coverage.js';
import {runPlan} from '../dist/core/runner.js';
import {WebPilotService,dispatch} from '../dist/core/service.js';
import {loadRun,publicRun} from '../dist/dashboard/projection.js';

test('suite persists adopted coverage before data prepare and reconciles blocked, candidates and unselected',async()=>{
  const f=await fixture();try{
    const prepareCode=`const fs=require('node:fs'),path=require('node:path'),root=${JSON.stringify(f.dataDir)};for(const id of fs.readdirSync(path.join(root,'runs'))){for(const file of ['coverage.json','plan.json'])if(!fs.existsSync(path.join(root,'runs',id,file)))process.exit(9);}fs.writeFileSync(path.join(root,'prepared-after-plan'),'ok');`;
    const p=PlanSchema.parse(plan(f.url,loginSteps(),{target:{evidence:{video:false},data:{prepare:{executable:process.execPath,args:['-e',prepareCode]}}}})),d=coverageFromPlan(p);
    d.items.push({...d.items[0],id:'later',title:'缺数据',executable:undefined,selected:true,readiness:'blocked',reason:'缺测试账号'});
    d.items.push({...d.items[0],id:'suggestion',title:'建议',executable:undefined,selected:false,selectionReason:'本次范围外'});
    const store=new CoverageStore(f.dataDir),record=await store.create(d),ref={id:record.manifest.id,revision:1};await store.adopt(ref,'已展示');
    const run=await runPlan(coveragePlan(await store.snapshot(ref)),{dataDir:f.dataDir,coverage:ref});assert.equal(run.outcome,'blocked');assert.equal(run.cases[0].outcome,'passed');assert.equal(run.cases[1].outcome,'blocked');assert.equal(run.cases.length,2);
    assert.equal(await readFile(join(f.dataDir,'prepared-after-plan'),'utf8'),'ok');
    const dir=join(f.dataDir,'runs',run.id);const result=JSON.parse(await readFile(join(dir,'coverage-result.json'),'utf8'));assert.equal(result.items.length,3);assert.equal(result.items[2].executionStatus,'not-selected');assert.match(await readFile(join(dir,'report.md'),'utf8'),/覆盖清单对账/);
    const wrong=coveragePlan(await store.snapshot(ref));wrong.cases[0].steps.at(-1).expected='silently changed';await assert.rejects(()=>runPlan(wrong,{dataDir:f.dataDir,coverage:ref}),e=>e.code==='COVERAGE_MISMATCH');
    const before=await readdir(join(f.dataDir,'runs'));const gen=await store.create({...d,mode:'generate-only'});await assert.rejects(()=>runPlan(p,{dataDir:f.dataDir,coverage:{id:gen.manifest.id,revision:1}}));assert.deepEqual(await readdir(join(f.dataDir,'runs')),before);
  }finally{await f.close();}
});

test('session_open refuses to start without an adopted coverage ref unless exploration is explicit',async()=>{
  const f=await fixture(),service=new WebPilotService(f.dataDir);try{
    await assert.rejects(()=>dispatch(service,'session_open',{target:{url:f.url,evidence:{live:false}}}),e=>e.code==='COVERAGE_REQUIRED');
    const opened=await dispatch(service,'session_open',{target:{url:f.url,evidence:{live:false}},exploratory:true});await service.close(opened.sessionId);
    assert.equal((await loadRun(join(f.dataDir,'runs',opened.runId),opened.runId)).meta.mode,'exploration');
  }finally{await service.closeAll();await f.close();}
});

test('planned incremental session links ordered cases and observations to one run',async()=>{
  const f=await fixture(),service=new WebPilotService(f.dataDir);try{
    const p=PlanSchema.parse(plan(f.url,loginSteps(),{target:{evidence:{video:false}}}));p.cases.push({...p.cases[0],id:'title',title:'页面标题',steps:[{id:'heading',op:'expectText',locator:selector('h1'),expected:'Test frontend',source}]});
    const draft=coverageFromPlan(PlanSchema.parse(p));const created=await dispatch(service,'coverage_create',{draft}),coverage={id:created.manifest.id,revision:1};await dispatch(service,'coverage_adopt',{coverage,reference:'已展示清单'});
    const opened=await dispatch(service,'session_open',{target:p.target,coverage});const {sessionId,runId}=opened;assert.ok((await dispatch(service,'session_observe',{sessionId})).url);
    await assert.rejects(()=>dispatch(service,'session_act',{sessionId,step:p.cases[0].steps[0]}),e=>e.code==='CASE_NOT_STARTED');
    await assert.rejects(()=>dispatch(service,'session_case_begin',{sessionId,caseId:'unknown',coverage}),e=>e.code==='CASE_NOT_SELECTED');
    for(const c of draft.items){const began=await dispatch(service,'session_case_begin',{sessionId,caseId:c.id,coverage});assert.equal(began.runId,runId);for(const step of c.executable.steps){const tool=step.op.startsWith('expect')?'session_check':'session_act';const result=await dispatch(service,tool,{sessionId,step,caseId:c.id,attempt:1,revision:1});assert.equal(result.outcome,'passed');}assert.equal((await dispatch(service,'session_case_end',{sessionId})).outcome,'passed');}
    const closed=await dispatch(service,'session_close',{sessionId});assert.equal(closed.report.outcome,'passed');assert.equal(closed.runId,runId);assert.equal(closed.report.cases.length,2);
    const live=publicRun(await loadRun(join(f.dataDir,'runs',runId),runId));assert.equal(live.cases.length,2);assert.equal(live.coverageResult.items.length,2);assert.equal(live.outcome,'passed');assert.equal(live.meta.mode,'planned-session');
    assert.equal((await readdir(join(f.dataDir,'runs'))).length,1);
  }finally{await service.closeAll();await f.close();}
});

test('planned partial close, case mismatch and semantic changes cannot silently pass',async()=>{
  const f=await fixture(),service=new WebPilotService(f.dataDir);try{
    const draft=coverageFromPlan(PlanSchema.parse(plan(f.url,loginSteps(),{target:{evidence:{video:false}}}))),record=await service.coverageStore.create(draft),coverage={id:record.manifest.id,revision:1};await service.coverageStore.adopt(coverage,'published');
    const {sessionId,runId}=await service.open(draft.target,{coverage});await service.planned.begin(sessionId,'feature',coverage);
    await assert.rejects(()=>service.step(sessionId,draft.items[0].executable.steps[0],false,undefined,{caseId:'wrong',revision:1,attempt:1}),e=>e.code==='CASE_ASSOCIATION_MISMATCH');
    const changed=structuredClone(draft.items[0].executable.steps[0]);changed.value='other';await assert.rejects(()=>service.step(sessionId,changed,false,undefined,{caseId:'feature',revision:1,attempt:1}),e=>e.code==='UNPLANNED_STEP');
    const closed=await service.close(sessionId);assert.equal(closed.report.outcome,'inconclusive');assert.equal(closed.report.exitCode,2);assert.equal((await readdir(join(f.dataDir,'runs'))).length,1);
    assert.equal((await loadRun(join(f.dataDir,'runs',runId),runId)).coverage.manifest.id,coverage.id);
  }finally{await service.closeAll();await f.close();}
});

test('CLI preview creates no browser run and works without model credentials',async()=>{
  const f=await fixture();try{const file=join(f.dataDir,'plan.json');await writeFile(file,JSON.stringify(plan(f.url,loginSteps())));const {stdout}=await promisify(execFile)(process.execPath,['dist/cli/index.js','run','--plan',file,'--data-dir',f.dataDir,'--preview-only','--no-dashboard'],{env:{...process.env,OPENAI_API_KEY:'',WEBPILOT_DASHBOARD:'0'}});const record=JSON.parse(stdout);assert.equal(record.status,'generated-only');assert.equal(record.manifest.draft.generation.aiSupplemented,false);await assert.rejects(()=>readdir(join(f.dataDir,'runs')),e=>e.code==='ENOENT');}finally{await f.close();}
});

test('planned session synchronizes pending locators and unselected review suggestions without changing executed steps',async()=>{
  const f=await fixture(),service=new WebPilotService(f.dataDir);try{
    const draft=coverageFromPlan(PlanSchema.parse(plan(f.url,loginSteps(),{target:{evidence:{video:false}}})));draft.mode='review';const record=await service.coverageStore.create(draft),ref={id:record.manifest.id,revision:1};await service.coverageStore.adopt(ref,'用户明确采用第一版',true);
    const opened=await service.open(draft.target,{coverage:ref});await service.planned.begin(opened.sessionId,'feature',ref);await service.step(opened.sessionId,draft.items[0].executable.steps[0],false,undefined,{caseId:'feature',revision:1,attempt:1});
    const next=structuredClone(draft);next.items[0].executable.steps[1].locator={kind:'selector',value:'input[name=password]'};next.generation.round=2;next.generation.aiSupplemented=true;next.items.push({...draft.items[0],id:'refresh',title:'刷新状态',suggestedBy:'ai',selected:false,executable:undefined,readiness:'needs-clarification',reason:'需要业务规则',selectionReason:'待用户审阅'});
    const updated=await service.coverageStore.update(ref.id,1,'observed',next,'细化待执行定位并保留未选建议');assert.equal(updated.adoption.kind,'scope-preserved');const revised={id:ref.id,revision:2};await service.planned.sync(opened.sessionId,revised);
    await assert.rejects(()=>service.planned.sync(opened.sessionId,ref),e=>e.code==='PLAN_VERSION_CONFLICT');
    for(const step of updated.manifest.draft.items[0].executable.steps.slice(1))assert.equal((await service.step(opened.sessionId,step,step.op.startsWith('expect'),undefined,{caseId:'feature',revision:2,attempt:1})).outcome,'passed');await service.planned.end(opened.sessionId);
    await assert.rejects(()=>service.planned.begin(opened.sessionId,'refresh',revised),e=>e.code==='CASE_NOT_SELECTED');const result=await service.close(opened.sessionId);assert.equal(result.report.outcome,'passed');const reconcile=JSON.parse(await readFile(join(f.dataDir,'runs',opened.runId,'coverage-result.json'),'utf8'));assert.equal(reconcile.items.find(i=>i.id==='refresh').executionStatus,'not-selected');assert.equal((await readdir(join(f.dataDir,'runs'))).length,1);
  }finally{await service.closeAll();await f.close();}
});

test('planned sync cannot rewrite executed steps or remove an attempted failure from reconciliation',async()=>{
  const f=await fixture(),service=new WebPilotService(f.dataDir);try{
    const draft=coverageFromPlan(PlanSchema.parse(plan(f.url,loginSteps(),{target:{evidence:{video:false}}}))),created=await service.coverageStore.create(draft),ref={id:created.manifest.id,revision:1};await service.coverageStore.adopt(ref,'published');
    const opened=await service.open(draft.target,{coverage:ref});await service.planned.begin(opened.sessionId,'feature',ref);await service.step(opened.sessionId,draft.items[0].executable.steps[0],false,undefined,{caseId:'feature',revision:1,attempt:1});
    const changed=structuredClone(draft);changed.items[0].executable.steps[0].locator=selector('input[type=password]');await service.coverageStore.update(ref.id,1,'executed-locator',changed,'定位修改不能倒改已执行步骤');await assert.rejects(()=>service.planned.sync(opened.sessionId,{id:ref.id,revision:2}),e=>e.code==='EXECUTED_CASE_CHANGED');
    await service.planned.end(opened.sessionId);const excluded=structuredClone(draft);excluded.items[0].selected=false;excluded.items[0].selectionReason='试图移除已尝试项';await service.coverageStore.update(ref.id,2,'excluded',excluded,'调整范围');const current={id:ref.id,revision:3};await service.coverageStore.adopt(current,'published');await assert.rejects(()=>service.planned.sync(opened.sessionId,current),e=>e.code==='EXECUTED_CASE_CHANGED');
    const closed=await service.close(opened.sessionId);assert.equal(closed.report.cases.length,1);assert.equal(closed.report.outcome,'inconclusive');assert.equal(closed.report.coverage.revision,1);
  }finally{await service.closeAll();await f.close();}
});

test('planned budget exhaustion and cancellation keep selected remaining cases unverified in the original run',async()=>{
  const f=await fixture(),service=new WebPilotService(f.dataDir);try{
    const p=PlanSchema.parse(plan(f.url,loginSteps(),{budget:{maxSteps:1},target:{evidence:{video:false}}}));p.cases.push({...p.cases[0],id:'remaining',title:'剩余选中项'});const draft=coverageFromPlan(p),created=await service.coverageStore.create(draft),ref={id:created.manifest.id,revision:1};await service.coverageStore.adopt(ref,'published');const opened=await service.open(draft.target,{coverage:ref});await service.observe(opened.sessionId);await service.planned.begin(opened.sessionId,'feature',ref);const step=await service.step(opened.sessionId,draft.items[0].executable.steps[0],false,undefined,{caseId:'feature',revision:1,attempt:1});assert.equal(step.error.code,'BUDGET_EXHAUSTED');const closed=await service.close(opened.sessionId);assert.equal(closed.report.exitCode,2);assert.equal(closed.report.cases[1].outcome,'inconclusive');
    const controller=new AbortController();const cancel=await service.open(draft.target,{coverage:ref,signal:controller.signal});controller.abort();const ended=await service.close(cancel.sessionId);assert.equal(ended.report.exitCode,2);assert.equal(ended.report.cases.length,2);const restored=await loadRun(join(f.dataDir,'runs',cancel.runId),cancel.runId);assert.equal(restored.coverageResult.items.filter(i=>i.executionStatus==='not-started').length,2);assert.equal((await readdir(join(f.dataDir,'runs'))).length,2);
  }finally{await service.closeAll();await f.close();}
});

test('planned role contexts stay isolated and retries preserve instability within one run',async()=>{
  const f=await fixture(),service=new WebPilotService(f.dataDir);try{
    const stateFile=join(f.dataDir,'admin.json');await writeFile(stateFile,JSON.stringify({cookies:[{name:'role',value:'admin',domain:'127.0.0.1',path:'/',expires:-1,httpOnly:false,secure:false,sameSite:'Lax'}],origins:[]}));
    const p=PlanSchema.parse(plan(f.url,[{id:'admin',op:'expectText',locator:selector('#role'),expected:'Role: admin',source}],{case:{role:'admin'},budget:{attempts:2},target:{evidence:{video:false},roles:{admin:{storageStateRef:'adminState',verify:[{id:'auth',op:'expectText',locator:selector('#role'),expected:'Role: admin',source}]}}}}));
    p.cases.push({...p.cases[0],id:'guest',title:'访客隔离',role:undefined,steps:[{id:'guest',op:'expectText',locator:selector('#role'),expected:'Role: guest',source}]});p.cases.push({...p.cases[1],id:'retry',title:'不稳定重试',steps:[{id:'navigate',op:'navigate',path:'/retry'},{id:'heading',op:'expectText',locator:selector('h1'),expected:'Test frontend',source}]});
    const draft=coverageFromPlan(PlanSchema.parse(p)),created=await service.coverageStore.create(draft),ref={id:created.manifest.id,revision:1};await service.coverageStore.adopt(ref,'published');const opened=await service.open(draft.target,{coverage:ref,bindings:{adminState:stateFile}});
    for(const c of draft.items){for(let attempt=1;attempt<=2;attempt++){const started=await service.planned.begin(opened.sessionId,c.id,ref);assert.equal(started.attempt,attempt);for(const step of c.executable.steps){const result=await service.step(opened.sessionId,step,step.op.startsWith('expect'),undefined,{caseId:c.id,revision:1,attempt});if(result.outcome!=='passed')break;}const result=await service.planned.end(opened.sessionId);if(result.outcome!=='failed')break;}}
    const closed=await service.close(opened.sessionId);assert.equal(closed.report.cases[0].outcome,'passed');assert.equal(closed.report.cases[1].outcome,'passed');assert.equal(closed.report.cases[2].unstable,true);assert.deepEqual(closed.report.cases[2].attempts.map(a=>a.outcome),['failed','passed']);assert.equal(closed.report.exitCode,2);assert.equal((await readdir(join(f.dataDir,'runs'))).length,1);
  }finally{await service.closeAll();await f.close();}
});

test('coverage write failure prevents business preparation and report failure preserves readable inventory and evidence',async()=>{
  const f=await fixture(),service=new WebPilotService(f.dataDir);try{
    const p=PlanSchema.parse(plan(f.url,loginSteps(),{target:{evidence:{video:false}}})),draft=coverageFromPlan(p),created=await service.coverageStore.create(draft),ref={id:created.manifest.id,revision:1};await service.coverageStore.adopt(ref,'published');
    const original=CoverageStore.prototype.saveSnapshot;CoverageStore.prototype.saveSnapshot=async()=>{throw new Error('simulated coverage disk failure');};try{await assert.rejects(()=>runPlan(p,{dataDir:f.dataDir,coverage:ref}),/disk failure/);for(const id of await readdir(join(f.dataDir,'runs')))assert.ok(!(await readdir(join(f.dataDir,'runs',id))).includes('events.jsonl'));}finally{CoverageStore.prototype.saveSnapshot=original;}
    const opened=await service.open(draft.target,{coverage:ref});await service.planned.begin(opened.sessionId,'feature',ref);await service.step(opened.sessionId,draft.items[0].executable.steps[0],false,undefined,{caseId:'feature',revision:1,attempt:1});service.store.saveRun=async()=>{throw new Error('simulated report disk failure');};await assert.rejects(()=>service.close(opened.sessionId),/report disk failure/);
    const loaded=await loadRun(join(f.dataDir,'runs',opened.runId),opened.runId);assert.ok(loaded.coverage);assert.equal(loaded.cases[0].attempts[0].steps.length,1);assert.equal(loaded.cases[0].outcome,'inconclusive');assert.match(loaded.message,/报告定稿失败/);assert.ok(loaded.artifacts.length>0);
  }finally{await service.closeAll();await f.close();}
});
