import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {startDashboard} from '../dist/dashboard/server.js';
import {internal} from '../dist/dashboard/lifecycle.js';
import {demoApp} from './demo-app.mjs';

// Captures the still frames that make up assets/demo.gif.
// Usage: node scripts/capture-readme-demo.mjs <frame-dir>
//
// The demo runs two independent WebPilot runs against a small styled app
// (scripts/demo-app.mjs): one login acceptance with a slow conditional wait so
// live frames are captured mid-run, and one filter case. Frames are taken from
// the shipped dashboard UI at 1440x900 (2x) so the GIF stays sharp when scaled.

const pause=ms=>new Promise(ok=>setTimeout(ok,ms));
const out=resolve(process.argv[2]??'.webpilot/readme-frames');
await mkdir(out,{recursive:true});

const origin={type:'user',reference:'Demo requirement'};
const loginPlan=url=>({
  schemaVersion:1,
  id:'demo-login',
  target:{url,budget:{assertionMs:15000,totalMs:40000}},
  scope:['Sign-in form'],
  gaps:[],
  cases:[{
    schemaVersion:1,id:'invalid-password',version:1,title:'Sign in rejects an incorrect password',
    steps:[
      {id:'ready',op:'expectText',locator:{kind:'selector',value:'#ready'},expected:'Workspace ready',source:origin},
      {id:'email',op:'fill',locator:{kind:'label',value:'Email'},value:'buyer@example.test'},
      {id:'password',op:'fill',locator:{kind:'label',value:'Password'},value:'not-the-password'},
      {id:'submit',op:'click',locator:{kind:'role',value:'button',name:'Log in'}},
      {id:'message',op:'expectText',locator:{kind:'role',value:'alert'},expected:'Invalid password',source:origin},
      {id:'still-here',op:'expectURL',expected:url,source:origin}
    ]
  }]
});
const filterPlan=url=>({
  schemaVersion:1,
  id:'demo-filter',
  target:{url,budget:{assertionMs:15000,totalMs:40000}},
  scope:['Inventory filtering'],
  gaps:[],
  cases:[{
    schemaVersion:1,id:'category-filter',version:1,title:'Category filter narrows the inventory list',
    steps:[
      {id:'ready',op:'expectText',locator:{kind:'selector',value:'#ready'},expected:'Workspace ready',source:origin},
      {id:'category',op:'select',locator:{kind:'label',value:'Category'},value:'Home'},
      {id:'rows',op:'expectCount',locator:{kind:'selector',value:'#rows tr:not([hidden])'},expected:2,source:origin},
      {id:'search',op:'fill',locator:{kind:'label',value:'Search products'},value:'mug'},
      {id:'one-row',op:'expectCount',locator:{kind:'selector',value:'#rows tr:not([hidden])'},expected:1,source:origin},
      {id:'name',op:'expectText',locator:{kind:'selector',value:'#rows tr:not([hidden]) td:first-child'},expected:'Blue Mug',source:origin}
    ]
  }]
});

const root=await mkdtemp(join(tmpdir(),'webpilot-readme-'));
const app=await demoApp();
const browser=await chromium.launch();
const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:2,locale:'en-US',timezoneId:'UTC'});
const page=await context.newPage();
const shots=[];
const shot=async name=>{const path=join(out,`${name}.png`);await page.screenshot({path});shots.push(path);return path;};

const state=join(root,'dashboard');
const service=await startDashboard({root:state,port:0,defaultDataDir:join(root,'data')});
const clients=[];
const client=async dataDir=>{
  const c=new Client({name:'readme-demo',version:'1'});
  await c.connect(new StdioClientTransport({
    command:process.execPath,
    args:['dist/mcp/index.js'],
    env:{...process.env,WEBPILOT_DATA_DIR:dataDir,WEBPILOT_DASHBOARD_DIR:state,WEBPILOT_DASHBOARD:'1'},
    stderr:'pipe'
  }));
  clients.push(c);
  return c;
};
const waitForLive=async count=>{
  const deadline=Date.now()+20000;
  while(Date.now()<deadline){
    const seen=await page.locator('.live-stage img').count();
    if(seen>=count)return true;
    await pause(120);
  }
  return false;
};
try{
  const {token}=await internal({url:service.url,token:service.token},'/internal/bootstrap',{});
  await page.goto(`${service.url}/#access=${token}`);
  // The session token in the URL hash is consumed by the client on first paint;
  // wait for the shell before navigating anywhere else or the app has no session.
  await page.locator('.app-shell .main').first().waitFor({timeout:20000});

  // Run 1: slow conditional wait keeps the run visibly in progress.
  const a=await client(join(root,'data-a'));
  const runA=a.callTool({name:'suite_run',arguments:{plan:loginPlan(`${app.url}/?delay=4200`),headful:false}});
  const deadline=Date.now()+15000;
  while(!service.registry.runs.size&&Date.now()<deadline)await pause(50);
  const idA=[...service.registry.runs.keys()][0];

  // Live run detail while the browser is still mid-flow.
  await page.goto(`${service.url}/runs/${idA}`);
  await page.locator('.timeline').waitFor({timeout:20000});
  await waitForLive(1);
  await pause(700);
  await shot('c-live-detail');

  // Run 2, then both watched side by side while still executing.
  const b=await client(join(root,'data-b'));
  const runB=b.callTool({name:'suite_run',arguments:{plan:filterPlan(`${app.url}/?delay=2200`),headful:false}});
  const secondDeadline=Date.now()+15000;
  while(service.registry.runs.size<2&&Date.now()<secondDeadline)await pause(50);
  const ids=[...service.registry.runs.keys()];
  await page.goto(`${service.url}/compare?runs=${ids.join(',')}`);
  await waitForLive(2);
  await pause(700);
  await shot('a-compare-live');

  await Promise.all([runA,runB]);

  // Step results: click the assertion step so expected vs actual is on screen.
  await page.goto(`${service.url}/runs/${idA}`);
  await page.locator('.timeline').waitFor({timeout:20000});
  await page.locator('.timeline button.step').last().click();
  await page.locator('.step-detail').waitFor({timeout:10000});
  await pause(600);
  await shot('d-steps');

  // Coverage list: what was selected, added, and left as gaps.
  await page.locator('.detail-tabs button',{hasText:'覆盖清单'}).first().click();
  await pause(700);
  await shot('e-coverage');

  await page.goto(service.url);
  await page.locator('.run-grid').waitFor({timeout:15000});
  await pause(500);
  await shot('f-overview');

  console.log(JSON.stringify({frames:shots,service:service.url},null,2));
}finally{
  for(const c of clients)await c.close().catch(()=>{});
  await context.close();
  await service.close();
  await browser.close();
  await app.close();
  await rm(root,{recursive:true,force:true});
}
