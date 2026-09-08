/** UTF-8 chunks stay intact while clangd consumes one byte at a time. */
export class ClangdStdinQueue {
	private chunks: Uint8Array[] = [];
	private chunkIndex = 0;
	private offset = 0;
	private waiters: Array<() => void> = [];

	get hasBytes() {
		return this.chunkIndex < this.chunks.length;
	}

	push(chunk: Uint8Array) {
		if (!chunk.byteLength) return;
		this.chunks.push(chunk);
		for (const resolve of this.waiters.splice(0)) resolve();
	}

	read(): number | null {
		const chunk = this.chunks[this.chunkIndex];
		if (!chunk) return null;
		const byte = chunk[this.offset++];
		if (this.offset === chunk.length) {
			this.offset = 0;
			this.chunkIndex++;
			if (this.chunkIndex === this.chunks.length) {
				this.chunks = [];
				this.chunkIndex = 0;
			} else if (this.chunkIndex >= 64) {
				this.chunks = this.chunks.slice(this.chunkIndex);
				this.chunkIndex = 0;
			}
		}
		return byte;
	}

	ready(): Promise<void> {
		return this.hasBytes
			? Promise.resolve()
			: new Promise((resolve) => this.waiters.push(resolve));
	}
}
