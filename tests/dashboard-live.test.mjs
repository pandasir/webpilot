import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {BrowserSession} from '../dist/browser/session.js';
import {Screencast} from '../dist/browser/screencast.js';
import {TargetSchema} from '../dist/core/schema.js';
import {Budget} from '../dist/core/budget.js';
import {Progress} from '../dist/core/progress.js';
import {Store} from '../dist/artifacts/store.js';
import {Redactor} from '../dist/artifacts/redaction.js';
import {startDashboard} from '../dist/dashboard/server.js';
import {internal} from '../dist/dashboard/lifecycle.js';
import {decodeFrame} from '../dist/dashboard/protocol.js';
import {fixture} from './helpers.mjs';

const pause=ms=>new Promise(ok=>setTimeout(ok,ms));
async function until(fn){for(let i=0;i<150;i++){if(await fn())return;await pause(20);}assert.fail('live condition not reached');}

test('demand-driven real CDP streams follow selected pages and attempts, release sources and honor live:false without video', {timeout:30000},async()=>{
  const previous=process.env.WEBPILOT_DASHBOARD;process.env.WEBPILOT_DASHBOARD='1';
  const root=await mkdtemp(join(tmpdir(),'webpilot-cast-'));const data=join(root,'data');await mkdir(data);
  const target=await fixture();const server=await startDashboard({root:join(root,'state'),port:0,defaultDataDir:data});const store=new Store(data);const sessions=[],progresses=[],viewers=[];
  try{
    const ticket=await internal({url:server.url,token:server.token},'/internal/bootstrap',{});const response=await fetch(server.url+'/api/session',{method:'POST',headers:{Origin:server.url,'Content-Type':'application/json'},body:JSON.stringify({token:ticket.token})});const cookie=response.headers.get('set-cookie').split(';')[0];
    async function setup(id,live){
      const config=TargetSchema.parse({url:target.url,viewport:{width:1600,height:1000},evidence:{video:false,live},budget:{totalMs:20000,assertionMs:3000}});
      await store.beginRun(id);const progress=await Progress.create(store.runDir(id),data,{id,title:id,target:target.url,mode:'suite',startedAt:new Date().toISOString(),cases:[{id:'case',version:1,title:'case'}],live},new Redactor(),{dashboard:true,dashboardRoot:join(root,'state')});progresses.push(progress);
      const session=new BrowserSession(config,new Budget(config.budget));sessions.push(session);await progress.attach(session,'case',1);await session.open();await until(()=>server.registry.runs.has(id));return {session,progress};
    }
    async function watch(id){const ws=new WebSocket(`${server.url.replace('http:','ws:')}/api/runs/${id}/live`,{headers:{Cookie:cookie},origin:server.url});viewers.push(ws);const frames=[],messages=[];ws.on('message',(data,binary)=>{if(binary)frames.push(decodeFrame(data));else messages.push(JSON.parse(data.toString()));});await once(ws,'open');return {ws,frames,messages};}
    const {session,progress}=await setup('watched-run',true);
    let sources=0,detached=0;const original=session.context.newCDPSession.bind(session.context);
    session.context.newCDPSession=async page=>{sources++;const cdp=await original(page);const detach=cdp.detach.bind(cdp);cdp.detach=async()=>{detached++;return detach();};return cdp;};
    await pause(200);assert.equal(sources,0);const viewport=session.page.viewportSize();
    const a=await watch('watched-run');await until(()=>a.frames.length>0);assert.equal(sources,1);
    const dimensions=await session.page.evaluate(async base64=>{const image=await createImageBitmap(await(await fetch('data:image/jpeg;base64,'+base64)).blob());return {width:image.width,height:image.height};},a.frames[0].jpeg.toString('base64'));assert.ok(dimensions.width<=1280&&dimensions.height<=720);
    const b=await watch('watched-run');await pause(200);assert.equal(sources,1);assert.deepEqual(session.page.viewportSize(),viewport);
    const before=a.frames.length;await session.page.getByLabel('Search',{exact:true}).fill('Orange');await until(()=>a.frames.length>before);assert.equal(await session.page.locator('li:visible').textContent(),'Orange');
    const epoch=a.frames.at(-1).header.streamEpoch,oldPage=a.frames.at(-1).header.pageId;
    const popup=await session.context.newPage();await popup.goto(target.url+'/extra');session.page=popup;
    await until(()=>a.frames.some(f=>f.header.streamEpoch>epoch));assert.notEqual(a.frames.at(-1).header.pageId,oldPage);
    const pageEpoch=a.frames.at(-1).header.streamEpoch;await progress.attach(session,'case',2);
    await until(()=>a.frames.some(f=>f.header.attempt===2));assert.ok(a.frames.at(-1).header.streamEpoch>pageEpoch);assert.equal(a.frames.at(-1).header.pageId,session.pageIdentity());
    a.ws.close();await once(a.ws,'close');await pause(100);assert.equal(sources-detached,1);
    b.ws.close();await once(b.ws,'close');await until(()=>sources===detached);
    const count=a.frames.length;await popup.getByLabel('Search',{exact:true}).fill('Apple');await pause(200);assert.equal(a.frames.length,count);assert.equal(session.recordings.length,0);
    await progress.finish();await session.close();assert.equal(sources,detached);
    const disabled=await setup('disabled-run',false);let disabledSources=0;disabled.session.context.newCDPSession=async()=>{disabledSources++;throw new Error('must not capture');};const off=await watch('disabled-run');await pause(300);assert.equal(disabledSources,0);assert.equal(off.frames.length,0);assert.ok(off.messages.some(m=>/关闭直播/.test(m.message)));
    await disabled.progress.finish();await disabled.session.close();
    const messages=[];const cast=new Screencast(()=>assert.fail('unsupported CDP produced a frame'),message=>messages.push(message),()=>({protocolVersion:1,runId:'unsupported'}),()=>1);
    await cast.start({context:()=>({newCDPSession:async()=>{throw new Error('unavailable');}})},'page-1');assert.match(messages[0],/暂不可用/);await cast.stop();
  }finally{for(const ws of viewers)ws.terminate();for(const p of progresses)await p.finish();for(const session of sessions)await session.close();await server.close();await target.close();await rm(root,{recursive:true,force:true});if(previous===undefined)delete process.env.WEBPILOT_DASHBOARD;else process.env.WEBPILOT_DASHBOARD=previous;}
});
