/**
 * @typedef {{ type: string; text: string }} BrowserConsoleMessage
 */
/**
 * @param {string} explicitPath
 */
export function resolveChromiumExecutable(explicitPath?: string): Promise<string>;
/**
 * @param {BrowserConsoleMessage[]} messages
 */
export function findRustCompilerRetries(messages: BrowserConsoleMessage[]): string[];
/**
 * @param {import('playwright-core').Page} page
 */
export function readActiveState(page: import('playwright-core').Page): Promise<{
	crossOriginIsolated: boolean;
	sharedArrayBuffer: boolean;
	serviceWorkerControlled: boolean;
}>;
/**
 * @param {{ browserUrl: string; runTimeoutMs?: number; chromiumExecutable?: string; stdinText?: string; sendEof?: boolean; expectedOutput?: string; targetTriple?: 'wasm32-wasip1' | 'wasm32-wasip2' | 'wasm32-wasip3'; rustExecutableGraphProfile?: RustExecutableGraphProbeProfile }} options
 */
export function runRustBrowserProbe({
	browserUrl,
	runTimeoutMs,
	chromiumExecutable,
	stdinText,
	sendEof,
	expectedOutput,
	targetTriple,
	rustExecutableGraphProfile
}: {
	browserUrl: string;
	runTimeoutMs?: number;
	chromiumExecutable?: string;
	stdinText?: string;
	sendEof?: boolean;
	expectedOutput?: string;
	targetTriple?: 'wasm32-wasip1' | 'wasm32-wasip2' | 'wasm32-wasip3';
	rustExecutableGraphProfile?: RustExecutableGraphProbeProfile;
}): Promise<{
	url: string;
	finalUrl: string;
	title: string;
	activeState: {
		crossOriginIsolated: boolean;
		sharedArrayBuffer: boolean;
		serviceWorkerControlled: boolean;
	};
	availableRustTargets: string[];
	pageErrors: string[];
	progressTrace: import('./browser-progress-probe.mjs').LoadingProgressEntry[];
	transcript: string;
	consoleTail: string[];
	bootstrapErrors: string[];
	rustConsoleErrors: string[];
	compilerRetries: string[];
	callStackErrors: string[];
	rustExecutableGraphStorageEvidence: RustExecutableGraphStorageEvidence[];
	rustExecutableHttpRequests: RustExecutableGraphRequestEvidence[];
	rustLogicalModuleHttpRequests: RustExecutableGraphRequestEvidence[];
	unexpectedRustExecutableStorageRequests: RustExecutableGraphRequestEvidence[];
}>;
export type BrowserConsoleMessage = {
	type: string;
	text: string;
};
export type RustExecutableGraphProbeProfile = {
	readonly entryPath: string;
	readonly modules: Readonly<Record<string, RustExecutableGraphProbeModule>>;
};
export type RustExecutableGraphProbeModule = {
	readonly delivery: {
		readonly storagePath: string;
		readonly encoding: 'identity' | 'gzip';
	};
	readonly storage: {
		readonly sha256: string;
	};
};
export type RustExecutableGraphRequestEvidence = {
	url: string;
	resourceType: string;
};
export type RustExecutableGraphResponseEvidence = {
	url: string;
	status: number;
	ok: boolean;
	contentType: string | null;
	contentEncoding: string | null;
};
export type RustExecutableGraphStorageEvidence = {
	encoding: 'identity' | 'gzip';
	expectedUrl: string;
	logicalPathname: string;
	modulePath: string;
	requests: RustExecutableGraphRequestEvidence[];
	responses: RustExecutableGraphResponseEvidence[];
	storagePath: string;
};
