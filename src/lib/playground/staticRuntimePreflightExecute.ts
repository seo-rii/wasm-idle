import type {
	BqnRuntimePreflightPayload,
	BqnRuntimePreflightRequest
} from '$lib/playground/bqnPreflight';
import { preflightBqnRuntimeAssets } from '$lib/playground/bqnPreflight';
import type {
	ClojureScriptRuntimePreflightPayload,
	ClojureScriptRuntimePreflightRequest
} from '$lib/playground/clojurescriptPreflight';
import { preflightClojureScriptRuntimeAssets } from '$lib/playground/clojurescriptPreflight';
import type {
	ForthRuntimePreflightPayload,
	ForthRuntimePreflightRequest
} from '$lib/playground/forthPreflight';
import { preflightForthRuntimeAssets } from '$lib/playground/forthPreflight';
import type {
	JRuntimePreflightPayload,
	JRuntimePreflightRequest
} from '$lib/playground/jPreflight';
import { preflightJRuntimeAssets } from '$lib/playground/jPreflight';
import type {
	StaticRuntimePreflightProgress,
	StaticRuntimePreflightRequestMessage
} from '$lib/playground/staticRuntimePreflightProtocol';
import {
	preflightJanetRuntimeAssets,
	preflightPrologRuntimeAssets,
	type JanetRuntimePreflightPayload,
	type JanetRuntimePreflightRequest,
	type PrologRuntimePreflightPayload,
	type PrologRuntimePreflightRequest
} from '@wasm-idle/core';

export type StaticRuntimePreflightPayload =
	| BqnRuntimePreflightPayload
	| ClojureScriptRuntimePreflightPayload
	| ForthRuntimePreflightPayload
	| JRuntimePreflightPayload
	| JanetRuntimePreflightPayload
	| PrologRuntimePreflightPayload;

export async function executeStaticRuntimePreflight(
	request: StaticRuntimePreflightRequestMessage,
	reportProgress: (progress: StaticRuntimePreflightProgress) => void,
	signal?: AbortSignal
): Promise<StaticRuntimePreflightPayload> {
	const shared = {
		baseUrl: request.baseUrl,
		manifestUrl: request.manifestUrl,
		limits: request.limits,
		signal,
		reportProgress: (
			progress: Parameters<NonNullable<BqnRuntimePreflightRequest['reportProgress']>>[0]
		) => reportProgress({ kind: 'asset', progress })
	};
	switch (request.runtimeId) {
		case 'BQN':
			return await preflightBqnRuntimeAssets({
				...shared,
				profile: request.profile as BqnRuntimePreflightRequest['profile'],
				reportDecompressionProgress(loadedBytes, totalBytes) {
					reportProgress({ kind: 'decompression', loadedBytes, totalBytes });
				}
			});
		case 'CLOJURESCRIPT':
			return await preflightClojureScriptRuntimeAssets({
				...shared,
				profile: request.profile as ClojureScriptRuntimePreflightRequest['profile'],
				reportDecompressionProgress(loadedBytes, totalBytes) {
					reportProgress({ kind: 'decompression', loadedBytes, totalBytes });
				}
			});
		case 'FORTH':
			return await preflightForthRuntimeAssets({
				...shared,
				profile: request.profile as ForthRuntimePreflightRequest['profile']
			});
		case 'J':
			return await preflightJRuntimeAssets({
				...shared,
				profile: request.profile as JRuntimePreflightRequest['profile'],
				reportDecompressionProgress(loadedBytes, totalBytes) {
					reportProgress({ kind: 'decompression', loadedBytes, totalBytes });
				}
			});
		case 'JANET':
			return await preflightJanetRuntimeAssets({
				...shared,
				profile: request.profile as JanetRuntimePreflightRequest['profile'],
				reportDecompressionProgress(_asset, loadedBytes, totalBytes) {
					reportProgress({ kind: 'decompression', loadedBytes, totalBytes });
				}
			});
		case 'PROLOG':
			return await preflightPrologRuntimeAssets({
				...shared,
				profile: request.profile as PrologRuntimePreflightRequest['profile'],
				reportDecompressionProgress(asset, loadedBytes, totalBytes) {
					reportProgress({
						kind: 'decompression',
						asset,
						loadedBytes,
						totalBytes
					});
				}
			});
	}
}
