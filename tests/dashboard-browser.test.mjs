import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {expect} from 'playwright/test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {internal,stopDashboard,endpointAt} from '../dist/dashboard/lifecycle.js';
import {Store} from '../dist/artifacts/store.js';
import {Progress} from '../dist/core/progress.js';
import {Redactor} from '../dist/artifacts/redaction.js';
import {fixture,plan,loginSteps,selector,source} from './helpers.mjs';

const reportDir=resolve('.webpilot/reports/dashboard-acceptance');
const pluginRoot=process.env.WEBPILOT_ACCEPTANCE_PACKAGE;
const {startDashboard}=await import(pluginRoot?pathToFileURL(join(pluginRoot,'dist/dashboard/server.js')).href:'../dist/dashboard/server.js');
async function mcp(dataDir,root){const c=new Client({name:'dashboard-browser-test',version:'1'});const transport=new StdioClientTransport({command:process.execPath,args:[pluginRoot?join(pluginRoot,'dist/mcp/index.js'):'dist/mcp/index.js'],env:{...process.env,WEBPILOT_DATA_DIR:dataDir,WEBPILOT_DASHBOARD_DIR:root,WEBPILOT_DASHBOARD:'1'},stderr:'pipe'});await c.connect(transport);c.executorPid=transport.pid;return c;}
async function link(service){const ticket=await internal({url:service.url,token:service.token},'/internal/bootstrap',{});return `${service.url}/#access=${ticket.token}`;}
const getData=result=>{assert.ok(!result.isError,JSON.stringify(result));return result.structuredContent.data;};

test('two independent MCP processes stream into one browser dashboard, survive service restart and retain reports and seekable video', {timeout:60000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'webpilot-dashboard-browser-'));const stateDir=join(root,'state');const dataA=join(root,'A'),dataB=join(root,'B');await mkdir(dataA);await mkdir(dataB);await mkdir(reportDir,{recursive:true});
  const target=await fixture();let service=await startDashboard({root:stateDir,port:0,defaultDataDir:dataA});let browser;let a,b;
  const errors=[];const started=Date.now();const memoryBefore=process.memoryUsage().rss;const cpuBefore=process.cpuUsage();let results;
  try{
    [a,b]=await Promise.all([mcp(dataA,stateDir),mcp(dataB,stateDir)]);
    const inventory=await a.listTools();assert.ok(inventory.tools.some(t=>t.name==='dashboard_open'));
    const firstLink=getData(await a.callTool({name:'dashboard_open',arguments:{open:false}}));assert.ok(firstLink.dashboardUrl.startsWith(service.url));
    browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
    await page.goto(await link(service));await expect(page.getByRole('heading',{name:'运行总览'})).toBeVisible();
    const make=(title)=>({...plan(target.url+'/?delay=10000',[{id:'wait-ready',op:'expectText',locator:selector('#delay'),expected:'Ready',source},...loginSteps()],{budget:{assertionMs:15000,totalMs:40000}}),scope:[title]});
    const pendingA=a.callTool({name:'suite_run',arguments:{plan:make('商城登录验收')}});
    const pendingB=b.callTool({name:'suite_run',arguments:{plan:make('管理后台回归')}});
    await expect(page.locator('.run-card')).toHaveCount(2,{timeout:10000});await page.screenshot({path:join(reportDir,'overview.png'),fullPage:true});
    await page.getByRole('checkbox',{name:'并排选择 商城登录验收'}).check();await page.getByRole('checkbox',{name:'并排选择 管理后台回归'}).check();await page.getByRole('button',{name:/并排观看 2\/2/}).click();
    await expect(page.locator('.live-container')).toHaveCount(2);
    await expect.poll(()=>page.locator('.live-container').evaluateAll(nodes=>nodes.every(n=>Number(n.dataset.frames)>0)),{timeout:10000}).toBe(true);
    const firstFrames=await page.locator('.live-container').evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.frames)));
    await page.screenshot({path:join(reportDir,'parallel-live.png'),fullPage:true});
    const frameTimes=await page.locator('.live-footer').allTextContents();
    const original=service.url;await service.close();service=await startDashboard({root:stateDir,port:Number(new URL(original).port),defaultDataDir:dataA});assert.equal(service.url,original);
    await expect.poll(()=>page.locator('.live-container').evaluateAll((nodes,previous)=>nodes.length===2&&nodes.every((n,i)=>Number(n.dataset.frames)>previous[i]),firstFrames),{timeout:10000}).toBe(true);
    await page.reload();await expect(page.locator('.detail')).toHaveCount(2,{timeout:10000});
    await expect.poll(()=>page.locator('.live-container').evaluateAll(nodes=>nodes.length===2&&nodes.every(n=>Number(n.dataset.frames)>0)),{timeout:10000}).toBe(true);
    results=await Promise.all([pendingA,pendingB]);const runs=results.map(getData);assert.ok(runs.every(r=>r.outcome==='passed'));
    await expect.poll(async()=>[...service.registry.runs.values()].filter(e=>e.state.lifecycle==='finished').length,{timeout:10000}).toBe(2);
    const run=runs[0];await page.goto(`${service.url}/runs/${run.id}`);await expect(page.getByRole('heading',{name:'商城登录验收'})).toBeVisible();
    await page.getByRole('button',{name:/截图 \d+/}).click();await expect(page.locator('.screenshots img')).toHaveCount(5);
    const screenshot=page.locator('.screenshots .screenshot-trigger').first(),preview=page.getByRole('dialog',{name:'截图预览',exact:true});
    const screenshotSrc=await screenshot.locator('img').getAttribute('src');
    await screenshot.focus();await page.keyboard.press('Enter');await expect(preview).toBeVisible();
    await expect(preview.locator('img')).toHaveAttribute('src',screenshotSrc);
    await expect.poll(()=>preview.locator('img').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
    await preview.getByRole('button',{name:'原始尺寸',exact:true}).click();
    assert.ok(await preview.locator('img').evaluate(img=>Math.abs(img.getBoundingClientRect().width-img.naturalWidth)<1),'original size preserves screenshot pixels');
    await preview.getByRole('button',{name:'适应窗口',exact:true}).click();
    await page.keyboard.press('Escape');await expect(preview).toHaveCount(0);await expect(screenshot).toBeFocused();
    await page.setViewportSize({width:375,height:700});await screenshot.click();await expect(preview).toBeVisible();
    const bounds=await preview.boundingBox();assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=375&&bounds.y+bounds.height<=700,'preview fits mobile viewport');
    await preview.getByRole('button',{name:'原始尺寸',exact:true}).click();
    assert.ok(await preview.locator('.screenshot-preview-stage').evaluate(el=>el.scrollWidth>el.clientWidth),'original screenshot can be scrolled on mobile');
    await preview.getByRole('button',{name:'关闭截图预览',exact:true}).click();await expect(preview).toHaveCount(0);
    await page.setViewportSize({width:1440,height:1000});await screenshot.click();
    await page.mouse.click(2,2);await expect(preview).toHaveCount(0);
    await page.locator('.timeline .step').first().click();
    await page.locator('.step-detail .screenshot-trigger').first().click();await expect(preview).toBeVisible();
    await page.keyboard.press('Escape');await expect(preview).toHaveCount(0);
    await page.getByRole('link',{name:'← 所有测试',exact:true}).click();
    await page.locator(`[data-run-id="${run.id}"] .run-preview`).click();await expect(preview).toBeVisible();
    await page.keyboard.press('Escape');await expect(preview).toHaveCount(0);assert.equal(new URL(page.url()).pathname,'/');
    await page.goto(`${service.url}/runs/${run.id}`);
    await page.getByRole('button',{name:'报告',exact:true}).click();await expect(page.getByRole('heading',{name:'运行报告',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'录像',exact:true}).click();const video=page.locator('video').first();await expect(video).toBeVisible();
    await expect.poll(()=>video.evaluate(v=>v.readyState),{timeout:10000}).toBeGreaterThanOrEqual(1);
    await video.evaluate(async v=>{v.muted=true;await v.play();v.currentTime=Math.min(1,v.duration/2);});await expect.poll(()=>video.evaluate(v=>v.currentTime)).toBeGreaterThan(0);
    await page.screenshot({path:join(reportDir,'recording.png'),fullPage:true});assert.deepEqual(errors,[]);
    const before=await readFile(join(dataA,'runs',run.id,'report.json'),'utf8');await page.reload();await expect(page.getByRole('heading',{name:'商城登录验收'})).toBeVisible();assert.equal(await readFile(join(dataA,'runs',run.id,'report.json'),'utf8'),before);
    for(const dir of [dataA,dataB])for(const entry of await readdir(join(dir,'runs'))){const files=await readdir(join(dir,'runs',entry));assert.ok(!files.some(name=>name.startsWith('live-frame')));}
    await writeFile(join(reportDir,'result.json'),JSON.stringify({date:new Date().toISOString(),checks:['independent MCP processes','different data directories','one overview','two live subscriptions','service restart and authenticated refresh','screenshots','reports','seekable recordings','no browser script errors'],runs:runs.map(r=>({id:r.id,outcome:r.outcome,cases:r.cases.length})),firstFrames,frameTimes,totalMs:Date.now()-started,dashboardRssDeltaBytes:process.memoryUsage().rss-memoryBefore,dashboardCpuMicros:process.cpuUsage(cpuBefore),maxFrameBytes:2097152,maxViewerBufferedBytes:2097152},null,2)+'\n');
  }finally{await browser?.close();await a?.close();await b?.close();await service.close();await target.close();await rm(root,{recursive:true,force:true});}
});

test('explicit stop and executor termination preserve independent tests and recover final reports', {timeout:35000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'webpilot-dashboard-fault-'));const state=join(root,'state');const dataA=join(root,'A'),dataB=join(root,'B');await mkdir(dataA);await mkdir(dataB);
  const target=await fixture();let service=await startDashboard({root:state,port:0,defaultDataDir:dataA});let a,b;
  try{
    [a,b]=await Promise.all([mcp(dataA,state),mcp(dataB,state)]);
    const input=plan(target.url+'/?delay=5000',[{id:'wait',op:'expectText',locator:selector('#delay'),expected:'Ready',source}],{budget:{assertionMs:12000,totalMs:20000}});
    const failed=a.callTool({name:'suite_run',arguments:{plan:input}}).then(()=>({resolved:true}),()=>({resolved:false}));
    const surviving=b.callTool({name:'suite_run',arguments:{plan:input}}).then(result=>({result}),error=>({error}));
    await expect.poll(()=>service.registry.runs.size,{timeout:10000}).toBe(2);
    const interrupted=[...service.registry.runs.values()].find(e=>e.state.meta.owner.pid===a.executorPid).state.id;
    assert.ok(a.executorPid);process.kill(a.executorPid,'SIGKILL');await failed;
    await expect.poll(async()=>{await service.registry.refresh(interrupted);return service.registry.runs.get(interrupted)?.state.lifecycle;},{timeout:10000}).toBe('interrupted');
    assert.equal(service.registry.runs.get(interrupted).state.outcome,undefined);
    assert.equal((await stopDashboard(state)).stopped,true);await service.close();
    await new Promise(ok=>setTimeout(ok,800));assert.equal(await endpointAt(state),undefined);
    const survived=await surviving;if(survived.error)throw survived.error;const run=getData(survived.result);assert.equal(run.outcome,'passed');assert.equal((await new Store(dataB).readRun(run.id)).outcome,'passed');assert.equal(await endpointAt(state),undefined);
    service=await startDashboard({root:state,port:0,defaultDataDir:dataA});await service.registry.importRoot(dataB);await service.registry.refresh();
    assert.equal(service.registry.runs.get(run.id).state.outcome,'passed');assert.equal(service.registry.runs.get(interrupted).state.lifecycle,'interrupted');
    assert.equal(service.registry.runs.get(run.id).state.seq,JSON.parse((await readFile(join(dataB,'runs',run.id,'events.jsonl'),'utf8')).trimEnd().split('\n').at(-1)).seq);
    // Simulate an already-written valid report becoming visible after liveness recovery.
    await writeFile(join(dataA,'runs',interrupted,'report.json'),JSON.stringify({...run,id:interrupted}));await service.registry.refresh(interrupted);
    assert.equal(service.registry.runs.get(interrupted).state.lifecycle,'finished');assert.equal(service.registry.runs.get(interrupted).state.outcome,'passed');
  }finally{await a?.close();await b?.close();await service.close();await target.close();await rm(root,{recursive:true,force:true});}
});

test('untrusted evidence and report diagnostics remain literal text in the real dashboard', {timeout:15000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'webpilot-dashboard-html-'));const data=join(root,'data');await mkdir(data);const service=await startDashboard({root:join(root,'state'),port:0,defaultDataDir:data});let browser;
  try{
    const malicious='<img src=x onerror="window.evidenceExecuted=true"><script>window.evidenceExecuted=true</script>';
    const store=new Store(data);await store.beginRun('unsafe-text');const progress=await Progress.create(store.runDir('unsafe-text'),data,{id:'unsafe-text',title:malicious,target:'http://localhost',mode:'exploration',startedAt:new Date().toISOString(),cases:[],live:false},new Redactor(),{dashboard:false});await progress.finish();
    await writeFile(join(store.runDir('unsafe-text'),'session.json'),JSON.stringify({runId:'unsafe-text',closed:true,steps:[],diagnostic:malicious}));await service.registry.importRoot(data);await service.registry.refresh();
    browser=await chromium.launch();const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto((await link(service)).replace('/#','/runs/unsafe-text#'));
    await expect(page.getByRole('heading',{name:malicious,exact:true})).toBeVisible();assert.equal(await page.locator('.detail-heading img, .detail-heading script').count(),0);
    await page.getByRole('button',{name:'报告',exact:true}).click();await page.getByText('结构化原始报告').click();await expect(page.locator('.report pre')).toContainText(malicious.replaceAll('"','\\"'));assert.equal(await page.evaluate(()=>window.evidenceExecuted),undefined);assert.deepEqual(errors,[]);
    const headers=await page.request.get(service.url+'/api/runs');assert.equal(headers.headers()['cache-control'],'no-store');assert.equal(headers.headers()['access-control-allow-origin'],undefined);assert.match(headers.headers()['content-security-policy'],/script-src 'self'/);
  }finally{await browser?.close();await service.close();await rm(root,{recursive:true,force:true});}
});
