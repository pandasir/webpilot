import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {request,createServer} from 'node:http';
import {WebSocket} from 'ws';
import {MetaSchema,LiveRunSchema,ProgressEventSchema,HandshakeSchema,encodeFrame,decodeFrame} from '../dist/dashboard/protocol.js';
import {dashboardRoot,openArtifact,atomicJson,ownerAlive} from '../dist/dashboard/files.js';
import {initialRun,applyEvent,parseEvents,loadRun,publicRun} from '../dist/dashboard/projection.js';
import {startDashboard} from '../dist/dashboard/server.js';
import {openDashboard,internal,stopDashboard,ensureDashboard,endpointAt,requireCoverageDashboard} from '../dist/dashboard/lifecycle.js';
import {Progress} from '../dist/core/progress.js';
import {Store} from '../dist/artifacts/store.js';
import {Redactor} from '../dist/artifacts/redaction.js';

const pause=ms=>new Promise(r=>setTimeout(r,ms));
const meta=(id='run-contract')=>MetaSchema.parse({protocolVersion:1,id,title:'登录验收',target:'http://localhost:3000',mode:'suite',startedAt:new Date().toISOString(),owner:{pid:process.pid,nonce:'00000000-0000-4000-8000-000000000001'},totalCases:1,cases:[{id:'login',version:1,title:'错误密码'}]});
const event=(seq,type,payload,extra={})=>({protocolVersion:1,runId:'run-contract',seq,timestamp:new Date().toISOString(),type,payload,...extra});
async function fixture(){const root=await mkdtemp(join(tmpdir(),'webpilot-dashboard-'));const dataDir=join(root,'data');await mkdir(dataDir);const service=await startDashboard({root:join(root,'state'),port:0,defaultDataDir:dataDir});return {root,dataDir,service,close:async()=>{await service.close();await rm(root,{recursive:true,force:true});}};}
async function authenticate(service){const e={url:service.url,token:service.token};const {token}=await internal(e,'/internal/bootstrap',{});const res=await fetch(service.url+'/api/session',{method:'POST',headers:{'Content-Type':'application/json',Origin:service.url},body:JSON.stringify({token})});assert.equal(res.status,200);return {Cookie:res.headers.get('set-cookie').split(';')[0]};}
async function recording(f,id='run-contract',options={}){const store=new Store(f.dataDir);await store.beginRun(id);const m=meta(id);const {owner,protocolVersion,...input}=m;const progress=await Progress.create(store.runDir(id),store.root,input,new Redactor(options.bindings),{dashboard:false});return {store,progress};}
async function child(cmd,env){return new Promise((ok,fail)=>{const p=spawn(process.execPath,['--input-type=module','-e',cmd],{cwd:resolve('.'),env:{...process.env,...env},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);p.once('error',fail);p.once('exit',code=>code===0?ok(stdout):fail(new Error(stderr)));});}

test('dashboard contracts reject incompatible versions and invalid associations without inventing exploration outcomes',()=>{
  assert.throws(()=>MetaSchema.parse({...meta(),protocolVersion:2}));
  assert.throws(()=>HandshakeSchema.parse({protocolVersion:2,runId:'run-contract',dataDir:'/tmp',owner:meta().owner}));
  assert.throws(()=>ProgressEventSchema.parse(event(1,'step.started',{op:'click'})));
  assert.throws(()=>ProgressEventSchema.parse(event(1,'phase.changed',{phase:'passed'})));
  const live=initialRun({...meta(),mode:'exploration',totalCases:undefined});LiveRunSchema.parse(live);assert.equal(live.outcome,undefined);
  assert.throws(()=>LiveRunSchema.parse({...live,outcome:'passed'}));
  const root=dashboardRoot();const previous=process.env.WEBPILOT_DATA_DIR;process.env.WEBPILOT_DATA_DIR='/tmp/different-project';assert.equal(dashboardRoot(),root);if(previous===undefined)delete process.env.WEBPILOT_DATA_DIR;else process.env.WEBPILOT_DATA_DIR=previous;
  const header={protocolVersion:1,runId:'run-contract',pageId:'page-1',streamEpoch:1,frameSeq:1,capturedAt:Date.now()};const jpeg=Buffer.from([255,216,255,217]);assert.deepEqual(decodeFrame(encodeFrame(header,jpeg)).jpeg,jpeg);assert.throws(()=>decodeFrame(Buffer.alloc(100)));assert.throws(()=>encodeFrame({...header,attempt:0},jpeg));
});
test('progress is redacted, ordered, replayable and recovers valid lines before a truncated tail',async()=>{
  const f=await fixture();try{const {store,progress}=await recording(f,'run-contract',{bindings:{token:'credential-example'}});
    await progress.phase('running','Bearer credential-example');
    await progress.emit('step.started',{op:'click'},{caseId:'login',attempt:1,stepId:'submit'});
    const text=await readFile(join(store.runDir('run-contract'),'events.jsonl'),'utf8');assert.ok(!text.includes('credential-example'));
    const parsed=parseEvents(text+'{"incomplete":');assert.equal(parsed.partial,true);assert.deepEqual(parsed.events.map(e=>e.seq),[1,2,3]);
    const state=initialRun(progress.meta);for(const e of parsed.events)applyEvent(state,e);applyEvent(state,parsed.events[2]);assert.equal(state.seq,3);assert.equal(state.cases[0].activeStep.id,'submit');
    applyEvent(state,event(5,'run.finished',{}));assert.equal(state.seq,3);assert.ok(state.logGap);
    await progress.finish();await f.service.registry.importRoot(f.dataDir);await f.service.registry.refresh();const run=await loadRun(store.runDir('run-contract'),'run-contract');assert.equal(run.lifecycle,'finished');assert.equal(publicRun(run).outcome,undefined);
  }finally{await f.close();}
});
test('local authentication rejects foreign origins, reusable tickets, wrong hosts and unauthenticated sockets',async()=>{
  const f=await fixture();try{
    assert.equal((await fetch(f.service.url+'/api/runs')).status,401);
    const {token}=await internal({url:f.service.url,token:f.service.token},'/internal/bootstrap',{});
    const exchange=origin=>fetch(f.service.url+'/api/session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({token})});
    assert.equal((await exchange('http://evil.example')).status,403);
    assert.equal((await exchange(f.service.url)).status,200);assert.equal((await exchange(f.service.url)).status,401);
    const headers=await authenticate(f.service);assert.equal((await fetch(f.service.url+'/api/runs',{headers})).status,200);
    assert.equal((await fetch(f.service.url+'/api/runs',{headers:{...headers,Origin:'http://evil.example'}})).status,401);
    const hostStatus=await new Promise((ok,fail)=>{const req=request(f.service.url+'/api/health',{headers:{Host:'evil.example'}},res=>{res.resume();ok(res.statusCode);});req.on('error',fail);req.end();});assert.equal(hostStatus,403);
    await new Promise(resolve=>{const ws=new WebSocket(f.service.url.replace('http:','ws:')+'/internal/executors',{origin:'http://evil.example'});ws.on('error',()=>{});ws.on('close',resolve);});
  }finally{await f.close();}
});
test('multiple roots share one overview; snapshot SSE restores complete state and artifact access is constrained',async()=>{
  const f=await fixture();try{
    const a=await recording(f);await a.progress.phase('running');
    const second=join(f.root,'second');await mkdir(second);const b=await recording({...f,dataDir:second},'run-second');await b.progress.finish();
    await f.service.registry.importRoot(f.dataDir);await f.service.registry.importRoot(second);await f.service.registry.refresh();
    const headers=await authenticate(f.service);const all=await(await fetch(f.service.url+'/api/runs',{headers})).json();assert.equal(all.total,2);
    const controller=new AbortController();const res=await fetch(f.service.url+'/api/runs/run-contract/events?after=0',{headers,signal:controller.signal});const reader=res.body.getReader();const chunk=new TextDecoder().decode((await reader.read()).value);assert.match(chunk,/event: state/);assert.match(chunk,/run-contract/);controller.abort();await reader.cancel().catch(()=>{});
    const dir=a.store.runDir('run-contract');const picture=join(dir,'screenshot-test.png');await writeFile(picture,Buffer.from([1,2,3,4,5]));
    const step={id:'submit',op:'click',outcome:'passed',durationMs:10,timestamp:new Date().toISOString(),evidence:[{schemaVersion:1,id:'evidence-test',type:'screenshot',path:picture,runId:'run-contract',caseId:'login',stepId:'submit',attempt:1,redacted:true,timestamp:new Date().toISOString()}]};
    await a.progress.emit('evidence.available',{step},{caseId:'login',attempt:1,stepId:'submit'});await f.service.registry.refresh();
    const state=await(await fetch(f.service.url+'/api/runs/run-contract',{headers})).json();const asset=state.artifacts[0];assert.ok(asset);assert.equal(asset.path,undefined);
    const partial=await fetch(`${f.service.url}/api/runs/run-contract/artifacts/${asset.id}`,{headers:{...headers,Range:'bytes=1-3'}});assert.equal(partial.status,206);assert.deepEqual(Buffer.from(await partial.arrayBuffer()),Buffer.from([2,3,4]));
    assert.equal((await fetch(`${f.service.url}/api/runs/run-contract/artifacts/${asset.id}`,{headers:{...headers,Range:'bytes=100-200'}})).status,416);
    await rm(picture);await symlink(join(f.root,'outside'),picture);assert.equal((await fetch(`${f.service.url}/api/runs/run-contract/artifacts/${asset.id}`,{headers})).status,410);
    await assert.rejects(()=>openArtifact(dir,join(f.root,'outside')));
    await a.progress.finish();
  }finally{await f.close();}
});
test('simultaneous independent processes reuse a single service and opening lease',async()=>{
  const root=await mkdtemp(join(tmpdir(),'webpilot-daemon-'));const state=join(root,'state');const data=join(root,'data');await mkdir(data);
  try{
    const cmd="import {ensureDashboard} from './dist/dashboard/lifecycle.js'; const e=await ensureDashboard(); console.log(JSON.stringify({url:e.url,instance:e.instance}));";
    const env={WEBPILOT_DASHBOARD_DIR:state,WEBPILOT_DATA_DIR:data};const results=await Promise.all([child(cmd,env),child(cmd,env)]);assert.deepEqual(JSON.parse(results[0]),JSON.parse(results[1]));
    // Merely returning a link must not consume another chat's permission to open.
    const [a,b]=await Promise.all([openDashboard({root:state,auto:true,open:false}),openDashboard({root:state,open:false})]);assert.ok(a.shouldOpen&&b.shouldOpen);
    const reserve="import {ensureDashboard,internal} from './dist/dashboard/lifecycle.js'; const e=await ensureDashboard(); console.log(JSON.stringify(await internal(e,'/internal/bootstrap',{reserve:true})));";
    const openings=(await Promise.all([child(reserve,env),child(reserve,env)])).map(JSON.parse);
    assert.equal(openings.filter(x=>x.shouldOpen).length,1);
    const endpoint=await endpointAt(state),lease=openings.find(x=>x.shouldOpen).lease;assert.ok(lease);
    assert.equal((await openDashboard({root:state,open:false})).shouldOpen,false);
    await internal(endpoint,'/internal/opened',{lease:'stale-lease',opened:true});
    await internal(endpoint,'/internal/opened',{lease,opened:false});
    assert.equal((await openDashboard({root:state,open:false})).shouldOpen,true,'a failed launch can be retried');
    const retry=await internal(endpoint,'/internal/bootstrap',{auto:true,reserve:true});
    await internal(endpoint,'/internal/opened',{lease:retry.lease,opened:true});
    const checks=await Promise.all([openDashboard({root:state,auto:true,open:false}),openDashboard({root:state,open:false})]);
    assert.ok(checks.every(x=>!x.shouldOpen&&!x.opened),'all entry points reuse the opened dashboard');
    assert.equal((await openDashboard({root:state,open:false,force:true})).shouldOpen,true);
    await stopDashboard(state);await pause(150);
  }finally{await stopDashboard(state).catch(()=>{});await rm(root,{recursive:true,force:true});}
});

test('authenticated dashboard pages suppress duplicate openings, including after a service restart',async()=>{
  const f=await fixture();const state=join(f.root,'state');let service=f.service,controller;
  try{
    const headers=await authenticate(service);const {progress}=await recording(f);await service.registry.importRoot(f.dataDir);
    const subscribe=async path=>{
      controller=new AbortController();const response=await fetch(service.url+path,{headers,signal:controller.signal});
      assert.equal(response.status,200);const reader=response.body.getReader();await reader.read();return reader;
    };
    const reader=await subscribe('/api/events');
    for(const auto of [true,false])assert.equal((await openDashboard({root:state,auto,open:false})).shouldOpen,false);
    controller.abort();await reader.cancel().catch(()=>{});
    assert.equal((await openDashboard({root:state,open:false})).shouldOpen,false,'closing or refreshing a page does not auto-open another');
    const original=service.url;await service.close();
    service=await startDashboard({root:state,port:Number(new URL(original).port),defaultDataDir:f.dataDir});
    const reconnected=await subscribe('/api/runs/run-contract/events');
    assert.equal((await openDashboard({root:state,auto:true,open:false})).shouldOpen,false,'a reconnected detail page counts as already opened');
    const forced=await internal(service,'/internal/bootstrap',{force:true,reserve:true});
    await internal(service,'/internal/opened',{lease:forced.lease,opened:false});
    assert.equal((await openDashboard({root:state,open:false})).shouldOpen,false,'a failed forced opening preserves the existing page');
    controller.abort();await reconnected.cancel().catch(()=>{});await progress.finish();
  }finally{controller?.abort();await service.close();await f.close();}
});

test('startup reclaims a dead owner lock, detects reused process identities and falls back from an occupied port',async()=>{
  const root=await mkdtemp(join(tmpdir(),'webpilot-lock-'));const occupied=createServer((req,res)=>res.end('other application'));
  await new Promise(ok=>occupied.listen(0,'127.0.0.1',ok));const port=occupied.address().port;
  let service;
  try{
    assert.equal(await ownerAlive({pid:process.pid,nonce:meta().owner.nonce,started:'a different process start'}),false);
    await mkdir(join(root,'startup.lock'));await atomicJson(join(root,'startup.lock','owner.json'),{pid:2147483647,nonce:meta().owner.nonce});
    await atomicJson(join(root,'last-port.json'),{port});
    const e=await ensureDashboard(root);assert.notEqual(Number(new URL(e.url).port),port);assert.equal(await(await fetch(`http://127.0.0.1:${port}`)).text(),'other application');
    await stopDashboard(root);await pause(150);
    service=await startDashboard({root,port,defaultDataDir:join(root,'data')});assert.notEqual(Number(new URL(service.url).port),port);
  }finally{await service?.close();await stopDashboard(root).catch(()=>{});await new Promise(ok=>occupied.close(ok));await rm(root,{recursive:true,force:true});}
});

test('coverage capability detects a legacy dashboard without replacing its live service',async()=>{
  const f=await fixture();const legacy=createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({instance:'legacy',protocolVersion:1}));});
  try{await new Promise(ok=>legacy.listen(0,'127.0.0.1',ok));const old={url:`http://127.0.0.1:${legacy.address().port}`,instance:'legacy',token:'local'};
    await assert.rejects(()=>requireCoverageDashboard(old),/更新并重启/);assert.equal((await fetch(old.url)).status,200);
    const current=await endpointAt(join(f.root,'state'));assert.equal((await requireCoverageDashboard(current)).instance,current.instance);
  }finally{await new Promise(ok=>legacy.close(ok));await f.close();}
});

test('a live incompatible service is rejected and an old service cannot delete a replacement endpoint',async()=>{
  const f=await fixture();const root=join(f.root,'state');
  try{
    const endpoint=await endpointAt(root);await atomicJson(join(root,'endpoint.json'),{...Object.fromEntries(Object.entries(endpoint).filter(([k])=>k!=='token')),protocolVersion:2});
    await assert.rejects(()=>ensureDashboard(root),/incompatible/);assert.equal((await fetch(f.service.url+'/api/health')).status,200);
    const replacement={...endpoint,instance:'00000000-0000-4000-8000-000000000002'};delete replacement.token;
    await atomicJson(join(root,'endpoint.json'),replacement);await atomicJson(join(root,'credentials.json'),{instance:replacement.instance,token:'replacement-secret'});
    await Promise.all([f.service.close(),f.service.close()]);assert.equal((await endpointAt(root)).instance,replacement.instance);
  }finally{await f.close();}
});

test('retention protects active runs, respects per-run periods, removes expired indices and leaves user files alone',async()=>{
  const f=await fixture();
  try{
    const active=await recording(f,'active-run'),ended=await recording(f,'ended-run'),long=await recording(f,'long-run');await ended.progress.finish();await long.progress.finish();
    for(const [id,days]of [['active-run',1],['ended-run',1],['long-run',30]]){const path=join(active.store.runDir(id),'.owner.json');const marker=JSON.parse(await readFile(path,'utf8'));await atomicJson(path,{...marker,retentionDays:days,createdAt:Date.now()-3*86400000});}
    const user=join(f.dataDir,'runs','user-directory');await mkdir(user);await writeFile(join(user,'notes.txt'),'keep');
    await f.service.registry.importRoot(f.dataDir);await f.service.registry.refresh();assert.equal(f.service.registry.runs.size,3);
    assert.equal(await active.store.prune(),1);await f.service.registry.refresh('ended-run');assert.equal(f.service.registry.runs.has('ended-run'),false);
    assert.equal(await readFile(join(user,'notes.txt'),'utf8'),'keep');assert.ok(await readFile(join(active.store.runDir('active-run'),'live.json')));assert.ok(await readFile(join(long.store.runDir('long-run'),'live.json')));
    await active.progress.finish();assert.equal(await active.store.prune(),1);
  }finally{await f.close();}
});

test('missing heartbeats do not imply failure and conflicting run roots cannot overwrite an existing owner',async()=>{
  const f=await fixture();
  try{
    const {progress,store}=await recording(f);await f.service.registry.importRoot(f.dataDir);await f.service.registry.refresh();
    const run=await loadRun(store.runDir('run-contract'),'run-contract',false);assert.equal(run.connection,'disconnected');assert.notEqual(run.lifecycle,'interrupted');assert.equal(run.outcome,undefined);
    const other=join(f.root,'conflict');await mkdir(other);const duplicate=await recording({...f,dataDir:other});
    await assert.rejects(()=>f.service.registry.register(other,'run-contract',duplicate.progress.meta.owner),/elsewhere/);
    assert.equal(f.service.registry.runs.get('run-contract').dir,await (await import('node:fs/promises')).realpath(store.runDir('run-contract')));
    await progress.finish();await duplicate.progress.finish();
  }finally{await f.close();}
});

test('live transport shares subscriptions, drops old epochs, rejects oversized messages and isolates slow viewers',async()=>{
  const f=await fixture();const sockets=[];
  try{
    const {progress}=await recording(f);await f.service.registry.importRoot(f.dataDir);await f.service.registry.refresh();
    const headers=await authenticate(f.service);const producer=new WebSocket(f.service.url.replace('http:','ws:')+'/internal/executors',{headers:{Authorization:`Bearer ${f.service.token}`}});sockets.push(producer);await once(producer,'open');
    const controls=[];producer.on('message',data=>controls.push(JSON.parse(data.toString())));
    producer.send(JSON.stringify({type:'register',protocolVersion:1,runId:progress.meta.id,dataDir:f.dataDir,owner:progress.meta.owner}));
    const waitFor=async(fn)=>{for(let i=0;i<100;i++){if(fn())return;await pause(20);}assert.fail('timed out waiting for live state');};await waitFor(()=>controls.length>0);
    const view=async()=>{const ws=new WebSocket(`${f.service.url.replace('http:','ws:')}/api/runs/run-contract/live`,{headers,origin:f.service.url});sockets.push(ws);const frames=[];ws.on('message',(data,binary)=>{if(binary)frames.push(decodeFrame(data).header);});await once(ws,'open');return {ws,frames};};
    const a=await view(),b=await view();await waitFor(()=>controls.at(-1)?.enabled===true);
    const header={protocolVersion:1,runId:'run-contract',pageId:'page-2',caseId:'login',attempt:2,streamEpoch:2,frameSeq:1,capturedAt:Date.now()};const jpeg=Buffer.from([255,216,255,217]);
    producer.send(encodeFrame(header,jpeg));await waitFor(()=>a.frames.length===1&&b.frames.length===1);
    producer.send(encodeFrame({...header,streamEpoch:1,frameSeq:100},jpeg));producer.send(encodeFrame(header,jpeg));producer.send(encodeFrame({...header,frameSeq:2,pageId:'page-3'},jpeg));
    await waitFor(()=>a.frames.length===2&&b.frames.length===2);assert.deepEqual(a.frames.map(h=>[h.pageId,h.attempt,h.streamEpoch,h.frameSeq]),[['page-2',2,2,1],['page-3',2,2,2]]);
    // Pause one reader while the healthy reader continues to consume large frames.
    a.ws._socket.pause();const large=Buffer.alloc(256*1024);large[0]=255;large[1]=216;
    for(let seq=3;seq<43;seq++){producer.send(encodeFrame({...header,frameSeq:seq},large));await pause(5);}
    assert.ok(b.frames.length>2);a.ws._socket.resume();a.ws.close();await once(a.ws,'close');await pause(50);assert.equal(controls.at(-1).enabled,true);
    b.ws.close();await once(b.ws,'close');await waitFor(()=>controls.at(-1).enabled===false);
    producer.send(Buffer.alloc(2097153));await once(producer,'close');await progress.finish();
  }finally{for(const socket of sockets)socket.terminate();await f.close();}
});

test('CLI management and run options keep JSON stdout independent of dashboard diagnostics',async()=>{
  const root=await mkdtemp(join(tmpdir(),'webpilot-cli-dashboard-'));const state=join(root,'state'),data=join(root,'data');await mkdir(data);
  const cli=(...args)=>promisify(execFile)(process.execPath,['dist/cli/index.js',...args,'--dashboard-dir',state],{cwd:resolve('.'),env:{...process.env,WEBPILOT_DASHBOARD:'1',WEBPILOT_DATA_DIR:data},timeout:20000});
  try{
    assert.equal(JSON.parse((await cli('dashboard','status')).stdout).running,false);
    const opened=JSON.parse((await cli('dashboard','open','--no-open')).stdout);assert.equal(opened.opened,false);assert.ok(opened.dashboardUrl.includes('#access='));
    assert.equal(JSON.parse((await cli('dashboard','status')).stdout).running,true);assert.equal(JSON.parse((await cli('dashboard','import','--data-dir',data)).stdout).imported,0);
    const planFile=join(root,'plan.json');await writeFile(planFile,JSON.stringify({schemaVersion:1,id:'cli-plan',scope:['Unavailable target'],target:{url:'http://127.0.0.1:1'},cases:[{schemaVersion:1,id:'unavailable',version:1,title:'Unavailable',steps:[{id:'visible',op:'expectVisible',locator:{kind:'role',value:'heading'},source:{type:'user',reference:'explicit fixture'}}]}]}));
    for(const flag of ['--no-open','--no-dashboard']){
      let result;try{result=await cli('run','--plan',planFile,flag);}catch(error){result=error;}
      const run=JSON.parse(result.stdout);assert.ok(['blocked','inconclusive','failed'].includes(run.outcome));assert.equal(result.code,run.exitCode);
      if(flag==='--no-open')assert.match(result.stderr,/WebPilot 测试中心：http/);else assert.doesNotMatch(result.stderr,/测试中心：http/);
    }
    assert.equal(JSON.parse((await cli('dashboard','stop')).stdout).stopped,true);
  }finally{await stopDashboard(state).catch(()=>{});await rm(root,{recursive:true,force:true});}
});
