import { access, mkdir, writeFile, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { VERSION } from './schema.js';
import { PilotError } from './errors.js';

export function dataRoot(override?:string, os=platform()) {
  if(override || process.env.WEBPILOT_DATA_DIR) return resolve(override ?? process.env.WEBPILOT_DATA_DIR!);
  const root = os==='darwin' ? join(homedir(),'Library','Caches') : os==='win32' ? process.env.LOCALAPPDATA ?? join(homedir(),'AppData','Local') : process.env.XDG_CACHE_HOME ?? join(homedir(),'.cache');
  return join(root,'webpilot');
}
export async function doctor(options:{dataDir?:string,nodeVersion?:string,browserPath?:string}={}) {
  const version=options.nodeVersion ?? process.versions.node;
  const root=dataRoot(options.dataDir);
  const checks:{name:string;ready:boolean;message:string}[]=[{name:'node',ready:Number(version.split('.')[0])>=22,message:`Node ${version}; requires >=22`}];
  const { chromium }=await import('playwright');
  const browser=options.browserPath ?? chromium.executablePath();
  try { await access(browser,constants.X_OK);checks.push({name:'browser',ready:true,message:browser}); }
  catch {checks.push({name:'browser',ready:false,message:'Chromium unavailable. Run webpilot setup.'});}
  try {
    await mkdir(root,{recursive:true,mode:0o700});
    const probe=join(root,`.probe-${randomUUID()}`);await writeFile(probe,'',{flag:'wx',mode:0o600});await unlink(probe);
    checks.push({name:'storage',ready:true,message:root});
  } catch { checks.push({name:'storage',ready:false,message:`Storage is not writable: ${root}`}); }
  return {apiVersion:1,version:VERSION,ready:checks.every(c=>c.ready),checks,dataDir:root};
}
export async function setup(options:{dataDir?:string}={}) {
  const require=createRequire(import.meta.url);
  const cli=join(dirname(require.resolve('playwright/package.json')),'cli.js');
  await new Promise<void>((ok,fail)=>{
    const child=spawn(process.execPath,[cli,'install','chromium'],{stdio:['ignore','ignore','pipe']});
    let diagnostic='';child.stderr?.on('data',b=>diagnostic=(diagnostic+b.toString()).slice(-4000));
    child.on('error',fail);child.on('exit',code=>code===0?ok():fail(new PilotError('SETUP_FAILED',`Browser setup failed (${code}): ${diagnostic}`)));
  });
  return doctor(options);
}
