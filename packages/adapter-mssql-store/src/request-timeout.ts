import { AsyncLocalStorage } from 'node:async_hooks';
import type * as tedious from 'tedious';

type RequestConstructor = typeof tedious.Request;

export interface RequestTimeoutScope {
  Request: RequestConstructor;
  run<T>(timeoutMs: number, operation: () => T): T;
}

/** Apply a timeout to each Tedious request created by one asynchronous operation. */
export function createRequestTimeoutScope(Request: RequestConstructor): RequestTimeoutScope {
  const activeTimeout = new AsyncLocalStorage<number>();

  class RequestWithTimeout extends Request {
    constructor(...args: ConstructorParameters<RequestConstructor>) {
      super(...args);
      const timeoutMs = activeTimeout.getStore();
      if (timeoutMs !== undefined) this.setTimeout(timeoutMs);
    }
  }

  return {
    Request: RequestWithTimeout,
    run<T>(timeoutMs: number, operation: () => T): T {
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
        throw new Error('SQL Server request timeout must be a positive integer');
      }
      return activeTimeout.run(timeoutMs, operation);
    },
  };
}
