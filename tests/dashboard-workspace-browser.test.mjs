import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright';
import {expect} from 'playwright/test';
import {Store} from '../dist/artifacts/store.js';
import {Progress} from '../dist/core/progress.js';
import {Redactor} from '../dist/artifacts/redaction.js';
import {startDashboard} from '../dist/dashboard/server.js';
import {internal} from '../dist/dashboard/lifecycle.js';

test('桌面工作台：侧栏筛选、归档管理与窄屏布局保持可用',{timeout:30000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'pilot-workspace-browser-')),data=join(root,'data');
  const reports=resolve('.webpilot/reports/workspace-acceptance');
  const longTitle='验证超长运行标题在窄屏、详情与管理菜单中保持可读，不遮挡操作入口';
  let service,browser;
  try{
    const store=new Store(data);
    for(const [id,title,outcome] of [['complete','完成的测试','passed'],['failed',longTitle,'failed'],['active','执行中的测试',undefined]]){
      await store.beginRun(id);
      const progress=await Progress.create(store.runDir(id),data,{id,title,mode:'suite',target:'http://localhost:3000/long-target-name',startedAt:new Date().toISOString(),cases:[],live:false},new Redactor(),{dashboard:false});
      if(outcome)await progress.finish({outcome});else await progress.phase('running');
    }
    service=await startDashboard({root:join(root,'state'),port:0,defaultDataDir:data});
    const {token}=await internal(service,'/internal/bootstrap',{});
    browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`${service.url}/#access=${token}`);
    const nav=page.getByRole('navigation',{name:'工作空间导航'});
    await expect(page.locator('.run-card')).toHaveCount(3);
    await nav.getByRole('link',{name:'失败记录',exact:true}).click();
    await expect(page.locator('.run-card')).toHaveCount(1);
    await expect(page.locator('[data-run-id="failed"]')).toBeVisible();
    await page.reload();await expect(page.locator('.run-card')).toHaveCount(1);
    await expect(nav.getByRole('link',{name:'失败记录',exact:true})).toHaveAttribute('aria-current','page');
    await nav.getByRole('link',{name:'正在执行',exact:true}).click();
    await expect(page.locator('[data-run-id="active"]')).toBeVisible();await expect(page.locator('.run-card')).toHaveCount(1);
    await nav.getByRole('link',{name:'所有运行',exact:true}).click();
    await expect(page.locator('.run-card')).toHaveCount(3);
    const complete=page.locator('[data-run-id="complete"]');await complete.locator('summary').click();
    await complete.getByRole('button',{name:'归档并永久保存',exact:true}).click();await expect(complete).toHaveCount(0);
    await page.getByRole('button',{name:'批量管理',exact:true}).click();
    await nav.getByRole('link',{name:'已归档',exact:true}).click();
    await expect(complete).toBeVisible();await expect(page.getByRole('heading',{name:'归档记录',exact:true})).toBeVisible();
    await expect(page.getByRole('checkbox',{name:'全选当前页',exact:true})).toBeVisible();
    await page.getByLabel('记录范围',{exact:true}).selectOption('current');
    await expect(page.locator('.run-card')).toHaveCount(2);
    await expect(nav.getByRole('link',{name:'所有运行',exact:true})).toHaveAttribute('aria-current','page');
    await page.getByRole('button',{name:'完成管理',exact:true}).click();
    await mkdir(reports,{recursive:true});
    for(const width of [1440,1280,768,375,320]){
      await page.setViewportSize({width,height:900});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`overview overflows at ${width}px`);
      await page.locator('[data-run-id="failed"] summary').click();
      const menu=page.locator('[data-run-id="failed"] .management-menu-items');await expect(menu).toBeVisible();
      const bounds=await menu.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1,`menu clipped at ${width}px`);
      await page.locator('[data-run-id="failed"] summary').click();
      if(width===375)await page.screenshot({path:join(reports,'mobile-overview.png'),fullPage:true});
    }
    await page.getByRole('link',{name:longTitle,exact:true}).click();
    await expect(page.getByRole('heading',{name:longTitle,exact:true})).toBeVisible();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'detail overflows on a narrow screen');
    await page.screenshot({path:join(reports,'mobile-detail.png'),fullPage:true});
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();await service?.close();await rm(root,{recursive:true,force:true});}
});
