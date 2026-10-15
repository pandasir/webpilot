import {access,mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {PlanSchema,HttpUrlSchema,BindingsSchema,VERSION,type Bindings} from '../core/schema.js';
import {assertPortable} from './redaction.js';
import {PilotError} from '../core/errors.js';

export async function exportPlan(input:unknown,output:string,bindings:Bindings={}){
  const plan=PlanSchema.parse(input);BindingsSchema.parse(bindings);assertPortable(plan,bindings);
  const destination=resolve(output);
  try{await access(destination);throw new PilotError('EXPORT_EXISTS','Output directory already exists; choose a new directory');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  await mkdir(destination,{recursive:true,mode:0o700});
  const builtRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  for(const dir of ['core','project','browser','artifacts'])await cp(join(builtRoot,dir),join(destination,'runtime',dir),{recursive:true,filter:src=>!src.endsWith('.map') && !src.endsWith('.d.ts')});
  const {url,projectPath,configPath,application,command,staticDir,data,...portableTarget}=plan.target;
  const externalData=!!(data.prepare || data.cleanup);
  const portablePlan={...plan,target:{...portableTarget,evidence:{...portableTarget.evidence,rawTrace:false}}};
  const references=new Set<string>();
  function refs(item:unknown){if(!item || typeof item!=='object')return;if(Array.isArray(item)){item.forEach(refs);return;}for(const [key,value] of Object.entries(item)){if((key==='ref' || key==='storageStateRef') && typeof value==='string')references.add(value);else refs(value);}}
  refs(portablePlan);
  const manifest={schemaVersion:1,generator:VERSION,verified:false,cases:plan.cases.map(c=>({id:c.id,version:c.version})),requiredReferences:[...references],externalData,requiresPrepare:!!data.prepare,requiresCleanup:!!data.cleanup,
    gaps:['Set BASE_URL to a ready target.',...plan.gaps,...plan.cases.flatMap(c=>c.steps.filter(s=>s.op==='unsupported').map(s=>`${c.id}/${s.id}: unsupported interaction`)),...(externalData?['Provide WEBPILOT_TARGET_CONFIG with equivalent data lifecycle.']:[])]};
  await writeFile(join(destination,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  await writeFile(join(destination,'plan.json'),JSON.stringify(portablePlan,null,2)+'\n',{flag:'wx',mode:0o600});
  await writeFile(join(destination,'package.json'),JSON.stringify({name:`webpilot-export-${plan.id}`,version:'1.0.0',private:true,type:'module',engines:{node:'>=22'},scripts:{test:'playwright test'},dependencies:{'@playwright/test':'1.60.0',playwright:'1.60.0',zod:'3.25.76'}},null,2)+'\n',{flag:'wx',mode:0o600});
  await writeFile(join(destination,'playwright.config.mjs'),`export default {testDir:'.',testMatch:'webpilot.spec.mjs',timeout:${plan.target.budget.totalMs+60000},workers:1,retries:0,reporter:'list'};\n`,{flag:'wx',mode:0o600});
  await writeFile(join(destination,'webpilot.spec.mjs'),`import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { runPlan } from './runtime/core/runner.js';
const plan=JSON.parse(await readFile(new URL('./plan.json',import.meta.url),'utf8'));
const manifest=JSON.parse(await readFile(new URL('./manifest.json',import.meta.url),'utf8'));
test(plan.id+': acceptance suite',async({},info)=>{
  if(!process.env.BASE_URL) throw new Error('Blocked: BASE_URL is required');
  const overrides=process.env.WEBPILOT_TARGET_CONFIG?JSON.parse(await readFile(process.env.WEBPILOT_TARGET_CONFIG,'utf8')):{};
  if(manifest.requiresPrepare && !overrides.data?.prepare) throw new Error('Blocked: equivalent data preparation is required');
  if(manifest.requiresCleanup && !overrides.data?.cleanup) throw new Error('Blocked: equivalent data cleanup is required');
  const bindings=process.env.WEBPILOT_BINDINGS_FILE?JSON.parse(await readFile(process.env.WEBPILOT_BINDINGS_FILE,'utf8')):{};
  const run=await runPlan({...plan,target:{...plan.target,...overrides,url:process.env.BASE_URL}},{dataDir:info.outputPath('webpilot-data'),bindings});
  await info.attach('acceptance-result',{body:JSON.stringify(run,null,2),contentType:'application/json'});
  info.annotations.push({type:'acceptance-status',description:run.outcome+(run.unstable?' (unstable)':'')});
  expect(run.exitCode,JSON.stringify(run.cases)).toBe(0);
});
`,{flag:'wx',mode:0o600});
  await writeFile(join(destination,'README.md'),`# Independent Playwright acceptance package\n\nInstall with \`npm ci --ignore-scripts\` after generating a lockfile, or \`npm install --ignore-scripts\`. Prepare Chromium with \`npx playwright install chromium\`. Run \`BASE_URL=http://localhost:3000 npm test\`.\n\nThis package includes a snapshot of the shared executor in runtime/, so it needs no WebPilot installation or model credentials. Business assertions, locator uniqueness, waiting, evidence policies and outcome classification use the same engine as the original assets.\n\nSupply secrets and file paths using WEBPILOT_BINDINGS_FILE (external JSON). Configure equivalent roles and data preparation/cleanup through WEBPILOT_TARGET_CONFIG. Missing prerequisites stay blockers in the attached acceptance result.\n\nExport starts unverified. Run against equivalent clean data before marking verified. Do not replace a failed assertion to obtain a passing result. Raw sensitive trace collection is disabled in the template.\n`,{flag:'wx',mode:0o600});
  return {directory:destination,manifest};
}
export async function verifyExport(directory:string,options:{url:string;bindingsFile?:string;targetConfig?:string;signal?:AbortSignal;timeoutMs?:number}){
  HttpUrlSchema.parse(options.url);
  const root=resolve(directory);const cli=join(root,'node_modules','@playwright','test','cli.js');
  try{await access(cli);}catch{throw new PilotError('EXPORT_DEPENDENCIES_MISSING','Install the exported package dependencies before verification');}
  const env={...process.env,BASE_URL:options.url,...(options.bindingsFile?{WEBPILOT_BINDINGS_FILE:resolve(options.bindingsFile)}:{}),...(options.targetConfig?{WEBPILOT_TARGET_CONFIG:resolve(options.targetConfig)}:{})};
  const plan=PlanSchema.parse(JSON.parse(await readFile(join(root,'plan.json'),'utf8')));
  const result=await new Promise<{code:number}>((ok,fail)=>{
    const child=spawn(process.execPath,[cli,'test'],{cwd:root,env,stdio:['ignore','ignore','ignore'],detached:process.platform!=='win32'});
    const stop=()=>{
      if(!child.pid)return;
      if(process.platform==='win32')spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{stdio:'ignore'});
      else try{process.kill(-child.pid,'SIGKILL');}catch{}
    };
    const timer=setTimeout(stop,options.timeoutMs ?? plan.target.budget.totalMs+60000);
    options.signal?.addEventListener('abort',stop,{once:true});if(options.signal?.aborted)stop();
    const clean=()=>{clearTimeout(timer);options.signal?.removeEventListener('abort',stop);};
    child.on('error',error=>{clean();fail(error);});child.on('close',code=>{clean();ok({code:code ?? 3});});
  });
  const path=join(root,'manifest.json');const manifest=JSON.parse(await readFile(path,'utf8'));manifest.verified=result.code===0;manifest.verification={date:new Date().toISOString(),exitCode:result.code};
  await writeFile(path,JSON.stringify(manifest,null,2)+'\n',{mode:0o600});return {manifest,exitCode:result.code};
}
