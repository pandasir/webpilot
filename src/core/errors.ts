import {ZodError} from 'zod';
export type Outcome = 'passed' | 'failed' | 'blocked' | 'inconclusive';

export class PilotError extends Error {
  constructor(public code: string, message: string, public outcome: Outcome = 'blocked') {
    super(message);
    this.name = 'PilotError';
  }
}

export function errorInfo(error: unknown) {
  if(error instanceof ZodError)return {code:'INVALID_INPUT',message:error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; '),outcome:'blocked' as Outcome};
  return error instanceof PilotError
    ? { code: error.code, message: error.message, outcome: error.outcome }
    : { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error), outcome: 'blocked' as Outcome };
}
