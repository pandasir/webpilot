import test from 'node:test';
import assert from 'node:assert/strict';
import {assessAcceptance,summarizeAcceptance} from '../dist/core/acceptance.js';
import {CaseSchema} from '../dist/core/schema.js';

const source={type:'user',reference:'明确验收规则'},inferred={type:'inferred',reference:'补充检查，尚无业务规则'};
const formal=(id='formal')=>({id,op:'expectText',locator:{kind:'selector',value:'h1'},expected:'首页',source});
const candidate=(id='candidate')=>({...formal(id),candidate:true,source:inferred});
const make=(id,steps)=>CaseSchema.parse({schemaVersion:1,id,title:id,version:1,steps});
const step=(planned,outcome='passed',code)=>({id:planned.id,op:planned.op,candidate:!!planned.candidate,outcome,timestamp:new Date().toISOString(),durationMs:1,evidence:[],...(code?{error:{code,message:'原始诊断'}}:{})});
const attempt=(steps,outcome='passed')=>({number:1,steps,outcome});
const result=(id,attempts)=>({id,outcome:attempts.at(-1).outcome,unstable:false,attempts});

test('formal acceptance ignores supplementary matches and findings without discarding raw outcomes',()=>{
  const planned=[make('login',[formal()]),make('empty',[candidate()]),make('refresh',[candidate()])];
  const results=[result('login',[attempt([step(formal())])]),result('empty',[attempt([step(candidate())],'inconclusive')]),result('refresh',[attempt([step(candidate(),'inconclusive','ASSERTION_FAILED')],'inconclusive')])];
  const summary=summarizeAcceptance(planned,results);
  assert.equal(summary.outcome,'passed');assert.equal(summary.exitCode,0);assert.equal(summary.acceptance.formal.total,1);
  assert.deepEqual(summary.acceptance.supplementary,{total:2,matched:1,issues:1,incomplete:0,checks:[{caseId:'empty',stepId:'candidate',status:'matched'},{caseId:'refresh',stepId:'candidate',status:'issue'}]});
  assert.equal(results[2].outcome,'inconclusive');
});

test('mixed historical cases can explain a formal pass but cannot skip later required steps',()=>{
  const planned=[make('mixed',[formal(),candidate()])],steps=[step(formal()),step(candidate(),'inconclusive','ASSERTION_FAILED')];
  assert.equal(assessAcceptance(planned,[result('mixed',[attempt(steps,'inconclusive')])]).formal.outcome,'passed');
  planned[0].steps.push(formal('later'));
  assert.equal(summarizeAcceptance(planned,[result('mixed',[attempt(steps,'inconclusive')])]).outcome,'inconclusive');
});

test('candidate-only and action-only work never becomes formal acceptance',()=>{
  const supplementary=[make('only',[candidate()])];
  const summary=summarizeAcceptance(supplementary,[result('only',[attempt([step(candidate())],'inconclusive')])]);
  assert.equal(summary.acceptance.formal.outcome,'none');assert.equal(summary.outcome,'inconclusive');assert.equal(summary.exitCode,2);
  const actions=[make('action',[{id:'open',op:'navigate',path:'/'}])];
  assert.equal(summarizeAcceptance(actions,[result('action',[attempt([step(actions[0].steps[0])],'inconclusive')])]).outcome,'inconclusive');
});

test('missing, failed, blocked and unverified formal requirements remain visible',()=>{
  const planned=[make('login',[formal()]),make('remaining',[formal()])];
  assert.equal(summarizeAcceptance(planned,[result('login',[attempt([step(formal())])])]).outcome,'inconclusive');
  assert.equal(summarizeAcceptance(planned,[result('login',[attempt([step(formal(),'failed','ASSERTION_FAILED')],'failed')])]).outcome,'failed');
  assert.equal(summarizeAcceptance(planned,[result('login',[attempt([],'blocked')])]).outcome,'blocked');
  assert.equal(summarizeAcceptance(planned,[result('login',[attempt([],'inconclusive')])]).outcome,'inconclusive');
});

test('last attempts cannot pool partial success; retries and cleanup retain nonzero exit codes',()=>{
  const planned=[make('login',[formal('one'),formal('two')])];
  const partial=result('login',[attempt([step(formal('one'))],'failed'),attempt([step(formal('two'))],'inconclusive')]);
  assert.equal(summarizeAcceptance(planned,[partial]).outcome,'inconclusive');
  const retried=result('login',[attempt([step(formal('one'),'failed','ASSERTION_FAILED')],'failed'),attempt([step(formal('one')),step(formal('two'))])]);
  const summary=summarizeAcceptance(planned,[retried]);assert.equal(summary.outcome,'passed');assert.equal(summary.unstable,true);assert.equal(summary.exitCode,2);
  assert.equal(summarizeAcceptance(planned,[retried],['清理失败']).outcome,'inconclusive');
});

test('supplementary locator failures and missing checks are incomplete rather than business findings',()=>{
  const planned=[make('explore',[candidate('one'),candidate('two')])],actual=result('explore',[attempt([step(candidate('one'),'inconclusive','LOCATOR_AMBIGUOUS')],'inconclusive')]);
  const summary=assessAcceptance(planned,[actual]);assert.equal(summary.supplementary.issues,0);assert.equal(summary.supplementary.incomplete,2);
});
