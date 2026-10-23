import React from 'react';
import {assessAcceptance,assessRecordedRun} from '../../src/core/acceptance';
import type {publicRun} from '../../src/dashboard/projection';

type Run=ReturnType<typeof publicRun>;
const outcomes:Record<string,string>={passed:'通过',failed:'失败',blocked:'受阻',inconclusive:'无法确定'};
export const runAssessment=assessRecordedRun;
function supplementaryLabel(run:Run,caseId:string,stepId:string){
  const item=run.coverage?.manifest.draft.items.find(item=>item.id===caseId);
  const steps=item?.executable?.steps.filter(step=>'candidate' in step&&step.candidate)??[];
  const expectations=item?.expectations.filter(expectation=>expectation.candidate)??[];
  return steps.length===expectations.length?expectations[steps.findIndex(step=>step.id===stepId)]?.description??stepId:stepId;
}

export function assessmentLabel(assessment:ReturnType<typeof assessAcceptance>){
  const {formal,supplementary}=assessment;
  const supplement=supplementary.issues?'补充检查有异常':supplementary.incomplete?'补充检查未完成':'补充检查符合预期';
  return formal.outcome==='none'?supplement: `正式验收${formal.outcome==='inconclusive'?'未完成':outcomes[formal.outcome]}${supplementary.total?` · ${supplement}`:''}`;
}

export function RunResult({run}:{run:Run}){
  const assessment=runAssessment(run);
  if(!assessment)return <span className={`badge ${run.outcome??run.lifecycle}`}><i/>{outcomes[run.outcome??'']??({finished:'已结束',running:'执行中',preparing:'准备中',collecting:'采集证据',cleaning:'清理中',interrupted:'已中断',historical:'历史记录'} as Record<string,string>)[run.lifecycle]??run.lifecycle}</span>;
  const {formal,supplementary}=assessment;
  return <div className="acceptance-status">
    <span className={`badge ${formal.outcome==='none'?'inconclusive':formal.outcome}`}><i/>{formal.outcome==='none'?'仅探索，未作验收':formal.outcome==='passed'?'正式验收通过':formal.outcome==='failed'?'正式验收失败':formal.outcome==='blocked'?'正式验收受阻':'正式验收未完成'}</span>
    {supplementary.total>0&&<small className={supplementary.issues?'supplementary-issue':''}>{supplementary.issues?'补充检查有异常':supplementary.incomplete?'补充检查未完成':'补充检查符合预期'}</small>}
  </div>;
}

export function AcceptanceSummary({run}:{run:Run}){
  const assessment=runAssessment(run);if(!assessment)return null;
  const {formal,supplementary}=assessment;
  const historic=run.coverage&&!('outcomePolicy' in run&&run.outcomePolicy==='formal-v1');
  return <section className="acceptance-summary" aria-label="验收与补充检查">
    <h2>验收与补充检查</h2>
    <p><strong>正式验收：</strong>{formal.outcome==='none'?'仅探索，未作验收':`${formal.outcome==='inconclusive'?'未完成':outcomes[formal.outcome]} · ${formal.passed} / ${formal.total} 用例通过`}{formal.unstable?' · 重试后通过，存在不稳定性':''}</p>
    <ul>{formal.cases.map(test=><li key={test.id}>{test.title}（正式部分）：{outcomes[test.outcome]}{test.unstable?'（不稳定）':''}</li>)}</ul>
    {supplementary.total>0&&<><p><strong>补充检查：</strong>{supplementary.matched} 项符合预期 · {supplementary.issues} 项发现异常 · {supplementary.incomplete} 项未完成</p><p className="execution-candidate-note">补充检查不计入正式通过或失败；异常需确认产品规则。</p><ul>{supplementary.checks.map(check=><li key={`${check.caseId}/${check.stepId}`}>{supplementaryLabel(run,check.caseId,check.stepId)}：{check.status==='matched'?'符合预期':check.status==='issue'?'发现异常，待确认产品规则':'未完成'}</li>)}</ul></>}
    {run.cleanupErrors.length>0&&<p className="notice">存在清理问题，详见报告。</p>}
    {historic&&<p className="acceptance-original">原始报告结果：{outcomes[run.outcome??'']??'未记录'}。以上按已保存的计划与步骤分项展示，历史报告未改写。</p>}
  </section>;
}
