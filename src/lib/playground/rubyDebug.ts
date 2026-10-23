import { DebugCommandMailbox } from './debugMailbox';
import type { DebugCommand, DebugScope, DebugSessionEvent, DebugVariable } from './options';

export class RubyDebugSession {
	readonly mailbox = new DebugCommandMailbox('Ruby');
	private nextRequest = 0;
	private pending = new Map<
		number,
		{
			resolve(value: any): void;
			reject(error: Error): void;
			timer: ReturnType<typeof setTimeout>;
		}
	>();
	private frames = new Map<number, DebugVariable[]>();
	private frameId?: number;
	private closed = false;
	constructor(
		private readonly sourcePath: string,
		private readonly emit: (event: DebugSessionEvent) => void
	) {}
	handle(message: any) {
		if (this.closed) return;
		if (message.consumed) this.mailbox.flush();
		if (message.response) {
			const response = message.response;
			const pending = this.pending.get(response.id);
			if (!pending) return;
			this.pending.delete(response.id);
			clearTimeout(pending.timer);
			if (response.error) pending.reject(new Error(response.error));
			else pending.resolve(response.value);
			return;
		}
		const event = message.event;
		if (!event) return;
		if (event.type === 'pause') {
			this.frames.clear();
			for (const frame of message.frames ?? []) this.frames.set(frame.id, frame.locals);
			this.frameId = event.frameId;
		} else if (event.type === 'resume') {
			this.frames.clear();
			this.frameId = undefined;
			for (const pending of this.pending.values()) {
				clearTimeout(pending.timer);
				pending.reject(new Error('Ruby evaluation became stale'));
			}
			this.pending.clear();
		}
		this.emit(event);
	}
	command(command: DebugCommand) {
		this.mailbox.send(JSON.stringify({ op: 'control', command }));
	}
	pause() {
		this.mailbox.send(JSON.stringify({ op: 'pause' }));
	}
	setBreakpoints(lines: number[], sourcePath = this.sourcePath) {
		if (lines.length > 1024 || lines.some((line) => !Number.isSafeInteger(line) || line < 1))
			throw new RangeError('Invalid Ruby breakpoint lines');
		this.mailbox.send(JSON.stringify({ op: 'breakpoints', lines, sourcePath }));
	}
	evaluate(expression: string) {
		if (expression.length > 4096)
			return Promise.reject(new RangeError('Expression exceeds 4096 characters'));
		if (this.closed || this.frameId === undefined)
			return Promise.reject(new Error('Ruby evaluation requires a paused frame'));
		return new Promise<string>((resolve, reject) => {
			const id = ++this.nextRequest;
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error('Ruby evaluation timed out'));
			}, 10_000);
			this.pending.set(id, { resolve, reject, timer });
			try {
				this.mailbox.send(
					JSON.stringify({ op: 'evaluate', id, expression, frameId: this.frameId })
				);
			} catch (error) {
				clearTimeout(timer);
				this.pending.delete(id);
				reject(error);
			}
		});
	}
	scopes(frameId: number, select = true): DebugScope[] {
		if (!this.frames.has(frameId)) return [];
		if (select) this.frameId = frameId;
		return [
			{
				name: 'Locals',
				variablesReference: frameId,
				namedVariables: this.frames.get(frameId)!.length,
				expensive: false,
				variables: this.frames.get(frameId)!
			}
		];
	}
	variables(reference: number, start = 0, count = 50) {
		if (
			!Number.isSafeInteger(start) ||
			start < 0 ||
			!Number.isSafeInteger(count) ||
			count < 0 ||
			count > 1000
		)
			throw new RangeError('Invalid Ruby variable page');
		return (this.frames.get(reference) ?? []).slice(start, start + count);
	}
	dispose() {
		if (this.closed) return;
		this.closed = true;
		this.mailbox.close();
		this.frames.clear();
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(new Error('Ruby debugger stopped'));
		}
		this.pending.clear();
		try {
			this.emit({ type: 'stop' });
		} catch {
			/* Cleanup survives caller notification failures. */
		}
	}
}
