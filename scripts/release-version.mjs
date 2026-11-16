import {readFile,writeFile,mkdir,rename,realpath} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';

export const repositoryRoot=fileURLToPath(new URL('../',import.meta.url));
const identifier='(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)';
const semver=new RegExp(`^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-${identifier}(?:\\.${identifier})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`);
export function validVersion(value){return typeof value==='string'&&value.trim()===value&&semver.test(value);}
async function json(root,file){try{return JSON.parse(await readFile(join(root,file),'utf8'));}catch(error){throw new Error(`${file}: cannot read valid JSON (${error.message})`);}}
const mirrors=packaged=>[['package-lock.json','version'],['package-lock.json','packages..version'],['plugin.json','version'],[packaged?'.codex-plugin/plugin.json':'plugin-compat.json','version']];
const valueAt=(data,field)=>field==='packages..version'?data?.packages?.['']?.version:data?.version;
const label=field=>field==='packages..version'?'packages[""].version':field;

export async function sourceVersion(root=repositoryRoot){
  const value=(await json(root,'package.json'))?.version;
  if(!validVersion(value))throw new Error(`package.json.version: expected a valid SemVer release, got ${JSON.stringify(value)}`);
  return value;
}

export async function checkSourceVersions(root=repositoryRoot,{packaged=false}={}){
  const expected=await sourceVersion(root),errors=[];
  for(const [file,field]of mirrors(packaged)){
    try{const actual=valueAt(await json(root,file),field);if(!validVersion(actual)||actual!==expected)errors.push(`${file}.${label(field)}: expected ${expected}, got ${JSON.stringify(actual)}`);}
    catch(error){errors.push(error.message);}
  }
  if(errors.length)throw new Error(`Release versions are inconsistent:\n${errors.join('\n')}\nRun npm run version:sync explicitly, then rebuild.`);
  return expected;
}

async function atomicJson(file,data){
  await mkdir(dirname(file),{recursive:true});const temporary=`${file}.${randomUUID()}.tmp`;
  await writeFile(temporary,JSON.stringify(data,null,2)+'\n');await rename(temporary,file);
}

export async function syncVersions(root=repositoryRoot){
  const version=await sourceVersion(root),files=new Map();
  // Read and validate every mirror before touching any file. Missing structures
  // are errors, rather than a reason to regenerate the dependency lock.
  for(const [file,field]of mirrors(false)){
    const data=files.get(file)??await json(root,file);
    if(typeof valueAt(data,field)!=='string')throw new Error(`${file}.${label(field)}: missing version field`);
    files.set(file,data);
  }
  for(const [file,data]of files){data.version=version;if(file==='package-lock.json')data.packages[''].version=version;await atomicJson(join(root,file),data);}
  return version;
}

export async function generateVersion(root=repositoryRoot){
  const version=await checkSourceVersions(root);await atomicJson(join(root,'dist/core/release.json'),{schemaVersion:1,version});return version;
}

export async function checkBuiltVersion(root=repositoryRoot,options={}){
  const expected=await checkSourceVersions(root,options);
  const snapshot=await json(root,'dist/core/release.json');
  if(snapshot.schemaVersion!==1||!validVersion(snapshot.version)||snapshot.version!==expected)throw new Error(`dist/core/release.json.version: expected ${expected}, got ${JSON.stringify(snapshot.version)}; run npm run build.`);
  const modules=['version','schema'].map(name=>pathToFileURL(join(root,`dist/core/${name}.js`)).href);
  let values;
  try{
    const result=await promisify(execFile)(process.execPath,['--input-type=module','-e',
      'const values=await Promise.all(process.argv.slice(1).map(async path=>(await import(path)).VERSION));process.stdout.write(JSON.stringify(values));',...modules],{cwd:root,timeout:10000,maxBuffer:1024*1024});
    values=JSON.parse(result.stdout);
  }catch(error){throw new Error(`Cannot read the compiled WebPilot version; run npm run build or reinstall a complete package. ${error.stderr??error.message}`);}
  if(values.some(value=>value!==expected))throw new Error(`Compiled VERSION: expected ${expected}, got ${JSON.stringify(values)}; run npm run build.`);
  return expected;
}

export async function checkPackagedVersion(root){return checkBuiltVersion(root,{packaged:true});}

if(process.argv[1]&&(await realpath(resolve(process.argv[1])).catch(()=>undefined))===await realpath(fileURLToPath(import.meta.url))){
  try{
    const [mode='check',...flags]=process.argv.slice(2);
    if(flags.some(flag=>flag!=='--built')||(mode!=='check'&&flags.length))throw new Error('Use release-version.mjs check [--built] | sync | generate');
    const version=mode==='sync'?await syncVersions():mode==='generate'?await generateVersion():mode==='check'?await (flags.includes('--built')?checkBuiltVersion():checkSourceVersions()):undefined;
    if(!version)throw new Error('Use release-version.mjs check [--built] | sync | generate');
    console.log(JSON.stringify({version,mode,built:flags.includes('--built')}));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
