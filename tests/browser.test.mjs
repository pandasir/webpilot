import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,readFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {runPlan,saveCase,summarize} from '../dist/core/runner.js';
import {BrowserSession} from '../dist/browser/session.js';
import {TargetSchema,StepSchema} from '../dist/core/schema.js';
import {Budget} from '../dist/core/budget.js';
import {Store} from '../dist/artifacts/store.js';
import {fixture,plan,loginSteps,source,label,role,selector,text} from './helpers.mjs';

test('real Chromium verifies URL-only login, waits for delayed UI and records evidence',async()=>{
  const f=await fixture();try{
    const run=await runPlan(plan(f.url,[...loginSteps(),{id:'wait',op:'expectText',locator:selector('#delay'),expected:'Ready',source}]),{dataDir:f.dataDir});
    assert.equal(run.outcome,'passed');assert.equal(run.exitCode,0);assert.ok(run.environment.browser!=='unavailable');
    assert.ok(run.cases[0].attempts[0].steps.some(s=>s.evidence.some(e=>e.type==='screenshot')));
    assert.ok(run.gaps.some(g=>g.includes('Source')));const report=await new Store(f.dataDir).readRun(run.id);assert.equal(report.id,run.id);
  }finally{await f.close();}
});
test('business failure, candidates, ambiguity and canvas have distinct honest outcomes',async()=>{
  const f=await fixture();try{
    const broken=await runPlan(plan(f.url+'?defect=message',loginSteps()),{dataDir:f.dataDir});assert.equal(broken.outcome,'failed');assert.equal(broken.exitCode,1);
    const ambiguous=await runPlan(plan(f.url,[{id:'same',op:'click',locator:role('button','Same')},...loginSteps()]),{dataDir:f.dataDir});
    assert.equal(ambiguous.outcome,'inconclusive');assert.equal(ambiguous.cases[0].attempts[0].steps[0].error.code,'LOCATOR_AMBIGUOUS');
    const canvas=await runPlan(plan(f.url,[{id:'draw',op:'unsupported',capability:'canvas'}]),{dataDir:f.dataDir});assert.equal(canvas.outcome,'inconclusive');
    const candidate=await runPlan(plan(f.url,[{id:'candidate',op:'expectText',locator:selector('h1'),expected:'Test frontend',source:{type:'inferred',reference:'Observed page'},candidate:true}]),{dataDir:f.dataDir});assert.equal(candidate.outcome,'inconclusive');
  }finally{await f.close();}
});
test('iframe, new page, input controls, file upload and download preserve semantic scope',async()=>{
  const f=await fixture();try{
    const file=join(f.dataDir,'sample.txt');await writeFile(file,'test upload');
    const run=await runPlan(plan(f.url,[
      {id:'frame',op:'frame',selector:'iframe'},
      {id:'frame-input',op:'fill',locator:label('Frame input'),value:'hello'},
      {id:'frame-submit',op:'click',locator:role('button','Submit')},
      {id:'frame-result',op:'expectText',locator:selector('output'),expected:'Frame done',source},
      {id:'outer',op:'frame',selector:null},
      {id:'choice',op:'select',locator:label('Choice'),value:'two'},
      {id:'choice-result',op:'expectValue',locator:label('Choice'),expected:'two',source},
      {id:'check',op:'check',locator:label('Agree'),checked:true},
      {id:'popup',op:'openPage',locator:role('link','Open page'),name:'extra'},
      {id:'popup-url',op:'expectURL',expected:'/extra',source},
      {id:'main',op:'switchPage',name:'main'},
      {id:'upload',op:'upload',locator:label('Test file'),file:{ref:'uploadFile'}},
      {id:'uploaded',op:'expectText',locator:selector('#file-result'),expected:'Uploaded sample.txt',source},
      {id:'download',op:'download',locator:role('link','Download'),filename:'sample.txt',source}
    ]),{dataDir:f.dataDir,bindings:{uploadFile:file}});
    assert.equal(run.outcome,'passed',JSON.stringify(run.cases[0].attempts));
  }finally{await f.close();}
});
test('roles use separate contexts and expired states block instead of passing',async()=>{
  const f=await fixture();try{
    const state=join(f.dataDir,'admin-state.json');await writeFile(state,JSON.stringify({cookies:[{name:'role',value:'admin',domain:'127.0.0.1',path:'/',expires:-1,httpOnly:false,secure:false,sameSite:'Lax'}],origins:[]}));
    const verify=[{id:'identity',op:'expectText',locator:selector('#role'),expected:'Role: admin',source}];
    const p=plan(f.url,[{id:'role',op:'expectText',locator:selector('#role'),expected:'Role: admin',source}],{target:{roles:{admin:{storageStateRef:'adminState',verify}}},case:{role:'admin'}});
    const admin=await runPlan(p,{dataDir:f.dataDir,bindings:{adminState:state}});assert.equal(admin.outcome,'passed');
    const guest=await runPlan(plan(f.url,[{id:'guest',op:'expectText',locator:selector('#role'),expected:'Role: guest',source}]),{dataDir:f.dataDir});assert.equal(guest.outcome,'passed');
    await writeFile(state,JSON.stringify({cookies:[],origins:[]}));
    const expired=await runPlan(p,{dataDir:f.dataDir,bindings:{adminState:state}});assert.equal(expired.outcome,'blocked');
  }finally{await f.close();}
});
test('sensitive evidence is redacted, missing masks omit screenshots and traces default off',async()=>{
  const f=await fixture();try{
    const run=await runPlan(plan(f.url,[{id:'request',op:'click',locator:selector('#network')},{id:'result',op:'expectText',locator:selector('#network-result'),expected:'Request failed',source}],{target:{evidence:{masks:['#sensitive'],secrets:[{ref:'secret'}]}}}),{dataDir:f.dataDir,bindings:{secret:'test-secret-123'}});
    assert.equal(run.outcome,'passed');
    for(const step of run.cases[0].attempts[0].steps)for(const e of step.evidence)if(e.path && e.type!=='screenshot')assert.ok(!(await readFile(e.path,'utf8')).includes('test-secret-123'));
    const hidden=await runPlan(plan(f.url,loginSteps(),{target:{evidence:{masks:['#missing-sensitive']}}}),{dataDir:f.dataDir});
    assert.ok(hidden.cases[0].attempts[0].steps.every(s=>!s.evidence.some(e=>e.type==='screenshot')));
    assert.ok(hidden.cases[0].attempts[0].steps.some(s=>s.evidence.some(e=>e.type==='omitted')));
  }finally{await f.close();}
});
test('conflicts, missing references, data failures and exhausted budgets never count as pass',async()=>{
  const f=await fixture();try{
    const conflict=await runPlan(plan(f.url,loginSteps(),{case:{conflicts:['Expected result changed']}}),{dataDir:f.dataDir});assert.equal(conflict.outcome,'blocked');
    const missing=await runPlan(plan(f.url,[{id:'fill',op:'fill',locator:label('Password'),value:{ref:'missing'}},...loginSteps()]),{dataDir:f.dataDir});assert.equal(missing.outcome,'blocked');
    const budget=await runPlan(plan(f.url,loginSteps(),{budget:{maxSteps:1}}),{dataDir:f.dataDir});assert.equal(budget.outcome,'inconclusive');
    const prepare=await runPlan(plan(f.url,loginSteps(),{target:{data:{prepare:{executable:process.execPath,args:['-e','process.exit(1)']}}}}),{dataDir:f.dataDir});assert.equal(prepare.outcome,'blocked');
    const cancelled=new AbortController();cancelled.abort();const run=await runPlan(plan(f.url,loginSteps()),{dataDir:f.dataDir,signal:cancelled.signal});assert.equal(run.outcome,'inconclusive');
  }finally{await f.close();}
});
test('case promotion requires clean replay and immutable versions',async()=>{
  const f=await fixture();try{
    const c=plan(f.url,loginSteps()).cases[0];
    const saved=await saveCase(c,TargetSchema.parse({url:f.url}),{dataDir:f.dataDir,promote:true});assert.equal(saved.case.state,'regression-ready');assert.ok(saved.verifiedBy);
    await assert.rejects(()=>saveCase(c,TargetSchema.parse({url:f.url}),{dataDir:f.dataDir}),/immutable/);
    const candidate=plan(f.url,[{id:'guess',op:'expectText',locator:selector('h1'),expected:'Test frontend',candidate:true,source:{type:'inferred',reference:'Guess'}}]).cases[0];candidate.id='candidate';
    const draft=await saveCase(candidate,TargetSchema.parse({url:f.url}),{dataDir:f.dataDir,promote:true});assert.equal(draft.case.state,'draft');
  }finally{await f.close();}
});
test('aggregation preserves unstable retries and partial results',()=>{
  assert.equal(summarize([{outcome:'passed',unstable:true}]).exitCode,2);
  assert.equal(summarize([{outcome:'passed',unstable:false},{outcome:'blocked',unstable:false}]).outcome,'blocked');
  assert.equal(summarize([{outcome:'passed',unstable:false}],['cleanup failed']).outcome,'inconclusive');
  assert.equal(summarize([]).outcome,'inconclusive');
});
