export type BrowserExecutionStdinChunk = string | Uint8Array | ArrayBuffer | null;
export type BrowserExecutionStdinReader = (() => BrowserExecutionStdinChunk) | undefined;

export function toStandaloneBytes(value: Uint8Array | ArrayBuffer) {
	const source = value instanceof Uint8Array ? value : new Uint8Array(value);
	return new Uint8Array(source);
}

export function toTextBytes(value: Exclude<BrowserExecutionStdinChunk, null>) {
	if (typeof value === 'string') {
		return new TextEncoder().encode(value);
	}
	return toStandaloneBytes(value);
}

export class BufferedExecutionInput {
	private currentChunk = new Uint8Array(0);
	private currentOffset = 0;
	private readonly readInput: BrowserExecutionStdinReader;

	constructor(readInput: BrowserExecutionStdinReader) {
		this.readInput = readInput;
	}

	read(size: number) {
		while (this.currentOffset >= this.currentChunk.length) {
			if (!this.readInput) {
				return new Uint8Array(0);
			}
			const nextChunk = this.readInput();
			if (nextChunk === null) {
				return new Uint8Array(0);
			}
			if (nextChunk === undefined) {
				throw new Error(
					'wasm-rust stdin() must return null to signal EOF; undefined is not a valid stdin chunk'
				);
			}
			this.currentChunk = toTextBytes(nextChunk);
			this.currentOffset = 0;
			if (this.currentChunk.byteLength === 0) {
				throw new Error(
					'wasm-rust stdin() must return a non-empty chunk or null to signal EOF; empty chunks are not allowed'
				);
			}
		}
		const data = this.currentChunk.slice(this.currentOffset, this.currentOffset + size);
		this.currentOffset += data.byteLength;
		return data;
	}
}
