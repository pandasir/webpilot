import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,lstat,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TitleSchema,explorationTitle} from '../dist/core/titles.js';
import {TargetSchema} from '../dist/core/schema.js';
import {ToolInputs,WebPilotService,dispatch} from '../dist/core/service.js';
import {Store} from '../dist/artifacts/store.js';
import {Redactor} from '../dist/artifacts/redaction.js';
import {Progress} from '../dist/core/progress.js';
import {renameRun,changeManagement,managementState} from '../dist/artifacts/management.js';
import {loadRun} from '../dist/dashboard/projection.js';
import {startDashboard} from '../dist/dashboard/server.js';
import {internal} from '../dist/dashboard/lifecycle.js';
import {fixture} from './helpers.mjs';

async function setup(){const root=await mkdtemp(join(tmpdir(),'pilot-titles-')),data=join(root,'data');await mkdir(data);return {root,data,store:new Store(data)};}
async function seed(f,id='test',extra={}){await f.store.beginRun(id);const dir=f.store.runDir(id),progress=await Progress.create(dir,f.data,{id,title:'浏览器探索会话',mode:'exploration',target:'https://example.com/download?token=hidden',startedAt:new Date().toISOString(),cases:[],live:false,...extra},new Redactor(),{dashboard:false});return {dir,progress};}
async function authenticate(service){const {token}=await internal(service,'/internal/bootstrap',{});const res=await fetch(service.url+'/api/session',{method:'POST',headers:{Origin:service.url,'Content-Type':'application/json'},body:JSON.stringify({token})});return {Cookie:res.headers.get('set-cookie').split(';')[0],Origin:service.url,'Content-Type':'application/json'};}

test('title contracts normalize names and defaults use project or host without URL secrets',()=>{
 assert.equal(TitleSchema.parse('  验证下载流程  '),'验证下载流程');for(const title of ['', ' ', 'a'.repeat(121),'abc\u0000def','abc\u202edef'])assert.equal(TitleSchema.safeParse(title).success,false);
 assert.equal(ToolInputs.session_open.parse({target:{}}).title,undefined);assert.equal(ToolInputs.session_open.parse({target:{},title:'验证下载'}).title,'验证下载');
 assert.equal(explorationTitle({projectPath:'/Users/a/projects/store/',url:'https://example.com/a?token=secret'}),'store · 浏览器探索');assert.equal(explorationTitle({projectPath:'C:\\projects\\shop',url:'https://example.com'}),'shop · 浏览器探索');assert.equal(explorationTitle({url:'https://example.com/download?token=secret#private'}),'example.com · 浏览器探索');assert.equal(explorationTitle({url:'http://localhost:1234/a'}),'localhost:1234 · 浏览器探索');assert.equal(explorationTitle({}),'浏览器探索会话');
});

test('task names remain stable, target defaults resolve and legacy records retain original files',async()=>{
 const f=await setup();try{
  const named=await seed(f,'named',{title:'验证 secret-value 下载',titleSource:'task'});await named.progress.target(TargetSchema.parse({url:'https://other.example/a'}));assert.equal(named.progress.meta.title,'验证 secret-value 下载');await named.progress.finish();
  const auto=await seed(f,'auto',{titleSource:'target'});await auto.progress.target(TargetSchema.parse({url:'https://resolved.example/a?token=hidden'}));assert.equal(auto.progress.meta.title,'resolved.example · 浏览器探索');await auto.progress.finish();
  const legacy=await seed(f,'legacy');await legacy.progress.finish();const original=await readFile(join(legacy.dir,'live.json'),'utf8');assert.equal((await loadRun(legacy.dir,'legacy')).meta.title,'example.com · 浏览器探索');assert.equal(await readFile(join(legacy.dir,'live.json'),'utf8'),original);
  const suite=await seed(f,'suite',{mode:'suite',title:'订单回归、登录校验'});await suite.progress.finish();assert.equal((await loadRun(suite.dir,'suite')).meta.title,'订单回归、登录校验');
 }finally{await rm(f.root,{recursive:true,force:true});}
});

test('session_open persists the redacted task title and omitted title stays backward compatible',async()=>{
 const f=await fixture(),service=new WebPilotService(f.dataDir);try{
  const named=await dispatch(service,'session_open',{target:{url:f.url,evidence:{live:false}},title:'验证 secret-value 下载',bindings:{secret:'secret-value'}});const dir=service.store.runDir(named.runId);const live=JSON.parse(await readFile(join(dir,'live.json'),'utf8'));assert.equal(live.title,'验证 [REDACTED] 下载');assert.equal(live.titleSource,'task');await service.close(named.sessionId);assert.equal(JSON.parse(await readFile(join(dir,'session.json'),'utf8')).title,live.title);
  const auto=await dispatch(service,'session_open',{target:{url:f.url,evidence:{live:false}}});await service.close(auto.sessionId);assert.equal((await loadRun(service.store.runDir(auto.runId),auto.runId)).meta.title,`${new URL(f.url).host} · 浏览器探索`);
  await assert.rejects(()=>dispatch(service,'session_open',{target:{url:f.url},title:' '}));
 }finally{await service.closeAll();await f.close();}
});

test('rename is independent of execution and retention, idempotent, confined and coordinated with deletion',async()=>{
 const f=await setup();try{
  const {dir,progress}=await seed(f);const liveBefore=await readFile(join(dir,'live.json'),'utf8');await renameRun(f.data,'test','检查下载');assert.equal(await readFile(join(dir,'live.json'),'utf8'),liveBefore);const titleBefore=await readFile(join(dir,'title.json'),'utf8');await renameRun(f.data,'test','检查下载');assert.equal(await readFile(join(dir,'title.json'),'utf8'),titleBefore);
  await progress.target(TargetSchema.parse({url:'https://changed.example'}));await progress.finish();const eventsBefore=await readFile(join(dir,'events.jsonl'),'utf8');assert.equal((await loadRun(dir,'test')).meta.title,'检查下载');await changeManagement(f.data,'test','archive');await renameRun(f.data,'test','归档后的下载验证');assert.ok((await managementState(dir)).archivedAt);assert.equal((await managementState(dir)).keepForever,true);assert.equal(await readFile(join(dir,'events.jsonl'),'utf8'),eventsBefore);
  const outside=join(f.root,'outside');await mkdir(outside);await symlink(outside,f.store.runDir('unowned'));await assert.rejects(()=>renameRun(f.data,'unowned','拒绝越界'));await assert.rejects(()=>lstat(join(outside,'title.json')),{code:'ENOENT'});
  await Promise.allSettled([renameRun(f.data,'test','并发名称'),changeManagement(f.data,'test','delete')]);await assert.rejects(()=>renameRun(f.data,'test','不能复活'));await assert.rejects(()=>lstat(dir),{code:'ENOENT'});
 }finally{await rm(f.root,{recursive:true,force:true});}
});

test('authenticated title API synchronizes state, search and restart and rejects invalid input and deleted runs',async()=>{
 const f=await setup();let service;try{
  const {dir,progress}=await seed(f);service=await startDashboard({root:join(f.root,'state'),port:0,defaultDataDir:f.data});let headers=await authenticate(service);const request=(path,method='GET',body,overrides={})=>fetch(service.url+path,{method,headers:{...headers,...overrides},body:body===undefined?undefined:JSON.stringify(body)});
  assert.equal((await request('/api/runs/test/title','POST',{title:'拒绝'},{Cookie:''})).status,401);assert.equal((await request('/api/runs/test/title','POST',{title:'拒绝'},{Origin:'https://foreign.example'})).status,401);
  for(const body of [{title:''},{title:'a'.repeat(121)},{title:'bad\u0000title'},{title:'拒绝路径',path:'/tmp/outside'}])assert.equal((await request('/api/runs/test/title','POST',body)).status,400);
  const response=await request('/api/runs/test/events'),reader=response.body.getReader();await reader.read();assert.equal((await request('/api/runs/test/title','POST',{title:'验证订单列表'})).status,200);assert.match(new TextDecoder().decode((await reader.read()).value),/验证订单列表/);await reader.cancel();assert.equal((await (await request('/api/runs?project='+encodeURIComponent('订单列表'))).json()).total,1);await progress.finish();await service.registry.refresh('test');assert.equal((await (await request('/api/runs/test')).json()).meta.title,'验证订单列表');
  await service.close();service=await startDashboard({root:join(f.root,'state'),port:0,defaultDataDir:f.data});headers=await authenticate(service);assert.equal((await (await request('/api/runs/test')).json()).meta.title,'验证订单列表');await writeFile(join(dir,'title.json'),'broken');await service.registry.refresh('test');const broken=await(await request('/api/runs/test')).json();assert.equal(broken.meta.title,'example.com · 浏览器探索');assert.match(broken.logGap,/自定义标题不可读取/);assert.equal((await request('/api/runs/test/title','POST',{title:'修复名称'})).status,200);
  await service.registry.manage('test','delete');assert.equal((await request('/api/runs/test/title','POST',{title:'不可恢复'})).status,410);
 }finally{await service?.close();await rm(f.root,{recursive:true,force:true});}
});
