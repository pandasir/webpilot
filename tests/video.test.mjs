import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat,access,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {runPlan} from '../dist/core/runner.js';
import {TargetSchema,StepSchema} from '../dist/core/schema.js';
import {BrowserSession} from '../dist/browser/session.js';
import {Budget} from '../dist/core/budget.js';
import {Store} from '../dist/artifacts/store.js';
import {WebPilotService,dispatch} from '../dist/core/service.js';
import {exportPlan} from '../dist/artifacts/export.js';
import {fixture,plan,loginSteps,selector,role,source} from './helpers.mjs';

async function assertVideo(recording){
  assert.equal(recording.status,'available',JSON.stringify(recording));
  assert.equal(recording.sensitive,true);assert.equal(recording.redacted,false);
  const bytes=await readFile(recording.path);
  assert.equal(bytes.subarray(0,4).toString('hex'),'1a45dfa3');
  if(process.platform!=='win32')assert.equal((await stat(recording.path)).mode & 0o777,0o600);
}
test('default videos play locally and survive successful, failed and retried attempts',async()=>{
  const f=await fixture();let browser;
  try{
    assert.equal(TargetSchema.parse({url:f.url}).evidence.video,true);
    const good=await runPlan(plan(f.url,loginSteps()),{dataDir:f.dataDir});
    assert.equal(good.exitCode,0);await assertVideo(good.cases[0].attempts[0].recordings[0]);
    const store=new Store(f.dataDir);
    const persisted=await store.readRun(good.id);assert.equal(persisted.playbackPath,good.playbackPath);
    assert.equal(JSON.parse(await readFile(join(store.runDir(good.id),'.owner.json'),'utf8')).sensitiveVideo,true);
    const md=await readFile(join(store.runDir(good.id),'report.md'),'utf8');assert.ok(md.includes(good.playbackPath));assert.ok(md.includes(good.cases[0].attempts[0].recordings[0].path));
    browser=await chromium.launch();const page=await browser.newPage();await page.goto(pathToFileURL(good.playbackPath).href);
    await page.locator('video').evaluate(video=>new Promise((resolve,reject)=>{
      if(video.readyState>=1)return resolve();
      const timer=setTimeout(()=>reject(new Error('Video metadata did not load')),5000);
      video.addEventListener('loadedmetadata',()=>{clearTimeout(timer);resolve();},{once:true});
      video.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('Video playback error'));},{once:true});
    }));
    assert.ok(await page.locator('video').evaluate(video=>video.videoWidth>0 && video.videoHeight>0));
    await page.locator('video').evaluate(async video=>{video.muted=true;await video.play();});
    await page.waitForFunction(()=>document.querySelector('video').currentTime>0);
    const failed=await runPlan(plan(f.url+'/?defect=message',loginSteps()),{dataDir:f.dataDir});assert.equal(failed.outcome,'failed');await assertVideo(failed.cases[0].attempts[0].recordings[0]);
    const retried=await runPlan(plan(f.url+'/retry',[{id:'title',op:'expectText',locator:selector('h1'),expected:'Test frontend',source}],{budget:{attempts:2}}),{dataDir:f.dataDir});
    assert.equal(retried.unstable,true);assert.deepEqual(retried.cases[0].attempts.map(a=>a.outcome),['failed','passed']);
    const paths=new Set();for(const a of retried.cases[0].attempts){await assertVideo(a.recordings[0]);paths.add(a.recordings[0].path);}assert.equal(paths.size,2);
    await store.prune(1,Date.now()+2*86400000);await assert.rejects(()=>access(good.playbackPath));
  }finally{await browser?.close();await f.close();}
});
test('popup pages, explicitly disabled recording and old reports remain supported',async()=>{
  const f=await fixture();try{
    const run=await runPlan(plan(f.url,[{id:'popup',op:'openPage',locator:role('link','Open page'),name:'extra'},{id:'url',op:'expectURL',expected:'/extra',source}]),{dataDir:f.dataDir});
    assert.equal(run.exitCode,0);const recordings=run.cases[0].attempts[0].recordings;
    assert.deepEqual(recordings.map(v=>v.pageName),['main','extra']);for(const r of recordings)await assertVideo(r);
    const off=await runPlan(plan(f.url,loginSteps(),{target:{evidence:{video:false}}}),{dataDir:f.dataDir});assert.equal(off.exitCode,0);assert.equal(off.playbackPath,undefined);
    assert.deepEqual(off.cases[0].attempts[0].recordings,[]);assert.ok(!(await readdir(new Store(f.dataDir).runDir(off.id))).includes('videos'));
    const old=structuredClone(off);delete old.playbackPath;for(const a of old.cases[0].attempts)delete a.recordings;
    await writeFile(join(new Store(f.dataDir).runDir(old.id),'report.json'),JSON.stringify(old));assert.equal((await new Store(f.dataDir).readRun(old.id)).id,old.id);
  }finally{await f.close();}
});
test('recording storage and finalization failures remain evidence gaps',async()=>{
  const f=await fixture();let session;
  try{
    const store=new Store(f.dataDir);await store.beginRun('run-video-error');
    await writeFile(join(store.runDir('run-video-error'),'videos'),'file instead of directory');
    const run=await runPlan(plan(f.url,[{id:'title',op:'expectText',locator:selector('h1'),expected:'Test frontend',source}]),{dataDir:f.dataDir});assert.equal(run.outcome,'passed');
    const target=TargetSchema.parse({url:f.url});session=new BrowserSession(target,new Budget(target.budget));
    await session.open({recordingDir:join(store.runDir('run-video-error'),'videos')});
    await session.perform(StepSchema.parse({id:'title',op:'expectText',locator:selector('h1'),expected:'Test frontend',source}));await session.close();
    assert.equal(session.recordings[0].status,'omitted');assert.ok(session.recordings[0].reason.includes('录像目录不可用'));
    session=new BrowserSession(target,new Budget(target.budget));await session.open({recordingDir:join(f.dataDir,'finalization')});
    session.page.video().path=async()=>{throw new Error('simulated video finalization failure');};await session.close();
    assert.equal(session.recordings[0].status,'omitted');assert.ok(session.recordings[0].reason.includes('simulated'));
  }finally{await session?.close();await f.close();}
});
test('unavailable recording runtime does not block formal assertions',async t=>{
  const f=await fixture();const launch=chromium.launch.bind(chromium);
  try{
    t.mock.method(chromium,'launch',async options=>{
      const browser=await launch(options);const newContext=browser.newContext.bind(browser);
      t.mock.method(browser,'newContext',async contextOptions=>{
        if(contextOptions.recordVideo)throw new Error('simulated unavailable video encoder');
        return newContext(contextOptions);
      });
      return browser;
    });
    const run=await runPlan(plan(f.url,loginSteps()),{dataDir:f.dataDir});
    assert.equal(run.exitCode,0);assert.equal(run.cases[0].attempts[0].recordings[0].status,'omitted');
    assert.ok(run.cases[0].attempts[0].recordings[0].reason.includes('simulated unavailable video encoder'));
  }finally{t.mock.restoreAll();await f.close();}
});
test('incremental session close exposes paths only and exports carry no existing recordings',async()=>{
  const f=await fixture();const service=new WebPilotService(f.dataDir);
  try{
    const open=await service.open({url:f.url});await service.step(open.sessionId,{id:'title',op:'expectText',locator:selector('h1'),expected:'Test frontend',source},true);
    const closed=await dispatch(service,'session_close',{sessionId:open.sessionId});await assertVideo(closed.recordings[0]);
    const session=JSON.parse(await readFile(join(service.store.runDir(open.runId),'session.json'),'utf8'));assert.equal(session.recordings[0].path,closed.recordings[0].path);
    assert.ok((await readFile(closed.playbackPath,'utf8')).includes('<video controls'));
    const run=await service.run(plan(f.url,loginSteps()));const result=await dispatch(service,'report_read',{runId:run.id});assert.equal(result.cases[0].attempts[0].recordings[0].path,run.cases[0].attempts[0].recordings[0].path);
    assert.ok(!JSON.stringify(result).includes('base64'));assert.ok(!('content' in result.cases[0].attempts[0].recordings[0]));
    const directory=join(f.dataDir,'export');await exportPlan(plan(f.url,loginSteps()),directory);
    const files=await readdir(directory,{recursive:true});assert.ok(!files.some(file=>file.endsWith('.webm') || file.endsWith('recordings.html')));
  }finally{await service.closeAll();await f.close();}
});
