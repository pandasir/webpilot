import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {saveCase} from '../dist/core/runner.js';
import {WebPilotService} from '../dist/core/service.js';
import {TargetSchema} from '../dist/core/schema.js';
import {Store} from '../dist/artifacts/store.js';
import {fixture,plan,selector,source} from './helpers.mjs';

const readEvents=async dir=>(await readFile(join(dir,'events.jsonl'),'utf8')).trimEnd().split('\n').map(line=>JSON.parse(line));

test('case versions cannot skip predecessors or bypass assertion adoption, including promotion',async()=>{
  const root=await mkdtemp(join(tmpdir(),'webpilot-version-history-'));
  try{
    const target=TargetSchema.parse({url:'http://127.0.0.1:1'}),store=new Store(root);
    const original=plan(target.url,[{id:'result',op:'expectText',locator:selector('#result'),expected:'Payment confirmed',source}]).cases[0];
    await assert.rejects(()=>saveCase({...original,version:2},target,{dataDir:root}),e=>e.code==='PREVIOUS_VERSION_MISSING');
    await saveCase(original,target,{dataDir:root});
    const originalBytes=await readFile(join(root,'cases',original.id,'1.json'),'utf8');
    const changed=structuredClone(original);changed.version=3;changed.steps[0].expected='Payment pending';
    await assert.rejects(()=>saveCase(changed,target,{dataDir:root,promote:true}),e=>e.code==='PREVIOUS_VERSION_MISSING');
    await assert.rejects(()=>readdir(join(root,'runs')),e=>e.code==='ENOENT');
    changed.version=2;
    await assert.rejects(()=>saveCase(changed,target,{dataDir:root}),e=>e.code==='CHANGE_REASON_MISSING');
    changed.change={reason:'Changed business expectation'};
    await assert.rejects(()=>saveCase(changed,target,{dataDir:root}),e=>e.code==='ASSERTION_ADOPTION_REQUIRED');
    changed.change={...changed.change,adoptedBy:'reviewer',source:{type:'user',reference:'Approved revised requirement'}};
    const saved=await saveCase(changed,target,{dataDir:root});
    assert.equal(saved.difference.assertionsChanged,true);
    assert.equal(saved.difference.fromVersion,1);assert.equal(saved.difference.toVersion,2);
    const next={...changed,version:3,change:{reason:'Metadata-only new version'}};
    assert.equal((await saveCase(next,target,{dataDir:root})).difference.assertionsChanged,false);
    assert.equal((await store.readCase(original.id,3)).steps[0].expected,'Payment pending');
    await assert.rejects(()=>saveCase(original,target,{dataDir:root}),e=>e.code==='VERSION_EXISTS');
    assert.equal(await readFile(join(root,'cases',original.id,'1.json'),'utf8'),originalBytes);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('unreadable predecessor versions are not treated as new case histories',async()=>{
  const root=await mkdtemp(join(tmpdir(),'webpilot-version-corrupt-'));
  try{
    const target=TargetSchema.parse({url:'http://127.0.0.1:1'});
    const original=plan(target.url,[{id:'result',op:'expectText',locator:selector('#result'),expected:'Confirmed',source}]).cases[0];
    await saveCase(original,target,{dataDir:root});
    await writeFile(join(root,'cases',original.id,'1.json'),'{');
    await assert.rejects(()=>saveCase({...original,version:2,change:{reason:'New version'}},target,{dataDir:root}),SyntaxError);
    await assert.rejects(()=>readFile(join(root,'cases',original.id,'2.json')),e=>e.code==='ENOENT');
  }finally{await rm(root,{recursive:true,force:true});}
});

test('exploration close releases owned services and finishes progress even when evidence persistence fails',async t=>{
  for(const filename of ['session.json','recordings.html'])await t.test(filename,async t=>{
    const root=await mkdtemp(join(tmpdir(),'webpilot-close-persist-')),service=new WebPilotService(root);
    let live;
    try{
      const staticDir=join(root,'static');await mkdir(staticDir);await writeFile(join(staticDir,'index.html'),'<h1>Cleanup fixture</h1>');
      const opened=await service.open({staticDir,evidence:{video:filename==='recordings.html',live:false}},{exploratory:true,dashboard:false});
      // Retain ownership only for test teardown if the cleanup regression returns.
      live=service.sessions.get(opened.sessionId);
      const url=(await service.observe(opened.sessionId)).url;
      const dir=service.store.runDir(opened.runId);await mkdir(join(dir,filename));
      if(filename==='session.json'){
        const close=live.service.close.bind(live.service),emit=live.progress.emit.bind(live.progress);
        t.mock.method(live.service,'close',async()=>{await close();throw new Error('simulated service cleanup failure');});
        t.mock.method(live.progress,'emit',async(type,...args)=>{if(type==='recording.available')throw new Error('simulated progress notification failure');return emit(type,...args);});
      }
      let persistenceError;
      const closing=service.close(opened.sessionId);
      assert.equal(service.close(opened.sessionId),closing);
      await assert.rejects(closing,error=>{persistenceError=error;return error.path===join(dir,filename);});
      await assert.rejects(()=>fetch(url,{signal:AbortSignal.timeout(1000)}));
      assert.equal(live.session.browser.isConnected(),false);
      assert.equal(live.controller.signal.aborted,true);
      await assert.rejects(()=>service.observe(opened.sessionId),e=>e.code==='SESSION_EXPIRED');
      const last=(await readEvents(dir)).at(-1);
      assert.equal(last.type,'run.finished');assert.ok(last.payload.reason.includes(filename));
      if(filename==='session.json'){
        assert.ok(last.payload.reason.includes('simulated service cleanup failure'));
        assert.ok(last.payload.reason.includes('simulated progress notification failure'));
      }
      assert.equal(last.payload.outcome,undefined);
      await assert.rejects(service.close(opened.sessionId),error=>error===persistenceError);
      if(filename==='recordings.html')assert.equal(JSON.parse(await readFile(join(dir,'session.json'),'utf8')).closed,true);
    }finally{
      await live?.session.close().catch(()=>{});await live?.service.close().catch(()=>{});await live?.progress.finish().catch(()=>{});
      await service.closeAll();await rm(root,{recursive:true,force:true});
    }
  });
});

test('progress finalization failure does not replace an exploration persistence error',async t=>{
  const f=await fixture(),service=new WebPilotService(f.dataDir);let live;
  try{
    const opened=await service.open({url:f.url,evidence:{video:false,live:false}},{exploratory:true,dashboard:false});
    live=service.sessions.get(opened.sessionId);
    const failure=new Error('original persistence failure');
    t.mock.method(service,'persist',async()=>{throw failure;});
    t.mock.method(live.progress,'finish',async()=>{throw new Error('simulated progress finalization failure');});
    await assert.rejects(service.close(opened.sessionId),error=>error===failure);
    assert.equal(live.session.browser.isConnected(),false);assert.equal(live.controller.signal.aborted,true);
    assert.equal((await fetch(f.url)).status,200);
  }finally{t.mock.restoreAll();await live?.progress.finish();await service.closeAll();await f.close();}
});

test('exploration initialization retains the original error when failure evidence cannot be persisted',async t=>{
  const f=await fixture(),service=new WebPilotService(f.dataDir);
  try{
    t.mock.method(service,'persist',async()=>{throw new Error('simulated persistence failure');});
    await assert.rejects(()=>service.open({url:f.url,evidence:{video:false,live:false}},{role:'missing',exploratory:true,dashboard:false}),e=>e.code==='ROLE_MISSING');
    const [runId]=await readdir(join(f.dataDir,'runs'));
    const last=(await readEvents(service.store.runDir(runId))).at(-1);
    assert.equal(last.type,'run.finished');assert.ok(last.payload.reason.includes('Role not configured'));
    assert.ok(last.payload.reason.includes('simulated persistence failure'));
    assert.equal((await fetch(f.url)).status,200);
  }finally{t.mock.restoreAll();await service.closeAll();await f.close();}
});
