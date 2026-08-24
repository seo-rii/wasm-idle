import type { MessageReader, MessageWriter } from 'vscode-jsonrpc';
import type { CompilerOptions } from 'typescript';
import type { LanguageToolAssetConfig } from './assets.js';
import type { DOuterAssetReceipts } from './d/assets.js';
import type { DocumentLanguageId } from './document/service.js';
import type { ElixirRuntimeAssetReceipts } from './elixir/assets.js';
import type {
	HaskellRuntimeAssetReceipts,
	JanetRuntimePreflightProfile,
	PascalRuntimePreflightProfile,
	PerlRuntimePreflightProfile,
	PrologRuntimePreflightProfile,
	RubyRuntimePreflightProfile,
	RuntimeAssetIntegrityEntry,
	TclRuntimePreflightProfile
} from '@wasm-idle/core';

export interface DuckDBBundleConfig {
	mainModule: string;
	mainWorker: string;
	pthreadWorker?: string;
}

export interface DuckDBBundles {
	mvp: DuckDBBundleConfig;
	eh?: DuckDBBundleConfig;
	coi?: DuckDBBundleConfig & { pthreadWorker: string };
}

export interface EditorLanguageServerTransport {
	reader: MessageReader;
	writer: MessageWriter;
}

export interface EditorLanguageServerHandle {
	transport: EditorLanguageServerTransport;
	syncFile?: (path: string) => void;
	dispose: () => void;
}

export interface EditorLanguageServerRuntimeOptions {
	createWorker?: () => Worker;
	currentUrl?: string;
	rootUrl?: string;
	signal?: AbortSignal;
	assetTimeoutMs?: number;
	maxAssetBytes?: number;
	startupTimeoutMs?: number;
	cpp?: LanguageToolAssetConfig;
	python?: {
		baseUrl?: string;
	};
	rust?: {
		compilerUrl?: string;
		targetTriple?: 'wasm32-wasip1' | 'wasm32-wasip2' | 'wasm32-wasip3';
		edition?: string;
	};
	go?: {
		compilerUrl?: string;
		target?: 'wasip1/wasm' | 'wasip2/wasm' | 'wasip3/wasm' | 'js/wasm';
	};
	d?: {
		moduleUrl?: string;
		manifestUrl?: string;
		integrity?: DOuterAssetReceipts;
		compileArgs?: string[];
	};
	typescript?: {
		compilerOptions?: CompilerOptions;
		extraLibs?: Record<string, string>;
		libUrl?: string;
	};
	javascript?: {
		compilerOptions?: CompilerOptions;
		extraLibs?: Record<string, string>;
		libUrl?: string;
	};
	wat?: {
		features?: Record<string, boolean>;
	};
	dotnet?: {
		moduleUrl?: string;
	};
	elixir?: {
		bundleUrl?: string;
		workerUrl?: string;
		integrity?: ElixirRuntimeAssetReceipts;
	};
	erlang?: {
		bundleUrl?: string;
		workerUrl?: string;
		integrity?: ElixirRuntimeAssetReceipts;
	};
	gleam?: {
		baseUrl?: string;
		manifestUrl?: string;
		manifestFingerprint?: string;
	};
	assemblyscript?: {
		moduleUrl?: string;
		extraFiles?: Record<string, string>;
	};
	zig?: {
		compilerUrl?: string;
		stdlibUrl?: string;
		targetTriple?: 'wasm64-wasi';
		compileArgs?: string[];
	};
	lua?: {
		moduleUrl?: string;
	};
	janet?: {
		baseUrl?: string;
		workerUrl?: string;
		manifestUrl?: string;
		manifestFingerprint?: string;
		profileId?: JanetRuntimePreflightProfile['profileId'];
		artifactRevision?: JanetRuntimePreflightProfile['artifactRevision'];
		janetVersion?: JanetRuntimePreflightProfile['janetVersion'];
		emscriptenVersion?: JanetRuntimePreflightProfile['emscriptenVersion'];
		manifestReceipt?: JanetRuntimePreflightProfile['manifestReceipt'];
		javascriptReceipt?: JanetRuntimePreflightProfile['javascriptReceipt'];
		wasmReceipt?: JanetRuntimePreflightProfile['wasmReceipt'];
		workerReceipt?: RuntimeAssetIntegrityEntry;
	};
	lisp?: {
		moduleUrl?: string;
		manifestUrl?: string;
		manifestFingerprint?: string;
	};
	octave?: {
		baseUrl?: string;
		workerUrl?: string;
		manifestUrl?: string;
	};
	ocaml?: {
		moduleUrl?: string;
		manifestUrl?: string;
		target?: 'js' | 'wasm';
		effectsMode?: 'cps' | 'jspi';
		wasmBinaryenMode?: 'fast' | 'full';
		packages?: string[];
	};
	haskell?: {
		moduleUrl?: string;
		rootfsUrl?: string;
		bsdtarUrl?: string;
		integrity?: HaskellRuntimeAssetReceipts;
		mainSoPath?: string;
		searchDirs?: string[];
		ghcArgs?: string;
	};
	sql?: {
		dialect?: 'sql' | 'sqlite' | 'duckdb';
		moduleUrl?: string;
		wasmUrl?: string;
		duckdbBundles?: DuckDBBundles;
	};
	graphql?: {
		schema?: string;
	};
	fortran?: {
		analyzerUrl?: string;
	};
	prolog?: {
		baseUrl?: string;
		workerUrl?: string;
		manifestUrl?: string;
		manifestFingerprint?: string;
		profileId?: PrologRuntimePreflightProfile['profileId'];
		packageRevision?: PrologRuntimePreflightProfile['packageRevision'];
		swiplRevision?: PrologRuntimePreflightProfile['swiplRevision'];
		manifestReceipt?: RuntimeAssetIntegrityEntry;
		javascriptReceipt?: RuntimeAssetIntegrityEntry;
		wasmReceipt?: RuntimeAssetIntegrityEntry;
		dataReceipt?: RuntimeAssetIntegrityEntry;
		workerReceipt?: RuntimeAssetIntegrityEntry;
	};
	ruby?: {
		baseUrl?: string;
		manifestUrl?: string;
		moduleUrl?: string;
		wasmUrl?: string;
		profileId?: RubyRuntimePreflightProfile['profileId'];
		artifactRevision?: RubyRuntimePreflightProfile['artifactRevision'];
		rubyVersion?: RubyRuntimePreflightProfile['rubyVersion'];
		rubyRevision?: RubyRuntimePreflightProfile['rubyRevision'];
		rubyWasmVersion?: RubyRuntimePreflightProfile['rubyWasmVersion'];
		rubyWasmRevision?: RubyRuntimePreflightProfile['rubyWasmRevision'];
		wasiSdkVersion?: RubyRuntimePreflightProfile['wasiSdkVersion'];
		manifestFingerprint?: RubyRuntimePreflightProfile['manifestFingerprint'];
		manifestReceipt?: RubyRuntimePreflightProfile['manifestReceipt'];
		moduleJavaScriptReceipt?: RubyRuntimePreflightProfile['moduleJavaScriptReceipt'];
		wasmReceipt?: RubyRuntimePreflightProfile['wasmReceipt'];
	};
	r?: {
		baseUrl?: string;
	};
	awk?: {
		baseUrl?: string;
		workerUrl?: string;
	};
	perl?: {
		baseUrl?: string;
		workerUrl?: string;
		manifestUrl?: string;
		manifestFingerprint?: string;
		profileId?: PerlRuntimePreflightProfile['profileId'];
		artifactRevision?: PerlRuntimePreflightProfile['artifactRevision'];
		webperlRevision?: PerlRuntimePreflightProfile['webperlRevision'];
		perlRevision?: PerlRuntimePreflightProfile['perlRevision'];
		emscriptenRevision?: PerlRuntimePreflightProfile['emscriptenRevision'];
		manifestReceipt?: RuntimeAssetIntegrityEntry;
		javascriptReceipt?: RuntimeAssetIntegrityEntry;
		wasmReceipt?: RuntimeAssetIntegrityEntry;
		dataReceipt?: RuntimeAssetIntegrityEntry;
		workerReceipt?: RuntimeAssetIntegrityEntry;
	};
	tcl?: {
		baseUrl?: string;
		workerUrl?: string;
		manifestUrl?: string;
		manifestFingerprint?: string;
		profileId?: TclRuntimePreflightProfile['profileId'];
		artifactRevision?: TclRuntimePreflightProfile['artifactRevision'];
		waclRevision?: TclRuntimePreflightProfile['waclRevision'];
		tclRevision?: TclRuntimePreflightProfile['tclRevision'];
		requireJsRevision?: TclRuntimePreflightProfile['requireJsRevision'];
		emscriptenRevision?: TclRuntimePreflightProfile['emscriptenRevision'];
		manifestReceipt?: RuntimeAssetIntegrityEntry;
		requireJsReceipt?: RuntimeAssetIntegrityEntry;
		customDataReceipt?: RuntimeAssetIntegrityEntry;
		libraryDataReceipt?: RuntimeAssetIntegrityEntry;
		glueReceipt?: RuntimeAssetIntegrityEntry;
		wasmReceipt?: RuntimeAssetIntegrityEntry;
		workerReceipt?: RuntimeAssetIntegrityEntry;
	};
	pascal?: {
		baseUrl?: string;
		workerUrl?: string;
		manifestUrl?: string;
		compilerJavaScriptUrl?: string;
		rtlJavaScriptUrl?: string;
		systemPascalUrl?: string;
		manifestFingerprint?: string;
		profileId?: PascalRuntimePreflightProfile['profileId'];
		artifactRevision?: PascalRuntimePreflightProfile['artifactRevision'];
		pas2jsVersion?: PascalRuntimePreflightProfile['pas2jsVersion'];
		pas2jsRevision?: PascalRuntimePreflightProfile['pas2jsRevision'];
		manifestReceipt?: PascalRuntimePreflightProfile['manifestReceipt'];
		compilerJavaScriptReceipt?: PascalRuntimePreflightProfile['compilerJavaScriptReceipt'];
		rtlJavaScriptReceipt?: PascalRuntimePreflightProfile['rtlJavaScriptReceipt'];
		systemPascalReceipt?: PascalRuntimePreflightProfile['systemPascalReceipt'];
		workerReceipt?: RuntimeAssetIntegrityEntry;
	};
	document?: {
		language?: DocumentLanguageId;
	};
}

export type EditorLanguageServerOptions = string | EditorLanguageServerRuntimeOptions;
