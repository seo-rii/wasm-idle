import type { ProgressLike, RuntimeProgressEvent, WorkspaceFile } from '@wasm-idle/core';
import type { SandboxRuntimeAssets } from '../playground/sandbox.js';

export const CONTAINER_WORKER_PROTOCOL = 1;
export const OWNER_CLEANUP_DEADLINE_MS = 2_000;

export interface ContainerWorkerInitialization {
	runtimeAssets: SandboxRuntimeAssets;
	applicationRootURL: string;
	workspaceId: string;
}
export type ContainerWorkspaceFile = WorkspaceFile;
export interface ContainerWorkspaceEntry {
	/** Path relative to /workspace, independent of the selected language. */
	path: string;
	type: 'file' | 'directory' | 'symlink';
	size: number;
}
export interface ContainerWorkerEvent {
	language?: string;
	name: 'output' | 'debug' | 'diagnostic' | 'image' | 'shell-output' | 'workspace';
	data: unknown;
	requestId?: number;
}
export type ContainerWorkerProgress =
	| { kind: 'set'; value: number; stage?: string }
	| { kind: 'report'; event: RuntimeProgressEvent };
export interface ContainerWorkerCallOptions {
	signal?: AbortSignal;
	progress?: ProgressLike;
}
export interface ContainerWorkerError {
	name: string;
	message: string;
	code?: string;
}
export type ContainerWorkerRequest = {
	version: typeof CONTAINER_WORKER_PROTOCOL;
	channel: string;
	id: number;
} & (
	| { type: 'init'; settings: ContainerWorkerInitialization }
	| { type: 'call'; method: string; args: unknown[] }
	| { type: 'cancel' }
);
export type ContainerWorkerResponse = {
	version: typeof CONTAINER_WORKER_PROTOCOL;
	channel: string;
	id: number;
} & (
	| { type: 'result'; value: unknown }
	| { type: 'error'; error: ContainerWorkerError }
	| { type: 'event'; event: ContainerWorkerEvent }
	| { type: 'progress'; progress: ContainerWorkerProgress }
);

export function serializeContainerWorkerError(error: unknown): ContainerWorkerError {
	const value = error as { name?: unknown; message?: unknown; code?: unknown } | null;
	return {
		name: typeof value?.name === 'string' ? value.name : 'Error',
		message: typeof value?.message === 'string' ? value.message : String(error),
		...(typeof value?.code === 'string' ? { code: value.code } : {})
	};
}

/** A worker receives data snapshots; AbortSignal is transferred as cancellation messages. */
export function snapshotContainerArguments<T>(value: T): T {
	const clean = (input: unknown): unknown => {
		if (Array.isArray(input)) return input.map(clean);
		if (
			input &&
			typeof input === 'object' &&
			Object.getPrototypeOf(input) === Object.prototype
		) {
			return Object.fromEntries(
				Object.entries(input)
					.filter(
						([key, entry]) =>
							key !== 'signal' ||
							typeof AbortSignal === 'undefined' ||
							!(entry instanceof AbortSignal)
					)
					.map(([key, entry]) => [key, clean(entry)])
			);
		}
		return input;
	};
	return structuredClone(clean(value)) as T;
}
