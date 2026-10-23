import {spawn,execFile} from 'node:child_process';
import {readFile,mkdir,rm,open,stat,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {promisify} from 'node:util';
import {z} from 'zod';
import {dashboardRoot,atomicJson,jsonFile,privateDir,ownerAlive,processStamp} from './files.js';

const EndpointSchema=z.object({protocolVersion:z.number(),instance:z.string().uuid(),url:z.string().url().refine(s=>/^http:\/\/127\.0\.0\.1:\d+$/.test(s)),pid:z.number().int().positive(),nonce:z.string().uuid(),started:z.string().optional()}).strict();
export type Endpoint=z.infer<typeof EndpointSchema>&{token:string};
export async function endpointAt(root=dashboardRoot()):Promise<Endpoint|undefined>{
  try{const e=EndpointSchema.parse(await jsonFile(join(root,'endpoint.json')));const credentials=await jsonFile(join(root,'credentials.json'));if(credentials.instance!==e.instance||typeof credentials.token!=='string')return;return {...e,token:credentials.token};}catch{return;}
}
export async function internal<T=any>(e:Endpoint,path:string,body?:unknown):Promise<T>{
  const response=await fetch(e.url+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${e.token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(1500)});
  if(!response.ok)throw new Error(`Dashboard request failed (${response.status})`);return response.json() as Promise<T>;
}
export async function requireCoverageDashboard(e:Endpoint){
  const status=await internal(e,'/internal/status');
  if(status.instance!==e.instance||status.protocolVersion!==1||status.capabilities?.coveragePlanning!==1)throw new Error('测试中心暂不支持覆盖规划，请更新并重启测试中心；清单已保存在本地。');
  return e;
}
export async function dashboardStatus(root=dashboardRoot()){
  const e=await endpointAt(root);if(!e)return;
  try{const health=await internal(e,'/internal/status');if(health.instance!==e.instance)throw new Error('Dashboard identity mismatch');if(health.protocolVersion!==1||e.protocolVersion!==1)throw new Error('Dashboard protocol incompatible');return e;}catch(error){
    // A live, identified incompatible instance must never be replaced.
    if(String(error).includes('incompatible'))throw error;return;
  }
}
const pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
export async function ensureDashboard(root=dashboardRoot()):Promise<Endpoint>{
  await privateDir(root);const deadline=Date.now()+10000;const lock=join(root,'startup.lock');
  while(Date.now()<deadline){
    const current=await dashboardStatus(root);if(current)return current;
    const old=await endpointAt(root);
    if(old&&await ownerAlive(old)!==false)throw new Error('Existing Dashboard cannot be verified; refusing a competing service');
    const identity={pid:process.pid,nonce:randomUUID(),started:await processStamp()};let acquired=false;
    try{await mkdir(lock,{mode:0o700});acquired=true;await atomicJson(join(lock,'owner.json'),identity);}
    catch(error){
      if(acquired)throw error;
      try{const owner=await jsonFile(join(lock,'owner.json'));if(await ownerAlive(owner)===false){const again=await jsonFile(join(lock,'owner.json'));if(again.nonce===owner.nonce){const stale=`${lock}.${randomUUID()}.stale`;await rename(lock,stale);await rm(stale,{recursive:true,force:true});}}}catch{}
      await pause(100);continue;
    }
    try{
      const ready=await dashboardStatus(root);if(ready)return ready;
      const log=join(root,'service.log');try{if((await stat(log)).size>1024*1024)await rename(log,log+'.previous');}catch{}
      const output=await open(log,'a',0o600);
      const child=spawn(process.execPath,[fileURLToPath(new URL('./main.js',import.meta.url)),'--root',root],{detached:true,stdio:['ignore',output.fd,output.fd],env:{...process.env}});
      let launchError:Error|undefined;child.once('error',e=>{launchError=e;});child.unref();await output.close();
      while(Date.now()<deadline){if(launchError)throw launchError;const endpoint=await dashboardStatus(root);if(endpoint)return endpoint;if(child.exitCode!==null)break;await pause(100);}
      throw new Error('Dashboard startup timed out; see local service.log');
    }finally{try{if((await jsonFile(join(lock,'owner.json'))).nonce===identity.nonce)await rm(lock,{recursive:true,force:true});}catch{}}
  }
  throw new Error('Dashboard startup is busy');
}
export async function openDashboard(options:{root?:string;auto?:boolean;open?:boolean;force?:boolean;runId?:string}={}){
  const e=await ensureDashboard(options.root);const link=await internal<{token:string;lease?:string;shouldOpen:boolean}>(e,'/internal/bootstrap',{auto:options.auto??false,reserve:options.open!==false,force:options.force??false});
  const url=`${e.url}/${options.runId?`runs/${encodeURIComponent(options.runId)}`:''}#access=${encodeURIComponent(link.token)}`;
  let opened=false;
  if(options.open!==false&&link.shouldOpen){
    try{
      if(process.platform==='darwin')await promisify(execFile)('open',[url],{timeout:3000});
      else if(process.platform==='win32')await promisify(execFile)('rundll32',['url.dll,FileProtocolHandler',url],{timeout:3000});
      else {if(!process.env.DISPLAY&&!process.env.WAYLAND_DISPLAY)throw new Error('No graphical session');await promisify(execFile)('xdg-open',[url],{timeout:3000});}
      opened=true;
    }catch{}
    if(link.lease)await internal(e,'/internal/opened',{lease:link.lease,opened}).catch(()=>{});
  }
  return {dashboardUrl:url,runUrl:options.runId?url:undefined,opened,shouldOpen:link.shouldOpen};
}
export async function stopDashboard(root=dashboardRoot()){const e=await dashboardStatus(root);if(!e)return {stopped:false};await internal(e,'/internal/stop',{instance:e.instance});return {stopped:true};}
