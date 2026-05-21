import { createBrowserGoBuildPlan } from './build-planner.js';
import { resolveVersionedAssetUrl } from './asset-url.js';
import {
	fetchRuntimeAssetJson,
	fetchRuntimeAssetBytes,
	loadRuntimePackEntries,
	loadRuntimePackIndex
} from './runtime-asset.js';
import { executeGoToolInvocation } from './tool-runtime.js';
import {
	collectGoFileImports,
	collectCompilerDiagnosticText,
	createSysrootDependency,
	normalizeCompileRequestSource,
	normalizePackageImportPath,
	normalizeRequestedTarget,
	parseCompilerDiagnostics,
	resolveStdlibDependencies,
	validateCompileRequest
} from './compiler-support.js';
import {
	loadRuntimeManifest,
	normalizeRuntimeManifest,
	resolveTargetManifest
} from './runtime-manifest.js';
import type {
	BrowserGoArtifact,
	BrowserGoBuildPlan,
	BrowserGoCompileProgress,
	BrowserGoCompileRequest,
	BrowserGoCompiler,
	BrowserGoCompilerResult,
	BrowserGoSourceFile,
	BrowserGoToolInvocation,
	BrowserGoToolResult,
	CompilerLogLevel,
	CompilerLogRecord,
	NormalizedRuntimeManifest,
	RuntimeManifestV1,
	RuntimeStdlibIndex,
	SupportedGoTarget
} from './types.js';

const DEFAULT_RUNTIME_MANIFEST_URL = new URL('./runtime/runtime-manifest.v1.json', import.meta.url);
const DEFAULT_RUNTIME_BASE_URL = new URL('./runtime/', import.meta.url);

function createRuntimeFetch(): typeof fetch {
	return (async (input: string | URL) => {
		const url = new URL(input.toString());
		if (url.protocol !== 'file:') {
			return fetch(url);
		}
		const [{ readFile }, { fileURLToPath }] = await Promise.all([
			import('node:fs/promises'),
			import('node:url')
		]);
		try {
			return new Response(await readFile(fileURLToPath(url)));
		} catch (error) {
			const code =
				error && typeof error === 'object' && 'code' in error ? (error as { code?: string }).code : '';
			return new Response(null, {
				status: code === 'ENOENT' ? 404 : 500
			});
		}
	}) as typeof fetch;
}

export interface CompileGoDependencies {
	loadManifest?: typeof loadRuntimeManifest;
	runTool?: (
		invocation: BrowserGoToolInvocation,
		context?: {
			reportAssetProgress?: (asset: string, loaded: number, total?: number) => void;
		}
	) => Promise<BrowserGoToolResult>;
	fetchImpl?: typeof fetch;
}

export interface CreateGoCompilerOptions {
	manifest?: RuntimeManifestV1 | NormalizedRuntimeManifest;
	runtimeManifestUrl?: string | URL;
	runtimeBaseUrl?: string | URL;
	dependencies?: CompileGoDependencies;
}

export interface PreloadBrowserGoRuntimeOptions {
	manifest?: RuntimeManifestV1 | NormalizedRuntimeManifest;
	runtimeManifestUrl?: string | URL;
	runtimeBaseUrl?: string | URL;
	target?: SupportedGoTarget;
	includeSysroot?: boolean;
	fetchImpl?: typeof fetch;
}

function toStandaloneBytes(value: Uint8Array | ArrayBuffer) {
	return value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array(value);
}

function normalizeToolOutputs(outputs: BrowserGoToolResult['outputs']) {
	if (!outputs) {
		return {};
	}
	return Object.fromEntries(
		Object.entries(outputs).map(([path, bytes]) => [path, toStandaloneBytes(bytes)])
	);
}

async function resolveCompilerRuntime(
	options: CreateGoCompilerOptions | PreloadBrowserGoRuntimeOptions,
	dependencies: CompileGoDependencies = {},
	reportManifestProgress?: (loaded: number, total?: number) => void
) {
	const runtimeBaseUrl = options.runtimeBaseUrl || DEFAULT_RUNTIME_BASE_URL;
	if (options.manifest) {
		return {
			manifest: normalizeRuntimeManifest(options.manifest),
			runtimeBaseUrl
		};
	}
	const manifestUrl = options.runtimeManifestUrl || DEFAULT_RUNTIME_MANIFEST_URL;
	return {
		manifest: await (dependencies.loadManifest || loadRuntimeManifest)(
			manifestUrl,
			dependencies.fetchImpl,
			reportManifestProgress
		),
		runtimeBaseUrl: options.runtimeBaseUrl || new URL('./', manifestUrl.toString())
	};
}

function createProgressEmitter(request: BrowserGoCompileRequest) {
	let lastPercent = 0;
	return (
		stage: BrowserGoCompileProgress['stage'],
		completed: number,
		total: number,
		message?: string
	) => {
		if (!request.onProgress) {
			return;
		}
		const safeTotal = Math.max(1, total);
		const safeCompleted = Math.max(0, Math.min(completed, safeTotal));
		const stageRanges: Record<BrowserGoCompileProgress['stage'], readonly [number, number]> = {
			manifest: [0, 8],
			plan: [8, 20],
			compile: [20, 88],
			link: [88, 97],
			done: [100, 100]
		};
		const [start, end] = stageRanges[stage];
		const percent =
			stage === 'done'
				? 100
				: Math.max(
						lastPercent,
						Math.min(99, start + ((end - start) * safeCompleted) / safeTotal)
					);
		lastPercent = percent;
		request.onProgress({
			stage,
			completed: safeCompleted,
			total: safeTotal,
			percent,
			...(message ? { message } : {})
		});
	};
}

function createLogBuffer(enabled: boolean) {
	const records: CompilerLogRecord[] = [];
	return {
		records,
		push(message: string, level: CompilerLogLevel = 'log') {
			if (!enabled) {
				return;
			}
			records.push({
				level,
				message
			});
		}
	};
}

function createStageAssetProgressReporter(
	stage: Exclude<BrowserGoCompileProgress['stage'], 'done'>,
	progress: ReturnType<typeof createProgressEmitter>,
	stageAssetShare: number
) {
	const assets = new Map<string, { loaded: number; total?: number }>();
	return (asset: string, loaded: number, total?: number) => {
		const entry = assets.get(asset) || { loaded: 0, total: undefined };
		entry.loaded = Math.max(entry.loaded, loaded);
		if (typeof total === 'number' && total > 0) {
			entry.total = Math.max(entry.total ?? 0, total);
		}
		assets.set(asset, entry);
		let weightedLoaded = 0;
		let weightedTotal = 0;
		for (const progressEntry of assets.values()) {
			if (typeof progressEntry.total === 'number' && progressEntry.total > 0) {
				weightedLoaded += Math.min(progressEntry.loaded, progressEntry.total);
				weightedTotal += progressEntry.total;
				continue;
			}
			weightedLoaded += progressEntry.loaded > 0 ? 1 : 0;
			weightedTotal += 1;
		}
		const fraction = weightedTotal > 0 ? weightedLoaded / weightedTotal : 0;
		const assetLabel = asset.split('/').at(-1) || asset;
		progress(
			stage,
			Math.min(stageAssetShare, fraction * stageAssetShare),
			1,
			`loading ${assetLabel}`
		);
	};
}

function failure(
	message: string,
	logs: CompilerLogRecord[],
	plan?: BrowserGoBuildPlan,
	stdout?: string,
	diagnostics?: BrowserGoCompilerResult['diagnostics']
): BrowserGoCompilerResult {
	return {
		success: false,
		stderr: message,
		...(stdout ? { stdout } : {}),
		...(diagnostics && diagnostics.length > 0 ? { diagnostics } : {}),
		...(plan ? { plan } : {}),
		...(logs.length > 0
			? {
					logRecords: logs,
					logs: logs.map((entry) => entry.message)
				}
			: {})
	};
}

function success(
	artifact: BrowserGoArtifact,
	logs: CompilerLogRecord[],
	plan: BrowserGoBuildPlan,
	stdout?: string,
	stderr?: string
): BrowserGoCompilerResult {
	return {
		success: true,
		artifact,
		plan,
		...(stdout ? { stdout } : {}),
		...(stderr ? { stderr } : {}),
		...(logs.length > 0
			? {
					logRecords: logs,
					logs: logs.map((entry) => entry.message)
				}
			: {})
	};
}

export async function preloadBrowserGoRuntime(
	options: PreloadBrowserGoRuntimeOptions = {}
) {
	const fetchImpl = options.fetchImpl || createRuntimeFetch();
	const { manifest, runtimeBaseUrl } = await resolveCompilerRuntime(options, {
		fetchImpl
	});
	const target = resolveTargetManifest(manifest, options.target);
	const fetchedAssets: string[] = [];
	const preloadAsset = async (assetPath: string, label: string) => {
		await fetchRuntimeAssetBytes(resolveVersionedAssetUrl(runtimeBaseUrl, assetPath), label, fetchImpl);
		fetchedAssets.push(resolveVersionedAssetUrl(runtimeBaseUrl, assetPath).toString());
	};
	await preloadAsset(manifest.compiler.compile.asset, 'compile.wasm');
	await preloadAsset(manifest.compiler.link.asset, 'link.wasm');
	if (options.includeSysroot !== false) {
		if (target.sysrootPack) {
			await loadRuntimePackEntries(runtimeBaseUrl, target.sysrootPack, fetchImpl);
			fetchedAssets.push(resolveVersionedAssetUrl(runtimeBaseUrl, target.sysrootPack.index).toString());
			fetchedAssets.push(resolveVersionedAssetUrl(runtimeBaseUrl, target.sysrootPack.asset).toString());
		} else {
			for (const entry of target.sysrootFiles || []) {
				await preloadAsset(entry.asset, `sysroot asset ${entry.runtimePath}`);
			}
		}
	}
	if (target.execution.kind === 'js-wasm-exec' && target.execution.wasmExecJs) {
		await preloadAsset(target.execution.wasmExecJs, 'wasm_exec.js');
	}
	return {
		manifest,
		target,
		runtimeBaseUrl: runtimeBaseUrl.toString(),
		fetchedAssets
	};
}

async function resolveAutoDependencies(
	manifest: NormalizedRuntimeManifest,
	runtimeBaseUrl: string | URL,
	request: BrowserGoCompileRequest,
	fetchImpl: typeof fetch,
	reportAssetProgress?: (asset: string, loaded: number, total?: number) => void
) {
	if (request.dependencies && request.dependencies.length > 0) {
		return request.dependencies;
	}
	if (request.autoDependencies === 'none') {
		return [];
	}
	const target = resolveTargetManifest(manifest, normalizeRequestedTarget(request));
	const sourceFiles = (
		Array.isArray(request.files)
			? request.files
			: Object.entries(request.files || {}).map(([path, contents]) => ({ path, contents }))
	) as BrowserGoSourceFile[];
	if (target.stdlibIndex) {
		const stdlibIndex = (await fetchRuntimeAssetJson(
			resolveVersionedAssetUrl(runtimeBaseUrl, target.stdlibIndex.asset),
			'wasm-go stdlib index',
			fetchImpl,
			(loaded, total) => reportAssetProgress?.(target.stdlibIndex!.asset, loaded, total)
		)) as RuntimeStdlibIndex;
		if (
			stdlibIndex.format === 'wasm-go-stdlib-index-v1' &&
			Array.isArray(stdlibIndex.packages)
		) {
			return resolveStdlibDependencies(
				stdlibIndex,
				collectGoFileImports(sourceFiles),
				request.packageKind
			);
		}
	}
	if (target.sysrootFiles && target.sysrootFiles.length > 0) {
		return target.sysrootFiles
			.map((entry) => createSysrootDependency(entry.runtimePath))
			.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
	}
	if (target.sysrootPack) {
		const index = await loadRuntimePackIndex(
			runtimeBaseUrl,
			target.sysrootPack,
			fetchImpl,
			(loaded, total) => reportAssetProgress?.(target.sysrootPack!.index, loaded, total)
		);
		return index.entries
			.map((entry) => createSysrootDependency(entry.runtimePath))
			.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
	}
	return [];
}

async function resolveCompileRequest(
	request: BrowserGoCompileRequest,
	manifest: NormalizedRuntimeManifest,
	runtimeBaseUrl: string | URL,
	fetchImpl: typeof fetch,
	reportAssetProgress?: (asset: string, loaded: number, total?: number) => void
) {
	const validationError = validateCompileRequest(request);
	if (validationError) {
		return {
			error: validationError
		} as const;
	}
	const normalizedFiles = normalizeCompileRequestSource(request);
	const normalizedRequest = {
		...request,
		files: normalizedFiles
	} satisfies BrowserGoCompileRequest;
	return {
		request: {
			...normalizedRequest,
			target: normalizeRequestedTarget(request),
			packageImportPath: normalizePackageImportPath(request),
			dependencies: await resolveAutoDependencies(
				manifest,
				runtimeBaseUrl,
				normalizedRequest,
				fetchImpl,
				reportAssetProgress
			)
		} satisfies BrowserGoCompileRequest
	} as const;
}

export async function compileGo(
	request: BrowserGoCompileRequest,
	options: CreateGoCompilerOptions = {}
): Promise<BrowserGoCompilerResult> {
	const dependencies = options.dependencies || {};
	const fetchImpl = dependencies.fetchImpl || createRuntimeFetch();
	const progress = createProgressEmitter(request);
	const logs = createLogBuffer(Boolean(request.log));
	const emitManifestAssetProgress = createStageAssetProgressReporter('manifest', progress, 1);
	const reportManifestAssetProgress = (loaded: number, total?: number) =>
		emitManifestAssetProgress('runtime-manifest.v1.json', loaded, total);
	const reportPlanAssetProgress = createStageAssetProgressReporter('plan', progress, 0.45);
	progress('manifest', 0, 1, 'loading runtime manifest');
	const { manifest, runtimeBaseUrl } = await resolveCompilerRuntime(options, {
		...dependencies,
		fetchImpl
	}, reportManifestAssetProgress);
	progress('manifest', 1, 1, `loaded runtime manifest for ${manifest.defaultTarget}`);
	progress('plan', 0, 1, 'resolving compile inputs');
	const resolvedRequest = await resolveCompileRequest(
		request,
		manifest,
		runtimeBaseUrl,
		fetchImpl,
		reportPlanAssetProgress
	);
	if ('error' in resolvedRequest) {
		return failure(resolvedRequest.error || 'invalid compile request', logs.records);
	}
	progress('plan', 0.5, 1, 'building compile plan');
	const plan = createBrowserGoBuildPlan(resolvedRequest.request, manifest);
	logs.push(
		`[wasm-go] plan target=${plan.target} package=${plan.packageImportPath} kind=${plan.packageKind}`
	);
	progress('plan', 1, 1, 'compile plan ready');
	const useDetailedRuntimeProgress = true;
	let compileStageExecutionFraction = 0;
	const compileStageFractions = new Map<string, number>();
	const compileStageWeights = new Map<string, number>();
	if (plan.sysrootPack) {
		compileStageFractions.set(plan.sysrootPack.index, 0);
		compileStageWeights.set(plan.sysrootPack.index, 0.04);
		compileStageFractions.set(plan.sysrootPack.asset, 0);
		compileStageWeights.set(plan.sysrootPack.asset, 0.56);
	} else if (plan.sysrootFiles?.length) {
		const sysrootWeight = 0.6 / plan.sysrootFiles.length;
		for (const entry of plan.sysrootFiles) {
			compileStageFractions.set(entry.asset, 0);
			compileStageWeights.set(entry.asset, sysrootWeight);
		}
	}
	compileStageFractions.set(plan.compile.toolAsset, 0);
	compileStageWeights.set(
		plan.compile.toolAsset,
		plan.sysrootPack || plan.sysrootFiles?.length ? 0.18 : 0.45
	);
	const compileStageExecutionWeight =
		plan.sysrootPack || plan.sysrootFiles?.length ? 0.22 : 0.55;
	const emitCompileStage = (message: string) => {
		let completed = compileStageExecutionFraction * compileStageExecutionWeight;
		for (const [asset, fraction] of compileStageFractions) {
			completed += fraction * (compileStageWeights.get(asset) || 0);
		}
		progress('compile', completed, 1, message);
	};
	const updateCompileAssetProgress = (asset: string, loaded: number, total?: number) => {
		if (!compileStageFractions.has(asset)) return;
		const fraction = total && total > 0 ? Math.min(loaded / total, 1) : loaded > 0 ? 1 : 0;
		compileStageFractions.set(asset, fraction);
		emitCompileStage(`loading ${asset.split('/').at(-1) || asset}`);
	};
	let linkStageExecutionFraction = 0;
	const linkStageFractions = new Map<string, number>();
	const linkStageWeights = new Map<string, number>();
	if (plan.link) {
		linkStageFractions.set(plan.link.toolAsset, 0);
		linkStageWeights.set(plan.link.toolAsset, 0.55);
	}
	const linkStageExecutionWeight = 0.45;
	const emitLinkStage = (message: string) => {
		let completed = linkStageExecutionFraction * linkStageExecutionWeight;
		for (const [asset, fraction] of linkStageFractions) {
			completed += fraction * (linkStageWeights.get(asset) || 0);
		}
		progress('link', completed, 1, message);
	};
	const updateLinkAssetProgress = (asset: string, loaded: number, total?: number) => {
		if (!linkStageFractions.has(asset)) return;
		const fraction = total && total > 0 ? Math.min(loaded / total, 1) : loaded > 0 ? 1 : 0;
		linkStageFractions.set(asset, fraction);
		emitLinkStage(`loading ${asset.split('/').at(-1) || asset}`);
	};
	const runTool =
		dependencies.runTool ||
		((invocation: BrowserGoToolInvocation, context?: {
			reportAssetProgress?: (asset: string, loaded: number, total?: number) => void;
		}) =>
			executeGoToolInvocation(
				invocation,
				plan,
				runtimeBaseUrl,
				fetchImpl,
				context?.reportAssetProgress
			));
	if (useDetailedRuntimeProgress) {
		emitCompileStage('preparing compile runtime');
	} else {
		progress('compile', 0, 1, 'running compile');
	}
	logs.push(`[wasm-go] compile ${plan.compile.args.join(' ')}`);
	let compileResult: BrowserGoToolResult;
	try {
		compileResult = await runTool(plan.compile, {
			reportAssetProgress: updateCompileAssetProgress
		});
	} catch (error) {
		return failure(
			error instanceof Error ? error.message : String(error),
			logs.records,
			plan
		);
	}
	const compileOutputs = normalizeToolOutputs(compileResult.outputs);
	if (useDetailedRuntimeProgress) {
		compileStageExecutionFraction = 1;
		emitCompileStage('compile finished');
	} else {
		progress('compile', 1, 1, 'compile finished');
	}
	if (compileResult.exitCode !== 0) {
		return failure(
			compileResult.stderr || 'go compile failed',
			logs.records,
			plan,
			compileResult.stdout,
			parseCompilerDiagnostics(
				collectCompilerDiagnosticText(compileResult.stderr, compileResult.stdout)
			)
		);
	}
	progress('compile', 1, 1, 'compile finished');
	let stdout = compileResult.stdout || '';
	let stderr = compileResult.stderr || '';
	if (!plan.link) {
		const archive = compileOutputs[plan.compile.outputPath];
		if (!archive) {
			return failure(
				`compile completed without producing ${plan.compile.outputPath}`,
				logs.records,
				plan,
				stdout
			);
		}
		progress('done', 1, 1, 'archive ready');
		return success(
			{
				bytes: archive,
				target: plan.target,
				format: 'go-archive'
			},
			logs.records,
			plan,
			stdout,
			stderr
		);
	}
	const compileArchive = compileOutputs[plan.compile.outputPath];
	if (!compileArchive) {
		return failure(
			`compile completed without producing ${plan.compile.outputPath}`,
			logs.records,
			plan,
			stdout
		);
	}
	if (useDetailedRuntimeProgress) {
		emitLinkStage('preparing link runtime');
	} else {
		progress('link', 0, 1, 'running link');
	}
	logs.push(`[wasm-go] link ${plan.link.args.join(' ')}`);
	const linkInputs = {
		...plan.link,
		inputFiles: [
			...plan.link.inputFiles,
			{
				path: plan.compile.outputPath,
				contents: compileArchive
			}
		]
	};
	let linkResult: BrowserGoToolResult;
	try {
		linkResult = await runTool(linkInputs, {
			reportAssetProgress: updateLinkAssetProgress
		});
	} catch (error) {
		return failure(
			error instanceof Error ? error.message : String(error),
			logs.records,
			plan,
			stdout,
			parseCompilerDiagnostics(collectCompilerDiagnosticText(stderr, stdout))
		);
	}
	const linkOutputs = normalizeToolOutputs(linkResult.outputs);
	if (useDetailedRuntimeProgress) {
		linkStageExecutionFraction = 1;
		emitLinkStage('link finished');
	} else {
		progress('link', 1, 1, 'link finished');
	}
	stdout += linkResult.stdout || '';
	stderr += linkResult.stderr || '';
	if (linkResult.exitCode !== 0) {
		return failure(
			linkResult.stderr || 'go link failed',
			logs.records,
			plan,
			stdout,
			parseCompilerDiagnostics(
				collectCompilerDiagnosticText(linkResult.stderr, linkResult.stdout)
			)
		);
	}
	progress('link', 1, 1, 'link finished');
	const linkedArtifact = linkOutputs[plan.link.outputPath];
	if (!linkedArtifact) {
		return failure(
			`link completed without producing ${plan.link.outputPath}`,
			logs.records,
			plan,
			stdout
		);
	}
	progress('done', 1, 1, 'artifact ready');
	return success(
		{
			bytes: linkedArtifact,
			wasm: linkedArtifact,
			target: plan.target,
			format: plan.artifactFormat
		},
		logs.records,
		plan,
		stdout,
		stderr
	);
}

export async function createGoCompiler(
	options: CreateGoCompilerOptions = {}
): Promise<BrowserGoCompiler> {
	return {
		plan: async (request) => {
			const fetchImpl = options.dependencies?.fetchImpl || createRuntimeFetch();
			const { manifest, runtimeBaseUrl } = await resolveCompilerRuntime(options, {
				...options.dependencies,
				fetchImpl
			});
			const resolvedRequest = await resolveCompileRequest(
				request,
				manifest,
				runtimeBaseUrl,
				fetchImpl
			);
			if ('error' in resolvedRequest) {
				throw new Error(resolvedRequest.error);
			}
			return createBrowserGoBuildPlan(resolvedRequest.request, manifest);
		},
		compile: async (request) => compileGo(request, options)
	};
}
