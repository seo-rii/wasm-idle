/** Each UTF-8 chunk is one complete Content-Length framed JSON-RPC message. */
export class ClangdStdinQueue {
	private chunks: Uint8Array[] = [];
	private chunkIndex = 0;
	private offset = 0;
	private readable = false;
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
		if (!this.readable) return null;
		const chunk = this.chunks[this.chunkIndex];
		if (!chunk) return null;
		const byte = chunk[this.offset++];
		if (this.offset === chunk.length) {
			// libc may read ahead while parsing the header. Keep the next frame
			// in this queue until JSONTransport calls stdinReady for its next loop,
			// instead of leaving it hidden in libc while stdinReady waits forever.
			this.readable = false;
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

	async ready(): Promise<void> {
		if (!this.hasBytes) await new Promise<void>((resolve) => this.waiters.push(resolve));
		this.readable = true;
	}
}
