import { DebugCommandMailbox } from './debugMailbox';
import type { DebugCommand, DebugSessionEvent } from './options';

export class JavaDebugSession {
	readonly mailbox = new DebugCommandMailbox('Java');
	private closed = false;
	constructor(
		private readonly sourcePath: string,
		private readonly emit: (event: DebugSessionEvent) => void
	) {}
	handle(message: { consumed?: boolean; event?: DebugSessionEvent }) {
		if (this.closed) return;
		if (message.consumed) this.mailbox.flush();
		if (message.event) this.emit(message.event);
	}
	command(command: DebugCommand) {
		this.mailbox.send(JSON.stringify({ op: 'control', command }));
	}
	pause() {
		this.mailbox.send(JSON.stringify({ op: 'pause' }));
	}
	setBreakpoints(lines: number[], sourcePath = this.sourcePath) {
		if (lines.length > 1024 || lines.some((line) => !Number.isSafeInteger(line) || line < 1))
			throw new RangeError('Invalid Java breakpoint lines');
		this.mailbox.send(JSON.stringify({ op: 'breakpoints', lines, sourcePath }));
	}
	dispose() {
		if (this.closed) return;
		this.closed = true;
		this.mailbox.close();
		try {
			this.emit({ type: 'stop' });
		} catch {
			/* Mandatory cleanup precedes caller notifications. */
		}
	}
}
