import { PilotError } from './errors.js';
import type { Target } from './schema.js';

export class Budget {
  readonly deadline:number;
  private steps = 0;
  constructor(readonly settings:Target['budget'], readonly signal?:AbortSignal) { this.deadline=Date.now()+settings.totalMs; }
  check() {
    if (this.signal?.aborted) throw new PilotError('CANCELLED','Run was cancelled','inconclusive');
    if (Date.now() >= this.deadline) throw new PilotError('BUDGET_EXHAUSTED','Run time budget exhausted','inconclusive');
  }
  consume() { this.check(); if (++this.steps>this.settings.maxSteps) throw new PilotError('BUDGET_EXHAUSTED','Run step budget exhausted','inconclusive'); }
  timeout(requested?:number) { this.check(); return Math.max(1,Math.min(requested ?? this.settings.assertionMs, this.deadline-Date.now())); }
  get usedSteps() { return this.steps; }
}
