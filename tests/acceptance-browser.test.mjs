import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright';
import {expect} from 'playwright/test';
import {fixture,plan,selector,source} from './helpers.mjs';
import {PlanSchema} from '../dist/core/schema.js';
import {coverageFromPlan} from '../dist/core/coverage.js';
import {WebPilotService} from '../dist/core/service.js';
import {runPlan,saveCase} from '../dist/core/runner.js';
import {startDashboard} from '../dist/dashboard/server.js';
import {internal} from '../dist/dashboard/lifecycle.js';

function scenarios(url){
  const check={id:'heading',op:'expectText',locator:selector('h1'),expected:'Test frontend',source};
  const p=PlanSchema.parse(plan(url,[check],{target:{evidence:{video:false,live:false}}}));
  p.cases[0].title='正常登录';
  for(const [id,title,expected] of [['empty','空表单补充校验','Test frontend'],['refresh','登录态保持补充检查','应保持登录']])p.cases.push({...p.cases[0],id,title,steps:[{...check,id,expected,candidate:true,source:{type:'inferred',reference:'待确认业务规则'}}]});
  return PlanSchema.parse(p);
}

test('suite and incremental sessions persist the same separate formal and supplementary assessment',async()=>{
  const f=await fixture(),service=new WebPilotService(f.dataDir);
  try{
    const p=scenarios(f.url),suite=await runPlan(p,{dataDir:f.dataDir,dashboard:false});
    assert.equal(suite.outcome,'passed');assert.equal(suite.outcomePolicy,'formal-v1');assert.equal(suite.acceptance.formal.passed,1);assert.equal(suite.acceptance.supplementary.issues,1);assert.equal(suite.cases[2].outcome,'inconclusive');
    const draft=coverageFromPlan(p),record=await service.coverageStore.create(draft),coverage={id:record.manifest.id,revision:1};await service.coverageStore.adopt(coverage,'已展示正式及补充范围');
    const opened=await service.open(draft.target,{coverage,dashboard:false});
    for(const item of draft.items){await service.planned.begin(opened.sessionId,item.id,coverage);for(const step of item.executable.steps)await service.step(opened.sessionId,step,true,undefined,{caseId:item.id,revision:1,attempt:1});await service.planned.end(opened.sessionId);}
    const closed=await service.close(opened.sessionId);assert.equal(closed.report.outcome,'passed');assert.deepEqual(closed.report.acceptance,suite.acceptance);
    assert.match(await readFile(join(f.dataDir,'runs',suite.id,'report.md'),'utf8'),/补充检查：1 项符合预期；1 项发现异常/);
    const mixed={...p.cases[0],id:'mixed',steps:[...p.cases[0].steps,...p.cases[2].steps]};const saved=await saveCase(mixed,p.target,{dataDir:f.dataDir,dashboard:false,promote:true});assert.equal(saved.case.state,'draft');
  }finally{await service.closeAll();await f.close();}
});

test('dashboard explains historical outcomes, labels execution progress and preserves report bytes across responsive views',{timeout:30000},async()=>{
  const f=await fixture();let dashboard,browser;
  try{
    const run=await runPlan(scenarios(f.url),{dataDir:f.dataDir,dashboard:false}),dir=join(f.dataDir,'runs',run.id),reportPath=join(dir,'report.json');
    // Fixture an old report without changing any planned assertions or recorded steps.
    const historical={...run,outcome:'inconclusive',exitCode:2};delete historical.outcomePolicy;delete historical.acceptance;
    const original=JSON.stringify(historical,null,2)+'\n';await writeFile(reportPath,original);
    dashboard=await startDashboard({root:join(f.dataDir,'dashboard'),port:0,defaultDataDir:f.dataDir});browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    const ticket=await internal(dashboard,'/internal/bootstrap',{});await page.goto(`${dashboard.url}/#access=${ticket.token}`);
    await page.getByRole('button',{name:'通过',exact:true}).click();
    const listing=await (await page.request.get(`${dashboard.url}/api/runs?status=passed`)).json();assert.equal(listing.total,1);assert.equal(listing.summary.passed,1);assert.equal(listing.runs[0].outcome,'inconclusive');
    const card=page.locator(`[data-run-id="${run.id}"]`);await expect(card.getByText('正式验收通过',{exact:true})).toBeVisible();await expect(card.getByText('补充检查有异常',{exact:true})).toBeVisible();await expect(card.getByText('已执行 3 / 3 用例',{exact:true})).toBeVisible();
    await card.getByRole('link',{name:'Fixture feature',exact:true}).click();await page.getByRole('button',{name:'覆盖清单',exact:true}).click();
    const summary=page.getByRole('region',{name:'验收与补充检查'});await expect(summary).toContainText('1 / 1 用例通过');await expect(summary).toContainText('1 项符合预期 · 1 项发现异常 · 0 项未完成');await expect(summary).toContainText('原始报告结果：无法确定');
    const supplementary=page.locator('[data-coverage-case="refresh"]');await supplementary.locator('summary').first().click();await expect(supplementary.locator('.coverage-state')).toHaveText('补充检查有异常');await supplementary.getByText('技术详情',{exact:true}).click();
    const logs=supplementary.getByLabel('原始执行日志');await expect(logs).toBeVisible();assert.equal(await logs.evaluate(el=>getComputedStyle(el).whiteSpace),'pre-wrap');
    await mkdir(resolve('.webpilot/reports/acceptance'),{recursive:true});
    for(const width of [1440,768,375,320]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`overflow at ${width}`);}
    await page.screenshot({path:resolve('.webpilot/reports/acceptance/mobile.png'),fullPage:true});
    assert.equal(await readFile(reportPath,'utf8'),original);assert.deepEqual(errors,[]);
  }finally{await browser?.close();await dashboard?.close();await f.close();}
});
