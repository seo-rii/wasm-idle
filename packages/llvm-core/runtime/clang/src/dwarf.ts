import type {
	BrowserClangCompileRequest,
	DwarfDebugDescriptor,
	RuntimeCompilerProvenance
} from './types.js';
import { normalizeDwarfWorkspacePath, resolveBuildArtifactNames } from './workspace.js';

async function sha256Hex(value: string | Uint8Array | ArrayBuffer) {
	const bytes =
		typeof value === 'string'
			? new TextEncoder().encode(value)
			: value instanceof Uint8Array
				? new Uint8Array(value)
				: new Uint8Array(value);
	const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
		''
	);
}

export async function createDwarfDebugDescriptor(
	request: BrowserClangCompileRequest,
	artifactBytes: Uint8Array,
	provenance?: RuntimeCompilerProvenance
): Promise<DwarfDebugDescriptor> {
	if (!provenance) {
		throw new Error(
			'LLDB debug compilation requires compiler provenance in the wasm-clang runtime manifest'
		);
	}

	const language = request.language || 'CPP';
	const requestedInput =
		normalizeDwarfWorkspacePath(request.activePath || '') ||
		normalizeDwarfWorkspacePath(request.fileName || '') ||
		undefined;
	const { input } = resolveBuildArtifactNames(language, requestedInput);
	const sources = new Map<string, string>();
	for (const file of request.workspaceFiles || []) {
		const sourcePath = normalizeDwarfWorkspacePath(file.path);
		if (sourcePath) sources.set(sourcePath, file.content);
	}
	sources.set(input, request.code);

	const sourceEntries = [...sources.entries()].sort(([left], [right]) =>
		left < right ? -1 : left > right ? 1 : 0
	);
	return {
		kind: 'dwarf',
		sourceRoot: '/workspace',
		moduleSha256: await sha256Hex(artifactBytes),
		files: await Promise.all(
			sourceEntries.map(async ([path, content]) => ({
				path: `/workspace/${path}`,
				contentSha256: await sha256Hex(content)
			}))
		),
		compiler: provenance
	};
}
