import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {z} from 'zod';
import {PlanSchema,TargetSchema,TargetResolutionSchema,type Plan,type TargetResolution} from '../core/schema.js';
import {PilotError} from '../core/errors.js';
import {inspectProject,type Inspection} from './index.js';

export interface ResolvedTarget extends Inspection {targetResolution:TargetResolution}
const inputEnvelope=z.object({target:z.unknown(),targetResolution:TargetResolutionSchema.optional()}).passthrough();

// This path never reads project files. An adopted/saved target is already authoritative.
export function fixedTarget(input:unknown,resolution:unknown={schemaVersion:1,sources:{}}):ResolvedTarget {
  const target=TargetSchema.parse(input),metadata=TargetResolutionSchema.parse(resolution);
  const sources=Object.fromEntries(Object.keys(target).map(key=>[key,metadata.sources[key]??'saved']));
  return {target,sources,targetResolution:{schemaVersion:1,sources},candidates:[],
    gaps:target.projectPath?[]:['Source and Git impact analysis unavailable for URL-only target.'],ready:!!target.url||!!target.staticDir};
}

export async function resolveTarget(input:unknown,resolution?:unknown):Promise<ResolvedTarget> {
  if(resolution!==undefined)return fixedTarget(input,resolution);
  const inspection=await inspectProject(input);
  return {...inspection,targetResolution:{schemaVersion:1,sources:inspection.sources}};
}

export function requireReady(inspection:Inspection) {
  if(!inspection.ready)throw new PilotError('TARGET_AMBIGUOUS',inspection.gaps.join(' ')||'Provide a URL or staticDir');
}

export async function resolvePlan(input:unknown):Promise<Plan> {
  const raw=inputEnvelope.parse(input);
  const inspection=await resolveTarget(raw.target,raw.targetResolution);requireReady(inspection);
  return PlanSchema.parse({...raw,target:inspection.target,targetResolution:inspection.targetResolution});
}

// Adopted targets may fill omitted fields, but only values actually submitted by
// the caller are allowed to override them. No current project configuration participates.
export function adoptedTarget(input:unknown,baseline:unknown,resolution?:unknown):ResolvedTarget {
  const raw=TargetSchema.partial().parse(input);
  const explicit=Object.fromEntries(Object.entries(raw).filter(([,value])=>value!==undefined));
  return fixedTarget({...TargetSchema.parse(baseline),...explicit},resolution);
}

export const LEGACY_TARGET_GAP='旧运行未保存目标解析来源；本次以保存计划为准，无法保证恢复旧首次执行配置。';

export async function overridePlan(input:unknown,overrides:unknown={},options:{savedRun?:boolean}={}):Promise<Plan> {
  const raw=inputEnvelope.parse(input);
  const explicit=Object.fromEntries(Object.entries(TargetSchema.partial().parse(overrides)).filter(([,value])=>value!==undefined));
  if(!raw.targetResolution&&!options.savedRun)return resolvePlan({...raw,target:{...(raw.target as object),...explicit}});
  const baseline=fixedTarget(raw.target,raw.targetResolution);
  let configured:Record<string,unknown>={};
  if(explicit.configPath){
    try{configured=JSON.parse(await readFile(resolve(String(explicit.configPath)),'utf8'));TargetSchema.partial().parse(configured);}
    catch(error){throw new PilotError((error as NodeJS.ErrnoException).code==='ENOENT'?'CONFIG_MISSING':'CONFIG_INVALID',`Configuration is unavailable or invalid: ${explicit.configPath}`);}
  }
  const target=TargetSchema.parse({...baseline.target,...configured,...explicit});
  const sources={...baseline.sources};
  for(const [key,value]of Object.entries(configured))if(value!==undefined)sources[key]='config';
  for(const [key,value]of Object.entries(explicit))if(value!==undefined)sources[key]='explicit';
  const parsed=PlanSchema.parse({...raw,target,targetResolution:{schemaVersion:1,sources}});
  if(options.savedRun&&!raw.targetResolution)parsed.gaps=[...parsed.gaps,LEGACY_TARGET_GAP];
  return parsed;
}
