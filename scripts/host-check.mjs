import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {resolve,join} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {mkdtemp,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {fixture,plan,loginSteps} from '../tests/helpers.mjs';

const marketplace=resolve(process.argv[2] ?? '.webpilot/marketplace');
const child=spawn('codex',['app-server'],{cwd:marketplace,stdio:['pipe','pipe','pipe']});
const pending=new Map();let sequence=0;
const reader=createInterface({input:child.stdout});
reader.on('line',line=>{
  let message;try{message=JSON.parse(line);}catch{return;}
  if(message.id!==undefined && pending.has(message.id)) {
    const item=pending.get(message.id);pending.delete(message.id);
    clearTimeout(item.timer);message.error?item.reject(new Error(JSON.stringify(message.error))):item.resolve(message.result);
  }
});
child.stderr.resume();
function rpc(method,params) {
  const id=++sequence;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Host timed out: ${method}`));},20000);
    pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');
  });
}
try {
  await rpc('initialize',{clientInfo:{name:'webpilot-integration-check',version:'0.1.0'},capabilities:{experimentalApi:true}});
  child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
  const plugin=await rpc('plugin/read',{marketplacePath:join(marketplace,'.agents','plugins','marketplace.json'),pluginName:'webpilot'});
  console.log(JSON.stringify({check:'fresh-codex-host-plugin-read',result:plugin},null,2));
  const skills=await rpc('skills/list',{cwds:[resolve('.')],forceReload:true});
  const installedSkills=skills.data.flatMap(d=>d.skills).filter(s=>s.pluginId?.includes('webpilot') || s.name.startsWith('webpilot:'));
  console.log(JSON.stringify({check:'fresh-host-installed-skills',skills:installedSkills.map(s=>({name:s.name,path:s.path,enabled:s.enabled}))},null,2));
  const status=await rpc('mcpServerStatus/list',{serverName:'webpilot',limit:100});
  console.log(JSON.stringify({check:'host-installed-mcp-inventory',servers:status.data.map(s=>({name:s.name,tools:Object.keys(s.tools),toolsError:s.toolsError}))},null,2));
  const dataDir=await mkdtemp(join(tmpdir(),'webpilot-host-check-'));
  const installedRoot=installedSkills.length?resolve(installedSkills[0].path,'../../..'):join(marketplace,'plugins','webpilot');
  const transport=new StdioClientTransport({command:process.execPath,args:['./dist/mcp/index.js'],cwd:installedRoot,env:{...process.env,WEBPILOT_DATA_DIR:dataDir},stderr:'pipe'});
  const client=new Client({name:'webpilot-host-check',version:'0.1.0'});
  try {
    await client.connect(transport);
    const inventory=await client.listTools();
    const tool=await client.callTool({name:'runtime_info',arguments:{}});
    console.log(JSON.stringify({check:'packaged-stdio-handshake',tools:inventory.tools.map(t=>t.name),response:tool},null,2));
    if(process.argv.includes('--workflow')){
      const f=await fixture();
      try{
        const call=async(name,args)=>{const result=await client.callTool({name,arguments:args});assert.ok(!result.isError,JSON.stringify(result));return result.structuredContent.data;};
        const inspection=await call('project_inspect',{target:{url:f.url}});assert.equal(inspection.ready,true);
        const p=plan(f.url,loginSteps());const run=await call('suite_run',{plan:p});assert.equal(run.exitCode,0);
        const saved=await call('case_save',{case:p.cases[0],target:p.target,promote:true});assert.equal(saved.case.state,'regression-ready');
        const failed=await call('suite_run',{plan:{...p,target:{...p.target,url:f.url+'/?defect=button'}}});assert.equal(failed.outcome,'failed');
        const report=await call('report_read',{runId:failed.id});assert.equal(report.cases[0].attempts[0].steps.at(-1).error.code,'ASSERTION_FAILED');
        const exported=await call('case_export',{plan:p,output:join(f.dataDir,'export')});
        for(const name of ['@playwright/test','playwright','playwright-core','zod'])await cp(resolve('node_modules',name),join(exported.directory,'node_modules',name),{recursive:true});
        const verified=await call('export_verify',{directory:exported.directory,url:f.url});assert.equal(verified.manifest.verified,true);
        console.log(JSON.stringify({check:'packaged-workflow',acceptance:run.outcome,caseState:saved.case.state,diagnosis:report.outcome,exportVerified:verified.manifest.verified},null,2));
      }finally{await f.close();}
    }
  } finally {await client.close();}
} finally {
  for(const item of pending.values()){clearTimeout(item.timer);item.reject(new Error('Host check closed'));}
  reader.close();child.kill();
}
