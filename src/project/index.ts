import { readFile, readdir, realpath } from 'node:fs/promises';
import { resolve, join, dirname, extname, relative, isAbsolute } from 'node:path';
import { createServer, type Server } from 'node:http';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { TargetSchema, type Target, type Command } from '../core/schema.js';
import { PilotError } from '../core/errors.js';

const execute=promisify(execFile);
export interface Inspection { target:Target; sources:Record<string,string>; candidates:{projectPath:string;script?:string;framework:string;url?:string}[]; gaps:string[]; ready:boolean }
async function text(path:string) { try{return await readFile(path,'utf8');}catch{return undefined;} }
function framework(pkg:Record<string,any>) {
  const deps={...pkg.dependencies,...pkg.devDependencies};
  return deps.next?'next':deps.vue?'vue':deps.react?'react':deps.svelte?'svelte':deps['@angular/core']?'angular':'unknown';
}
async function discover(root:string, depth=0):Promise<Inspection['candidates']> {
  const candidates:Inspection['candidates']=[];
  const contents=await text(join(root,'package.json'));
  if(contents) {
    try {
      const pkg=JSON.parse(contents);
      for(const [name,command] of Object.entries(pkg.scripts ?? {})) {
        if(['dev','start','serve'].includes(name) && typeof command==='string') {
          const port=command.match(/(?:--port(?:=|\s+)|-p\s+)(\d+)/)?.[1];
          const detected=framework(pkg);
          const defaultPort=detected==='next'?'3000':/\bvite\b/.test(command)?'5173':undefined;
          candidates.push({projectPath:root,script:name,framework:detected,...((port || defaultPort)?{url:`http://localhost:${port ?? defaultPort}`}:{})});
        }
      }
    } catch { /* Malformed packages are reported as unavailable discovery. */ }
  }
  if(depth<3) {
    let entries:Awaited<ReturnType<typeof readdir>>=[];
    try { entries=await readdir(root,{withFileTypes:true}) as any; }catch{return candidates;}
    for(const entry of entries as any[]) {
      if(!entry.isDirectory() || entry.name.startsWith('.') || ['node_modules','dist','build','coverage'].includes(entry.name)) continue;
      if(depth===0 && !['apps','packages','frontend','client','web','examples'].includes(entry.name)) continue;
      candidates.push(...await discover(join(root,entry.name),depth+1));
    }
  }
  return candidates;
}
export async function inspectProject(input:unknown):Promise<Inspection> {
  const supplied=TargetSchema.partial().parse(input);
  const projectPath=supplied.projectPath?resolve(supplied.projectPath):undefined;
  let configured:Record<string,unknown>={};
  let configFile=supplied.configPath?resolve(supplied.configPath):projectPath?join(projectPath,'webpilot.config.json'):undefined;
  if(configFile) {
    const content=await text(configFile);
    if(content) configured=JSON.parse(content);
    else if(supplied.configPath) throw new PilotError('CONFIG_MISSING',`Configuration is unavailable: ${configFile}`);
  }
  const sources:Record<string,string>={};
  // Parse raw input before applying defaults, so defaults never overwrite configured values.
  const raw=input as Record<string,unknown>;
  const merged={...configured,...raw,...(projectPath?{projectPath}:{})};
  for(const key of Object.keys(merged)) sources[key]=key in raw?'explicit':'config';
  let target=TargetSchema.parse(merged);
  let candidates=projectPath?await discover(projectPath):[];
  if(target.application) candidates=candidates.filter(c=>relative(projectPath!,c.projectPath)===target.application || c.projectPath===resolve(projectPath!,target.application!));
  const gaps:string[]=[];
  if(!target.url && candidates.length===1) {
    const candidate=candidates[0];
    let executable='npm',args=['run',candidate.script!];
    if(await text(join(projectPath!,'pnpm-lock.yaml'))){executable='pnpm';args=['run',candidate.script!];}
    else if(await text(join(projectPath!,'yarn.lock'))){executable='yarn';args=[candidate.script!];}
    else if(await text(join(projectPath!,'bun.lockb')) || await text(join(projectPath!,'bun.lock'))){executable='bun';args=['run',candidate.script!];}
    target=TargetSchema.parse({...target,url:candidate.url,command:target.command ?? {executable,args,cwd:candidate.projectPath},projectPath:candidate.projectPath});
    sources.command=sources.command ?? 'discovery';sources.url='discovery';
  }
  if(!target.url && projectPath) {
    const readme=await text(join(projectPath,'README.md'));
    const urls=[...new Set(readme?.match(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+/g) ?? [])];
    if(urls.length===1 && (target.command || !candidates.length)){target.url=urls[0];sources.url='README';}
  }
  if(!target.url && !target.staticDir) gaps.push(candidates.length>1?'Select an application/startup candidate, or supply an explicit URL.':'Provide a URL and startup command, or a staticDir.');
  if(!projectPath) gaps.push('Source and Git impact analysis unavailable for URL-only target.');
  if(target.command && !target.command.cwd) target.command.cwd=target.projectPath;
  return {target,sources,candidates,gaps,ready:!!target.url || !!target.staticDir};
}

export async function runCommand(command:Command, signal?:AbortSignal) {
  return await new Promise<{stdout:string}>((ok,fail)=>{
    const child=spawn(command.executable,command.args,{cwd:command.cwd,stdio:['ignore','pipe','pipe'],shell:false,detached:process.platform!=='win32'});
    let output='';let settled=false;let stopping=false;
    const complete=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?fail(error):ok({stdout:output});};
    child.stdout?.on('data',b=>output=(output+b.toString()).slice(-8000));
    child.stderr?.on('data',b=>output=(output+b.toString()).slice(-8000));
    child.on('error',e=>complete(new PilotError('COMMAND_FAILED',e.message)));
    child.on('close',code=>{if(!stopping)complete(code===0?undefined:new PilotError('COMMAND_FAILED',`Command exited ${code}: ${output}`));});
    const terminate=(error:PilotError)=>{if(settled || stopping)return;stopping=true;void stopChild(child).then(()=>complete(error));};
    const abort=()=>terminate(new PilotError('CANCELLED','Command cancelled','inconclusive'));
    const timer=setTimeout(()=>terminate(new PilotError('COMMAND_TIMEOUT',`Command exceeded ${command.timeoutMs}ms`)),command.timeoutMs);
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  });
}
async function stopChild(child:ChildProcess) {
  if(!child.pid)return;
  if(process.platform==='win32') {
    await execute('taskkill',['/pid',String(child.pid),'/T','/F']).catch(()=>{});return;
  }
  try{process.kill(-child.pid,'SIGTERM');}catch{return;}
  // The owned group id cannot be used after this instance is released.
  await new Promise<void>(r=>setTimeout(r,150));
  try{process.kill(-child.pid,'SIGKILL');}catch{}
}
async function reachable(target:Target) {
  if(!target.url)return false;
  try {
    const response=await fetch(new URL(target.ready.path,target.url),{signal:AbortSignal.timeout(1000),redirect:'manual'});
    await response.body?.cancel();return target.ready.statuses.includes(response.status);
  } catch {return false;}
}
export async function prepareService(inspection:Inspection, signal?:AbortSignal) {
  const target=structuredClone(inspection.target);
  if(!inspection.ready) throw new PilotError('TARGET_AMBIGUOUS',inspection.gaps.join(' '));
  let server:Server|undefined,child:ChildProcess|undefined;
  let output='',startupError:Error|undefined;
  const close=async()=>{if(server){server.closeAllConnections();await new Promise<void>(r=>server!.close(()=>r()));}if(child)await stopChild(child);};
  try {
    if(target.url && await reachable(target)) return {target,sources:inspection.sources,owned:false,close};
    if(target.staticDir) {
      const root=await realpath(resolve(target.projectPath ?? process.cwd(),target.staticDir));
      server=createServer(async(req,res)=>{
        try {
          const requested=decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
          const filepath=await realpath(join(root,requested==='/'?'index.html':requested));
          const rel=relative(root,filepath);if(rel.startsWith('..') || isAbsolute(rel)){res.writeHead(403);res.end();return;}
          const mime:Record<string,string>={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
          res.setHeader('Content-Type',mime[extname(filepath)] ?? 'application/octet-stream');res.end(await readFile(filepath));
        }catch{res.writeHead(404);res.end('Not found');}
      });
      await new Promise<void>((ok,fail)=>{server!.once('error',fail);server!.listen(0,'127.0.0.1',ok);});
      const address=server.address();target.url=`http://127.0.0.1:${typeof address==='object' && address?address.port:0}`;
    } else if(target.command) {
      child=spawn(target.command.executable,target.command.args,{cwd:target.command.cwd,stdio:['ignore','pipe','pipe'],shell:false,detached:process.platform!=='win32'});
      child.stdout?.on('data',b=>output=(output+b.toString()).slice(-4000));child.stderr?.on('data',b=>output=(output+b.toString()).slice(-4000));child.on('error',e=>startupError=e);
    } else throw new PilotError('SERVICE_UNAVAILABLE','No ready service. Provide a startup command or start the target.');
    const deadline=Date.now()+target.ready.timeoutMs;
    while(!await reachable(target)) {
      if(signal?.aborted)throw new PilotError('CANCELLED','Startup cancelled','inconclusive');
      if(startupError || (child && child.exitCode!==null))throw new PilotError('STARTUP_FAILED',`Service failed to start: ${startupError?.message ?? output}`);
      if(Date.now()>deadline)throw new PilotError('STARTUP_TIMEOUT',`Service did not become ready: ${output}`);
      await new Promise<void>(r=>setTimeout(r,100));
    }
    return {target,sources:inspection.sources,owned:true,close};
  } catch(error){await close();throw error;}
}

export async function collectContext(input:{projectPath?:string;requirements?:string[];diffRef?:string}) {
  const result:{requirements:string[];documents:{path:string;content:string}[];git?:{revision:string;diff:string};gaps:string[]}={requirements:input.requirements ?? [],documents:[],gaps:[]};
  if(!input.projectPath){result.gaps.push('Source, routes and Git analysis unavailable.');return result;}
  const root=resolve(input.projectPath);
  for(const name of ['README.md','package.json']) {const content=await text(join(root,name));if(content)result.documents.push({path:name,content:content.slice(0,20000)});}
  async function walk(dir:string,depth=0) {
    if(depth>4)return;
    let entries;try{entries=await readdir(dir,{withFileTypes:true});}catch{return;}
    for(const entry of entries){
      if(entry.isDirectory()){if(!['node_modules','.git'].includes(entry.name))await walk(join(dir,entry.name),depth+1);}
      else if(/\.(md|json)$/.test(entry.name) && result.documents.length<30){const content=await text(join(dir,entry.name));if(content)result.documents.push({path:relative(root,join(dir,entry.name)),content:content.slice(0,15000)});}
    }
  }
  await walk(join(root,'openspec'));await walk(join(root,'tests'));
  try{
    const revision=(await execute('git',['rev-parse','HEAD'],{cwd:root})).stdout.trim();
    const args=input.diffRef?['diff','--no-ext-diff',input.diffRef,'--']:['diff','--no-ext-diff','HEAD','--'];
    const diff=(await execute('git',args,{cwd:root,maxBuffer:1000000})).stdout.slice(0,50000);result.git={revision,diff};
  }catch{result.gaps.push('Git revision/diff unavailable.');}
  result.gaps.push('Route/component impact is a hypothesis to ground in relevant source; discovery does not establish complete coverage.');
  return result;
}
