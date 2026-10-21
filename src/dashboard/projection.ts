import {CoverageSnapshotSchema,coverageResult,type CoverageSnapshot} from '../core/coverage.js';
import {createHash} from 'node:crypto';
import {join,resolve,basename,relative,dirname} from 'node:path';
import {realpath} from 'node:fs/promises';
import {z} from 'zod';
import {RunSchema,RecordingSchema,StepResultSchema,type Attempt,type StepResult,type Run} from '../core/schema.js';
import {MetaSchema,ProgressEventSchema,type RunMeta,type ProgressEvent} from './protocol.js';
import type {ManagementView} from '../artifacts/management.js';
import {openArtifact,ownerAlive,within} from './files.js';
import {DEFAULT_EXPLORATION_TITLE,TitleSchema,TitleRecordSchema,explorationTitle} from '../core/titles.js';

export interface Artifact {id:string;type:string;name:string;caseId?:string;attempt?:number;pageId?:string;pageName?:string;stepId?:string;path:string}
export interface LiveCase {id:string;title:string;version:number;outcome?:string;unstable?:boolean;attempts:Attempt[];activeStep?:{id:string;op:string;timestamp:string}}
type ProjectedMeta=Omit<RunMeta,'owner'>&{owner?:RunMeta['owner']};
export interface LiveRun {coverage?:CoverageSnapshot;coverageResult?:ReturnType<typeof coverageResult>;management?:ManagementView;metadataSource?:'live'|'legacy'|'unreadable';legacyFinalized?:boolean;id:string;meta:ProjectedMeta;seq:number;lifecycle:string;connection:string;message?:string;outcome?:string;unstable?:boolean;finishedAt?:string;outcomePolicy?:'formal-v1';cases:LiveCase[];gaps:string[];cleanupErrors:string[];artifacts:Artifact[];recordingGaps:string[];report?:Run;session?:unknown;logGap?:string}
export function initialRun(meta:ProjectedMeta):LiveRun{return {id:meta.id,meta,seq:0,lifecycle:'preparing',connection:'unknown',cases:meta.cases.map(c=>({...c,attempts:[]})),gaps:[],cleanupErrors:[],artifacts:[],recordingGaps:[]};}
export function applyEvent(run:LiveRun,e:ProgressEvent){
  if(e.runId!==run.id||e.seq<=run.seq)return;
  if(e.seq!==run.seq+1){run.logGap=`进度日志缺少序号 ${run.seq+1}`;return;}
  run.seq=e.seq;const p=e.payload as any;
  let c=e.caseId?run.cases.find(c=>c.id===e.caseId):undefined;
  if(e.caseId&&!c){c={id:e.caseId,title:'浏览器探索',version:1,attempts:[]};run.cases.push(c);}
  let a=c&&e.attempt?c.attempts.find(a=>a.number===e.attempt):undefined;
  if(c&&e.attempt&&!a){a={number:e.attempt,outcome:'inconclusive',steps:[]};c.attempts.push(a);}
  switch(e.type){
    case 'coverage.updated':{run.meta.totalCases=p.cases.length;run.meta.cases=p.cases;for(const item of p.cases)if(!run.cases.some(c=>c.id===item.id))run.cases.push({...item,attempts:[]});break;}
    case 'phase.changed':run.lifecycle=p.phase;run.message=p.message;break;
    case 'case.started':run.lifecycle='running';break;
    case 'step.started':if(c)c.activeStep={id:e.stepId!,op:p.op,timestamp:e.timestamp};run.lifecycle='running';run.message=`正在执行步骤 ${e.stepId}`;break;
    case 'step.finished':case 'evidence.available':if(a){const step=e.type==='step.finished'?p:p.step;const i=a.steps.findIndex(s=>s.id===step.id);if(i<0)a.steps.push(step);else a.steps[i]=step;if(c)c.activeStep=undefined;}break;
    case 'attempt.finished':if(a)Object.assign(a,p);break;
    case 'case.finished':if(c)Object.assign(c,p);break;
    case 'recording.available':if(a)a.recordings=p.recordings;break;
    case 'run.finished':run.lifecycle='finished';run.finishedAt=e.timestamp;run.outcome=p.outcome;run.unstable=p.unstable;run.message=p.reason;break;
  }
}
export function parseEvents(text:string){
  const lines=text.split('\n');const tail=lines.pop()!;const events:ProgressEvent[]=[];let invalid=false;
  for(const line of lines){if(!line.trim())continue;try{events.push(ProgressEventSchema.parse(JSON.parse(line)));}catch{invalid=true;}}
  return {events,partial:!!tail,invalid};
}
async function read(root:string,name:string){const {handle,stat}=await openArtifact(root,join(root,name));try{if(stat.size>32*1024*1024)throw new Error('Metadata exceeds limit');return await handle.readFile('utf8');}finally{await handle.close();}}
export async function readRunFile(root:string,name:string){return JSON.parse(await read(root,name));}
async function legacyFinalized(root:string,id:string,session:unknown){
  const parsed=z.object({runId:z.literal(id),schemaVersion:z.literal(1).optional(),sessionId:z.string().optional(),closed:z.boolean().optional(),steps:z.array(StepResultSchema),recordings:z.array(RecordingSchema).optional()}).safeParse(session);
  if(!parsed.success)return false;
  const s=parsed.data;if(s.closed===true)return true;if(s.closed===false||s.schemaVersion!==1||!s.sessionId)return false;
  // Old executors append available recordings only after closing the context.
  const videos=s.recordings?.filter(r=>r.status==='available')??[];if(!videos.length)return false;
  for(const video of videos){
    let file=resolve(video.path);if(!within(root,file)){try{file=join(await realpath(dirname(file)),basename(file));}catch{return false;}}
    if(!within(root,file)||!/^videos\/[a-zA-Z0-9._-]+\/\d+\/[^/]+\.webm$/.test(relative(root,file).split('\\').join('/')))return false;
    try{const {handle,stat}=await openArtifact(root,file);await handle.close();if(!stat.size)return false;}catch{return false;}
  }
  return true;
}
export async function loadRun(root:string,id:string,connected=false):Promise<LiveRun>{
  let report:Run|undefined;let session:any;let meta:ProjectedMeta;let metadataSource:LiveRun['metadataSource']='live';
  try{report=RunSchema.parse(await readRunFile(root,'report.json'));}catch{}
  try{session=await readRunFile(root,'session.json');}catch{}
  try{meta=MetaSchema.parse(await readRunFile(root,'live.json'));}catch(error){
    if(!report&&!session)throw new Error('No readable run metadata');
    metadataSource=(error as NodeJS.ErrnoException).code==='ENOENT'?'legacy':'unreadable';
    meta=MetaSchema.omit({owner:true}).parse({protocolVersion:1,id,title:report?.scope.join('、')??(TitleSchema.safeParse(session?.title).success?session.title:DEFAULT_EXPLORATION_TITLE),mode:report?'suite':'exploration',target:report?.target.url??'未知目标',project:report?.target.projectPath,startedAt:report?.startedAt??'',cases:report?.cases.map(c=>({id:c.id,title:c.title,version:c.version}))??[],totalCases:report?.cases.length,live:false});
  }
  if(meta.id!==id||report&&report.id!==id||session&&session.runId!==id)throw new Error('Run identity mismatch');
  const run=initialRun(meta);run.metadataSource=metadataSource;let eventsMissing=false;
  try{const parsed=parseEvents(await read(root,'events.jsonl'));for(const event of parsed.events)applyEvent(run,event);if(parsed.invalid)run.logGap='部分进度日志不可读取';if(parsed.partial&&!connected)run.logGap='进度日志末尾未完成写入';}catch(error){eventsMissing=(error as NodeJS.ErrnoException).code==='ENOENT';}
  if(report){run.report=report;run.outcomePolicy=report.outcomePolicy;run.cases=report.cases;run.outcome=report.outcome;run.unstable=report.unstable;run.finishedAt=report.finishedAt;run.lifecycle='finished';run.gaps=report.gaps;run.cleanupErrors=report.cleanupErrors;}
  if(session){run.session=session;if(!report&&meta.mode==='planned-session'){if(Array.isArray(session.cases))for(const c of session.cases){const at=run.cases.findIndex(x=>x.id===c.id);if(at>=0){const activeStep=run.cases[at].activeStep;run.cases[at]={...c,activeStep};}else run.cases.push(c);}if(session.closed){run.lifecycle='finished';run.finishedAt=session.finishedAt;}}else if(!report){const c=run.cases[0]??{id:'exploration',title:'浏览器探索',version:1,attempts:[]};run.cases=[c];if(!c.attempts.length)c.attempts=[{number:1,outcome:'inconclusive',steps:session.steps??[]}];if(session.closed===true){run.lifecycle='finished';run.finishedAt=session.finishedAt;}}}
  if(!meta.owner&&!report){
    run.lifecycle='historical';run.legacyFinalized=!connected&&metadataSource==='legacy'&&eventsMissing&&await legacyFinalized(root,id,session);
    run.message=run.legacyFinalized?'旧版探索记录，已有证据保留，执行结果未记录。':'历史记录缺少可靠的结束信息，暂不可管理。';
  }
  run.connection=connected?'connected':['finished','historical'].includes(run.lifecycle)?'unknown':'disconnected';
  if(meta.owner&&!connected&&run.lifecycle!=='finished'&&await ownerAlive(meta.owner)===false){run.lifecycle='interrupted';run.message='执行器已退出，剩余范围未验证。';}
  try{run.coverage=CoverageSnapshotSchema.parse(await readRunFile(root,'coverage.json'));run.coverageResult=coverageResult(run.coverage,{id,cases:run.cases as Run['cases']},['finished','interrupted'].includes(run.lifecycle));}catch{}
  const artifacts=new Map<string,Artifact>();
  const add=async(path:string,type:string,info:Partial<Artifact>)=>{
    if(typeof path!=='string')return;
    let file=resolve(path);if(!within(root,file)){try{file=join(await realpath(dirname(file)),basename(file));}catch{return;}}if(!within(root,file))return;
    const rel=relative(root,file).split('\\').join('/');
    const permitted=type==='video'?/^videos\/[a-zA-Z0-9._-]+\/\d+\/[^/]+\.webm$/.test(rel):new RegExp(`^${type}-[a-zA-Z0-9-]+\\.${type==='screenshot'?'png':'json'}$`).test(rel);
    if(!permitted||!['video','screenshot','snapshot','network','console'].includes(type))return;
    const id=`asset-${createHash('sha256').update(rel).digest('hex').slice(0,24)}`;
    artifacts.set(id,{...info,id,type,name:basename(file),path:file});
  };
  for(const c of run.cases)for(const a of c.attempts){
    for(const s of a.steps)for(const e of s.evidence??[])if(e.path)await add(e.path,e.type,{caseId:c.id,attempt:a.number,stepId:s.id});
    for(const r of a.recordings??[])if(r.status==='available')await add(r.path,'video',{caseId:c.id,attempt:a.number,pageId:r.pageId,pageName:r.pageName});else run.recordingGaps.push(r.reason);
  }
  if(session?.observations)for(const observation of session.observations)for(const r of observation.recordings??[])if(r.status==='available')await add(r.path,'video',{caseId:'observation',attempt:observation.attempt,pageId:r.pageId,pageName:r.pageName});
  if(session)for(const r of session.recordings??[])if(r.status==='available')await add(r.path,'video',{caseId:'exploration',attempt:1,pageId:r.pageId,pageName:r.pageName});else if(r.reason)run.recordingGaps.push(r.reason);
  run.artifacts=[...artifacts.values()];
  if(meta.mode==='planned-session')run.cases=run.cases.filter(c=>c.id!=='observation');
  if(meta.mode==='exploration'&&meta.title===DEFAULT_EXPLORATION_TITLE&&meta.titleSource!=='task')meta.title=explorationTitle({projectPath:meta.project,url:meta.target});
  try{meta.title=TitleRecordSchema.parse(await readRunFile(root,'title.json')).title;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')run.logGap=[run.logGap,'自定义标题不可读取，显示原名称；可重新保存名称修复。'].filter(Boolean).join('；');}
  return run;
}
export function publicRun(run:LiveRun){
  const {report,session,...rest}=run;
  return {...rest,artifacts:run.artifacts.map(({path,...a})=>a),cases:run.cases.map(c=>({...c,attempts:c.attempts.map(a=>({...a,recordings:a.recordings?.map(r=>r.status==='available'?{status:r.status,pageId:r.pageId,pageName:r.pageName}:r),steps:a.steps.map(s=>({...s,evidence:s.evidence.map(({path,...e})=>e)}))}))}))};
}
