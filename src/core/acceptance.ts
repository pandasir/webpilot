import type {Case,Step,Attempt} from './schema.js';
import type {CoverageSnapshot} from './coverage.js';

type Outcome='passed'|'failed'|'blocked'|'inconclusive';
type AttemptView=Pick<Attempt,'steps'|'outcome'|'cleanupError'>;
type Result={id:string;outcome?:string;unstable?:boolean;attempts:AttemptView[]};
const assertion=(step:{op:string})=>step.op.startsWith('expect')||step.op==='download';
const candidate=(step:Step)=>assertion(step)&&'candidate' in step&&step.candidate;
export const supplementaryCase=(test:Case)=>test.steps.some(candidate)&&!test.steps.some(step=>assertion(step)&&!candidate(step));
const aggregate=(outcomes:Outcome[]):Outcome=>outcomes.includes('failed')?'failed':outcomes.includes('blocked')?'blocked':!outcomes.length||outcomes.includes('inconclusive')?'inconclusive':'passed';

// Use the last attempt and the adopted plan, so retries cannot pool partial successes.
function formalAttempt(test:Case,attempt?:AttemptView):Outcome{
  if(!attempt)return 'inconclusive';
  const required=test.steps.filter(step=>!candidate(step));
  const steps=required.map(step=>attempt.steps.find(s=>s.id===step.id&&s.op===step.op&&!s.candidate));
  if(steps.some(step=>step?.outcome==='failed'))return 'failed';
  if(steps.some(step=>step?.outcome==='blocked')||attempt.outcome==='blocked')return 'blocked';
  if(!required.some(assertion)||steps.some(step=>!step||step.outcome!=='passed')||attempt.cleanupError)return 'inconclusive';
  if(attempt.outcome==='passed')return 'passed';
  // A candidate mismatch is a supplementary finding, not a failed formal assertion.
  const candidateMismatch=attempt.steps.some(step=>step.candidate&&step.error?.code==='ASSERTION_FAILED');
  return attempt.outcome==='inconclusive'&&candidateMismatch?'passed':attempt.outcome;
}

export function assessAcceptance(planned:Case[],results:Result[],cleanupErrors:string[]=[]){
  const formal=planned.filter(test=>!supplementaryCase(test)).map(test=>{
    const actual=results.find(result=>result.id===test.id),outcome=formalAttempt(test,actual?.attempts.at(-1));
    return {id:test.id,title:test.title,outcome,unstable:outcome==='passed'&&!!actual?.attempts.slice(0,-1).some(attempt=>formalAttempt(test,attempt)==='failed')};
  });
  const checks=planned.flatMap(test=>test.steps.filter(candidate).map(step=>{
    const actual=results.find(result=>result.id===test.id)?.attempts.at(-1)?.steps.find(s=>s.id===step.id&&s.op===step.op&&s.candidate);
    const status=actual?.outcome==='passed'?'matched' as const:actual?.error?.code==='ASSERTION_FAILED'?'issue' as const:'incomplete' as const;
    return {caseId:test.id,stepId:step.id,status};
  }));
  let outcome:Outcome|'none'=formal.length?aggregate(formal.map(test=>test.outcome)):'none';
  if(outcome==='passed'&&cleanupErrors.length)outcome='inconclusive';
  return {
    formal:{outcome,total:formal.length,passed:formal.filter(test=>test.outcome==='passed').length,failed:formal.filter(test=>test.outcome==='failed').length,blocked:formal.filter(test=>test.outcome==='blocked').length,incomplete:formal.filter(test=>test.outcome==='inconclusive').length,unstable:formal.some(test=>test.unstable),cases:formal},
    supplementary:{total:checks.length,matched:checks.filter(check=>check.status==='matched').length,issues:checks.filter(check=>check.status==='issue').length,incomplete:checks.filter(check=>check.status==='incomplete').length,checks}
  };
}

export function summarizeAcceptance(planned:Case[],results:Result[],cleanupErrors:string[]=[]){
  const assessment=assessAcceptance(planned,results,cleanupErrors),{formal}=assessment;
  const outcome:Outcome=formal.outcome==='none'?'inconclusive':formal.outcome;
  return {outcomePolicy:'formal-v1' as const,acceptance:assessment,outcome,unstable:formal.unstable,exitCode:outcome==='failed'?1:outcome==='passed'&&!formal.unstable?0:2};
}

// Read-only interpretation for old reports; the saved outcome and exit code remain intact.
export function assessRecordedRun(run:{coverage?:CoverageSnapshot;cases:Result[];cleanupErrors:string[];lifecycle:string;outcome?:string}){
  if(!run.coverage||!['finished','historical','interrupted'].includes(run.lifecycle))return;
  const planned=run.coverage.manifest.draft.items.filter(item=>item.selected).map(item=>item.executable??{
    schemaVersion:1,id:item.id,title:item.title,version:1,state:'draft',preconditions:[],conflicts:[],locatorRepairs:[],
    steps:[{id:'unavailable',op:'unsupported',capability:item.reason??'未提供可执行用例'}]
  } as Case);
  const assessment=assessAcceptance(planned,run.cases,run.cleanupErrors);
  if(assessment.formal.outcome==='passed'&&(run.lifecycle!=='finished'||!run.outcome))assessment.formal.outcome='inconclusive';
  return assessment;
}

export function acceptanceStatus(run:Parameters<typeof assessRecordedRun>[0]){
  const assessment=assessRecordedRun(run);
  return assessment?.formal.outcome==='none'?'exploratory':assessment?.formal.outcome??run.outcome??run.lifecycle;
}
