import {cp,mkdir,readFile,writeFile,access,mkdtemp,rename,rm,lstat,realpath,readdir} from 'node:fs/promises';
import {resolve,join,dirname,basename,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {repositoryRoot,checkBuiltVersion,checkPackagedVersion} from './release-version.mjs';

const entries=['plugin.json','mcp.json','package.json','package-lock.json','README.md','dist','node_modules','skills','docs'];
const within=(base,path)=>{const rel=relative(base,path);return !isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('../')&&!rel.startsWith('..\\');};
async function canonicalLocation(path){
  try{return await realpath(path);}catch(error){const parent=dirname(path);if(error.code!=='ENOENT'||parent===path)throw error;return join(await canonicalLocation(parent),basename(path));}
}
async function safeDestination(root,destination){
  try{if((await lstat(destination)).isSymbolicLink())throw new Error('Existing marketplace must be a real directory');}catch(error){if(error.code!=='ENOENT')throw error;}
  const source=await realpath(root),target=await canonicalLocation(destination);
  if(within(target,source)||entries.some(entry=>within(join(source,entry),target)))throw new Error('Marketplace destination must not replace the source repository or reside inside copied source files/directories');
}

export async function stageMarketplace({root=repositoryRoot,destination=join(root,'.webpilot','marketplace')}={}){
  root=resolve(root);destination=resolve(destination);await safeDestination(root,destination);
  const version=await checkBuiltVersion(root);
  for(const file of ['dist/mcp/index.js','dist/cli/index.js','dist/dashboard/public/index.html'])await access(join(root,file));
  await mkdir(dirname(destination),{recursive:true});
  const stage=await mkdtemp(join(dirname(destination),`.${basename(destination)}-stage-`)),plugin=join(stage,'plugins','webpilot');
  try{
    await mkdir(plugin,{recursive:true});
    for(const entry of entries)await cp(join(root,entry),join(plugin,entry),{recursive:true});
    await mkdir(join(plugin,'.codex-plugin'),{recursive:true});
    await cp(join(root,'plugin-compat.json'),join(plugin,'.codex-plugin','plugin.json'));
    const mcp=JSON.parse(await readFile(join(root,'mcp.json'),'utf8'));
    for(const server of Object.values(mcp.mcpServers))delete server.type;
    delete mcp.$schema;
    await writeFile(join(plugin,'.mcp.json'),JSON.stringify(mcp,null,2)+'\n');
    await mkdir(join(stage,'.agents','plugins'),{recursive:true});
    await writeFile(join(stage,'.agents','plugins','marketplace.json'),JSON.stringify({
      name:'webpilot-local',interface:{displayName:'WebPilot Local'},plugins:[{
        name:'webpilot',source:{source:'local',path:'./plugins/webpilot'},
        policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Developer Tools'
      }]
    },null,2)+'\n');
    return {root,destination,stage,version};
  }catch(error){await rm(stage,{recursive:true,force:true});throw error;}
}

export async function publishMarketplace({root,destination,stage,version}){
  await safeDestination(root,destination);
  const actual=await checkPackagedVersion(join(stage,'plugins','webpilot'));
  if(actual!==version)throw new Error(`Staged executor version: expected ${version}, got ${actual}`);
  let existing=false;
  try{const stat=await lstat(destination);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Existing marketplace must be a real directory');existing=true;}
  catch(error){if(error.code!=='ENOENT')throw error;}
  if(existing&&(await readdir(destination)).length){
    let owned=false;
    try{
      const catalog=JSON.parse(await readFile(join(destination,'.agents/plugins/marketplace.json'),'utf8'));
      const plugin=JSON.parse(await readFile(join(destination,'plugins/webpilot/plugin.json'),'utf8'));
      owned=catalog.name==='webpilot-local'&&catalog.plugins?.length===1&&catalog.plugins[0].name==='webpilot'&&catalog.plugins[0].source?.source==='local'&&catalog.plugins[0].source?.path==='./plugins/webpilot'&&plugin.name==='webpilot';
    }catch{/* An unrelated directory is never replaced. */}
    if(!owned)throw new Error('Existing destination is not a WebPilot Local marketplace; choose an empty or new directory');
  }
  const backup=join(dirname(destination),`.${basename(destination)}-previous-${randomUUID()}`);
  if(existing)await rename(destination,backup);
  try{await rename(stage,destination);}
  catch(error){if(existing)await rename(backup,destination);throw error;}
  if(existing)await rm(backup,{recursive:true,force:true});
  return {marketplace:destination,plugin:join(destination,'plugins','webpilot')};
}

export async function packagePlugin(options){
  const candidate=await stageMarketplace(options);
  try{return await publishMarketplace(candidate);}finally{await rm(candidate.stage,{recursive:true,force:true});}
}

if(process.argv[1]&&(await realpath(resolve(process.argv[1])).catch(()=>undefined))===await realpath(fileURLToPath(import.meta.url))){
  try{console.log(JSON.stringify(await packagePlugin({destination:resolve(process.argv[2]??'.webpilot/marketplace')})));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
