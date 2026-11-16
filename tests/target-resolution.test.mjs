import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {PlanSchema,TargetSchema} from '../dist/core/schema.js';
import {CoverageDraftSchema,coverageFromPlan,coveragePlan} from '../dist/core/coverage.js';
import {CoverageStore} from '../dist/artifacts/coverage.js';
import {resolvePlan,resolveTarget,overridePlan,fixedTarget,LEGACY_TARGET_GAP} from '../dist/project/target.js';
import {dispatch,WebPilotService} from '../dist/core/service.js';
import {plan,selector,source} from './helpers.mjs';

const url='http://127.0.0.1:12345';
const rawPlan=target=>({...plan(url,[{id:'heading',op:'expectText',locator:selector('h1'),expected:'Test frontend',source}]),target});
async function temp(t){const root=await mkdtemp(join(tmpdir(),'webpilot-resolution-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
const mobile={viewport:{width:390,height:844},evidence:{video:false,live:false,retentionDays:2},budget:{totalMs:20000,maxSteps:12,assertionMs:800,attempts:2},roles:{reader:{required:false}},data:{cleanup:{executable:process.execPath,args:['-e','process.exit(0)']}}};

test('target resolution contracts keep legacy inputs and reject unknown metadata or invalid frozen targets',async()=>{
  const legacy=rawPlan({url});assert.equal(PlanSchema.parse(legacy).targetResolution,undefined);
  const frozen=await resolvePlan(legacy);assert.equal(frozen.targetResolution.schemaVersion,1);
  assert.throws(()=>PlanSchema.parse({...frozen,targetResolution:{schemaVersion:2,sources:{}}}));
  assert.throws(()=>CoverageDraftSchema.parse({...coverageFromPlan(frozen),targetResolution:{schemaVersion:2,sources:{}}}));
  await assert.rejects(()=>resolvePlan({...frozen,target:{url:'file:///invalid'}}));
  await assert.rejects(()=>resolvePlan({...frozen,targetResolution:{schemaVersion:2,sources:{}}}));
});

test('raw target resolution reads configuration before defaults without launching commands or Chromium',async t=>{
  const root=await temp(t),marker=join(root,'must-not-run');let launches=0;
  t.mock.method(chromium,'launch',()=>{launches++;throw new Error('unexpected browser');});
  const command={executable:process.execPath,args:['-e',`require('node:fs').writeFileSync(${JSON.stringify(marker)},'unexpected')`]};
  await writeFile(join(root,'webpilot.config.json'),JSON.stringify({...mobile,command,data:{prepare:command,cleanup:command}}));
  const input=rawPlan({url,projectPath:root}),resolved=await resolvePlan(input);
  assert.deepEqual(resolved.target.viewport,mobile.viewport);assert.equal(resolved.target.evidence.video,false);assert.equal(resolved.target.evidence.live,false);
  assert.deepEqual(resolved.target.budget,mobile.budget);assert.ok(resolved.target.roles.reader);assert.deepEqual(resolved.target.data.prepare.args,command.args);
  assert.equal(resolved.targetResolution.sources.viewport,'config');assert.equal(resolved.targetResolution.sources.url,'explicit');assert.equal(resolved.targetResolution.sources.allowedOrigins,'default');
  assert.equal(input.target.viewport,undefined);assert.equal(launches,0);await assert.rejects(()=>readFile(marker),e=>e.code==='ENOENT');
  const explicit=await resolvePlan(rawPlan({url,projectPath:root,viewport:{width:700,height:500},evidence:{video:true}}));
  assert.equal(explicit.target.viewport.width,700);assert.equal(explicit.target.evidence.video,true);
  assert.equal(explicit.target.evidence.live,true);assert.equal(explicit.target.evidence.retentionDays,7); // Existing whole-object replacement.
  assert.equal(explicit.targetResolution.sources.evidence,'explicit');
  const omitted=await resolvePlan(rawPlan({url,projectPath:root,viewport:undefined,evidence:undefined}));
  assert.deepEqual(omitted.target.viewport,mobile.viewport);assert.equal(omitted.target.evidence.video,false);
});

test('configuration errors and ambiguity fail before publishing executable plans',async t=>{
  const root=await temp(t),store=new CoverageStore(join(root,'data'));
  await assert.rejects(()=>resolvePlan(rawPlan({url,configPath:join(root,'missing')})),e=>e.code==='CONFIG_MISSING');
  await writeFile(join(root,'webpilot.config.json'),'{');
  await assert.rejects(()=>resolvePlan(rawPlan({url,projectPath:root})),e=>e.code==='CONFIG_INVALID');
  await writeFile(join(root,'webpilot.config.json'),JSON.stringify({viewport:{width:0,height:844}}));
  await assert.rejects(()=>resolvePlan(rawPlan({url,projectPath:root})),e=>e.code==='CONFIG_INVALID');
  await rm(join(root,'webpilot.config.json'));
  for(const name of ['a','b']){const dir=join(root,'apps',name);await mkdir(dir,{recursive:true});await writeFile(join(dir,'package.json'),JSON.stringify({scripts:{dev:'vite'}}));}
  const draft=coverageFromPlan(PlanSchema.parse(rawPlan({url})));draft.target={projectPath:root};
  await assert.rejects(()=>store.create(draft),e=>e.code==='TARGET_AMBIGUOUS');
  await assert.rejects(()=>readFile(join(root,'data','plans')),e=>e.code==='ENOENT');
  assert.equal((await resolveTarget({url})).target.viewport.width,1280);
});

test('fixed plans ignore changed and deleted project configs while explicit overrides update provenance',async t=>{
  const root=await temp(t),file=join(root,'webpilot.config.json');await writeFile(file,JSON.stringify(mobile));
  const saved=await resolvePlan(rawPlan({url,projectPath:root,configPath:file}));
  const before=JSON.stringify(saved);await writeFile(file,JSON.stringify({viewport:{width:900,height:600},evidence:{video:true}}));
  assert.deepEqual((await resolvePlan(saved)).target,saved.target);
  const changed=await overridePlan(saved,{url:'http://127.0.0.1:23456'});
  assert.equal(changed.target.url,'http://127.0.0.1:23456');assert.deepEqual(changed.target.viewport,mobile.viewport);assert.equal(changed.target.evidence.video,false);assert.equal(changed.targetResolution.sources.url,'explicit');
  const newFile=join(root,'new.json');await writeFile(newFile,JSON.stringify({viewport:{width:600,height:800}}));
  const configured=await overridePlan(saved,{configPath:newFile,url:'http://127.0.0.1:23456'});
  assert.equal(configured.target.viewport.width,600);assert.equal(configured.target.evidence.video,false);assert.deepEqual(configured.target.budget,saved.target.budget);assert.equal(configured.targetResolution.sources.viewport,'config');
  await rm(file);assert.deepEqual((await resolvePlan(saved)).target,saved.target);assert.equal(JSON.stringify(saved),before);
  const legacy=await overridePlan({...saved,targetResolution:undefined},{},{savedRun:true});assert.ok(legacy.gaps.includes(LEGACY_TARGET_GAP));assert.equal(legacy.target.viewport.width,390);
});

test('MCP coverage publication preserves raw target fields and update never reloads project settings',async t=>{
  const root=await temp(t);await writeFile(join(root,'webpilot.config.json'),JSON.stringify(mobile));
  const service=new WebPilotService(join(root,'data'));const draft=coverageFromPlan(PlanSchema.parse(rawPlan({url})));
  draft.target={url,projectPath:root};
  const created=await dispatch(service,'coverage_create',{draft});const ref={id:created.manifest.id,revision:1};
  assert.equal(created.manifest.draft.target.viewport.width,390);assert.equal(created.manifest.draft.target.evidence.video,false);
  await service.coverageStore.adopt(ref,'published');const snapshot=await service.coverageStore.snapshot(ref);
  assert.deepEqual(coveragePlan(snapshot).target,created.manifest.draft.target);assert.deepEqual(coveragePlan(snapshot).targetResolution,created.manifest.draft.targetResolution);
  await writeFile(join(root,'webpilot.config.json'),'{');
  const updated=await dispatch(service,'coverage_update',{id:ref.id,expectedRevision:1,requestId:'locator-refinement',draft:{...created.manifest.draft,gaps:['visible gap']},reason:'Record gap'});
  assert.deepEqual(updated.manifest.draft.target,created.manifest.draft.target);assert.equal(updated.manifest.draft.targetResolution.sources.viewport,'config');
  const frozen=fixedTarget(created.manifest.draft.target,created.manifest.draft.targetResolution);assert.equal(frozen.target.viewport.width,390);
});
