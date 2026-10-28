// Browser side of the opt-in benchmark. Timings end at the sandbox API, not DOM paint.
import Java from '../src/lib/playground/java';
import { LldbSandboxSession } from '../src/lib/playground/lldbSession';
import { WASM_DEBUG_RUNTIME_PROFILE } from '../src/lib/playground/wasmDebugVersion';
import { BUNDLED_CLANG_LANGUAGE_SYSROOT_PROFILES } from '../src/lib/playground/clangAssetIntegrity';
import type { DebugSessionEvent } from '../src/lib/playground/options';

const cSource =
	'#include <stdio.h>\nint main(void) {\n int number = 68;\n number += 1;\n number += 1;\n printf("result=%d\\n", number);\n return 0;\n}';
const javaSource =
	'public class Main {\n public static void main(String[] args) {\n  int number = 68;\n  number += 1;\n  number += 1;\n  System.out.println("result=" + number);\n }\n}';
const limits = {
	startupTimeoutMs: 120_000,
	compileTimeoutMs: 120_000,
	executionTimeoutMs: 120_000,
	maxAssetBytes: 100_000_000
};
function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout>;
	return Promise.race([
		promise,
		new Promise<T>((_, reject) => {
			timer = setTimeout(() => reject(new Error(`${label} timed out`)), 120_000);
		})
	]).finally(() => clearTimeout(timer));
}
function pauses() {
	let next: ((value: Extract<DebugSessionEvent, { type: 'pause' }>) => void) | undefined;
	let pending: Extract<DebugSessionEvent, { type: 'pause' }> | undefined;
	return {
		event(event: DebugSessionEvent) {
			if (event.type !== 'pause') return;
			if (next) {
				const resolve = next;
				next = undefined;
				resolve(event);
			} else pending = event;
		},
		wait() {
			if (pending) {
				const value = pending;
				pending = undefined;
				return Promise.resolve(value);
			}
			return new Promise<Extract<DebugSessionEvent, { type: 'pause' }>>((resolve) => {
				next = resolve;
			});
		}
	};
}
let java: Java | undefined;
let artifact: any;
let language: 'lldb' | 'java';
let canWatch = false;
export async function prepare(kind: 'lldb' | 'java') {
	language = kind;
	canWatch = kind === 'java';
	const began = performance.now();
	if (kind === 'java') {
		java = new Java();
		await bounded(
			java.load(
				{ rootUrl: location.origin + '/', persistentCache: { enabled: false } },
				javaSource,
				false,
				[],
				{ limits }
			),
			'Java load'
		);
	} else {
		const debugManifest = await (await fetch('/wasm-debug/runtime-manifest.v2.json')).json();
		canWatch = debugManifest.debugger?.capabilities?.evaluateExpressions === true;
		const manifest = await (await fetch('/clang/runtime-manifest.v1.json')).json();
		manifest.compiler.sysroot.profiles = BUNDLED_CLANG_LANGUAGE_SYSROOT_PROFILES;
		const worker = new Worker('/compiler.js', { type: 'module' });
		try {
			artifact = await bounded(
				new Promise((resolve, reject) => {
					worker.onerror = (event) => reject(new Error(event.message));
					worker.onmessage = ({ data }) =>
						data.error ? reject(new Error(data.error)) : resolve(data);
					worker.postMessage({ manifest, source: cSource });
				}),
				'C compilation'
			);
		} finally {
			worker.terminate();
		}
	}
	return { prepareMs: performance.now() - began, watchSupported: canWatch };
}
export async function iteration(index: number) {
	const queue = pauses();
	let output = '';
	let session: LldbSandboxSession | undefined;
	if (language === 'java') {
		java!.ondebug = queue.event;
		java!.output = (chunk: string) => {
			output += chunk;
		};
	} else {
		session = new LldbSandboxSession({
			workerFactory: (kind) => new Worker(`/worker/${kind}-worker.js`, { type: 'module' }),
			manifestUrl: location.origin + '/wasm-debug/runtime-manifest.v2.json',
			manifestReceipt: WASM_DEBUG_RUNTIME_PROFILE.manifestReceipt,
			runtimeBaseUrl: location.origin + '/wasm-debug/',
			persistentCache: { enabled: false },
			artifact: { ...artifact, sources: [{ path: '/workspace/main.c', content: cSource }] },
			sourcePath: '/workspace/main.c',
			breakpoints: [4],
			pauseOnEntry: false,
			onDebugEvent: queue.event,
			onOutput: (chunk) => {
				output += chunk;
			}
		});
	}
	const start = performance.now();
	const completion = session
		? session.start()
		: java!.run(javaSource, false, false, undefined, [], {
				activePath: 'Main.java',
				limits,
				debugMode: 'trace',
				pauseOnEntry: false,
				breakpoints: [4],
				stdin: ''
			});
	void completion.catch(() => undefined);
	const waitPause = () =>
		bounded(
			Promise.race([
				queue.wait(),
				completion.then(() => {
					throw new Error('Exited before pause');
				})
			]),
			'pause'
		);
	const evaluate = (expression: string) =>
		bounded(session ? session.evaluate(expression) : java!.debugEvaluate(expression), 'Watch');
	try {
		const first = await waitPause();
		const launchMs = performance.now() - start;
		if (
			first.line !== 4 ||
			!first.sourcePath?.endsWith(language === 'java' ? '/Main.java' : '/main.c')
		)
			throw new Error(`Wrong entry stop: ${JSON.stringify(first)}`);
		const frameId = first.callStack[0]?.id;
		if (frameId === undefined) throw new Error('Missing paused frame');
		const scopes = session
			? await session.frameScopes(frameId)
			: await java!.debugScopes(frameId);
		const locals = scopes.find((scope) => scope.name === 'Locals');
		if (!locals?.variablesReference) throw new Error('Missing locals');
		const variables = session
			? await session.variables(locals.variablesReference)
			: await java!.debugVariables(locals.variablesReference);
		if (!variables.some((value) => value.name === 'number' && value.value === '68'))
			throw new Error(`Wrong locals: ${JSON.stringify(variables)}`);
		const watches = [];
		// First evaluator startup is intentionally separate from cached repetitions.
		for (let repeat = 0; repeat < (canWatch ? 3 : 0); repeat++) {
			const began = performance.now();
			const value = await evaluate('number + 5');
			watches.push(performance.now() - began);
			if (value !== '73') throw new Error(`Wrong Watch value: ${value}`);
		}
		const stepStart = performance.now();
		const stepped = waitPause();
		await (session ? session.debugCommand('nextLine') : java!.debugCommand('nextLine'));
		const next = await stepped;
		const stepMs = performance.now() - stepStart;
		const nextScopes = session
			? await session.frameScopes(next.callStack[0].id!)
			: await java!.debugScopes(next.callStack[0].id!);
		const nextLocals = nextScopes.find((scope) => scope.name === 'Locals');
		if (!nextLocals?.variablesReference) throw new Error('Missing stepped locals');
		const nextVariables = session
			? await session.variables(nextLocals.variablesReference)
			: await java!.debugVariables(nextLocals.variablesReference);
		if (
			next.line !== 5 ||
			!nextVariables.some((value) => value.name === 'number' && value.value === '69')
		)
			throw new Error(`Step did not advance correctly: ${JSON.stringify(next)}`);
		const commandStart = performance.now();
		await (session ? session.debugCommand('continue') : java!.debugCommand('continue'));
		await bounded(completion, 'completion');
		const continueMs = performance.now() - commandStart;
		if (!output.includes('result=70')) throw new Error(`Wrong output: ${output}`);
		return {
			index,
			phase: index === 0 ? 'first-session' : 'restart',
			launchMs,
			firstWatchMs: watches[0] ?? null,
			repeatedWatchMs: watches.slice(1),
			stepMs,
			continueMs,
			output
		};
	} finally {
		await session?.disconnect();
	}
}
export async function dispose() {
	await java?.dispose();
	java = undefined;
	artifact = undefined;
}
