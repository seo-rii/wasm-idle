/** Charges execution time while allowing a person to inspect a paused VM. */
export class DebugDeadline {
	private remaining: number;
	private started = 0;
	private timer?: ReturnType<typeof setTimeout>;
	private closed = false;
	constructor(
		timeoutMs: number,
		private readonly expire: () => void
	) {
		this.remaining = timeoutMs;
		this.resume();
	}
	pause() {
		if (this.timer === undefined) return;
		clearTimeout(this.timer);
		this.timer = undefined;
		this.remaining = Math.max(0, this.remaining - (Date.now() - this.started));
	}
	resume() {
		if (this.closed || this.timer !== undefined) return;
		this.started = Date.now();
		this.timer = setTimeout(() => {
			this.timer = undefined;
			this.closed = true;
			this.expire();
		}, this.remaining);
	}
	dispose() {
		this.pause();
		this.closed = true;
	}
}
