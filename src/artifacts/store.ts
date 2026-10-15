import { mkdir,writeFile,readFile,readdir,rm,lstat } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CaseSchema,RunSchema,type Case,type Run,type Evidence } from '../core/schema.js';
import { dataRoot } from '../core/runtime.js';
import { PilotError } from '../core/errors.js';
import {outcomeLabels,evidenceLabels,operationLabel,diagnosticLabel,reportText,attemptReason} from './reporting.js';
import {recordingPlayer} from './video.js';

export function safeId(id:string){if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(id))throw new PilotError('INVALID_ID','Invalid asset or run id');return id;}
export class Store {
  readonly root:string;
  constructor(root?:string){this.root=dataRoot(root);}
  runDir(id:string){return join(this.root,'runs',safeId(id));}
  async beginRun(id:string,retentionDays=7,sensitiveRawTrace=false,sensitiveVideo=false){const dir=this.runDir(id);await mkdir(dir,{recursive:true,mode:0o700});await writeFile(join(dir,'.owner.json'),JSON.stringify({owner:'webpilot',id,createdAt:Date.now(),retentionDays,sensitiveRawTrace,sensitiveVideo}),{flag:'wx',mode:0o600});return dir;}
  async evidence(runId:string,type:Evidence['type'],content:Buffer|string){const file=`${type}-${randomUUID()}${type==='screenshot'?'.png':'.json'}`;const path=join(this.runDir(runId),file);await writeFile(path,content,{flag:'wx',mode:0o600});return path;}
  async saveRun(run:Run,markdown:string){RunSchema.parse(run);const dir=this.runDir(run.id);await writeFile(join(dir,'report.json'),JSON.stringify(run,null,2)+'\n',{flag:'wx',mode:0o600});await writeFile(join(dir,'report.md'),markdown,{flag:'wx',mode:0o600});
    if(run.playbackPath)await writeFile(join(dir,'recordings.html'),recordingPlayer(`WebPilot 流程录像：${run.id}`,dir,run.cases.flatMap(c=>c.attempts.map(a=>({title:`${c.title} · 第 ${a.number} 次尝试 · ${outcomeLabels[a.outcome]}`,recordings:a.recordings ?? []})))),{flag:'wx',mode:0o600});
    return join(dir,'report.md');}
  async readRun(id:string){return RunSchema.parse(JSON.parse(await readFile(join(this.runDir(id),'report.json'),'utf8')));}
  async saveCase(input:Case){const c=CaseSchema.parse(input);const dir=join(this.root,'cases',safeId(c.id));await mkdir(dir,{recursive:true,mode:0o700});const path=join(dir,`${c.version}.json`);try{await writeFile(path,JSON.stringify(c,null,2)+'\n',{flag:'wx',mode:0o600});}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw new PilotError('VERSION_EXISTS','Case version is immutable; choose a new version');throw error;}return path;}
  async readCase(id:string,version:number){if(!Number.isInteger(version) || version<1)throw new PilotError('INVALID_VERSION','Case version must be positive');return CaseSchema.parse(JSON.parse(await readFile(join(this.root,'cases',safeId(id),`${version}.json`),'utf8')));}
  async prune(days?:number,now=Date.now()){
    if(days!==undefined && (!Number.isFinite(days) || days<1))throw new PilotError('INVALID_RETENTION','Retention must be at least one day');
    let removed=0;const root=join(this.root,'runs');let entries;try{entries=await readdir(root,{withFileTypes:true});}catch{return removed;}
    for(const entry of entries){
      if(!entry.isDirectory() || entry.isSymbolicLink())continue;
      const dir=join(root,entry.name);try{
        const marker=join(dir,'.owner.json');if((await lstat(marker)).isSymbolicLink())continue;
        const owner=JSON.parse(await readFile(marker,'utf8'));
        const retention=days ?? (Number.isFinite(owner.retentionDays) && owner.retentionDays>=1?owner.retentionDays:7);
        if(owner.owner==='webpilot' && owner.id===entry.name && Number.isFinite(owner.createdAt) && now-owner.createdAt>retention*86400000){await rm(dir,{recursive:true});removed++;}
      }catch{/* Ignore files not demonstrably owned by WebPilot. */}
    }
    return removed;
  }
}

export function markdownReport(run:Run){
  const gapText=(gap:string)=>{
    const c=run.cases.find(c=>gap.startsWith(`${c.id}: `));
    const last=c?.attempts.at(-1);
    return c && last?`${c.title}：${last.reason?attemptReason(last.reason,last.steps):outcomeLabels[c.outcome]}`:reportText(gap);
  };
  const lines=[`# WebPilot 测试报告：${outcomeLabels[run.outcome]}${run.unstable?'（不稳定）':''}`,'',
    `运行编号：${run.id}`,`测试目标：${run.target.url}`,`开始时间：${run.startedAt}`,`结束时间：${run.finishedAt}`,
    `视口尺寸：${run.environment.viewport.width} × ${run.environment.viewport.height}`,
    `运行器版本：${run.environment.runner}；浏览器版本：${run.environment.browser}`,'',
    ...(run.playbackPath?[`[观看流程录像](${run.playbackPath})`,'录像为未经脱敏的敏感本地证据。','']:[]),
    '## 结果汇总','',...Object.entries(outcomeLabels).map(([status,label])=>`${label}：${run.cases.filter(c=>c.outcome===status).length} 条用例`),
    ...(run.unstable?['存在先失败后通过的重试，不能视为稳定通过。']:[]),'',
    '## 覆盖范围','',...run.scope.map(s=>`- ${reportText(s)}`),'',
    '## 未验证项与限制','',...(run.gaps.length?run.gaps.map(s=>`- ${gapText(s)}`):['未记录额外覆盖缺口。']),'','## 用例结果',''];
  for(const c of run.cases){lines.push(`### ${c.title}：${outcomeLabels[c.outcome]}${c.unstable?'（不稳定）':''}`,'',`用例编号：${c.id}；版本：${c.version}`,'');
    for(const a of c.attempts){lines.push(`第 ${a.number} 次尝试：${outcomeLabels[a.outcome]}${a.reason?`。${attemptReason(a.reason,a.steps)}`:''}`,'');
      for(const recording of a.recordings ?? [])lines.push(recording.status==='available'?`[播放页面 ${recording.pageName}（${recording.pageId}）录像](${recording.path})（敏感本地证据，未经脱敏）`:`录像证据缺口：${recording.reason}`,'');
      if(a.reason && reportText(a.reason)!==attemptReason(a.reason,a.steps))lines.push('原始诊断：','```text',a.reason,'```','');
      for(const step of a.steps){lines.push(`- ${step.id}（${operationLabel(step.op)}）：${outcomeLabels[step.outcome]}${step.candidate?'【候选检查】':''}`,'');
        lines.push(`  执行耗时：${step.durationMs} 毫秒`,'');
        if(step.error)lines.push(`  失败说明：${diagnosticLabel(step.error.code)}（${step.error.code}）`,'','  原始诊断：','  ```text',...step.error.message.split('\n').map(line=>`  ${line}`),'  ```','');
        if(step.expected!==undefined)lines.push(`  预期结果：${JSON.stringify(step.expected)}`,'');
        if(step.actual!==undefined)lines.push(`  实际结果：${JSON.stringify(step.actual)}`,'');
        for(const evidence of step.evidence)lines.push(evidence.type==='screenshot'?`  ![步骤 ${step.id} 的截图](${evidence.path})`:
          evidence.path?`  ${evidenceLabels[evidence.type]}：[查看证据](${evidence.path})`:`  ${evidenceLabels[evidence.type]}：${reportText(evidence.reason ?? '未记录原因。')}`,'');
      }
      if(a.cleanupError)lines.push('清理异常（原始诊断）：','```text',a.cleanupError,'```','');
    }
  }
  if(run.cleanupErrors.length)lines.push('## 清理问题','',...run.cleanupErrors.flatMap(e=>['原始诊断：','```text',e,'```','']));
  lines.push('## 复现方法','','```sh',run.reproduce,'```','',
    '以上记录为实际执行事实。候选检查不构成正式业务验收依据；根因判断需要额外证据。页面原文、预期值和底层错误保留原样，以便核对。','');
  return lines.join('\n');
}
