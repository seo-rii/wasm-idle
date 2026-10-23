import { resolveDebugRuntimeUrls, type PlaygroundRuntimeAssets } from '$lib/playground/assets';
import { LldbSandboxSession, type LldbArtifactPayload } from '$lib/playground/lldbSession';
import type {
	DebugCommand,
	DebugDataBreakpoint,
	DebugDataBreakpointInfoArguments,
	DebugSessionEvent,
	SandboxExecutionOptions
} from '$lib/playground/options';
import { normalizeLldbWorkspacePath } from '$lib/playground/lldbSourcePath';
import {
	mergeDebugBreakpointLines,
	normalizeDebugSourceBreakpoints,
	type DebugEvaluateOptions,
	type DebugSourceBreakpoint,
	type DebugSteppingOptions
} from '@wasm-idle/core';

/** The common LLDB controls for compilers that hand a real DWARF module to WAMR. */
export class CompiledLldbSandbox {
	output?: (data: string) => void;
	ondebug?: (event: DebugSessionEvent) => void;
	protected lldbSession?: LldbSandboxSession;
	protected lldbPending = false;
	protected lldbEntryFunction = 'main';
	private lldbRuntime?: ReturnType<typeof resolveDebugRuntimeUrls>;
	private lldbSourcePath: `/workspace/${string}` = '/workspace/main';
	private readonly lldbBreakpoints = new Map<`/workspace/${string}`, number[]>();
	private readonly lldbBreakpointSpecifications = new Map<
		`/workspace/${string}`,
		DebugSourceBreakpoint[]
	>();
	private lldbPersistentCache?: SandboxExecutionOptions['persistentCache'];

	protected configureLldb(
		runtimeAssets: string | PlaygroundRuntimeAssets,
		options: SandboxExecutionOptions
	) {
		this.lldbRuntime = resolveDebugRuntimeUrls(
			runtimeAssets,
			typeof window !== 'undefined' ? window.location.href : ''
		);
		this.lldbPersistentCache =
			options.persistentCache ??
			(typeof runtimeAssets === 'object' ? runtimeAssets.persistentCache : undefined);
	}

	protected prepareLldb(options: SandboxExecutionOptions, defaultPath: string) {
		this.lldbPending = true;
		this.lldbSourcePath = this.sourcePath(
			options.debugPath || options.activePath || defaultPath
		);
		this.lldbBreakpoints.clear();
		this.lldbBreakpointSpecifications.clear();
		for (const entry of options.sourceBreakpoints || []) {
			const path = this.sourcePath(entry.sourcePath);
			if (entry.breakpoints) {
				const values = normalizeDebugSourceBreakpoints(entry.breakpoints);
				this.lldbBreakpointSpecifications.set(path, values);
				this.lldbBreakpoints.set(
					path,
					values.filter((value) => value.enabled !== false).map((value) => value.line)
				);
			} else this.lldbBreakpoints.set(path, [...entry.lines]);
		}
		if (!this.lldbBreakpoints.has(this.lldbSourcePath)) {
			this.lldbBreakpoints.set(this.lldbSourcePath, [...(options.breakpoints || [])]);
		}
	}

	protected lldbReloadAssets(): Pick<PlaygroundRuntimeAssets, 'debug' | 'persistentCache'> {
		return {
			debug: this.lldbRuntime
				? {
						baseUrl: this.lldbRuntime.baseUrl,
						manifestUrl: this.lldbRuntime.manifestUrl,
						manifestSha256: this.lldbRuntime.manifestReceipt?.sha256
					}
				: undefined,
			persistentCache: this.lldbPersistentCache
		};
	}

	protected startLldb(
		artifact: LldbArtifactPayload,
		options: SandboxExecutionOptions,
		programArgs: string[],
		pendingInput: string[],
		pendingEof: boolean,
		onOutput = (text: string) => this.output?.(text)
	) {
		if (!this.lldbRuntime) throw new Error('LLDB runtime assets have not been configured.');
		const session = new LldbSandboxSession({
			manifestUrl: this.lldbRuntime.manifestUrl,
			manifestReceipt: this.lldbRuntime.manifestReceipt,
			runtimeBaseUrl: this.lldbRuntime.baseUrl,
			persistentCache: options.persistentCache ?? this.lldbPersistentCache,
			artifact,
			sourcePath: this.lldbSourcePath,
			breakpoints: [...(this.lldbBreakpoints.get(this.lldbSourcePath) || [])],
			sourceBreakpoints: [...this.lldbBreakpoints].map(([sourcePath, lines]) => ({
				sourcePath,
				lines: [...lines],
				...(this.lldbBreakpointSpecifications.has(sourcePath)
					? {
							breakpoints: normalizeDebugSourceBreakpoints(
								this.lldbBreakpointSpecifications.get(sourcePath)!
							)
						}
					: {})
			})),
			debugSteppingOptions: options.debugSteppingOptions,
			pauseOnEntry: !!options.pauseOnEntry,
			pauseAtMain: true,
			entryFunctionName: this.lldbEntryFunction,
			programArgs,
			stdin: options.stdin,
			onDebugEvent: (event) => this.ondebug?.(event),
			onOutput
		});
		this.lldbSession = session;
		for (const input of pendingInput.splice(0)) void session.write(input);
		if (pendingEof) void session.eof();
		return session.start().finally(() => {
			if (this.lldbSession === session) {
				this.lldbSession = undefined;
				this.lldbPending = false;
			}
		});
	}

	protected stopLldb() {
		const session = this.lldbSession;
		this.lldbSession = undefined;
		this.lldbPending = false;
		return session?.disconnect();
	}

	private sourcePath(path: string): `/workspace/${string}` {
		const normalized = normalizeLldbWorkspacePath(path);
		if (!normalized) throw new Error('LLDB requires a workspace source path.');
		return `/workspace/${normalized}`;
	}

	debugCommand(command: DebugCommand) {
		return this.lldbSession?.debugCommand(command);
	}

	debugPause() {
		return this.lldbSession?.pause();
	}

	setBreakpoints(lines: number[], sourcePath?: string) {
		const path = sourcePath ? this.sourcePath(sourcePath) : this.lldbSourcePath;
		if (this.lldbSession) return this.lldbSession.setBreakpoints(lines, path);
		if (this.lldbBreakpointSpecifications.has(path))
			return this.setSourceBreakpoints(
				mergeDebugBreakpointLines(this.lldbBreakpointSpecifications.get(path)!, lines),
				path
			);
		this.lldbBreakpoints.set(path, [...lines]);
	}

	async setSourceBreakpoints(breakpoints: DebugSourceBreakpoint[], sourcePath?: string) {
		const values = normalizeDebugSourceBreakpoints(breakpoints);
		const path = sourcePath ? this.sourcePath(sourcePath) : this.lldbSourcePath;
		if (this.lldbSession) return this.lldbSession.setSourceBreakpoints(values, path);
		this.lldbBreakpointSpecifications.set(path, values);
		this.lldbBreakpoints.set(
			path,
			values.filter((value) => value.enabled !== false).map((value) => value.line)
		);
	}

	async debugSetSteppingOptions(options: DebugSteppingOptions) {
		if (!this.lldbSession) throw new Error('Stepping options require an LLDB session.');
		await this.lldbSession.setSteppingOptions(options);
	}

	debugEvaluateValue(expression: string, options?: DebugEvaluateOptions) {
		return (
			this.lldbSession?.evaluateValue(expression, options) ??
			Promise.reject(new Error('LLDB is not running.'))
		);
	}

	debugEvaluate(expression: string) {
		return (
			this.lldbSession?.evaluate(expression) ??
			Promise.reject(new Error('LLDB is not running.'))
		);
	}

	debugVariables(reference: number, start?: number, count?: number) {
		return this.lldbSession?.variables(reference, start, count) ?? Promise.resolve([]);
	}

	debugScopes(frameId: number) {
		return this.lldbSession?.scopes(frameId) ?? Promise.resolve([]);
	}

	debugFrameScopes(frameId: number) {
		return this.lldbSession?.frameScopes(frameId) ?? Promise.resolve([]);
	}

	debugFrameName(frameId: number) {
		return this.lldbSession?.formattedFrameName(frameId) ?? Promise.resolve(null);
	}

	debugReadMemory(reference: string, offset: number, count: number) {
		return this.lldbSession?.readMemory(reference, offset, count) ?? Promise.resolve(null);
	}

	debugWriteMemory(reference: string, offset: number, data: Uint8Array, allowPartial = false) {
		return (
			this.lldbSession?.writeMemory(reference, offset, data, allowPartial) ??
			Promise.resolve(null)
		);
	}

	debugDataBreakpointInfo(arguments_: DebugDataBreakpointInfoArguments) {
		return this.lldbSession?.dataBreakpointInfo(arguments_) ?? Promise.resolve(null);
	}

	debugSetDataBreakpoints(breakpoints: DebugDataBreakpoint[]) {
		return this.lldbSession?.setDataBreakpoints(breakpoints) ?? Promise.resolve([]);
	}
}
