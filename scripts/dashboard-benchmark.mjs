import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {startDashboard} from '../dist/dashboard/server.js';
import {internal} from '../dist/dashboard/lifecycle.js';
import {fixture,plan,selector,source,loginSteps} from '../tests/helpers.mjs';

// Development benchmark: real independent executors and the shipped dashboard UI.
// CPU/RSS cover this Node process (dashboard + harness), not Chromium/executors.
const pause=ms=>new Promise(ok=>setTimeout(ok,ms));
const root=await mkdtemp(join(tmpdir(),'webpilot-dashboard-benchmark-'));
const target=await fixture();const browser=await chromium.launch();const samples=[];
const output=resolve(process.argv[2]??'.webpilot/reports/dashboard-acceptance/benchmark.json');
async function measure(watched,trial){
  const dir=join(root,`${trial}-${watched}`),state=join(dir,'state');const roots=[join(dir,'A'),join(dir,'B')];await Promise.all(roots.map(dir=>mkdir(dir,{recursive:true})));
  const service=await startDashboard({root:state,port:0,defaultDataDir:roots[0]});const clients=[];const page=await browser.newPage({viewport:{width:1440,height:1000}});let timer;
  try{
    await page.addInitScript(()=>{
      window.benchmarkFrames=[];
      const Native=window.WebSocket;
      window.WebSocket=class extends Native{
        constructor(...args){super(...args);this.addEventListener('message',event=>{
          if(!(event.data instanceof ArrayBuffer))return;
          const bytes=new Uint8Array(event.data);if(bytes.length<6)return;const length=new DataView(event.data).getUint32(0);
          try{const header=JSON.parse(new TextDecoder().decode(bytes.slice(4,4+length)));window.benchmarkFrames.push({id:header.runId,latencyMs:Date.now()-header.capturedAt});}catch{}
        });}
      };
    });
    const {token}=await internal({url:service.url,token:service.token},'/internal/bootstrap',{});await page.goto(`${service.url}/#access=${token}`);await page.getByRole('heading',{name:'每一次测试，都有迹可循。'}).waitFor();
    for(const dataDir of roots){const client=new Client({name:'dashboard-benchmark',version:'1'});await client.connect(new StdioClientTransport({command:process.execPath,args:['dist/mcp/index.js'],env:{...process.env,WEBPILOT_DATA_DIR:dataDir,WEBPILOT_DASHBOARD_DIR:state,WEBPILOT_DASHBOARD:'1'},stderr:'pipe'}));clients.push(client);}
    const rss=process.memoryUsage().rss;let peak=rss;timer=setInterval(()=>{peak=Math.max(peak,process.memoryUsage().rss);},50);const cpu=process.cpuUsage(),started=performance.now();
    const input=plan(target.url+'/?delay=2500',[{id:'wait',op:'expectText',locator:selector('#delay'),expected:'Ready',source},...loginSteps()],{budget:{assertionMs:10000,totalMs:20000}});
    const pending=clients.map(client=>client.callTool({name:'suite_run',arguments:{plan:input}}));
    if(watched){const deadline=Date.now()+10000;while(service.registry.runs.size<2&&Date.now()<deadline)await pause(20);assert.equal(service.registry.runs.size,2);const ids=[...service.registry.runs.keys()];await page.goto(`${service.url}/compare?runs=${ids.join(',')}`);await page.locator('.live-container').first().waitFor();}
    const runs=(await Promise.all(pending)).map(result=>result.structuredContent.data);const durationMs=Math.round(performance.now()-started);const used=process.cpuUsage(cpu);clearInterval(timer);
    assert.ok(runs.every(run=>run.outcome==='passed'));await pause(100);const frames=await page.evaluate(()=>window.benchmarkFrames);if(watched)assert.equal(new Set(frames.map(f=>f.id)).size,2);
    const latencies=frames.map(f=>f.latencyMs).sort((a,b)=>a-b);
    return {trial,watched,durationMs,cpuMicros:used,peakRssDeltaBytes:Math.max(0,peak-rss),frames:frames.length,latencyMs:latencies.length?{p50:latencies[Math.floor(latencies.length*.5)],p95:latencies[Math.min(latencies.length-1,Math.floor(latencies.length*.95))],max:latencies.at(-1)}:null};
  }finally{clearInterval(timer);await page.close();for(const client of clients)await client.close();await service.close();}
}
try{
  for(let trial=1;trial<=3;trial++)for(const watched of (trial%2?[false,true]:[true,false])){const sample=await measure(watched,trial);samples.push(sample);console.log(JSON.stringify(sample));}
  const average=(watched,key)=>Math.round(samples.filter(s=>s.watched===watched).reduce((sum,s)=>sum+s[key],0)/3);
  const baseline=average(false,'durationMs'),viewed=average(true,'durationMs');
  const report={date:new Date().toISOString(),platform:process.platform,arch:process.arch,node:process.version,scenario:'Two independent MCP executors, two 5-step suites, video enabled; overview baseline versus two live dashboard panels, three alternating pairs.',measurementScope:'CPU/RSS: dashboard and Node harness only; excludes both MCP executors and all Chromium processes. Frame latency: executor delivery timestamp to browser WebSocket receipt; excludes CDP acquisition and image paint. RSS deltas and local short-run timing are noisy, not an SLA.',summary:{baselineMeanMs:baseline,watchedMeanMs:viewed,durationChangePercent:Number(((viewed/baseline-1)*100).toFixed(2)),baselineMeanPeakRssDeltaBytes:average(false,'peakRssDeltaBytes'),watchedMeanPeakRssDeltaBytes:average(true,'peakRssDeltaBytes')},limits:{maxFrameBytes:2097152,maxConnectionBufferedBytes:2097152,maxFps:8,width:1280,height:720},samples};
  await mkdir(resolve(output,'..'),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(output);
}finally{await browser.close();await target.close();await rm(root,{recursive:true,force:true});}
