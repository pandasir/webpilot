import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile,writeFile,cp,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright';
import {expect} from 'playwright/test';
import {Store} from '../dist/artifacts/store.js';
import {Progress} from '../dist/core/progress.js';
import {Redactor} from '../dist/artifacts/redaction.js';
import {startDashboard} from '../dist/dashboard/server.js';
import {internal} from '../dist/dashboard/lifecycle.js';
import {atomicJson} from '../dist/dashboard/files.js';

const reports=resolve('.webpilot/reports/run-management-acceptance');
async function seed(data,id,index){const store=new Store(data);await store.beginRun(id);const dir=store.runDir(id);const p=await Progress.create(dir,data,{id,title:`运行 ${id}`,mode:'exploration',target:'http://localhost',startedAt:new Date(Date.now()-index*1000).toISOString(),cases:[],live:false},new Redactor(),{dashboard:false});await writeFile(join(dir,'session.json'),JSON.stringify({runId:id,closed:true,steps:[]}));await p.finish();return dir;}
async function link(service){const {token}=await internal(service,'/internal/bootstrap',{});return `${service.url}/#access=${token}`;}
async function menu(page,id){const card=page.locator(`[data-run-id="${id}"]`);await card.getByLabel(`管理运行 运行 ${id}`,{exact:true}).click();return card;}

test('管理菜单在鼠标移出后关闭，跨过按钮间隙仍可选择菜单项',{timeout:30000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'pilot-menu-dismiss-')),data=join(root,'data');let service,browser;
 try{
  await seed(data,'menu-dismiss',0);
  service=await startDashboard({root:join(root,'state'),port:0,defaultDataDir:data});
  browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.goto(await link(service));
  for(const detail of [false,true]){
   if(detail)await page.getByRole('link',{name:'运行 menu-dismiss',exact:true}).click();
   const trigger=page.getByLabel('管理运行 运行 menu-dismiss',{exact:true});
   const items=page.locator('.management-menu-items');
   await trigger.click();await expect(items).toBeVisible();
   await page.getByRole('heading',{level:1}).hover();await expect(items).toBeHidden();
   await trigger.click();
   const bounds=await trigger.boundingBox(),menuBounds=await items.boundingBox();
   // Use real mouse movement through the gap; locator.click() alone skips that path.
   await page.mouse.move(bounds.x+bounds.width/2,(bounds.y+bounds.height+menuBounds.y)/2);
   await expect(items).toBeVisible();
   await items.getByRole('button',{name:'重命名',exact:true}).hover();await expect(items).toBeVisible();
   await page.getByRole('heading',{level:1}).hover();await expect(items).toBeHidden();
   await trigger.click();await items.getByRole('button',{name:'重命名',exact:true}).click();
   await expect(page.getByRole('dialog')).toBeVisible();
   await page.getByRole('button',{name:'取消',exact:true}).click();await expect(items).toBeHidden();
  }
 }finally{await browser?.close();await service?.close();await rm(root,{recursive:true,force:true});}
});

test('legacy exploration shows honest times, stays out of active counts, and requires deletion confirmation',{timeout:30000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'pilot-legacy-browser-')),data=join(root,'data');let service,browser;let deletes=0;
 try{
  const store=new Store(data);await store.beginRun('legacy');const dir=store.runDir('legacy'),video=join(dir,'videos','exploration','1','old.webm');await mkdir(join(dir,'videos','exploration','1'),{recursive:true});await writeFile(video,'finalized-video');await atomicJson(join(dir,'session.json'),{schemaVersion:1,sessionId:'session-old',runId:'legacy',steps:[],recordings:[{pageId:'page-1',pageName:'main',status:'available',path:video,sensitive:true,redacted:false}]});
  service=await startDashboard({root:join(root,'state'),port:0,defaultDataDir:data});browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('request',r=>{if(r.method()==='DELETE')deletes++;});await page.goto(await link(service));const card=page.locator('[data-run-id="legacy"]');await expect(card).toContainText('历史记录');await expect(card).toContainText('时长未知');await expect(card).toContainText('时间未知');await expect(page.locator('.stat.active strong')).toHaveText('0');await page.getByRole('button',{name:'执行中',exact:true}).click();await expect(card).toHaveCount(0);await page.getByRole('button',{name:'全部',exact:true}).click();
  await card.getByLabel('管理运行 浏览器探索会话',{exact:true}).click();await expect(card.getByRole('button',{name:'归档并永久保存'})).toBeEnabled();await expect(card.getByRole('button',{name:'删除…'})).toBeEnabled();await card.getByRole('button',{name:'删除…'}).click();await expect(page.getByRole('dialog')).toContainText('无法恢复');assert.equal(deletes,0);await page.getByRole('button',{name:'取消',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);assert.equal(deletes,0);assert.ok(await lstat(dir));
  await card.getByRole('link',{name:'浏览器探索会话',exact:true}).click();await expect(page.locator('.run-meta')).toContainText('时长未知');await expect(page.locator('.run-meta')).toContainText('时间未知');await page.getByLabel('管理运行 浏览器探索会话',{exact:true}).click();await page.getByRole('button',{name:'删除…'}).click();await mkdir(reports,{recursive:true});await page.screenshot({path:join(reports,'legacy-delete-confirmation.png'),fullPage:false});await page.getByRole('button',{name:'永久删除',exact:true}).click();await expect(page.getByRole('alert')).toHaveText('该运行已被删除');assert.equal(deletes,1);await assert.rejects(()=>lstat(dir),{code:'ENOENT'});
 }finally{await browser?.close();await service?.close();await rm(root,{recursive:true,force:true});}
});

test('real browser manages permanent archive, confirmation, independent batches, live viewers and restart across roots',{timeout:60000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'pilot-management-browser-'));const a=join(root,'A'),b=join(root,'B');await mkdir(a);await mkdir(b);await mkdir(reports,{recursive:true});let service,browser;
 const errors=[];let deletionRequests=0;
 try{
  browser=await chromium.launch();const evidenceContext=await browser.newContext({recordVideo:{dir:join(root,'recordings'),size:{width:640,height:360}}});const evidence=await evidenceContext.newPage();await evidence.setContent('<html lang="zh"><body style="background:#eef4eb;color:#294d37;font:24px sans-serif;padding:30px"><h1>归档证据演示</h1><p>报告、截图和录像永久保存</p></body></html>');const png=await evidence.screenshot();await evidence.waitForTimeout(250);const recording=evidence.video();await evidenceContext.close();const videoPath=await recording.path();
  const dirs=new Map();for(let i=0;i<24;i++)dirs.set(`e-${i}`,await seed(i%2?a:b,`e-${i}`,i));
  const primary=dirs.get('e-0');const pngPath=join(primary,'screenshot-fixture.png');await writeFile(pngPath,png);const videos=join(primary,'videos','exploration','1');await mkdir(videos,{recursive:true});const video=join(videos,'fixture.webm');await cp(videoPath,video);
  const session={runId:'e-0',closed:true,steps:[{id:'proof',op:'expectVisible',outcome:'passed',timestamp:new Date().toISOString(),durationMs:1,candidate:false,evidence:[{schemaVersion:1,id:'proof-image',runId:'e-0',caseId:'exploration',stepId:'proof',attempt:1,type:'screenshot',path:pngPath,redacted:true,timestamp:new Date().toISOString()}]}],recordings:[{status:'available',pageId:'page-proof',pageName:'证据演示',path:video,sensitive:true,redacted:false}]};await writeFile(join(primary,'session.json'),JSON.stringify(session));
  service=await startDashboard({root:join(root,'state'),port:0,defaultDataDir:a});await service.registry.importRoot(b);await service.registry.refresh();
  const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='DELETE'||r.url().endsWith('/manage')&&r.postDataJSON()?.action==='delete')deletionRequests++;});await page.goto(await link(service));await expect(page.locator('.run-card')).toHaveCount(20);
  await page.getByLabel('记录范围').selectOption('archived');await expect(page.getByRole('heading',{name:'暂无归档记录'})).toBeVisible();await page.getByLabel('记录范围').selectOption('current');
  const watcher=await context.newPage();watcher.on('pageerror',e=>errors.push(e.message));await watcher.goto(`${service.url}/runs/e-0`);await expect(watcher.getByRole('heading',{name:'运行 e-0',exact:true})).toBeVisible();
  await (await menu(page,'e-0')).getByRole('button',{name:'归档并永久保存'}).click();await expect(page.locator('[data-run-id="e-0"]')).toHaveCount(0);await expect(watcher.locator('.permanent-tag')).toHaveText('已归档 · 永久保存');
  await watcher.getByRole('button',{name:'截图 1',exact:true}).click();await expect(watcher.locator('.screenshots img')).toBeVisible();assert.ok(await watcher.locator('.screenshots img').evaluate(i=>i.complete&&i.naturalWidth>0));await watcher.getByRole('button',{name:'报告',exact:true}).click();await expect(watcher.getByRole('heading',{name:'运行报告',exact:true})).toBeVisible();await watcher.getByRole('button',{name:'录像',exact:true}).click();await expect.poll(()=>watcher.locator('video').evaluate(v=>v.readyState)).toBeGreaterThanOrEqual(1);
  await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.locator('[data-run-id="e-0"] .permanent-tag')).toHaveText('永久保存');await expect(watcher.locator('.permanent-tag')).toHaveText('永久保存');
  await (await menu(page,'e-0')).getByRole('button',{name:'归档并永久保存'}).click();await page.getByLabel('记录范围').selectOption('archived');await expect(page.locator('.run-card')).toHaveCount(1);await page.screenshot({path:join(reports,'archived.png'),fullPage:true});await (await menu(page,'e-0')).getByRole('button',{name:'恢复到当前记录'}).click();await expect(page.getByRole('heading',{name:'暂无归档记录'})).toBeVisible();await page.getByLabel('记录范围').selectOption('current');
  const marker=JSON.parse(await readFile(join(primary,'.owner.json'),'utf8'));await atomicJson(join(primary,'.owner.json'),{...marker,createdAt:Date.now()-90*86400000});assert.equal(await new Store(b).prune(1),0);assert.ok(await lstat(video));
  for(const cancel of ['escape','close','cancel']){await (await menu(page,'e-0')).getByRole('button',{name:'删除…',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog).toContainText('无法恢复');await expect(dialog.getByRole('button',{name:'取消',exact:true})).toBeFocused();if(cancel==='escape')await page.keyboard.press('Escape');else await dialog.getByRole('button',{name:cancel==='close'?'关闭删除弹窗':'取消',exact:true}).click();await expect(dialog).toHaveCount(0);assert.equal(deletionRequests,0);assert.ok(await lstat(primary));}
  await (await menu(page,'e-0')).getByRole('button',{name:'删除…',exact:true}).click();await page.screenshot({path:join(reports,'delete-confirmation.png'),fullPage:false});await page.getByRole('button',{name:'永久删除',exact:true}).click();await expect(page.locator('[data-run-id="e-0"]')).toHaveCount(0);await expect(watcher.getByRole('alert')).toHaveText('该运行已被删除');assert.equal(deletionRequests,1);assert.equal((await context.request.get(`${service.url}/api/runs/e-0/report`)).status(),410);
  await page.getByRole('button',{name:'批量管理',exact:true}).click();const choices=page.getByRole('checkbox',{name:/管理选择/});for(let i=0;i<3;i++)await choices.nth(i).check();await expect(page.getByText('已选 3 条',{exact:true})).toBeVisible();await page.getByRole('textbox',{name:'搜索项目或测试'}).fill('e-');await expect(page.getByText('已选 0 条',{exact:true})).toBeVisible();await page.getByRole('textbox',{name:'搜索项目或测试'}).fill('');await page.getByRole('checkbox',{name:'全选当前页',exact:true}).check();await expect(page.getByText('已选 20 条',{exact:true})).toBeVisible();await page.getByRole('button',{name:'下一页',exact:true}).click();await expect(page.getByText('已选 0 条',{exact:true})).toBeVisible();await expect(page.locator('.run-card')).toHaveCount(3);await page.getByRole('checkbox',{name:'全选当前页',exact:true}).check();await page.getByRole('button',{name:'批量删除…',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('永久删除 3 条运行？');await page.getByRole('button',{name:'永久删除',exact:true}).click();await expect(page.locator('.run-card')).toHaveCount(20);await expect(page.getByRole('button',{name:'上一页',exact:true})).toHaveCount(0);
  await page.getByRole('checkbox',{name:'全选当前页',exact:true}).check();await page.getByRole('button',{name:'批量归档',exact:true}).click();await expect(page.locator('.run-card')).toHaveCount(0);await page.getByLabel('记录范围').selectOption('archived');await expect(page.locator('.run-card')).toHaveCount(20);await page.screenshot({path:join(reports,'batch-archive.png'),fullPage:true});
  const originalUrl=service.url;await service.close();await rm(join(root,'state','registry.json'));service=await startDashboard({root:join(root,'state'),port:Number(new URL(originalUrl).port),defaultDataDir:a});await page.reload();await page.getByLabel('记录范围').selectOption('archived');await expect(page.locator('.run-card')).toHaveCount(20);assert.equal((await context.request.get(`${service.url}/api/runs/e-0`)).status(),410);assert.equal(await new Store(a).prune(1),0);assert.equal(await new Store(b).prune(1),0);assert.deepEqual(errors,[]);
  await writeFile(join(reports,'result.json'),JSON.stringify({date:new Date().toISOString(),temporaryData:true,checks:['two roots','archive and undo','restore keeps forever','90-day retention exemption','screenshots report and seekable media available','confirmation cancel close Escape','focus defaults to cancel','no deletion before confirmation','live detail deletion notification','independent >2 batch selection','scope clears selection','current page only','empty page fallback','restart and index rebuild','deleted IDs stay deleted'],browserErrors:errors},null,2));
 }finally{await browser?.close();await service?.close();await rm(root,{recursive:true,force:true});}
});

test('batch selection stays fixed and partial failures remain selected for retry',{timeout:20000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'pilot-management-partial-'));const data=join(root,'data');await mkdir(data);let service,browser;
 try{for(let i=0;i<3;i++)await seed(data,`p-${i}`,i);service=await startDashboard({root:join(root,'state'),port:0,defaultDataDir:data});browser=await chromium.launch();const page=await browser.newPage();await page.goto(await link(service));await expect(page.locator('.run-card')).toHaveCount(3);await page.getByRole('button',{name:'批量管理',exact:true}).click();await page.getByRole('checkbox',{name:'全选当前页',exact:true}).check();
  const owner=JSON.parse(await readFile(join(data,'runs','p-1','.owner.json'),'utf8'));await atomicJson(join(data,'runs','p-1','.owner.json'),{...owner,owner:'other'});
  await page.getByRole('button',{name:'批量归档',exact:true}).click();await expect(page.locator('.run-card')).toHaveCount(1);await expect(page.getByRole('alert')).toContainText('归属不匹配');await expect(page.getByText('已选 1 条',{exact:true})).toBeVisible();await atomicJson(join(data,'runs','p-1','.owner.json'),owner);await page.getByRole('button',{name:'批量归档',exact:true}).click();await expect(page.locator('.run-card')).toHaveCount(0);
  await page.getByLabel('记录范围').selectOption('archived');await expect(page.locator('.run-card')).toHaveCount(3);await page.getByRole('checkbox',{name:'全选当前页',exact:true}).check();await page.getByRole('button',{name:'批量删除…',exact:true}).click();await seed(data,'new-arrival',-1);await service.registry.importRoot(data);await service.registry.refresh();await expect(page.getByRole('dialog').locator('li')).toHaveCount(3);await page.getByRole('button',{name:'永久删除',exact:true}).click();await expect(page.locator('.run-card')).toHaveCount(0);assert.ok(await lstat(join(data,'runs','new-arrival')));
 }finally{await browser?.close();await service?.close();await rm(root,{recursive:true,force:true});}
});
