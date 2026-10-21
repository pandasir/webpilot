import {createHash} from 'node:crypto';
import {z} from 'zod';
import {CaseSchema,TargetSchema,SourceSchema,isAssertion,type Plan,type Run,type Case} from './schema.js';

const Id=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/);
export const CoverageRefSchema=z.object({id:Id,revision:z.number().int().positive()}).strict();
export type CoverageRef=z.infer<typeof CoverageRefSchema>;
export const CoverageItemSchema=z.object({
  id:Id,title:z.string().min(1),suggestedBy:z.enum(['user','ai','regression','derived']),
  priority:z.enum(['P0','P1','P2']).default('P1'),selected:z.boolean(),selectionReason:z.string().min(1),
  readiness:z.enum(['ready','blocked','needs-clarification']),reason:z.string().optional(),
  rationale:z.string().min(1),dimension:z.string().min(1),preconditions:z.array(z.string()).default([]),
  actions:z.array(z.string().min(1)).min(1),
  expectations:z.array(z.object({description:z.string().min(1),source:SourceSchema,candidate:z.boolean().default(false)}).strict()).min(1),
  executable:CaseSchema.optional()
}).strict().superRefine((item,ctx)=>{
  if(item.readiness!=='ready'&&!item.reason?.trim())ctx.addIssue({code:'custom',message:'Unready cases need a reason'});
  if(item.selected&&item.readiness==='ready'&&!item.executable)ctx.addIssue({code:'custom',message:'Selected ready cases need an executable case'});
  if(item.executable&&(item.executable.id!==item.id||item.executable.title!==item.title))ctx.addIssue({code:'custom',message:'Executable identity must match the inventory'});
  for(const e of item.expectations)if(e.source.type==='inferred'&&!e.candidate)ctx.addIssue({code:'custom',message:'Inferred expectations must remain candidates'});
});
export const CoverageDraftSchema=z.object({
  schemaVersion:z.literal(1).default(1),title:z.string().trim().min(1).max(120),mode:z.enum(['auto','review','generate-only']).default('auto'),
  status:z.enum(['drafting','published','failed']).default('published'),failureReason:z.string().optional(),
  target:TargetSchema,scope:z.array(z.string().min(1)).min(1),gaps:z.array(z.string()).default([]),
  requirements:z.array(z.object({id:Id,description:z.string().min(1),source:SourceSchema,caseIds:z.array(Id),gap:z.string().optional()}).strict()).default([]),
  items:z.array(CoverageItemSchema).min(1),
  generation:z.object({aiSupplemented:z.boolean().default(false),round:z.number().int().positive().default(1),maxRounds:z.number().int().positive().max(10).default(2),maxAdditionalCases:z.number().int().nonnegative().max(100).default(12)}).strict().default({})
}).strict().superRefine((draft,ctx)=>{
  const ids=new Set(draft.items.map(i=>i.id));
  if(ids.size!==draft.items.length)ctx.addIssue({code:'custom',message:'Case ids must be unique'});
  if(new Set(draft.requirements.map(r=>r.id)).size!==draft.requirements.length)ctx.addIssue({code:'custom',message:'Requirement ids must be unique'});
  for(const r of draft.requirements){if(r.caseIds.some(id=>!ids.has(id)))ctx.addIssue({code:'custom',message:`Unknown case in requirement ${r.id}`});if(!r.caseIds.length&&!r.gap?.trim())ctx.addIssue({code:'custom',message:`Unmapped requirement ${r.id} needs a gap reason`});}
  if(draft.generation.round>draft.generation.maxRounds||draft.items.filter(i=>i.suggestedBy==='ai').length>draft.generation.maxAdditionalCases)ctx.addIssue({code:'custom',message:'Scenario generation budget exhausted'});
  if(draft.status==='failed'&&!draft.failureReason?.trim())ctx.addIssue({code:'custom',message:'Failed planning needs a reason'});
});
export type CoverageDraft=z.infer<typeof CoverageDraftSchema>;
export type CoverageItem=z.infer<typeof CoverageItemSchema>;
export const CoverageManifestSchema=z.object({
  id:Id,revision:z.number().int().positive(),createdAt:z.string().datetime(),expiresAt:z.string().datetime(),
  reason:z.string().min(1),requestId:Id,draft:CoverageDraftSchema
}).strict();
export type CoverageManifest=z.infer<typeof CoverageManifestSchema>;
export const CoverageAdoptionSchema=z.object({revision:z.number().int().positive(),reference:z.string().min(1),kind:z.enum(['automatic','user','locator-only','scope-preserved']),timestamp:z.string().datetime()}).strict();
export type CoverageAdoption=z.infer<typeof CoverageAdoptionSchema>;
export const CoverageSnapshotSchema=z.object({schemaVersion:z.literal(1),manifest:CoverageManifestSchema,history:z.array(CoverageManifestSchema),adoption:CoverageAdoptionSchema}).strict();
export type CoverageSnapshot=z.infer<typeof CoverageSnapshotSchema>;
// Canonical digests are independent of JSON object key order.
export function canonical(value:unknown):string {if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;if(value&&typeof value==='object')return '{'+Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';return JSON.stringify(value)??'undefined';}
export function digest(value:unknown){return createHash('sha256').update(canonical(value)).digest('hex');}
export function caseSemantics(c:Case){return {...c,locatorRepairs:[],steps:c.steps.map(step=>{const {locator,...rest}=step as typeof step&{locator?:unknown};return rest;})};}
export function reviewSemantics(draft:CoverageDraft){return {...draft,items:draft.items.map(i=>({...i,executable:i.executable?caseSemantics(i.executable):undefined}))};}
export function selectedSemantics(draft:CoverageDraft){return {mode:draft.mode,target:draft.target,scope:draft.scope,items:draft.items.filter(i=>i.selected).map(i=>({...i,executable:i.executable?caseSemantics(i.executable):undefined}))};}
export function coverageFromPlan(plan:Plan,mode:CoverageDraft['mode']='auto'):CoverageDraft {
  return CoverageDraftSchema.parse({title:plan.scope.join('、').slice(0,120),mode,target:plan.target,scope:plan.scope,gaps:plan.gaps,
    requirements:plan.scope.map((description,index)=>({id:`scope-${index+1}`,description,source:{type:'inferred',reference:'已有结构化计划的范围描述，未自动证明逐项需求覆盖'},caseIds:[],gap:'由原计划派生；逐项需求映射待核实'})),
    items:plan.cases.map(c=>({id:c.id,title:c.title,suggestedBy:'derived',priority:'P1',selected:true,selectionReason:'执行原计划用例',readiness:'ready',rationale:'从已有结构化计划确定性派生，未进行 AI 补漏',dimension:'原计划',preconditions:c.preconditions,
      actions:c.steps.filter(s=>!isAssertion(s)).map(s=>`${s.id}：${s.op}`).concat(c.steps.every(isAssertion)?['读取页面状态']:[]),
      expectations:c.steps.filter(isAssertion).map(s=>({description:`${s.id}：${s.op}${'expected'in s?` ${JSON.stringify(s.expected)}`:''}`,source:s.source,candidate:s.candidate})).concat(c.steps.some(isAssertion)?[]:[{description:'没有正式业务断言',source:{type:'inferred',reference:'原计划未提供断言'},candidate:true}]),executable:c}))});
}
export function coverageStatus(manifest:CoverageManifest,adopted:boolean){const d=manifest.draft;return d.status!=='published'?d.status:d.mode==='generate-only'?'generated-only':adopted?'adopted':d.mode==='review'?'awaiting-review':'ready';}
export function coveragePlan(snapshot:CoverageSnapshot):Plan {
  const {draft}=snapshot.manifest;
  const cases=draft.items.filter(i=>i.selected).map(i=>i.executable??{schemaVersion:1 as const,id:i.id,version:1,title:i.title,state:'draft' as const,preconditions:[],conflicts:[],locatorRepairs:[],steps:[{id:'unavailable',op:'unsupported' as const,capability:i.reason??'场景尚未就绪'}]});
  if(!cases.length)throw new Error('No selected cases; keep this coverage plan as a preview');
  return {schemaVersion:1,id:snapshot.manifest.id,target:draft.target,scope:draft.scope,gaps:draft.gaps,cases};
}
export function verifyCoveragePlan(snapshot:CoverageSnapshot,plan:Plan){const expected=coveragePlan(snapshot);if(digest(plan.target)!==digest(expected.target)||digest(plan.cases)!==digest(expected.cases)||digest(plan.scope)!==digest(expected.scope))throw new Error('Executable plan does not match the adopted coverage revision');}
export function coverageResult(snapshot:CoverageSnapshot,run?:Pick<Run,'id'|'cases'>,final=false){
  const all=new Map<string,{item:CoverageItem;revision:number}>();for(const m of [...snapshot.history,snapshot.manifest])for(const item of m.draft.items)all.set(item.id,{item,revision:m.revision});
  return {schemaVersion:1,coverageId:snapshot.manifest.id,revision:snapshot.manifest.revision,runId:run?.id,requirements:snapshot.manifest.draft.requirements,
    items:[...all.values()].map(({item,revision})=>{const current=snapshot.manifest.draft.items.some(i=>i.id===item.id);if(!current)item={...item,selected:false,selectionReason:`已从范围移除：${snapshot.manifest.reason}`};const c=run?.cases.find(c=>c.id===item.id);const steps=c?.attempts.flatMap(a=>a.steps)??[];const executed=!!steps.length;
      return {id:item.id,title:item.title,revision,selected:item.selected,selectionReason:item.selectionReason,readiness:item.readiness,
        executionStatus:!item.selected?'not-selected':!c?'not-started':!executed?'not-started':final?'finished':'started',
        reason:c?.attempts.at(-1)?.reason??(!item.selected?item.selectionReason:item.reason)??(final&&!executed?'未执行，剩余范围未验证':undefined),
        ...(c?{outcome:c.outcome,unstable:c.unstable}:{}),evidenceIds:steps.flatMap(s=>s.evidence.map(e=>e.id))};})};
}
export function coverageMarkdown(snapshot:CoverageSnapshot){const m=snapshot.manifest,d=m.draft;return [`# 测试覆盖清单：${d.title}`,'',`计划：${m.id}；版本：${m.revision}；模式：${d.mode}`,'',...d.scope.map(s=>`- ${s}`),'',...d.items.flatMap(i=>[`## ${i.title}（${i.id}）`,'',`${i.priority} · ${i.suggestedBy} · ${i.selected?'本次选中':'本次未选'} · ${i.readiness}`,`安排：${i.selectionReason}`,`补充理由：${i.rationale}`,`前置条件：${i.preconditions.join('、')||'未声明'}`,...i.actions.map(a=>`- 操作：${a}`),...i.expectations.map(e=>`- 预期：${e.description}；依据：${e.source.type} / ${e.source.reference}${e.candidate?'（候选）':''}`),...(i.reason?[`限制：${i.reason}`]:[]),'']),'## 未覆盖与限制','',...d.gaps.map(g=>`- ${g}`),...d.requirements.filter(r=>r.gap).map(r=>`- ${r.description}：${r.gap}`),''].join('\n');}
export function reconciliationMarkdown(snapshot:CoverageSnapshot,run:Pick<Run,'id'|'cases'>){const labels:Record<string,string>={passed:'通过',failed:'失败',blocked:'受阻',inconclusive:'无法确定'};const result=coverageResult(snapshot,run,true);return ['','## 覆盖清单对账','',`计划：${result.coverageId}；采用版本：${result.revision}`,'',...result.items.map(i=>`- ${i.title}（${i.id}）：${!i.selected?'本次未选':i.executionStatus==='not-started'?'未执行':labels[i.outcome??'inconclusive']}${i.reason?`；${i.reason}`:''}`),'','以上仅对应本次选定范围；范围外建议不计为通过。','', '### 计划版本记录','',...[...snapshot.history,snapshot.manifest].map(m=>`- 第 ${m.revision} 版：${m.reason}`),''].join('\n');}
