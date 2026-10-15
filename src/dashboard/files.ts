import {mkdir,writeFile,rename,readFile,open,realpath,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {RunMeta} from './protocol.js';

export function dashboardRoot(override?:string){
  if(override||process.env.WEBPILOT_DASHBOARD_DIR)return resolve(override??process.env.WEBPILOT_DASHBOARD_DIR!);
  const base=process.platform==='darwin'?join(homedir(),'Library','Application Support'):process.platform==='win32'?process.env.LOCALAPPDATA??join(homedir(),'AppData','Local'):process.env.XDG_STATE_HOME??join(homedir(),'.local','state');
  return join(base,'webpilot','dashboard');
}
export async function atomicJson(path:string,value:unknown){
  const temp=`${path}.${randomUUID()}.tmp`;await writeFile(temp,JSON.stringify(value)+'\n',{mode:0o600});await rename(temp,path);
}
export async function jsonFile(path:string):Promise<any>{return JSON.parse(await readFile(path,'utf8'));}
export async function privateDir(path:string){await mkdir(path,{recursive:true,mode:0o700});}
export async function processStamp(pid=process.pid):Promise<string|undefined>{
  try{
    if(process.platform==='win32')return undefined;
    return (await promisify(execFile)('ps',['-p',String(pid),'-o','lstart='],{timeout:1000})).stdout.trim()||undefined;
  }catch{return undefined;}
}
export function alive(pid:number){try{process.kill(pid,0);return true;}catch(e){return (e as NodeJS.ErrnoException).code==='EPERM';}}
export async function ownerAlive(owner:RunMeta['owner']):Promise<boolean|undefined>{
  if(!alive(owner.pid))return false;
  const stamp=await processStamp(owner.pid);return owner.started&&stamp?owner.started===stamp:undefined;
}
export function within(root:string,file:string){const part=relative(root,file);return !isAbsolute(part)&&part!=='..'&&!part.startsWith(`..${process.platform==='win32'?'\\':'/'}`);}
// Open the resolved file, reject every symlink component, then compare the descriptor
// with the path again. Never expose paths supplied by an HTTP caller.
export async function openArtifact(root:string,file:string){
  const logical=resolve(root);const base=await realpath(root);const requested=resolve(file);if(!within(logical,requested))throw new Error('Outside run');
  const absolute=join(base,relative(logical,requested));
  let current=base;
  for(const part of relative(base,absolute).split(/[\\/]/)){current=join(current,part);if((await lstat(current)).isSymbolicLink())throw new Error('Symlink artifact');}
  const actual=await realpath(absolute);if(actual!==absolute||!within(base,actual))throw new Error('Invalid artifact');
  const handle=await open(actual,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{const a=await handle.stat();const b=await lstat(absolute);if(!a.isFile()||a.dev!==b.dev||a.ino!==b.ino||await realpath(absolute)!==actual)throw new Error('Artifact changed');return {handle,stat:a};}
  catch(e){await handle.close();throw e;}
}
