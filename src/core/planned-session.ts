import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {writeFile,chmod} from 'node:fs/promises';
import {BrowserSession} from '../browser/session.js';
import {CoverageStore} from '../artifacts/coverage.js';
import {Store,markdownReport} from '../artifacts/store.js';
import {Redactor,assertPortable} from '../artifacts/redaction.js';
import {atomicJson} from '../dashboard/files.js';
import {inspectProject,prepareService,runCommand} from '../project/index.js';
import {Budget} from './budget.js';
import {Progress} from './progress.js';
import {capture,type RunOptions} from './runner.js';
import {BindingsSchema,RunSchema,StepSchema,TargetSchema,VERSION,isAssertion,type Run,type Attempt,type StepResult,type Case} from './schema.js';
import {coveragePlan,coverageResult,reconciliationMarkdown,digest,type CoverageSnapshot,type CoverageRef} from './coverage.js';
import {PilotError,errorInfo} from './errors.js';
import {summarizeAcceptance} from './acceptance.js';

type Result=Run['cases'][number];
interface Live {
  id:string;runId:string;snapshot:CoverageSnapshot;service:Awaited<ReturnType<typeof prepareService>>;
  progress:Progress;budget:Budget;redactor:Redactor;bindings:Record<string,string>;headful?:boolean;
  context?:BrowserSession;results:Result[];active?:{test:Case;attempt:Attempt;result:Result;prepared:boolean};
  controller:AbortController;signal:AbortSignal;timer:ReturnType<typeof setTimeout>;busy?:Promise<unknown>;closing?:Promise<unknown>;
  cleanupErrors:string[];startedAt:string;browserVersion:string;observations:unknown[];
}
export class PlannedSessions {
  private sessions=new Map<string,Live>();
  private closed=new Map<string,Promise<any>>();
  constructor(readonly store:Store,readonly coverageStore:CoverageStore){}
  has(id:string){return this.sessions.has(id)||this.closed.has(id);}
  private live(id:string){const live=this.sessions.get(id);if(!live||live.closing)throw new PilotError('SESSION_EXPIRED','Planned session unavailable');return live;}
  private async exclusive<T>(live:Live,work:()=>Promise<T>){if(live.busy)throw new PilotError('SESSION_BUSY','Wait for the current operation');const task=work();live.busy=task;try{return await task;}finally{live.busy=undefined;}}
  async open(input:unknown,options:RunOptions&{coverage:CoverageRef;title?:string}){
    const target=TargetSchema.parse(input),bindings=BindingsSchema.parse(options.bindings??{}),redactor=new Redactor(bindings);assertPortable(target,bindings);
    const snapshot=await this.coverageStore.snapshot(options.coverage);
    if(digest(target)!==digest(snapshot.manifest.draft.target))throw new PilotError('COVERAGE_MISMATCH','Target differs from the adopted coverage plan');
    const plan=coveragePlan(snapshot),runId=`run-${randomUUID()}`,id=`session-${randomUUID()}`;await this.store.prune();await this.store.beginRun(runId,target.evidence.retentionDays,target.evidence.rawTrace,target.evidence.video);
    await this.coverageStore.saveSnapshot(options.coverage,this.store.runDir(runId));await atomicJson(join(this.store.runDir(runId),'plan.json'),plan);await this.coverageStore.link(options.coverage,runId);
    const startedAt=new Date().toISOString();const progress=await Progress.create(this.store.runDir(runId),this.store.root,{id:runId,title:options.title??snapshot.manifest.draft.title,titleSource:'task',mode:'planned-session',target:target.url??'准备目标中',project:target.projectPath,startedAt,totalCases:plan.cases.length,cases:plan.cases.map(c=>({id:c.id,title:c.title,version:c.version})),live:target.evidence.live},redactor,options);
    const controller=new AbortController(),signal=options.signal?AbortSignal.any([controller.signal,options.signal]):controller.signal;const timer=setTimeout(()=>controller.abort(),target.budget.totalMs);let service:Live['service']|undefined,context:BrowserSession|undefined;
    try{
      await progress.phase('preparing','准备覆盖计划的前置观察');const inspection=await inspectProject(input);service=await prepareService(inspection,signal);await progress.target(service.target);await this.store.configureRun(runId,service.target.evidence);
      const budget=new Budget(service.target.budget,signal);context=new BrowserSession(service.target,budget,bindings,redactor);await progress.attach(context,'observation',1);await context.open({headful:options.headful,recordingDir:join(this.store.runDir(runId),'videos','observation','1')});
      const live:Live={id,runId,snapshot,service,progress,budget,redactor,bindings,headful:options.headful,context,results:[],controller,signal,timer,cleanupErrors:[],startedAt,browserVersion:context.browser.version(),observations:[]};this.sessions.set(id,live);await this.persist(live);
      signal.addEventListener('abort',()=>{void this.close(id).catch(()=>{});},{once:true});if(signal.aborted)void this.close(id).catch(()=>{});
      await progress.phase('running','观察页面后按已采用清单开始用例');return {sessionId:id,runId,viewport:service.target.viewport,coverage:options.coverage};
    }catch(error){this.sessions.delete(id);clearTimeout(timer);await context?.close().catch(()=>{});await service?.close().catch(()=>{});await progress.finish({reason:redactor.text(errorInfo(error).message)});throw error;}
  }
  async observe(id:string){const live=this.live(id);return this.exclusive(live,async()=>{if(!live.context)throw new PilotError('CASE_NOT_STARTED','Begin a case before observing again');live.budget.consume();const observed=await live.context.observe();await live.progress.emit('observation.finished',{url:observed.url,title:observed.title});return observed;});}
  private async persist(live:Live){await atomicJson(join(this.store.runDir(live.runId),'session.json'),live.redactor.object({schemaVersion:1,sessionId:live.id,runId:live.runId,title:live.progress.meta.title,titleSource:'task',coverage:{id:live.snapshot.manifest.id,revision:live.snapshot.manifest.revision},closed:!!live.closing,cases:live.results,steps:[],recordings:live.context?.recordings??[],observations:live.observations}));await atomicJson(join(this.store.runDir(live.runId),'coverage-result.json'),coverageResult(live.snapshot,{id:live.runId,cases:live.results}));}
  private async closeContext(live:Live,caseId:string,attempt:number){if(!live.context)return;const context=live.context;live.context=undefined;await live.progress.detachBrowser();try{const trace=context.target.evidence.rawTrace?join(this.store.runDir(live.runId),`sensitive-trace-${caseId}-${attempt}.zip`):undefined;await context.close(trace);if(trace)await chmod(trace,0o600);}catch(e){const message=errorInfo(e).message;live.cleanupErrors.push(message);if(live.active)live.active.attempt.cleanupError=message;}
    const recordings=live.redactor.object(context.recordings);if(live.active)live.active.attempt.recordings=recordings;else live.observations.push({caseId,attempt,recordings});await live.progress.emit('recording.available',{recordings},{caseId,attempt});}
  async begin(id:string,caseId:string,ref:CoverageRef){const live=this.live(id);return this.exclusive(live,async()=>{
    if(live.active)throw new PilotError('CASE_BUSY','End the current case first');if(ref.id!==live.snapshot.manifest.id)throw new PilotError('COVERAGE_MISMATCH','Keep this session on the same coverage plan');
    if(ref.revision<live.snapshot.manifest.revision)throw new PilotError('PLAN_VERSION_CONFLICT','Do not roll back an executing coverage plan');
    const snapshot=await this.coverageStore.snapshot(ref),item=snapshot.manifest.draft.items.find(i=>i.id===caseId);
    if(!item?.selected)throw new PilotError('CASE_NOT_SELECTED','Case is not in the adopted selected scope');
    for(const done of live.results){const before=live.snapshot.manifest.draft.items.find(i=>i.id===done.id),after=snapshot.manifest.draft.items.find(i=>i.id===done.id);if(!after?.selected||digest(before?.executable)!==digest(after.executable))throw new PilotError('EXECUTED_CASE_CHANGED','Do not alter cases already attempted in this run');}
    // Save the adopted revision before any new operation or data preparation.
    await this.coverageStore.saveSnapshot(ref,this.store.runDir(live.runId));await atomicJson(join(this.store.runDir(live.runId),'plan.json'),coveragePlan(snapshot));live.snapshot=snapshot;await live.progress.emit('coverage.updated',{revision:ref.revision,cases:coveragePlan(snapshot).cases.map(c=>({id:c.id,title:c.title,version:c.version}))});
    await this.closeContext(live,'observation',1);
    const test=coveragePlan(snapshot).cases.find(c=>c.id===caseId)!;let result=live.results.find(c=>c.id===caseId);
    if(result&&(result.outcome!=='failed'||result.attempts.length>=live.service.target.budget.attempts))throw new PilotError('CASE_ALREADY_FINISHED','Case has finished or its attempt budget is exhausted');
    if(!result){result={id:test.id,title:test.title,version:test.version,outcome:'inconclusive',unstable:false,attempts:[]};live.results.push(result);}
    const attempt:Attempt={number:result.attempts.length+1,outcome:'inconclusive',steps:[]};result.attempts.push(attempt);live.active={test,attempt,result,prepared:false};const association={caseId,attempt:attempt.number};await live.progress.emit('case.started',{}, {caseId});await live.progress.emit('attempt.started',{},association);
    try{live.budget.check();if(item.readiness!=='ready')throw new PilotError('CASE_NOT_READY',item.reason??'场景尚未就绪',item.readiness==='needs-clarification'?'inconclusive':'blocked');for(const precondition of test.preconditions)if(!Object.hasOwn(live.bindings,precondition))throw new PilotError('PRECONDITION_MISSING',`Provide runtime prerequisite: ${precondition}`);if(test.conflicts.length)throw new PilotError('SOURCE_CONFLICT',test.conflicts.join('; '));
      live.active.prepared=true;if(live.service.target.data.prepare)await runCommand(live.service.target.data.prepare,live.signal);
      const context=new BrowserSession(live.service.target,live.budget,live.bindings,live.redactor);live.context=context;await live.progress.attach(context,caseId,attempt.number);await context.open({role:test.role,headful:live.headful,recordingDir:join(this.store.runDir(live.runId),'videos',caseId,String(attempt.number))});await this.persist(live);return {sessionId:id,runId:live.runId,caseId,attempt:attempt.number,coverage:ref};
    }catch(error){const info=errorInfo(error);attempt.outcome=info.outcome;attempt.reason=live.redactor.text(info.message);await this.endActive(live);return {sessionId:id,runId:live.runId,caseId,outcome:info.outcome,error:live.redactor.object(info)};}
  });}
  async step(id:string,input:unknown,assertion:boolean,association:{caseId?:string;revision?:number;attempt?:number},signal?:AbortSignal){const live=this.live(id);return this.exclusive(live,async()=>{
    const active=live.active;if(!active||!live.context)throw new PilotError('CASE_NOT_STARTED','Begin an adopted case before business actions');
    if(association.caseId!==active.test.id||association.revision!==live.snapshot.manifest.revision||association.attempt!==active.attempt.number)throw new PilotError('CASE_ASSOCIATION_MISMATCH','Supply the active case, attempt and adopted revision');
    const step=StepSchema.parse(input);if(isAssertion(step)!==assertion)throw new PilotError('STEP_KIND_MISMATCH','Use the matching action/assertion tool');
    if(active.attempt.steps.some(s=>s.outcome!=='passed'))throw new PilotError('CASE_FAILED','End this attempt before continuing');
    const expected=active.test.steps[active.attempt.steps.length];if(!expected||digest(step)!==digest(expected))throw new PilotError('UNPLANNED_STEP','Step differs from the adopted case; publish and adopt the change first');
    const start=Date.now(),result:StepResult={id:step.id,op:step.op,outcome:'passed',timestamp:new Date().toISOString(),durationMs:0,candidate:isAssertion(step)&&step.candidate,evidence:[]};const info={caseId:active.test.id,attempt:active.attempt.number,stepId:step.id};const abort=()=>live.controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    try{await live.progress.emit('step.started',{op:step.op},info);try{result.actual=(await live.context.perform(step)).actual;}catch(error){const errorData=errorInfo(error);result.outcome=result.candidate&&errorData.outcome==='failed'?'inconclusive':errorData.outcome;result.error={code:errorData.code,message:errorData.message};}if(isAssertion(step)&&'expected'in step)result.expected=step.expected;result.durationMs=Date.now()-start;
      const safe=live.redactor.object(result);active.attempt.steps.push(safe);await live.progress.emit('step.finished',safe,info);await this.persist(live);await live.progress.phase('collecting','采集用例步骤证据');await capture(live.context,this.store,live.runId,active.test.id,active.attempt.number,safe);await live.progress.emit('evidence.available',{step:safe},info);await this.persist(live);return safe;
    }finally{signal?.removeEventListener('abort',abort);}
  });}
  private async endActive(live:Live){const active=live.active;if(!active)return;const {attempt,test,result}=active;await this.closeContext(live,test.id,attempt.number);
    if(active.prepared&&live.service.target.data.cleanup)try{await runCommand(live.service.target.data.cleanup);}catch(error){attempt.cleanupError=live.redactor.text(errorInfo(error).message);live.cleanupErrors.push(attempt.cleanupError);}
    const bad=attempt.steps.find(s=>s.outcome!=='passed');if(bad){attempt.outcome=bad.outcome;attempt.reason=`步骤 ${bad.id}：${bad.error?.message??bad.outcome}`;}else if(!attempt.reason){const complete=attempt.steps.length===test.steps.length&&test.steps.some(s=>isAssertion(s)&&!s.candidate);attempt.outcome=complete?'passed':'inconclusive';if(!complete)attempt.reason='用例未完成全部计划步骤或缺少正式业务断言';}
    result.outcome=attempt.outcome;result.unstable=attempt.outcome==='passed'&&result.attempts.some(a=>a.outcome==='failed');await live.progress.emit('attempt.finished',{outcome:attempt.outcome,reason:attempt.reason,cleanupError:attempt.cleanupError},{caseId:test.id,attempt:attempt.number});await live.progress.emit('case.finished',{outcome:result.outcome,unstable:result.unstable},{caseId:test.id});live.active=undefined;await this.persist(live);return live.redactor.object(result);
  }
  async end(id:string){const live=this.live(id);return this.exclusive(live,async()=>{if(!live.active)throw new PilotError('CASE_NOT_STARTED','No active case');return this.endActive(live);});}
  async sync(id:string,ref:CoverageRef){const live=this.live(id);return this.exclusive(live,async()=>{
    if(ref.id!==live.snapshot.manifest.id)throw new PilotError('COVERAGE_MISMATCH','Keep the same coverage plan');const snapshot=await this.coverageStore.snapshot(ref);
    if(ref.revision<live.snapshot.manifest.revision)throw new PilotError('PLAN_VERSION_CONFLICT','Do not roll back an executing coverage plan');
    for(const result of live.results){const before=live.snapshot.manifest.draft.items.find(i=>i.id===result.id)?.executable,after=snapshot.manifest.draft.items.find(i=>i.id===result.id)?.executable;
      if(!snapshot.manifest.draft.items.find(i=>i.id===result.id)?.selected)throw new PilotError('EXECUTED_CASE_CHANGED','Keep attempted cases in this run');
      if(live.active?.test.id===result.id){if(!before||!after||digest({...before,steps:[],locatorRepairs:[]})!==digest({...after,steps:[],locatorRepairs:[]}))throw new PilotError('EXECUTED_CASE_CHANGED','Keep active role, prerequisites and case metadata unchanged');for(let n=0;n<live.active.attempt.steps.length;n++)if(digest(before.steps[n])!==digest(after.steps[n]))throw new PilotError('EXECUTED_CASE_CHANGED','Keep already executed steps unchanged');}
      else if(digest(before)!==digest(after))throw new PilotError('EXECUTED_CASE_CHANGED','Keep completed cases unchanged');
    }
    await this.coverageStore.saveSnapshot(ref,this.store.runDir(live.runId));await atomicJson(join(this.store.runDir(live.runId),'plan.json'),coveragePlan(snapshot));live.snapshot=snapshot;
    if(live.active)live.active.test=snapshot.manifest.draft.items.find(i=>i.id===live.active!.test.id)!.executable!;
    await live.progress.emit('coverage.updated',{revision:ref.revision,cases:coveragePlan(snapshot).cases.map(c=>({id:c.id,title:c.title,version:c.version}))});await this.persist(live);return {sessionId:id,runId:live.runId,coverage:ref};
  });}
  close(id:string):Promise<any>{const previous=this.closed.get(id);if(previous)return previous;const live=this.live(id);const task=this.finish(live);live.closing=task;this.closed.set(id,task);if(this.closed.size>32)this.closed.delete(this.closed.keys().next().value!);return task;}
  private async finish(live:Live){try{clearTimeout(live.timer);if(live.busy)live.controller.abort();await live.busy?.catch(()=>{});await live.progress.phase('cleaning','关闭用例并核对覆盖清单');
    try{await this.endActive(live);await this.closeContext(live,'observation',1);}finally{try{await live.service.close();}catch(error){live.cleanupErrors.push(live.redactor.text(errorInfo(error).message));}live.controller.abort();}
    const cases=coveragePlan(live.snapshot).cases.map(c=>live.results.find(r=>r.id===c.id)??{id:c.id,version:c.version,title:c.title,outcome:'inconclusive' as const,unstable:false,attempts:[{number:1,outcome:'inconclusive' as const,steps:[],reason:'未执行，剩余范围未验证'}]});
    const report=RunSchema.parse(live.redactor.object({schemaVersion:1,id:live.runId,planId:live.snapshot.manifest.id,startedAt:live.startedAt,finishedAt:new Date().toISOString(),...summarizeAcceptance(coveragePlan(live.snapshot).cases,cases,live.cleanupErrors),target:{url:live.service.target.url??'unavailable',sources:live.service.sources,projectPath:live.service.target.projectPath},environment:{runner:VERSION,node:process.versions.node,browser:live.browserVersion,platform:process.platform,viewport:live.service.target.viewport},scope:live.snapshot.manifest.draft.scope,gaps:live.snapshot.manifest.draft.gaps,cases,cleanupErrors:live.cleanupErrors,coverage:{id:live.snapshot.manifest.id,revision:live.snapshot.manifest.revision},...(live.service.target.evidence.video?{playbackPath:join(this.store.runDir(live.runId),'recordings.html')}:{}),reproduce:`webpilot replay --run ${live.runId} --data-dir ${JSON.stringify(this.store.root)}`}));
    await this.persist(live);await atomicJson(join(this.store.runDir(live.runId),'coverage-result.json'),coverageResult(live.snapshot,report,true));
    await this.store.saveRun(report,markdownReport(report)+reconciliationMarkdown(live.snapshot,report));await live.progress.finish({outcome:report.outcome,unstable:report.unstable});
    return {sessionId:live.id,runId:live.runId,closed:true,report,cleanupErrors:report.cleanupErrors,...(report.playbackPath?{playbackPath:report.playbackPath}:{})};
    }catch(error){await live.progress.finish({reason:live.redactor.text(`报告定稿失败：${errorInfo(error).message}`)});throw error;}finally{this.sessions.delete(live.id);}
  }
  async closeAll(){for(const id of this.sessions.keys())await this.close(id).catch(()=>{});}
}
