import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,lstat,symlink,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Store} from '../dist/artifacts/store.js';
import {Progress} from '../dist/core/progress.js';
import {Redactor} from '../dist/artifacts/redaction.js';
import {changeManagement,managementState,managementView,withRunLock,resumeDeletions} from '../dist/artifacts/management.js';
import {atomicJson,processStamp} from '../dist/dashboard/files.js';
import {startDashboard} from '../dist/dashboard/server.js';
import {internal} from '../dist/dashboard/lifecycle.js';
import {loadRun,publicRun} from '../dist/dashboard/projection.js';
import {LiveRunSchema} from '../dist/dashboard/protocol.js';

async function fixture(){const root=await mkdtemp(join(tmpdir(),'pilot-management-'));const data=join(root,'data');await mkdir(data);return {root,data,store:new Store(data)};}
async function record(f,id='ended',finish=true){await f.store.beginRun(id);const dir=f.store.runDir(id);const p=await Progress.create(dir,f.data,{id,title:`运行 ${id}`,mode:'exploration',target:'http://localhost',startedAt:new Date().toISOString(),cases:[],live:false},new Redactor(),{dashboard:false});if(finish){await writeFile(join(dir,'session.json'),JSON.stringify({runId:id,closed:true,steps:[]}));await p.finish();}return {dir,p};}
async function old(dir){const path=join(dir,'.owner.json');await atomicJson(path,{...JSON.parse(await readFile(path,'utf8')),createdAt:Date.now()-90*86400000});}
async function auth(service){const {token}=await internal(service,'/internal/bootstrap',{});const res=await fetch(service.url+'/api/session',{method:'POST',headers:{Origin:service.url,'Content-Type':'application/json'},body:JSON.stringify({token})});return {Cookie:res.headers.get('set-cookie').split(';')[0],Origin:service.url,'Content-Type':'application/json'};}

async function legacy(f,id){await f.store.beginRun(id);const dir=f.store.runDir(id),video=join(dir,'videos','exploration','1','old.webm');await mkdir(join(dir,'videos','exploration','1'),{recursive:true});await writeFile(video,'finalized-video');const session={schemaVersion:1,sessionId:'session-old',runId:id,steps:[],recordings:[{pageId:'page-1',pageName:'main',status:'available',path:video,sensitive:true,redacted:false}]};await atomicJson(join(dir,'session.json'),session);return {dir,session,video};}

test('legacy finalized exploration can archive, restore and delete without a fabricated owner or dates',async()=>{
 const f=await fixture();try{const {dir,session}=await legacy(f,'legacy');const state=await loadRun(dir,'legacy');LiveRunSchema.parse(publicRun(state));assert.equal(state.lifecycle,'historical');assert.equal(state.meta.owner,undefined);assert.equal(state.meta.startedAt,'');assert.equal(state.finishedAt,undefined);assert.equal(state.outcome,undefined);assert.equal((await managementView(dir)).allowed,true);
 assert.equal((await changeManagement(f.data,'legacy','archive')).status,'archived');assert.equal((await changeManagement(f.data,'legacy','restore')).status,'restored');assert.equal((await managementState(dir)).keepForever,true);assert.deepEqual(JSON.parse(await readFile(join(dir,'session.json'),'utf8')),session);assert.equal((await changeManagement(f.data,'legacy','delete')).status,'deleted');await assert.rejects(()=>lstat(dir),{code:'ENOENT'});
 const closed=await legacy(f,'closed');await atomicJson(join(closed.dir,'session.json'),{runId:'closed',steps:[],closed:true});assert.equal((await managementView(closed.dir)).allowed,true);
 }finally{await rm(f.root,{recursive:true,force:true});}
});

test('legacy compatibility never bypasses active, unknown, damaged or unsafe execution evidence',async()=>{
 const f=await fixture();try{
  for(const kind of ['open','no-recording','missing-video','empty-video','outside-video','symlink-video','bad-session','bad-live','events','bad-events','live-owner']){
   const {dir,session,video}=await legacy(f,kind);
   if(kind==='open')session.closed=false;
   if(kind==='no-recording')session.recordings=[];
   if(kind==='missing-video')await rm(video);
   if(kind==='empty-video')await writeFile(video,'');
   if(kind==='outside-video')session.recordings[0].path=join(f.root,'outside.webm');
   if(kind==='symlink-video'){await writeFile(join(f.root,'outside.webm'),'outside');await rm(video);await symlink(join(f.root,'outside.webm'),video);}
   if(kind==='bad-session')session.steps='broken';
   if(kind==='bad-live')await writeFile(join(dir,'live.json'),'broken');
   if(kind==='events')await writeFile(join(dir,'events.jsonl'),'');
   if(kind==='bad-events')await writeFile(join(dir,'events.jsonl'),'broken\n');
   if(kind==='live-owner'){const live=await record(f,'owner-reference',false);await atomicJson(join(dir,'live.json'),{...live.p.meta,id:kind});await live.p.finish();}
   await atomicJson(join(dir,'session.json'),session);
   for(const action of ['archive','restore','delete'])assert.equal((await changeManagement(f.data,kind,action)).status,'error',`${kind}: ${action}`);
   assert.ok(await lstat(dir));
  }
 }finally{await rm(f.root,{recursive:true,force:true});}
});

test('archive, restore and undo retain all files forever, even explicit prune; ordinary runs still expire',async()=>{
 const f=await fixture();try{const {dir}=await record(f);const normal=await record(f,'normal');await old(dir);await old(normal.dir);await writeFile(join(dir,'evidence.bin'),'keep');const before=await readFile(join(dir,'events.jsonl'),'utf8');
 assert.equal((await changeManagement(f.data,'ended','archive')).status,'archived');const a=await managementState(dir);assert.ok(a.archivedAt);assert.equal((await changeManagement(f.data,'ended','archive')).status,'archived');assert.deepEqual(await managementState(dir),a);
 assert.equal(await f.store.prune(1),1);assert.equal(await readFile(join(dir,'evidence.bin'),'utf8'),'keep');
 assert.equal((await changeManagement(f.data,'ended','restore')).status,'restored');assert.equal((await managementState(dir)).archivedAt,undefined);assert.equal((await managementState(dir)).keepForever,true);assert.equal(await f.store.prune(),0);assert.equal(await readFile(join(dir,'events.jsonl'),'utf8'),before);
 }finally{await rm(f.root,{recursive:true,force:true});}
});

test('damaged policies fail closed and active or unknown executors cannot be managed',async()=>{
 const f=await fixture();try{const {dir,p}=await record(f,'active',false);await old(dir);for(const action of ['archive','restore','delete'])assert.equal((await changeManagement(f.data,'active',action)).status,'error');assert.equal(await f.store.prune(1),0);await p.finish();await writeFile(join(dir,'management.json'),'broken');assert.equal(await f.store.prune(1),0);assert.equal((await changeManagement(f.data,'active','delete')).status,'error');
 }finally{await rm(f.root,{recursive:true,force:true});}
});

test('confirmed exited executors may be managed and symlink substitutions are refused',async()=>{
 const f=await fixture();try{const {dir}=await record(f,'dead',false);const m=JSON.parse(await readFile(join(dir,'live.json'),'utf8'));await atomicJson(join(dir,'live.json'),{...m,owner:{...m.owner,pid:2147483647}});assert.equal((await managementView(dir)).allowed,true);assert.equal((await changeManagement(f.data,'dead','archive')).status,'archived');
 await rename(dir,join(f.root,'outside'));await symlink(join(f.root,'outside'),dir);assert.equal((await changeManagement(f.data,'dead','delete')).status,'error');assert.ok(await lstat(join(f.root,'outside','live.json')));
 }finally{await rm(f.root,{recursive:true,force:true});}
});

test('per-run locks serialize separate processes and reclaim only provably dead owners',async()=>{
 const f=await fixture();try{await record(f);const stamp=await processStamp();const lock=join(f.data,'.run-management','ended.lock');await mkdir(lock,{recursive:true});await atomicJson(join(lock,'owner.json'),{pid:2147483647,nonce:'00000000-0000-4000-8000-000000000001',started:stamp});
 await withRunLock(f.data,'ended',async()=>{});
 const script=`import {withRunLock} from './dist/artifacts/management.js';import {appendFile} from 'node:fs/promises';await withRunLock(process.env.TEST_ROOT,'ended',async()=>{await appendFile(process.env.TEST_LOG,'start\\n');await new Promise(r=>setTimeout(r,80));await appendFile(process.env.TEST_LOG,'end\\n');});`;
 const run=()=>promisify(execFile)(process.execPath,['--input-type=module','-e',script],{cwd:resolve('.'),env:{...process.env,TEST_ROOT:f.data,TEST_LOG:join(f.root,'log')}});await Promise.all([run(),run()]);assert.equal(await readFile(join(f.root,'log'),'utf8'),'start\nend\nstart\nend\n');
 await mkdir(lock);await atomicJson(join(lock,'owner.json'),{pid:process.pid,nonce:'00000000-0000-4000-8000-000000000002'});await assert.rejects(()=>withRunLock(f.data,'ended',async()=>{}),/正忙/);
 }finally{await rm(f.root,{recursive:true,force:true});}
});

test('archive and prune race yields either retained success or explicit unavailable result',async()=>{
 const f=await fixture();try{for(let i=0;i<5;i++){const id=`race-${i}`;const {dir}=await record(f,id);await old(dir);const [archive]=await Promise.all([changeManagement(f.data,id,'archive'),f.store.prune(1)]);if(archive.status==='archived')assert.equal((await managementState(dir)).keepForever,true);else assert.equal(archive.status,'error');}}
 finally{await rm(f.root,{recursive:true,force:true});}
});

test('irreversible deletion removes only selected run and retry is idempotent',async()=>{
 const f=await fixture();try{const {dir}=await record(f);await record(f,'other');await mkdir(join(f.data,'cases'));await writeFile(join(f.data,'cases','saved.json'),'case');await writeFile(join(dir,'sensitive-trace.zip'),'trace');await mkdir(join(dir,'videos'));await writeFile(join(dir,'videos','test.webm'),'video');
 assert.equal((await changeManagement(f.data,'ended','delete')).status,'deleted');await assert.rejects(()=>lstat(dir),{code:'ENOENT'});assert.equal((await changeManagement(f.data,'ended','delete')).status,'deleted');assert.equal(await readFile(join(f.data,'cases','saved.json'),'utf8'),'case');assert.ok(await lstat(f.store.runDir('other')));
 }finally{await rm(f.root,{recursive:true,force:true});}
});

test('pending deletion survives failure and resumes without resurrecting evidence',async()=>{
 const f=await fixture();try{const {dir}=await record(f);await mkdir(join(f.data,'.run-management'));const intent={schemaVersion:1,id:'ended',operation:'00000000-0000-4000-8000-000000000003',status:'pending'};await atomicJson(join(f.data,'.run-management','ended.delete.json'),intent);
 const staging=join(f.data,'.run-management',`ended.${intent.operation}.purge`);await mkdir(staging);assert.equal((await changeManagement(f.data,'ended','delete')).status,'cleanup_pending');assert.ok(await lstat(dir));await rm(staging,{recursive:true});await resumeDeletions(f.data);await assert.rejects(()=>lstat(dir),{code:'ENOENT'});assert.equal(JSON.parse(await readFile(join(f.data,'.run-management','ended.delete.json'),'utf8')).status,'deleted');
 }finally{await rm(f.root,{recursive:true,force:true});}
});

test('management API checks confirmation, sources and eligibility; batch scope, restart and deletion SSE agree',async()=>{
 const f=await fixture();let service;try{await record(f);await record(f,'other');await record(f,'active',false);service=await startDashboard({root:join(f.root,'state'),port:0,defaultDataDir:f.data});let headers=await auth(service);
 const request=(path,method='GET',body,override={})=>fetch(service.url+path,{method,headers:{...headers,...override},body:body===undefined?undefined:JSON.stringify(body)});
 assert.equal((await request('/api/runs/ended','DELETE',{})).status,400);assert.equal((await request('/api/runs/ended/archive','POST',{}, {Origin:'https://evil.test'})).status,401);
 const batch=await (await request('/api/runs/manage','POST',{action:'archive',ids:['ended','other','active']})).json();assert.deepEqual(batch.results.map(r=>r.status),['archived','archived','error']);
 let list=await (await request('/api/runs')).json();assert.equal(list.total,1);assert.equal(list.summary.active,1);assert.equal((await (await request('/api/runs?scope=archived')).json()).total,2);
 const events=await request('/api/runs/ended/events');const reader=events.body.getReader();await reader.read();
 const deleted=await (await request('/api/runs/ended','DELETE',{confirmPermanent:true})).json();assert.equal(deleted.results[0].status,'deleted');const notification=await reader.read();assert.match(new TextDecoder().decode(notification.value),/event: deleted/);await reader.cancel();assert.equal((await request('/api/runs/ended')).status,410);
 const root=service.registry.root;await service.close();await rm(join(root,'registry.json'));service=await startDashboard({root,port:0,defaultDataDir:f.data});headers=await auth(service);
 assert.equal((await (await request('/api/runs?scope=archived')).json()).total,1);assert.equal((await request('/api/runs/ended')).status,410);assert.equal((await (await request('/api/runs/ended','DELETE',{confirmPermanent:true})).json()).results[0].status,'deleted');
 }finally{await service?.close();await rm(f.root,{recursive:true,force:true});}
});

test('a conflicting root cannot redirect later management to another run',async()=>{
 const f=await fixture();let service;try{await record(f);const other=join(f.root,'duplicate');await mkdir(other);const duplicate={...f,data:other,store:new Store(other)};await record(duplicate);service=await startDashboard({root:join(f.root,'state'),port:0,defaultDataDir:f.data});await service.registry.importRoot(other);assert.equal((await service.registry.manage('ended','delete')).status,'deleted');assert.ok(await lstat(duplicate.store.runDir('ended')));await assert.rejects(()=>lstat(f.store.runDir('ended')),{code:'ENOENT'});
 }finally{await service?.close();await rm(f.root,{recursive:true,force:true});}
});

test('cleanup resumes after partial rm removed the marker, without claiming an unowned directory',async()=>{
 const f=await fixture();try{const {dir}=await record(f);const stat=await lstat(dir);await mkdir(join(f.data,'.run-management'));const intent={schemaVersion:1,id:'ended',operation:'00000000-0000-4000-8000-000000000005',status:'pending',device:stat.dev,inode:stat.ino};await atomicJson(join(f.data,'.run-management','ended.delete.json'),intent);const staging=join(f.data,'.run-management',`ended.${intent.operation}.purge`);await rename(dir,staging);await rm(join(staging,'.owner.json'));await resumeDeletions(f.data);await assert.rejects(()=>lstat(staging),{code:'ENOENT'});assert.equal((await changeManagement(f.data,'ended','delete')).status,'deleted');
 }finally{await rm(f.root,{recursive:true,force:true});}
});
