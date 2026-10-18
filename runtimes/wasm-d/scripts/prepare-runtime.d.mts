export interface DProducerLock {
	schemaVersion: number;
	producerId: string;
	manifestSha256: string;
	sourceLockSha256: string;
	receiptSha256: string;
}

export const D_PRODUCER_ARTIFACTS: readonly string[];
export function verifyDProducerArtifacts(
	sourceDir: string,
	lock?: DProducerLock
): Promise<{
	receipt: Record<string, unknown>;
	files: Map<string, Buffer>;
}>;
export function prepareDProducerRuntime(options: {
	sourceDir?: string;
	targetDir: string;
	lock?: DProducerLock;
}): Promise<void>;
