import { AsyncLocalStorage } from 'node:async_hooks';

export interface ActiveRunContext {
  runId: string;
  sessionId: string;
}

export class TraceContext {
  private readonly storage = new AsyncLocalStorage<ActiveRunContext>();

  get(): ActiveRunContext | undefined {
    return this.storage.getStore();
  }

  run<T>(context: ActiveRunContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }
}