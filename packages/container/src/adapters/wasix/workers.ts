import { ContainerError } from '../../errors.js';

export interface WasixWorkerInspection {
  readonly active: number;
  readonly created: number;
  readonly terminated: number;
  readonly maxWorkers: number;
  readonly disposed: boolean;
}
export interface WasixWorkerGroup {
  readonly failure: AbortSignal;
  inspect(): WasixWorkerInspection;
  dispose(): Promise<void>;
}
const installed = new WeakSet<object>();

/**
 * The qualified SDK forwards nested guest thread requests to its owner scheduler;
 * all Worker constructors run in this realm. Arbitrary JS runtimes that create
 * independent descendant Workers are outside this explicit ownership profile.
 */
export function installWasixWorkerGroup(options: {
  readonly maxWorkers?: number;
  /** A dedicated owner realm. Override is intended for deterministic protocol tests. */
  readonly scope?: { Worker: typeof Worker; document?: unknown };
} = {}): WasixWorkerGroup {
  const scope = options.scope ?? globalThis;
  const maxWorkers = options.maxWorkers ?? 32;
  if (scope.document !== undefined || typeof scope.Worker !== 'function' || !Number.isSafeInteger(maxWorkers) || maxWorkers < 1 || maxWorkers > 256 || installed.has(scope)) {
    throw new ContainerError('UNSUPPORTED_PROFILE', 'WASIX needs one dedicated owner Worker and a bounded worker group');
  }
  const NativeWorker = scope.Worker, children = new Set<Worker>(), failed = new AbortController();
  let disposed = false, created = 0, terminated = 0;
  class OwnedWorker extends NativeWorker {
    constructor(url: string | URL, options?: WorkerOptions) {
      if (disposed || children.size >= maxWorkers) {
        const error = new ContainerError(disposed ? 'DISPOSED' : 'RESOURCE_LIMIT', 'WASIX worker group cannot allocate another Worker');
        failed.abort(error); throw error;
      }
      super(url, options);
      children.add(this); created++;
      this.addEventListener('error', this.failed);
      this.addEventListener('messageerror', this.failed);
    }
    private failed = () => failed.abort(new ContainerError('STARTUP_FAILED', 'A worker in the WASIX group failed'));
    override terminate(): void {
      if (!children.has(this)) return;
      super.terminate(); children.delete(this);
      this.removeEventListener('error', this.failed); this.removeEventListener('messageerror', this.failed);
      terminated++;
    }
  }
  scope.Worker = OwnedWorker; installed.add(scope);
  let disposal: Promise<void> | undefined;
  return Object.freeze({
    failure: failed.signal,
    inspect: () => Object.freeze({ active: children.size, created, terminated, maxWorkers, disposed }),
    dispose() {
      if (disposal) return disposal;
      disposed = true;
      const errors: unknown[] = [];
      for (const child of [...children]) { try { child.terminate(); } catch (error) { errors.push(error); } }
      // A cancelled SDK initialization or scheduler continuation can resume
      // later. Keep the closed constructor installed for this retired realm;
      // restoring NativeWorker would permit untracked late allocations.
      disposal = errors.length ? Promise.reject(new AggregateError(errors, 'WASIX Worker cleanup failed')) : Promise.resolve();
      void disposal.catch(() => {});
      return disposal;
    }
  });
}
