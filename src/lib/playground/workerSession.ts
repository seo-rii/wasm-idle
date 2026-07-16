type WorkerOperationKind = 'load' | 'run';

export type WorkerOperation = symbol;

type ActiveOperation = {
	kind: WorkerOperationKind;
	token: WorkerOperation;
	reject: (reason?: unknown) => void;
};

type WorkerSessionOptions = {
	label: string | (() => string);
	onDispose?: (worker: Worker) => void;
};

const scriptErrorMessage = (label: string, event: ErrorEvent) => {
	const location =
		event.filename && event.lineno ? ` (${event.filename}:${event.lineno}:${event.colno})` : '';
	return `${label} worker script error: ${event.message || 'unknown error'}${location}`;
};

export class WorkerSession {
	private worker: Worker | null = null;
	private activeOperation: ActiveOperation | null = null;

	constructor(private readonly options: WorkerSessionOptions) {}

	attach(worker: Worker) {
		if (this.worker === worker) return worker;
		if (this.worker) {
			const replacedWorker = this.disposeWorker();
			if (replacedWorker) this.options.onDispose?.(replacedWorker);
		}

		this.worker = worker;
		worker.onerror = (event: ErrorEvent) => {
			this.fail(scriptErrorMessage(this.label, event));
		};
		worker.onmessageerror = () => {
			this.fail(`${this.label} worker message deserialization failed`);
		};
		return worker;
	}

	load(
		initialize: (
			resolve: () => void,
			reject: (reason?: unknown) => void
		) => void | Promise<void>
	): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const token = this.startOperation('load', reject);
			const resolveLoad = () => {
				if (!this.complete(token)) return;
				resolve();
			};
			const rejectLoad = (reason?: unknown) => {
				if (!this.isActive(token)) return;
				this.fail(reason);
			};

			Promise.resolve()
				.then(() => initialize(resolveLoad, rejectLoad))
				.catch(rejectLoad);
		});
	}

	waitForLoad(
		worker: Worker,
		initialize: (resolve: () => void, reject: (reason?: unknown) => void) => void
	): Promise<void> {
		this.attach(worker);
		return this.load(initialize);
	}

	beginRun(worker: Worker | null | undefined, reject: (reason?: unknown) => void) {
		if (worker) this.attach(worker);
		return this.startOperation('run', reject);
	}

	complete(operation: WorkerOperation) {
		if (!this.isActive(operation)) return false;
		this.activeOperation = null;
		return true;
	}

	reset() {
		const worker = this.disposeWorker();
		if (worker) this.options.onDispose?.(worker);
	}

	terminate(reason: unknown = 'Process terminated') {
		const activeOperation = this.activeOperation;
		this.activeOperation = null;
		const worker = this.disposeWorker();
		if (worker) this.options.onDispose?.(worker);
		activeOperation?.reject(reason);
	}

	private get label() {
		return typeof this.options.label === 'function' ? this.options.label() : this.options.label;
	}

	private startOperation(kind: WorkerOperationKind, reject: (reason?: unknown) => void) {
		const previousOperation = this.activeOperation;
		const token = Symbol(kind);
		this.activeOperation = { kind, token, reject };
		previousOperation?.reject('Worker operation superseded');
		return token;
	}

	private isActive(operation: WorkerOperation) {
		return this.activeOperation?.token === operation;
	}

	private fail(reason?: unknown) {
		const activeOperation = this.activeOperation;
		this.activeOperation = null;
		const worker = this.disposeWorker();
		if (worker) this.options.onDispose?.(worker);
		activeOperation?.reject(reason);
	}

	private disposeWorker() {
		const worker = this.worker;
		if (!worker) return null;

		this.worker = null;
		worker.onmessage = null;
		worker.onerror = null;
		worker.onmessageerror = null;
		worker.terminate();
		return worker;
	}
}
