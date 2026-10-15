import type {Bindings,Target} from '../core/schema.js';
import {PilotError} from '../core/errors.js';

export class Redactor {
  private secrets=new Set<string>();
  constructor(bindings:Bindings={}) { for(const value of Object.values(bindings))if(value)this.secrets.add(value); }
  add(value:string) { if(value)this.secrets.add(value); }
  text(value:string) {
    let result=value;
    for(const secret of [...this.secrets].sort((a,b)=>b.length-a.length))result=result.split(secret).join('[REDACTED]');
    return result
      .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi,'Bearer [REDACTED]')
      .replace(/((?:password|passwd|secret|token|api[_-]?key|authorization|cookie)\s*[=:]\s*)["']?[^\s,"';}]+/gi,'$1[REDACTED]')
      .replace(/([?&](?:token|key|password|secret|access_token|code)=)[^&#\s]*/gi,'$1[REDACTED]');
  }
  object<T>(value:T):T {
    const walk=(item:unknown):unknown=>{
      if(typeof item==='string')return this.text(item);
      if(Array.isArray(item))return item.map(walk);
      if(item && typeof item==='object')return Object.fromEntries(Object.entries(item).map(([key,v])=>[key,walk(v)]));
      return item;
    };
    return walk(value) as T;
  }
}
export function resolveValue(value:string|{ref:string},bindings:Bindings) {
  if(typeof value==='string')return value;
  if(!Object.hasOwn(bindings,value.ref) || typeof bindings[value.ref]!=='string')throw new PilotError('MISSING_REFERENCE',`Missing runtime reference: ${value.ref}`);
  return bindings[value.ref];
}
export function assertPortable(value:unknown,bindings:Bindings) {
  const serialized=JSON.stringify(value);
  for(const secret of Object.values(bindings))if(secret && serialized.includes(JSON.stringify(secret).slice(1,-1))) {
    throw new PilotError('EMBEDDED_RUNTIME_VALUE','Asset contains a runtime value. Replace it with a reference.');
  }
  if(/(?:Bearer\s+[A-Za-z0-9._~+\/-]{8,}|sk-[A-Za-z0-9_-]{12,}|"(?:password|token|secret|apiKey)"\s*:)/i.test(serialized)) {
    throw new PilotError('EMBEDDED_SECRET','Asset appears to contain a credential. Use runtime references.');
  }
}
export function configuredMasks(target:Target) { return [...new Set(['input[type="password"]',...target.evidence.masks])]; }
