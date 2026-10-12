import { validateWorkspaceSnapshot } from './workspaceSnapshot';

const BACKUP_FORMAT_PREFIX = 'wasm-idle-workspace-backup';
export const WORKSPACE_BACKUP_FORMAT = `${BACKUP_FORMAT_PREFIX}-v1`;

/** Avoid converting binary/ZIP input to text or a data URL just to sniff a backup. */
export function parseWorkspaceBackupBytes(bytes: Uint8Array) {
	let index = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
	while (index < bytes.length && [0x20, 0x09, 0x0a, 0x0d].includes(bytes[index])) index++;
	return bytes[index] === 0x7b ? parseWorkspaceBackup(new TextDecoder().decode(bytes)) : null;
}

export function serializeWorkspaceBackup(snapshot: unknown): string {
	validateWorkspaceSnapshot(snapshot);
	return JSON.stringify({ format: WORKSPACE_BACKUP_FORMAT, snapshot }, null, 2);
}

/** Detect backup contents independently of their filename, preserving ordinary source JSON. */
export function parseWorkspaceBackup(text: string): Record<string, unknown> | null {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return null;
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const candidate = value as Record<string, unknown>;
	if (typeof candidate.format === 'string' && candidate.format.startsWith(BACKUP_FORMAT_PREFIX)) {
		if (candidate.format !== WORKSPACE_BACKUP_FORMAT) {
			throw new Error(`Unsupported workspace backup format: ${candidate.format}`);
		}
		validateWorkspaceSnapshot(candidate.snapshot);
		return candidate.snapshot;
	}
	// Unmarked legacy backups need a complete identity, not just common JSON keys.
	if (
		typeof candidate.version !== 'number' ||
		typeof candidate.language !== 'string' ||
		typeof candidate.activePath !== 'string' ||
		(candidate.files === undefined && candidate.workspaces === undefined)
	)
		return null;
	validateWorkspaceSnapshot(candidate);
	return candidate;
}
