import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile,rm} from 'node:fs/promises';
import {WebSocketServer,WebSocket,type RawData} from 'ws';
import {Registry} from './registry.js';
import {publicRun,readRunFile,type LiveRun} from './projection.js';
import {privateDir,atomicJson,jsonFile,openArtifact,processStamp} from './files.js';
import {HandshakeSchema,MAX_BUFFER,MAX_FRAME,decodeFrame} from './protocol.js';
import {z} from 'zod';
import {Id} from './protocol.js';
import {dataRoot} from '../core/runtime.js';
import {TitleSchema} from '../core/titles.js';
import {acceptanceStatus} from '../core/acceptance.js';

const key=()=>randomBytes(32).toString('base64url');
const equal=(a:string,b:string)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
const json=(res:ServerResponse,status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
async function body(req:IncomingMessage){let data='';for await(const part of req){data+=part;if(data.length>65536)throw new Error('Request too large');}return JSON.parse(data||'{}');}
function send(ws:WebSocket,value:unknown){if(ws.readyState===WebSocket.OPEN&&ws.bufferedAmount<65536)ws.send(JSON.stringify(value));}

export async function startDashboard(options:{root:string;port?:number;defaultDataDir?:string}){
  const root=options.root;await privateDir(root);
  const instance=randomUUID(),token=key(),nonce=randomUUID();const registry=new Registry(root);
  const tickets=new Map<string,number>(),sessions=new Map<string,number>();
  try{for(const [key,expires]of await jsonFile(join(root,'sessions.json')))if(typeof key==='string'&&typeof expires==='number'&&expires>Date.now())sessions.set(key,expires);}catch{}
  const producers=new Map<string,{ws:WebSocket;lastSeen:number;epoch:number;frameSeq:number}>();
  const viewers=new Map<string,Set<WebSocket>>();const subscribers=new Set<{res:ServerResponse;id?:string}>();
  const media=new Map<string,Set<ServerResponse>>();
  const wss=new WebSocketServer({noServer:true,maxPayload:MAX_FRAME});
  let url='',opened=false,lease:{id:string;expires:number}|undefined,closing:Promise<void>|undefined;let overviewSeq=0;
  const authenticated=(req:IncomingMessage)=>{const cookie=(req.headers.cookie??'').split(';').map(s=>s.trim()).find(s=>s.startsWith('webpilot_session='))?.slice(17);return !!cookie&&(sessions.get(cookie)??0)>Date.now();};
  const internalAuth=(req:IncomingMessage)=>!req.headers.origin&&equal(req.headers.authorization??'',`Bearer ${token}`);
  const hostOk=(req:IncomingMessage)=>req.headers.host===new URL(url).host;
  const originOk=(req:IncomingMessage,required=false)=>req.headers.origin===url||!required&&!req.headers.origin&&req.headers['sec-fetch-site']!=='cross-site';
  const watch=(id:string)=>{const p=producers.get(id);if(p)send(p.ws,{type:'watch',enabled:(viewers.get(id)?.size??0)>0});};
  const broadcast=(id:string,data:Buffer)=>{for(const ws of viewers.get(id)??[]){if(ws.readyState!==WebSocket.OPEN)continue;if(ws.bufferedAmount>MAX_BUFFER){ws.close(1013,'Slow viewer');continue;}if(ws.bufferedAmount===0)ws.send(data);}};
  const notify=(id:string,state:LiveRun)=>{
    overviewSeq++;
    for(const sub of subscribers){if(sub.id&&sub.id!==id)continue;
      const event=sub.id?'state':'changed',cursor=sub.id?String(state.seq):`${instance}:${overviewSeq}`;
      const payload=sub.id?publicRun(state):{id};
      if(sub.res.writableLength>256*1024){sub.res.destroy();subscribers.delete(sub);continue;}
      sub.res.write(`id: ${cursor}\nevent: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    }
  };
  registry.on('changed',notify);
  registry.on('plans.changed',()=>{for(const sub of subscribers)if(!sub.id)sub.res.write('event: plans.changed\ndata: {}\n\n');});
  registry.on('deleted',(id:string,status:string)=>{
    overviewSeq++;
    for(const sub of subscribers){if(sub.id&&sub.id!==id)continue;sub.res.write(`event: ${sub.id?'deleted':'changed'}\ndata: ${JSON.stringify({id,status})}\n\n`);if(sub.id&&status==='deleted'){sub.res.end();subscribers.delete(sub);}}
    for(const response of media.get(id)??[])response.destroy();media.delete(id);
    for(const ws of viewers.get(id)??[])ws.close(1008,'Run deleted');viewers.delete(id);watch(id);
  });
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' blob:; media-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    try{
      if(!hostOk(req)){json(res,403,{error:'Invalid host'});return;}
      const path=new URL(req.url??'/',url).pathname;
      if(path==='/api/health'&&req.method==='GET'){json(res,200,{name:'webpilot-dashboard',protocolVersion:1,instance,capabilities:{coveragePlanning:1}});return;}
      if(path.startsWith('/internal/')){
        if(!internalAuth(req)){json(res,403,{error:'Unauthorized'});return;}
        if(path==='/internal/status'&&req.method==='GET'){json(res,200,{protocolVersion:1,instance,capabilities:{coveragePlanning:1}});return;}
        if(req.method!=='POST'){json(res,405,{error:'Method not allowed'});return;}
        const input=await body(req);
        if(path==='/internal/bootstrap'){
          if(tickets.size>=128)tickets.delete(tickets.keys().next().value!);
          const ticket=key();tickets.set(ticket,Date.now()+60000);
          const shouldOpen=input.force===true||!opened&&!subscribers.size&&(!lease||lease.expires<Date.now());
          const reserve=(input.reserve??input.auto)===true&&shouldOpen;
          if(reserve)lease={id:randomUUID(),expires:Date.now()+10000};
          json(res,200,{token:ticket,shouldOpen,lease:reserve?lease?.id:undefined});return;
        }
        if(path==='/internal/opened'){if(lease&&input.lease===lease.id){opened=opened||input.opened===true;lease=undefined;}json(res,200,{opened});return;}
        if(path==='/internal/import'){if(typeof input.dataDir!=='string')throw new Error('Missing data directory');const count=await registry.importRoot(input.dataDir);await registry.refresh();json(res,200,{imported:count});return;}
        if(path==='/internal/stop'){if(input.instance!==instance){json(res,409,{error:'Wrong instance'});return;}json(res,200,{stopped:true});setImmediate(()=>void close());return;}
        json(res,404,{error:'Unknown internal endpoint'});return;
      }
      if(path==='/api/session'&&req.method==='POST'){
        if(!originOk(req,true)){json(res,403,{error:'Invalid origin'});return;}
        const input=await body(req);const expiry=tickets.get(input.token);tickets.delete(input.token);
        if(!expiry||expiry<Date.now()){json(res,401,{error:'打开凭证已失效，请重新打开看板。'});return;}
        const session=key();if(sessions.size>=128)sessions.delete(sessions.keys().next().value!);sessions.set(session,Date.now()+7*86400000);
        await atomicJson(join(root,'sessions.json'),[...sessions]);
        res.setHeader('Set-Cookie',`webpilot_session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`);json(res,200,{ready:true});return;
      }
      if(path.startsWith('/api/')){
        if(!authenticated(req)||!originOk(req)){json(res,401,{error:'请通过 WebPilot 重新打开看板以建立本机会话。'});return;}
        if(req.method!=='GET'){
          if(!originOk(req,true)){json(res,403,{error:'Invalid origin'});return;}
          const rename=path.match(/^\/api\/runs\/([a-zA-Z0-9._-]+)\/title$/);
          if(rename&&req.method==='POST'){
            if(!req.headers['content-type']?.startsWith('application/json')){json(res,400,{error:'Expected JSON'});return;}
            const input=z.object({title:TitleSchema}).strict().parse(await body(req)),id=Id.parse(rename[1]);
            if(await registry.unavailable(id)){json(res,410,{error:'该运行已被删除'});return;}
            if(!registry.runs.has(id)){json(res,404,{error:'运行不可用'});return;}
            const result=await registry.rename(id,input.title);json(res,200,result);return;
          }
          const single=path.match(/^\/api\/runs\/([a-zA-Z0-9._-]+)(?:\/(archive|restore))?$/);
          const batch=path==='/api/runs/manage'&&req.method==='POST';
          const validSingle=single&&(req.method==='DELETE'&&!single[2]||req.method==='POST'&&!!single[2]);
          if(!batch&&!validSingle){json(res,405,{error:'Method not allowed'});return;}
          if(!req.headers['content-type']?.startsWith('application/json')){json(res,400,{error:'Expected JSON'});return;}
          const input=await body(req);
          const schema=z.object({action:z.enum(['archive','restore','delete']),ids:z.array(Id).min(1).max(20),confirmPermanent:z.boolean().optional()}).strict();
          const request=batch?schema.parse(input):schema.parse({action:single![2]??'delete',ids:[Id.parse(single![1])],...z.object({confirmPermanent:z.boolean().optional()}).strict().parse(input)});
          if(request.action==='delete'&&request.confirmPermanent!==true){json(res,400,{error:'请先确认永久删除，操作无法恢复'});return;}
          const results=[];for(const id of new Set(request.ids))results.push(await registry.manage(id,request.action));
          json(res,200,{results});return;
        }
        const parsed=new URL(req.url!,url);
        if(path==='/api/plans'){const rows=[...registry.plans.values()].map(e=>e.record).sort((a,b)=>b.manifest.createdAt.localeCompare(a.manifest.createdAt));json(res,200,{plans:rows,total:rows.length});return;}
        const planMatch=path.match(/^\/api\/plans\/([a-zA-Z0-9._-]+)$/);
        if(planMatch){try{const revision=parsed.searchParams.has('revision')?Number(parsed.searchParams.get('revision')):undefined;const plan=await registry.plan(planMatch[1],revision);json(res,plan?200:404,plan??{error:'覆盖计划不可用或已过期'});}catch{json(res,404,{error:'覆盖计划不可用或已过期'});}return;}
        if(path==='/api/runs'){
          const status=parsed.searchParams.get('status'),project=parsed.searchParams.get('project');
          const page=Math.max(1,Math.min(100000,Number(parsed.searchParams.get('page'))||1));
          const scope=parsed.searchParams.get('scope')??'current';if(!['current','archived'].includes(scope)){json(res,400,{error:'Invalid scope'});return;}
          const all=[...registry.runs.values()].map(e=>e.state).filter(r=>!registry.deleted.has(r.id)&&!!r.management?.archivedAt===(scope==='archived'));
          const rows=all.filter(r=>(!status||(status==='active'?!['finished','interrupted','historical'].includes(r.lifecycle):acceptanceStatus(r)===status||r.lifecycle===status))&&(!project||`${r.meta.project??''} ${r.meta.target} ${r.meta.title}`.toLowerCase().includes(project.toLowerCase()))).sort((a,b)=>b.meta.startedAt.localeCompare(a.meta.startedAt));
          const summary={active:all.filter(r=>!['finished','interrupted','historical'].includes(r.lifecycle)).length,passed:all.filter(r=>acceptanceStatus(r)==='passed').length,failed:all.filter(r=>acceptanceStatus(r)==='failed').length,other:all.filter(r=>['blocked','inconclusive','exploratory'].includes(acceptanceStatus(r))||['interrupted','historical'].includes(r.lifecycle)).length};
          json(res,200,{total:rows.length,page,pageSize:20,summary,runs:rows.slice((page-1)*20,page*20).map(publicRun),cursor:`${instance}:${overviewSeq}`});return;
        }
        const match=path.match(/^\/api\/runs\/([a-zA-Z0-9._-]+)(?:\/(events|report|artifacts)(?:\/([a-zA-Z0-9._-]+))?)?$/);
        if(path==='/api/events'||match?.[2]==='events'){
          const id=match?.[1];if(id&&await registry.unavailable(id)){json(res,410,{error:registry.deleted.get(id)==='pending'?'删除待完成，请重试清理':'该运行已被删除'});return;}if(id&&!registry.runs.has(id)){json(res,404,{error:'Run unavailable'});return;}
          res.writeHead(200,{'Content-Type':'text/event-stream','Connection':'keep-alive','X-Accel-Buffering':'no'});
          const sub={res,id};subscribers.add(sub);
          // A real authenticated page also counts when opened inside Codex or via a returned link.
          opened=true;
          if(id){const state=registry.runs.get(id)!.state;res.write(`id: ${state.seq}\nevent: state\ndata: ${JSON.stringify(publicRun(state))}\n\n`);}
          else res.write(`id: ${instance}:${overviewSeq}\nevent: reset\ndata: {}\n\n`);
          req.on('close',()=>subscribers.delete(sub));return;
        }
        if(!match){json(res,404,{error:'Unknown API'});return;}
        if(await registry.unavailable(match[1])){json(res,410,{error:registry.deleted.get(match[1])==='pending'?'删除待完成，请重试清理':'该运行已被删除'});return;}
        const entry=registry.runs.get(match[1]);if(!entry){json(res,404,{error:'运行不可用'});return;}
        if(!match[2]){json(res,200,publicRun(entry.state));return;}
        if(match[2]==='report'){
          try{const report=await readRunFile(entry.dir,entry.state.meta.mode==='exploration'?'session.json':'report.json');if(await registry.unavailable(match[1])){json(res,410,{error:'该运行已被删除'});return;}json(res,200,report);}catch{json(res,404,{error:'报告尚未就绪或已过期'});}return;
        }
        const artifact=entry.state.artifacts.find(a=>a.id===match[3]);if(!artifact){json(res,404,{error:'证据不可用或已过期'});return;}
        let file:Awaited<ReturnType<typeof openArtifact>>;try{file=await openArtifact(entry.dir,artifact.path);}catch{json(res,410,{error:'证据不可用或已过期'});return;}
        const {handle,stat}=file;if(await registry.unavailable(match[1])){await handle.close();json(res,410,{error:'该运行已被删除'});return;}
        const responses=media.get(match[1])??new Set<ServerResponse>();responses.add(res);media.set(match[1],responses);res.on('close',()=>{responses.delete(res);if(!responses.size)media.delete(match[1]);});
        const range=req.headers.range;let start=0,end=stat.size-1;
        if(range){const parts=/^bytes=(\d*)-(\d*)$/.exec(range);if(!parts||!parts[1]&&!parts[2]){await handle.close();res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});res.end();return;}
          if(parts[1]){start=Number(parts[1]);end=parts[2]?Number(parts[2]):end;}else start=Math.max(0,stat.size-Number(parts[2]));
          end=Math.min(end,stat.size-1);if(start>end||start<0||start>=stat.size){await handle.close();res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});res.end();return;}
        }
        const contentType=artifact.type==='video'?'video/webm':artifact.type==='screenshot'?'image/png':'application/json; charset=utf-8';
        res.writeHead(range?206:200,{'Content-Type':contentType,'Accept-Ranges':'bytes','Content-Length':Math.max(0,end-start+1),...(range?{'Content-Range':`bytes ${start}-${end}/${stat.size}`}:{})});
        const stream=handle.createReadStream({start,end,autoClose:true});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);return;
      }
      if(req.method!=='GET'){json(res,405,{error:'Method not allowed'});return;}
      const asset=path.match(/^\/assets\/([a-zA-Z0-9_.-]+)$/);const file=asset?`assets/${asset[1]}`:'index.html';
      if(!asset&&path!=='/'&&!/^\/runs\/[a-zA-Z0-9._-]+$/.test(path)&&path!=='/compare'&&path!=='/plans'&&!/^\/plans\/[a-zA-Z0-9._-]+$/.test(path)){json(res,404,{error:'Not found'});return;}
      const content=await readFile(fileURLToPath(new URL(`./public/${file}`,import.meta.url)));
      res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(content);
    }catch{if(!res.headersSent)json(res,400,{error:'请求无效或数据暂不可用'});else res.destroy();}
  });
  server.on('upgrade',(req,socket,head)=>{
    if(!hostOk(req)){socket.destroy();return;}const path=new URL(req.url??'/',url).pathname;
    const producer=path==='/internal/executors';const match=path.match(/^\/api\/runs\/([a-zA-Z0-9._-]+)\/live$/);
    if(producer?!internalAuth(req):!match||!authenticated(req)||!originOk(req,true)){socket.destroy();return;}
    wss.handleUpgrade(req,socket,head,ws=>{
      ws.on('error',()=>{});
      if(!producer){const id=match![1];if(!registry.runs.has(id)||registry.deleted.has(id)){ws.close(1008,'Run unavailable');return;}
        const set=viewers.get(id)??new Set<WebSocket>();if(set.size>=8){ws.close(1013,'Viewer limit');return;}set.add(ws);viewers.set(id,set);
        send(ws,{type:'status',message:registry.runs.get(id)!.state.meta.live?'等待实时画面':'本次运行已关闭直播'});watch(id);
        ws.on('close',()=>{set.delete(ws);if(!set.size)viewers.delete(id);watch(id);});return;
      }
      let id:string|undefined;let registered=false;let lastChanged=0;let pending=false;
      const registrationTimer=setTimeout(()=>{if(!registered)ws.close(1008,'Registration required');},3000);registrationTimer.unref();
      ws.on('message',async(raw:RawData,binary:boolean)=>{
        try{
          if(binary){if(!id||!registered)return ws.close(1008,'Unregistered');const data=Buffer.from(raw as Buffer);const {header}=decodeFrame(data);const p=producers.get(id);
            if(!p||p.ws!==ws||header.runId!==id||!viewers.get(id)?.size||!registry.runs.get(id)?.state.meta.live)return;
            if(header.streamEpoch<p.epoch||header.streamEpoch===p.epoch&&header.frameSeq<=p.frameSeq)return;
            p.epoch=header.streamEpoch;p.frameSeq=header.frameSeq;broadcast(id,data);return;
          }
          if(Buffer.byteLength(raw.toString())>65536)throw new Error('Control exceeds limit');const input=JSON.parse(raw.toString());
          if(input.type==='register'&&!registered){if(pending)throw new Error('Duplicate registration');pending=true;
            const {type,...payload}=input;const h=HandshakeSchema.parse(payload);await registry.register(h.dataDir,h.runId,h.owner);if(ws.readyState!==WebSocket.OPEN){registry.disconnect(h.runId);return;}
            id=h.runId;const previous=producers.get(id);if(previous&&previous.ws!==ws)previous.ws.close();
            producers.set(id,{ws,lastSeen:Date.now(),epoch:-1,frameSeq:-1});registered=true;clearTimeout(registrationTimer);watch(id);return;
          }
          if(!id||input.runId!==id||!registered)throw new Error('Invalid executor message');
          const p=producers.get(id);if(p?.ws!==ws)return;p.lastSeen=Date.now();registry.heartbeat(id);
          if(input.type==='live.status'){for(const viewer of viewers.get(id)??[])send(viewer,{type:'status',message:String(input.message).slice(0,250)});}
          else if(input.type==='changed'&&Date.now()-lastChanged>100){lastChanged=Date.now();await registry.refresh(id,true);}
          else if(input.type!=='heartbeat'&&input.type!=='changed')throw new Error('Unknown control message');
        }catch{ws.close(1008,'Invalid executor data');}
      });
      ws.on('close',()=>{clearTimeout(registrationTimer);if(id&&producers.get(id)?.ws===ws){producers.delete(id);registry.disconnect(id);for(const viewer of viewers.get(id)??[])send(viewer,{type:'status',message:'执行器连接已断开，正在确认状态'});}});
    });
  });
  const listen=async(port:number)=>new Promise<void>((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',fail);ok();});});
  let preferred=options.port??4318;try{if(options.port===undefined){const old=await jsonFile(join(root,'last-port.json'));if(Number.isInteger(old.port)&&old.port>0&&old.port<65536)preferred=old.port;}}catch{}
  try{await listen(preferred);}catch(e){if((e as NodeJS.ErrnoException).code!=='EADDRINUSE')throw e;await listen(0);}
  url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  await registry.start(options.defaultDataDir??dataRoot());
  const endpoint={protocolVersion:1,instance,url,pid:process.pid,nonce,started:await processStamp()};
  await atomicJson(join(root,'credentials.json'),{instance,token});await atomicJson(join(root,'endpoint.json'),endpoint);
  await atomicJson(join(root,'last-port.json'),{port:(server.address() as {port:number}).port});
  const maintenance=setInterval(()=>{
    const now=Date.now();for(const [ticket,expires]of tickets)if(expires<now)tickets.delete(ticket);for(const [session,expires]of sessions)if(expires<now)sessions.delete(session);
    for(const [id,p]of producers)if(now-p.lastSeen>15000){p.ws.terminate();registry.disconnect(id);}
    for(const s of subscribers)if(s.res.writableLength>256*1024)s.res.destroy();else s.res.write(': heartbeat\n\n');
  },3000);maintenance.unref();
  function close():Promise<void>{
    return closing??=shutdown();
  }
  async function shutdown(){
    clearInterval(maintenance);for(const s of subscribers)s.res.end();subscribers.clear();
    for(const ws of wss.clients)ws.terminate();wss.close();await registry.close();
    server.closeAllConnections();await new Promise<void>(ok=>server.close(()=>ok()));
    try{if((await jsonFile(join(root,'endpoint.json'))).instance===instance){await rm(join(root,'endpoint.json'),{force:true});await rm(join(root,'credentials.json'),{force:true});}}catch{}
  }
  return {url,token,instance,registry,close};
}
