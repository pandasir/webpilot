import { z } from 'zod';

export const VERSION = '0.1.0';
const Id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/);
export const BindingsSchema = z.record(Id,z.string());
export const HttpUrlSchema = z.string().url().refine(value=>{
  const url=new URL(value);return ['http:','https:'].includes(url.protocol) && !url.username && !url.password;
},'Use HTTP(S) without embedded credentials');
export const RefSchema = z.object({ ref: Id }).strict();
export const ValueSchema = z.union([z.string(), RefSchema]);
export const SourceSchema = z.object({
  type: z.enum(['user', 'openspec', 'regression', 'inferred']),
  reference: z.string().min(1), revision: z.string().optional(), adoptedBy: z.string().optional()
}).strict();
export const LocatorSchema = z.object({
  kind: z.enum(['role', 'label', 'text', 'testId', 'selector']), value: z.string().min(1),
  name: z.string().optional(), exact: z.boolean().default(true), scope: z.array(z.string().min(1)).default([])
}).strict();
const basic = { id: Id, timeoutMs: z.number().int().positive().max(60000).optional() };
const located = { ...basic, locator: LocatorSchema };
const assertions = { ...basic, source: SourceSchema, candidate: z.boolean().default(false) };
export const StepSchema = z.discriminatedUnion('op', [
  z.object({ ...basic, op: z.literal('navigate'), path: ValueSchema }).strict(),
  z.object({ ...located, op: z.literal('click') }).strict(),
  z.object({ ...located, op: z.literal('fill'), value: ValueSchema }).strict(),
  z.object({ ...located, op: z.literal('select'), value: ValueSchema }).strict(),
  z.object({ ...located, op: z.literal('check'), checked: z.boolean() }).strict(),
  z.object({ ...located, op: z.literal('press'), key: z.string().min(1) }).strict(),
  z.object({ ...basic, op: z.literal('scroll'), x: z.number(), y: z.number() }).strict(),
  z.object({ ...basic, op: z.literal('frame'), selector: z.string().min(1).nullable() }).strict(),
  z.object({ ...located, op: z.literal('openPage'), name: Id }).strict(),
  z.object({ ...basic, op: z.literal('switchPage'), name: Id }).strict(),
  z.object({ ...located, op: z.literal('upload'), file: RefSchema }).strict(),
  z.object({ ...located, ...assertions, op: z.literal('download'), filename: z.string().min(1) }).strict(),
  z.object({ ...located, ...assertions, op: z.literal('expectVisible'), expected: z.boolean().default(true) }).strict(),
  z.object({ ...located, ...assertions, op: z.literal('expectText'), expected: ValueSchema, contains: z.boolean().default(false) }).strict(),
  z.object({ ...assertions, op: z.literal('expectURL'), expected: ValueSchema }).strict(),
  z.object({ ...located, ...assertions, op: z.literal('expectCount'), expected: z.number().int().nonnegative() }).strict(),
  z.object({ ...located, ...assertions, op: z.literal('expectValue'), expected: ValueSchema }).strict(),
  z.object({ ...located, ...assertions, op: z.literal('expectEnabled'), expected: z.boolean() }).strict(),
  z.object({ ...basic, op: z.literal('unsupported'), capability: z.string().min(1) }).strict()
]);
export const BudgetSchema = z.object({
  totalMs: z.number().int().positive().max(3600000).default(600000),
  maxSteps: z.number().int().positive().max(10000).default(100),
  assertionMs: z.number().int().positive().max(60000).default(10000),
  attempts: z.number().int().positive().max(5).default(1)
}).strict().default({});
export const CommandSchema = z.object({
  executable: z.string().min(1), args: z.array(z.string()).default([]), cwd: z.string().optional(),
  timeoutMs: z.number().int().positive().max(600000).default(30000)
}).strict();
export const TargetSchema = z.object({
  schemaVersion: z.literal(1).default(1), url: HttpUrlSchema.optional(), projectPath: z.string().optional(),
  configPath: z.string().optional(), application: z.string().optional(),
  command: CommandSchema.optional(), staticDir: z.string().optional(),
  ready: z.object({ timeoutMs: z.number().int().positive().default(30000), statuses: z.array(z.number().int().min(100).max(599)).default([200]), path: z.string().default('/') }).strict().default({}),
  allowedOrigins: z.array(HttpUrlSchema).default([]),
  viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict().default({ width:1280, height:720 }),
  roles: z.record(Id, z.object({ required: z.boolean().default(true), storageStateRef: Id.optional(), login: z.array(StepSchema).default([]), verify: z.array(StepSchema).default([]) }).strict()).default({}),
  data: z.object({ prepare: CommandSchema.optional(), cleanup: CommandSchema.optional() }).strict().default({}),
  budget: BudgetSchema,
  evidence: z.object({ masks: z.array(z.string().min(1)).default([]), secrets: z.array(RefSchema).default([]), rawTrace: z.boolean().default(false), video: z.boolean().default(true), live: z.boolean().default(true), retentionDays: z.number().int().positive().default(7) }).strict().default({})
}).strict();
export const CaseSchema = z.object({
  schemaVersion: z.literal(1), id: Id, version: z.number().int().positive(), title: z.string().min(1),
  state: z.enum(['draft', 'regression-ready']).default('draft'), verifiedBy:Id.optional(), role: Id.optional(),
  preconditions: z.array(z.string()).default([]), conflicts: z.array(z.string()).default([]),
  steps: z.array(StepSchema).min(1), change: z.object({ reason: z.string().min(1), adoptedBy: z.string().optional(), source: SourceSchema.optional() }).strict().optional(),
  locatorRepairs:z.array(z.object({stepId:Id,previous:LocatorSchema,next:LocatorSchema,reason:z.string().min(1),status:z.literal('candidate')}).strict()).default([])
}).strict().superRefine((c, ctx) => {
  const ids = new Set<string>();
  for (const step of c.steps) {
    if (ids.has(step.id)) ctx.addIssue({ code:'custom', message:`Duplicate step id: ${step.id}` });
    ids.add(step.id);
    if (isAssertion(step) && step.source.type === 'inferred' && !step.candidate) {
      ctx.addIssue({ code:'custom', message:`Inferred assertion ${step.id} must remain candidate; use a user adoption source to formalize it` });
    }
  }
  if (c.state === 'regression-ready' && (c.conflicts.length || !c.steps.some(s => isAssertion(s) && !s.candidate))) {
    ctx.addIssue({ code:'custom', message:'Regression-ready cases need formal assertions and no conflicts' });
  }
});
export const PlanSchema = z.object({
  schemaVersion: z.literal(1), id: Id, target: TargetSchema,
  scope: z.array(z.string()).min(1), gaps: z.array(z.string()).default([]), cases: z.array(CaseSchema).min(1)
}).strict().superRefine((plan, ctx) => {
  if (new Set(plan.cases.map(c=>c.id)).size !== plan.cases.length) ctx.addIssue({code:'custom',message:'Case ids must be unique'});
});
export const OutcomeSchema = z.enum(['passed','failed','blocked','inconclusive']);
export const EvidenceSchema = z.object({
  schemaVersion:z.literal(1), id:Id, runId:Id, caseId:Id, stepId:Id, attempt:z.number().int().positive(),
  type:z.enum(['snapshot','screenshot','console','network','omitted']), path:z.string().optional(),
  redacted:z.literal(true), timestamp:z.string(), reason:z.string().optional()
}).strict();
export const StepResultSchema = z.object({id:Id,op:z.string(),outcome:OutcomeSchema,timestamp:z.string(),durationMs:z.number(),
  candidate:z.boolean().default(false),expected:z.unknown().optional(),actual:z.unknown().optional(),error:z.object({code:z.string(),message:z.string()}).optional(),evidence:z.array(EvidenceSchema).default([])}).strict();
export const RecordingSchema = z.discriminatedUnion('status',[
  z.object({status:z.literal('available'),pageId:Id,pageName:z.string(),path:z.string(),sensitive:z.literal(true),redacted:z.literal(false)}).strict(),
  z.object({status:z.literal('omitted'),pageId:Id.optional(),pageName:z.string().optional(),reason:z.string()}).strict()
]);
export const AttemptSchema = z.object({number:z.number().int().positive(),outcome:OutcomeSchema,steps:z.array(StepResultSchema),reason:z.string().optional(),cleanupError:z.string().optional(),recordings:z.array(RecordingSchema).optional()}).strict();
export const RunSchema = z.object({
  schemaVersion:z.literal(1),id:Id,planId:Id,startedAt:z.string(),finishedAt:z.string(),outcome:OutcomeSchema,unstable:z.boolean(),
  target:z.object({url:z.string(),sources:z.record(z.string()),projectPath:z.string().optional()}).strict(),
  environment:z.object({runner:z.string(),node:z.string(),browser:z.string(),platform:z.string(),viewport:z.object({width:z.number(),height:z.number()}),codeRevision:z.string().optional()}).strict(),
  scope:z.array(z.string()),gaps:z.array(z.string()),cases:z.array(z.object({id:Id,version:z.number(),title:z.string(),outcome:OutcomeSchema,unstable:z.boolean(),attempts:z.array(AttemptSchema)}).strict()),
  exitCode:z.number().int().min(0).max(3),reproduce:z.string(),cleanupErrors:z.array(z.string()).default([]),playbackPath:z.string().optional()
}).strict();
export type Step = z.infer<typeof StepSchema>;
export type Assertion = Extract<Step,{source:unknown}>;
export type Target = z.infer<typeof TargetSchema>;
export type Case = z.infer<typeof CaseSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type Run = z.infer<typeof RunSchema>;
export type Attempt = z.infer<typeof AttemptSchema>;
export type StepResult = z.infer<typeof StepResultSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type Recording = z.infer<typeof RecordingSchema>;
export type LocatorSpec = z.infer<typeof LocatorSchema>;
export type Command = z.infer<typeof CommandSchema>;
export type Bindings = Record<string,string>;
export function isAssertion(step: { op:string }): step is Assertion { return step.op.startsWith('expect') || step.op === 'download'; }
