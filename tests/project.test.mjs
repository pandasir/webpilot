import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {inspectProject,prepareService,collectContext,runCommand} from '../dist/project/index.js';
import {CommandSchema} from '../dist/core/schema.js';
import {fixture} from './helpers.mjs';

test('explicit configuration wins, unknown frameworks work and monorepo ambiguity is visible',async()=>{
  const root=await mkdtemp(join(tmpdir(),'webpilot-project-'));try{
    await writeFile(join(root,'webpilot.config.json'),JSON.stringify({url:'http://localhost:9999',viewport:{width:400,height:800}}));
    const inspected=await inspectProject({projectPath:root,url:'http://localhost:5555'});assert.equal(inspected.target.url,'http://localhost:5555');assert.equal(inspected.target.viewport.width,400);assert.equal(inspected.sources.url,'explicit');
    await rm(join(root,'webpilot.config.json'));
    for(const name of ['a','b']){const dir=join(root,'apps',name);await mkdir(dir,{recursive:true});await writeFile(join(dir,'package.json'),JSON.stringify({scripts:{dev:'unknown-server'}}));}
    const ambiguous=await inspectProject({projectPath:root});assert.equal(ambiguous.ready,false);assert.equal(ambiguous.candidates.length,2);
    const selected=await inspectProject({projectPath:root,application:'apps/a',url:'http://localhost:1234'});assert.equal(selected.ready,true);
    const context=await collectContext({projectPath:root,requirements:['Verify feature']});assert.ok(context.gaps.some(g=>g.includes('Git')));
    assert.deepEqual((await collectContext({})).documents,[]);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('cancelled and timed-out data commands stop before subsequent cleanup work',async()=>{
 const root=await mkdtemp(join(tmpdir(),'webpilot-command-'));
 try{
  const marker=join(root,'late.txt');
  const command=CommandSchema.parse({executable:process.execPath,args:['-e',`setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'late'),300);setInterval(()=>{},1000)`],timeoutMs:1000});
  const controller=new AbortController();setTimeout(()=>controller.abort(),100);
  await assert.rejects(()=>runCommand(command,controller.signal),e=>e.code==='CANCELLED');
  await new Promise(r=>setTimeout(r,150));await assert.rejects(()=>readFile(marker));
  await assert.rejects(()=>runCommand({...command,timeoutMs:100}),e=>e.code==='COMMAND_TIMEOUT');
  await new Promise(r=>setTimeout(r,150));await assert.rejects(()=>readFile(marker));
 }finally{await rm(root,{recursive:true,force:true});}
});
test('static services are scoped, reused services survive and owned startup failure is bounded',async()=>{
  const f=await fixture();try{
    const reused=await prepareService(await inspectProject({url:f.url}));assert.equal(reused.owned,false);await reused.close();assert.equal((await fetch(f.url)).status,200);
    const staticDir=join(f.dataDir,'static');await mkdir(staticDir);await writeFile(join(staticDir,'index.html'),'<h1>Static</h1>');
    const managed=await prepareService(await inspectProject({staticDir}));assert.equal(managed.owned,true);assert.equal((await fetch(managed.target.url)).status,200);await managed.close();await assert.rejects(()=>fetch(managed.target.url));
    const neverReady=await inspectProject({url:'http://127.0.0.1:1',ready:{timeoutMs:200},command:{executable:process.execPath,args:['-e','setInterval(()=>{},1000)']}});
    await assert.rejects(()=>prepareService(neverReady),/did not become ready/);
  }finally{await f.close();}
});
