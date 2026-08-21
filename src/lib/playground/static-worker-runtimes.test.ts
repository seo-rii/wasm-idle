import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeJanetRuntimeFingerprint } from '../../../scripts/sync-wasm-janet.mjs';
import { computeJuliaRuntimeFingerprint } from '../../../scripts/sync-wasm-julia.mjs';
import { computeNimRuntimeFingerprint } from '../../../scripts/sync-wasm-nim.mjs';
import { computePerlRuntimeFingerprint } from '../../../scripts/sync-wasm-perl.mjs';

const workerInstances: MockWorker[] = [];
const workerBootstrapBlobs = new Map<string, Blob>();
const runtimeLifecycleEvents: string[] = [];
const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_WASM_PROLOG_BASE_URL: '',
		PUBLIC_WASM_PROLOG_WORKER_URL: '',
		PUBLIC_WASM_GLEAM_BASE_URL: '',
		PUBLIC_WASM_GLEAM_WORKER_URL: '',
		PUBLIC_WASM_GLEAM_MANIFEST_URL: '',
		PUBLIC_WASM_GLEAM_MANIFEST_FINGERPRINT: '',
		PUBLIC_WASM_GLEAM_WORKER_SHA256: '',
		PUBLIC_WASM_GLEAM_WORKER_BYTES: '',
		PUBLIC_WASM_PERL_BASE_URL: '',
		PUBLIC_WASM_PERL_WORKER_URL: '',
		PUBLIC_WASM_PERL_MANIFEST_URL: '',
		PUBLIC_WASM_PERL_MANIFEST_FINGERPRINT: '',
		PUBLIC_WASM_PERL_WORKER_SHA256: '',
		PUBLIC_WASM_PERL_WORKER_BYTES: '',
		PUBLIC_WASM_TCL_BASE_URL: '',
		PUBLIC_WASM_TCL_WORKER_URL: '',
		PUBLIC_WASM_AWK_BASE_URL: '',
		PUBLIC_WASM_AWK_WORKER_URL: '',
		PUBLIC_WASM_PASCAL_BASE_URL: '',
		PUBLIC_WASM_PASCAL_WORKER_URL: '',
		PUBLIC_WASM_CLOJURESCRIPT_BASE_URL: '',
		PUBLIC_WASM_CLOJURESCRIPT_WORKER_URL: '',
		PUBLIC_WASM_FORTH_BASE_URL: '',
		PUBLIC_WASM_FORTH_WORKER_URL: '',
		PUBLIC_WASM_J_BASE_URL: '',
		PUBLIC_WASM_J_WORKER_URL: '',
		PUBLIC_WASM_BQN_BASE_URL: '',
		PUBLIC_WASM_BQN_WORKER_URL: '',
		PUBLIC_WASM_JANET_BASE_URL: '',
		PUBLIC_WASM_JANET_WORKER_URL: '',
		PUBLIC_WASM_JANET_MANIFEST_URL: '',
		PUBLIC_WASM_JANET_MANIFEST_FINGERPRINT: '',
		PUBLIC_WASM_JANET_WORKER_SHA256: '',
		PUBLIC_WASM_JANET_WORKER_BYTES: '',
		PUBLIC_WASM_JULIA_BASE_URL: '',
		PUBLIC_WASM_JULIA_WORKER_URL: '',
		PUBLIC_WASM_JULIA_MANIFEST_URL: '',
		PUBLIC_WASM_JULIA_MANIFEST_FINGERPRINT: '',
		PUBLIC_WASM_JULIA_WORKER_SHA256: '',
		PUBLIC_WASM_JULIA_WORKER_BYTES: '',
		PUBLIC_WASM_NIM_BASE_URL: '',
		PUBLIC_WASM_NIM_WORKER_URL: ''
	}
}));
let onPostMessage: ((worker: MockWorker, message: any) => void) | null = null;
let autoStartWorkers = true;
let workerBootstrapId = 0;
const initialCrossOriginIsolation = Object.getOwnPropertyDescriptor(
	globalThis,
	'crossOriginIsolated'
);

class MockWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<any>) => void) | null = null;
	lastRunId: string | undefined;
	lastMessage: any;
	lastTransferList: Transferable[] | undefined;
	postMessage = vi.fn((message: any, transferList?: Transferable[]) => {
		this.lastTransferList = transferList;
		const deliveredMessage = transferList?.length
			? structuredClone(message, { transfer: transferList })
			: message;
		this.lastMessage = deliveredMessage;
		this.lastRunId = deliveredMessage?.runId;
		if (onPostMessage) {
			onPostMessage(this, deliveredMessage);
			return;
		}
		queueMicrotask(() =>
			this.onmessage?.({
				data: {
					runId: this.lastRunId,
					output: 'factorial_plus_bonus=27\n',
					results: true
				}
			} as MessageEvent<any>)
		);
	});
	terminate = vi.fn();

	constructor(
		public url: string,
		public options?: WorkerOptions
	) {
		runtimeLifecycleEvents.push(`worker:${url}`);
		workerInstances.push(this);
		queueMicrotask(() => {
			if (!autoStartWorkers) return;
			this.onmessage?.({
				data: { __wasmIdleStaticWorkerReady: true }
			} as MessageEvent<any>);
		});
	}
}

vi.stubGlobal('Worker', MockWorker);

vi.mock('$env/dynamic/public', () => ({
	env: publicEnv
}));

import Gleam from './gleam';
import Awk from './awk';
import Bqn from './bqn';
import ClojureScript from './clojurescript';
import Forth from './forth';
import J from './j';
import Janet from './janet';
import Julia from './julia';
import Nim from './nim';
import Perl from './perl';
import Pascal from './pascal';
import Prolog from './prolog';
import {
	STATIC_STDIN_RING_CANCELLED_INDEX,
	STATIC_STDIN_RING_CLOSED_INDEX,
	STATIC_STDIN_RING_CONTROL_SLOTS,
	STATIC_STDIN_RING_WRITE_INDEX
} from './staticStdinRing';
import {
	StaticWorkerRuntimeSandbox,
	type StaticWorkerRuntimePreflightContext
} from './staticWorkerRuntime';
import Tcl from './tcl';
import { resolvePrologRuntimeAssetConfig } from './assets';
import bqnWorkerSource from '../../../scripts/runtime-workers/wasm-bqn-runner-worker.js?raw';
import clojureScriptWorkerSource from '../../../scripts/runtime-workers/wasm-clojurescript-runner-worker.js?raw';
import forthWorkerSource from '../../../scripts/runtime-workers/wasm-forth-runner-worker.js?raw';
import gleamWorkerSource from '../../../scripts/runtime-workers/wasm-gleam-runner-worker.js?raw';
import jWorkerSource from '../../../scripts/runtime-workers/wasm-j-runner-worker.js?raw';
import janetWorkerSource from '../../../scripts/runtime-workers/wasm-janet-runner-worker.js?raw';
import juliaWorkerSource from '../../../scripts/runtime-workers/wasm-julia-runner-worker.js?raw';
import nimWorkerSource from '../../../scripts/runtime-workers/wasm-nim-runner-worker.js?raw';
import perlWorkerSource from '../../../scripts/runtime-workers/wasm-perl-runner-worker.js?raw';
import prologWorkerSource from '../../../scripts/runtime-workers/wasm-prolog-runner-worker.js?raw';
import tclWorkerSource from '../../../scripts/runtime-workers/wasm-tcl-runner-worker.js?raw';
import forthManifestSource from '../../../static/wasm-forth/runtime-manifest.v2.json?raw';
import forthRuntimeSource from '../../../static/wasm-forth/waforth.js?raw';
import juliaManifestTemplateSource from '../../../static/wasm-julia/runtime-manifest.v2.json?raw';
import nimManifestTemplateSource from '../../../static/wasm-nim/runtime-manifest.v2.json?raw';
import {
	WASM_FORTH_ASSET_VERSION,
	WASM_FORTH_RUNNER_RECEIPT,
	WASM_FORTH_RUNTIME_PROFILE
} from './wasmForthVersion';
import { WASM_BQN_RUNNER_RECEIPT } from './wasmBqnVersion';
import { WASM_CLOJURESCRIPT_RUNNER_RECEIPT } from './wasmClojureScriptVersion';
import { WASM_GLEAM_ASSET_VERSION, WASM_GLEAM_RUNNER_RECEIPT } from './wasmGleamVersion';
import { WASM_J_RUNNER_RECEIPT } from './wasmJVersion';
import { WASM_PERL_RUNNER_RECEIPT } from './wasmPerlVersion';
import {
	WASM_PROLOG_ASSET_VERSION,
	WASM_PROLOG_RUNNER_RECEIPT,
	WASM_PROLOG_RUNTIME_PROFILE
} from './wasmPrologVersion';
import {
	WASM_TCL_ASSET_VERSION,
	WASM_TCL_RUNNER_RECEIPT,
	WASM_TCL_RUNTIME_PROFILE
} from './wasmTclVersion';

const jTestManifestSource = '{"runtime":"fixture"}\n';
const jTestModuleSource = 'export default function fixtureJ() {}\n';
const jTestWasmBytes = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0]);
const jTestWasmGzipBytes = Uint8Array.from([
	31, 139, 8, 0, 0, 0, 0, 0, 2, 3, 99, 72, 44, 206, 101, 100, 96, 96, 0, 0, 206, 51, 75, 28, 8, 0,
	0, 0
]);
const jTestProfile = {
	profileId: 'jsoftware-j-playground-test',
	sourceRevision: 'fixture',
	manifestFingerprint: 'a'.repeat(64),
	manifestReceipt: {
		bytes: 22,
		sha256: '679daab93e272c0cb1dc00c569ed771259fbf49bdeb266bd5a479d4da1411bd9'
	},
	moduleReceipt: {
		bytes: 38,
		sha256: '45284c9638722e1b1b9dc73163689f8ef0a02e88c19db77b7dfee8fe2e363b85'
	},
	wasmReceipt: {
		bytes: 28,
		sha256: '2740982b148627999cd4ad3ae62440ed0c2878da70a6ea6e41f00ae06537324a',
		uncompressedBytes: 8,
		uncompressedSha256: '93a44bbb96c751218e4c00d479e4c14358122a389acca16205b1e4d0dc5f9476'
	}
} as const;

function jTestRuntimeAssets(workerUrl = '/wasm-j/runner-worker.js?v=test') {
	return {
		j: {
			baseUrl: '/wasm-j/',
			workerUrl,
			manifestUrl: '/wasm-j/runtime-manifest.v2.json',
			manifestFingerprint: jTestProfile.manifestFingerprint,
			profileId: jTestProfile.profileId,
			sourceRevision: jTestProfile.sourceRevision,
			manifestReceipt: jTestProfile.manifestReceipt,
			moduleReceipt: jTestProfile.moduleReceipt,
			wasmReceipt: jTestProfile.wasmReceipt,
			workerReceipt: WASM_J_RUNNER_RECEIPT
		}
	};
}

const bqnTestManifestSource = '{"runtime":"fixture"}\n';
const bqnTestModuleSource = 'export default function fixtureBqn() {}\n';
const bqnTestWasmBytes = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0]);
const bqnTestWasmGzipBytes = Uint8Array.from([
	31, 139, 8, 0, 0, 0, 0, 0, 2, 3, 99, 72, 44, 206, 101, 100, 96, 96, 0, 0, 206, 51, 75, 28, 8, 0,
	0, 0
]);
const bqnTestProfile = {
	profileId: 'dzaima-cbqn-test',
	sourceRevision: 'fixture',
	manifestFingerprint: 'b'.repeat(64),
	manifestReceipt: {
		bytes: 22,
		sha256: '679daab93e272c0cb1dc00c569ed771259fbf49bdeb266bd5a479d4da1411bd9'
	},
	moduleReceipt: {
		bytes: 40,
		sha256: '76bdff8ee61521bde21302957334f85cf15c36f5876ba5bb6327e0bf5ee987e0'
	},
	wasmReceipt: {
		bytes: 28,
		sha256: '2740982b148627999cd4ad3ae62440ed0c2878da70a6ea6e41f00ae06537324a',
		uncompressedBytes: 8,
		uncompressedSha256: '93a44bbb96c751218e4c00d479e4c14358122a389acca16205b1e4d0dc5f9476'
	}
} as const;

function bqnTestRuntimeAssets(workerUrl = '/wasm-bqn/runner-worker.js?v=test') {
	return {
		bqn: {
			baseUrl: '/wasm-bqn/',
			workerUrl,
			manifestUrl: '/wasm-bqn/runtime-manifest.v2.json',
			manifestFingerprint: bqnTestProfile.manifestFingerprint,
			profileId: bqnTestProfile.profileId,
			sourceRevision: bqnTestProfile.sourceRevision,
			manifestReceipt: bqnTestProfile.manifestReceipt,
			moduleReceipt: bqnTestProfile.moduleReceipt,
			wasmReceipt: bqnTestProfile.wasmReceipt,
			workerReceipt: WASM_BQN_RUNNER_RECEIPT
		}
	};
}

const clojureScriptTestManifestSource = '{"runtime":"fixture"}\n';
const clojureScriptTestCompilerBytes = Uint8Array.from(jTestWasmBytes);
const clojureScriptTestCompilerGzipBytes = Uint8Array.from(jTestWasmGzipBytes);

const prologManifestSource = readFileSync(
	resolve(process.cwd(), 'static/wasm-prolog/runtime-manifest.v2.json'),
	'utf8'
);
const prologRuntimeJavaScriptSource = readFileSync(
	resolve(process.cwd(), 'static/wasm-prolog/swipl-web.js'),
	'utf8'
);
const prologRuntimeWasmGzipBytes = Uint8Array.from(
	readFileSync(resolve(process.cwd(), 'static/wasm-prolog/swipl-web.wasm.gz.bin'))
);
const prologRuntimeDataGzipBytes = Uint8Array.from(
	readFileSync(resolve(process.cwd(), 'static/wasm-prolog/swipl-web.data.gz.bin'))
);
const tclManifestSource = readFileSync(
	resolve(process.cwd(), 'static/wasm-tcl/runtime-manifest.v2.json'),
	'utf8'
);
const tclRequireJsSource = readFileSync(
	resolve(process.cwd(), 'static/wasm-tcl/require.js'),
	'utf8'
);
const tclCustomDataBytes = Uint8Array.from(
	readFileSync(resolve(process.cwd(), 'static/wasm-tcl/tcl/wacl-custom.data.bin'))
);
const tclLibraryDataGzipBytes = Uint8Array.from(
	readFileSync(resolve(process.cwd(), 'static/wasm-tcl/tcl/wacl-library.data.gz.bin'))
);
const tclGlueSource = readFileSync(resolve(process.cwd(), 'static/wasm-tcl/tcl/wacl.js'), 'utf8');
const tclWasmGzipBytes = Uint8Array.from(
	readFileSync(resolve(process.cwd(), 'static/wasm-tcl/tcl/wacl.wasm.gz.bin'))
);
const perlTestSha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const perlTestArtifactRevision = '6f2173d29a2c2e3536e1de75ff5d291ae96ab348';
const perlTestWebperlRevision = perlTestArtifactRevision;
const perlTestPerlRevision = 'e70d909feb796ec99d5e91de5d1635d4526ec131';
const perlTestEmscriptenRevision = '69ab40586822209758165df170e9fc8b81e05608';
const perlTestJavaScriptBytes = new TextEncoder().encode(
	'var Module=typeof Module!=="undefined"?Module:{};Module["getPreloadedPackage"];Module["wasmBinary"];'
);
const perlTestWasmBytes = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
const perlTestDataBytes = new TextEncoder().encode('fixture WebPerl data');
const perlTestJavaScriptGzipBytes = Uint8Array.from(gzipSync(perlTestJavaScriptBytes));
const perlTestWasmGzipBytes = Uint8Array.from(gzipSync(perlTestWasmBytes));
const perlTestDataGzipBytes = Uint8Array.from(gzipSync(perlTestDataBytes));
const perlTestManifestWithoutFingerprint = {
	format: 'wasm-perl-runtime-manifest-v2',
	runtime: 'webperl',
	profileId: 'webperl-v0.09-beta-perl-5.28.1-emscripten-1.38.28',
	licenseExpression: 'Artistic-1.0-Perl OR GPL-1.0-or-later',
	artifact: {
		kind: 'opaque-prebuilt',
		repository: 'https://github.com/haukex/webperl.git',
		revision: perlTestArtifactRevision,
		tag: 'v0.09-beta',
		doi: '10.5281/zenodo.2582586',
		path: 'webperl_prebuilt_v0.09-beta.zip',
		url: 'https://zenodo.org/api/records/2582586/files/webperl_prebuilt_v0.09-beta.zip/content',
		size: 3_936_557,
		sha256: '5f441249217e90ab378c666f473d4206ab4f44907f6bb0aa8d70834bc38c40dc'
	},
	components: {
		webperl: {
			version: 'v0.09-beta',
			repository: 'https://github.com/haukex/webperl.git',
			revision: perlTestWebperlRevision,
			verifiedBuildInput: false,
			evidence: 'release tag and opaque prebuilt archive'
		},
		perl: {
			version: '5.28.1',
			repository: 'https://github.com/haukex/emperl5.git',
			revision: perlTestPerlRevision,
			verifiedBuildInput: false,
			evidence: 'embedded runtime version string and versioned WebPerl build configuration'
		},
		emscripten: {
			version: '1.38.28',
			repository: 'https://github.com/emscripten-core/emscripten.git',
			revision: perlTestEmscriptenRevision,
			verifiedBuildInput: false,
			evidence: 'versioned WebPerl build configuration'
		},
		cpanExtensions: {
			modules: ['Cpanel::JSON::XS', 'Devel::StackTrace', 'Future'],
			verifiedBuildInput: false,
			evidence: 'versioned WebPerl build configuration without transitive artifact locks'
		}
	},
	licenses: [
		{
			path: 'licenses/LICENSE_artistic.txt',
			spdx: 'Artistic-1.0-Perl',
			size: 1,
			sha256: perlTestSha256(new TextEncoder().encode('a'))
		},
		{
			path: 'licenses/LICENSE_gpl.txt',
			spdx: 'GPL-1.0-or-later',
			size: 1,
			sha256: perlTestSha256(new TextEncoder().encode('g'))
		}
	],
	metadata: {
		path: 'runtime-build.json',
		mediaType: 'application/json',
		size: 2,
		sha256: perlTestSha256(new TextEncoder().encode('{}'))
	},
	assets: [
		{
			path: 'emperl.js',
			mediaType: 'text/javascript',
			size: perlTestJavaScriptBytes.byteLength,
			sha256: perlTestSha256(perlTestJavaScriptBytes)
		},
		{
			path: 'emperl.wasm',
			mediaType: 'application/wasm',
			size: perlTestWasmBytes.byteLength,
			sha256: perlTestSha256(perlTestWasmBytes)
		},
		{
			path: 'emperl.data',
			mediaType: 'application/octet-stream',
			size: perlTestDataBytes.byteLength,
			sha256: perlTestSha256(perlTestDataBytes)
		}
	],
	storage: [
		{
			path: 'emperl.js.gz.bin',
			logicalPath: 'emperl.js',
			encoding: 'gzip' as const,
			size: perlTestJavaScriptGzipBytes.byteLength,
			sha256: perlTestSha256(perlTestJavaScriptGzipBytes)
		},
		{
			path: 'emperl.wasm.gz.bin',
			logicalPath: 'emperl.wasm',
			encoding: 'gzip' as const,
			size: perlTestWasmGzipBytes.byteLength,
			sha256: perlTestSha256(perlTestWasmGzipBytes)
		},
		{
			path: 'emperl.data.gz.bin',
			logicalPath: 'emperl.data',
			encoding: 'gzip' as const,
			size: perlTestDataGzipBytes.byteLength,
			sha256: perlTestSha256(perlTestDataGzipBytes)
		}
	]
};
const perlTestManifestFingerprint = computePerlRuntimeFingerprint(
	perlTestManifestWithoutFingerprint
);
const perlTestManifestSource = JSON.stringify({
	...perlTestManifestWithoutFingerprint,
	fingerprint: perlTestManifestFingerprint
});
const perlTestManifestBytes = new TextEncoder().encode(perlTestManifestSource);
const perlTestProfile = {
	profileId: perlTestManifestWithoutFingerprint.profileId,
	artifactRevision: perlTestArtifactRevision,
	webperlRevision: perlTestWebperlRevision,
	perlRevision: perlTestPerlRevision,
	emscriptenRevision: perlTestEmscriptenRevision,
	manifestFingerprint: perlTestManifestFingerprint,
	manifestReceipt: {
		bytes: perlTestManifestBytes.byteLength,
		sha256: perlTestSha256(perlTestManifestBytes)
	},
	javascriptReceipt: {
		bytes: perlTestJavaScriptGzipBytes.byteLength,
		sha256: perlTestSha256(perlTestJavaScriptGzipBytes),
		uncompressedBytes: perlTestJavaScriptBytes.byteLength,
		uncompressedSha256: perlTestSha256(perlTestJavaScriptBytes)
	},
	wasmReceipt: {
		bytes: perlTestWasmGzipBytes.byteLength,
		sha256: perlTestSha256(perlTestWasmGzipBytes),
		uncompressedBytes: perlTestWasmBytes.byteLength,
		uncompressedSha256: perlTestSha256(perlTestWasmBytes)
	},
	dataReceipt: {
		bytes: perlTestDataGzipBytes.byteLength,
		sha256: perlTestSha256(perlTestDataGzipBytes),
		uncompressedBytes: perlTestDataBytes.byteLength,
		uncompressedSha256: perlTestSha256(perlTestDataBytes)
	}
} as const;
const janetTestSha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const janetTestArtifactRevision = 'd647850cd6448b457f778d01c304358aefa5244b';
const janetTestVersion = '1.41.3-dev';
const janetTestEmscriptenVersion = '3.1.8';
const janetTestJavaScriptBytes = new TextEncoder().encode(
	'const Module = {}; Module["wasmBinary"]; Module.FS.init; Module.callMain; export default Module;'
);
const janetTestWasmBytes = Uint8Array.from([
	0,
	97,
	115,
	109,
	1,
	0,
	0,
	0,
	...new TextEncoder().encode(janetTestVersion)
]);
const janetTestWasmGzipBytes = Uint8Array.from(gzipSync(janetTestWasmBytes));
const janetTestManifestWithoutFingerprint = {
	format: 'wasm-janet-runtime-manifest-v2',
	runtime: 'janet-lang-janet',
	profileId: 'janet-1.41.3-dev-emscripten-3.1.8-wasm-idle-d647850c',
	licenseExpression: 'MIT',
	artifact: {
		kind: 'opaque-vendored',
		repository: 'https://github.com/seo-rii/wasm-idle.git',
		revision: janetTestArtifactRevision,
		path: 'static/wasm-janet',
		provenance: 'legacy-import-unrecorded',
		verifiedBuildInput: false
	},
	components: {
		janet: {
			version: janetTestVersion,
			repository: 'https://github.com/janet-lang/janet.git',
			revision: 'unrecorded',
			verifiedBuildInput: false,
			evidence: 'embedded runtime version string'
		},
		emscripten: {
			version: janetTestEmscriptenVersion,
			repository: 'https://github.com/emscripten-core/emscripten.git',
			revision: 'unrecorded',
			verifiedBuildInput: false,
			evidence: 'unverified metadata copied from the initial vendored runtime manifest'
		}
	},
	build: {
		options: [
			'ENVIRONMENT=worker',
			'MODULARIZE=1',
			'EXPORT_ES6=1',
			'FORCE_FILESYSTEM=1',
			'INVOKE_RUN=0',
			'EXIT_RUNTIME=1',
			'JANET_REDUCED_OS'
		],
		runner: {
			path: 'scripts/runtime-build/wasm-janet-runner.c',
			verifiedBuildInput: false,
			bytes: 1378,
			sha256: '1a2f357f16e250ed64260a77bd11435837ae033647fb23166eb924a42b4036ee'
		}
	},
	license: {
		path: 'LICENSE.txt',
		spdx: 'MIT',
		size: 1,
		sha256: janetTestSha256(new TextEncoder().encode('l'))
	},
	metadata: {
		path: 'runtime-build.json',
		mediaType: 'application/json',
		size: 2,
		sha256: janetTestSha256(new TextEncoder().encode('{}'))
	},
	assets: [
		{
			path: 'janet.js',
			mediaType: 'text/javascript',
			size: janetTestJavaScriptBytes.byteLength,
			sha256: janetTestSha256(janetTestJavaScriptBytes)
		},
		{
			path: 'janet.wasm',
			mediaType: 'application/wasm',
			size: janetTestWasmBytes.byteLength,
			sha256: janetTestSha256(janetTestWasmBytes)
		}
	],
	storage: [
		{
			path: 'janet.js',
			logicalPath: 'janet.js',
			encoding: 'identity' as const,
			size: janetTestJavaScriptBytes.byteLength,
			sha256: janetTestSha256(janetTestJavaScriptBytes)
		},
		{
			path: 'janet.wasm.gz.bin',
			logicalPath: 'janet.wasm',
			encoding: 'gzip' as const,
			size: janetTestWasmGzipBytes.byteLength,
			sha256: janetTestSha256(janetTestWasmGzipBytes)
		}
	]
};
const janetTestManifestFingerprint = computeJanetRuntimeFingerprint(
	janetTestManifestWithoutFingerprint
);
const janetTestManifestSource = JSON.stringify({
	...janetTestManifestWithoutFingerprint,
	fingerprint: janetTestManifestFingerprint
});
const janetTestManifestBytes = new TextEncoder().encode(janetTestManifestSource);
const janetTestProfile = {
	profileId: janetTestManifestWithoutFingerprint.profileId,
	artifactRevision: janetTestArtifactRevision,
	janetVersion: janetTestVersion,
	emscriptenVersion: janetTestEmscriptenVersion,
	manifestFingerprint: janetTestManifestFingerprint,
	manifestReceipt: {
		bytes: janetTestManifestBytes.byteLength,
		sha256: janetTestSha256(janetTestManifestBytes)
	},
	javascriptReceipt: {
		bytes: janetTestJavaScriptBytes.byteLength,
		sha256: janetTestSha256(janetTestJavaScriptBytes)
	},
	wasmReceipt: {
		bytes: janetTestWasmGzipBytes.byteLength,
		sha256: janetTestSha256(janetTestWasmGzipBytes),
		uncompressedBytes: janetTestWasmBytes.byteLength,
		uncompressedSha256: janetTestSha256(janetTestWasmBytes)
	}
} as const;
const janetTestWorkerReceipt = {
	bytes: new TextEncoder().encode(janetWorkerSource).byteLength,
	sha256: janetTestSha256(new TextEncoder().encode(janetWorkerSource))
} as const;
const juliaTestSha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const juliaTestManifestTemplate = JSON.parse(juliaManifestTemplateSource);
const juliaTestJavaScriptBytes = new TextEncoder().encode(
	'WebAssembly.instantiate; getPreloadedPackage; "julia-wasm/julia.wasm"; "/npm/@chriskoch/julia-wasm/julia.data"; _jl_eval_string;'
);
const juliaTestWasmBytes = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0]);
const juliaTestDataBytes = new TextEncoder().encode('verified julia data fixture');
const juliaTestJavaScriptGzipBytes = Uint8Array.from(gzipSync(juliaTestJavaScriptBytes));
const juliaTestWasmGzipBytes = Uint8Array.from(gzipSync(juliaTestWasmBytes));
const juliaTestDataGzipBytes = Uint8Array.from(gzipSync(juliaTestDataBytes));
const juliaTestManifestWithoutFingerprint = {
	...juliaTestManifestTemplate,
	assets: [
		{
			path: 'julia.data',
			mediaType: 'application/octet-stream',
			size: juliaTestDataBytes.byteLength,
			sha256: juliaTestSha256(juliaTestDataBytes)
		},
		{
			path: 'julia.js',
			mediaType: 'text/javascript',
			size: juliaTestJavaScriptBytes.byteLength,
			sha256: juliaTestSha256(juliaTestJavaScriptBytes)
		},
		{
			path: 'julia.wasm',
			mediaType: 'application/wasm',
			size: juliaTestWasmBytes.byteLength,
			sha256: juliaTestSha256(juliaTestWasmBytes)
		}
	],
	storage: [
		{
			path: 'julia.data.gz.bin',
			logicalPath: 'julia.data',
			encoding: 'gzip',
			size: juliaTestDataGzipBytes.byteLength,
			sha256: juliaTestSha256(juliaTestDataGzipBytes)
		},
		{
			path: 'julia.js.gz.bin',
			logicalPath: 'julia.js',
			encoding: 'gzip',
			size: juliaTestJavaScriptGzipBytes.byteLength,
			sha256: juliaTestSha256(juliaTestJavaScriptGzipBytes)
		},
		{
			path: 'julia.wasm.gz.bin',
			logicalPath: 'julia.wasm',
			encoding: 'gzip',
			size: juliaTestWasmGzipBytes.byteLength,
			sha256: juliaTestSha256(juliaTestWasmGzipBytes)
		}
	]
};
const juliaTestManifestFingerprint = computeJuliaRuntimeFingerprint(
	juliaTestManifestWithoutFingerprint
);
const juliaTestManifestSource = JSON.stringify({
	...juliaTestManifestWithoutFingerprint,
	fingerprint: juliaTestManifestFingerprint
});
const juliaTestManifestBytes = new TextEncoder().encode(juliaTestManifestSource);
const juliaTestProfile = {
	profileId: juliaTestManifestWithoutFingerprint.profileId,
	packageRevision: juliaTestManifestWithoutFingerprint.artifact.npmShasum,
	importedByCommit: juliaTestManifestWithoutFingerprint.artifact.importedByCommit,
	juliaVersion: juliaTestManifestWithoutFingerprint.components.julia.version,
	emscriptenVersion: juliaTestManifestWithoutFingerprint.components.emscripten.version,
	manifestFingerprint: juliaTestManifestFingerprint,
	manifestReceipt: {
		bytes: juliaTestManifestBytes.byteLength,
		sha256: juliaTestSha256(juliaTestManifestBytes)
	},
	javascriptReceipt: {
		bytes: juliaTestJavaScriptGzipBytes.byteLength,
		sha256: juliaTestSha256(juliaTestJavaScriptGzipBytes),
		uncompressedBytes: juliaTestJavaScriptBytes.byteLength,
		uncompressedSha256: juliaTestSha256(juliaTestJavaScriptBytes)
	},
	wasmReceipt: {
		bytes: juliaTestWasmGzipBytes.byteLength,
		sha256: juliaTestSha256(juliaTestWasmGzipBytes),
		uncompressedBytes: juliaTestWasmBytes.byteLength,
		uncompressedSha256: juliaTestSha256(juliaTestWasmBytes)
	},
	dataReceipt: {
		bytes: juliaTestDataGzipBytes.byteLength,
		sha256: juliaTestSha256(juliaTestDataGzipBytes),
		uncompressedBytes: juliaTestDataBytes.byteLength,
		uncompressedSha256: juliaTestSha256(juliaTestDataBytes)
	}
} as const;
const juliaTestWorkerReceipt = {
	bytes: new TextEncoder().encode(juliaWorkerSource).byteLength,
	sha256: juliaTestSha256(new TextEncoder().encode(juliaWorkerSource))
} as const;

function juliaTestRuntimeAssets(workerUrl = '/wasm-julia/runner-worker.js?v=test') {
	return {
		julia: {
			baseUrl: '/wasm-julia/',
			workerUrl,
			manifestUrl: `/wasm-julia/runtime-manifest.v2.json?v=${juliaTestManifestFingerprint}`,
			...juliaTestProfile,
			workerReceipt: juliaTestWorkerReceipt
		}
	};
}
const nimTestSha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const nimTestManifestTemplate = JSON.parse(nimManifestTemplateSource);
const nimTestWasmBytes = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0]);
const nimTestSysrootBytes = new Uint8Array(512);
nimTestSysrootBytes.set(new TextEncoder().encode('ustar'), 257);
const nimTestLogicalBytes: Readonly<Record<string, Uint8Array>> = Object.freeze({
	'nim/nim-bundle.js': new TextEncoder().encode('__NIM_USER_CODE__; callMain();\n'),
	'nim/nim.wasm': nimTestWasmBytes,
	'nim/nimbase.h': new TextEncoder().encode('#define NIM_INTBITS 32\n'),
	'clang/clang.js': new TextEncoder().encode(
		'const fixture="payload:{port:c,assets:l} async function p({assets:l}) compile-each-link-done";\n'
	),
	'clang/clang.wasm': nimTestWasmBytes,
	'clang/lld.wasm': nimTestWasmBytes,
	'clang/memfs.wasm': nimTestWasmBytes,
	'clang/sysroot.tar': nimTestSysrootBytes
});
const nimTestStorageBytes: Readonly<Record<string, Uint8Array>> = Object.freeze(
	Object.fromEntries(
		nimTestManifestTemplate.storage.map(
			(storage: { encoding: string; logicalPath: string; path: string }) => {
				const logicalBytes = nimTestLogicalBytes[storage.logicalPath]!;
				return [
					storage.path,
					storage.encoding === 'gzip'
						? Uint8Array.from(gzipSync(logicalBytes))
						: Uint8Array.from(logicalBytes)
				];
			}
		)
	)
);
const nimTestManifestWithoutFingerprint = {
	...nimTestManifestTemplate,
	assets: nimTestManifestTemplate.assets.map((asset: { mediaType: string; path: string }) => ({
		...asset,
		size: nimTestLogicalBytes[asset.path]!.byteLength,
		sha256: nimTestSha256(nimTestLogicalBytes[asset.path]!)
	})),
	storage: nimTestManifestTemplate.storage.map(
		(storage: { encoding: string; logicalPath: string; path: string }) => ({
			...storage,
			size: nimTestStorageBytes[storage.path]!.byteLength,
			sha256: nimTestSha256(nimTestStorageBytes[storage.path]!)
		})
	)
};
const nimTestManifestFingerprint = computeNimRuntimeFingerprint(nimTestManifestWithoutFingerprint);
const nimTestManifestSource = JSON.stringify({
	...nimTestManifestWithoutFingerprint,
	fingerprint: nimTestManifestFingerprint
});
const nimTestManifestBytes = new TextEncoder().encode(nimTestManifestSource);
const nimTestStorageByLogicalPath = new Map<
	string,
	{ encoding: string; logicalPath: string; path: string }
>(
	nimTestManifestWithoutFingerprint.storage.map(
		(storage: { encoding: string; logicalPath: string; path: string }) => [
			storage.logicalPath,
			storage
		]
	)
);
const nimTestReceipt = (logicalPath: string) => {
	const logicalBytes = nimTestLogicalBytes[logicalPath]!;
	const storage = nimTestStorageByLogicalPath.get(logicalPath)!;
	const deliveryBytes = nimTestStorageBytes[storage.path]!;
	return storage.encoding === 'gzip'
		? {
				bytes: deliveryBytes.byteLength,
				sha256: nimTestSha256(deliveryBytes),
				uncompressedBytes: logicalBytes.byteLength,
				uncompressedSha256: nimTestSha256(logicalBytes)
			}
		: { bytes: deliveryBytes.byteLength, sha256: nimTestSha256(deliveryBytes) };
};
const nimTestProfile = {
	profileId: nimTestManifestWithoutFingerprint.profileId,
	artifactRevision: nimTestManifestWithoutFingerprint.artifact.revision,
	nimRevision: nimTestManifestWithoutFingerprint.components.nim.revision,
	llvmRevision: nimTestManifestWithoutFingerprint.components.llvm.revision,
	memfsRevision: nimTestManifestWithoutFingerprint.components.memfs.revision,
	emscriptenRevision: nimTestManifestWithoutFingerprint.components.emscripten.revision,
	manifestFingerprint: nimTestManifestFingerprint,
	manifestReceipt: {
		bytes: nimTestManifestBytes.byteLength,
		sha256: nimTestSha256(nimTestManifestBytes)
	},
	nimJavaScriptReceipt: nimTestReceipt('nim/nim-bundle.js'),
	nimWasmReceipt: nimTestReceipt('nim/nim.wasm'),
	nimbaseReceipt: nimTestReceipt('nim/nimbase.h'),
	clangJavaScriptReceipt: nimTestReceipt('clang/clang.js'),
	clangWasmReceipt: nimTestReceipt('clang/clang.wasm'),
	lldWasmReceipt: nimTestReceipt('clang/lld.wasm'),
	memfsWasmReceipt: nimTestReceipt('clang/memfs.wasm'),
	sysrootReceipt: nimTestReceipt('clang/sysroot.tar')
} as const;
const nimTestWorkerReceipt = {
	bytes: new TextEncoder().encode(nimWorkerSource).byteLength,
	sha256: nimTestSha256(new TextEncoder().encode(nimWorkerSource))
} as const;

function nimTestRuntimeAssets(workerUrl = '/wasm-nim/runner-worker.js?v=test') {
	return {
		nim: {
			baseUrl: '/wasm-nim/',
			workerUrl,
			manifestUrl: `/wasm-nim/runtime-manifest.v2.json?v=${nimTestManifestFingerprint}`,
			...nimTestProfile,
			workerReceipt: nimTestWorkerReceipt
		}
	};
}
const clojureScriptTestProfile = {
	profileId: 'clojurescript-1.12.134-test',
	sourceRevision: 'r1.12.134',
	integrationRevision: 'c'.repeat(40),
	manifestFingerprint: 'd'.repeat(64),
	manifestReceipt: {
		bytes: 22,
		sha256: '679daab93e272c0cb1dc00c569ed771259fbf49bdeb266bd5a479d4da1411bd9'
	},
	compilerReceipt: {
		bytes: 28,
		sha256: '2740982b148627999cd4ad3ae62440ed0c2878da70a6ea6e41f00ae06537324a',
		uncompressedBytes: 8,
		uncompressedSha256: '93a44bbb96c751218e4c00d479e4c14358122a389acca16205b1e4d0dc5f9476'
	}
} as const;

function clojureScriptTestRuntimeAssets(workerUrl = '/wasm-clojurescript/runner-worker.js?v=test') {
	return {
		clojurescript: {
			baseUrl: '/wasm-clojurescript/',
			workerUrl,
			manifestUrl: '/wasm-clojurescript/runtime-manifest.v2.json',
			manifestFingerprint: clojureScriptTestProfile.manifestFingerprint,
			profileId: clojureScriptTestProfile.profileId,
			sourceRevision: clojureScriptTestProfile.sourceRevision,
			integrationRevision: clojureScriptTestProfile.integrationRevision,
			manifestReceipt: clojureScriptTestProfile.manifestReceipt,
			compilerReceipt: clojureScriptTestProfile.compilerReceipt,
			workerReceipt: WASM_CLOJURESCRIPT_RUNNER_RECEIPT
		}
	};
}

function createStaticWorkerFetchResponse(input: RequestInfo | URL) {
	const inputUrl = String(input);
	runtimeLifecycleEvents.push(`fetch:${inputUrl}`);
	if (inputUrl.includes('/wasm-perl/runtime-manifest.v2.json')) {
		return new Response(perlTestManifestSource, {
			status: 200,
			headers: {
				'content-length': String(perlTestManifestBytes.byteLength),
				'content-type': 'application/json'
			}
		});
	}
	if (inputUrl.includes('/wasm-perl/emperl.js.gz.bin')) {
		return new Response(Uint8Array.from(perlTestJavaScriptGzipBytes), {
			status: 200,
			headers: {
				'content-length': String(perlTestJavaScriptGzipBytes.byteLength),
				'content-type': 'application/octet-stream'
			}
		});
	}
	if (inputUrl.includes('/wasm-perl/emperl.wasm.gz.bin')) {
		return new Response(Uint8Array.from(perlTestWasmGzipBytes), {
			status: 200,
			headers: {
				'content-length': String(perlTestWasmGzipBytes.byteLength),
				'content-type': 'application/octet-stream'
			}
		});
	}
	if (inputUrl.includes('/wasm-perl/emperl.data.gz.bin')) {
		return new Response(Uint8Array.from(perlTestDataGzipBytes), {
			status: 200,
			headers: {
				'content-length': String(perlTestDataGzipBytes.byteLength),
				'content-type': 'application/octet-stream'
			}
		});
	}
	if (inputUrl.includes('/wasm-janet/runtime-manifest.v2.json')) {
		return new Response(janetTestManifestSource, {
			status: 200,
			headers: {
				'content-length': String(janetTestManifestBytes.byteLength),
				'content-type': 'application/json'
			}
		});
	}
	if (inputUrl.includes('/wasm-janet/janet.js')) {
		return new Response(Uint8Array.from(janetTestJavaScriptBytes), {
			status: 200,
			headers: {
				'content-length': String(janetTestJavaScriptBytes.byteLength),
				'content-type': 'text/javascript'
			}
		});
	}
	if (inputUrl.includes('/wasm-janet/janet.wasm.gz.bin')) {
		return new Response(Uint8Array.from(janetTestWasmGzipBytes), {
			status: 200,
			headers: {
				'content-length': String(janetTestWasmGzipBytes.byteLength),
				'content-type': 'application/octet-stream'
			}
		});
	}
	if (inputUrl.includes('/wasm-julia/runtime-manifest.v2.json')) {
		return new Response(juliaTestManifestSource, {
			status: 200,
			headers: {
				'content-length': String(juliaTestManifestBytes.byteLength),
				'content-type': 'application/json'
			}
		});
	}
	if (inputUrl.includes('/wasm-julia/julia.js.gz.bin')) {
		return new Response(Uint8Array.from(juliaTestJavaScriptGzipBytes), {
			status: 200,
			headers: {
				'content-length': String(juliaTestJavaScriptGzipBytes.byteLength),
				'content-type': 'application/octet-stream'
			}
		});
	}
	if (inputUrl.includes('/wasm-julia/julia.wasm.gz.bin')) {
		return new Response(Uint8Array.from(juliaTestWasmGzipBytes), {
			status: 200,
			headers: {
				'content-length': String(juliaTestWasmGzipBytes.byteLength),
				'content-type': 'application/octet-stream'
			}
		});
	}
	if (inputUrl.includes('/wasm-julia/julia.data.gz.bin')) {
		return new Response(Uint8Array.from(juliaTestDataGzipBytes), {
			status: 200,
			headers: {
				'content-length': String(juliaTestDataGzipBytes.byteLength),
				'content-type': 'application/octet-stream'
			}
		});
	}
	if (inputUrl.includes('/wasm-nim/runtime-manifest.v2.json')) {
		return new Response(nimTestManifestSource, {
			status: 200,
			headers: {
				'content-length': String(nimTestManifestBytes.byteLength),
				'content-type': 'application/json'
			}
		});
	}
	for (const [path, bytes] of Object.entries(nimTestStorageBytes)) {
		if (inputUrl.includes(`/wasm-nim/${path}`)) {
			return new Response(Uint8Array.from(bytes), {
				status: 200,
				headers: {
					'content-length': String(bytes.byteLength),
					'content-type': 'application/octet-stream'
				}
			});
		}
	}
	if (inputUrl.includes('/wasm-prolog/runtime-manifest.v2.json')) {
		return new Response(prologManifestSource, {
			status: 200,
			headers: {
				'content-length': String(new TextEncoder().encode(prologManifestSource).byteLength),
				'content-type': 'application/json'
			}
		});
	}
	if (inputUrl.includes('/wasm-prolog/swipl-web.js')) {
		return new Response(prologRuntimeJavaScriptSource, {
			status: 200,
			headers: {
				'content-length': String(
					new TextEncoder().encode(prologRuntimeJavaScriptSource).byteLength
				),
				'content-type': 'text/javascript'
			}
		});
	}
	if (inputUrl.includes('/wasm-prolog/swipl-web.wasm.gz.bin')) {
		return new Response(Uint8Array.from(prologRuntimeWasmGzipBytes), {
			status: 200,
			headers: {
				'content-length': String(prologRuntimeWasmGzipBytes.byteLength),
				'content-type': 'application/octet-stream'
			}
		});
	}
	if (inputUrl.includes('/wasm-prolog/swipl-web.data.gz.bin')) {
		return new Response(Uint8Array.from(prologRuntimeDataGzipBytes), {
			status: 200,
			headers: {
				'content-length': String(prologRuntimeDataGzipBytes.byteLength),
				'content-type': 'application/octet-stream'
			}
		});
	}
	if (inputUrl.includes('/wasm-tcl/runtime-manifest.v2.json')) {
		return new Response(tclManifestSource, {
			status: 200,
			headers: {
				'content-length': String(new TextEncoder().encode(tclManifestSource).byteLength),
				'content-type': 'application/json'
			}
		});
	}
	if (inputUrl.includes('/wasm-tcl/require.js')) {
		return new Response(tclRequireJsSource, {
			status: 200,
			headers: {
				'content-length': String(new TextEncoder().encode(tclRequireJsSource).byteLength),
				'content-type': 'text/javascript'
			}
		});
	}
	if (inputUrl.includes('/wasm-tcl/tcl/wacl-custom.data.bin')) {
		return new Response(Uint8Array.from(tclCustomDataBytes), {
			status: 200,
			headers: {
				'content-length': String(tclCustomDataBytes.byteLength),
				'content-type': 'application/octet-stream'
			}
		});
	}
	if (inputUrl.includes('/wasm-tcl/tcl/wacl-library.data.gz.bin')) {
		return new Response(Uint8Array.from(tclLibraryDataGzipBytes), {
			status: 200,
			headers: {
				'content-length': String(tclLibraryDataGzipBytes.byteLength),
				'content-type': 'application/octet-stream'
			}
		});
	}
	if (inputUrl.includes('/wasm-tcl/tcl/wacl.js')) {
		return new Response(tclGlueSource, {
			status: 200,
			headers: {
				'content-length': String(new TextEncoder().encode(tclGlueSource).byteLength),
				'content-type': 'text/javascript'
			}
		});
	}
	if (inputUrl.includes('/wasm-tcl/tcl/wacl.wasm.gz.bin')) {
		return new Response(Uint8Array.from(tclWasmGzipBytes), {
			status: 200,
			headers: {
				'content-length': String(tclWasmGzipBytes.byteLength),
				'content-type': 'application/octet-stream'
			}
		});
	}
	if (inputUrl.includes('/wasm-forth/runtime-manifest.v2.json')) {
		return new Response(forthManifestSource, {
			status: 200,
			headers: {
				'content-length': String(new TextEncoder().encode(forthManifestSource).byteLength),
				'content-type': 'application/json'
			}
		});
	}
	if (inputUrl.includes('/wasm-forth/waforth.js')) {
		return new Response(forthRuntimeSource, {
			status: 200,
			headers: {
				'content-length': String(new TextEncoder().encode(forthRuntimeSource).byteLength),
				'content-type': 'text/javascript'
			}
		});
	}
	if (inputUrl.includes('/wasm-j/runtime-manifest.v2.json')) {
		return new Response(jTestManifestSource, {
			status: 200,
			headers: {
				'content-length': String(new TextEncoder().encode(jTestManifestSource).byteLength),
				'content-type': 'application/json'
			}
		});
	}
	if (inputUrl.includes('/wasm-j/jamalgam.js')) {
		return new Response(jTestModuleSource, {
			status: 200,
			headers: {
				'content-length': String(new TextEncoder().encode(jTestModuleSource).byteLength),
				'content-type': 'application/javascript'
			}
		});
	}
	if (inputUrl.includes('/wasm-j/jamalgam.wasm.gz.bin')) {
		return new Response(Uint8Array.from(jTestWasmGzipBytes), {
			status: 200,
			headers: {
				'content-length': String(jTestWasmGzipBytes.byteLength),
				'content-type': 'application/gzip'
			}
		});
	}
	if (inputUrl.includes('/wasm-bqn/runtime-manifest.v2.json')) {
		return new Response(bqnTestManifestSource, {
			status: 200,
			headers: {
				'content-length': String(
					new TextEncoder().encode(bqnTestManifestSource).byteLength
				),
				'content-type': 'application/json'
			}
		});
	}
	if (inputUrl.includes('/wasm-bqn/BQN.js')) {
		return new Response(bqnTestModuleSource, {
			status: 200,
			headers: {
				'content-length': String(new TextEncoder().encode(bqnTestModuleSource).byteLength),
				'content-type': 'application/javascript'
			}
		});
	}
	if (inputUrl.includes('/wasm-bqn/BQN.wasm.gz.bin')) {
		return new Response(Uint8Array.from(bqnTestWasmGzipBytes), {
			status: 200,
			headers: {
				'content-length': String(bqnTestWasmGzipBytes.byteLength),
				'content-type': 'application/gzip'
			}
		});
	}
	if (inputUrl.includes('/wasm-clojurescript/runtime-manifest.v2.json')) {
		return new Response(clojureScriptTestManifestSource, {
			status: 200,
			headers: {
				'content-length': String(
					new TextEncoder().encode(clojureScriptTestManifestSource).byteLength
				),
				'content-type': 'application/json'
			}
		});
	}
	if (inputUrl.includes('/wasm-clojurescript/compiler.js.gz.bin')) {
		return new Response(Uint8Array.from(clojureScriptTestCompilerGzipBytes), {
			status: 200,
			headers: {
				'content-length': String(clojureScriptTestCompilerGzipBytes.byteLength),
				'content-type': 'application/octet-stream'
			}
		});
	}
	const source = inputUrl.includes('/wasm-prolog/runner-worker.js')
		? prologWorkerSource
		: inputUrl.includes('/wasm-gleam/runner-worker.js')
			? gleamWorkerSource
			: inputUrl.includes('/wasm-forth/runner-worker.js')
				? forthWorkerSource
				: inputUrl.includes('/wasm-j/runner-worker.js')
					? jWorkerSource
					: inputUrl.includes('/wasm-bqn/runner-worker.js')
						? bqnWorkerSource
						: inputUrl.includes('/wasm-clojurescript/runner-worker.js')
							? clojureScriptWorkerSource
							: inputUrl.includes('/wasm-janet/runner-worker.js')
								? janetWorkerSource
								: inputUrl.includes('/wasm-julia/runner-worker.js')
									? juliaWorkerSource
									: inputUrl.includes('/wasm-nim/runner-worker.js')
										? nimWorkerSource
										: inputUrl.includes('/wasm-perl/runner-worker.js')
											? perlWorkerSource
											: inputUrl.includes('/wasm-tcl/runner-worker.js')
												? tclWorkerSource
												: '/* static worker */';
	return new Response(source, {
		status: 200,
		headers: {
			'content-length': String(new TextEncoder().encode(source).byteLength)
		}
	});
}

function createStreamingTestSandbox() {
	return new StaticWorkerRuntimeSandbox({
		languageId: 'STREAMING_STDIN_TEST',
		displayName: 'Streaming stdin test',
		defaultActivePath: 'main.txt',
		stdin: { mode: 'streaming', sourceHintPattern: /read/ },
		resolveRuntimeAssets: () => ({
			baseUrl: '/streaming-stdin-test/',
			workerUrl: '/streaming-stdin-test/worker.js'
		})
	});
}

const PERSISTENT_TEST_IDLE_TIMEOUT_MS = 1_000;

function createPersistentTestSandbox() {
	return new StaticWorkerRuntimeSandbox({
		languageId: 'PERSISTENT_TEST',
		displayName: 'Persistent test',
		defaultActivePath: 'main.txt',
		stdin: { mode: 'none' },
		workerLifetime: {
			mode: 'persistent',
			idleTimeoutMs: PERSISTENT_TEST_IDLE_TIMEOUT_MS,
			evictOnMemoryPressure: true
		},
		resolveRuntimeAssets: (runtimeAssets) => ({
			baseUrl: `${String(runtimeAssets || '/persistent-test').replace(/\/$/u, '')}/`,
			workerUrl: `${String(runtimeAssets || '/persistent-test').replace(/\/$/u, '')}/worker.js`
		})
	});
}

function createOwnedPreflightTestSandbox(
	preflight: (context: StaticWorkerRuntimePreflightContext) => unknown | Promise<unknown>,
	options: { readonly languageId?: string; readonly preflightKey?: string } = {}
) {
	const languageId = options.languageId ?? 'OWNED_PREFLIGHT_TEST';
	const preflightKey = options.preflightKey ?? 'owned-preflight-test-v1';
	return new StaticWorkerRuntimeSandbox({
		languageId,
		displayName: languageId,
		defaultActivePath: 'main.txt',
		stdin: { mode: 'none' },
		workerLifetime: { mode: 'per-run' },
		runtimePreflightDelivery: 'transfer-owned',
		resolveRuntimeAssets: () => ({
			baseUrl: '/owned-preflight-test/',
			workerUrl: '/owned-preflight-test/worker.js',
			preflightKey
		}),
		preflightRuntimeAssets: (_urls, context) => preflight(context)
	});
}

function createOwnedPreflightTestPayload() {
	return Object.freeze({
		protocol: 'owned-preflight-test',
		protocolVersion: 1,
		manifestBytes: Uint8Array.from([1, 2, 3]),
		wasmBytes: Uint8Array.from([0, 97, 115, 109])
	});
}

function createPrologLifecycleTestSandbox() {
	return new StaticWorkerRuntimeSandbox({
		languageId: 'PROLOG',
		displayName: 'Prolog',
		defaultActivePath: 'main.prolog',
		stdin: {
			mode: 'streaming',
			sourceHintPattern:
				/\b(read_line_to_string|read_line_to_codes|get_char|get_code|read\s*\(|read_string)\b/
		},
		workerLifetime: {
			mode: 'persistent',
			idleTimeoutMs: 60_000,
			evictOnMemoryPressure: true
		},
		inlineVerifiedWorker: true,
		resolveRuntimeAssets: resolvePrologRuntimeAssetConfig
	});
}

function hasRuntimePreflightForWorker(
	sandbox: StaticWorkerRuntimeSandbox,
	worker: MockWorker
): boolean {
	return (
		sandbox as unknown as {
			workerRuntimePreflight: WeakMap<Worker, unknown>;
		}
	).workerRuntimePreflight.has(worker as unknown as Worker);
}

async function withCrossOriginIsolation(value: boolean, callback: () => Promise<void>) {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'crossOriginIsolated');
	Object.defineProperty(globalThis, 'crossOriginIsolated', { configurable: true, value });
	try {
		await callback();
	} finally {
		restoreCrossOriginIsolation(previous);
	}
}

function restoreCrossOriginIsolation(descriptor?: PropertyDescriptor) {
	if (descriptor) Object.defineProperty(globalThis, 'crossOriginIsolated', descriptor);
	else Reflect.deleteProperty(globalThis, 'crossOriginIsolated');
}

async function expectWorkerBootstrap(worker: MockWorker, targetUrl: string) {
	expect(worker.url).toMatch(/^blob:wasm-idle-worker-/);
	const bootstrap = workerBootstrapBlobs.get(worker.url);
	expect(bootstrap).toBeDefined();
	const source = await bootstrap!.text();
	expect(source).toContain(JSON.stringify(targetUrl));
	expect(source).toContain("['output', 'results', 'error', 'diagnostic', 'progress']");
	expect(source).toContain('runId: __wasmIdleRunId');
	expect(source).toContain('__wasmIdleRunId === terminalRunId');
	expect(source).toContain("message.type === 'stdin-request'");
	expect(source.indexOf('self.postMessage =')).toBeLessThan(
		source.indexOf(JSON.stringify(targetUrl))
	);
}

async function expectVerifiedWorkerBootstrap(
	worker: MockWorker,
	targetUrl: string,
	workerSource: string
) {
	expect(worker.url).toMatch(/^blob:wasm-idle-worker-/);
	const bootstrap = workerBootstrapBlobs.get(worker.url);
	expect(bootstrap).toBeDefined();
	const source = await bootstrap!.text();
	expect(source).not.toContain(JSON.stringify(targetUrl));
	expect(source).toContain('/* wasm-idle verified worker source */');
	expect(source).toContain(workerSource);
	expect(source.indexOf('self.postMessage =')).toBeLessThan(
		source.indexOf('/* wasm-idle verified worker source */')
	);
	expect(source.indexOf(workerSource)).toBeLessThan(
		source.indexOf('__wasmIdleStaticWorkerReady')
	);
}

describe('static worker backed language sandboxes', () => {
	beforeEach(() => {
		Object.defineProperty(globalThis, 'crossOriginIsolated', {
			configurable: true,
			value: false
		});
		workerInstances.length = 0;
		workerBootstrapBlobs.clear();
		runtimeLifecycleEvents.length = 0;
		onPostMessage = null;
		autoStartWorkers = true;
		workerBootstrapId = 0;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => createStaticWorkerFetchResponse(input))
		);
		vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
			const url = `blob:wasm-idle-worker-${workerBootstrapId++}`;
			workerBootstrapBlobs.set(url, blob as Blob);
			return url;
		});
		vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		for (const key of Object.keys(publicEnv)) {
			publicEnv[key as keyof typeof publicEnv] = '';
		}
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		restoreCrossOriginIsolation(initialCrossOriginIsolation);
	});

	it('reports prebuffered stdin for legacy runtimes and the non-isolated fallback', () => {
		expect(new Julia().stdinMode).toBe('prebuffered');
		expect(new Awk().stdinMode).toBe('prebuffered');
		expect(new Bqn().stdinMode).toBe('prebuffered');
		expect(new ClojureScript().stdinMode).toBe('prebuffered');
		expect(new Forth().stdinMode).toBe('prebuffered');
		expect(new Gleam().stdinMode).toBe('prebuffered');
		expect(new J().stdinMode).toBe('prebuffered');
		expect(new Janet().stdinMode).toBe('prebuffered');
		expect(new Nim().stdinMode).toBe('prebuffered');
		expect(new Pascal().stdinMode).toBe('prebuffered');
		expect(new Perl().stdinMode).toBe('prebuffered');
		expect(new Prolog().stdinMode).toBe('prebuffered');
		expect(new Tcl().stdinMode).toBe('prebuffered');
	});

	it('does not forward input when a static runtime declares no stdin capability', async () => {
		const sandbox = new StaticWorkerRuntimeSandbox({
			languageId: 'NO_STDIN_TEST',
			displayName: 'No stdin test',
			defaultActivePath: 'main.txt',
			stdin: { mode: 'none' },
			resolveRuntimeAssets: () => ({
				baseUrl: '/no-stdin-test/',
				workerUrl: '/no-stdin-test/worker.js'
			})
		});

		expect(sandbox.stdinMode).toBe('none');
		await sandbox.load();
		await expect(
			sandbox.run('print("ok")', false, true, undefined, [], { stdin: 'ignored\n' })
		).resolves.toBe(true);
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ stdin: undefined, stdinEof: false })
		);
	});

	it('rejects missing static runtime configuration with a typed error', async () => {
		const sandbox = new StaticWorkerRuntimeSandbox({
			languageId: 'UNCONFIGURED_TEST',
			displayName: 'Unconfigured test',
			defaultActivePath: 'main.txt',
			stdin: { mode: 'none' },
			resolveRuntimeAssets: () => ({ baseUrl: '', workerUrl: '' })
		});

		await expect(sandbox.load()).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			phase: 'configuration',
			runtimeId: 'UNCONFIGURED_TEST'
		});
		await expect(sandbox.run('', false)).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			phase: 'configuration',
			runtimeId: 'UNCONFIGURED_TEST'
		});
		expect(fetch).not.toHaveBeenCalled();
		expect(workerInstances).toHaveLength(0);
	});

	it('streams run-correlated input after dispatch through a bounded shared ring', async () => {
		await withCrossOriginIsolation(true, async () => {
			const messages: any[] = [];
			onPostMessage = (worker, message) => {
				messages.push(message);
				if (message.run) {
					queueMicrotask(() => {
						worker.onmessage?.({
							data: { type: 'stdin-request', runId: message.runId }
						} as MessageEvent<any>);
					});
				}
			};
			const sandbox = createStreamingTestSandbox();
			expect(sandbox.stdinMode).toBe('streaming');
			expect(new Awk().stdinMode).toBe('streaming');
			expect(new Bqn().stdinMode).toBe('streaming');
			expect(new ClojureScript().stdinMode).toBe('streaming');
			expect(new Forth().stdinMode).toBe('streaming');
			expect(new Gleam().stdinMode).toBe('streaming');
			expect(new J().stdinMode).toBe('streaming');
			expect(new Janet().stdinMode).toBe('streaming');
			expect(new Julia().stdinMode).toBe('streaming');
			expect(new Nim().stdinMode).toBe('streaming');
			expect(new Pascal().stdinMode).toBe('streaming');
			expect(new Perl().stdinMode).toBe('streaming');
			expect(new Prolog().stdinMode).toBe('streaming');
			expect(new Tcl().stdinMode).toBe('streaming');
			await sandbox.load();

			const run = sandbox.run('print("prompt"); read()', false);
			await vi.waitFor(() => expect(messages.some((message) => message.run)).toBe(true));
			const runMessage = messages.find((message) => message.run);
			expect(runMessage).toMatchObject({
				run: true,
				stdin: undefined,
				stdinEof: false,
				stdinChannel: {
					protocol: 'wasm-idle-static-stdin-ring',
					protocolVersion: 1
				}
			});

			sandbox.write('after prompt\n');
			const control = new Int32Array(
				runMessage.stdinChannel.buffer,
				0,
				STATIC_STDIN_RING_CONTROL_SLOTS
			);
			expect(Atomics.load(control, STATIC_STDIN_RING_WRITE_INDEX)).toBe(13);
			expect(messages).toEqual([runMessage]);

			sandbox.eof();
			expect(Atomics.load(control, STATIC_STDIN_RING_CLOSED_INDEX)).toBe(1);
			workerInstances[0].onmessage?.({
				data: { results: true, runId: runMessage.runId }
			} as MessageEvent<any>);
			await expect(run).resolves.toBe(true);
		});
	});

	it('falls back to prebuffered stdin without cross-origin isolation', async () => {
		await withCrossOriginIsolation(false, async () => {
			const sandbox = createStreamingTestSandbox();
			expect(sandbox.stdinMode).toBe('prebuffered');
			await sandbox.load();
			const run = sandbox.run('read()', false);
			await Promise.resolve();
			expect(workerInstances[0].postMessage).not.toHaveBeenCalled();

			sandbox.write('fallback\n');
			sandbox.eof();
			await expect(run).resolves.toBe(true);
			expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
				expect.objectContaining({ stdin: 'fallback\n', stdinEof: true })
			);
		});
	});

	it('preflights Prolog runtime bytes before worker creation and reuses them for warm runs', async () => {
		const sandbox = new Prolog();
		const outputs: string[] = [];
		const code = 'main :- read_line_to_string(user_input, Line), format("~w~n", [Line]).';
		sandbox.output = (chunk: string) => outputs.push(chunk);

		await sandbox.load({
			prolog: {
				baseUrl: '/wasm-prolog/',
				workerUrl: `/wasm-prolog/runner-worker.js?v=${WASM_PROLOG_RUNNER_RECEIPT.sha256}`,
				manifestUrl: `/wasm-prolog/runtime-manifest.v2.json?v=${WASM_PROLOG_ASSET_VERSION}`,
				...WASM_PROLOG_RUNTIME_PROFILE,
				workerReceipt: WASM_PROLOG_RUNNER_RECEIPT
			}
		});
		await expect(
			sandbox.run(code, false, true, undefined, ['demo'], {
				activePath: 'main.prolog',
				stdin: '27\n'
			})
		).resolves.toBe(true);
		const worker = workerInstances[0];
		const firstRunId = worker.lastRunId;
		await expect(
			sandbox.run('main :- writeln(warm).', false, true, undefined, [], { stdin: '' })
		).resolves.toBe(true);

		await expectVerifiedWorkerBootstrap(
			worker,
			`http://localhost:3000/wasm-prolog/runner-worker.js?v=${WASM_PROLOG_RUNNER_RECEIPT.sha256}`,
			prologWorkerSource
		);
		const runMessages = worker.postMessage.mock.calls.map(([message]) => message);
		expect(runMessages).toHaveLength(2);
		expect(runMessages[0]).toEqual(
			expect.objectContaining({
				runId: expect.stringMatching(/^static-\d+$/),
				manifestFingerprint: WASM_PROLOG_ASSET_VERSION,
				runtimePreflight: expect.objectContaining({
					protocol: 'wasm-idle-prolog-preflight',
					protocolVersion: 1,
					profileId: WASM_PROLOG_RUNTIME_PROFILE.profileId,
					packageRevision: WASM_PROLOG_RUNTIME_PROFILE.packageRevision,
					swiplRevision: WASM_PROLOG_RUNTIME_PROFILE.swiplRevision,
					manifestFingerprint: WASM_PROLOG_ASSET_VERSION
				}),
				code,
				args: ['demo'],
				stdin: '27\n',
				activePath: 'main.prolog'
			})
		);
		expect(runMessages[0].runtimePreflight.wasmBytes).toHaveLength(
			WASM_PROLOG_RUNTIME_PROFILE.wasmReceipt.uncompressedBytes
		);
		expect(runMessages[0].runtimePreflight.dataBytes).toHaveLength(
			WASM_PROLOG_RUNTIME_PROFILE.dataReceipt.uncompressedBytes
		);
		expect(runMessages[1].runtimePreflight).toBe(runMessages[0].runtimePreflight);
		const workerEventIndex = runtimeLifecycleEvents.findIndex((event) =>
			event.startsWith('worker:')
		);
		for (const assetPath of [
			'runtime-manifest.v2.json',
			'swipl-web.js',
			'swipl-web.wasm.gz.bin',
			'swipl-web.data.gz.bin',
			'runner-worker.js'
		]) {
			const fetchEventIndex = runtimeLifecycleEvents.findIndex(
				(event) => event.startsWith('fetch:') && event.includes(assetPath)
			);
			expect(fetchEventIndex).toBeGreaterThanOrEqual(0);
			expect(fetchEventIndex).toBeLessThan(workerEventIndex);
		}
		expect(
			runtimeLifecycleEvents.filter(
				(event) => event.startsWith('fetch:') && event.includes('/wasm-prolog/')
			)
		).toHaveLength(5);
		expect(sandbox.workerReceipt).toEqual(WASM_PROLOG_RUNNER_RECEIPT);
		expect(outputs).toContain('factorial_plus_bonus=27\n');
		expect(workerInstances).toEqual([worker]);
		expect(worker.lastRunId).not.toBe(firstRunId);
		await sandbox.dispose();
		expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it('rejects a modified Prolog runner before creating a worker', async () => {
		const modifiedSource = `x${prologWorkerSource.slice(1)}`;
		vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
			if (!String(input).includes('/wasm-prolog/runner-worker.js')) {
				return createStaticWorkerFetchResponse(input);
			}
			return new Response(modifiedSource, {
				status: 200,
				headers: {
					'content-length': String(new TextEncoder().encode(modifiedSource).byteLength)
				}
			});
		});
		const sandbox = new Prolog();

		await expect(sandbox.load('/absproxy/5173')).rejects.toMatchObject({
			code: 'asset-integrity',
			runtimeId: 'PROLOG'
		});
		expect(workerInstances).toHaveLength(0);
	});

	it('rejects a corrupt Prolog runtime asset before loading the runner or creating a worker', async () => {
		vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
			if (!String(input).includes('/wasm-prolog/swipl-web.data.gz.bin')) {
				return createStaticWorkerFetchResponse(input);
			}
			return new Response(Uint8Array.from([...prologRuntimeDataGzipBytes, 0]), {
				status: 200,
				headers: { 'content-type': 'application/octet-stream' }
			});
		});
		const sandbox = new Prolog();

		await expect(sandbox.load('/absproxy/5173')).rejects.toMatchObject({
			code: 'asset-integrity',
			runtimeId: 'PROLOG'
		});
		expect(
			vi
				.mocked(fetch)
				.mock.calls.some(([input]) =>
					String(input).includes('/wasm-prolog/runner-worker.js')
				)
		).toBe(false);
		expect(workerInstances).toHaveLength(0);
	});

	it('uses a module worker and reuses it for warm Gleam runs', async () => {
		const sandbox = new Gleam();
		await sandbox.load('/absproxy/5173');
		await expect(
			sandbox.run(
				'import wasm_idle/stdin\npub fn main() { stdin.read_line() }',
				false,
				true,
				undefined,
				[],
				{
					stdin: '42\n'
				}
			)
		).resolves.toBe(true);
		const firstRunId = workerInstances[0].lastRunId;
		await expect(
			sandbox.run('pub fn main() { Nil }', false, true, undefined, [], { stdin: '' })
		).resolves.toBe(true);

		await expectVerifiedWorkerBootstrap(
			workerInstances[0],
			'http://localhost:3000/absproxy/5173/wasm-gleam/runner-worker.js',
			gleamWorkerSource
		);
		expect(workerInstances[0].options).toEqual({ type: 'module' });
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				baseUrl: 'http://localhost:3000/absproxy/5173/wasm-gleam/',
				manifestUrl:
					'http://localhost:3000/absproxy/5173/wasm-gleam/source-manifest.v2.json',
				manifestFingerprint: WASM_GLEAM_ASSET_VERSION,
				stdin: '42\n'
			})
		);
		expect(sandbox.workerReceipt).toEqual(WASM_GLEAM_RUNNER_RECEIPT);
		expect(fetch).toHaveBeenCalledWith(
			'http://localhost:3000/absproxy/5173/wasm-gleam/runner-worker.js',
			expect.objectContaining({ cache: 'no-store' })
		);
		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].lastRunId).not.toBe(firstRunId);
		await sandbox.dispose();
	});

	it('rejects a modified Gleam runner before creating a worker', async () => {
		const modifiedSource = `x${gleamWorkerSource.slice(1)}`;
		vi.mocked(fetch).mockResolvedValueOnce(
			new Response(modifiedSource, {
				status: 200,
				headers: {
					'content-length': String(new TextEncoder().encode(modifiedSource).byteLength)
				}
			})
		);
		const sandbox = new Gleam();

		await expect(sandbox.load('/absproxy/5173')).rejects.toMatchObject({
			code: 'asset-integrity',
			runtimeId: 'GLEAM'
		});
		expect(workerInstances).toHaveLength(0);
	});

	it('rejects an oversized Gleam runner declaration at its exact receipt limit', async () => {
		const response = new Response(gleamWorkerSource, {
			status: 200,
			headers: { 'content-length': String(WASM_GLEAM_RUNNER_RECEIPT.bytes + 1) }
		});
		const cancel = vi.spyOn(response.body!, 'cancel');
		vi.mocked(fetch).mockResolvedValueOnce(response);
		const sandbox = new Gleam();

		await expect(sandbox.load('/absproxy/5173')).rejects.toMatchObject({
			code: 'asset-too-large',
			actual: WASM_GLEAM_RUNNER_RECEIPT.bytes + 1,
			limit: WASM_GLEAM_RUNNER_RECEIPT.bytes,
			runtimeId: 'GLEAM'
		});
		expect(cancel).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(0);
	});

	it('requires explicit integrity pins for custom Gleam runtime URLs', async () => {
		const sandbox = new Gleam();

		await expect(
			sandbox.load({
				gleam: {
					baseUrl: '/custom-gleam/',
					workerUrl: '/custom-gleam/runner-worker.js',
					manifestUrl: '/custom-gleam/source-manifest.v2.json'
				}
			})
		).rejects.toMatchObject({
			code: 'runtime-configuration',
			runtimeId: 'GLEAM'
		});
		expect(fetch).not.toHaveBeenCalled();
		expect(workerInstances).toHaveLength(0);
	});

	it('preflights all WebPerl executable bytes before worker creation and reuses a prepared worker', async () => {
		const sandbox = new Perl();
		const runtimeAssets = {
			perl: {
				baseUrl: '/wasm-perl/',
				workerUrl: `/wasm-perl/runner-worker.js?v=${WASM_PERL_RUNNER_RECEIPT.sha256}`,
				manifestUrl: `/wasm-perl/runtime-manifest.v2.json?v=${perlTestManifestFingerprint}`,
				...perlTestProfile,
				workerReceipt: WASM_PERL_RUNNER_RECEIPT
			}
		};
		await sandbox.load(runtimeAssets);
		const warmFetchCount = vi.mocked(fetch).mock.calls.length;
		await sandbox.load(runtimeAssets);
		expect(fetch).toHaveBeenCalledTimes(warmFetchCount);
		await expect(
			sandbox.run('my $line = <STDIN>; print $line;', false, true, undefined, [], {
				stdin: 'ok\n'
			})
		).resolves.toBe(true);

		await expectVerifiedWorkerBootstrap(
			workerInstances[0],
			`http://localhost:3000/wasm-perl/runner-worker.js?v=${WASM_PERL_RUNNER_RECEIPT.sha256}`,
			perlWorkerSource
		);
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				baseUrl: 'http://localhost:3000/wasm-perl/',
				manifestUrl: `http://localhost:3000/wasm-perl/runtime-manifest.v2.json?v=${perlTestManifestFingerprint}`,
				manifestFingerprint: perlTestManifestFingerprint,
				runtimePreflight: expect.objectContaining({
					protocol: 'wasm-idle-perl-preflight',
					protocolVersion: 1,
					profileId: perlTestProfile.profileId,
					artifactRevision: perlTestProfile.artifactRevision,
					webperlRevision: perlTestProfile.webperlRevision,
					perlRevision: perlTestProfile.perlRevision,
					emscriptenRevision: perlTestProfile.emscriptenRevision,
					manifestFingerprint: perlTestManifestFingerprint
				}),
				stdin: 'ok\n',
				activePath: 'main.pl'
			})
		);
		const runMessage = workerInstances[0].postMessage.mock.calls[0][0];
		expect(Array.from(runMessage.runtimePreflight.javascriptBytes)).toEqual(
			Array.from(perlTestJavaScriptBytes)
		);
		expect(Array.from(runMessage.runtimePreflight.wasmBytes)).toEqual(
			Array.from(perlTestWasmBytes)
		);
		expect(Array.from(runMessage.runtimePreflight.dataBytes)).toEqual(
			Array.from(perlTestDataBytes)
		);
		const workerEventIndex = runtimeLifecycleEvents.findIndex((event) =>
			event.startsWith('worker:')
		);
		for (const assetPath of [
			'runtime-manifest.v2.json',
			'emperl.js.gz.bin',
			'emperl.wasm.gz.bin',
			'emperl.data.gz.bin',
			'runner-worker.js'
		]) {
			const fetchEventIndex = runtimeLifecycleEvents.findIndex(
				(event) => event.startsWith('fetch:') && event.includes(assetPath)
			);
			expect(fetchEventIndex).toBeGreaterThanOrEqual(0);
			expect(fetchEventIndex).toBeLessThan(workerEventIndex);
		}
		expect(
			runtimeLifecycleEvents.some(
				(event) =>
					event.startsWith('fetch:') &&
					['emperl.js.gz', 'emperl.wasm.gz', 'emperl.data.gz'].some((legacyPath) =>
						new URL(event.slice('fetch:'.length)).pathname.endsWith(`/${legacyPath}`)
					)
			)
		).toBe(false);
		expect(
			runtimeLifecycleEvents.filter(
				(event) => event.startsWith('fetch:') && event.includes('/wasm-perl/')
			)
		).toHaveLength(5);
		expect(workerInstances).toHaveLength(1);
		expect(sandbox.workerReceipt).toEqual(WASM_PERL_RUNNER_RECEIPT);
	});

	it('requires explicit integrity pins for custom Perl runtime URLs', async () => {
		const sandbox = new Perl();

		await expect(
			sandbox.load({
				perl: {
					baseUrl: '/custom-perl/',
					workerUrl: '/custom-perl/runner-worker.js',
					manifestUrl: '/custom-perl/runtime-manifest.v2.json'
				}
			})
		).rejects.toMatchObject({
			code: 'runtime-configuration',
			runtimeId: 'PERL'
		});
		expect(fetch).not.toHaveBeenCalled();
		expect(workerInstances).toHaveLength(0);
	});

	it('rejects a corrupt WebPerl runtime asset before loading the runner or creating a worker', async () => {
		vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
			if (!String(input).includes('/wasm-perl/emperl.data.gz.bin')) {
				return createStaticWorkerFetchResponse(input);
			}
			return new Response(Uint8Array.from([...perlTestDataGzipBytes, 0]), {
				status: 200,
				headers: { 'content-type': 'application/octet-stream' }
			});
		});
		const sandbox = new Perl();

		await expect(
			sandbox.load({
				perl: {
					baseUrl: '/wasm-perl/',
					workerUrl: `/wasm-perl/runner-worker.js?v=${WASM_PERL_RUNNER_RECEIPT.sha256}`,
					manifestUrl: `/wasm-perl/runtime-manifest.v2.json?v=${perlTestManifestFingerprint}`,
					...perlTestProfile,
					workerReceipt: WASM_PERL_RUNNER_RECEIPT
				}
			})
		).rejects.toMatchObject({ code: 'asset-integrity', runtimeId: 'PERL' });
		expect(
			vi
				.mocked(fetch)
				.mock.calls.some(([input]) => String(input).includes('/wasm-perl/runner-worker.js'))
		).toBe(false);
		expect(workerInstances).toHaveLength(0);
	});

	it('preflights all Tcl executable bytes before worker creation and reuses a warm worker', async () => {
		const sandbox = new Tcl();
		const runtimeAssets = {
			tcl: {
				baseUrl: '/wasm-tcl/',
				workerUrl: `/wasm-tcl/runner-worker.js?v=${WASM_TCL_RUNNER_RECEIPT.sha256}`,
				manifestUrl: `/wasm-tcl/runtime-manifest.v2.json?v=${WASM_TCL_ASSET_VERSION}`,
				...WASM_TCL_RUNTIME_PROFILE,
				workerReceipt: WASM_TCL_RUNNER_RECEIPT
			}
		};
		await sandbox.load(runtimeAssets);
		const warmFetchCount = vi.mocked(fetch).mock.calls.length;
		await sandbox.load(runtimeAssets);
		expect(fetch).toHaveBeenCalledTimes(warmFetchCount);
		await expect(
			sandbox.run('gets stdin line; puts $line', false, true, undefined, ['demo'], {
				stdin: 'ok\n'
			})
		).resolves.toBe(true);

		await expectVerifiedWorkerBootstrap(
			workerInstances[0],
			`http://localhost:3000/wasm-tcl/runner-worker.js?v=${WASM_TCL_RUNNER_RECEIPT.sha256}`,
			tclWorkerSource
		);
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				baseUrl: 'http://localhost:3000/wasm-tcl/',
				manifestUrl: `http://localhost:3000/wasm-tcl/runtime-manifest.v2.json?v=${WASM_TCL_ASSET_VERSION}`,
				manifestFingerprint: WASM_TCL_ASSET_VERSION,
				runtimePreflight: expect.objectContaining({
					protocol: 'wasm-idle-tcl-preflight',
					protocolVersion: 1,
					profileId: WASM_TCL_RUNTIME_PROFILE.profileId,
					artifactRevision: WASM_TCL_RUNTIME_PROFILE.artifactRevision,
					waclRevision: WASM_TCL_RUNTIME_PROFILE.waclRevision,
					tclRevision: WASM_TCL_RUNTIME_PROFILE.tclRevision,
					requireJsRevision: WASM_TCL_RUNTIME_PROFILE.requireJsRevision,
					emscriptenRevision: WASM_TCL_RUNTIME_PROFILE.emscriptenRevision,
					manifestFingerprint: WASM_TCL_ASSET_VERSION
				}),
				args: ['demo'],
				stdin: 'ok\n',
				activePath: 'main.tcl'
			})
		);
		const runMessage = workerInstances[0].postMessage.mock.calls[0][0];
		expect(runMessage.runtimePreflight.libraryDataBytes).toHaveLength(
			WASM_TCL_RUNTIME_PROFILE.libraryDataReceipt.uncompressedBytes
		);
		expect(runMessage.runtimePreflight.wasmBytes).toHaveLength(
			WASM_TCL_RUNTIME_PROFILE.wasmReceipt.uncompressedBytes
		);
		const workerEventIndex = runtimeLifecycleEvents.findIndex((event) =>
			event.startsWith('worker:')
		);
		for (const assetPath of [
			'runtime-manifest.v2.json',
			'require.js',
			'wacl-custom.data.bin',
			'wacl-library.data.gz.bin',
			'wacl.js',
			'wacl.wasm.gz.bin',
			'runner-worker.js'
		]) {
			const fetchEventIndex = runtimeLifecycleEvents.findIndex(
				(event) => event.startsWith('fetch:') && event.includes(assetPath)
			);
			expect(fetchEventIndex).toBeGreaterThanOrEqual(0);
			expect(fetchEventIndex).toBeLessThan(workerEventIndex);
		}
		expect(
			runtimeLifecycleEvents.some(
				(event) =>
					event.startsWith('fetch:') &&
					new URL(event.slice('fetch:'.length)).pathname.endsWith('/wacl-custom.data')
			)
		).toBe(false);
		expect(
			runtimeLifecycleEvents.filter(
				(event) => event.startsWith('fetch:') && event.includes('/wasm-tcl/')
			)
		).toHaveLength(7);
		expect(workerInstances).toHaveLength(1);
		expect(sandbox.workerReceipt).toEqual(WASM_TCL_RUNNER_RECEIPT);
	});

	it('rejects a modified Tcl runner before creating a worker', async () => {
		const modifiedSource = `x${tclWorkerSource.slice(1)}`;
		vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
			if (!String(input).includes('/wasm-tcl/runner-worker.js')) {
				return createStaticWorkerFetchResponse(input);
			}
			return new Response(modifiedSource, {
				status: 200,
				headers: {
					'content-length': String(new TextEncoder().encode(modifiedSource).byteLength)
				}
			});
		});
		const sandbox = new Tcl();

		await expect(sandbox.load('/absproxy/5173')).rejects.toMatchObject({
			code: 'asset-integrity',
			runtimeId: 'TCL'
		});
		expect(workerInstances).toHaveLength(0);
	});

	it('rejects a corrupt Tcl runtime asset before loading the runner or creating a worker', async () => {
		vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
			if (!String(input).includes('/wasm-tcl/tcl/wacl.wasm.gz.bin')) {
				return createStaticWorkerFetchResponse(input);
			}
			return new Response(Uint8Array.from([...tclWasmGzipBytes, 0]), {
				status: 200,
				headers: { 'content-type': 'application/octet-stream' }
			});
		});
		const sandbox = new Tcl();

		await expect(sandbox.load('/absproxy/5173')).rejects.toMatchObject({
			code: 'asset-integrity',
			runtimeId: 'TCL'
		});
		expect(
			vi
				.mocked(fetch)
				.mock.calls.some(([input]) => String(input).includes('/wasm-tcl/runner-worker.js'))
		).toBe(false);
		expect(workerInstances).toHaveLength(0);
	});

	it('loads AWK runtime urls and forwards stdin to the GoAWK worker', async () => {
		const sandbox = new Awk();
		await sandbox.load({
			awk: {
				baseUrl: '/wasm-awk/',
				workerUrl: '/wasm-awk/runner-worker.js?v=test'
			}
		});
		await expect(
			sandbox.run('{ print $0 }', false, true, undefined, ['demo=1'], {
				stdin: 'ok\n'
			})
		).resolves.toBe(true);

		await expectWorkerBootstrap(
			workerInstances[0],
			'http://localhost:3000/wasm-awk/runner-worker.js?v=test'
		);
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				baseUrl: 'http://localhost:3000/wasm-awk/',
				args: ['demo=1'],
				stdin: 'ok\n',
				activePath: 'main.awk'
			})
		);
	});

	it('loads Pascal runtime urls and forwards stdin to the pas2js worker', async () => {
		const sandbox = new Pascal();
		await sandbox.load({
			pascal: {
				baseUrl: '/wasm-pascal/',
				workerUrl: '/wasm-pascal/runner-worker.js?v=test'
			}
		});
		await expect(
			sandbox.run(
				'program main; var n: integer; begin ReadLn(n); WriteLn(n); end.',
				false,
				true,
				undefined,
				[],
				{
					stdin: 'ok\n'
				}
			)
		).resolves.toBe(true);

		await expectWorkerBootstrap(
			workerInstances[0],
			'http://localhost:3000/wasm-pascal/runner-worker.js?v=test'
		);
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				baseUrl: 'http://localhost:3000/wasm-pascal/',
				stdin: 'ok\n',
				activePath: 'main.pas'
			})
		);
	});

	it('loads ClojureScript runtime urls and forwards stdin, args, and workspace files', async () => {
		const sandbox = new ClojureScript();
		const code = `(ns wasm-idle.main (:require [wasm-idle.runtime :as runtime]))
(println (runtime/read-line))`;
		await sandbox.load(clojureScriptTestRuntimeAssets());
		await expect(
			sandbox.run(code, false, true, undefined, ['demo'], {
				activePath: 'src/wasm_idle/main.cljs',
				stdin: '68\n',
				workspaceFiles: [{ path: 'src/demo.cljs', content: '(ns demo)' }]
			})
		).resolves.toBe(true);

		await expectVerifiedWorkerBootstrap(
			workerInstances[0],
			'http://localhost:3000/wasm-clojurescript/runner-worker.js?v=test',
			clojureScriptWorkerSource
		);
		expect(workerInstances[0].options).toBeUndefined();
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				baseUrl: 'http://localhost:3000/wasm-clojurescript/',
				manifestUrl: 'http://localhost:3000/wasm-clojurescript/runtime-manifest.v2.json',
				manifestFingerprint: clojureScriptTestProfile.manifestFingerprint,
				code,
				args: ['demo'],
				stdin: '68\n',
				activePath: 'src/wasm_idle/main.cljs',
				workspaceFiles: [{ path: 'src/demo.cljs', content: '(ns demo)' }],
				runtimePreflight: expect.objectContaining({
					protocol: 'wasm-idle-clojurescript-preflight',
					protocolVersion: 1,
					profileId: clojureScriptTestProfile.profileId,
					sourceRevision: clojureScriptTestProfile.sourceRevision,
					integrationRevision: clojureScriptTestProfile.integrationRevision,
					manifestFingerprint: clojureScriptTestProfile.manifestFingerprint
				})
			})
		);
		const runMessage = workerInstances[0].postMessage.mock.calls[0]?.[0];
		expect(runMessage.runtimePreflight.manifestBytes).toBeInstanceOf(Uint8Array);
		expect(runMessage.runtimePreflight.compilerBytes).toBeInstanceOf(Uint8Array);
		expect(new TextDecoder().decode(runMessage.runtimePreflight.manifestBytes)).toBe(
			clojureScriptTestManifestSource
		);
		expect(runMessage.runtimePreflight.compilerBytes).toEqual(clojureScriptTestCompilerBytes);
		const workerStartIndex = runtimeLifecycleEvents.findIndex((event) =>
			event.startsWith('worker:')
		);
		for (const assetPath of ['runtime-manifest.v2.json', 'compiler.js.gz.bin']) {
			const fetchIndex = runtimeLifecycleEvents.findIndex((event) =>
				event.includes(assetPath)
			);
			expect(fetchIndex).toBeGreaterThanOrEqual(0);
			expect(fetchIndex).toBeLessThan(workerStartIndex);
		}
	});

	it('rejects corrupted ClojureScript compiler storage before fetching or creating its worker', async () => {
		const corruptedGzip = Uint8Array.from(clojureScriptTestCompilerGzipBytes);
		corruptedGzip[corruptedGzip.byteLength - 1] ^= 1;
		vi.mocked(fetch).mockImplementation(async (input) => {
			const inputUrl = String(input);
			if (!inputUrl.includes('/wasm-clojurescript/compiler.js.gz.bin')) {
				return createStaticWorkerFetchResponse(input);
			}
			runtimeLifecycleEvents.push(`fetch:${inputUrl}`);
			return new Response(corruptedGzip, {
				status: 200,
				headers: {
					'content-length': String(corruptedGzip.byteLength),
					'content-type': 'application/octet-stream'
				}
			});
		});
		const sandbox = new ClojureScript();

		await expect(sandbox.load(clojureScriptTestRuntimeAssets())).rejects.toMatchObject({
			code: 'asset-integrity',
			runtimeId: 'CLOJURESCRIPT'
		});
		expect(workerInstances).toHaveLength(0);
		expect(
			vi
				.mocked(fetch)
				.mock.calls.map(([input]) => String(input))
				.some((url) => url.includes('/wasm-clojurescript/runner-worker.js'))
		).toBe(false);
	});

	it.each([
		['caller cancellation', 'cancelled'],
		['asset timeout', 'timeout']
	] as const)(
		'rejects a pending ClojureScript logical digest on %s before creating its worker',
		async (_label, expectedCode) => {
			const originalDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
			let rejectLogicalDigest: ((reason: unknown) => void) | undefined;
			const digest = vi
				.spyOn(globalThis.crypto.subtle, 'digest')
				.mockImplementation((algorithm, data) => {
					const bytes = ArrayBuffer.isView(data)
						? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
						: new Uint8Array(data);
					if (
						bytes.byteLength === clojureScriptTestCompilerBytes.byteLength &&
						bytes.every(
							(value, index) => value === clojureScriptTestCompilerBytes[index]
						)
					) {
						return new Promise<ArrayBuffer>((_resolve, reject) => {
							rejectLogicalDigest = reject;
						});
					}
					return originalDigest(algorithm, data);
				});
			const controller = new AbortController();
			const reason = new Error('cancel pending ClojureScript logical digest');
			const sandbox = new ClojureScript();
			const load = sandbox.load(
				clojureScriptTestRuntimeAssets(),
				'',
				true,
				[],
				expectedCode === 'cancelled'
					? { signal: controller.signal }
					: { limits: { assetTimeoutMs: 250 } }
			);
			const outcome = load.then(
				(value) => ({ status: 'resolved' as const, value }),
				(error) => ({ status: 'rejected' as const, reason: error as unknown })
			);
			let guard: ReturnType<typeof setTimeout> | undefined;

			try {
				await vi.waitFor(() => expect(rejectLogicalDigest).toBeTypeOf('function'));
				if (expectedCode === 'cancelled') controller.abort(reason);
				const result = await Promise.race([
					outcome,
					new Promise<{ status: 'pending' }>((resolve) => {
						guard = setTimeout(() => resolve({ status: 'pending' }), 1_000);
					})
				]);

				expect(result.status).toBe('rejected');
				expect('reason' in result ? result.reason : undefined).toMatchObject({
					code: expectedCode,
					phase: 'asset',
					runtimeId: 'CLOJURESCRIPT',
					...(expectedCode === 'cancelled' ? { cause: reason } : {})
				});
				expect(workerInstances).toHaveLength(0);
				expect(
					vi
						.mocked(fetch)
						.mock.calls.map(([input]) => String(input))
						.some((url) => url.includes('/wasm-clojurescript/runner-worker.js'))
				).toBe(false);

				rejectLogicalDigest?.(new Error('late ClojureScript logical digest failure'));
				await new Promise((resolve) => setTimeout(resolve, 0));
			} finally {
				if (guard) clearTimeout(guard);
				controller.abort(reason);
				rejectLogicalDigest?.(new Error('release ClojureScript logical digest'));
				await load.catch(() => {});
				digest.mockRestore();
			}
		},
		15_000
	);

	it('loads Forth runtime urls and forwards stdin to the WAForth worker', async () => {
		const sandbox = new Forth();
		await sandbox.load({
			forth: {
				baseUrl: '/wasm-forth/',
				workerUrl: '/wasm-forth/runner-worker.js?v=test'
			}
		});
		await expect(
			sandbox.run('KEY EMIT', false, true, undefined, [], {
				stdin: 'ok\n',
				limits: { maxAssetBytes: 64_000 }
			})
		).resolves.toBe(true);

		await expectVerifiedWorkerBootstrap(
			workerInstances[0],
			'http://localhost:3000/wasm-forth/runner-worker.js?v=test',
			forthWorkerSource
		);
		const runMessage = workerInstances[0].postMessage.mock.calls[0]?.[0];
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				baseUrl: 'http://localhost:3000/wasm-forth/',
				manifestUrl: 'http://localhost:3000/wasm-forth/runtime-manifest.v2.json',
				manifestFingerprint: WASM_FORTH_ASSET_VERSION,
				maxAssetBytes: 64_000,
				stdin: 'ok\n',
				activePath: 'main.fth',
				runtimePreflight: expect.objectContaining({
					protocol: 'wasm-idle-forth-preflight',
					protocolVersion: 1,
					profileId: WASM_FORTH_RUNTIME_PROFILE.profileId,
					implementationVersion: WASM_FORTH_RUNTIME_PROFILE.implementationVersion,
					manifestFingerprint: WASM_FORTH_ASSET_VERSION
				})
			})
		);
		expect(runMessage.runtimePreflight.manifestBytes).toBeInstanceOf(Uint8Array);
		expect(runMessage.runtimePreflight.runtimeBytes).toBeInstanceOf(Uint8Array);
		expect(new TextDecoder().decode(runMessage.runtimePreflight.manifestBytes)).toBe(
			forthManifestSource
		);
		expect(new TextDecoder().decode(runMessage.runtimePreflight.runtimeBytes)).toBe(
			forthRuntimeSource
		);
		expect(sandbox.workerReceipt).toEqual(WASM_FORTH_RUNNER_RECEIPT);
		expect(fetch).toHaveBeenCalledWith(
			'http://localhost:3000/wasm-forth/runner-worker.js?v=test',
			expect.objectContaining({ cache: 'no-store' })
		);
		const workerStartIndex = runtimeLifecycleEvents.findIndex((event) =>
			event.startsWith('worker:')
		);
		const manifestFetchIndex = runtimeLifecycleEvents.indexOf(
			`fetch:http://localhost:3000/wasm-forth/runtime-manifest.v2.json?v=${WASM_FORTH_ASSET_VERSION}`
		);
		const runtimeFetchIndex = runtimeLifecycleEvents.indexOf(
			`fetch:http://localhost:3000/wasm-forth/waforth.js?v=${WASM_FORTH_RUNTIME_PROFILE.runtimeReceipt.sha256}`
		);
		expect(manifestFetchIndex).toBeGreaterThanOrEqual(0);
		expect(runtimeFetchIndex).toBeGreaterThanOrEqual(0);
		expect(manifestFetchIndex).toBeLessThan(workerStartIndex);
		expect(runtimeFetchIndex).toBeLessThan(workerStartIndex);
	});

	it('rejects a modified Forth runner before creating a worker', async () => {
		const modifiedSource = `x${forthWorkerSource.slice(1)}`;
		vi.mocked(fetch).mockImplementation(async (input) => {
			const inputUrl = String(input);
			if (!inputUrl.includes('/wasm-forth/runner-worker.js')) {
				return createStaticWorkerFetchResponse(input);
			}
			runtimeLifecycleEvents.push(`fetch:${inputUrl}`);
			return new Response(modifiedSource, {
				status: 200,
				headers: {
					'content-length': String(new TextEncoder().encode(modifiedSource).byteLength)
				}
			});
		});
		const sandbox = new Forth();

		await expect(sandbox.load('/absproxy/5173')).rejects.toMatchObject({
			code: 'asset-integrity',
			runtimeId: 'FORTH'
		});
		expect(workerInstances).toHaveLength(0);
	});

	it('rejects a corrupted Forth runtime before fetching or creating its worker', async () => {
		const corruptedRuntime = `${forthRuntimeSource}\n/* corrupt */`;
		vi.mocked(fetch).mockImplementation(async (input) => {
			const inputUrl = String(input);
			if (!inputUrl.includes('/wasm-forth/waforth.js')) {
				return createStaticWorkerFetchResponse(input);
			}
			runtimeLifecycleEvents.push(`fetch:${inputUrl}`);
			return new Response(corruptedRuntime, {
				status: 200,
				headers: {
					'content-length': String(new TextEncoder().encode(corruptedRuntime).byteLength),
					'content-type': 'text/javascript'
				}
			});
		});
		const sandbox = new Forth();

		await expect(sandbox.load('/absproxy/5173')).rejects.toMatchObject({
			code: 'asset-integrity',
			runtimeId: 'FORTH'
		});
		expect(workerInstances).toHaveLength(0);
		expect(
			vi
				.mocked(fetch)
				.mock.calls.map(([input]) => String(input))
				.some((url) => url.includes('/wasm-forth/runner-worker.js'))
		).toBe(false);
	});

	it('loads J runtime urls and forwards stdin to the official J wasm worker', async () => {
		const sandbox = new J();
		await sandbox.load(jTestRuntimeAssets());
		await expect(
			sandbox.run('input =: 1!:1 [ 1', false, true, undefined, [], {
				stdin: 'ok\n'
			})
		).resolves.toBe(true);

		await expectVerifiedWorkerBootstrap(
			workerInstances[0],
			'http://localhost:3000/wasm-j/runner-worker.js?v=test',
			jWorkerSource
		);
		expect(workerInstances[0].options).toEqual({ type: 'module' });
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				baseUrl: 'http://localhost:3000/wasm-j/',
				manifestUrl: 'http://localhost:3000/wasm-j/runtime-manifest.v2.json',
				manifestFingerprint: jTestProfile.manifestFingerprint,
				stdin: 'ok\n',
				activePath: 'main.ijs',
				runtimePreflight: expect.objectContaining({
					protocol: 'wasm-idle-j-preflight',
					protocolVersion: 1,
					profileId: jTestProfile.profileId,
					sourceRevision: jTestProfile.sourceRevision,
					manifestFingerprint: jTestProfile.manifestFingerprint
				})
			})
		);
		const runMessage = workerInstances[0].postMessage.mock.calls[0]?.[0];
		expect(runMessage.runtimePreflight.manifestBytes).toBeInstanceOf(Uint8Array);
		expect(runMessage.runtimePreflight.moduleBytes).toBeInstanceOf(Uint8Array);
		expect(runMessage.runtimePreflight.wasmBytes).toBeInstanceOf(Uint8Array);
		expect(new TextDecoder().decode(runMessage.runtimePreflight.manifestBytes)).toBe(
			jTestManifestSource
		);
		expect(new TextDecoder().decode(runMessage.runtimePreflight.moduleBytes)).toBe(
			jTestModuleSource
		);
		expect(runMessage.runtimePreflight.wasmBytes).toEqual(jTestWasmBytes);
		expect(sandbox.workerReceipt).toEqual(WASM_J_RUNNER_RECEIPT);
		const workerStartIndex = runtimeLifecycleEvents.findIndex((event) =>
			event.startsWith('worker:')
		);
		for (const assetPath of [
			'runtime-manifest.v2.json',
			'jamalgam.js',
			'jamalgam.wasm.gz.bin'
		]) {
			const fetchIndex = runtimeLifecycleEvents.findIndex((event) =>
				event.includes(assetPath)
			);
			expect(fetchIndex).toBeGreaterThanOrEqual(0);
			expect(fetchIndex).toBeLessThan(workerStartIndex);
		}
	});

	it('rejects a modified J runner before creating a worker', async () => {
		const modifiedSource = `x${jWorkerSource.slice(1)}`;
		vi.mocked(fetch).mockImplementation(async (input) => {
			const inputUrl = String(input);
			if (!inputUrl.includes('/wasm-j/runner-worker.js')) {
				return createStaticWorkerFetchResponse(input);
			}
			runtimeLifecycleEvents.push(`fetch:${inputUrl}`);
			return new Response(modifiedSource, {
				status: 200,
				headers: {
					'content-length': String(new TextEncoder().encode(modifiedSource).byteLength)
				}
			});
		});
		const sandbox = new J();

		await expect(sandbox.load(jTestRuntimeAssets())).rejects.toMatchObject({
			code: 'asset-integrity',
			runtimeId: 'J'
		});
		expect(workerInstances).toHaveLength(0);
	});

	it('rejects corrupted J Wasm storage before fetching or creating its worker', async () => {
		const corruptedGzip = Uint8Array.from(jTestWasmGzipBytes);
		corruptedGzip[corruptedGzip.byteLength - 1] ^= 1;
		vi.mocked(fetch).mockImplementation(async (input) => {
			const inputUrl = String(input);
			if (!inputUrl.includes('/wasm-j/jamalgam.wasm.gz.bin')) {
				return createStaticWorkerFetchResponse(input);
			}
			runtimeLifecycleEvents.push(`fetch:${inputUrl}`);
			return new Response(corruptedGzip, {
				status: 200,
				headers: {
					'content-length': String(corruptedGzip.byteLength),
					'content-type': 'application/gzip'
				}
			});
		});
		const sandbox = new J();

		await expect(sandbox.load(jTestRuntimeAssets())).rejects.toMatchObject({
			code: 'asset-integrity',
			runtimeId: 'J'
		});
		expect(workerInstances).toHaveLength(0);
		expect(
			vi
				.mocked(fetch)
				.mock.calls.map(([input]) => String(input))
				.some((url) => url.includes('/wasm-j/runner-worker.js'))
		).toBe(false);
	});

	it('loads BQN runtime urls and forwards stdin to the CBQN worker', async () => {
		const sandbox = new Bqn();
		await sandbox.load(bqnTestRuntimeAssets());
		await expect(
			sandbox.run('5+•ParseFloat •GetLine @', false, true, undefined, [], {
				stdin: '68\n'
			})
		).resolves.toBe(true);

		await expectVerifiedWorkerBootstrap(
			workerInstances[0],
			'http://localhost:3000/wasm-bqn/runner-worker.js?v=test',
			bqnWorkerSource
		);
		expect(workerInstances[0].options).toEqual({ type: 'module' });
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				baseUrl: 'http://localhost:3000/wasm-bqn/',
				manifestUrl: 'http://localhost:3000/wasm-bqn/runtime-manifest.v2.json',
				manifestFingerprint: bqnTestProfile.manifestFingerprint,
				stdin: '68\n',
				activePath: 'main.bqn',
				runtimePreflight: expect.objectContaining({
					protocol: 'wasm-idle-bqn-preflight',
					protocolVersion: 1,
					profileId: bqnTestProfile.profileId,
					sourceRevision: bqnTestProfile.sourceRevision,
					manifestFingerprint: bqnTestProfile.manifestFingerprint
				})
			})
		);
		const runMessage = workerInstances[0].postMessage.mock.calls[0]?.[0];
		expect(runMessage.runtimePreflight.manifestBytes).toBeInstanceOf(Uint8Array);
		expect(runMessage.runtimePreflight.moduleBytes).toBeInstanceOf(Uint8Array);
		expect(runMessage.runtimePreflight.wasmBytes).toBeInstanceOf(Uint8Array);
		expect(new TextDecoder().decode(runMessage.runtimePreflight.manifestBytes)).toBe(
			bqnTestManifestSource
		);
		expect(new TextDecoder().decode(runMessage.runtimePreflight.moduleBytes)).toBe(
			bqnTestModuleSource
		);
		expect(runMessage.runtimePreflight.wasmBytes).toEqual(bqnTestWasmBytes);
		expect(sandbox.workerReceipt).toEqual(WASM_BQN_RUNNER_RECEIPT);
		const workerStartIndex = runtimeLifecycleEvents.findIndex((event) =>
			event.startsWith('worker:')
		);
		for (const assetPath of ['runtime-manifest.v2.json', 'BQN.js', 'BQN.wasm.gz.bin']) {
			const fetchIndex = runtimeLifecycleEvents.findIndex((event) =>
				event.includes(assetPath)
			);
			expect(fetchIndex).toBeGreaterThanOrEqual(0);
			expect(fetchIndex).toBeLessThan(workerStartIndex);
		}
	});

	it('rejects a modified BQN runner before creating a worker', async () => {
		const modifiedSource = `x${bqnWorkerSource.slice(1)}`;
		vi.mocked(fetch).mockImplementation(async (input) => {
			const inputUrl = String(input);
			if (!inputUrl.includes('/wasm-bqn/runner-worker.js')) {
				return createStaticWorkerFetchResponse(input);
			}
			runtimeLifecycleEvents.push(`fetch:${inputUrl}`);
			return new Response(modifiedSource, {
				status: 200,
				headers: {
					'content-length': String(new TextEncoder().encode(modifiedSource).byteLength)
				}
			});
		});
		const sandbox = new Bqn();

		await expect(sandbox.load(bqnTestRuntimeAssets())).rejects.toMatchObject({
			code: 'asset-integrity',
			runtimeId: 'BQN'
		});
		expect(workerInstances).toHaveLength(0);
	});

	it('rejects corrupted BQN Wasm storage before fetching or creating its worker', async () => {
		const corruptedGzip = Uint8Array.from(bqnTestWasmGzipBytes);
		corruptedGzip[corruptedGzip.byteLength - 1] ^= 1;
		vi.mocked(fetch).mockImplementation(async (input) => {
			const inputUrl = String(input);
			if (!inputUrl.includes('/wasm-bqn/BQN.wasm.gz.bin')) {
				return createStaticWorkerFetchResponse(input);
			}
			runtimeLifecycleEvents.push(`fetch:${inputUrl}`);
			return new Response(corruptedGzip, {
				status: 200,
				headers: {
					'content-length': String(corruptedGzip.byteLength),
					'content-type': 'application/gzip'
				}
			});
		});
		const sandbox = new Bqn();

		await expect(sandbox.load(bqnTestRuntimeAssets())).rejects.toMatchObject({
			code: 'asset-integrity',
			runtimeId: 'BQN'
		});
		expect(workerInstances).toHaveLength(0);
		expect(
			vi
				.mocked(fetch)
				.mock.calls.map(([input]) => String(input))
				.some((url) => url.includes('/wasm-bqn/runner-worker.js'))
		).toBe(false);
	});

	it.each([
		['caller cancellation', 'cancelled'],
		['asset timeout', 'timeout']
	] as const)(
		'rejects a pending BQN logical digest on %s before creating its worker',
		async (_label, expectedCode) => {
			const originalDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
			let rejectLogicalDigest: ((reason: unknown) => void) | undefined;
			const digest = vi
				.spyOn(globalThis.crypto.subtle, 'digest')
				.mockImplementation((algorithm, data) => {
					const bytes = ArrayBuffer.isView(data)
						? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
						: new Uint8Array(data);
					if (
						bytes.byteLength === bqnTestWasmBytes.byteLength &&
						bytes.every((value, index) => value === bqnTestWasmBytes[index])
					) {
						return new Promise<ArrayBuffer>((_resolve, reject) => {
							rejectLogicalDigest = reject;
						});
					}
					return originalDigest(algorithm, data);
				});
			const controller = new AbortController();
			const reason = new Error('cancel pending BQN logical digest');
			const sandbox = new Bqn();
			const load = sandbox.load(
				bqnTestRuntimeAssets(),
				'',
				true,
				[],
				expectedCode === 'cancelled'
					? { signal: controller.signal }
					: { limits: { assetTimeoutMs: 250 } }
			);
			const outcome = load.then(
				(value) => ({ status: 'resolved' as const, value }),
				(error) => ({ status: 'rejected' as const, reason: error as unknown })
			);
			let guard: ReturnType<typeof setTimeout> | undefined;

			try {
				await vi.waitFor(() => expect(rejectLogicalDigest).toBeTypeOf('function'));
				if (expectedCode === 'cancelled') controller.abort(reason);
				const result = await Promise.race([
					outcome,
					new Promise<{ status: 'pending' }>((resolve) => {
						guard = setTimeout(() => resolve({ status: 'pending' }), 1_000);
					})
				]);

				expect(result.status).toBe('rejected');
				expect('reason' in result ? result.reason : undefined).toMatchObject({
					code: expectedCode,
					phase: 'asset',
					runtimeId: 'BQN',
					...(expectedCode === 'cancelled' ? { cause: reason } : {})
				});
				expect(workerInstances).toHaveLength(0);
				expect(
					vi
						.mocked(fetch)
						.mock.calls.map(([input]) => String(input))
						.some((url) => url.includes('/wasm-bqn/runner-worker.js'))
				).toBe(false);

				rejectLogicalDigest?.(new Error('late BQN logical digest failure'));
				await new Promise((resolve) => setTimeout(resolve, 0));
			} finally {
				if (guard) clearTimeout(guard);
				controller.abort(reason);
				rejectLogicalDigest?.(new Error('release BQN logical digest'));
				await load.catch(() => {});
				digest.mockRestore();
			}
		},
		15_000
	);

	it('preflights all Janet executable bytes before worker creation and reuses a prepared worker', async () => {
		const sandbox = new Janet();
		const runtimeAssets = {
			janet: {
				baseUrl: '/wasm-janet/',
				workerUrl: `/wasm-janet/runner-worker.js?v=${janetTestWorkerReceipt.sha256}`,
				manifestUrl: `/wasm-janet/runtime-manifest.v2.json?v=${janetTestManifestFingerprint}`,
				...janetTestProfile,
				workerReceipt: janetTestWorkerReceipt
			}
		};
		await sandbox.load(runtimeAssets);
		const warmFetchCount = vi.mocked(fetch).mock.calls.length;
		await sandbox.load(runtimeAssets);
		expect(fetch).toHaveBeenCalledTimes(warmFetchCount);
		await expect(
			sandbox.run('(print (getline))', false, true, undefined, [], {
				stdin: 'ok\n'
			})
		).resolves.toBe(true);

		await expectVerifiedWorkerBootstrap(
			workerInstances[0],
			`http://localhost:3000/wasm-janet/runner-worker.js?v=${janetTestWorkerReceipt.sha256}`,
			janetWorkerSource
		);
		expect(workerInstances[0].options).toEqual({ type: 'module' });
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				baseUrl: 'http://localhost:3000/wasm-janet/',
				manifestUrl: `http://localhost:3000/wasm-janet/runtime-manifest.v2.json?v=${janetTestManifestFingerprint}`,
				manifestFingerprint: janetTestManifestFingerprint,
				runtimePreflight: expect.objectContaining({
					protocol: 'wasm-idle-janet-preflight',
					protocolVersion: 1,
					profileId: janetTestProfile.profileId,
					artifactRevision: janetTestProfile.artifactRevision,
					janetVersion: janetTestProfile.janetVersion,
					emscriptenVersion: janetTestProfile.emscriptenVersion,
					manifestFingerprint: janetTestManifestFingerprint
				}),
				stdin: 'ok\n',
				activePath: 'main.janet'
			})
		);
		const runMessage = workerInstances[0].postMessage.mock.calls[0][0];
		expect(Array.from(runMessage.runtimePreflight.manifestBytes)).toEqual(
			Array.from(janetTestManifestBytes)
		);
		expect(Array.from(runMessage.runtimePreflight.javascriptBytes)).toEqual(
			Array.from(janetTestJavaScriptBytes)
		);
		expect(Array.from(runMessage.runtimePreflight.wasmBytes)).toEqual(
			Array.from(janetTestWasmBytes)
		);
		const workerEventIndex = runtimeLifecycleEvents.findIndex((event) =>
			event.startsWith('worker:')
		);
		for (const assetPath of [
			'runtime-manifest.v2.json',
			'janet.js',
			'janet.wasm.gz.bin',
			'runner-worker.js'
		]) {
			const fetchEventIndex = runtimeLifecycleEvents.findIndex(
				(event) => event.startsWith('fetch:') && event.includes(assetPath)
			);
			expect(fetchEventIndex).toBeGreaterThanOrEqual(0);
			expect(fetchEventIndex).toBeLessThan(workerEventIndex);
		}
		const janetRuntimePaths = runtimeLifecycleEvents
			.filter((event) => event.startsWith('fetch:') && event.includes('/wasm-janet/'))
			.map((event) => new URL(event.slice('fetch:'.length)).pathname);
		expect(janetRuntimePaths).toHaveLength(4);
		expect(janetRuntimePaths).not.toContain('/wasm-janet/janet.wasm.gz');
		expect(janetRuntimePaths).not.toContain('/wasm-janet/janet.wasm');
		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();

		await expect(
			sandbox.run('(print "second")', false, true, undefined, [], { stdin: '' })
		).resolves.toBe(true);
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				runtimePreflight: expect.objectContaining({
					manifestFingerprint: janetTestManifestFingerprint
				})
			})
		);
		expect(workerInstances[1].terminate).toHaveBeenCalledOnce();
		expect(sandbox.workerReceipt).toEqual(janetTestWorkerReceipt);
	});

	it('requires a complete profile and runner receipt for custom Janet runtime URLs', async () => {
		const sandbox = new Janet();

		await expect(
			sandbox.load({
				janet: {
					baseUrl: '/custom-janet/',
					workerUrl: '/custom-janet/runner-worker.js',
					manifestUrl: '/custom-janet/runtime-manifest.v2.json'
				}
			})
		).rejects.toMatchObject({
			code: 'runtime-configuration',
			runtimeId: 'JANET'
		});
		expect(fetch).not.toHaveBeenCalled();
		expect(workerInstances).toHaveLength(0);
	});

	it('rejects corrupt Janet Wasm storage before loading the runner or creating a worker', async () => {
		vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
			if (!String(input).includes('/wasm-janet/janet.wasm.gz.bin')) {
				return createStaticWorkerFetchResponse(input);
			}
			return new Response(Uint8Array.from([...janetTestWasmGzipBytes, 0]), {
				status: 200,
				headers: { 'content-type': 'application/octet-stream' }
			});
		});
		const sandbox = new Janet();

		await expect(
			sandbox.load({
				janet: {
					baseUrl: '/wasm-janet/',
					workerUrl: `/wasm-janet/runner-worker.js?v=${janetTestWorkerReceipt.sha256}`,
					manifestUrl: `/wasm-janet/runtime-manifest.v2.json?v=${janetTestManifestFingerprint}`,
					...janetTestProfile,
					workerReceipt: janetTestWorkerReceipt
				}
			})
		).rejects.toMatchObject({ code: 'asset-integrity', runtimeId: 'JANET' });
		expect(
			vi
				.mocked(fetch)
				.mock.calls.some(([input]) =>
					String(input).includes('/wasm-janet/runner-worker.js')
				)
		).toBe(false);
		expect(workerInstances).toHaveLength(0);
	});

	it('rejects a modified Janet runner before creating a worker', async () => {
		const modifiedSource = `x${janetWorkerSource.slice(1)}`;
		vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
			if (!String(input).includes('/wasm-janet/runner-worker.js')) {
				return createStaticWorkerFetchResponse(input);
			}
			return new Response(modifiedSource, {
				status: 200,
				headers: {
					'content-length': String(new TextEncoder().encode(modifiedSource).byteLength)
				}
			});
		});
		const sandbox = new Janet();

		await expect(
			sandbox.load({
				janet: {
					baseUrl: '/wasm-janet/',
					workerUrl: `/wasm-janet/runner-worker.js?v=${janetTestWorkerReceipt.sha256}`,
					manifestUrl: `/wasm-janet/runtime-manifest.v2.json?v=${janetTestManifestFingerprint}`,
					...janetTestProfile,
					workerReceipt: janetTestWorkerReceipt
				}
			})
		).rejects.toMatchObject({ code: 'asset-integrity', runtimeId: 'JANET' });
		expect(workerInstances).toHaveLength(0);
	});

	it('preflights Julia assets before the runner and transfers logical bytes exactly once', async () => {
		const sandbox = new Julia();
		const runtimeAssets = juliaTestRuntimeAssets();
		await sandbox.load(runtimeAssets);
		await sandbox.load(runtimeAssets);
		await expect(
			sandbox.run('println(readline())', false, true, undefined, [], {
				stdin: 'ok\n'
			})
		).resolves.toBe(true);

		await expectVerifiedWorkerBootstrap(
			workerInstances[0],
			'http://localhost:3000/wasm-julia/runner-worker.js?v=test',
			juliaWorkerSource
		);
		expect(workerInstances[0].options).toBeUndefined();
		expect(workerInstances[0].lastMessage).toMatchObject({
			baseUrl: 'http://localhost:3000/wasm-julia/',
			manifestUrl: `http://localhost:3000/wasm-julia/runtime-manifest.v2.json?v=${juliaTestManifestFingerprint}`,
			manifestFingerprint: juliaTestManifestFingerprint,
			stdin: 'ok\n',
			activePath: 'main.jl',
			runtimePreflight: expect.objectContaining({
				protocol: 'wasm-idle-julia-preflight',
				protocolVersion: 1,
				profileId: juliaTestProfile.profileId,
				packageRevision: juliaTestProfile.packageRevision,
				importedByCommit: juliaTestProfile.importedByCommit,
				juliaVersion: juliaTestProfile.juliaVersion,
				emscriptenVersion: juliaTestProfile.emscriptenVersion,
				manifestFingerprint: juliaTestManifestFingerprint
			})
		});
		const runtimePreflight = workerInstances[0].lastMessage.runtimePreflight;
		expect(Array.from(runtimePreflight.manifestBytes)).toEqual(
			Array.from(juliaTestManifestBytes)
		);
		expect(Array.from(runtimePreflight.javascriptBytes)).toEqual(
			Array.from(juliaTestJavaScriptBytes)
		);
		expect(Array.from(runtimePreflight.wasmBytes)).toEqual(Array.from(juliaTestWasmBytes));
		expect(Array.from(runtimePreflight.dataBytes)).toEqual(Array.from(juliaTestDataBytes));
		expect(workerInstances[0].lastTransferList).toHaveLength(4);
		expect(new Set(workerInstances[0].lastTransferList).size).toBe(4);
		expect(
			workerInstances[0].lastTransferList?.every(
				(transferable) =>
					transferable instanceof ArrayBuffer && transferable.byteLength === 0
			)
		).toBe(true);
		const juliaRequests = vi
			.mocked(fetch)
			.mock.calls.map(([input]) => String(input))
			.filter((url) => url.includes('/wasm-julia/'));
		const expectedJuliaRequests = [
			`http://localhost:3000/wasm-julia/runtime-manifest.v2.json?v=${juliaTestManifestFingerprint}`,
			`http://localhost:3000/wasm-julia/julia.js.gz.bin?v=${juliaTestProfile.javascriptReceipt.sha256}`,
			`http://localhost:3000/wasm-julia/julia.wasm.gz.bin?v=${juliaTestProfile.wasmReceipt.sha256}`,
			`http://localhost:3000/wasm-julia/julia.data.gz.bin?v=${juliaTestProfile.dataReceipt.sha256}`,
			'http://localhost:3000/wasm-julia/runner-worker.js?v=test'
		];
		expect(juliaRequests).toHaveLength(expectedJuliaRequests.length);
		expect(new Set(juliaRequests)).toEqual(new Set(expectedJuliaRequests));
		expect(juliaRequests.some((url) => /julia\.(?:js|wasm|data)\.gz(?:\?|$)/u.test(url))).toBe(
			false
		);
		expect(sandbox.workerReceipt).toEqual(juliaTestWorkerReceipt);
		const runnerFetchIndex = runtimeLifecycleEvents.indexOf(
			`fetch:${expectedJuliaRequests[4]}`
		);
		for (const runtimeAssetUrl of expectedJuliaRequests.slice(0, 4)) {
			expect(runtimeLifecycleEvents.indexOf(`fetch:${runtimeAssetUrl}`)).toBeLessThan(
				runnerFetchIndex
			);
		}
		expect(workerInstances).toHaveLength(1);
	});

	it('retires a Julia worker after a transferred dispatch failure and retries with fresh bytes', async () => {
		const sandbox = new Julia();
		await sandbox.load(juliaTestRuntimeAssets());
		const dispatchCause = new DOMException('Value could not be cloned', 'DataCloneError');
		let dispatches = 0;
		onPostMessage = (worker) => {
			dispatches += 1;
			if (dispatches === 1) throw dispatchCause;
			queueMicrotask(() =>
				worker.onmessage?.({
					data: { runId: worker.lastRunId, results: true }
				} as MessageEvent<any>)
			);
		};

		await expect(
			sandbox.run('println(1)', false, true, undefined, [], { stdin: '' })
		).rejects.toMatchObject({
			code: 'protocol',
			runtimeId: 'JULIA',
			cause: dispatchCause
		});
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
		expect(hasRuntimePreflightForWorker(sandbox, workerInstances[0])).toBe(false);
		const firstTransferList = workerInstances[0].lastTransferList!;
		expect(firstTransferList.every((value) => (value as ArrayBuffer).byteLength === 0)).toBe(
			true
		);

		await expect(
			sandbox.run('println(2)', false, true, undefined, [], { stdin: '' })
		).resolves.toBe(true);
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1].lastTransferList).toHaveLength(4);
		expect(workerInstances[1].lastTransferList).not.toBe(firstTransferList);
		expect(Array.from(workerInstances[1].lastMessage.runtimePreflight.dataBytes)).toEqual(
			Array.from(juliaTestDataBytes)
		);
		const manifestRequests = vi
			.mocked(fetch)
			.mock.calls.filter(([input]) => String(input).includes('runtime-manifest.v2.json'));
		expect(manifestRequests).toHaveLength(2);
	});

	it('retires a timed-out Julia worker and re-preflights before the next run', async () => {
		onPostMessage = () => {};
		const sandbox = new Julia();
		await sandbox.load(juliaTestRuntimeAssets());

		await expect(
			sandbox.run('println(1)', false, true, undefined, [], {
				stdin: '',
				limits: { compileTimeoutMs: 5, runTimeoutMs: 5 }
			})
		).rejects.toMatchObject({ code: 'timeout', runtimeId: 'JULIA' });
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
		expect(hasRuntimePreflightForWorker(sandbox, workerInstances[0])).toBe(false);
		onPostMessage = null;

		await expect(
			sandbox.run('println(2)', false, true, undefined, [], { stdin: '' })
		).resolves.toBe(true);
		expect(workerInstances).toHaveLength(2);
		const manifestRequests = vi
			.mocked(fetch)
			.mock.calls.filter(([input]) => String(input).includes('runtime-manifest.v2.json'));
		expect(manifestRequests).toHaveLength(2);
	});

	it('clears an unconsumed Julia preflight when its worker is terminated', async () => {
		const sandbox = new Julia();
		await sandbox.load(juliaTestRuntimeAssets());
		const worker = workerInstances[0];
		expect(hasRuntimePreflightForWorker(sandbox, worker)).toBe(true);

		sandbox.terminate();

		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(hasRuntimePreflightForWorker(sandbox, worker)).toBe(false);
	});

	it('retires an aborted Julia worker after transfer and retries with fresh bytes', async () => {
		onPostMessage = () => {};
		const sandbox = new Julia();
		const controller = new AbortController();
		await sandbox.load(juliaTestRuntimeAssets());
		const run = sandbox.run('println(1)', false, true, undefined, [], {
			stdin: '',
			signal: controller.signal
		});
		const outcome = run.catch((error) => error);
		await vi.waitFor(() => expect(workerInstances[0].lastTransferList).toHaveLength(4));

		controller.abort(new Error('cancel transferred Julia run'));
		await expect(outcome).resolves.toMatchObject({
			code: 'cancelled',
			phase: 'execute',
			runtimeId: 'JULIA'
		});
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
		onPostMessage = null;

		await expect(
			sandbox.run('println(2)', false, true, undefined, [], { stdin: '' })
		).resolves.toBe(true);
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1].lastTransferList).toHaveLength(4);
		const manifestRequests = vi
			.mocked(fetch)
			.mock.calls.filter(([input]) => String(input).includes('runtime-manifest.v2.json'));
		expect(manifestRequests).toHaveLength(2);
	});

	it('adopts every owned preflight buffer without copying and consumes the ticket once', async () => {
		const payloads: ReturnType<typeof createOwnedPreflightTestPayload>[] = [];
		const sandbox = createOwnedPreflightTestSandbox((context) => {
			const payload = createOwnedPreflightTestPayload();
			payloads.push(payload);
			return context.createOwnedDelivery(payload);
		});

		await sandbox.load('/owned-preflight-test');
		const payload = payloads[0];
		const manifestBuffer = payload.manifestBytes.buffer;
		const wasmBuffer = payload.wasmBytes.buffer;
		await expect(sandbox.run('run', false, true, undefined, [])).resolves.toBe(true);

		expect(workerInstances[0].lastTransferList).toEqual([manifestBuffer, wasmBuffer]);
		expect(workerInstances[0].lastTransferList?.[0]).toBe(manifestBuffer);
		expect(workerInstances[0].lastTransferList?.[1]).toBe(wasmBuffer);
		expect(payload.manifestBytes.byteLength).toBe(0);
		expect(payload.wasmBytes.byteLength).toBe(0);
		expect(hasRuntimePreflightForWorker(sandbox, workerInstances[0])).toBe(false);
	});

	it('rejects invalid owned preflight payload roots and binary ownership', async () => {
		const duplicateBuffer = new ArrayBuffer(4);
		const accessor = vi.fn(() => Uint8Array.from([1]));
		const accessorPayload = Object.freeze(
			Object.defineProperty({ protocol: 'fixture' }, 'bytes', {
				enumerable: true,
				get: accessor
			})
		);
		const symbolKey = Symbol('unexpected');
		const invalidPayloads: [string, unknown][] = [
			['unfrozen root', { bytes: Uint8Array.from([1]) }],
			['empty bytes', Object.freeze({ bytes: new Uint8Array(0) })],
			['partial view', Object.freeze({ bytes: new Uint8Array(new ArrayBuffer(4), 1, 2) })],
			[
				'duplicate buffer',
				Object.freeze({
					firstBytes: new Uint8Array(duplicateBuffer),
					secondBytes: new Uint8Array(duplicateBuffer)
				})
			],
			['direct buffer', Object.freeze({ bytes: new ArrayBuffer(1) })],
			['other view', Object.freeze({ bytes: new DataView(new ArrayBuffer(1)) })],
			['nested object', Object.freeze({ bytes: Uint8Array.from([1]), nested: {} })],
			['accessor', accessorPayload],
			[
				'symbol key',
				Object.freeze({ bytes: Uint8Array.from([1]), [symbolKey]: 'unexpected' })
			],
			['no binary values', Object.freeze({ protocol: 'fixture' })]
		];
		if (typeof SharedArrayBuffer === 'function') {
			invalidPayloads.push([
				'shared buffer',
				Object.freeze({ bytes: new Uint8Array(new SharedArrayBuffer(1)) })
			]);
		}

		for (const [label, payload] of invalidPayloads) {
			const sandbox = createOwnedPreflightTestSandbox((context) =>
				context.createOwnedDelivery(payload)
			);
			await expect(sandbox.load('/owned-preflight-test'), label).rejects.toMatchObject({
				code: 'runtime-configuration',
				runtimeId: 'OWNED_PREFLIGHT_TEST'
			});
		}
		expect(accessor).not.toHaveBeenCalled();
		expect(workerInstances).toHaveLength(0);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('invalidates the first owned delivery when a preflight context claims twice', async () => {
		const sandbox = createOwnedPreflightTestSandbox((context) => {
			const first = context.createOwnedDelivery(createOwnedPreflightTestPayload());
			expect(() => context.createOwnedDelivery(createOwnedPreflightTestPayload())).toThrow();
			return first;
		});

		await expect(sandbox.load('/owned-preflight-test')).rejects.toMatchObject({
			code: 'runtime-configuration',
			runtimeId: 'OWNED_PREFLIGHT_TEST'
		});
		expect(fetch).not.toHaveBeenCalled();
		expect(workerInstances).toHaveLength(0);
	});

	it('rejects raw payloads in transfer-owned mode and owned tickets in clone mode', async () => {
		const rawSandbox = createOwnedPreflightTestSandbox(() => createOwnedPreflightTestPayload());
		await expect(rawSandbox.load('/owned-preflight-test')).rejects.toMatchObject({
			code: 'runtime-configuration',
			runtimeId: 'OWNED_PREFLIGHT_TEST'
		});

		const cloneSandbox = new StaticWorkerRuntimeSandbox({
			languageId: 'CLONE_PREFLIGHT_TEST',
			displayName: 'Clone preflight test',
			defaultActivePath: 'main.txt',
			stdin: { mode: 'none' },
			resolveRuntimeAssets: () => ({
				baseUrl: '/clone-preflight-test/',
				workerUrl: '/clone-preflight-test/worker.js',
				preflightKey: 'clone-preflight-test-v1'
			}),
			preflightRuntimeAssets: (_urls, context) =>
				context.createOwnedDelivery(createOwnedPreflightTestPayload())
		});
		await expect(cloneSandbox.load('/clone-preflight-test')).rejects.toMatchObject({
			code: 'runtime-configuration',
			runtimeId: 'CLONE_PREFLIGHT_TEST'
		});
		expect(fetch).not.toHaveBeenCalled();
		expect(workerInstances).toHaveLength(0);
	});

	it('retires a claimed ticket when its callback throws or returns a plain payload', async () => {
		for (const outcome of ['throw', 'plain'] as const) {
			let retiredTicket: unknown;
			const sandbox = createOwnedPreflightTestSandbox((context) => {
				const payload = createOwnedPreflightTestPayload();
				retiredTicket = context.createOwnedDelivery(payload);
				if (outcome === 'throw') throw new Error('fixture preflight failure');
				return payload;
			});
			await expect(sandbox.load('/owned-preflight-test')).rejects.toBeDefined();

			const retry = createOwnedPreflightTestSandbox(() => retiredTicket);
			await expect(retry.load('/owned-preflight-test')).rejects.toMatchObject({
				code: 'runtime-configuration',
				runtimeId: 'OWNED_PREFLIGHT_TEST'
			});
		}
		expect(fetch).not.toHaveBeenCalled();
		expect(workerInstances).toHaveLength(0);
	});

	it('invalidates a preflight context factory when its worker generation is retired', async () => {
		let preflightContext: StaticWorkerRuntimePreflightContext | undefined;
		let releasePreflight!: () => void;
		const preflightGate = new Promise<void>((resolve) => {
			releasePreflight = resolve;
		});
		const sandbox = createOwnedPreflightTestSandbox(async (context) => {
			preflightContext = context;
			await preflightGate;
			return context.createOwnedDelivery(createOwnedPreflightTestPayload());
		});
		const load = sandbox.load('/owned-preflight-test');
		const outcome = load.catch((error) => error);
		await vi.waitFor(() => expect(preflightContext).toBeDefined());

		sandbox.terminate();
		expect(() =>
			preflightContext!.createOwnedDelivery(createOwnedPreflightTestPayload())
		).toThrow('runtime preflight delivery operation is stale');
		releasePreflight();
		await expect(outcome).resolves.toBeDefined();
		expect(fetch).not.toHaveBeenCalled();
		expect(workerInstances).toHaveLength(0);
	});

	it('preserves one-argument postMessage for structured-clone preflight payloads', async () => {
		const sandbox = new StaticWorkerRuntimeSandbox({
			languageId: 'CLONE_PREFLIGHT_DISPATCH_TEST',
			displayName: 'Clone preflight dispatch test',
			defaultActivePath: 'main.txt',
			stdin: { mode: 'none' },
			resolveRuntimeAssets: () => ({
				baseUrl: '/clone-preflight-dispatch-test/',
				workerUrl: '/clone-preflight-dispatch-test/worker.js'
			}),
			preflightRuntimeAssets: () => Object.freeze({ bytes: Uint8Array.from([1, 2, 3]) })
		});
		await sandbox.load('/clone-preflight-dispatch-test');
		await expect(sandbox.run('run', false, true, undefined, [])).resolves.toBe(true);

		expect(workerInstances[0].postMessage).toHaveBeenCalledOnce();
		expect(workerInstances[0].postMessage.mock.calls[0]).toHaveLength(1);
		expect(workerInstances[0].lastTransferList).toBeUndefined();
	});

	it('rejects an owned ticket created for another runtime operation', async () => {
		let foreignTicket: unknown;
		const first = createOwnedPreflightTestSandbox(
			(context) => {
				foreignTicket = context.createOwnedDelivery(createOwnedPreflightTestPayload());
				return foreignTicket;
			},
			{ languageId: 'OWNED_PREFLIGHT_FIRST', preflightKey: 'first-profile' }
		);
		await first.load('/owned-preflight-first');

		const second = createOwnedPreflightTestSandbox(() => foreignTicket, {
			languageId: 'OWNED_PREFLIGHT_SECOND',
			preflightKey: 'second-profile'
		});
		await expect(second.load('/owned-preflight-second')).rejects.toMatchObject({
			code: 'runtime-configuration',
			runtimeId: 'OWNED_PREFLIGHT_SECOND'
		});
		first.terminate();
	});

	it('rejects an owned ticket after its first dispatch consumed it', async () => {
		let consumedTicket: unknown;
		const first = createOwnedPreflightTestSandbox((context) => {
			consumedTicket = context.createOwnedDelivery(createOwnedPreflightTestPayload());
			return consumedTicket;
		});
		await first.load('/owned-preflight-test');
		await expect(first.run('run', false, true, undefined, [])).resolves.toBe(true);

		const second = createOwnedPreflightTestSandbox(() => consumedTicket);
		await expect(second.load('/owned-preflight-test')).rejects.toMatchObject({
			code: 'runtime-configuration',
			runtimeId: 'OWNED_PREFLIGHT_TEST'
		});
	});

	it('rejects transfer-owned delivery for persistent workers', () => {
		expect(
			() =>
				new StaticWorkerRuntimeSandbox({
					languageId: 'INVALID_TRANSFER_TEST',
					displayName: 'Invalid transfer test',
					defaultActivePath: 'main.txt',
					stdin: { mode: 'none' },
					workerLifetime: {
						mode: 'persistent',
						idleTimeoutMs: 1_000,
						evictOnMemoryPressure: false
					},
					resolveRuntimeAssets: () => ({
						baseUrl: '/invalid-transfer-test/',
						workerUrl: '/invalid-transfer-test/worker.js'
					}),
					preflightRuntimeAssets: (_urls, context) =>
						context.createOwnedDelivery(Object.freeze({ bytes: Uint8Array.from([1]) })),
					runtimePreflightDelivery: 'transfer-owned'
				})
		).toThrow('transfer-owned runtime preflight requires per-run workers');
	});

	it('rejects transfer-owned delivery without a runtime preflight callback', () => {
		expect(
			() =>
				new StaticWorkerRuntimeSandbox({
					languageId: 'MISSING_PREFLIGHT_TEST',
					displayName: 'Missing preflight test',
					defaultActivePath: 'main.txt',
					stdin: { mode: 'none' },
					workerLifetime: { mode: 'per-run' },
					resolveRuntimeAssets: () => ({
						baseUrl: '/missing-preflight-test/',
						workerUrl: '/missing-preflight-test/worker.js'
					}),
					runtimePreflightDelivery: 'transfer-owned'
				})
		).toThrow('transfer-owned runtime preflight requires a runtime preflight callback');
	});

	it('ignores a second bootstrap run correlation until the active run terminates', async () => {
		const sandbox = createPersistentTestSandbox();
		await sandbox.load('/persistent-test');
		const bootstrap = workerBootstrapBlobs.get(workerInstances[0].url);
		expect(bootstrap).toBeDefined();
		const source = await bootstrap!.text();
		const nativePostMessage = vi.fn();
		const workerScope = new EventTarget() as EventTarget & {
			postMessage: (message: unknown, transferOrOptions?: unknown) => void;
		};
		workerScope.postMessage = nativePostMessage;
		const runHandler = vi.fn();
		const importScripts = vi.fn(() => workerScope.addEventListener('message', runHandler));
		new Function('self', 'importScripts', source)(workerScope, importScripts);

		workerScope.dispatchEvent(
			new MessageEvent('message', { data: { run: true, runId: 'run-1' } })
		);
		workerScope.dispatchEvent(
			new MessageEvent('message', { data: { run: true, runId: 'run-2' } })
		);
		expect(runHandler).toHaveBeenCalledTimes(1);
		expect(runHandler.mock.calls[0]?.[0]).toMatchObject({ data: { runId: 'run-1' } });

		workerScope.postMessage({ results: true });
		expect(nativePostMessage).toHaveBeenLastCalledWith({ results: true, runId: 'run-1' });
		workerScope.dispatchEvent(
			new MessageEvent('message', { data: { run: true, runId: 'run-3' } })
		);
		expect(runHandler).toHaveBeenCalledTimes(2);
		expect(runHandler.mock.calls[1]?.[0]).toMatchObject({ data: { runId: 'run-3' } });
		workerScope.postMessage({ error: 'done' });
		expect(nativePostMessage).toHaveBeenLastCalledWith({ error: 'done', runId: 'run-3' });
		await sandbox.dispose();
	});

	it('rejects a modified Julia runner before creating a worker', async () => {
		const modifiedSource = `x${juliaWorkerSource.slice(1)}`;
		vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
			if (!String(input).includes('/wasm-julia/runner-worker.js')) {
				return createStaticWorkerFetchResponse(input);
			}
			return new Response(modifiedSource, {
				status: 200,
				headers: {
					'content-length': String(new TextEncoder().encode(modifiedSource).byteLength)
				}
			});
		});
		const sandbox = new Julia();

		await expect(sandbox.load(juliaTestRuntimeAssets())).rejects.toMatchObject({
			code: 'asset-integrity',
			runtimeId: 'JULIA'
		});
		expect(workerInstances).toHaveLength(0);
	});

	it('rejects corrupt Julia runtime storage before fetching the runner', async () => {
		vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
			if (!String(input).includes('/wasm-julia/julia.data.gz.bin')) {
				return createStaticWorkerFetchResponse(input);
			}
			return new Response(Uint8Array.from([...juliaTestDataGzipBytes, 0]), {
				status: 200,
				headers: {
					'content-length': String(juliaTestDataGzipBytes.byteLength + 1),
					'content-type': 'application/octet-stream'
				}
			});
		});
		const sandbox = new Julia();

		await expect(sandbox.load(juliaTestRuntimeAssets())).rejects.toMatchObject({
			code: 'asset-integrity',
			runtimeId: 'JULIA'
		});
		expect(
			vi
				.mocked(fetch)
				.mock.calls.some(([input]) => String(input).includes('/runner-worker.js'))
		).toBe(false);
		expect(workerInstances).toHaveLength(0);
	});

	it('rejects custom Julia runtime urls without replacement integrity pins', async () => {
		const sandbox = new Julia();

		await expect(
			sandbox.load({
				julia: {
					baseUrl: 'https://runtime.example.com/julia/',
					workerUrl: 'https://runtime.example.com/julia/runner.js',
					manifestUrl: 'https://runtime.example.com/julia/manifest.json'
				}
			})
		).rejects.toMatchObject({
			code: 'runtime-configuration',
			runtimeId: 'JULIA'
		});
		expect(fetch).not.toHaveBeenCalled();
		expect(workerInstances).toHaveLength(0);
	});

	it('preflights every Nim asset before the runner and transfers nine logical buffers once', async () => {
		const sandbox = new Nim();
		const runtimeAssets = nimTestRuntimeAssets();
		await sandbox.load(runtimeAssets);
		await sandbox.load(runtimeAssets);
		await expect(
			sandbox.run('echo stdin.readLine()', false, true, undefined, ['demo'], {
				stdin: 'ok\n'
			})
		).resolves.toBe(true);

		await expectVerifiedWorkerBootstrap(
			workerInstances[0],
			'http://localhost:3000/wasm-nim/runner-worker.js?v=test',
			nimWorkerSource
		);
		expect(workerInstances[0].lastMessage).toMatchObject({
			baseUrl: 'http://localhost:3000/wasm-nim/',
			manifestUrl: `http://localhost:3000/wasm-nim/runtime-manifest.v2.json?v=${nimTestManifestFingerprint}`,
			manifestFingerprint: nimTestManifestFingerprint,
			args: ['demo'],
			stdin: 'ok\n',
			activePath: 'main.nim',
			runtimePreflight: expect.objectContaining({
				protocol: 'wasm-idle-nim-preflight',
				protocolVersion: 1,
				profileId: nimTestProfile.profileId,
				artifactRevision: nimTestProfile.artifactRevision,
				nimRevision: nimTestProfile.nimRevision,
				llvmRevision: nimTestProfile.llvmRevision,
				memfsRevision: nimTestProfile.memfsRevision,
				emscriptenRevision: nimTestProfile.emscriptenRevision,
				manifestFingerprint: nimTestManifestFingerprint
			})
		});
		const runtimePreflight = workerInstances[0].lastMessage.runtimePreflight;
		expect(Array.from(runtimePreflight.manifestBytes)).toEqual(
			Array.from(nimTestManifestBytes)
		);
		for (const [property, logicalPath] of [
			['nimJavaScriptBytes', 'nim/nim-bundle.js'],
			['nimWasmBytes', 'nim/nim.wasm'],
			['nimbaseBytes', 'nim/nimbase.h'],
			['clangJavaScriptBytes', 'clang/clang.js'],
			['clangWasmBytes', 'clang/clang.wasm'],
			['lldWasmBytes', 'clang/lld.wasm'],
			['memfsWasmBytes', 'clang/memfs.wasm'],
			['sysrootBytes', 'clang/sysroot.tar']
		] as const) {
			expect(Array.from(runtimePreflight[property])).toEqual(
				Array.from(nimTestLogicalBytes[logicalPath]!)
			);
		}
		expect(workerInstances[0].lastTransferList).toHaveLength(9);
		expect(new Set(workerInstances[0].lastTransferList).size).toBe(9);
		expect(
			workerInstances[0].lastTransferList?.every(
				(transferable) =>
					transferable instanceof ArrayBuffer && transferable.byteLength === 0
			)
		).toBe(true);
		const expectedNimRequests = [
			`http://localhost:3000/wasm-nim/runtime-manifest.v2.json?v=${nimTestManifestFingerprint}`,
			...Object.entries(nimTestStorageBytes).map(([path]) => {
				const logicalPath = nimTestManifestWithoutFingerprint.storage.find(
					(storage: { path: string }) => storage.path === path
				)!.logicalPath;
				return `http://localhost:3000/wasm-nim/${path}?v=${nimTestReceipt(logicalPath).sha256}`;
			}),
			'http://localhost:3000/wasm-nim/runner-worker.js?v=test'
		];
		const nimRequests = vi
			.mocked(fetch)
			.mock.calls.map(([input]) => String(input))
			.filter((url) => url.includes('/wasm-nim/'));
		expect(nimRequests).toHaveLength(10);
		expect(new Set(nimRequests)).toEqual(new Set(expectedNimRequests));
		expect(
			nimRequests.some((url) =>
				/(?:\.gz|\/nimbase\.h|\/clang\.js)(?:\?|$)/u.test(new URL(url).pathname)
			)
		).toBe(false);
		const runnerFetchIndex = runtimeLifecycleEvents.indexOf(`fetch:${expectedNimRequests[9]}`);
		for (const runtimeAssetUrl of expectedNimRequests.slice(0, 9)) {
			expect(runtimeLifecycleEvents.indexOf(`fetch:${runtimeAssetUrl}`)).toBeLessThan(
				runnerFetchIndex
			);
		}
		expect(runnerFetchIndex).toBeLessThan(
			runtimeLifecycleEvents.findIndex((event) => event.startsWith('worker:'))
		);
		expect(sandbox.workerReceipt).toEqual(nimTestWorkerReceipt);
		expect(workerInstances).toHaveLength(1);
	});

	it('rejects a modified Nim runner before creating a worker', async () => {
		const modifiedSource = `x${nimWorkerSource.slice(1)}`;
		vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
			if (!String(input).includes('/wasm-nim/runner-worker.js')) {
				return createStaticWorkerFetchResponse(input);
			}
			return new Response(modifiedSource, {
				status: 200,
				headers: {
					'content-length': String(new TextEncoder().encode(modifiedSource).byteLength)
				}
			});
		});
		const sandbox = new Nim();

		await expect(sandbox.load(nimTestRuntimeAssets())).rejects.toMatchObject({
			code: 'asset-integrity',
			runtimeId: 'NIM'
		});
		expect(workerInstances).toHaveLength(0);
	});

	it('rejects corrupt Nim storage before loading the runner or creating a worker', async () => {
		vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
			if (!String(input).includes('/wasm-nim/clang/sysroot.tar.gz.bin')) {
				return createStaticWorkerFetchResponse(input);
			}
			const corrupted = Uint8Array.from([
				...nimTestStorageBytes['clang/sysroot.tar.gz.bin']!,
				0
			]);
			return new Response(corrupted, {
				status: 200,
				headers: {
					'content-length': String(corrupted.byteLength),
					'content-type': 'application/octet-stream'
				}
			});
		});
		const sandbox = new Nim();

		await expect(sandbox.load(nimTestRuntimeAssets())).rejects.toMatchObject({
			code: 'asset-too-large',
			runtimeId: 'NIM'
		});
		expect(
			vi
				.mocked(fetch)
				.mock.calls.some(([input]) => String(input).includes('/runner-worker.js'))
		).toBe(false);
		expect(workerInstances).toHaveLength(0);
	});

	it('retires a Nim worker after transferred dispatch failure and preflights fresh bytes', async () => {
		const sandbox = new Nim();
		await sandbox.load(nimTestRuntimeAssets());
		const dispatchCause = new DOMException('Value could not be cloned', 'DataCloneError');
		let dispatches = 0;
		onPostMessage = (worker) => {
			dispatches += 1;
			if (dispatches === 1) throw dispatchCause;
			queueMicrotask(() =>
				worker.onmessage?.({
					data: { runId: worker.lastRunId, results: true }
				} as MessageEvent<any>)
			);
		};

		await expect(
			sandbox.run('echo 1', false, true, undefined, [], { stdin: '' })
		).rejects.toMatchObject({ code: 'protocol', runtimeId: 'NIM', cause: dispatchCause });
		expect(workerInstances[0].lastTransferList).toHaveLength(9);
		expect(
			workerInstances[0].lastTransferList?.every(
				(value) => (value as ArrayBuffer).byteLength === 0
			)
		).toBe(true);
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
		expect(hasRuntimePreflightForWorker(sandbox, workerInstances[0])).toBe(false);

		await expect(
			sandbox.run('echo 2', false, true, undefined, [], { stdin: '' })
		).resolves.toBe(true);
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1].lastTransferList).toHaveLength(9);
		expect(workerInstances[1].lastTransferList).not.toBe(workerInstances[0].lastTransferList);
		const manifestRequests = vi
			.mocked(fetch)
			.mock.calls.filter(([input]) => String(input).includes('runtime-manifest.v2.json'));
		expect(manifestRequests).toHaveLength(2);
	});

	it('rejects custom Nim runtime urls without replacement integrity pins', async () => {
		const sandbox = new Nim();

		await expect(
			sandbox.load({
				nim: {
					baseUrl: 'https://runtime.example.com/nim/',
					workerUrl: 'https://runtime.example.com/nim/runner.js',
					manifestUrl: 'https://runtime.example.com/nim/manifest.json'
				}
			})
		).rejects.toMatchObject({
			code: 'runtime-configuration',
			runtimeId: 'NIM'
		});
		expect(fetch).not.toHaveBeenCalled();
		expect(workerInstances).toHaveLength(0);
	});

	it('resets reused progress sinks and keeps each lifecycle monotonic', async () => {
		onPostMessage = (worker, message) => {
			queueMicrotask(() => {
				worker.onmessage?.({
					data: {
						runId: message.runId,
						progress: { percent: 70, stage: 'Compiling and linking Nim output' }
					}
				} as MessageEvent<any>);
				worker.onmessage?.({
					data: {
						runId: message.runId,
						progress: { percent: 20, stage: 'Late stale progress' }
					}
				} as MessageEvent<any>);
				worker.onmessage?.({
					data: { runId: message.runId, results: true }
				} as MessageEvent<any>);
			});
		};
		const progress = { set: vi.fn() };
		const sandbox = new Nim();
		const runtimeAssets = nimTestRuntimeAssets();
		await sandbox.load(runtimeAssets, '', true, [], {}, progress);
		const loadCalls = progress.set.mock.calls.slice();
		expect(loadCalls[0]).toEqual([0, 'Resolving Nim runtime']);
		const loadValues = loadCalls.map(([value]) => value as number);
		expect(loadValues).toEqual([...loadValues].sort((left, right) => left - right));
		expect(Math.max(...loadValues)).toBeLessThan(1);

		const prepareStart = progress.set.mock.calls.length;
		await expect(sandbox.run('echo "ok"', true, true, progress)).resolves.toBe(true);
		const prepareCalls = progress.set.mock.calls.slice(prepareStart);
		expect(prepareCalls[0]).toEqual([0, 'Preparing Nim runtime']);
		const prepareValues = prepareCalls.map(([value]) => value as number);
		expect(prepareValues).toEqual([...prepareValues].sort((left, right) => left - right));
		expect(prepareValues.at(-1)).toBe(0.25);
		expect(workerInstances).toHaveLength(1);
		const repeatedLoadProgress = { set: vi.fn() };
		await sandbox.load(runtimeAssets, '', true, [], {}, repeatedLoadProgress);
		expect(repeatedLoadProgress.set).not.toHaveBeenCalled();

		const firstRunStart = progress.set.mock.calls.length;
		await expect(sandbox.run('echo "ok"', false, true, progress)).resolves.toBe(true);
		const firstRunCalls = progress.set.mock.calls.slice(firstRunStart);
		expect(firstRunCalls[0]).toEqual([0, 'Starting Nim run']);
		const compileProgress = firstRunCalls.find(
			([, stage]) => stage === 'Compiling and linking Nim output'
		);
		expect(compileProgress?.[0]).toBeCloseTo(0.755);
		expect(progress.set).not.toHaveBeenCalledWith(expect.any(Number), 'Late stale progress');
		const firstRunValues = firstRunCalls.map(([value]) => value as number);
		expect(firstRunValues).toEqual([...firstRunValues].sort((left, right) => left - right));
		expect(firstRunValues.at(-1)).toBe(1);

		const secondRunStart = progress.set.mock.calls.length;
		await expect(sandbox.run('echo "again"', false, true, progress)).resolves.toBe(true);
		const secondRunCalls = progress.set.mock.calls.slice(secondRunStart);
		expect(secondRunCalls[0]).toEqual([0, 'Starting Nim run']);
		const secondRunValues = secondRunCalls.map(([value]) => value as number);
		expect(secondRunValues).toEqual([...secondRunValues].sort((left, right) => left - right));
		expect(secondRunValues.some((value) => value > 0 && value < 1)).toBe(true);
		expect(secondRunValues.at(-1)).toBe(1);
		expect(workerInstances).toHaveLength(2);
	});

	it('reuses a successful persistent worker until its renewed idle deadline', async () => {
		vi.useFakeTimers();
		const sandbox = createPersistentTestSandbox();
		await sandbox.load('/persistent-v1');
		const worker = workerInstances[0];

		await expect(sandbox.run('first', false)).resolves.toBe(true);
		const firstRunId = worker.lastRunId;
		vi.advanceTimersByTime(PERSISTENT_TEST_IDLE_TIMEOUT_MS / 2);
		await expect(sandbox.run('second', false)).resolves.toBe(true);
		const secondRunId = worker.lastRunId;

		expect(workerInstances).toEqual([worker]);
		expect(firstRunId).not.toBe(secondRunId);
		expect(worker.terminate).not.toHaveBeenCalled();
		vi.advanceTimersByTime(PERSISTENT_TEST_IDLE_TIMEOUT_MS / 2);
		expect(worker.terminate).not.toHaveBeenCalled();
		vi.advanceTimersByTime(PERSISTENT_TEST_IDLE_TIMEOUT_MS / 2 - 1);
		expect(worker.terminate).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(worker.terminate).toHaveBeenCalledOnce();

		await expect(sandbox.run('replacement', false)).resolves.toBe(true);
		expect(workerInstances).toHaveLength(2);
		await sandbox.dispose();
		expect(workerInstances[1].terminate).toHaveBeenCalledOnce();
	});

	it('discards failed persistent workers before the next run', async () => {
		const sandbox = createPersistentTestSandbox();
		await sandbox.load('/persistent-v1');
		const failedWorker = workerInstances[0];
		onPostMessage = (worker, message) => {
			queueMicrotask(() => {
				worker.onmessage?.({
					data: { runId: message.runId, error: 'persistent run failed' }
				} as MessageEvent<any>);
			});
		};

		await expect(sandbox.run('first', false)).rejects.toBe('persistent run failed');
		expect(failedWorker.terminate).toHaveBeenCalledOnce();

		onPostMessage = null;
		await expect(sandbox.run('second', false)).resolves.toBe(true);
		expect(workerInstances).toHaveLength(2);
		await sandbox.dispose();
	});

	it.each([
		[
			'an idle script crash',
			(worker: MockWorker) => {
				worker.onerror?.({
					message: 'idle worker crashed',
					preventDefault: vi.fn()
				} as unknown as ErrorEvent);
			}
		],
		[
			'an idle message error',
			(worker: MockWorker) => {
				worker.onmessageerror?.({} as MessageEvent<any>);
			}
		]
	])('retires a persistent worker after %s', async (_label, failWorker) => {
		const sandbox = createPersistentTestSandbox();
		await sandbox.load('/persistent-v1');
		const failedWorker = workerInstances[0];

		failWorker(failedWorker);
		expect(failedWorker.terminate).toHaveBeenCalledOnce();

		await expect(sandbox.run('replacement', false)).resolves.toBe(true);
		expect(workerInstances).toHaveLength(2);
		await sandbox.dispose();
	});

	it('evicts an idle persistent worker on memory pressure or runtime replacement', async () => {
		const sandbox = createPersistentTestSandbox();
		await sandbox.load('/persistent-v1');
		const pressureEvicted = workerInstances[0];

		expect(sandbox.handleMemoryPressure()).toBe(1);
		expect(sandbox.handleMemoryPressure()).toBe(0);
		expect(pressureEvicted.terminate).toHaveBeenCalledOnce();

		await sandbox.load('/persistent-v1');
		const replaced = workerInstances[1];
		await sandbox.load('/persistent-v2');
		expect(replaced.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(3);
		await sandbox.dispose();
		expect(workerInstances[2].terminate).toHaveBeenCalledOnce();
	});

	it('settles a throwing worker-ready callback and ignores the retired worker during retry', async () => {
		autoStartWorkers = false;
		const callbackError = new Error('worker-ready progress failed');
		const cleanupError = new Error('startup listener cleanup failed');
		const controller = new AbortController();
		let throwOnReady = true;
		const progress = {
			set: vi.fn((_value: number, stage?: string) => {
				if (throwOnReady && stage === 'Prolog worker ready') throw callbackError;
			})
		};
		const sandbox = createPrologLifecycleTestSandbox();
		const load = sandbox.load(
			'/absproxy/5173',
			'',
			true,
			[],
			{ signal: controller.signal },
			progress
		);
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		vi.spyOn(controller.signal, 'removeEventListener').mockImplementation(() => {
			throw cleanupError;
		});
		const retiredWorker = workerInstances[0];
		const staleReady = retiredWorker.onmessage;
		const staleError = retiredWorker.onerror;

		staleReady?.({
			data: { __wasmIdleStaticWorkerReady: true }
		} as MessageEvent<any>);

		await expect(load).rejects.toBe(callbackError);
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();

		throwOnReady = false;
		const retry = sandbox.load('/absproxy/5173', '', true, [], {}, progress);
		await vi.waitFor(() => expect(workerInstances).toHaveLength(2));
		const replacementWorker = workerInstances[1];
		staleReady?.({
			data: { __wasmIdleStaticWorkerReady: true }
		} as MessageEvent<any>);
		staleError?.(new ErrorEvent('error', { message: 'retired worker failed' }));
		expect(replacementWorker.terminate).not.toHaveBeenCalled();

		replacementWorker.onmessage?.({
			data: { __wasmIdleStaticWorkerReady: true }
		} as MessageEvent<any>);
		await expect(retry).resolves.toBeUndefined();
	});

	it('settles successful worker startup when caller-owned signal cleanup throws', async () => {
		autoStartWorkers = false;
		const controller = new AbortController();
		const sandbox = createPrologLifecycleTestSandbox();
		const load = sandbox.load('/absproxy/5173', '', true, [], {
			signal: controller.signal
		});
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		vi.spyOn(controller.signal, 'removeEventListener').mockImplementation(() => {
			throw new Error('startup listener cleanup failed');
		});

		workerInstances[0].onmessage?.({
			data: { __wasmIdleStaticWorkerReady: true }
		} as MessageEvent<any>);

		await expect(load).resolves.toBeUndefined();
		expect(workerInstances[0].terminate).not.toHaveBeenCalled();
	});

	it('reserves run ownership before the initial progress callback can reenter', async () => {
		onPostMessage = () => {};
		const sandbox = createPrologLifecycleTestSandbox();
		await sandbox.load('/absproxy/5173');
		let nested: Promise<boolean | string> | undefined;
		let reenter = true;
		const progress = {
			set: vi.fn((_value: number, stage?: string) => {
				if (!reenter || stage !== 'Starting Prolog run') return;
				reenter = false;
				nested = sandbox.run('writeln(nested).', false, true, undefined, [], {
					stdin: ''
				});
			})
		};

		const outer = sandbox.run('writeln(outer).', false, true, progress, [], { stdin: '' });

		expect(nested).toBeDefined();
		await expect(nested).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'execute',
			runtimeId: 'PROLOG'
		});
		await vi.waitFor(() => expect(workerInstances[0].postMessage).toHaveBeenCalledOnce());
		workerInstances[0].onmessage?.({
			data: { runId: workerInstances[0].lastRunId, results: true }
		} as MessageEvent<any>);
		await expect(outer).resolves.toBe(true);
	});

	it('returns a rejected Promise when the initial run progress callback throws', async () => {
		const callbackError = new Error('initial run progress failed');
		let throwOnStart = true;
		const progress = {
			set: vi.fn((_value: number, stage?: string) => {
				if (!throwOnStart || stage !== 'Starting Prolog run') return;
				throwOnStart = false;
				throw callbackError;
			})
		};
		const sandbox = createPrologLifecycleTestSandbox();
		await sandbox.load('/absproxy/5173');
		let failed: Promise<boolean | string> | undefined;

		expect(() => {
			failed = sandbox.run('writeln(failed).', false, true, progress, [], { stdin: '' });
		}).not.toThrow();
		expect(failed).toBeDefined();
		await expect(failed).rejects.toBe(callbackError);
		await expect(
			sandbox.run('writeln(retry).', false, true, progress, [], { stdin: '' })
		).resolves.toBe(true);
	});

	it('preserves disposal when initial run progress disposes and then throws', async () => {
		const sandbox = createPrologLifecycleTestSandbox();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		const callbackError = new Error('initial run progress failed after disposal');
		const progress = {
			set: vi.fn((_value: number, stage?: string) => {
				if (stage !== 'Starting Prolog run') return;
				void sandbox.dispose();
				throw callbackError;
			})
		};

		await expect(
			sandbox.run('writeln(disposed).', false, true, progress, [], { stdin: '' })
		).rejects.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'dispose',
			runtimeId: 'PROLOG'
		});
		expect(worker.postMessage).not.toHaveBeenCalled();
		expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it('does not dispatch a run after progress reentrantly disposes its worker', async () => {
		const sandbox = createPrologLifecycleTestSandbox();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		const progress = {
			set: vi.fn((value: number) => {
				if (value === 0.3) void sandbox.dispose();
			})
		};

		await expect(
			sandbox.run('writeln(disposed).', false, true, progress, [], { stdin: '' })
		).rejects.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'dispose',
			runtimeId: 'PROLOG'
		});
		expect(worker.postMessage).not.toHaveBeenCalled();
		expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it('classifies reentrant termination of a prepare-only run as startup cancellation', async () => {
		const sandbox = createPrologLifecycleTestSandbox();
		await sandbox.load('/absproxy/5173');
		let terminateOnPrepare = true;
		const progress = {
			set: vi.fn((_value: number, stage?: string) => {
				if (!terminateOnPrepare || stage !== 'Preparing Prolog runtime') return;
				terminateOnPrepare = false;
				sandbox.terminate();
			})
		};

		await expect(sandbox.run('', true, true, progress)).rejects.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'startup',
			runtimeId: 'PROLOG'
		});
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
	});

	it('rejects a prepare run asynchronously when signal registration throws and permits retry', async () => {
		const sandbox = createPrologLifecycleTestSandbox();
		await sandbox.load('/absproxy/5173');
		sandbox.terminate();
		const callbackError = new Error('signal registration failed');
		const removeEventListener = vi.fn();
		const signal = {
			aborted: false,
			reason: undefined,
			addEventListener: vi.fn(() => {
				throw callbackError;
			}),
			removeEventListener
		} as unknown as AbortSignal;
		let failed: Promise<boolean | string> | undefined;

		expect(() => {
			failed = sandbox.run('', true, true, undefined, [], { signal });
		}).not.toThrow();
		expect(failed).toBeDefined();
		await expect(failed).rejects.toBe(callbackError);
		expect(removeEventListener).toHaveBeenCalledOnce();
		await expect(sandbox.run('', true)).resolves.toBe(true);
	});

	it('cancels an immediately terminated prepare startup without recreating its worker', async () => {
		const sandbox = createPrologLifecycleTestSandbox();
		await sandbox.load('/absproxy/5173');
		sandbox.terminate();
		const retiredWorker = workerInstances[0];

		const pending = sandbox.run('', true);
		sandbox.terminate();

		await expect(pending).rejects.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'startup',
			runtimeId: 'PROLOG'
		});
		expect(workerInstances).toEqual([retiredWorker]);
	});

	it('cancels an immediately terminated warm prepare', async () => {
		const sandbox = createPrologLifecycleTestSandbox();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];

		const pending = sandbox.run('', true);
		sandbox.terminate();

		await expect(pending).rejects.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'startup',
			runtimeId: 'PROLOG'
		});
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toEqual([worker]);
	});

	it('preserves disposal when warm prepare progress disposes and then throws', async () => {
		const sandbox = createPrologLifecycleTestSandbox();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		const callbackError = new Error('warm prepare progress failed after disposal');
		const progress = {
			set: vi.fn((_value: number, stage?: string) => {
				if (stage !== 'Prolog worker ready') return;
				void sandbox.dispose();
				throw callbackError;
			})
		};

		await expect(sandbox.run('', true, true, progress)).rejects.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'dispose',
			runtimeId: 'PROLOG'
		});
		expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it('cancels warm prepare when ready progress reentrantly terminates it', async () => {
		const sandbox = createPrologLifecycleTestSandbox();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		const progress = {
			set: vi.fn((_value: number, stage?: string) => {
				if (stage === 'Prolog worker ready') sandbox.terminate();
			})
		};

		await expect(sandbox.run('', true, true, progress)).rejects.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'startup',
			runtimeId: 'PROLOG'
		});
		expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it.each(['progress', 'output', 'diagnostic'] as const)(
		'settles a throwing runtime %s callback and permits retry',
		async (callbackKind) => {
			onPostMessage = () => {};
			const callbackError = new Error(`${callbackKind} callback failed`);
			let throwCallback = true;
			const progress = {
				set: vi.fn((_value: number, stage?: string) => {
					if (
						throwCallback &&
						callbackKind === 'progress' &&
						stage === 'Runtime callback'
					) {
						throw callbackError;
					}
				})
			};
			const output = vi.fn(() => {
				if (throwCallback && callbackKind === 'output') throw callbackError;
			});
			const diagnosticSink = vi.fn(() => {
				if (throwCallback && callbackKind === 'diagnostic') throw callbackError;
			});
			const sandbox = createPrologLifecycleTestSandbox();
			sandbox.output = output;
			sandbox.oncompilerdiagnostic = diagnosticSink;
			await sandbox.load('/absproxy/5173');
			const run = sandbox.run('writeln(callback).', false, true, progress, [], {
				stdin: ''
			});
			const outcome = run.catch((error) => error);
			await vi.waitFor(() => expect(workerInstances[0].postMessage).toHaveBeenCalledOnce());
			const worker = workerInstances[0];
			const diagnostic = {
				lineNumber: 1,
				severity: 'warning' as const,
				message: 'runtime warning'
			};

			worker.onmessage?.({
				data: {
					runId: worker.lastRunId,
					progress: { percent: 50, stage: 'Runtime callback' },
					output: 'callback output\n',
					diagnostic,
					results: true
				}
			} as MessageEvent<any>);

			await expect(outcome).resolves.toBe(callbackError);
			expect(worker.terminate).toHaveBeenCalledOnce();
			expect(output).toHaveBeenCalledTimes(callbackKind === 'progress' ? 0 : 1);
			expect(diagnosticSink).toHaveBeenCalledTimes(callbackKind === 'diagnostic' ? 1 : 0);

			throwCallback = false;
			onPostMessage = null;
			await expect(
				sandbox.run('writeln(retry).', false, true, progress, [], { stdin: '' })
			).resolves.toBe(true);
			expect(workerInstances).toHaveLength(2);
		}
	);

	it('rejects when completion progress throws even if worker cleanup also fails', async () => {
		onPostMessage = () => {};
		const callbackError = new Error('completion progress failed');
		const progress = {
			set: vi.fn((_value: number, stage?: string) => {
				if (stage === 'Prolog run complete') throw callbackError;
			})
		};
		const sandbox = createPrologLifecycleTestSandbox();
		await sandbox.load('/absproxy/5173');
		const run = sandbox.run('writeln(complete).', false, true, progress, [], { stdin: '' });
		const outcome = run.catch((error) => error);
		await vi.waitFor(() => expect(workerInstances[0].postMessage).toHaveBeenCalledOnce());
		const worker = workerInstances[0];
		const handler = worker.onmessage;
		Object.defineProperty(worker, 'onmessage', {
			configurable: true,
			get: () => handler,
			set: () => {
				throw new Error('worker handler cleanup failed');
			}
		});
		worker.terminate.mockImplementationOnce(() => {
			throw new Error('worker cleanup failed');
		});

		handler?.({
			data: { runId: worker.lastRunId, results: true }
		} as MessageEvent<any>);

		await expect(outcome).resolves.toBe(callbackError);
		expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it('preserves a replacement run when completion progress terminates and then throws', async () => {
		onPostMessage = () => {};
		const callbackError = new Error('stale completion callback failed');
		const sandbox = createPrologLifecycleTestSandbox();
		let replacement: Promise<boolean | string> | undefined;
		let replaceOnCompletion = true;
		const progress = {
			set: vi.fn((_value: number, stage?: string) => {
				if (!replaceOnCompletion || stage !== 'Prolog run complete') return;
				replaceOnCompletion = false;
				sandbox.terminate();
				replacement = sandbox.run('writeln(replacement).', false, true, progress, [], {
					stdin: ''
				});
				throw callbackError;
			})
		};
		await sandbox.load('/absproxy/5173');
		const first = sandbox.run('writeln(first).', false, true, progress, [], { stdin: '' });
		const firstOutcome = first.catch((error) => error);
		await vi.waitFor(() => expect(workerInstances[0].postMessage).toHaveBeenCalledOnce());
		const retiredWorker = workerInstances[0];
		const staleHandler = retiredWorker.onmessage;

		staleHandler?.({
			data: { runId: retiredWorker.lastRunId, results: true }
		} as MessageEvent<any>);

		await expect(firstOutcome).resolves.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'execute',
			runtimeId: 'PROLOG'
		});
		await vi.waitFor(() => expect(workerInstances).toHaveLength(2));
		const replacementWorker = workerInstances[1];
		await vi.waitFor(() => expect(replacementWorker.postMessage).toHaveBeenCalledOnce());
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(replacementWorker.terminate).not.toHaveBeenCalled();
		expect(replacement).toBeDefined();

		staleHandler?.({
			data: { runId: retiredWorker.lastRunId, results: true }
		} as MessageEvent<any>);
		expect(replacementWorker.terminate).not.toHaveBeenCalled();
		replacementWorker.onmessage?.({
			data: { runId: replacementWorker.lastRunId, results: true }
		} as MessageEvent<any>);
		await expect(replacement).resolves.toBe(true);
	});

	it('rejects an overlapping run while worker startup is pending', async () => {
		autoStartWorkers = false;
		const sandbox = createPrologLifecycleTestSandbox();
		const load = sandbox.load('/absproxy/5173');
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));

		let firstSettled = false;
		const first = sandbox.run('writeln(first).', false, true, undefined, [], { stdin: '' });
		void first.finally(() => {
			firstSettled = true;
		});
		const overlapping = sandbox.run('writeln(second).', false, true, undefined, [], {
			stdin: ''
		});

		await expect(overlapping).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'execute',
			runtimeId: 'PROLOG',
			recoverable: true
		});
		expect(firstSettled).toBe(false);

		workerInstances[0].onmessage?.({
			data: { __wasmIdleStaticWorkerReady: true }
		} as MessageEvent<any>);
		await load;
		await expect(first).resolves.toBe(true);
	});

	it('settles a shared pending startup when its active run is cancelled', async () => {
		autoStartWorkers = false;
		const sandbox = createPrologLifecycleTestSandbox();
		const loadOutcome = sandbox.load('/absproxy/5173').catch((error) => error);
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		const retiredWorker = workerInstances[0];
		const controller = new AbortController();
		const runOutcome = sandbox
			.run('writeln(cancelled).', false, true, undefined, [], {
				stdin: '',
				signal: controller.signal
			})
			.catch((error) => error);

		controller.abort(new Error('cancel shared startup'));

		const runError = await runOutcome;
		await expect(loadOutcome).resolves.toBe(runError);
		expect(runError).toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'execute',
			runtimeId: 'PROLOG'
		});
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();

		const retry = sandbox.load('/absproxy/5173');
		await vi.waitFor(() => expect(workerInstances).toHaveLength(2));
		workerInstances[1].onmessage?.({
			data: { __wasmIdleStaticWorkerReady: true }
		} as MessageEvent<any>);
		await expect(retry).resolves.toBeUndefined();
	});

	it('ignores a stale abort listener when cleanup fails and a replacement awaits stdin', async () => {
		onPostMessage = () => {};
		const sandbox = createPrologLifecycleTestSandbox();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		const controller = new AbortController();
		vi.spyOn(controller.signal, 'removeEventListener').mockImplementation(() => {
			throw new Error('run listener cleanup failed');
		});
		const first = sandbox.run('writeln(first).', false, true, undefined, [], {
			stdin: '',
			signal: controller.signal
		});
		await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledOnce());
		worker.onmessage?.({
			data: { runId: worker.lastRunId, results: true }
		} as MessageEvent<any>);
		await expect(first).resolves.toBe(true);

		const second = sandbox.run(
			'main :- read_line_to_string(user_input, Line), writeln(Line).',
			false
		);
		await Promise.resolve();
		controller.abort(new Error('late stale abort'));
		sandbox.write('replacement\n');
		sandbox.eof();
		await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2));
		worker.onmessage?.({
			data: { runId: worker.lastRunId, results: true }
		} as MessageEvent<any>);

		await expect(second).resolves.toBe(true);
		expect(workerInstances).toEqual([worker]);
		await sandbox.dispose();
	});

	it('rejects an overlapping run while the first run waits for stdin', async () => {
		const sandbox = createPrologLifecycleTestSandbox();
		await sandbox.load('/absproxy/5173');
		const code = 'main :- read_line_to_string(user_input, Line), writeln(Line).';
		const first = sandbox.run(code, false);
		await Promise.resolve();

		await expect(
			sandbox.run('writeln(second).', false, true, undefined, [], { stdin: '' })
		).rejects.toMatchObject({ name: 'BusyError', code: 'busy' });
		expect(workerInstances[0].postMessage).not.toHaveBeenCalled();

		sandbox.write('first\n');
		sandbox.eof();
		await expect(first).resolves.toBe(true);
		expect(workerInstances[0].postMessage).toHaveBeenCalledOnce();
	});

	it('rejects an overlapping run while the worker is executing', async () => {
		onPostMessage = () => {};
		const sandbox = createPrologLifecycleTestSandbox();
		await sandbox.load('/absproxy/5173');
		const first = sandbox.run('writeln(first).', false, true, undefined, [], { stdin: '' });
		await vi.waitFor(() => expect(workerInstances[0].postMessage).toHaveBeenCalledOnce());

		await expect(
			sandbox.run('writeln(second).', false, true, undefined, [], { stdin: '' })
		).rejects.toMatchObject({ name: 'BusyError', code: 'busy' });

		workerInstances[0].onmessage?.({
			data: { runId: workerInstances[0].lastRunId, results: true }
		} as MessageEvent<any>);
		await expect(first).resolves.toBe(true);
		expect(workerInstances[0].terminate).not.toHaveBeenCalled();
		await sandbox.dispose();
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
	});

	it('ignores uncorrelated and stale messages until the active run responds', async () => {
		onPostMessage = () => {};
		const sandbox = createPrologLifecycleTestSandbox();
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.load('/absproxy/5173');
		const run = sandbox.run('writeln(current).', false, true, undefined, [], { stdin: '' });
		await vi.waitFor(() => expect(workerInstances[0].postMessage).toHaveBeenCalledOnce());

		let settled = false;
		void run.finally(() => {
			settled = true;
		});
		workerInstances[0].onmessage?.({
			data: { output: 'missing-run-id\n', results: true }
		} as MessageEvent<any>);
		workerInstances[0].onmessage?.({
			data: { runId: 'static-stale', output: 'stale\n', results: true }
		} as MessageEvent<any>);
		await Promise.resolve();

		expect(settled).toBe(false);
		expect(output).not.toHaveBeenCalled();
		const runId = workerInstances[0].lastRunId;
		expect(runId).toMatch(/^static-\d+$/);
		workerInstances[0].onmessage?.({
			data: { runId, output: 'current\n' }
		} as MessageEvent<any>);
		workerInstances[0].onmessage?.({
			data: { runId, results: true }
		} as MessageEvent<any>);

		await expect(run).resolves.toBe(true);
		expect(output).toHaveBeenCalledOnce();
		expect(output).toHaveBeenCalledWith('current\n');
	});

	it('cancels a static run while it is waiting for stdin', async () => {
		const controller = new AbortController();
		const sandbox = createPrologLifecycleTestSandbox();
		await sandbox.load('/absproxy/5173');
		const code = 'main :- read_line_to_string(user_input, Line), writeln(Line).';
		const run = sandbox.run(code, false, true, undefined, [], {
			signal: controller.signal
		});
		const outcome = run.catch((error) => error);
		await Promise.resolve();
		expect(workerInstances[0].postMessage).not.toHaveBeenCalled();

		controller.abort(new Error('cancel stdin wait'));
		await expect(outcome).resolves.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'execute',
			runtimeId: 'PROLOG'
		});
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
	});

	it('terminates a static run at its aggregate execution deadline', async () => {
		onPostMessage = () => {};
		const sandbox = createPrologLifecycleTestSandbox();
		await sandbox.load('/absproxy/5173');
		const run = sandbox.run('writeln(slow).', false, true, undefined, [], {
			stdin: '',
			limits: { compileTimeoutMs: 5, runTimeoutMs: 5 }
		});
		const outcome = run.catch((error) => error);
		await vi.waitFor(() => expect(workerInstances[0].postMessage).toHaveBeenCalledOnce());

		await expect(outcome).resolves.toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'execute',
			runtimeId: 'PROLOG',
			timeoutMs: 10
		});
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
	});

	it('terminates a static run before emitting output beyond its UTF-8 byte limit', async () => {
		onPostMessage = () => {};
		const sandbox = createPrologLifecycleTestSandbox();
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.load('/absproxy/5173');
		const run = sandbox.run('writeln(output).', false, true, undefined, [], {
			stdin: '',
			limits: { maxOutputBytes: 4 }
		});
		const outcome = run.catch((error) => error);
		await vi.waitFor(() => expect(workerInstances[0].postMessage).toHaveBeenCalledOnce());
		workerInstances[0].onmessage?.({
			data: { runId: workerInstances[0].lastRunId, output: 'ééé' }
		} as MessageEvent<any>);

		await expect(outcome).resolves.toMatchObject({
			name: 'OutputLimitError',
			code: 'output-limit',
			phase: 'execute',
			runtimeId: 'PROLOG',
			actual: 6,
			limit: 4
		});
		expect(output).not.toHaveBeenCalled();
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
	});

	it('terminates a static run when its diagnostic count exceeds the limit', async () => {
		onPostMessage = () => {};
		const sandbox = createPrologLifecycleTestSandbox();
		const oncompilerdiagnostic = vi.fn();
		sandbox.oncompilerdiagnostic = oncompilerdiagnostic;
		await sandbox.load('/absproxy/5173');
		const run = sandbox.run('writeln(diagnostics).', false, true, undefined, [], {
			stdin: '',
			limits: { maxDiagnostics: 1 }
		});
		const outcome = run.catch((error) => error);
		await vi.waitFor(() => expect(workerInstances[0].postMessage).toHaveBeenCalledOnce());
		const diagnostic = {
			lineNumber: 1,
			severity: 'warning' as const,
			message: 'test diagnostic'
		};
		workerInstances[0].onmessage?.({
			data: { runId: workerInstances[0].lastRunId, diagnostic }
		} as MessageEvent<any>);
		workerInstances[0].onmessage?.({
			data: { runId: workerInstances[0].lastRunId, diagnostic }
		} as MessageEvent<any>);

		await expect(outcome).resolves.toMatchObject({
			name: 'DiagnosticLimitError',
			code: 'diagnostic-limit',
			phase: 'execute',
			runtimeId: 'PROLOG',
			actual: 2,
			limit: 1
		});
		expect(oncompilerdiagnostic).toHaveBeenCalledOnce();
		expect(oncompilerdiagnostic).toHaveBeenCalledWith(diagnostic);
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
	});

	it('rejects unsafe static workspace paths before dispatch', async () => {
		const sandbox = createPrologLifecycleTestSandbox();
		await sandbox.load('/absproxy/5173');

		await expect(
			sandbox.run('writeln(unsafe).', false, true, undefined, [], {
				activePath: '../main.prolog',
				workspaceFiles: [{ path: 'safe.prolog', content: '' }]
			})
		).rejects.toMatchObject({
			name: 'WorkspaceValidationError',
			code: 'invalid-path',
			path: '../main.prolog'
		});
		expect(workerInstances[0].postMessage).not.toHaveBeenCalled();
		expect(workerInstances[0].terminate).not.toHaveBeenCalled();
	});

	it('normalizes static workspace paths and enforces the aggregate byte limit', async () => {
		const sandbox = createPrologLifecycleTestSandbox();
		await sandbox.load('/absproxy/5173');
		await expect(
			sandbox.run('writeln(ok).', false, true, undefined, [], {
				activePath: 'src\\main.prolog',
				workspaceFiles: [{ path: 'src\\helper.prolog', content: 'helper.' }]
			})
		).resolves.toBe(true);
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				activePath: 'src/main.prolog',
				workspaceFiles: [{ path: 'src/helper.prolog', content: 'helper.' }]
			})
		);

		await sandbox.load('/absproxy/5173');
		await expect(
			sandbox.run('12345', false, true, undefined, [], {
				limits: { maxWorkspaceBytes: 4 }
			})
		).rejects.toMatchObject({
			name: 'WorkspaceValidationError',
			code: 'file-size-limit',
			actual: 5,
			limit: 4
		});
		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenCalledOnce();
		await sandbox.dispose();
	});

	it('releases the active-run slot after kill for an immediate rerun', async () => {
		onPostMessage = () => {};
		const sandbox = createPrologLifecycleTestSandbox();
		await sandbox.load('/absproxy/5173');
		const first = sandbox.run('writeln(first).', false, true, undefined, [], { stdin: '' });
		await vi.waitFor(() => expect(workerInstances[0].postMessage).toHaveBeenCalledOnce());

		sandbox.kill();
		await expect(first).rejects.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'execute',
			runtimeId: 'PROLOG'
		});
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();

		onPostMessage = null;
		await expect(
			sandbox.run('writeln(second).', false, true, undefined, [], { stdin: '' })
		).resolves.toBe(true);
		expect(workerInstances).toHaveLength(2);
	});

	it('buffers every stdin chunk until EOF and preserves explicit empty stdin', async () => {
		const sandbox = createPrologLifecycleTestSandbox();
		const code = 'main :- read_line_to_string(user_input, Line), writeln(Line).';
		await sandbox.load('/absproxy/5173');

		const run = sandbox.run(code, false);
		sandbox.write('first\n');
		await Promise.resolve();
		expect(workerInstances[0].postMessage).not.toHaveBeenCalled();
		sandbox.write('second\n');
		sandbox.eof();
		await expect(run).resolves.toBe(true);

		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				stdin: 'first\nsecond\n',
				stdinEof: true
			})
		);

		await sandbox.load('/absproxy/5173');
		const explicitInputWithoutPattern = sandbox.run('writeln(ok).', false);
		sandbox.write('still forwarded\n');
		sandbox.eof();
		await expect(explicitInputWithoutPattern).resolves.toBe(true);
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ stdin: 'still forwarded\n', stdinEof: true })
		);

		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run(code, false, true, undefined, [], { stdin: '' })).resolves.toBe(
			true
		);
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ stdin: '', stdinEof: true })
		);
		expect(workerInstances).toHaveLength(1);
		await sandbox.dispose();
	});

	it('does not leak stdin queued before or during an explicit-input run', async () => {
		onPostMessage = () => {};
		const sandbox = createPrologLifecycleTestSandbox();
		const code = 'main :- read_line_to_string(user_input, Line), writeln(Line).';
		await sandbox.load('/absproxy/5173');
		sandbox.write('queued before the run\n');
		sandbox.eof();

		const explicitRun = sandbox.run(code, false, true, undefined, [], {
			stdin: 'explicit input\n'
		});
		await vi.waitFor(() => expect(workerInstances[0].postMessage).toHaveBeenCalledOnce());
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ stdin: 'explicit input\n', stdinEof: true })
		);
		sandbox.write('queued during the run\n');
		sandbox.eof();
		workerInstances[0].onmessage?.({
			data: { runId: workerInstances[0].lastRunId, results: true }
		} as MessageEvent<any>);
		await expect(explicitRun).resolves.toBe(true);

		onPostMessage = null;
		await sandbox.load('/absproxy/5173');
		const nextRun = sandbox.run(code, false);
		await Promise.resolve();
		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenCalledOnce();

		sandbox.write('fresh input\n');
		sandbox.eof();
		await expect(nextRun).resolves.toBe(true);
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ stdin: 'fresh input\n', stdinEof: true })
		);
		expect(workerInstances[0].postMessage).toHaveBeenCalledTimes(2);
		await sandbox.dispose();
	});

	it('rejects a pre-cancelled static worker load before fetching', async () => {
		const controller = new AbortController();
		controller.abort(new Error('cancel before load'));
		const sandbox = createPrologLifecycleTestSandbox();

		await expect(
			sandbox.load('/absproxy/5173', '', true, [], { signal: controller.signal })
		).rejects.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'startup',
			runtimeId: 'PROLOG'
		});
		expect(fetch).not.toHaveBeenCalled();
		expect(workerInstances).toHaveLength(0);
	});

	it.each([
		[
			'an unsupported scheme',
			'data:text/javascript,postMessage({})',
			'Unsafe worker URL test worker script URL must use HTTP(S)'
		],
		[
			'credentials',
			'https://user:secret@assets.example.test/runtime/worker.js',
			'Unsafe worker URL test worker script URL must not include credentials'
		],
		[
			'a fragment',
			'https://assets.example.test/runtime/worker.js#token',
			'Unsafe worker URL test worker script URL must not include a fragment'
		]
	])(
		'rejects a static worker URL containing %s before fetching',
		async (_kind, workerUrl, message) => {
			const sandbox = new StaticWorkerRuntimeSandbox({
				languageId: 'UNSAFE_WORKER_URL_TEST',
				displayName: 'Unsafe worker URL test',
				defaultActivePath: 'main.txt',
				stdin: { mode: 'none' },
				resolveRuntimeAssets: () => ({
					baseUrl: 'https://assets.example.test/runtime/',
					workerUrl
				})
			});

			const outcome = await sandbox.load().catch((error) => error);
			expect(outcome).toMatchObject({
				name: 'RuntimeConfigurationError',
				code: 'runtime-configuration',
				phase: 'configuration',
				runtimeId: 'UNSAFE_WORKER_URL_TEST',
				message
			});
			expect(fetch).not.toHaveBeenCalled();
			expect(workerInstances).toHaveLength(0);
		}
	);

	it('aborts a static worker download at its asset deadline', async () => {
		let fetchSignal: AbortSignal | undefined;
		vi.mocked(fetch).mockImplementationOnce((_input, init) => {
			fetchSignal = init?.signal ?? undefined;
			return new Promise((_resolve, reject) => {
				fetchSignal?.addEventListener(
					'abort',
					() => reject(fetchSignal?.reason ?? new DOMException('Aborted', 'AbortError')),
					{ once: true }
				);
			});
		});
		const sandbox = createPrologLifecycleTestSandbox();

		await expect(
			sandbox.load('/absproxy/5173', '', true, [], {
				limits: { assetTimeoutMs: 5 }
			})
		).rejects.toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'asset',
			runtimeId: 'PROLOG',
			timeoutMs: 5
		});
		expect(fetchSignal?.aborted).toBe(true);
		expect(workerInstances).toHaveLength(0);
	});

	it('enforces the Gleam asset deadline while runner integrity verification is stalled', async () => {
		const digest = vi
			.spyOn(globalThis.crypto.subtle, 'digest')
			.mockImplementation(() => new Promise<ArrayBuffer>(() => {}));
		const sandbox = new Gleam();

		try {
			await expect(
				sandbox.load('/absproxy/5173', '', true, [], {
					limits: { assetTimeoutMs: 5 }
				})
			).rejects.toMatchObject({
				name: 'TimeoutError',
				code: 'timeout',
				phase: 'asset',
				runtimeId: 'GLEAM',
				timeoutMs: 5
			});
			expect(workerInstances).toHaveLength(0);
		} finally {
			digest.mockRestore();
		}
	});

	it('enforces the asset deadline when worker-script fetch ignores its signal', async () => {
		let markFetchStarted!: () => void;
		const fetchStarted = new Promise<void>((resolve) => {
			markFetchStarted = resolve;
		});
		let resolveFetch!: (response: Response) => void;
		const fetchPending = new Promise<Response>((resolve) => {
			resolveFetch = resolve;
		});
		let fetchSignal: AbortSignal | undefined;
		let addEventListener: ReturnType<typeof vi.spyOn> | undefined;
		let removeEventListener: ReturnType<typeof vi.spyOn> | undefined;
		vi.mocked(fetch).mockImplementationOnce((_input, init) => {
			fetchSignal = init?.signal ?? undefined;
			if (fetchSignal) {
				addEventListener = vi.spyOn(fetchSignal, 'addEventListener');
				removeEventListener = vi.spyOn(fetchSignal, 'removeEventListener');
			}
			markFetchStarted();
			return fetchPending;
		});
		const cancel = vi.fn(async () => undefined);
		const getReader = vi.fn();
		const lateResponse = {
			ok: true,
			status: 200,
			url: '',
			headers: new Headers(),
			body: { cancel, getReader }
		} as unknown as Response;
		const progress = { set: vi.fn() };
		const sandbox = createPrologLifecycleTestSandbox();
		const loading = sandbox.load(
			'/absproxy/5173',
			'',
			true,
			[],
			{ limits: { assetTimeoutMs: 5 } },
			progress
		);
		let guard: ReturnType<typeof setTimeout> | undefined;

		try {
			await fetchStarted;
			const outcome = await Promise.race([
				loading.then(
					(value) => ({ status: 'resolved' as const, value }),
					(error) => ({ status: 'rejected' as const, error: error as unknown })
				),
				new Promise<{ status: 'pending' }>((resolve) => {
					guard = setTimeout(() => resolve({ status: 'pending' }), 100);
				})
			]);

			expect(outcome).toMatchObject({
				status: 'rejected',
				error: {
					name: 'TimeoutError',
					code: 'timeout',
					phase: 'asset',
					runtimeId: 'PROLOG',
					timeoutMs: 5
				}
			});
			expect(fetchSignal?.aborted).toBe(true);
			const abortRegistration = addEventListener?.mock.calls.find(
				(registration: unknown[]) => registration[0] === 'abort'
			);
			expect(abortRegistration).toBeDefined();
			expect(removeEventListener).toHaveBeenCalledWith('abort', abortRegistration?.[1]);
			resolveFetch(lateResponse);
			await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith(fetchSignal?.reason));
			expect(getReader).not.toHaveBeenCalled();
			expect(workerInstances).toHaveLength(0);
			expect(progress.set).not.toHaveBeenCalledWith(0.2, 'Prolog worker downloaded');
		} finally {
			if (guard) clearTimeout(guard);
			resolveFetch(lateResponse);
			await loading.catch(() => {});
		}
	});

	it('cancels stalled bodyless worker-script materialization promptly', async () => {
		let markMaterializationStarted!: () => void;
		const materializationStarted = new Promise<void>((resolve) => {
			markMaterializationStarted = resolve;
		});
		let resolveArrayBuffer!: (value: ArrayBuffer) => void;
		const arrayBufferPending = new Promise<ArrayBuffer>((resolve) => {
			resolveArrayBuffer = resolve;
		});
		const arrayBuffer = vi.fn(() => {
			markMaterializationStarted();
			return arrayBufferPending;
		});
		let phaseSignal: AbortSignal | undefined;
		let phaseAddEventListener: ReturnType<typeof vi.spyOn> | undefined;
		let phaseRemoveEventListener: ReturnType<typeof vi.spyOn> | undefined;
		vi.mocked(fetch).mockImplementationOnce((_input, init) => {
			phaseSignal = init?.signal ?? undefined;
			if (phaseSignal) {
				phaseAddEventListener = vi.spyOn(phaseSignal, 'addEventListener');
				phaseRemoveEventListener = vi.spyOn(phaseSignal, 'removeEventListener');
			}
			return Promise.resolve({
				ok: true,
				status: 200,
				url: '',
				headers: new Headers(),
				body: null,
				arrayBuffer
			} as unknown as Response);
		});
		const controller = new AbortController();
		const reason = new Error('stop bodyless worker-script read');
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const progress = { set: vi.fn() };
		const sandbox = createPrologLifecycleTestSandbox();
		const loading = sandbox.load(
			'/absproxy/5173',
			'',
			true,
			[],
			{ signal: controller.signal },
			progress
		);
		let timeout: ReturnType<typeof setTimeout> | undefined;

		try {
			await materializationStarted;
			controller.abort(reason);
			const outcome = await Promise.race([
				loading.then(
					(value) => ({ status: 'resolved' as const, value }),
					(error) => ({ status: 'rejected' as const, error: error as unknown })
				),
				new Promise<{ status: 'pending' }>((resolve) => {
					timeout = setTimeout(() => resolve({ status: 'pending' }), 25);
				})
			]);

			expect(outcome).toMatchObject({
				status: 'rejected',
				error: {
					name: 'CancelledError',
					code: 'cancelled',
					phase: 'asset',
					runtimeId: 'PROLOG',
					cause: reason
				}
			});
			expect(phaseSignal?.aborted).toBe(true);
			const phaseAbortRegistrations = phaseAddEventListener?.mock.calls.filter(
				(registration: unknown[]) => registration[0] === 'abort'
			);
			expect(phaseAbortRegistrations).toHaveLength(2);
			for (const registration of phaseAbortRegistrations ?? []) {
				expect(phaseRemoveEventListener).toHaveBeenCalledWith('abort', registration[1]);
			}
			const callerAbortRegistrations = addEventListener.mock.calls.filter(
				([type]) => type === 'abort'
			);
			for (const registration of callerAbortRegistrations) {
				expect(removeEventListener).toHaveBeenCalledWith('abort', registration[1]);
			}
			resolveArrayBuffer(Uint8Array.of(1, 2, 3).buffer);
			await Promise.resolve();
			await Promise.resolve();
			expect(progress.set).not.toHaveBeenCalledWith(0.2, 'Prolog worker downloaded');
			expect(workerInstances).toHaveLength(0);
		} finally {
			if (timeout) clearTimeout(timeout);
			resolveArrayBuffer(Uint8Array.of(1, 2, 3).buffer);
			await loading.catch(() => {});
		}
	});

	it.each([
		['while cancellation and the read remain pending', false],
		['when cancellation settles the read first', true]
	])('cancels a stalled worker-script stream read %s', async (_case, settleReadOnCancel) => {
		let markReadStarted!: () => void;
		const readStarted = new Promise<void>((resolve) => {
			markReadStarted = resolve;
		});
		let resolveRead!: (result: { done: true; value: undefined }) => void;
		const readPending = new Promise<{ done: true; value: undefined }>((resolve) => {
			resolveRead = resolve;
		});
		const read = vi.fn(() => {
			markReadStarted();
			return readPending;
		});
		let resolveCancel!: () => void;
		const cancelPending = new Promise<void>((resolve) => {
			resolveCancel = resolve;
		});
		const cancel = vi.fn(() => {
			if (settleReadOnCancel) {
				resolveRead({ done: true, value: undefined });
				return Promise.resolve();
			}
			return cancelPending;
		});
		const releaseLock = vi.fn();
		let phaseSignal: AbortSignal | undefined;
		let phaseAddEventListener: ReturnType<typeof vi.spyOn> | undefined;
		let phaseRemoveEventListener: ReturnType<typeof vi.spyOn> | undefined;
		vi.mocked(fetch).mockImplementationOnce((_input, init) => {
			phaseSignal = init?.signal ?? undefined;
			if (phaseSignal) {
				phaseAddEventListener = vi.spyOn(phaseSignal, 'addEventListener');
				phaseRemoveEventListener = vi.spyOn(phaseSignal, 'removeEventListener');
			}
			return Promise.resolve({
				ok: true,
				status: 200,
				url: '',
				headers: new Headers(),
				body: { getReader: () => ({ cancel, read, releaseLock }) }
			} as unknown as Response);
		});
		const controller = new AbortController();
		const reason = new Error('stop worker-script stream read');
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const progress = { set: vi.fn() };
		const sandbox = createPrologLifecycleTestSandbox();
		const loading = sandbox.load(
			'/absproxy/5173',
			'',
			true,
			[],
			{ signal: controller.signal },
			progress
		);
		let timeout: ReturnType<typeof setTimeout> | undefined;

		try {
			await readStarted;
			controller.abort(reason);
			const outcome = await Promise.race([
				loading.then(
					(value) => ({ status: 'resolved' as const, value }),
					(error) => ({ status: 'rejected' as const, error: error as unknown })
				),
				new Promise<{ status: 'pending' }>((resolve) => {
					timeout = setTimeout(() => resolve({ status: 'pending' }), 25);
				})
			]);

			expect(outcome).toMatchObject({
				status: 'rejected',
				error: {
					name: 'CancelledError',
					code: 'cancelled',
					phase: 'asset',
					runtimeId: 'PROLOG',
					cause: reason
				}
			});
			expect(cancel).toHaveBeenCalledOnce();
			expect(cancel).toHaveBeenCalledWith(reason);
			expect(releaseLock).toHaveBeenCalledOnce();
			const phaseAbortRegistrations = phaseAddEventListener?.mock.calls.filter(
				(registration: unknown[]) => registration[0] === 'abort'
			);
			expect(phaseAbortRegistrations).toHaveLength(2);
			for (const registration of phaseAbortRegistrations ?? []) {
				expect(phaseRemoveEventListener).toHaveBeenCalledWith('abort', registration[1]);
			}
			const callerAbortRegistrations = addEventListener.mock.calls.filter(
				([type]) => type === 'abort'
			);
			for (const registration of callerAbortRegistrations) {
				expect(removeEventListener).toHaveBeenCalledWith('abort', registration[1]);
			}
			expect(progress.set).not.toHaveBeenCalledWith(0.2, 'Prolog worker downloaded');
			expect(workerInstances).toHaveLength(0);
		} finally {
			if (timeout) clearTimeout(timeout);
			resolveCancel();
			resolveRead({ done: true, value: undefined });
			await loading.catch(() => {});
		}
	});

	it('preloads static worker scripts with least-authority request options', async () => {
		const sandbox = createPrologLifecycleTestSandbox();

		await sandbox.load('/absproxy/5173');

		expect(fetch).toHaveBeenCalledWith(
			'http://localhost:3000/absproxy/5173/wasm-prolog/runner-worker.js',
			expect.objectContaining({
				cache: 'no-store',
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer',
				signal: expect.any(AbortSignal)
			})
		);
	});

	it.each([
		['relative', 'runner-worker.js'],
		['substituted', 'https://evil.example/runner-worker.js']
	])(
		'rejects a %s static worker final URL before reading its body',
		async (_kind, responseUrl) => {
			const cancel = vi.fn(async () => undefined);
			const getReader = vi.fn();
			const arrayBuffer = vi.fn();
			vi.mocked(fetch).mockResolvedValueOnce({
				ok: true,
				status: 200,
				url: responseUrl,
				headers: new Headers(),
				body: { cancel, getReader },
				arrayBuffer
			} as unknown as Response);
			const sandbox = createPrologLifecycleTestSandbox();

			await expect(sandbox.load('/absproxy/5173')).rejects.toMatchObject({
				name: 'ProtocolError',
				code: 'protocol',
				phase: 'asset',
				runtimeId: 'PROLOG'
			});
			expect(cancel).toHaveBeenCalledOnce();
			expect(getReader).not.toHaveBeenCalled();
			expect(arrayBuffer).not.toHaveBeenCalled();
			expect(workerInstances).toHaveLength(0);
		}
	);

	it.each(['pending', 'throw', 'reject'] as const)(
		'reports failed static worker responses without awaiting %s cancellation',
		async (cancellationMode) => {
			let resolveCancellation!: () => void;
			const stalledCancellation = new Promise<void>((resolve) => {
				resolveCancellation = resolve;
			});
			const cancel = vi.fn((reason?: unknown) => {
				if (cancellationMode === 'throw') {
					throw new Error('static worker response cancellation threw');
				}
				if (cancellationMode === 'reject') {
					return Promise.reject(
						new Error('static worker response cancellation rejected')
					);
				}
				return stalledCancellation;
			});
			vi.mocked(fetch).mockResolvedValueOnce({
				ok: false,
				status: 503,
				url: '',
				headers: new Headers(),
				body: { cancel }
			} as unknown as Response);
			const sandbox = createPrologLifecycleTestSandbox();
			const loading = sandbox.load('/absproxy/5173');
			let timeout: ReturnType<typeof setTimeout> | undefined;

			try {
				const outcome = await Promise.race([
					loading.then(
						(value) => ({ status: 'resolved' as const, value }),
						(error) => ({ status: 'rejected' as const, reason: error as unknown })
					),
					new Promise<{ status: 'pending' }>((resolve) => {
						timeout = setTimeout(() => resolve({ status: 'pending' }), 25);
					})
				]);

				expect(outcome.status).toBe('rejected');
				if (outcome.status !== 'rejected')
					throw new Error('expected worker load to reject');
				expect(outcome.reason).toMatchObject({
					name: 'AssetNotFoundError',
					code: 'asset-not-found',
					phase: 'asset',
					runtimeId: 'PROLOG'
				});
				expect(cancel).toHaveBeenCalledOnce();
				expect(cancel.mock.calls[0]?.[0]).toBe(outcome.reason);
				expect(workerInstances).toHaveLength(0);
			} finally {
				if (timeout) clearTimeout(timeout);
				resolveCancellation();
				await loading.catch(() => {});
			}
		}
	);

	it.each(['', '-1', '1.5', '1e2', '3, 3', '9007199254740992'])(
		'rejects an invalid static worker Content-Length before reading: %s',
		async (contentLength) => {
			const cancel = vi.fn(async () => undefined);
			const getReader = vi.fn();
			const arrayBuffer = vi.fn();
			vi.mocked(fetch).mockResolvedValueOnce({
				ok: true,
				status: 200,
				url: '',
				headers: new Headers({ 'content-length': contentLength }),
				body: { cancel, getReader },
				arrayBuffer
			} as unknown as Response);
			const sandbox = createPrologLifecycleTestSandbox();

			await expect(sandbox.load('/absproxy/5173')).rejects.toMatchObject({
				name: 'ProtocolError',
				code: 'protocol',
				phase: 'asset',
				runtimeId: 'PROLOG'
			});
			expect(cancel).toHaveBeenCalledOnce();
			expect(getReader).not.toHaveBeenCalled();
			expect(arrayBuffer).not.toHaveBeenCalled();
			expect(workerInstances).toHaveLength(0);
		}
	);

	it('rejects an oversized static worker script before reading its body', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(
			new Response('small test body', {
				headers: { 'content-length': '1024' }
			})
		);
		const sandbox = createStreamingTestSandbox();

		await expect(
			sandbox.load('/absproxy/5173', '', true, [], {
				limits: { maxAssetBytes: 32 }
			})
		).rejects.toMatchObject({
			name: 'AssetTooLargeError',
			code: 'asset-too-large',
			phase: 'asset',
			runtimeId: 'STREAMING_STDIN_TEST',
			actual: 1024,
			limit: 32
		});
		expect(workerInstances).toHaveLength(0);
	});

	it('cancels an unknown-length worker-script stream after its byte limit', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(new Response(new Uint8Array(64)));
		const sandbox = createStreamingTestSandbox();

		await expect(
			sandbox.load('/absproxy/5173', '', true, [], {
				limits: { maxAssetBytes: 32 }
			})
		).rejects.toMatchObject({
			name: 'AssetTooLargeError',
			code: 'asset-too-large',
			phase: 'asset',
			runtimeId: 'STREAMING_STDIN_TEST',
			actual: 64,
			limit: 32
		});
		expect(workerInstances).toHaveLength(0);
	});

	it('releases a successful static worker response reader', async () => {
		const cancel = vi.fn(async () => undefined);
		const releaseLock = vi.fn();
		const workerBytes = new TextEncoder().encode(prologWorkerSource);
		const read = vi
			.fn()
			.mockResolvedValueOnce({ done: false, value: workerBytes })
			.mockResolvedValueOnce({ done: true, value: undefined });
		vi.mocked(fetch).mockResolvedValueOnce({
			ok: true,
			status: 200,
			url: '',
			headers: new Headers(),
			body: { getReader: () => ({ cancel, read, releaseLock }) }
		} as unknown as Response);
		const sandbox = createPrologLifecycleTestSandbox();

		await sandbox.load('/absproxy/5173');

		expect(cancel).not.toHaveBeenCalled();
		expect(releaseLock).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(1);
	});

	it('cancels and releases a static worker reader when streaming fails', async () => {
		const cancel = vi.fn(async () => undefined);
		const releaseLock = vi.fn();
		const read = vi.fn().mockRejectedValueOnce(new Error('worker stream failed'));
		vi.mocked(fetch).mockResolvedValueOnce({
			ok: true,
			status: 200,
			url: '',
			headers: new Headers(),
			body: { getReader: () => ({ cancel, read, releaseLock }) }
		} as unknown as Response);
		const sandbox = createPrologLifecycleTestSandbox();

		await expect(sandbox.load('/absproxy/5173')).rejects.toThrow(
			'Prolog worker script failed to load: worker stream failed'
		);
		expect(cancel).toHaveBeenCalledOnce();
		expect(releaseLock).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(0);
	});

	it('preserves disposal when initial load progress disposes and then throws', async () => {
		const sandbox = createPrologLifecycleTestSandbox();
		const callbackError = new Error('initial load progress failed');
		const progress = {
			set: vi.fn((value: number, stage?: string) => {
				if (value !== 0 || stage !== 'Resolving Prolog runtime') return;
				void sandbox.dispose();
				throw callbackError;
			})
		};

		await expect(
			sandbox.load('/absproxy/5173', '', true, [], {}, progress)
		).rejects.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'dispose',
			runtimeId: 'PROLOG'
		});
		expect(fetch).not.toHaveBeenCalled();
		expect(workerInstances).toHaveLength(0);
	});

	it.each([0.05, 0.22])(
		'preserves disposal and cleans the asset deadline at %s load progress',
		async (disposeAt) => {
			const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
			const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
			const sandbox = createPrologLifecycleTestSandbox();
			const callbackError = new Error(`load progress ${disposeAt} failed`);
			const progress = {
				set: vi.fn((value: number) => {
					if (value !== disposeAt) return;
					void sandbox.dispose();
					throw callbackError;
				})
			};

			await expect(
				sandbox.load(
					'/absproxy/5173',
					'',
					true,
					[],
					{ limits: { assetTimeoutMs: 12_345 } },
					progress
				)
			).rejects.toMatchObject({
				name: 'CancelledError',
				code: 'cancelled',
				phase: 'dispose',
				runtimeId: 'PROLOG'
			});
			const assetTimerIndex = setTimeoutSpy.mock.calls.findIndex(
				([, delay]) => delay === 12_345
			);
			expect(assetTimerIndex).toBeGreaterThanOrEqual(0);
			expect(clearTimeoutSpy).toHaveBeenCalledWith(
				setTimeoutSpy.mock.results[assetTimerIndex]?.value
			);
			expect(workerInstances).toHaveLength(0);
		}
	);

	it('does not start a fetch when signal registration reentrantly disposes the sandbox', async () => {
		const sandbox = createPrologLifecycleTestSandbox();
		const removeEventListener = vi.fn();
		const signal = {
			aborted: false,
			reason: undefined,
			addEventListener: vi.fn(() => {
				void sandbox.dispose();
			}),
			removeEventListener
		} as unknown as AbortSignal;

		await expect(
			sandbox.load('/absproxy/5173', '', true, [], { signal })
		).rejects.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'dispose',
			runtimeId: 'PROLOG'
		});
		expect(fetch).not.toHaveBeenCalled();
		expect(removeEventListener).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(0);
	});

	it('preserves disposal when worker construction reenters and termination throws', async () => {
		autoStartWorkers = false;
		const previousWorker = globalThis.Worker;
		let sandbox!: Prolog;
		class ReentrantWorker extends MockWorker {
			constructor(url: string, options?: WorkerOptions) {
				super(url, options);
				this.terminate.mockImplementation(() => {
					throw new Error('worker termination failed');
				});
				void sandbox.dispose();
			}
		}
		vi.stubGlobal('Worker', ReentrantWorker);

		try {
			sandbox = createPrologLifecycleTestSandbox();
			await expect(sandbox.load('/absproxy/5173')).rejects.toMatchObject({
				name: 'CancelledError',
				code: 'cancelled',
				phase: 'dispose',
				runtimeId: 'PROLOG'
			});
			expect(workerInstances).toHaveLength(1);
			expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
			expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
		} finally {
			vi.stubGlobal('Worker', previousWorker);
		}
	});

	it('preserves disposal when a reentrant worker constructor throws', async () => {
		autoStartWorkers = false;
		const previousWorker = globalThis.Worker;
		let sandbox!: Prolog;
		class ReentrantThrowingWorker extends MockWorker {
			constructor(url: string, options?: WorkerOptions) {
				super(url, options);
				void sandbox.dispose();
				throw new Error('worker construction failed');
			}
		}
		vi.stubGlobal('Worker', ReentrantThrowingWorker);

		try {
			sandbox = createPrologLifecycleTestSandbox();
			await expect(sandbox.load('/absproxy/5173')).rejects.toMatchObject({
				name: 'CancelledError',
				code: 'cancelled',
				phase: 'dispose',
				runtimeId: 'PROLOG'
			});
			expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
		} finally {
			vi.stubGlobal('Worker', previousWorker);
		}
	});

	it('cleans startup state when a worker handler setter throws', async () => {
		autoStartWorkers = false;
		const previousWorker = globalThis.Worker;
		const handlerSetter = vi.fn(() => {
			throw new Error('worker handler assignment failed');
		});
		class ThrowingHandlerWorker extends MockWorker {
			constructor(url: string, options?: WorkerOptions) {
				super(url, options);
				Object.defineProperty(this, 'onerror', {
					configurable: true,
					get: () => null,
					set: handlerSetter
				});
			}
		}
		vi.stubGlobal('Worker', ThrowingHandlerWorker);
		const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
		const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

		try {
			const sandbox = createPrologLifecycleTestSandbox();
			await expect(
				sandbox.load('/absproxy/5173', '', true, [], {
					limits: { startupTimeoutMs: 23_456 }
				})
			).rejects.toThrow('worker handler assignment failed');
			const startupTimerIndex = setTimeoutSpy.mock.calls.findIndex(
				([, delay]) => delay === 23_456
			);
			expect(startupTimerIndex).toBeGreaterThanOrEqual(0);
			expect(clearTimeoutSpy).toHaveBeenCalledWith(
				setTimeoutSpy.mock.results[startupTimerIndex]?.value
			);
			expect(handlerSetter).toHaveBeenCalledTimes(2);
			expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
		} finally {
			vi.stubGlobal('Worker', previousWorker);
		}
	});

	it('aborts a pending worker download and rejects later use after idempotent disposal', async () => {
		let fetchSignal: AbortSignal | undefined;
		vi.mocked(fetch).mockImplementationOnce(
			(_input, init) =>
				new Promise<Response>((_resolve, reject) => {
					fetchSignal = init?.signal ?? undefined;
					fetchSignal?.addEventListener('abort', () => reject(fetchSignal?.reason), {
						once: true
					});
				})
		);
		const sandbox = createPrologLifecycleTestSandbox();
		const load = sandbox.load('/absproxy/5173');
		await vi.waitFor(() => expect(fetchSignal).toBeDefined());

		const firstDisposal = sandbox.dispose();
		const secondDisposal = sandbox.dispose();

		expect(secondDisposal).toBe(firstDisposal);
		await expect(load).rejects.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'dispose',
			runtimeId: 'PROLOG'
		});
		await expect(firstDisposal).resolves.toBeUndefined();
		expect(fetchSignal?.aborted).toBe(true);
		expect(workerInstances).toHaveLength(0);

		await expect(sandbox.load('/absproxy/5173')).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			phase: 'dispose',
			runtimeId: 'PROLOG'
		});
		await expect(sandbox.run('writeln(ok).', false)).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			phase: 'dispose',
			runtimeId: 'PROLOG'
		});
		sandbox.write('ignored after disposal\n');
		sandbox.eof();
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
		expect(fetch).toHaveBeenCalledOnce();
	});

	it('detaches a pending worker bootstrap exactly once when disposed', async () => {
		autoStartWorkers = false;
		const sandbox = createPrologLifecycleTestSandbox();
		const output = vi.fn();
		const diagnostic = vi.fn();
		sandbox.output = output;
		sandbox.oncompilerdiagnostic = diagnostic;
		const load = sandbox.load('/absproxy/5173');
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		const worker = workerInstances[0];
		const bootstrapUrl = worker.url;

		await sandbox.dispose();

		await expect(load).rejects.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'dispose',
			runtimeId: 'PROLOG'
		});
		expect(worker.onmessage).toBeNull();
		expect(worker.onerror).toBeNull();
		expect(worker.onmessageerror).toBeNull();
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
		expect(URL.revokeObjectURL).toHaveBeenCalledWith(bootstrapUrl);
		expect(sandbox.output).toBeNull();
		expect(sandbox.oncompilerdiagnostic).toBeUndefined();

		sandbox.terminate();
		await sandbox.clear();
		await sandbox.dispose();
		expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it('settles a prebuffered stdin waiter with the disposal reason', async () => {
		await withCrossOriginIsolation(false, async () => {
			const sandbox = createStreamingTestSandbox();
			await sandbox.load();
			const worker = workerInstances[0];
			const run = sandbox.run('read()', false);
			await vi.waitFor(() => expect(sandbox.stdinWaiters).toHaveLength(1));

			await sandbox.dispose();

			await expect(run).rejects.toMatchObject({
				name: 'CancelledError',
				code: 'cancelled',
				phase: 'dispose',
				runtimeId: 'STREAMING_STDIN_TEST'
			});
			expect(sandbox.stdinWaiters).toEqual([]);
			expect(sandbox.pendingInput).toEqual([]);
			expect(sandbox.pendingEof).toBe(false);
			expect(worker.terminate).toHaveBeenCalledOnce();
		});
	});

	it('cancels an active streaming stdin ring when disposed', async () => {
		await withCrossOriginIsolation(true, async () => {
			const messages: any[] = [];
			onPostMessage = (_worker, message) => messages.push(message);
			const sandbox = createStreamingTestSandbox();
			await sandbox.load();
			const worker = workerInstances[0];
			const run = sandbox.run('read()', false);
			await vi.waitFor(() => expect(messages.some((message) => message.run)).toBe(true));
			const runMessage = messages.find((message) => message.run);
			const control = new Int32Array(
				runMessage.stdinChannel.buffer,
				0,
				STATIC_STDIN_RING_CONTROL_SLOTS
			);

			await sandbox.dispose();

			await expect(run).rejects.toMatchObject({
				name: 'CancelledError',
				code: 'cancelled',
				phase: 'dispose',
				runtimeId: 'STREAMING_STDIN_TEST'
			});
			expect(Atomics.load(control, STATIC_STDIN_RING_CANCELLED_INDEX)).toBe(1);
			expect(Atomics.load(control, STATIC_STDIN_RING_CLOSED_INDEX)).toBe(1);
			expect(worker.onmessage).toBeNull();
			expect(worker.terminate).toHaveBeenCalledOnce();
		});
	});

	it('preserves disposal when a streaming stdin getter disposes and then throws', async () => {
		await withCrossOriginIsolation(true, async () => {
			const sandbox = createStreamingTestSandbox();
			await sandbox.load();
			const worker = workerInstances[0];
			const options = {
				get stdin(): string {
					void sandbox.dispose();
					throw new Error('stdin getter failed after disposal');
				}
			};

			await expect(
				sandbox.run('read()', false, true, undefined, [], options)
			).rejects.toMatchObject({
				name: 'CancelledError',
				code: 'cancelled',
				phase: 'dispose',
				runtimeId: 'STREAMING_STDIN_TEST'
			});
			expect(worker.postMessage).not.toHaveBeenCalled();
			expect(worker.terminate).toHaveBeenCalledOnce();
		});
	});

	it('terminates a pending worker startup when its signal is aborted', async () => {
		autoStartWorkers = false;
		const controller = new AbortController();
		const sandbox = createPrologLifecycleTestSandbox();
		const load = sandbox.load('/absproxy/5173', '', true, [], {
			signal: controller.signal
		});
		const outcome = load.catch((error) => error);
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		controller.abort(new Error('cancel startup'));

		await expect(outcome).resolves.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'startup',
			runtimeId: 'PROLOG'
		});
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
	});

	it('reports manual termination of pending startup as typed cancellation', async () => {
		autoStartWorkers = false;
		const sandbox = createPrologLifecycleTestSandbox();
		const outcome = sandbox.load('/absproxy/5173').catch((error) => error);
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));

		sandbox.terminate();

		await expect(outcome).resolves.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'startup',
			runtimeId: 'PROLOG'
		});
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
	});

	it('terminates a static worker that misses its startup deadline', async () => {
		autoStartWorkers = false;
		const sandbox = createPrologLifecycleTestSandbox();
		const load = sandbox.load('/absproxy/5173', '', true, [], {
			limits: { startupTimeoutMs: 5 }
		});
		const outcome = load.catch((error) => error);
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));

		await expect(outcome).resolves.toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'startup',
			runtimeId: 'PROLOG',
			timeoutMs: 5
		});
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
	});

	it('rejects worker script download and bootstrap import failures', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 404 }));
		const missingScript = createPrologLifecycleTestSandbox();
		await expect(missingScript.load('/absproxy/5173')).rejects.toThrow(
			'Prolog worker script failed to load: HTTP 404'
		);
		expect(workerInstances).toHaveLength(0);

		autoStartWorkers = false;
		const invalidScript = createPrologLifecycleTestSandbox();
		const load = invalidScript.load('/absproxy/5173');
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		const startupCause = new SyntaxError('Unexpected token');
		workerInstances[0].onerror?.(
			new ErrorEvent('error', {
				error: startupCause,
				message: 'Unexpected token',
				filename: '/wasm-prolog/runner-worker.js',
				lineno: 3,
				colno: 7
			})
		);
		await expect(load).rejects.toMatchObject({
			name: 'WorkerStartupError',
			code: 'worker-startup',
			phase: 'startup',
			runtimeId: 'PROLOG',
			cause: startupCause,
			message:
				'Prolog worker script error: Unexpected token (/wasm-prolog/runner-worker.js:3:7)'
		});
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
	});

	it('types worker construction failures as startup errors', async () => {
		const previousWorker = globalThis.Worker;
		const startupCause = new Error('worker constructor unavailable');
		class ThrowingWorker {
			constructor() {
				throw startupCause;
			}
		}
		vi.stubGlobal('Worker', ThrowingWorker);

		try {
			const sandbox = createPrologLifecycleTestSandbox();
			await expect(sandbox.load('/absproxy/5173')).rejects.toMatchObject({
				name: 'WorkerStartupError',
				code: 'worker-startup',
				phase: 'startup',
				runtimeId: 'PROLOG',
				cause: startupCause,
				message: 'Prolog worker failed to start: worker constructor unavailable'
			});
			expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
		} finally {
			vi.stubGlobal('Worker', previousWorker);
		}
	});

	it('preserves protocol classification for message errors before worker readiness', async () => {
		autoStartWorkers = false;
		const sandbox = createPrologLifecycleTestSandbox();
		const load = sandbox.load('/absproxy/5173');
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		const messageError = new MessageEvent('messageerror', { data: 'invalid bootstrap' });

		workerInstances[0].onmessageerror?.(messageError);

		await expect(load).rejects.toMatchObject({
			name: 'ProtocolError',
			code: 'protocol',
			phase: 'protocol',
			runtimeId: 'PROLOG',
			cause: messageError,
			message: 'Prolog worker message deserialization failed'
		});
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
	});

	it('rejects the active run when its worker crashes', async () => {
		const sandbox = createPrologLifecycleTestSandbox();
		await sandbox.load('/absproxy/5173');
		const executionCause = new WebAssembly.RuntimeError('unreachable');
		onPostMessage = (worker) => {
			queueMicrotask(() => {
				worker.onerror?.(
					new ErrorEvent('error', {
						error: executionCause,
						message: 'runtime crashed',
						filename: '/wasm-prolog/runner-worker.js',
						lineno: 9,
						colno: 2
					})
				);
			});
		};

		await expect(
			sandbox.run('writeln(ok).', false, true, undefined, [], { stdin: '' })
		).rejects.toMatchObject({
			name: 'RuntimeExecutionError',
			code: 'runtime',
			phase: 'execute',
			runtimeId: 'PROLOG',
			cause: executionCause,
			message:
				'Prolog worker script error: runtime crashed (/wasm-prolog/runner-worker.js:9:2)'
		});
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
	});

	it('types worker message deserialization failures as protocol errors', async () => {
		const sandbox = createPrologLifecycleTestSandbox();
		await sandbox.load('/absproxy/5173');
		const messageError = new MessageEvent('messageerror', { data: 'invalid clone' });
		onPostMessage = (worker) => {
			queueMicrotask(() => {
				worker.onmessageerror?.(messageError);
			});
		};

		await expect(
			sandbox.run('writeln(ok).', false, true, undefined, [], { stdin: '' })
		).rejects.toMatchObject({
			name: 'ProtocolError',
			code: 'protocol',
			phase: 'protocol',
			runtimeId: 'PROLOG',
			cause: messageError,
			message: 'Prolog worker message deserialization failed'
		});
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
	});

	it('types synchronous run dispatch failures as protocol errors', async () => {
		const sandbox = createPrologLifecycleTestSandbox();
		await sandbox.load('/absproxy/5173');
		const dispatchCause = new DOMException('Value could not be cloned', 'DataCloneError');
		onPostMessage = () => {
			throw dispatchCause;
		};

		const outcome = await sandbox
			.run('writeln(ok).', false, true, undefined, [], { stdin: '' })
			.catch((error) => error);
		expect(outcome).toMatchObject({
			name: 'ProtocolError',
			code: 'protocol',
			phase: 'protocol',
			runtimeId: 'PROLOG',
			message: 'Prolog worker run dispatch failed: Value could not be cloned'
		});
		expect(outcome.cause).toBe(dispatchCause);
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
	});
});
