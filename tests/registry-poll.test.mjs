import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,appendFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {Registry} from '../dist/dashboard/registry.js';
import {CoverageStore} from '../dist/artifacts/coverage.js';
import {Store} from '../dist/artifacts/store.js';
import {Progress} from '../dist/core/progress.js';
import {Redactor} from '../dist/artifacts/redaction.js';
import {MetaSchema} from '../dist/dashboard/protocol.js';

const pause=ms=>new Promise(ok=>setTimeout(ok,ms));

test('periodic polling skips unchanged runs and rescans once evidence changes',async()=>{
  const root=await mkdtemp(join(tmpdir(),'webpilot-poll-'));const data=join(root,'data');await mkdir(data);
  const store=new Store(data);const id='run-poll-finished';await store.beginRun(id);
  const previous=process.env.WEBPILOT_DASHBOARD;process.env.WEBPILOT_DASHBOARD='0';
  let progress;
  try{
    progress=await Progress.create(store.runDir(id),data,{id,title:'轮询回归',mode:'suite',target:'http://127.0.0.1:1/',startedAt:new Date().toISOString(),cases:[{id:'case-1',title:'场景',version:1}]},new Redactor(),{dashboard:false});
    await progress.emit('case.started',{},{caseId:'case-1'});
    await progress.finish({outcome:'passed'});
  }finally{if(previous===undefined)delete process.env.WEBPILOT_DASHBOARD;else process.env.WEBPILOT_DASHBOARD=previous;}
  const registry=new Registry(join(root,'state'));
  try{
    await registry.start(data);
    const finished=registry.runs.get(id);assert.ok(finished);assert.equal(finished.state.lifecycle,'finished');
    const checked=finished.checkedAt;
    await pause(2200);
    assert.equal(registry.runs.get(id)?.checkedAt,checked,'unchanged run must not be reloaded by the poll');
    await appendFile(join(store.runDir(id),'events.jsonl'),'\n');
    await pause(2200);
    assert.ok((registry.runs.get(id)?.checkedAt??0)>checked,'changed evidence must trigger a reload');
  }finally{await registry.close();await rm(root,{recursive:true,force:true});}
});

test('plan discovery is throttled on the poll while explicit refresh stays immediate',async()=>{
  const root=await mkdtemp(join(tmpdir(),'webpilot-poll-plans-'));const data=join(root,'data');await mkdir(data);
  const draft={title:'轮询计划',target:{staticDir:data,evidence:{video:false}},scope:['验证计划轮询'],items:[{id:'case-1',title:'唯一场景',suggestedBy:'user',selected:false,selectionReason:'本次未选',readiness:'needs-clarification',reason:'等待业务确认',rationale:'回归测试用最小清单',dimension:'测试',actions:['打开页面'],expectations:[{description:'页面可用',source:{type:'inferred',reference:'回归测试'},candidate:true}]}]};
  const plans=new CoverageStore(data);await plans.create(draft);
  const registry=new Registry(join(root,'state'));
  try{
    await registry.start(data);
    assert.equal(registry.plans.size,1);
    await plans.create({...draft,title:'轮询计划 2'});
    await pause(2200);
    assert.equal(registry.plans.size,1,'the throttled poll must not rescan plans');
    await registry.refresh();
    assert.equal(registry.plans.size,2,'explicit refresh must rescan plans immediately');
  }finally{await registry.close();await rm(root,{recursive:true,force:true});}
});

test('a silent run whose executor dies is still marked interrupted without rereading files',async()=>{
  const root=await mkdtemp(join(tmpdir(),'webpilot-poll-dead-'));const data=join(root,'data');const id='run-poll-dead';
  const dir=join(data,'runs',id);await mkdir(dir,{recursive:true});
  const executor=spawn(process.execPath,['-e','setInterval(()=>{},1000)']);
  await writeFile(join(dir,'.owner.json'),JSON.stringify({owner:'webpilot',id,createdAt:Date.now(),retentionDays:7,sensitiveRawTrace:false,sensitiveVideo:false})+'\n');
  await writeFile(join(dir,'live.json'),JSON.stringify(MetaSchema.parse({protocolVersion:1,id,title:'中断检测',mode:'suite',target:'http://127.0.0.1:1/',startedAt:new Date().toISOString(),owner:{pid:executor.pid,nonce:randomUUID()}}))+'\n');
  await writeFile(join(dir,'events.jsonl'),'');
  const registry=new Registry(join(root,'state'));const changed=[];
  try{
    registry.on('changed',changedId=>changed.push(changedId));
    await registry.start(data);
    assert.equal(registry.runs.get(id)?.state.lifecycle,'preparing');
    const silent=registry.runs.get(id);assert.ok(silent);const checked=silent.checkedAt;changed.length=0;
    executor.kill();await once(executor,'exit');
    await pause(2200);
    const entry=registry.runs.get(id);
    assert.ok(entry,'the run stays registered');
    assert.equal(entry.state.lifecycle,'interrupted');
    assert.match(entry.state.message??'',/执行器已退出/);
    assert.ok(entry.state.management?.allowed,'an interrupted run becomes manageable');
    assert.ok(changed.includes(id),'the transition is broadcast');
    assert.equal(entry.checkedAt,checked,'the transition must not require a full reload');
  }finally{executor.kill();await registry.close();await rm(root,{recursive:true,force:true});}
});
