import type { Script } from 'node:vm';
import type { GrainHostFile } from './runtime-workers/grain-host.mjs';

export const GRAIN_PROFILE_ID: string;
/** Runs upstream grainc.bc.js in a fresh realm through the browser Worker's in-memory host. */
export function runGrainc(
	script: Script,
	files: readonly GrainHostFile[],
	argv: readonly string[]
): { status: number; output: string; files: Required<GrainHostFile>[] };
export function syncGrain(): Promise<void>;
