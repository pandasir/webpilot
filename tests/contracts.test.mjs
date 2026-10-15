import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PlanSchema,CaseSchema,TargetSchema,StepSchema} from '../dist/core/schema.js';
import {Budget} from '../dist/core/budget.js';
import {doctor,dataRoot} from '../dist/core/runtime.js';

const assertion={id:'verify',op:'expectText',locator:{kind:'text',value:'Done'},expected:'Done',source:{type:'user',reference:'Show Done'}};
const caseData={schemaVersion:1,id:'example',version:1,title:'Example',steps:[assertion]};
test('contracts reject newer versions, arbitrary code, unsafe references and duplicate steps',()=>{
  assert.throws(()=>CaseSchema.parse({...caseData,schemaVersion:2}));
  assert.throws(()=>StepSchema.parse({id:'code',op:'evaluate',code:'alert(1)'}));
  assert.throws(()=>StepSchema.parse({id:'fill',op:'fill',locator:{kind:'label',value:'Name'},value:{ref:'../secret'}}));
  assert.throws(()=>CaseSchema.parse({...caseData,steps:[assertion,assertion]}));
  assert.throws(()=>PlanSchema.parse({schemaVersion:1,id:'plan',target:{url:'not a URL'},scope:['Feature'],cases:[caseData]}));
});
test('inference cannot become a formal regression assertion without adoption',()=>{
  assert.throws(()=>CaseSchema.parse({...caseData,steps:[{...assertion,source:{type:'inferred',reference:'Page behavior'}}]}));
  assert.equal(CaseSchema.parse({...caseData,steps:[{...assertion,candidate:true,source:{type:'inferred',reference:'Page behavior'}}]}).state,'draft');
  assert.throws(()=>CaseSchema.parse({...caseData,state:'regression-ready',conflicts:['Different expected text']}));
});
test('one budget is shared by incremental calls and honors cancellation',()=>{
  const settings=TargetSchema.parse({budget:{maxSteps:2}}).budget;
  const budget=new Budget(settings);budget.consume();budget.consume();assert.throws(()=>budget.consume(),/step budget/);
  const controller=new AbortController();const cancelled=new Budget(settings,controller.signal);controller.abort();assert.throws(()=>cancelled.consume(),/cancelled/);
});
test('doctor reports missing runtime resources and does not change target files',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'webpilot-doctor-'));
  try {
    const target=join(dir,'project');await mkdir(target);await writeFile(join(target,'package.json'),'{}');
    const result=await doctor({dataDir:join(dir,'data'),nodeVersion:'20.0.0',browserPath:join(dir,'missing-browser')});
    assert.equal(result.ready,false);assert.equal(result.checks[0].ready,false);assert.equal(result.checks[1].ready,false);
    const file=join(dir,'not-a-directory');await writeFile(file,'x');
    assert.equal((await doctor({dataDir:file})).checks.find(c=>c.name==='storage').ready,false);
    assert.equal(dataRoot(join(dir,'override'),'win32'),join(dir,'override'));
  }finally{await rm(dir,{recursive:true,force:true});}
});
