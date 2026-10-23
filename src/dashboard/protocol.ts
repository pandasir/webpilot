import {z} from 'zod';
import {OutcomeSchema,StepResultSchema,AttemptSchema,RecordingSchema} from '../core/schema.js';

export const PROTOCOL=1;
export const MAX_FRAME=2*1024*1024;
export const MAX_BUFFER=2*1024*1024;
export const Id=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/);
export const IdentitySchema=z.object({pid:z.number().int().positive(),nonce:z.string().uuid(),started:z.string().optional()}).strict();
export const MetaSchema=z.object({protocolVersion:z.literal(1),id:Id,title:z.string(),titleSource:z.enum(['task','target']).optional(),mode:z.enum(['suite','exploration','planned-session']),target:z.string(),project:z.string().optional(),startedAt:z.string(),owner:IdentitySchema,totalCases:z.number().int().nonnegative().optional(),cases:z.array(z.object({id:Id,title:z.string(),version:z.number().int().positive()})).default([]),live:z.boolean().default(true)}).strict();
export type RunMeta=z.infer<typeof MetaSchema>;
export const LiveRunSchema=z.object({id:Id,meta:MetaSchema.extend({owner:IdentitySchema.optional()}),seq:z.number().int().nonnegative(),lifecycle:z.enum(['preparing','running','collecting','cleaning','finished','interrupted','historical']),connection:z.enum(['connected','disconnected','unknown']),outcome:OutcomeSchema.optional(),cases:z.array(z.object({id:Id,title:z.string(),version:z.number().int().positive(),attempts:z.array(AttemptSchema)}))}).passthrough().superRefine((run,ctx)=>{if(run.meta.mode==='exploration'&&run.outcome==='passed')ctx.addIssue({code:'custom',message:'Exploration cannot imply formal acceptance'});});
const association={caseId:Id.optional(),attempt:z.number().int().positive().optional(),stepId:Id.optional(),pageId:Id.optional()};
const payloads={
  'observation.finished':z.object({url:z.string(),title:z.string()}).strict(),
  'coverage.updated':z.object({revision:z.number().int().positive(),cases:z.array(z.object({id:Id,title:z.string(),version:z.number().int().positive()}).strict())}).strict(),
  'run.created':z.object({}).strict(),
  'phase.changed':z.object({phase:z.enum(['preparing','running','collecting','cleaning']),message:z.string().optional()}).strict(),
  'case.started':z.object({}).strict(),
  'attempt.started':z.object({}).strict(),
  'step.started':z.object({op:z.string()}).strict(),
  'step.finished':StepResultSchema,
  'evidence.available':z.object({step:StepResultSchema}),
  'attempt.finished':z.object({outcome:OutcomeSchema,reason:z.string().optional(),cleanupError:z.string().optional()}).strict(),
  'case.finished':z.object({outcome:OutcomeSchema,unstable:z.boolean()}).strict(),
  'recording.available':z.object({recordings:z.array(RecordingSchema)}).strict(),
  'run.finished':z.object({outcome:OutcomeSchema.optional(),unstable:z.boolean().optional(),reason:z.string().optional()}).strict(),
} as const;
export type EventType=keyof typeof payloads;
const EventBase=z.object({protocolVersion:z.literal(1),runId:Id,seq:z.number().int().positive(),timestamp:z.string(),type:z.enum(Object.keys(payloads) as [EventType,...EventType[]]),...association,payload:z.unknown()}).strict();
export const ProgressEventSchema=EventBase.superRefine((e,ctx)=>{
  const valid=payloads[e.type].safeParse(e.payload);
  if(!valid.success)ctx.addIssue({code:'custom',message:'Invalid event payload'});
  if((e.type.startsWith('case.')||e.type.startsWith('attempt.')||e.type.startsWith('step.')||e.type==='evidence.available')&&!e.caseId)ctx.addIssue({code:'custom',message:'Missing case association'});
  if((e.type.startsWith('attempt.')||e.type.startsWith('step.')||e.type==='evidence.available')&&!e.attempt)ctx.addIssue({code:'custom',message:'Missing attempt association'});
  if((e.type.startsWith('step.')||e.type==='evidence.available')&&!e.stepId)ctx.addIssue({code:'custom',message:'Missing step association'});
});
export type ProgressEvent=z.infer<typeof ProgressEventSchema>;
export type Association=Partial<Pick<ProgressEvent,'caseId'|'attempt'|'stepId'|'pageId'>>;
export const HandshakeSchema=z.object({protocolVersion:z.literal(1),runId:Id,dataDir:z.string().min(1),owner:IdentitySchema}).strict();
export const FrameHeaderSchema=z.object({protocolVersion:z.literal(1),runId:Id,caseId:Id.optional(),attempt:z.number().int().positive().optional(),pageId:Id,streamEpoch:z.number().int().nonnegative(),frameSeq:z.number().int().nonnegative(),capturedAt:z.number().finite()}).strict();
export type FrameHeader=z.infer<typeof FrameHeaderSchema>;
export function encodeFrame(header:FrameHeader,jpeg:Buffer){
  const meta=Buffer.from(JSON.stringify(FrameHeaderSchema.parse(header)));
  if(meta.length>4096||jpeg.length>MAX_FRAME-4100)throw new Error('Frame exceeds limit');
  const size=Buffer.alloc(4);size.writeUInt32BE(meta.length);return Buffer.concat([size,meta,jpeg]);
}
export function decodeFrame(data:Buffer){
  if(data.length<6||data.length>MAX_FRAME)throw new Error('Invalid frame size');
  const size=data.readUInt32BE(0);if(size>4096||size+6>data.length)throw new Error('Invalid frame header');
  const header=FrameHeaderSchema.parse(JSON.parse(data.subarray(4,4+size).toString()));
  const jpeg=data.subarray(4+size);if(jpeg[0]!==0xff||jpeg[1]!==0xd8)throw new Error('Invalid JPEG');
  return {header,jpeg};
}
