import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,mkdir,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CoverageStore} from '../dist/artifacts/coverage.js';
import {CoverageDraftSchema,coverageFromPlan,coverageResult,digest} from '../dist/core/coverage.js';
import {PlanSchema} from '../dist/core/schema.js';
import {plan,loginSteps} from './helpers.mjs';

const draft=()=>coverageFromPlan(PlanSchema.parse(plan('http://localhost:3999',loginSteps())));
async function temp(t){const root=await mkdtemp(join(tmpdir(),'webpilot-coverage-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
test('coverage contracts retain legacy assertions and separate plan selection from results',()=>{
  const d=draft();assert.deepEqual(d.items[0].executable.steps,PlanSchema.parse(plan('http://localhost:3999',loginSteps())).cases[0].steps);
  assert.equal(d.generation.aiSupplemented,false);assert.equal(d.generation.maxRounds,2);assert.equal(d.generation.maxAdditionalCases,12);
  assert.equal(CoverageDraftSchema.safeParse({...d,requirements:[{id:'r',description:'x',source:{type:'user',reference:'request'},caseIds:['unknown']}]}).success,false);
  assert.equal(CoverageDraftSchema.safeParse({...d,items:[{...d.items[0],outcome:'passed'}]}).success,false);
  assert.equal(CoverageDraftSchema.safeParse({...d,items:[{...d.items[0],expectations:[{description:'guess',source:{type:'inferred',reference:'page'},candidate:false}]}]}).success,false);
  assert.equal(CoverageDraftSchema.safeParse({...d,items:[{...d.items[0],readiness:'blocked'}]}).success,false);
  assert.equal(digest({a:1,b:{x:2,y:3}}),digest({b:{y:3,x:2},a:1}));
});
test('coverage CAS, idempotency and adoption bind exact immutable revisions',async t=>{
  const store=new CoverageStore(await temp(t));const first=await store.create(draft());const ref={id:first.manifest.id,revision:1};
  await assert.rejects(()=>store.snapshot(ref),e=>e.code==='PLAN_NOT_ADOPTED');await store.adopt(ref,'已发布清单');
  const next=draft();next.gaps=['增加明确缺口'];next.items[0].selectionReason='调整本次采用的执行安排';
  const results=await Promise.allSettled([store.update(ref.id,1,'update-a',next,'补充缺口'),store.update(ref.id,1,'update-b',{...next,gaps:['different']},'另一个修改')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'PLAN_VERSION_CONFLICT');
  const winner=results.find(r=>r.status==='fulfilled').value;const retry=await store.update(ref.id,1,winner.manifest.requestId,winner.manifest.draft,winner.manifest.reason);assert.equal(retry.manifest.revision,2);
  await assert.rejects(()=>store.adopt(ref,'stale'),e=>e.code==='PLAN_VERSION_CONFLICT');await assert.rejects(()=>store.snapshot({id:ref.id,revision:2}),e=>e.code==='PLAN_NOT_ADOPTED');
  await assert.rejects(()=>store.update(ref.id,2,winner.manifest.requestId,{...next,gaps:['other']},'reuse'),e=>e.code==='REQUEST_ID_REUSED');
  const original=await store.read(ref);assert.equal(original.manifest.draft.gaps.length,0);
});
test('review and generate-only never implicitly adopt; locator changes preserve review',async t=>{
  const store=new CoverageStore(await temp(t));const review=await store.create({...draft(),mode:'review'});const ref={id:review.manifest.id,revision:1};assert.equal(review.status,'awaiting-review');
  await assert.rejects(()=>store.adopt(ref,'model assumed'),e=>e.code==='REVIEW_REQUIRED');await store.adopt(ref,'用户明确要求执行这一版',true);
  const next=structuredClone(review.manifest.draft);next.items[0].executable.steps[0].locator={kind:'selector',value:'input[name=email]'};
  const changed=await store.update(ref.id,1,'locator',next,'页面观察后缩小定位');assert.equal(changed.adoption.kind,'locator-only');
  next.items[0].executable.steps.at(-1).expected='Welcome';await assert.rejects(()=>store.update(ref.id,2,'unadopted-expectation',next,'推测更改'),e=>e.code==='ASSERTION_ADOPTION_REQUIRED');next.items[0].executable.change={reason:'业务规则变化',adoptedBy:'用户采用新规则',source:{type:'user',reference:'新的明确需求'}};const semantic=await store.update(ref.id,2,'expectation',next,'业务规则变化');assert.equal(semantic.adoption,undefined);
  const gen=await store.create({...draft(),mode:'generate-only'});assert.equal(gen.status,'generated-only');await assert.rejects(()=>store.adopt({id:gen.manifest.id,revision:1},'auto'),e=>e.code==='PLAN_NOT_EXECUTABLE');
});
test('free text redaction, expiry and independent run snapshots',async t=>{
  const root=await temp(t),store=new CoverageStore(root);const d=draft();d.items[0].rationale='观察中出现 Bearer example-secret-123';
  const first=await store.create(d);assert.ok(!JSON.stringify(first).includes('example-secret-123'));const ref={id:first.manifest.id,revision:1};await store.adopt(ref,'published');
  const runDir=join(root,'runs','sample');await mkdir(runDir,{recursive:true});await store.saveSnapshot(ref,runDir);
  assert.equal(await store.prune(Date.now()+8*86400000),1);assert.equal(JSON.parse(await readFile(join(runDir,'coverage.json'),'utf8')).manifest.id,ref.id);
  const other=await store.create(draft());const file=join(store.dir(other.manifest.id),'revisions','1.json');const m=JSON.parse(await readFile(file,'utf8'));m.expiresAt=new Date(0).toISOString();await writeFile(file,JSON.stringify(m));await assert.rejects(()=>store.adopt({id:m.id,revision:1},'too late'),e=>e.code==='PLAN_EXPIRED');
});
test('coverage rejects symlink roots and generation expansion beyond budget',async t=>{
  const root=await temp(t),outside=await temp(t);await symlink(outside,join(root,'plans'));await assert.rejects(()=>new CoverageStore(root).create(draft()));
  const d=draft();d.generation.maxAdditionalCases=0;d.items[0].suggestedBy='ai';assert.equal(CoverageDraftSchema.safeParse(d).success,false);
  const store=new CoverageStore(await temp(t)),limited=draft();limited.generation.maxAdditionalCases=1;limited.generation.aiSupplemented=true;limited.items.push({...limited.items[0],id:'ai-first',title:'第一条建议',suggestedBy:'ai',selected:false,executable:undefined});const created=await store.create(limited);const changed=structuredClone(limited);changed.generation.round=2;changed.items[1].id='ai-replacement';await assert.rejects(()=>store.update(created.manifest.id,1,'replace-ai',changed,'替换不应重置累计上限'),e=>e.code==='GENERATION_LIMIT_EXCEEDED');
});
test('failed planning retains its reason and cannot inherit executable approval',async t=>{
  const store=new CoverageStore(await temp(t)),created=await store.create(draft()),ref={id:created.manifest.id,revision:1};await store.adopt(ref,'published');const failed={...created.manifest.draft,status:'failed',failureReason:'缺少关键验收依据'};const updated=await store.update(ref.id,1,'failed',failed,'规划失败');assert.equal(updated.status,'failed');assert.equal(updated.manifest.draft.failureReason,'缺少关键验收依据');await assert.rejects(()=>store.snapshot({id:ref.id,revision:2}),e=>e.code==='PLAN_NOT_ADOPTED');
});
test('reconciliation preserves excluded suggestions and selected unexecuted cases',async t=>{
  const store=new CoverageStore(await temp(t));const d=draft();d.items.push({...d.items[0],id:'suggestion',title:'建议',executable:undefined,selected:false,selectionReason:'超出本次范围'});const p=await store.create(d),ref={id:p.manifest.id,revision:1};await store.adopt(ref,'published');
  const result=coverageResult(await store.snapshot(ref),{id:'run-one',cases:[]},true);assert.equal(result.items[0].executionStatus,'not-started');assert.equal(result.items[0].outcome,undefined);assert.equal(result.items[1].executionStatus,'not-selected');
});
