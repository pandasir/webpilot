import {mkdir,lstat,realpath,writeFile,rename,rm,readdir} from 'node:fs/promises';
import {join,resolve,dirname,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {atomicJson,openArtifact,ownerAlive,processStamp} from '../dashboard/files.js';
import {Id,IdentitySchema} from '../dashboard/protocol.js';
import {loadRun,parseEvents,readRunFile,type LiveRun} from '../dashboard/projection.js';
import {TitleSchema,TitleRecordSchema} from '../core/titles.js';

const Management=z.object({schemaVersion:z.literal(1),revision:z.number().int().nonnegative(),archivedAt:z.string().datetime().optional(),keepForever:z.boolean()}).strict();
const Intent=z.object({schemaVersion:z.literal(1),id:Id,operation:z.string().uuid(),status:z.enum(['pending','deleted']),device:z.number().optional(),inode:z.number().optional()}).strict();
export type ManagementState=z.infer<typeof Management>;
export type ManagementView=ManagementState&{allowed:boolean;reason?:string};
export type ManageAction='archive'|'restore'|'delete';
export type ManageResult={id:string;status:'archived'|'restored'|'deleted'|'cleanup_pending'|'error';error?:string};
export async function renameRun(root:string,id:string,input:unknown){
  const title=TitleSchema.parse(input);root=await realpath(root);
  return withRunLock(root,id,async()=>{
    if(await deletionState(root,id))throw new Error('该运行已被删除');
    const {dir,stat}=await ownedRun(root,id);let previous:z.infer<typeof TitleRecordSchema>|undefined;
    try{previous=TitleRecordSchema.parse(await jsonAt(dir,'title.json'));}catch{/* A new title can repair unreadable display metadata. */}
    if(previous?.title!==title){
      const check=await ownedRun(root,id);if(stat.ino!==check.stat.ino||stat.dev!==check.stat.dev)throw new Error('运行目录已改变');
      await atomicJson(join(dir,'title.json'),{schemaVersion:1,revision:(previous?.revision??0)+1,title});
    }
    return {id,status:'renamed' as const,title};
  });
}
const missing=(e:unknown)=>(e as NodeJS.ErrnoException).code==='ENOENT';
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));

// Every destructive operation starts from the canonical, registered storage root.
async function directory(path:string,create=false){
  if(create)await mkdir(path,{recursive:true,mode:0o700});
  const stat=await lstat(path);if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(path)!==resolve(path))throw new Error('目录归属或路径无效');
  return stat;
}
async function control(root:string){
  root=await realpath(root);await directory(root);const dir=join(root,'.run-management');await directory(dir,true);return dir;
}
async function jsonAt(root:string,name:string){const {handle,stat}=await openArtifact(root,join(root,name));try{if(stat.size>65536)throw new Error('管理文件过大');return JSON.parse(await handle.readFile('utf8'));}finally{await handle.close();}}
export async function managementState(dir:string):Promise<ManagementState>{
  try{return Management.parse(await jsonAt(dir,'management.json'));}catch(e){if(missing(e))return {schemaVersion:1,revision:0,keepForever:false};throw new Error('保存策略不可读取，已保留文件，请检查管理记录');}
}
export async function deletionState(root:string,id:string){
  Id.parse(id);root=await realpath(root);const dir=join(root,'.run-management');try{await directory(dir);return Intent.parse(await jsonAt(dir,`${id}.delete.json`));}catch(e){if(missing(e))return undefined;throw e;}
}
export async function ownedRun(root:string,id:string){
  Id.parse(id);root=await realpath(root);await directory(root);await directory(join(root,'runs'));const dir=join(root,'runs',id);const stat=await directory(dir);
  const marker=await readRunFile(dir,'.owner.json');if(marker.owner!=='webpilot'||marker.id!==id)throw new Error('运行目录归属不匹配');return {dir,stat,marker};
}
export async function withRunLock<T>(root:string,id:string,work:()=>Promise<T>):Promise<T>{
  Id.parse(id);const dir=await control(root),lock=join(dir,`${id}.lock`);const nonce=randomUUID();const owner={pid:process.pid,nonce,started:await processStamp()};
  const until=Date.now()+2000;
  for(;;){
    try{await mkdir(lock,{mode:0o700});try{await writeFile(join(lock,'owner.json'),JSON.stringify(owner),{flag:'wx',mode:0o600});}catch(e){await rm(lock,{recursive:true,force:true});throw e;}break;}
    catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;
      // A second reclaimer cannot remove a newly acquired lock.
      const reclaim=`${lock}.reclaim`;
      try{await mkdir(reclaim,{mode:0o700});try{
        await directory(lock);const previous=IdentitySchema.parse(await jsonAt(lock,'owner.json'));
        if(await ownerAlive(previous)===false){const current=await jsonAt(lock,'owner.json');if(current.nonce===previous.nonce)await rename(lock,`${lock}.${previous.nonce}.stale`);await rm(`${lock}.${previous.nonce}.stale`,{recursive:true,force:true});}
      }finally{await rm(reclaim,{recursive:true,force:true});}}catch{/* A live, unknown or incomplete lock is never broken. */}
      if(Date.now()>=until)throw new Error('运行记录正忙，请稍后重试');await pause(25);
    }
  }
  try{return await work();}finally{try{if((await jsonAt(lock,'owner.json')).nonce===nonce)await rm(lock,{recursive:true});}catch{}}
}
export async function managementView(dir:string,loaded?:LiveRun):Promise<ManagementView>{
  const state=await managementState(dir);const id=basename(dir);const run=loaded??await loadRun(dir,id);
  if(!run.meta.owner){
    const allowed=run.metadataSource==='legacy'&&(run.lifecycle==='finished'&&!!run.report||run.lifecycle==='historical'&&run.legacyFinalized===true);
    return {...state,allowed,reason:allowed?undefined:'历史记录缺少可靠的结束信息，暂不可管理'};
  }
  let ended=false;
  try{const {handle}=await openArtifact(dir,join(dir,'events.jsonl'));try{const parsed=parseEvents(await handle.readFile('utf8'));ended=!parsed.partial&&!parsed.invalid&&parsed.events.at(-1)?.type==='run.finished'&&parsed.events.at(-1)?.runId===id&&run.lifecycle==='finished';}finally{await handle.close();}}catch{}
  if(!ended){let live=true;try{await lstat(join(dir,'live.json'));}catch(e){if(missing(e))live=false;}
    ended=run.lifecycle==='finished'&&(!live||await ownerAlive(run.meta.owner)===false);
  }
  const allowed=ended||run.lifecycle==='interrupted'&&await ownerAlive(run.meta.owner)===false;
  return {...state,allowed,reason:allowed?undefined:'运行尚未完成清理或执行器状态待确认'};
}
export async function changeManagement(root:string,id:string,action:ManageAction,onDelete?:(id:string,status:string)=>void):Promise<ManageResult>{
  try{root=await realpath(root);return await withRunLock(root,id,async()=>{
    const intent=await deletionState(root,id);
    if(intent){if(action!=='delete')throw new Error('该运行已被删除');return finishDeletion(root,intent,onDelete);}
    const {dir,stat}=await ownedRun(root,id);const state=await managementView(dir);if(!state.allowed)throw new Error(state.reason);
    if(action!=='delete'){
      if(action==='archive'&&!state.archivedAt||action==='restore'&&state.archivedAt){
        const next:ManagementState={schemaVersion:1,revision:state.revision+1,keepForever:action==='archive'||state.keepForever,...(action==='archive'?{archivedAt:new Date().toISOString()}:{})};
        const check=await ownedRun(root,id);if(stat.ino!==check.stat.ino||stat.dev!==check.stat.dev)throw new Error('运行目录已改变');await atomicJson(join(dir,'management.json'),next);
      }
      return {id,status:action==='archive'?'archived':'restored'};
    }
    const check=await ownedRun(root,id);if(stat.ino!==check.stat.ino||stat.dev!==check.stat.dev)throw new Error('运行目录已改变');
    const record:z.infer<typeof Intent>={schemaVersion:1,id,operation:randomUUID(),status:'pending',device:stat.dev,inode:stat.ino};
    await atomicJson(join(await control(root),`${id}.delete.json`),record);onDelete?.(id,'pending');return finishDeletion(root,record,onDelete);
  });}catch(e){return {id,status:'error',error:e instanceof Error?e.message:'操作失败'};}
}
async function finishDeletion(root:string,intent:z.infer<typeof Intent>,onDelete?:(id:string,status:string)=>void):Promise<ManageResult>{
  if(intent.status==='deleted')return {id:intent.id,status:'deleted'};
  const {id}=intent;onDelete?.(id,'pending');
  try{
    const base=await control(root);const staging=join(base,`${id}.${intent.operation}.purge`);
    let original=false;try{await lstat(join(root,'runs',id));original=true;}catch(e){if(!missing(e))throw e;}
    if(original){const current=await ownedRun(root,id);if(intent.inode!==undefined&&(current.stat.ino!==intent.inode||current.stat.dev!==intent.device))throw new Error('运行目录已改变');try{await lstat(staging);throw new Error('清理目录冲突');}catch(e){if(!missing(e))throw e;}await rename(join(root,'runs',id),staging);}
    let staged:Awaited<ReturnType<typeof directory>>|undefined;
    try{staged=await directory(staging);}catch(e){if(!missing(e))throw e;}
    if(staged){
      if(intent.inode!==undefined&&(staged.ino!==intent.inode||staged.dev!==intent.device))throw new Error('清理目录身份已改变');
      try{const marker=await readRunFile(staging,'.owner.json');if(marker.owner!=='webpilot'||marker.id!==id)throw new Error('清理目录归属不匹配');}
      catch(e){if(!missing(e)||intent.inode===undefined)throw e;} // A partial rm may have already removed the marker.
      await rm(staging,{recursive:true});
    }
    await atomicJson(join(base,`${id}.delete.json`),{...intent,status:'deleted'});onDelete?.(id,'deleted');return {id,status:'deleted'};
  }catch(e){return {id,status:'cleanup_pending',error:`删除待完成：${e instanceof Error?e.message:'文件清理失败'}`};}
}
export async function resumeDeletions(root:string){
  root=await realpath(root);const base=join(root,'.run-management');try{await directory(base);for(const file of await readdir(base)){if(!file.endsWith('.delete.json'))continue;const id=file.slice(0,-12);if(!Id.safeParse(id).success)continue;try{const intent=await deletionState(root,id);if(intent?.status==='pending')await withRunLock(root,id,()=>finishDeletion(root,intent));}catch{}}}catch{/* No management state in legacy storage roots. */}
}
export function storageForRun(dir:string){return dirname(dirname(dir));}
