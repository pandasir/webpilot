import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {chmod,writeFile} from 'node:fs/promises';
import {z} from 'zod';
import {BindingsSchema,HttpUrlSchema,StepSchema,TargetSchema,isAssertion,type Plan,type StepResult} from './schema.js';
import {Budget} from './budget.js';
import {capture,runPlan,saveCase,type RunOptions} from './runner.js';
import {PilotError,errorInfo} from './errors.js';
import {doctor} from './runtime.js';
import {BrowserSession} from '../browser/session.js';
import {inspectProject,prepareService,collectContext} from '../project/index.js';
import {Store} from '../artifacts/store.js';
import {Redactor} from '../artifacts/redaction.js';
import {exportPlan,verifyExport} from '../artifacts/export.js';
import {recordingPlayer} from '../artifacts/video.js';
import {Progress} from './progress.js';
import {openDashboard} from '../dashboard/lifecycle.js';
import {TitleSchema,explorationTitle} from './titles.js';
import {CoverageStore} from '../artifacts/coverage.js';
import {CoverageDraftSchema,CoverageRefSchema,coveragePlan} from './coverage.js';
import {PlannedSessions} from './planned-session.js';

interface LiveSession {session:BrowserSession;service:Awaited<ReturnType<typeof prepareService>>;runId:string;controller:AbortController;timer:ReturnType<typeof setTimeout>;busy:boolean;steps:StepResult[];progress:Progress;closed?:boolean;idle?:Promise<void>;idleResolve?:()=>void}
export class WebPilotService {
  readonly store:Store;
  readonly coverageStore:CoverageStore;
  readonly planned:PlannedSessions;
  private sessions=new Map<string,LiveSession>();
  private closing=new Map<string,Promise<any>>();
  constructor(readonly dataDir?:string){this.store=new Store(dataDir);this.coverageStore=new CoverageStore(dataDir);this.planned=new PlannedSessions(this.store,this.coverageStore);}
  async prepare(input:unknown){const target=await inspectProject(input);return {runtime:await doctor({dataDir:this.dataDir}),...target};}
  async open(input:unknown,options:RunOptions & {role?:string;title?:string}={}){
    if(options.coverage)return this.planned.open(input,{...options,title:options.title===undefined?undefined:TitleSchema.parse(options.title),coverage:options.coverage});
    const initial=TargetSchema.parse(input);
    const taskTitle=options.title===undefined?undefined:TitleSchema.parse(options.title);
    const bindings=BindingsSchema.parse(options.bindings??{});const redactor=new Redactor(bindings);
    const controller=new AbortController();
    let timer=setTimeout(()=>controller.abort(),initial.budget.totalMs);
    const signal=options.signal?AbortSignal.any([controller.signal,options.signal]):controller.signal;
    let service:Awaited<ReturnType<typeof prepareService>>|undefined;let session:BrowserSession|undefined;
    const runId=`run-${randomUUID()}`;
    await this.store.prune();await this.store.beginRun(runId,initial.evidence.retentionDays,initial.evidence.rawTrace,initial.evidence.video);
    const progress=await Progress.create(this.store.runDir(runId),this.store.root,{id:runId,title:taskTitle??explorationTitle(initial),titleSource:taskTitle?'task':'target',mode:'exploration',target:initial.url??'准备目标中',project:initial.projectPath,startedAt:new Date().toISOString(),cases:[],live:initial.evidence.live},redactor,options);
    try{
      await progress.phase('preparing','检查项目与准备浏览器');
      const inspection=await inspectProject(input);await progress.target(inspection.target);
      await this.store.configureRun(runId,inspection.target.evidence);
      clearTimeout(timer);timer=setTimeout(()=>controller.abort(),inspection.target.budget.totalMs);
      service=await prepareService(inspection,signal);
      await progress.target(service.target);
      session=new BrowserSession(service.target,new Budget(service.target.budget,signal),bindings,redactor);
      await progress.attach(session,'exploration',1);
      await session.open({role:options.role,headful:options.headful,recordingDir:join(this.store.runDir(runId),'videos','exploration','1')});
      await progress.emit('attempt.started',{}, {caseId:'exploration',attempt:1});
      await progress.phase('running','等待探索步骤');
      this.sessions.set(session.id,{session,service,runId,controller,timer,busy:false,steps:[],progress});
      const id=session.id;signal.addEventListener('abort',()=>{void this.close(id).catch(()=>{});},{once:true});
      return {sessionId:id,runId,viewport:service.target.viewport};
    }catch(error){clearTimeout(timer);await session?.close().catch(()=>{});
      if(session)await this.persist({session,runId,steps:[],progress});
      await service?.close();await progress.finish({reason:redactor.text(errorInfo(error).message)});throw error;}
  }
  private async persist(live:Pick<LiveSession,'session'|'runId'|'steps'|'closed'|'progress'>){
    const {session,runId,steps}=live;
    await writeFile(join(this.store.runDir(runId),'session.json'),JSON.stringify(session.redactor.object({schemaVersion:1,sessionId:session.id,runId,title:live.progress.meta.title,titleSource:live.progress.meta.titleSource,steps,recordings:session.recordings,closed:live.closed??false,...(live.closed?{finishedAt:new Date().toISOString()}: {})}),null,2)+'\n',{mode:0o600});
    if(session.target.evidence.video)await writeFile(join(this.store.runDir(runId),'recordings.html'),recordingPlayer(`WebPilot 流程录像：${runId}`,this.store.runDir(runId),[{title:live.progress.meta.title,recordings:session.redactor.object(session.recordings)}]),{mode:0o600});
  }
  private live(id:string){const live=this.sessions.get(id);if(!live)throw new PilotError('SESSION_EXPIRED','Session unavailable or expired');return live;}
  async observe(id:string){if(this.planned.has(id))return this.planned.observe(id);const live=this.live(id);return live.session.observe();}
  async step(id:string,input:unknown,assertion:boolean,signal?:AbortSignal,association:{caseId?:string;revision?:number;attempt?:number}={}){
    if(this.planned.has(id))return this.planned.step(id,input,assertion,association,signal);
    const live=this.live(id);if(live.busy)throw new PilotError('SESSION_BUSY','Wait for the current operation to complete');
    const step=StepSchema.parse(input);if(isAssertion(step)!==assertion)throw new PilotError('STEP_KIND_MISMATCH',assertion?'Use session_check for assertions':'Use session_act for actions');
    if(isAssertion(step) && step.source.type==='inferred' && !step.candidate)throw new PilotError('ASSERTION_SOURCE_REQUIRED','Inferred assertions must be candidates');
    if(live.steps.some(s=>s.id===step.id))throw new PilotError('STEP_ID_EXISTS','Use a unique step id within a session');
    const start=Date.now();const result:StepResult={id:step.id,op:step.op,outcome:'passed',timestamp:new Date().toISOString(),durationMs:0,candidate:isAssertion(step)&&step.candidate,evidence:[]};
    const abort=()=>live.controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    live.busy=true;live.idle=new Promise(resolve=>{live.idleResolve=resolve;});try{
      await live.progress.emit('step.started',{op:step.op},{caseId:'exploration',attempt:1,stepId:step.id});
      try{result.actual=(await live.session.perform(step)).actual;}catch(error){const info=errorInfo(error);result.outcome=result.candidate && info.outcome==='failed'?'inconclusive':info.outcome;result.error={code:info.code,message:info.message};}
      if(isAssertion(step) && 'expected' in step)result.expected=step.expected;
      result.durationMs=Date.now()-start;
      await live.progress.emit('step.finished',result,{caseId:'exploration',attempt:1,stepId:step.id});
      await live.progress.phase('collecting','采集探索步骤证据');
      await capture(live.session,this.store,live.runId,'exploration',1,result);
      await live.progress.emit('evidence.available',{step:result},{caseId:'exploration',attempt:1,stepId:step.id});
      const safe=live.session.redactor.object(result);live.steps.push(safe);
      await this.persist(live);
      return safe;
    }finally{live.busy=false;live.idleResolve?.();live.idle=undefined;signal?.removeEventListener('abort',abort);}
  }
  close(id:string):Promise<any>{
    if(this.planned.has(id))return this.planned.close(id);
    const pending=this.closing.get(id);if(pending)return pending;
    const task=this.finishClose(id);this.closing.set(id,task);if(this.closing.size>32)this.closing.delete(this.closing.keys().next().value!);return task;
  }
  private async finishClose(id:string){
    const live=this.live(id);this.sessions.delete(id);clearTimeout(live.timer);
    if(live.busy)live.controller.abort();await live.idle;live.closed=true;
    await live.progress.phase('cleaning','关闭浏览器并定稿录像');await live.progress.detachBrowser();
    const errors:string[]=[];
    try{const trace=live.session.target.evidence.rawTrace?join(this.store.runDir(live.runId),'sensitive-trace.zip'):undefined;await live.session.close(trace);if(trace)await chmod(trace,0o600);}catch(error){errors.push(errorInfo(error).message);}
    await this.persist(live);
    live.controller.abort();
    try{await live.service.close();}catch(error){errors.push(errorInfo(error).message);}
    await live.progress.emit('recording.available',{recordings:live.session.recordings},{caseId:'exploration',attempt:1});
    await live.progress.finish({reason:errors.length?live.session.redactor.text(errors.join('; ')):undefined});
    return {sessionId:id,runId:live.runId,closed:true,cleanupErrors:live.session.redactor.object(errors),recordings:live.session.redactor.object(live.session.recordings),...(live.session.target.evidence.video?{playbackPath:join(this.store.runDir(live.runId),'recordings.html')}: {})};
  }
  async closeAll(){await this.planned.closeAll();for(const id of [...this.sessions.keys()])await this.close(id).catch(()=>{});}
  run(input:unknown,options:RunOptions={}){return runPlan(input,{...options,dataDir:this.dataDir});}
  save(input:unknown,target:Plan['target'],options:RunOptions & {promote?:boolean}={}){return saveCase(input,target,{...options,dataDir:this.dataDir});}
}

export const ToolInputs={
  dashboard_open:z.object({open:z.boolean().default(true),force:z.boolean().default(false)}).strict(),
  coverage_create:z.object({draft:CoverageDraftSchema,bindings:BindingsSchema.default({}),dashboard:z.boolean().optional()}).strict(),
  coverage_read:z.object({id:CoverageRefSchema.shape.id,revision:CoverageRefSchema.shape.revision.optional(),dashboard:z.boolean().optional()}).strict(),
  coverage_update:z.object({id:CoverageRefSchema.shape.id,expectedRevision:CoverageRefSchema.shape.revision,requestId:CoverageRefSchema.shape.id,draft:CoverageDraftSchema,reason:z.string().min(1),bindings:BindingsSchema.default({}),dashboard:z.boolean().optional()}).strict(),
  coverage_adopt:z.object({coverage:CoverageRefSchema,reference:z.string().min(1),userConfirmed:z.boolean().default(false),dashboard:z.boolean().optional()}).strict(),
  session_case_begin:z.object({sessionId:z.string(),caseId:CoverageRefSchema.shape.id,coverage:CoverageRefSchema}).strict(),
  session_case_end:z.object({sessionId:z.string()}).strict(),
  session_case_sync:z.object({sessionId:z.string(),coverage:CoverageRefSchema}).strict(),
  runtime_info:z.object({}).strict(),
  runtime_doctor:z.object({}).strict(),
  project_inspect:z.object({target:z.unknown()}).strict(),
  context_collect:z.object({projectPath:z.string().optional(),requirements:z.array(z.string()).optional(),diffRef:z.string().optional()}).strict(),
  run_prepare:z.object({target:z.unknown()}).strict(),
  session_open:z.object({target:z.unknown(),coverage:CoverageRefSchema.optional(),title:TitleSchema.optional(),bindings:BindingsSchema.default({}),role:z.string().optional(),headful:z.boolean().default(false),dashboard:z.boolean().optional()}).strict(),
  session_observe:z.object({sessionId:z.string()}).strict(),
  session_act:z.object({sessionId:z.string(),step:StepSchema,caseId:CoverageRefSchema.shape.id.optional(),revision:CoverageRefSchema.shape.revision.optional(),attempt:CoverageRefSchema.shape.revision.optional()}).strict(),
  session_check:z.object({sessionId:z.string(),step:StepSchema,caseId:CoverageRefSchema.shape.id.optional(),revision:CoverageRefSchema.shape.revision.optional(),attempt:CoverageRefSchema.shape.revision.optional()}).strict(),
  session_close:z.object({sessionId:z.string()}).strict(),
  suite_run:z.object({plan:z.unknown().optional(),coverage:CoverageRefSchema.optional(),bindings:BindingsSchema.default({}),headful:z.boolean().default(false),dashboard:z.boolean().optional()}).strict(),
  report_read:z.object({runId:z.string()}).strict(),
  case_save:z.object({case:z.unknown(),target:z.unknown(),bindings:BindingsSchema.default({}),promote:z.boolean().default(false)}).strict(),
  case_export:z.object({plan:z.unknown(),output:z.string(),bindings:BindingsSchema.default({})}).strict(),
  export_verify:z.object({directory:z.string(),url:HttpUrlSchema,bindingsFile:z.string().optional(),targetConfig:z.string().optional()}).strict(),
};
export async function dispatch(service:WebPilotService,name:string,input:unknown,signal?:AbortSignal){
  if(!Object.hasOwn(ToolInputs,name))throw new PilotError('UNKNOWN_TOOL',`Unknown tool: ${name}`);
  const schema=ToolInputs[name as keyof typeof ToolInputs];
  const args=schema.parse(input) as Record<string,any>;
  switch(name){
    case 'dashboard_open':return openDashboard({auto:true,open:args.open,force:args.force});
    case 'coverage_create':return service.coverageStore.create(args.draft,args.bindings);
    case 'coverage_read':return service.coverageStore.read({id:args.id,revision:args.revision});
    case 'coverage_update':return service.coverageStore.update(args.id,args.expectedRevision,args.requestId,args.draft,args.reason,args.bindings);
    case 'coverage_adopt':return service.coverageStore.adopt(args.coverage,args.reference,args.userConfirmed);
    case 'session_case_begin':return service.planned.begin(args.sessionId,args.caseId,args.coverage);
    case 'session_case_end':return service.planned.end(args.sessionId);
    case 'session_case_sync':return service.planned.sync(args.sessionId,args.coverage);
    case 'runtime_info':return {apiVersion:1,name:'webpilot',version:'0.1.0'};
    case 'runtime_doctor':return doctor({dataDir:service.dataDir});
    case 'project_inspect':return inspectProject(args.target);
    case 'context_collect':return collectContext(args);
    case 'run_prepare':return service.prepare(args.target);
    case 'session_open':return service.open(args.target,{title:args.title,coverage:args.coverage,bindings:args.bindings,role:args.role,headful:args.headful,dashboard:args.dashboard,signal});
    case 'session_observe':return service.observe(args.sessionId);
    case 'session_act':return service.step(args.sessionId,args.step,false,signal,args);
    case 'session_check':return service.step(args.sessionId,args.step,true,signal,args);
    case 'session_close':return service.close(args.sessionId);
    case 'suite_run':return service.run(args.plan??(args.coverage?coveragePlan(await service.coverageStore.snapshot(args.coverage)):undefined),{coverage:args.coverage,bindings:args.bindings,headful:args.headful,dashboard:args.dashboard,signal});
    case 'report_read':return service.store.readRun(args.runId);
    case 'case_save':return service.save(args.case,args.target,{bindings:args.bindings,promote:args.promote,signal});
    case 'case_export':return exportPlan(args.plan,args.output,args.bindings);
    case 'export_verify':return verifyExport(args.directory,{url:args.url,bindingsFile:args.bindingsFile,targetConfig:args.targetConfig,signal});
  }
}
