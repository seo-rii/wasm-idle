import { PersistentWorkspaceError, type PersistentWorkspace, type PersistentWorkspaceInspection } from '../fs/persistence/index.js';

export interface WorkspaceSaveOptions {
  /** Explicit opt-in. Defaults to false. */
  readonly autosave?: boolean;
  readonly delayMs?: number;
  readonly maxWaitMs?: number;
}
export interface WorkspaceSaveInspection {
  readonly workspace: PersistentWorkspaceInspection;
  readonly autosave: boolean;
  readonly pausedAfterError: boolean;
  readonly disposed: boolean;
}
export interface WorkspaceSaveController {
  /** Latest-state stream, bounded to one queued value; not a history of transitions. */
  readonly updates: ReadableStream<WorkspaceSaveInspection>;
  inspect(): WorkspaceSaveInspection;
  /** Commits at least the published revision observed by this call. */
  save(): Promise<PersistentWorkspaceInspection>;
  /** Enabling explicitly also retries automatic saving after a previous error. */
  setAutosave(enabled: boolean): void;
  /** Stops scheduling; waits for an existing save but never starts one or disposes the owner. */
  dispose(): Promise<void>;
}
const owners = new WeakSet<PersistentWorkspace>();

/** UI binding only: the injecting application still owns storage and user-facing actions. */
export function createWorkspaceSaveController(owner: PersistentWorkspace, options: WorkspaceSaveOptions = {}): WorkspaceSaveController {
  const delay = options.delayMs ?? 1000, maximum = options.maxWaitMs ?? Math.max(delay, 5000);
  if (options.autosave !== undefined && typeof options.autosave !== 'boolean' || !Number.isSafeInteger(delay) || delay < 10 || delay > 600000 || !Number.isSafeInteger(maximum) || maximum < delay || maximum > 3600000) throw new PersistentWorkspaceError('INVALID_ARGUMENT', 'Invalid autosave delay bounds');
  if (owner.inspect().state === 'disposed') throw new PersistentWorkspaceError('DISPOSED', 'Workspace owner is disposed');
  if (owners.has(owner)) throw new PersistentWorkspaceError('BUSY', 'Workspace already has a save controller');
  const abort = new AbortController(), changes = owner.fs.watch({ path: '/', maxQueuedEvents: 1, signal: abort.signal }).getReader();
  owners.add(owner);
  let autosave = options.autosave ?? false, paused = false, disposed = false, streamClosed = false;
  let timer: ReturnType<typeof setTimeout> | undefined, firstDirty: number | undefined;
  let pending: Promise<PersistentWorkspaceInspection> | undefined, disposal: Promise<void> | undefined, goal = -1;
  let queued: WorkspaceSaveInspection | undefined, waiting = false;
  let stream: ReadableStreamDefaultController<WorkspaceSaveInspection>;
  const inspect = (): WorkspaceSaveInspection => Object.freeze({ workspace: owner.inspect(), autosave, pausedAfterError: paused, disposed });
  const updates = new ReadableStream<WorkspaceSaveInspection>({
    start(controller) { stream = controller; queued = inspect(); },
    pull(controller) { if (queued) { const next = queued; queued = undefined; controller.enqueue(next); } else waiting = true; },
    cancel() { streamClosed = true; queued = undefined; }
  }, { highWaterMark: 0 });
  const emit = () => {
    if (streamClosed) return;
    const value = inspect();
    if (waiting) { waiting = false; stream.enqueue(value); } else queued = value;
  };
  const stopTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const active = () => { if (disposed) throw new PersistentWorkspaceError('DISPOSED', 'Save controller is disposed'); };
  const schedule = () => {
    stopTimer();
    const current = owner.inspect();
    if (!current.dirty) { firstDirty = undefined; return; }
    if (!autosave || paused || disposed || pending || current.state === 'disposed') return;
    const now = Date.now(); firstDirty ??= now;
    timer = setTimeout(() => { timer = undefined; void save().catch(() => { /* Reflected in the bounded status stream; no automatic retry loop. */ }); }, Math.max(0, Math.min(delay, firstDirty + maximum - now)));
  };
  const save = (): Promise<PersistentWorkspaceInspection> => {
    active(); stopTimer(); goal = Math.max(goal, owner.fs.generation);
    if (pending) return pending;
    paused = false;
    const operation = (async () => {
      try {
        let result: PersistentWorkspaceInspection;
        do { const saving = owner.flush(); emit(); result = await saving; emit(); }
        while (!disposed && (result.committedGeneration ?? -1) < goal);
        if ((result.committedGeneration ?? -1) < goal) throw new PersistentWorkspaceError('DISPOSED', 'Save controller disposed before the requested revision committed');
        return result;
      } catch (error) { paused = true; emit(); throw error; }
    })();
    pending = operation.finally(() => { pending = undefined; firstDirty = undefined; emit(); schedule(); });
    return pending;
  };
  const watching = (async () => {
    for (;;) {
      const result = await changes.read(); if (result.done) return;
      emit(); schedule();
    }
  })();
  // The VFS subscription closes only by the controller's abort, never by guest code.
  void watching.catch(() => { paused = true; stopTimer(); emit(); });
  schedule();
  return {
    updates, inspect, save,
    setAutosave(enabled) {
      active(); if (typeof enabled !== 'boolean') throw new PersistentWorkspaceError('INVALID_ARGUMENT', 'Autosave must be a boolean');
      autosave = enabled; paused = false; firstDirty = undefined; emit(); schedule();
    },
    dispose() {
      if (disposal) return disposal;
      disposed = true; stopTimer(); abort.abort(); emit();
      disposal = (async () => {
        try { await pending; } catch { /* The retained owner inspection and memory still expose save failure. */ }
        await watching; changes.releaseLock(); owners.delete(owner);
        if (!streamClosed) { streamClosed = true; queued = undefined; stream.close(); }
      })();
      return disposal;
    }
  };
}
