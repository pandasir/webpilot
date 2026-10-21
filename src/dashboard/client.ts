import {WebSocket} from 'ws';
import {dashboardRoot} from './files.js';
import {endpointAt,ensureDashboard,internal,requireCoverageDashboard,type Endpoint} from './lifecycle.js';
import {MAX_FRAME,type RunMeta,type FrameHeader,encodeFrame} from './protocol.js';

export class DashboardClient{
  private socket?:WebSocket;
  private timer?:ReturnType<typeof setTimeout>;
  private heartbeat?:ReturnType<typeof setInterval>;
  private stopped=false;
  private attempts=0;
  private watching=false;
  endpoint?:Endpoint;
  onWatch?:(watch:boolean)=>void;
  constructor(readonly meta:RunMeta,readonly dataDir:string,readonly root=dashboardRoot()){}
  start(){void this.connect(true);}
  private async connect(start=false){
    try{
      const e=start?await ensureDashboard(this.root):await endpointAt(this.root);if(!e)return this.retry();
      if(this.meta.mode==='planned-session')await requireCoverageDashboard(e);
      if(this.stopped){await internal(e,'/internal/import',{dataDir:this.dataDir}).catch(()=>{});return;}this.endpoint=e;
      const ws=new WebSocket(e.url.replace('http:','ws:')+'/internal/executors',{headers:{Authorization:`Bearer ${e.token}`},maxPayload:MAX_FRAME,handshakeTimeout:1500});this.socket=ws;
      ws.on('open',()=>{
        if(this.stopped){ws.close();return;}this.attempts=0;
        ws.send(JSON.stringify({type:'register',protocolVersion:1,runId:this.meta.id,dataDir:this.dataDir,owner:this.meta.owner}));
        this.heartbeat=setInterval(()=>this.notify('heartbeat'),3000);this.heartbeat.unref();
      });
      ws.on('message',raw=>{try{const msg=JSON.parse(raw.toString());if(msg.type==='watch'&&this.watching!==(msg.enabled===true)){this.watching=msg.enabled===true;this.onWatch?.(this.watching);}}catch{}});
      ws.on('error',()=>{});
      ws.on('close',()=>{if(this.socket===ws){this.socket=undefined;if(this.heartbeat)clearInterval(this.heartbeat);this.watching=false;this.onWatch?.(false);this.retry();}});
    }catch(error){if(String(error).includes('暂不支持覆盖规划')){console.error(`WebPilot：${(error as Error).message}`);this.close();}else this.retry();}
  }
  private retry(){if(this.stopped)return;this.timer=setTimeout(()=>void this.connect(),Math.min(5000,250*2**Math.min(this.attempts++,5)));this.timer.unref();}
  notify(type='changed'){if(this.socket?.readyState===WebSocket.OPEN&&this.socket.bufferedAmount<65536)this.socket.send(JSON.stringify({type,runId:this.meta.id}));}
  frame(header:FrameHeader,jpeg:Buffer){if(!this.watching||this.socket?.readyState!==WebSocket.OPEN||this.socket.bufferedAmount!==0)return;try{this.socket.send(encodeFrame(header,jpeg));}catch{}}
  status(message:string){if(this.socket?.readyState===WebSocket.OPEN&&this.socket.bufferedAmount<65536)this.socket.send(JSON.stringify({type:'live.status',runId:this.meta.id,message}));}
  isWatching(){return this.watching;}
  close(){if(this.stopped)return;this.stopped=true;if(this.timer)clearTimeout(this.timer);if(this.heartbeat)clearInterval(this.heartbeat);this.onWatch?.(false);this.socket?.close();this.socket=undefined;if(this.endpoint)void internal(this.endpoint,'/internal/import',{dataDir:this.dataDir}).catch(()=>{});}
}
