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

export interface RunOptions{dataDir?:string;bindings?:Bindings;signal?:AbortSignal;headful?:boolean}
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
  const inspection=await inspectProject((input as Plan).target);plan.target=inspection.target;
  assertPortable(plan,bindings);
  const id=`run-${randomUUID()}`;await store.prune();await store.beginRun(id,plan.target.evidence.retentionDays,plan.target.evidence.rawTrace,plan.target.evidence.video);
  const startedAt=new Date().toISOString();
  const signal=AbortSignal.any([...(options.signal?[options.signal]:[]),AbortSignal.timeout(plan.target.budget.totalMs)]);
  const budget=new Budget(plan.target.budget,signal);
  const results:Run['cases']=[];const cleanupErrors:string[]=[];let browserVersion='unavailable';
  let service:Awaited<ReturnType<typeof prepareService>>|undefined;
  const target=inspection.target;
  let setupError:ReturnType<typeof errorInfo>|undefined;
  try{service=await prepareService(inspection,signal);target.url=service.target.url;}
  catch(error){setupError=errorInfo(error);}
  try { for(const c of plan.cases){
    const attempts:Attempt[]=[];
    const formal=c.steps.some(s=>isAssertion(s) && !s.candidate);
    for(let number=1;number<=target.budget.attempts;number++){
      const attempt:Attempt={number,outcome:'passed',steps:[]};let session:BrowserSession|undefined;let prepared=false;
      try {
        budget.check();
        if(setupError)throw new PilotError(setupError.code,setupError.message,setupError.outcome);
        if(c.conflicts.length)throw new PilotError('SOURCE_CONFLICT',c.conflicts.join('; '));
        for(const condition of c.preconditions)if(!Object.hasOwn(bindings,condition))throw new PilotError('PRECONDITION_MISSING',`Provide runtime prerequisite: ${condition}`);
        if(target.data.prepare){prepared=true;await runCommand(target.data.prepare,signal);}
        else prepared=true;
        session=new BrowserSession(target,budget,bindings,redactor);await session.open({role:c.role,headful:options.headful,recordingDir:join(store.runDir(id),'videos',c.id,String(number))});browserVersion=session.browser.version();
        for(const step of c.steps){
          const start=Date.now();
          const result:StepResult={id:step.id,op:step.op,outcome:'passed',timestamp:new Date().toISOString(),durationMs:0,candidate:isAssertion(step)&&step.candidate,evidence:[],...(isAssertion(step)&&'expected' in step?{expected:step.expected}:{})};
          try{const observed=await session.perform(step);result.actual=observed.actual;}
          catch(error){const info=errorInfo(error);result.outcome=result.candidate && info.outcome==='failed'?'inconclusive':info.outcome;result.error={code:info.code,message:info.message};}
          result.durationMs=Date.now()-start;
          await capture(session,store,id,c.id,number,result);
          attempt.steps.push(redactor.object(result));
          if(result.outcome!=='passed'){attempt.outcome=result.outcome;attempt.reason=`步骤 ${step.id}：${result.error?.message ?? result.outcome}`;break;}
        }
        if(attempt.outcome==='passed' && !formal){attempt.outcome='inconclusive';attempt.reason='没有正式业务断言，候选检查不能证明验收通过。';}
      }catch(error){const info=errorInfo(error);attempt.outcome=info.outcome;attempt.reason=redactor.text(info.message);}
      finally{
        if(session){try{
          const tracePath=target.evidence.rawTrace?join(store.runDir(id),`sensitive-trace-${c.id}-${number}.zip`):undefined;
          await session.close(tracePath);if(tracePath)await chmod(tracePath,0o600);
        }catch(error){attempt.cleanupError=redactor.text(errorInfo(error).message);cleanupErrors.push(attempt.cleanupError);}
        finally{attempt.recordings=session.recordings;}}
        if(prepared && target.data.cleanup){try{await runCommand(target.data.cleanup);}catch(error){attempt.cleanupError=redactor.text(errorInfo(error).message);cleanupErrors.push(attempt.cleanupError);}}
      }
      attempts.push(redactor.object(attempt));
      if(attempt.outcome!=='failed' || number===target.budget.attempts)break;
    }
    const last=attempts.at(-1)!;
    results.push({id:c.id,version:c.version,title:c.title,outcome:last.outcome,unstable:last.outcome==='passed' && attempts.some(a=>a.outcome==='failed'),attempts});
  }
  } finally { if(service)try{await service.close();}catch(error){cleanupErrors.push(redactor.text(errorInfo(error).message));} }
  const context=await collectContext({projectPath:target.projectPath});
  const report=RunSchema.parse(redactor.object({schemaVersion:1,id,planId:plan.id,startedAt,finishedAt:new Date().toISOString(),...summarize(results,cleanupErrors),
    target:{url:target.url ?? 'unavailable',sources:inspection.sources,projectPath:target.projectPath},
    environment:{runner:VERSION,node:process.versions.node,browser:browserVersion,platform:process.platform,viewport:target.viewport,codeRevision:context.git?.revision},
    scope:plan.scope,gaps:[...plan.gaps,...inspection.gaps,...results.filter(c=>c.outcome==='blocked'||c.outcome==='inconclusive').map(c=>`${c.id}: ${c.attempts.at(-1)?.reason ?? c.outcome}`)],cases:results,cleanupErrors,
    ...(target.evidence.video?{playbackPath:join(store.runDir(id),'recordings.html')} : {}),
    reproduce:`webpilot replay --run ${id} --data-dir ${JSON.stringify(store.root)}`
  }));
  await writeFile(join(store.runDir(id),'plan.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx',mode:0o600});
  await store.saveRun(report,markdownReport(report));return report;
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
    c.state=run.exitCode===0?'regression-ready':'draft';if(c.state==='regression-ready')c.verifiedBy=run.id;
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
