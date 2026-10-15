import {EventEmitter} from 'node:events';
import {readdir,realpath,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {managementView,deletionState,resumeDeletions,storageForRun,changeManagement,renameRun,type ManageAction,type ManageResult} from '../artifacts/management.js';
import {Id,type RunMeta} from './protocol.js';
import {atomicJson,jsonFile,privateDir} from './files.js';
import {readRunFile,loadRun,publicRun,type LiveRun} from './projection.js';

export class Registry extends EventEmitter{
  readonly runs=new Map<string,{dir:string;state:LiveRun;fingerprint:string;lastSeen:number;checkedAt:number}>();
  private roots=new Set<string>();
  readonly deleted=new Map<string,string>();
  private locations=new Map<string,string>();
  private entries=new Map<string,string>();
  private saving:Promise<void>=Promise.resolve();
  private refreshing?:Promise<void>;
  private timer?:ReturnType<typeof setInterval>;
  private closed=false;
  constructor(readonly root:string){super();}
  async start(defaultRoot?:string){
    await privateDir(this.root);
    try{for(const root of await jsonFile(join(this.root,'roots.json')))if(typeof root==='string')this.roots.add(root);}catch{}
    try{for(const [id,dir] of await jsonFile(join(this.root,'registry.json')))if(Id.safeParse(id).success&&typeof dir==='string'){this.entries.set(id,dir);this.locations.set(id,storageForRun(dir));}}catch{}
    if(defaultRoot)this.roots.add(defaultRoot);
    for(const root of this.roots)await this.importRoot(root,false);
    await this.refresh();this.timer=setInterval(()=>void this.refresh(),1000);this.timer.unref();
  }
  private save(){
    if(this.closed)return this.saving;
    this.saving=this.saving.catch(()=>{}).then(async()=>{await atomicJson(join(this.root,'roots.json'),[...this.roots]);await atomicJson(join(this.root,'registry.json'),[...this.entries]);});return this.saving;
  }
  async importRoot(dataDir:string,persist=true){
    if(this.closed)return 0;
    let canonical:string;try{canonical=await realpath(dataDir);}catch{return 0;}
    this.roots.add(canonical);await resumeDeletions(canonical);
    try{for(const file of await readdir(join(canonical,'.run-management'))){if(!file.endsWith('.delete.json'))continue;const id=file.slice(0,-12);if(!Id.safeParse(id).success)continue;const state=await deletionState(canonical,id);if(state){this.locations.set(id,canonical);this.deleted.set(id,state.status);}}}catch{}
    let count=0;
    try{for(const entry of await readdir(join(canonical,'runs'),{withFileTypes:true}))if(entry.isDirectory()&&!entry.isSymbolicLink()&&Id.safeParse(entry.name).success){try{await this.add(canonical,entry.name);count++;}catch{}}}catch{}
    if(persist)await this.save();return count;
  }
  private async add(dataDir:string,id:string){
    Id.parse(id);const location=this.locations.get(id);if(location&&location!==dataDir)throw new Error('Run id already registered elsewhere');if(this.deleted.has(id)||await deletionState(dataDir,id))throw new Error('Run deleted');const dir=join(dataDir,'runs',id);
    const marker=await readRunFile(dir,'.owner.json');if(marker.owner!=='webpilot'||marker.id!==id)throw new Error('Unowned run');
    const previous=this.entries.get(id);if(previous&&previous!==dir)throw new Error('Run id already registered elsewhere');
    this.entries.set(id,dir);this.locations.set(id,dataDir);return dir;
  }
  async register(dataDir:string,id:string,owner:RunMeta['owner']){
    const root=await realpath(dataDir);const dir=await this.add(root,id);const meta=await readRunFile(dir,'live.json');
    if(meta.owner?.nonce!==owner.nonce||meta.owner?.pid!==owner.pid)throw new Error('Executor owner mismatch');
    this.roots.add(root);const run=this.runs.get(id);if(run)run.lastSeen=Date.now();await this.save();await this.refresh(id,true);
  }
  heartbeat(id:string){const entry=this.runs.get(id);if(entry)entry.lastSeen=Date.now();}
  disconnect(id:string){const entry=this.runs.get(id);if(entry)entry.lastSeen=0;void this.refresh(id);}
  refresh(id?:string,connected=false):Promise<void>{
    if(this.closed)return Promise.resolve();
    if(this.refreshing)return this.refreshing.then(()=>id?this.refresh(id,connected):undefined);
    this.refreshing=this.doRefresh(id,connected).catch(()=>{}).finally(()=>{this.refreshing=undefined;});return this.refreshing;
  }
  private async doRefresh(only?:string,connected=false){
    let removed=false;
    for(const [id,dir] of this.entries){if(only&&id!==only)continue;const old=this.runs.get(id);

      try{
        const deletion=await deletionState(storageForRun(dir),id);if(deletion){this.deleted.set(id,deletion.status);this.entries.delete(id);this.runs.delete(id);removed=true;this.emit('deleted',id,deletion.status);continue;}
        if(!only&&old&&old.state.lifecycle==='finished'&&Date.now()-old.checkedAt<30000)continue;
        const state=await loadRun(dir,id,connected||!!old&&Date.now()-old.lastSeen<15000);
        try{state.management=await managementView(dir,state);}catch{state.management={schemaVersion:1,revision:0,keepForever:true,allowed:false,reason:'保存策略不可读取，已保留文件'};}
        const removedDuringRead=await deletionState(storageForRun(dir),id);if(removedDuringRead){this.deleted.set(id,removedDuringRead.status);this.entries.delete(id);this.runs.delete(id);removed=true;this.emit('deleted',id,removedDuringRead.status);continue;}
        const fingerprint=JSON.stringify(publicRun(state));const changed=old?.fingerprint!==fingerprint;
        this.runs.set(id,{dir,state,fingerprint,lastSeen:connected?Date.now():old?.lastSeen??0,checkedAt:Date.now()});
        if(changed)this.emit('changed',id,state);
      }catch{
        try{await lstat(dir);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'){this.entries.delete(id);this.runs.delete(id);removed=true;if(old){old.state.message='运行产物已过期。';this.emit('changed',id,old.state);}continue;}}
        if(old&&old.state.message!=='运行产物已过期或不可读取。'){
          old.state.message='运行产物已过期或不可读取。';old.state.artifacts=[];old.state.report=undefined;old.state.session=undefined;
          old.state.logGap=old.state.message;old.state.connection='unknown';old.fingerprint=JSON.stringify(publicRun(old.state));this.emit('changed',id,old.state);
        }
      }
    }
    if(removed)await this.save();
  }
  async manage(id:string,action:ManageAction):Promise<ManageResult>{
    const root=this.locations.get(id);if(!root)return {id,status:'error',error:'运行不可用'};
    const result=await changeManagement(root,id,action,(runId,status)=>{this.deleted.set(runId,status);this.runs.delete(runId);this.emit('deleted',runId,status);});
    await this.refresh(id);if(result.status==='deleted'||result.status==='cleanup_pending'){this.entries.delete(id);await this.save();}return result;
  }
  async rename(id:string,title:string){
    const root=this.locations.get(id);if(!root)throw new Error('运行不可用');
    const result=await renameRun(root,id,title);await this.refresh(id);return result;
  }
  async unavailable(id:string){const root=this.locations.get(id);if(root){const state=await deletionState(root,id);if(state){this.deleted.set(id,state.status);return true;}}return this.deleted.has(id);}
  async close(){this.closed=true;if(this.timer)clearInterval(this.timer);await this.refreshing;await this.saving.catch(()=>{});}
}
