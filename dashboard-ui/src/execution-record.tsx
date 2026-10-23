import React from 'react';
import type {StepResult} from '../../src/core/schema';
import type {assessAcceptance} from '../../src/core/acceptance';

const outcomes:Record<string,string>={passed:'通过',failed:'失败',blocked:'受阻',inconclusive:'无法确定'};
const phases:Record<string,string>={'not-selected':'本次未选','not-started':'未执行',started:'执行中',finished:'已结束'};

export function ExecutionDiagnostics({reason,steps=[],outcome}:{reason:string;steps?:StepResult[];outcome?:string}){
  const error=[...steps].reverse().find(step=>step.error);
  const candidateOnly=steps.some(step=>step.candidate&&(step.op.startsWith('expect')||step.op==='download'))&&!steps.some(step=>!step.candidate&&(step.op.startsWith('expect')||step.op==='download'));
  const summary=error
    ?`${error.candidate?'候选检查':'检查'}${error.error?.code==='ASSERTION_FAILED'?'未通过':'执行异常'}（步骤 ${error.id}）`
    :candidateOnly&&steps.every(step=>step.outcome==='passed')?'候选检查已完成，未作正式验收'
    :outcome==='failed'?'验收未通过':outcome==='blocked'?'执行受阻':outcome==='passed'?'执行说明':'验收结论待确认';
  return <div className="execution-diagnostic">
    <p className="execution-conclusion">{summary}</p>
    {error?.candidate&&<p className="execution-candidate-note">此项为候选检查，不构成正式业务验收依据。</p>}
    <details className="execution-technical"><summary>技术详情</summary><pre aria-label="原始执行日志">{reason}</pre></details>
  </div>;
}

export function ExecutionRecord({actual,steps,assessment}:{assessment?:ReturnType<typeof assessAcceptance>;actual:{executionStatus:string;outcome?:string;reason?:string;evidenceIds:string[]};steps?:StepResult[]}){
  return <section className="execution-record" aria-label="执行记录">
    <div className="execution-meta"><b>执行记录：</b><span>{phases[actual.executionStatus]??'状态待确认'}</span>{assessment?<span>{assessment.formal.outcome==='none'?'仅补充检查，未作正式验收':`正式验收：${outcomes[assessment.formal.outcome]}`}</span>:actual.outcome&&<span>原始结果：{outcomes[actual.outcome]??'待确认'}</span>}<span title="快照、截图等证据条目的数量，并非错误数量">{actual.evidenceIds.length} 项证据</span></div>
    {actual.reason&&<ExecutionDiagnostics reason={actual.reason} steps={steps} outcome={actual.outcome}/>}
  </section>;
}
