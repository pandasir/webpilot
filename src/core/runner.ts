import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {writeFile,chmod} from 'node:fs/promises';
import {PlanSchema,CaseSchema,RunSchema,BindingsSchema,VERSION,isAssertion,type Plan,type Case,type Run,type Attempt,type StepResult,type Bindings} from './schema.js';
import {PilotError,errorInfo,type Outcome} from './errors.js';
import {Budget} from './budget.js';
import {BrowserSession} from '../browser/session.js';
import {inspectProject,prepareService,runCommand,collectContext} from '../project/index.js';
import {Redactor,assertPortable} from '../artifacts/redaction.js';
import {Store,markdownReport} from '../artifacts/store.js';
import {Progress} from './progress.js';
import {CoverageStore} from '../artifacts/coverage.js';
import {coverageFromPlan,verifyCoveragePlan,coverageResult,reconciliationMarkdown,type CoverageRef} from './coverage.js';
import {atomicJson} from '../dashboard/files.js';
import {summarizeAcceptance} from './acceptance.js';

export interface RunOptions{dataDir?:string;bindings?:Bindings;signal?:AbortSignal;headful?:boolean;dashboard?:boolean;dashboardRoot?:string;coverage?:CoverageRef}
export function summarize(results:{outcome:Outcome;unstable:boolean}[],cleanupErrors:string[]=[]){
  let outcome:Outcome=results.some(r=>r.outcome==='failed')?'failed':results.some(r=>r.outcome==='blocked')?'blocked':!results.length || results.some(r=>r.outcome==='inconclusive')?'inconclusive':'passed';
  if(cleanupErrors.length && outcome==='passed')outcome='inconclusive';
  const unstable=results.some(r=>r.unstable);
  return {outcome,unstable,exitCode:outcome==='failed'?1:outcome==='passed' && !unstable?0:2};
}
export async function capture(session:BrowserSession,store:Store,runId:string,caseId:string,attempt:number,step:StepResult){
  const base={schemaVersion:1 as const,runId,caseId,stepId:step.id,attempt,redacted:true as const,timestamp:new Date().toISOString()};
  try {
    const snapshot=await session.observe();
    const path=await store.evidence(runId,'snapshot',JSON.stringify(snapshot,null,2));
    step.evidence.push({...base,id:`evidence-${randomUUID()}`,type:'snapshot',path});
    for(const type of ['console','network'] as const){const events=snapshot.events.filter(e=>e.type===type);if(events.length){const path=await store.evidence(runId,type,JSON.stringify(events,null,2));step.evidence.push({...base,id:`evidence-${randomUUID()}`,type,path});}}
  }catch(error){step.evidence.push({...base,id:`evidence-${randomUUID()}`,type:'omitted',reason:session.redactor.text(`页面快照不可用：${errorInfo(error).message}`)});}
  try{const path=await store.evidence(runId,'screenshot',await session.screenshot());step.evidence.push({...base,id:`evidence-${randomUUID()}`,type:'screenshot',path});}
  catch(error){step.evidence.push({...base,id:`evidence-${randomUUID()}`,type:'omitted',reason:session.redactor.text(`截图不可用：${errorInfo(error).message}`)});}
}
export async function runPlan(input:unknown,options:RunOptions={}):Promise<Run>{
  const plan=PlanSchema.parse(input);const bindings=BindingsSchema.parse(options.bindings ?? {});const redactor=new Redactor(bindings);const store=new Store(options.dataDir);
  assertPortable(plan,bindings);
  const coverageStore=new CoverageStore(store.root);await coverageStore.prune();let coverage=options.coverage;
  if(!coverage){const created=await coverageStore.create(coverageFromPlan(plan),bindings);coverage={id:created.manifest.id,revision:created.manifest.revision};await coverageStore.adopt(coverage,'原有结构化计划，确定性派生覆盖清单');}
  const adopted=await coverageStore.snapshot(coverage);try{verifyCoveragePlan(adopted,plan);}catch(error){throw new PilotError('COVERAGE_MISMATCH',(error as Error).message);}
  const id=`run-${randomUUID()}`;await store.prune();await store.beginRun(id,plan.target.evidence.retentionDays,plan.target.evidence.rawTrace,plan.target.evidence.video);
  const snapshot=await coverageStore.saveSnapshot(coverage,store.runDir(id));await writeFile(join(store.runDir(id),'plan.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx',mode:0o600});await coverageStore.link(coverage,id);
  const startedAt=new Date().toISOString();
  const progress=await Progress.create(store.runDir(id),store.root,{id,title:plan.scope.join('、'),mode:'suite',target:plan.target.url??'准备目标中',project:plan.target.projectPath,startedAt,totalCases:plan.cases.length,cases:plan.cases.map(c=>({id:c.id,title:c.title,version:c.version})),live:plan.target.evidence.live},redactor,options);
  try{
  await progress.phase('preparing','检查项目与目标服务');
  const inspection=await inspectProject((input as Plan).target);plan.target=inspection.target;
  await store.configureRun(id,plan.target.evidence);
  await progress.target(inspection.target);
  const signal=AbortSignal.any([...(options.signal?[options.signal]:[]),AbortSignal.timeout(plan.target.budget.totalMs)]);
  const budget=new Budget(plan.target.budget,signal);
  const results:Run['cases']=[];const cleanupErrors:string[]=[];let browserVersion='unavailable';
  let service:Awaited<ReturnType<typeof prepareService>>|undefined;
  const target=inspection.target;
  let setupError:ReturnType<typeof errorInfo>|undefined;
  try{service=await prepareService(inspection,signal);target.url=service.target.url;await progress.target(target);}
  catch(error){setupError=errorInfo(error);}
  try { for(const c of plan.cases){
    await progress.emit('case.started',{}, {caseId:c.id});
    const attempts:Attempt[]=[];
    const formal=c.steps.some(s=>isAssertion(s) && !s.candidate);
    for(let number=1;number<=target.budget.attempts;number++){
      const association={caseId:c.id,attempt:number};
      await progress.emit('attempt.started',{},association);
      const attempt:Attempt={number,outcome:'passed',steps:[]};let session:BrowserSession|undefined;let prepared=false;
      try {
        budget.check();
        const inventory=snapshot.manifest.draft.items.find(i=>i.id===c.id);
        if(inventory?.readiness!=='ready')throw new PilotError('CASE_NOT_READY',inventory?.reason??'场景尚未就绪',inventory?.readiness==='needs-clarification'?'inconclusive':'blocked');
        if(setupError)throw new PilotError(setupError.code,setupError.message,setupError.outcome);
        if(c.conflicts.length)throw new PilotError('SOURCE_CONFLICT',c.conflicts.join('; '));
        for(const condition of c.preconditions)if(!Object.hasOwn(bindings,condition))throw new PilotError('PRECONDITION_MISSING',`Provide runtime prerequisite: ${condition}`);
        if(target.data.prepare){prepared=true;await runCommand(target.data.prepare,signal);}
        else prepared=true;
        await progress.phase('preparing','初始化浏览器及角色');
        session=new BrowserSession(target,budget,bindings,redactor);await progress.attach(session,c.id,number);await session.open({role:c.role,headful:options.headful,recordingDir:join(store.runDir(id),'videos',c.id,String(number))});browserVersion=session.browser.version();
        for(const step of c.steps){
          await progress.emit('step.started',{op:step.op},{...association,stepId:step.id});
          const start=Date.now();
          const result:StepResult={id:step.id,op:step.op,outcome:'passed',timestamp:new Date().toISOString(),durationMs:0,candidate:isAssertion(step)&&step.candidate,evidence:[],...(isAssertion(step)&&'expected' in step?{expected:step.expected}:{})};
          try{const observed=await session.perform(step);result.actual=observed.actual;}
          catch(error){const info=errorInfo(error);result.outcome=result.candidate && info.outcome==='failed'?'inconclusive':info.outcome;result.error={code:info.code,message:info.message};}
          result.durationMs=Date.now()-start;
          await progress.emit('step.finished',result,{...association,stepId:step.id});
          await progress.phase('collecting',`采集步骤 ${step.id} 的证据`);
          await capture(session,store,id,c.id,number,result);
          await progress.emit('evidence.available',{step:result},{...association,stepId:step.id});
          attempt.steps.push(redactor.object(result));
          if(result.outcome!=='passed'){attempt.outcome=result.outcome;attempt.reason=`步骤 ${step.id}：${result.error?.message ?? result.outcome}`;break;}
        }
        if(attempt.outcome==='passed' && !formal){attempt.outcome='inconclusive';attempt.reason='没有正式业务断言，候选检查不能证明验收通过。';}
      }catch(error){const info=errorInfo(error);attempt.outcome=info.outcome;attempt.reason=redactor.text(info.message);}
      finally{
        await progress.phase('cleaning','关闭尝试并清理测试数据');
        await progress.detachBrowser();
        if(session){try{
          const tracePath=target.evidence.rawTrace?join(store.runDir(id),`sensitive-trace-${c.id}-${number}.zip`):undefined;
          await session.close(tracePath);if(tracePath)await chmod(tracePath,0o600);
        }catch(error){attempt.cleanupError=redactor.text(errorInfo(error).message);cleanupErrors.push(attempt.cleanupError);}
        finally{attempt.recordings=session.recordings;}}
        if(prepared && target.data.cleanup){try{await runCommand(target.data.cleanup);}catch(error){attempt.cleanupError=redactor.text(errorInfo(error).message);cleanupErrors.push(attempt.cleanupError);}}
      }
      await progress.emit('recording.available',{recordings:attempt.recordings??[]},association);
      await progress.emit('attempt.finished',{outcome:attempt.outcome,reason:attempt.reason,cleanupError:attempt.cleanupError},association);
      attempts.push(redactor.object(attempt));
      if(attempt.outcome!=='failed' || number===target.budget.attempts)break;
    }
    const last=attempts.at(-1)!;
    results.push({id:c.id,version:c.version,title:c.title,outcome:last.outcome,unstable:last.outcome==='passed' && attempts.some(a=>a.outcome==='failed'),attempts});
    await progress.emit('case.finished',{outcome:last.outcome,unstable:last.outcome==='passed'&&attempts.some(a=>a.outcome==='failed')},{caseId:c.id});
  }
  } finally { if(service)try{await service.close();}catch(error){cleanupErrors.push(redactor.text(errorInfo(error).message));} }
  const context=await collectContext({projectPath:target.projectPath});
  const report=RunSchema.parse(redactor.object({schemaVersion:1,id,planId:plan.id,startedAt,finishedAt:new Date().toISOString(),...summarizeAcceptance(plan.cases,results,cleanupErrors),
    target:{url:target.url ?? 'unavailable',sources:inspection.sources,projectPath:target.projectPath},
    environment:{runner:VERSION,node:process.versions.node,browser:browserVersion,platform:process.platform,viewport:target.viewport,codeRevision:context.git?.revision},
    scope:plan.scope,coverage,gaps:[...plan.gaps,...inspection.gaps,...results.filter(c=>c.outcome==='blocked'||c.outcome==='inconclusive').map(c=>`${c.id}: ${c.attempts.at(-1)?.reason ?? c.outcome}`)],cases:results,cleanupErrors,
    ...(target.evidence.video?{playbackPath:join(store.runDir(id),'recordings.html')} : {}),
    reproduce:`webpilot replay --run ${id} --data-dir ${JSON.stringify(store.root)}`
  }));
  await atomicJson(join(store.runDir(id),'coverage-result.json'),coverageResult(snapshot,report,true));
  await store.saveRun(report,markdownReport(report)+reconciliationMarkdown(snapshot,report));await progress.finish({outcome:report.outcome,unstable:report.unstable});return report;
  }catch(error){await progress.finish({reason:redactor.text(errorInfo(error).message)});throw error;}
}

export async function saveCase(input:unknown,target:Plan['target'],options:RunOptions & {promote?:boolean}={}){
  const c=CaseSchema.parse(input);assertPortable(c,options.bindings ?? {});
  const store=new Store(options.dataDir);let verifiedBy:string|undefined;
  let previous:Case|undefined;
  if(c.version>1){try{previous=await store.readCase(c.id,c.version-1);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
  const difference=previous?caseDifference(previous,c):undefined;
  if(previous && !c.change)throw new PilotError('CHANGE_REASON_MISSING','New versions require a visible change reason');
  if(difference?.assertionsChanged && (!c.change?.adoptedBy || !c.change.source || c.change.source.type==='inferred')) {
    throw new PilotError('ASSERTION_ADOPTION_REQUIRED','Changing formal assertions requires a new requirement source and explicit adoption record');
  }
  c.verifiedBy=undefined;
  if(options.promote){
    const run=await runPlan({schemaVersion:1,id:`promotion-${randomUUID()}`,target,scope:[c.title],cases:[{...c,state:'draft'}]},options);
    verifiedBy=run.id;
    c.state=run.exitCode===0&&!run.acceptance?.supplementary.issues&&!run.acceptance?.supplementary.incomplete?'regression-ready':'draft';if(c.state==='regression-ready')c.verifiedBy=run.id;
  }else c.state='draft';
  const path=await store.saveCase(c);return {case:c,path,verifiedBy,difference};
}

export function caseDifference(previous:Case,next:Case){
  const formal=(c:Case)=>c.steps.filter(s=>isAssertion(s)&&!s.candidate).map(s=>{
    const {locator,...rest}=s as unknown as Record<string,unknown>;return rest;
  });
  return {fromVersion:previous.version,toVersion:next.version,assertionsChanged:JSON.stringify(formal(previous))!==JSON.stringify(formal(next)),
    stepsChanged:JSON.stringify(previous.steps)!==JSON.stringify(next.steps),previous:previous.steps,next:next.steps};
}
