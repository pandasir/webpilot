import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright';
import {expect} from 'playwright/test';
import {CoverageStore} from '../dist/artifacts/coverage.js';
import {coverageFromPlan,coveragePlan} from '../dist/core/coverage.js';
import {PlanSchema} from '../dist/core/schema.js';
import {WebPilotService,dispatch} from '../dist/core/service.js';
import {runPlan} from '../dist/core/runner.js';
import {startDashboard} from '../dist/dashboard/server.js';
import {internal} from '../dist/dashboard/lifecycle.js';
import {changeManagement} from '../dist/artifacts/management.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const reports=resolve('.webpilot/reports/pretest-coverage');
const source={type:'user',reference:'验收样例要求：关键词与分类共同过滤，清空恢复三条商品，无匹配显示“暂无匹配商品”'};
const label=value=>({kind:'label',value});const selector=value=>({kind:'selector',value});
export function productPlan(){const cases=[
  {id:'search',title:'关键词搜索',steps:[{id:'query',op:'fill',locator:label('搜索商品'),value:'蓝色杯子'},{id:'count',op:'expectCount',locator:selector('#products li'),expected:1,source}]},
  {id:'combined',title:'搜索与分类组合',steps:[{id:'category',op:'select',locator:label('商品分类'),value:'数码'},{id:'query',op:'fill',locator:label('搜索商品'),value:'蓝色杯子'},{id:'count',op:'expectCount',locator:selector('#products li'),expected:0,source},{id:'empty',op:'expectText',locator:{kind:'role',value:'status'},expected:'暂无匹配商品',source}]},
  {id:'reset',title:'清空条件恢复',steps:[{id:'query',op:'fill',locator:label('搜索商品'),value:'蓝色杯子'},{id:'reset',op:'click',locator:{kind:'role',value:'button',name:'清空条件'}},{id:'count',op:'expectCount',locator:selector('#products li'),expected:3,source}]}
];return PlanSchema.parse({schemaVersion:1,id:'products-acceptance',target:{staticDir:resolve('tests/fixtures/coverage'),evidence:{video:false}},scope:['商品搜索、分类组合和清空恢复'],cases:cases.map(c=>({schemaVersion:1,version:1,...c}))});}
function inventory(){const d=coverageFromPlan(productPlan());d.title='商品搜索与分类覆盖计划';d.generation.aiSupplemented=true;for(const item of d.items){item.suggestedBy=item.id==='search'?'user':'ai';item.rationale=item.id==='search'?'用户明确要求':'补充组合条件冲突与状态恢复的遗漏风险';item.dimension=item.id==='combined'?'组合与空结果':item.id==='reset'?'状态恢复':'正常流程';}d.requirements=[{id:'products',description:d.scope[0],source,caseIds:d.items.map(i=>i.id)}];d.items.push({...d.items[0],id:'refresh',title:'刷新保留条件',suggestedBy:'ai',selected:false,selectionReason:'没有明确刷新保留规则',readiness:'needs-clarification',reason:'需要业务规则',executable:undefined});return d;}

test('MCP coverage links register only enabled plans and explicitly disabled sessions stay disconnected',async()=>{
  const root=await mkdtemp(join(tmpdir(),'webpilot-coverage-links-')),data=join(root,'private'),state=join(root,'state');await mkdir(data);const dashboard=await startDashboard({root:state,port:0,defaultDataDir:join(root,'other')});const client=new Client({name:'coverage-links',version:'1'});
  try{
    await client.connect(new StdioClientTransport({command:process.execPath,args:['dist/mcp/index.js'],env:{...process.env,WEBPILOT_DATA_DIR:data,WEBPILOT_DASHBOARD_DIR:state,WEBPILOT_DASHBOARD:'1'},stderr:'pipe'}));
    const call=async(name,args)=>{const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));return r.structuredContent;};
    const saved=await call('coverage_create',{draft:inventory(),dashboard:false});assert.equal(saved.metadata,undefined);const coverage={id:saved.data.manifest.id,revision:1};await call('coverage_adopt',{coverage,reference:'已发布清单',dashboard:false});
    const opened=await call('session_open',{target:saved.data.manifest.draft.target,coverage,dashboard:false});assert.equal(opened.metadata,undefined);assert.equal((await call('session_case_begin',{sessionId:opened.data.sessionId,caseId:'search',coverage})).metadata,undefined);assert.equal((await call('session_close',{sessionId:opened.data.sessionId})).metadata,undefined);await dashboard.registry.refresh();assert.equal(dashboard.registry.plans.size,0);assert.equal(dashboard.registry.runs.size,0);
    const enabled=await call('coverage_create',{draft:{...inventory(),mode:'generate-only'}});assert.equal(enabled.metadata.planUrl,`${dashboard.url}/plans/${enabled.data.manifest.id}`);assert.equal(enabled.metadata.runUrl,undefined);assert.ok(dashboard.registry.plans.has(enabled.data.manifest.id));
  }finally{await client.close();await dashboard.close();await rm(root,{recursive:true,force:true});}
});

test('coverage UI shows pretest plans, filters, adopted execution and archived snapshots without narrow-screen overflow',{timeout:30000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'webpilot-coverage-ui-')),data=join(root,'data');await mkdir(data);await mkdir(reports,{recursive:true});const store=new CoverageStore(data);let dashboard=await startDashboard({root:join(root,'state'),port:0,defaultDataDir:data});let browser;const executor=new WebPilotService(data);const errors=[];
  try{
    const first=await store.create(inventory()),review=await store.create({...inventory(),mode:'review',title:'待审阅商品计划'}),generate=await store.create({...inventory(),mode:'generate-only',title:'仅生成商品计划'});await dashboard.registry.importRoot(data);assert.equal(dashboard.registry.runs.size,0);await assert.rejects(()=>readdir(join(data,'runs')),e=>e.code==='ENOENT');
    browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));const ticket=await internal(dashboard,'/internal/bootstrap',{});await page.goto(`${dashboard.url}/plans#access=${ticket.token}`);await expect(page.getByRole('heading',{name:'覆盖计划',exact:true})).toBeVisible();await expect(page.locator('.coverage-plan-card')).toHaveCount(3);
    await page.getByRole('link',{name:/待审阅商品计划/}).click();await expect(page.getByText('请在聊天中明确采用这份清单后再执行；浏览器尚未启动。')).toBeVisible();await expect(page.locator('.coverage-case')).toHaveCount(4);assert.equal(dashboard.registry.runs.size,0);
    await page.getByLabel('场景来源',{exact:true}).selectOption('ai');await expect(page.locator('.coverage-case')).toHaveCount(3);await page.getByLabel('本次安排',{exact:true}).selectOption('excluded');await expect(page.locator('.coverage-case')).toHaveCount(1);await page.locator('.coverage-case summary').click();await expect(page.getByText('需要业务规则',{exact:true})).toBeVisible();await page.screenshot({path:join(reports,'review-plan.png'),fullPage:true});
    assert.equal((await page.request.get(`${dashboard.url}/api/plans/not-a-plan`)).status(),404);assert.equal((await page.request.get(`${dashboard.url}/api/plans/${review.manifest.id}`,{headers:{Origin:'http://evil.example'}})).status(),401);
    const ref={id:first.manifest.id,revision:1};await store.adopt(ref,'验收已发布清单');const suite=await runPlan(coveragePlan(await store.snapshot(ref)),{dataDir:data,coverage:ref,dashboard:false});assert.equal(suite.outcome,'passed',JSON.stringify(suite));
    const opened=await executor.open(first.manifest.draft.target,{coverage:ref,dashboard:false});await executor.observe(opened.sessionId);for(const item of first.manifest.draft.items.filter(i=>i.selected)){await executor.planned.begin(opened.sessionId,item.id,ref);for(const step of item.executable.steps)await executor.step(opened.sessionId,step,step.op.startsWith('expect'),undefined,{caseId:item.id,revision:1,attempt:1});await executor.planned.end(opened.sessionId);}const closed=await executor.close(opened.sessionId);assert.equal(closed.report.outcome,'passed');
    await dashboard.registry.importRoot(data);await dashboard.registry.refresh();await page.goto(`${dashboard.url}/runs/${closed.runId}`);await page.getByRole('button',{name:'覆盖清单',exact:true}).click();await expect(page.locator('.coverage-case')).toHaveCount(4);await expect(page.locator('.coverage-state.passed')).toHaveCount(3);await page.screenshot({path:join(reports,'completed-coverage.png'),fullPage:true});
    for(const width of [1440,768,375,320]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`coverage overflows at ${width}`);const card=await page.evaluate(()=>{const name=document.querySelector('.coverage-case-name'),state=document.querySelector('.coverage-state');if(!name||!state)return null;return {nameWidth:name.getBoundingClientRect().width,stateBelow:name.getBoundingClientRect().bottom<=state.getBoundingClientRect().top+1||state.getBoundingClientRect().left>=name.getBoundingClientRect().right-1};});assert.ok(card===null||card.nameWidth>=120&&card.stateBelow,`coverage case title squeezed at ${width}`);}await page.screenshot({path:join(reports,'mobile-coverage.png'),fullPage:true});
    assert.equal((await changeManagement(data,closed.runId,'archive')).status,'archived');await store.prune(Date.now()+8*86400000);await dashboard.registry.refresh();await page.reload();await page.getByRole('button',{name:'覆盖清单',exact:true}).click();await expect(page.locator('.coverage-case')).toHaveCount(4);await expect(page.getByText('本页使用随运行保存的清单快照。')).toBeVisible();
    const originalUrl=dashboard.url;await dashboard.close();dashboard=await startDashboard({root:join(root,'state'),port:Number(new URL(originalUrl).port),defaultDataDir:data});await page.reload();await page.getByRole('button',{name:'覆盖清单',exact:true}).click();await expect(page.locator('.coverage-state.passed')).toHaveCount(3);assert.deepEqual(errors,[]);
    await writeFile(join(reports,'result.json'),JSON.stringify({date:new Date().toISOString(),checks:['执行前清单可见','自动、审阅和仅生成','来源及安排筛选','套件和增量搜索筛选','原回归预期保留','窄屏无横向溢出','归档快照独立保留','重启后恢复','本机认证与来源限制'],suite:{id:suite.id,outcome:suite.outcome},incremental:{id:closed.runId,outcome:closed.report.outcome},planId:first.manifest.id,pageErrors:errors},null,2)+'\n');
  }finally{await executor.closeAll();await browser?.close();await dashboard.close();await rm(root,{recursive:true,force:true});}
});
