import {appendFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Redactor} from '../artifacts/redaction.js';
import {MetaSchema,ProgressEventSchema,type Association,type EventType,type RunMeta} from '../dashboard/protocol.js';
import type {DashboardClient} from '../dashboard/client.js';
import {processStamp,atomicJson} from '../dashboard/files.js';
import {Screencast} from '../browser/screencast.js';
import type {BrowserSession} from '../browser/session.js';
import type {Target} from './schema.js';
import {explorationTitle} from './titles.js';

const bounded=async<T>(promise:Promise<T>,ms:number):Promise<T>=>{let timer:ReturnType<typeof setTimeout>;try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Progress write timed out')),ms);})]);}finally{clearTimeout(timer!);}};
export class Progress {
  private seq=0;
  private tail:Promise<void>=Promise.resolve();
  private degraded=false;
  private client?:DashboardClient;
  private detach?:()=>Promise<void>;
  private epoch=0;
  private finishing?:Promise<void>;
  private constructor(readonly dir:string,readonly meta:RunMeta,readonly redactor:Redactor){}
  static async create(dir:string,dataDir:string,meta:Omit<RunMeta,'protocolVersion'|'owner'>,redactor:Redactor,options:{dashboard?:boolean;dashboardRoot?:string}={}){
    const safe=MetaSchema.parse(redactor.object({...meta,protocolVersion:1,owner:{pid:process.pid,nonce:randomUUID(),started:await processStamp()}}));
    const progress=new Progress(dir,safe,redactor);
    try{await bounded(writeFile(join(dir,'live.json'),JSON.stringify(safe)+'\n',{mode:0o600,flag:'wx'}),250);await progress.emit('run.created',{});}
    catch{progress.degraded=true;console.error('WebPilot：实时进度存储不可用，继续执行测试。');}
    if(options.dashboard!==false&&process.env.WEBPILOT_DASHBOARD!=='0'){
      try{const {DashboardClient}=await import('../dashboard/client.js');progress.client=new DashboardClient(safe,dataDir,options.dashboardRoot);progress.client.start();}catch{console.error('WebPilot：看板连接不可用，继续执行测试。');}
    }
    return progress;
  }
  async emit(type:EventType,payload:unknown,association:Association={}){
    if(this.degraded)return;
    const work=this.tail.then(async()=>{
      const event=ProgressEventSchema.parse(this.redactor.object({protocolVersion:1,runId:this.meta.id,seq:this.seq+1,timestamp:new Date().toISOString(),type,...association,payload}));
      await appendFile(join(this.dir,'events.jsonl'),JSON.stringify(event)+'\n',{mode:0o600});this.seq=event.seq;this.client?.notify();
    });
    this.tail=work.catch(()=>{});
    try{await bounded(work,250);}catch{this.degraded=true;console.error('WebPilot：实时进度记录已降级，最终报告继续独立保存。');}
  }
  phase(phase:'preparing'|'running'|'collecting'|'cleaning',message?:string){return this.emit('phase.changed',{phase,message});}
  async target(target:Target){
    Object.assign(this.meta,this.redactor.object({target:target.url??'准备目标中',project:target.projectPath,live:target.evidence.live}));
    if(this.meta.mode==='exploration'&&this.meta.titleSource==='target')this.meta.title=this.redactor.text(explorationTitle(target));
    if(!this.degraded)try{await bounded(atomicJson(join(this.dir,'live.json'),this.meta),250);}catch{this.degraded=true;}
  }
  async attach(session:BrowserSession,caseId:string,attempt:number){
    await this.detach?.();const client=this.client;if(!client)return;
    const cast=new Screencast((header,jpeg)=>client.frame(header,jpeg),message=>client.status(message),()=>({protocolVersion:1,runId:this.meta.id,caseId,attempt}),()=>++this.epoch);
    let watching=client.isWatching();
    const start=()=>{if(watching&&session.page)void cast.start(session.page,session.pageIdentity());};
    const unsubscribe=session.onPage(()=>{if(session.target.evidence.live)start();});
    client.onWatch=enabled=>{watching=enabled;if(!session.target.evidence.live){client.status('本次运行已关闭直播');return;}if(enabled)start();else void cast.stop();};
    if(watching&&session.target.evidence.live)start();
    this.detach=async()=>{unsubscribe();client.onWatch=undefined;await cast.stop();};
  }
  async detachBrowser(){const detach=this.detach;this.detach=undefined;await detach?.();}
  finish(payload:{outcome?:'passed'|'failed'|'blocked'|'inconclusive';unstable?:boolean;reason?:string}={}){
    return this.finishing??=this.complete(payload);
  }
  private async complete(payload:{outcome?:'passed'|'failed'|'blocked'|'inconclusive';unstable?:boolean;reason?:string}){
    await this.detachBrowser();await this.emit('run.finished',payload);this.client?.notify();this.client?.close();
  }
}
