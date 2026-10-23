import {
	CdpDebugAdapter,
	createBrowserCdpTransport,
	type CdpTransport,
	type CdpWasmLocation
} from '@wasm-idle/debug';
import type {
	DebugCommand,
	DebugScope,
	DebugSessionEvent,
	DebugResolvedBreakpoint,
	DebugSourceBreakpoints
} from './options';

export const createCdpWorkerName = () => `wasm-idle-cdp:${crypto.randomUUID()}`;
export const cdpSourceUrl = (workerName: string, sourcePath: string) =>
	`wasm-idle://${workerName.slice('wasm-idle-cdp:'.length)}/${sourcePath.replace(/^\/+/, '')}`;

let transportFactory: (workerName: string) => Promise<CdpTransport> = createBrowserCdpTransport;
/** Container owners install a bridge to the document that owns extension permissions. */
export function setCdpTransportFactory(factory: (workerName: string) => Promise<CdpTransport>) {
	transportFactory = factory;
}

export interface CdpSandboxSessionOptions {
	workerName: string;
	sourcePath: string;
	source: string;
	breakpoints: number[];
	sourceBreakpoints?: DebugSourceBreakpoints[];
	pauseOnEntry: boolean;
	url?: string;
	wasm?: { bytes: Uint8Array; locations: CdpWasmLocation[] };
	onDebugEvent(event: DebugSessionEvent): void;
	onFailure(error: unknown): void;
	/** Allows native CDP browser tests without installing an extension in the user's profile. */
	transport?: CdpTransport;
}

/** Adapts native VM pauses to the existing playground's debugger and terminal contracts. */
export class CdpSandboxSession {
	private adapter?: CdpDebugAdapter;
	private disposed = false;
	private version = 0;
	private selectedFrameId?: number;
	private command: DebugCommand = 'continue';
	private sourceHash = '';
	private disposal?: Promise<void>;

	constructor(private readonly options: CdpSandboxSessionOptions) {}

	async start() {
		try {
			await this.initialize();
		} catch (error) {
			await this.dispose().catch(() => undefined);
			throw error;
		}
	}
	private async initialize() {
		const transport =
			this.options.transport ?? (await transportFactory(this.options.workerName));
		if (this.disposed) {
			await transport.disconnect();
			return;
		}
		const adapter = new CdpDebugAdapter({
			transport,
			source: { path: this.options.sourcePath },
			url: this.options.url,
			lineOffset: 2,
			variables: !this.options.wasm
		});
		this.adapter = adapter;
		const hash = await crypto.subtle.digest(
			'SHA-256',
			new TextEncoder().encode(this.options.source)
		);
		this.sourceHash = [...new Uint8Array(hash)]
			.map((byte) => byte.toString(16).padStart(2, '0'))
			.join('');
		adapter.onEvent((event) => {
			if (this.disposed) return;
			if (event.type === 'stopped') {
				void this.publishPause(event.reason).catch((error) =>
					this.options.onFailure(error)
				);
			} else if (event.type === 'continued') {
				this.version += 1;
				this.selectedFrameId = undefined;
				this.options.onDebugEvent({ type: 'resume', command: this.command });
			} else if (event.type === 'terminated') {
				this.options.onFailure(
					new Error(
						'The native debugger disconnected. Enable its extension and restart Debug.'
					)
				);
			} else if (event.type === 'breakpoint') {
				const path = event.breakpoint.source.path || this.options.sourcePath;
				const current = this.currentBreakpoints.get(path);
				if (!current) return;
				const value = event.breakpoint;
				const index = current.findIndex(
					(item) => item.requestedLine === value.requestedLine
				);
				if (index >= 0)
					current[index] = {
						requestedLine: value.requestedLine,
						line: value.line,
						verified: value.verified,
						message: value.message
					};
				this.options.onDebugEvent({
					type: 'breakpoints',
					sourcePath: path,
					breakpoints: [...current]
				});
			}
		});
		await adapter.initialize();
		if (this.disposed) return;
		if (this.options.wasm) {
			const expected = this.options.wasm.bytes;
			let matched = false;
			for (const [scriptId, script] of adapter.scripts) {
				if (script.scriptLanguage !== 'WebAssembly') continue;
				// Compiler modules are much larger than the generated program. Avoid fetching
				// their bytecode when CDP supplies a usable byte length.
				if (
					typeof script.length === 'number' &&
					script.length > expected.length * 4 + 65536
				)
					continue;
				const response = await transport.request('Debugger.getScriptSource', { scriptId });
				if (typeof response.bytecode !== 'string') continue;
				const bytes = atob(response.bytecode);
				if (bytes.length !== expected.length) continue;
				if (!expected.every((byte, index) => byte === bytes.charCodeAt(index))) continue;
				adapter.registerWasmSource(scriptId, this.options.wasm.locations);
				matched = true;
				break;
			}
			if (!matched)
				throw new Error('CDP could not identify the generated Java WebAssembly module');
		}
		await this.setBreakpoints(this.options.breakpoints);
		for (const source of this.options.sourceBreakpoints || []) {
			await this.setBreakpoints(source.lines, source.sourcePath);
		}
		if (this.disposed) return;
		await adapter.launch({ stopOnEntry: this.options.pauseOnEntry });
	}

	private currentBreakpoints = new Map<string, DebugResolvedBreakpoint[]>();
	async setBreakpoints(lines: number[], sourcePath = this.options.sourcePath) {
		const breakpoints = await this.adapter?.setBreakpoints({ path: sourcePath }, lines);
		if (this.disposed || !breakpoints) return;
		this.currentBreakpoints.set(
			sourcePath,
			breakpoints.map(({ requestedLine, line, verified, message }) => ({
				requestedLine,
				line,
				verified,
				message
			}))
		);
		this.options.onDebugEvent({
			type: 'breakpoints',
			sourcePath,
			sourceContentSha256:
				sourcePath === this.options.sourcePath ? this.sourceHash : undefined,
			breakpoints: breakpoints.map(({ requestedLine, line, verified, message }) => ({
				requestedLine,
				line,
				verified,
				message
			}))
		});
	}
	private async publishPause(reason: string) {
		const adapter = this.adapter;
		if (!adapter) return;
		const version = ++this.version;
		const frames = await adapter.stackTrace(1);
		const first = frames[0];
		if (this.disposed || version !== this.version) return;
		if (!first) {
			// Pause can land in the Worker's idle/runtime glue. Do not leave a VM
			// suspended when there is no user frame for the UI to control.
			await adapter.continue(1);
			return;
		}
		this.selectedFrameId = first.id;
		const scopes = await adapter.scopes(first.id);
		const locals = [];
		for (const scope of scopes.filter((item) => !item.expensive).slice(0, 2)) {
			locals.push(...(await adapter.variables(scope.variablesReference, 0, 50)));
		}
		if (this.disposed || version !== this.version) return;
		this.options.onDebugEvent({
			type: 'pause',
			line: first.line,
			reason:
				reason === 'breakpoint' || reason === 'entry' || reason === 'pause'
					? reason
					: this.command === 'nextLine'
						? 'nextLine'
						: this.command === 'stepOut'
							? 'stepOut'
							: 'step',
			locals,
			callStack: frames.map((frame) => ({
				id: frame.id,
				functionName: frame.name,
				line: frame.line,
				column: frame.column,
				sourcePath: frame.source?.path,
				sourceContentSha256:
					frame.source?.path === this.options.sourcePath ? this.sourceHash : undefined
			})),
			frameId: first.id,
			threadId: 1,
			sourcePath: first.source?.path,
			sourceContentSha256:
				first.source?.path === this.options.sourcePath ? this.sourceHash : undefined,
			scopes: scopes.map((scope) => ({ ...scope, variables: [] })),
			capabilities: { readMemory: false, writeMemory: false, dataBreakpoints: false }
		});
	}
	async debugCommand(command: DebugCommand) {
		this.command = command;
		const adapter = this.adapter;
		if (!adapter || this.disposed) return;
		if (command === 'continue') await adapter.continue(1);
		else if (command === 'stepInto') await adapter.stepIn(1);
		else if (command === 'nextLine') await adapter.next(1);
		else await adapter.stepOut(1);
	}
	pause() {
		return this.adapter?.pause(1);
	}
	async evaluate(expression: string) {
		if (!this.adapter?.capabilities.supportsEvaluate) return '?';
		return (await this.adapter.evaluate(expression, this.selectedFrameId)).result;
	}
	variables(reference: number, start?: number, count?: number) {
		return this.adapter?.variables(reference, start, count) ?? Promise.resolve([]);
	}
	async frameScopes(frameId: number): Promise<DebugScope[]> {
		return ((await this.adapter?.scopes(frameId)) ?? []).map((scope) => ({
			...scope,
			variables: []
		}));
	}
	async scopes(frameId: number) {
		this.selectedFrameId = frameId;
		return await this.frameScopes(frameId);
	}
	dispose() {
		if (this.disposal) return this.disposal;
		this.disposed = true;
		this.version += 1;
		this.disposal = this.adapter?.disconnect() ?? Promise.resolve();
		try {
			this.options.onDebugEvent({ type: 'stop' });
		} catch {
			// Caller notification must not prevent native VM cleanup.
		}
		return this.disposal;
	}
}
