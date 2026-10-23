import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright';
import {expect} from 'playwright/test';
import {fixture,plan,selector,source} from './helpers.mjs';
import {PlanSchema} from '../dist/core/schema.js';
import {coverageFromPlan,coverageResult} from '../dist/core/coverage.js';
import {WebPilotService} from '../dist/core/service.js';
import {startDashboard} from '../dist/dashboard/server.js';
import {internal} from '../dist/dashboard/lifecycle.js';

test('automatic expansion publishes a ninth case in the same run and keeps the two unfinished original cases visible',async()=>{
  const f=await fixture(),executor=new WebPilotService(f.dataDir);let dashboard,browser;
  try{
    const p=PlanSchema.parse(plan(f.url,[{id:'heading',op:'expectText',locator:selector('h1'),expected:'Test frontend',source}],{target:{evidence:{video:false}}}));p.cases=Array.from({length:8},(_,i)=>({...structuredClone(p.cases[0]),id:`original-${i+1}`,title:`原范围 ${i+1}`}));const draft=coverageFromPlan(p),record=await executor.coverageStore.create(draft),first={id:record.manifest.id,revision:1};await executor.coverageStore.adopt(first,'已展示八条原范围');const opened=await executor.open(draft.target,{coverage:first,dashboard:false});
    const execute=async(item,ref)=>{await executor.planned.begin(opened.sessionId,item.id,ref);for(const step of item.executable.steps)assert.equal((await executor.step(opened.sessionId,step,true,undefined,{caseId:item.id,revision:ref.revision,attempt:1})).outcome,'passed');await executor.planned.end(opened.sessionId);};
    for(const item of draft.items.slice(0,6))await execute(item,first);
    const partial=JSON.parse(await readFile(join(executor.store.runDir(opened.runId),'coverage-result.json'),'utf8'));assert.equal(partial.items.filter(i=>i.outcome==='passed').length,6);assert.equal(partial.items.filter(i=>i.executionStatus==='not-started').length,2);
    const next=structuredClone(draft),added={...structuredClone(next.items[0]),id:'additional',title:'观察后补充标题检查',suggestedBy:'ai',dimension:'相关页面状态',rationale:'用已知样例要求验证关联页面状态',selectionReason:'已发布并纳入本次自动范围'};added.executable.id=added.id;added.executable.title=added.title;next.items.push(added);next.generation.round=2;next.generation.aiSupplemented=true;
    const updated=await executor.coverageStore.update(first.id,1,'add-ninth',next,'观察后增补第九条');const second={id:first.id,revision:2};assert.equal(updated.adoption,undefined);await assert.rejects(()=>executor.planned.begin(opened.sessionId,added.id,second),e=>e.code==='PLAN_NOT_ADOPTED');await executor.coverageStore.adopt(second,'已展示新增范围');await executor.planned.sync(opened.sessionId,second);await execute(added,second);
    const closed=await executor.close(opened.sessionId);assert.equal(closed.runId,opened.runId);assert.equal(closed.report.cases.length,9);assert.equal(closed.report.exitCode,2);assert.equal(closed.report.cases.filter(c=>c.outcome==='passed').length,7);assert.equal(closed.report.cases.filter(c=>c.outcome==='inconclusive').length,2);
    const dir=executor.store.runDir(opened.runId),events=(await readFile(join(dir,'events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.ok(events.findIndex(e=>e.type==='coverage.updated'&&e.payload.revision===2)<events.findIndex(e=>e.type==='case.started'&&e.caseId===added.id));const snapshot=JSON.parse(await readFile(join(dir,'coverage.json'),'utf8'));assert.equal(snapshot.history[0].draft.items.length,8);assert.equal(coverageResult(snapshot,closed.report,true).items.length,9);
    dashboard=await startDashboard({root:join(f.dataDir,'dashboard'),port:0,defaultDataDir:f.dataDir});browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:1000}}),ticket=await internal(dashboard,'/internal/bootstrap',{});await page.goto(`${dashboard.url}/runs/${opened.runId}#access=${ticket.token}`);await page.getByRole('button',{name:'覆盖清单',exact:true}).click();await expect(page.locator('.coverage-case')).toHaveCount(9);await expect(page.locator('.coverage-state.passed')).toHaveCount(7);await expect(page.getByText('AI 补充 · 相关页面状态 · 执行中新增')).toBeVisible();await page.getByText('查看计划变更记录（2 个版本）').click();await expect(page.getByText('第 2 版：观察后增补第九条')).toBeVisible();await mkdir(resolve('.webpilot/reports/pretest-coverage'),{recursive:true});await page.screenshot({path:resolve('.webpilot/reports/pretest-coverage/expanded-coverage.png'),fullPage:true});
    await page.goto(dashboard.url);await expect(page.locator(`[data-run-id="${opened.runId}"]`).getByText('已执行 7 / 9 用例',{exact:true})).toBeVisible();
  }finally{await browser?.close();await dashboard?.close();await executor.closeAll();await f.close();}
});
