import {mkdir,writeFile,lstat,realpath,readdir,rm} from 'node:fs/promises';
import {join,resolve,relative} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {CoverageDraftSchema,CoverageManifestSchema,CoverageAdoptionSchema,CoverageRefSchema,CoverageSnapshotSchema,coverageStatus,coverageMarkdown,digest,reviewSemantics,selectedSemantics,type CoverageDraft,type CoverageRef,type CoverageManifest,type CoverageSnapshot} from '../core/coverage.js';
import {dataRoot} from '../core/runtime.js';
import {isAssertion} from '../core/schema.js';
import {PilotError} from '../core/errors.js';
import {Redactor,assertPortable} from './redaction.js';
import {withRunLock} from './management.js';
import {atomicJson,openArtifact} from '../dashboard/files.js';

const State=z.object({schemaVersion:z.literal(1),id:z.string(),revision:z.number().int().positive(),revisions:z.array(z.number().int().positive()),adoptions:z.array(CoverageAdoptionSchema),runs:z.array(z.string())}).strict();
const missing=(e:unknown)=>(e as NodeJS.ErrnoException).code==='ENOENT';
export class CoverageStore {
  readonly root:string;
  constructor(root?:string){this.root=dataRoot(root);}
  dir(id:string){CoverageRefSchema.shape.id.parse(id);return join(this.root,'plans',id);}
  private async directory(path:string,create=false){if(create)await mkdir(path,{recursive:true,mode:0o700});const st=await lstat(path);if(!st.isDirectory()||st.isSymbolicLink()||await realpath(path)!==resolve(await realpath(this.root),relative(this.root,path)))throw new PilotError('INVALID_PLAN_PATH','Invalid coverage directory');}
  private async json(path:string){const {handle,stat}=await openArtifact(this.root,path);try{if(stat.size>32*1024*1024)throw new PilotError('PLAN_TOO_LARGE','Coverage metadata exceeds limit');return JSON.parse(await handle.readFile('utf8'));}finally{await handle.close();}}
  private async state(id:string){await this.directory(join(this.root,'plans'));await this.directory(this.dir(id));const state=State.parse(await this.json(join(this.dir(id),'state.json')));if(state.id!==id)throw new PilotError('PLAN_ID_MISMATCH','Coverage identity mismatch');return state;}
  private checkExpiry(m:CoverageManifest){if(Date.parse(m.expiresAt)<=Date.now())throw new PilotError('PLAN_EXPIRED','Coverage plan expired; generate a new plan');}
  private clean(input:unknown,bindings:Record<string,string>){const parsed=CoverageDraftSchema.parse(input);assertPortable(parsed.target,bindings);for(const item of parsed.items)if(item.executable)assertPortable(item.executable,bindings);return CoverageDraftSchema.parse(new Redactor(bindings).object(parsed));}
  async create(input:unknown,bindings:Record<string,string>={}){
    const draft=this.clean(input,bindings);const id=`plan-${randomUUID()}`;await this.directory(this.root,true);await this.directory(join(this.root,'plans'),true);await this.directory(this.dir(id),true);await this.directory(join(this.dir(id),'revisions'),true);
    const now=new Date();const manifest=CoverageManifestSchema.parse({id,revision:1,createdAt:now.toISOString(),expiresAt:new Date(+now+draft.target.evidence.retentionDays*86400000).toISOString(),reason:'初始覆盖计划',requestId:'initial',draft});
    await writeFile(join(this.dir(id),'revisions','1.json'),JSON.stringify(manifest)+'\n',{flag:'wx',mode:0o600});await atomicJson(join(this.dir(id),'state.json'),{schemaVersion:1,id,revision:1,revisions:[1],adoptions:[],runs:[]});return this.read({id,revision:1});
  }
  async read(ref:{id:string;revision?:number},allowExpired=false){
    const state=await this.state(ref.id);const revision=ref.revision??state.revision;if(!state.revisions.includes(revision))throw new PilotError('PLAN_VERSION_UNKNOWN','Coverage version is not committed');
    CoverageRefSchema.parse({id:ref.id,revision});const manifest=CoverageManifestSchema.parse(await this.json(join(this.dir(ref.id),'revisions',`${revision}.json`)));
    if(manifest.id!==ref.id||manifest.revision!==revision)throw new PilotError('PLAN_ID_MISMATCH','Coverage revision identity mismatch');if(!allowExpired)this.checkExpiry(manifest);
    const adoption=state.adoptions.find(a=>a.revision===revision);return {manifest,adoption,runs:state.runs,status:coverageStatus(manifest,!!adoption),currentRevision:state.revision};
  }
  async update(id:string,expectedRevision:number,requestId:string,input:unknown,reason:string,bindings:Record<string,string>={}){
    CoverageRefSchema.parse({id:requestId,revision:expectedRevision});if(!reason.trim())throw new PilotError('CHANGE_REASON_MISSING','Coverage updates need a reason');const draft=this.clean(input,bindings);const safeReason=new Redactor(bindings).text(reason);
    return withRunLock(this.root,`coverage-${digest(id).slice(0,32)}`,async()=>{
      const current=await this.read({id});const state=await this.state(id);await this.directory(join(this.dir(id),'revisions'));const revisions=(await readdir(join(this.dir(id),'revisions'))).filter(f=>/^\d+\.json$/.test(f));
      const aiIds=new Set(draft.items.filter(i=>i.suggestedBy==='ai').map(i=>i.id));
      for(const file of revisions){const previous=CoverageManifestSchema.parse(await this.json(join(this.dir(id),'revisions',file)));if(state.revisions.includes(previous.revision))for(const item of previous.draft.items)if(item.suggestedBy==='ai')aiIds.add(item.id);if(previous.requestId===requestId){if(digest(previous.draft)!==digest(draft)||previous.reason!==safeReason)throw new PilotError('REQUEST_ID_REUSED','Request id was already used for different content');if(state.revisions.includes(previous.revision))return this.read({id,revision:previous.revision});}}
      if(aiIds.size>draft.generation.maxAdditionalCases)throw new PilotError('GENERATION_LIMIT_EXCEEDED','AI additions across revisions exceed the generation budget');
      if(current.currentRevision!==expectedRevision)throw new PilotError('PLAN_VERSION_CONFLICT','Coverage changed; read the latest revision');
      const old=current.manifest.draft;
      if(old.mode!==draft.mode||digest(old.target)!==digest(draft.target))throw new PilotError('PLAN_SCOPE_CHANGED','Create a new plan to change mode or target');
      for(const r of old.requirements)if(!draft.requirements.some(n=>n.id===r.id))throw new PilotError('REQUIREMENT_REMOVED','Keep known acceptance points and record gaps instead');
      for(const item of old.items){const next=draft.items.find(n=>n.id===item.id);const formal=(test:typeof item.executable)=>test?.steps.filter(s=>isAssertion(s)&&!s.candidate).map(s=>{const {locator,...rest}=s as typeof s&{locator?:unknown};return rest;})??[];
        if(item.executable&&formal(item.executable).length&&digest(formal(item.executable))!==digest(formal(next?.executable))){const change=next?.executable?.change;if(!change?.adoptedBy||!change.source||change.source.type==='inferred')throw new PilotError('ASSERTION_ADOPTION_REQUIRED','Changing or removing formal assertions needs a new source and adoption record');}
        if(next&&item.suggestedBy==='ai'&&next.suggestedBy!=='ai')throw new PilotError('SCENARIO_ORIGIN_CHANGED','Keep AI provenance when adopting a supplemented scenario');
      }
      if(draft.generation.round<old.generation.round||draft.generation.maxRounds!==old.generation.maxRounds||draft.generation.maxAdditionalCases!==old.generation.maxAdditionalCases)throw new PilotError('GENERATION_LIMIT_CHANGED','Generation limits cannot be reset during refinement');
      if(draft.items.some(i=>i.suggestedBy==='ai'&&!old.items.some(o=>o.id===i.id))&&draft.generation.round<=old.generation.round)throw new PilotError('GENERATION_ROUND_REQUIRED','New AI scenarios require a new generation round');
      const revision=Math.max(state.revision,...revisions.map(f=>Number(f.slice(0,-5))))+1;
      const manifest=CoverageManifestSchema.parse({...current.manifest,revision,createdAt:new Date().toISOString(),requestId,reason:safeReason,draft});
      await writeFile(join(this.dir(id),'revisions',`${revision}.json`),JSON.stringify(manifest)+'\n',{flag:'wx',mode:0o600});
      const locatorOnly=digest(reviewSemantics(old))===digest(reviewSemantics(draft));
      const scopePreserved=digest(selectedSemantics(old))===digest(selectedSemantics(draft));
      if(current.adoption&&(locatorOnly||scopePreserved))state.adoptions.push({revision,reference:current.adoption.reference,kind:locatorOnly?'locator-only':'scope-preserved',timestamp:new Date().toISOString()});
      await atomicJson(join(this.dir(id),'state.json'),{...state,revision,revisions:[...state.revisions,revision]});return this.read({id,revision});
    });
  }
  async adopt(ref:CoverageRef,reference:string,userConfirmed=false){
    CoverageRefSchema.parse(ref);if(!reference.trim())throw new PilotError('ADOPTION_REFERENCE_REQUIRED','Provide the adoption reference');
    return withRunLock(this.root,`coverage-${digest(ref.id).slice(0,32)}`,async()=>{const record=await this.read(ref);const state=await this.state(ref.id);if(state.revision!==ref.revision)throw new PilotError('PLAN_VERSION_CONFLICT','Adopt the current revision');
      const d=record.manifest.draft;if(d.status!=='published'||d.mode==='generate-only')throw new PilotError('PLAN_NOT_EXECUTABLE','Plan is draft, failed or generate-only');if(d.mode==='review'&&!userConfirmed)throw new PilotError('REVIEW_REQUIRED','Explicit user adoption is required');
      if(!record.adoption){state.adoptions.push({revision:ref.revision,reference:new Redactor().text(reference),kind:d.mode==='review'?'user':'automatic',timestamp:new Date().toISOString()});await atomicJson(join(this.dir(ref.id),'state.json'),state);}return this.read(ref);});
  }
  async snapshot(ref:CoverageRef):Promise<CoverageSnapshot>{const record=await this.read(ref);if(!record.adoption||record.manifest.draft.status!=='published'||record.manifest.draft.mode==='generate-only')throw new PilotError('PLAN_NOT_ADOPTED','Publish and adopt this revision before execution');const history=[];for(const revision of (await this.state(ref.id)).revisions){if(revision<ref.revision)history.push((await this.read({id:ref.id,revision})).manifest);}history.sort((a,b)=>a.revision-b.revision);return CoverageSnapshotSchema.parse({schemaVersion:1,manifest:record.manifest,history,adoption:record.adoption});}
  async saveSnapshot(ref:CoverageRef,runDir:string){const snapshot=await this.snapshot(ref);await atomicJson(join(runDir,'coverage.json'),snapshot);await writeFile(join(runDir,'coverage.md'),coverageMarkdown(snapshot),{mode:0o600});return snapshot;}
  async link(ref:CoverageRef,runId:string){await this.snapshot(ref);return withRunLock(this.root,`coverage-${digest(ref.id).slice(0,32)}`,async()=>{const state=await this.state(ref.id);if(!state.runs.includes(runId)){state.runs.push(runId);await atomicJson(join(this.dir(ref.id),'state.json'),state);}});}
  async list(){const result=[];try{for(const entry of await readdir(join(this.root,'plans'),{withFileTypes:true})){if(!entry.isDirectory()||entry.isSymbolicLink())continue;try{result.push(await this.read({id:entry.name}));}catch{}}}catch{}return result;}
  async prune(now=Date.now()){let removed=0;try{for(const entry of await readdir(join(this.root,'plans'),{withFileTypes:true})){if(!entry.isDirectory()||entry.isSymbolicLink())continue;try{await withRunLock(this.root,`coverage-${digest(entry.name).slice(0,32)}`,async()=>{const {manifest}=await this.read({id:entry.name},true);if(Date.parse(manifest.expiresAt)<now){await rm(this.dir(entry.name),{recursive:true});removed++;}});}catch{}}}catch{}return removed;}
}
