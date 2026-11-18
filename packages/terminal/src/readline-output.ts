import type { IMarker, Terminal } from '@xterm/xterm';

// The pinned Bash profile emits OSC 6973 P at a prompt origin and R<row>
// before Readline clears its old display. Other terminals ignore both records.
const resizePrefix = '\x1b]6973;R';
const resizeRecord = /\x1b\]6973;R(\d{1,8})\x07/;

export function createReadlineOutput(
	terminal: Terminal,
	write: (text: string) => void,
	shellOwnsDisplay: () => boolean
) {
	let origin: IMarker | undefined;
	let pending = '';
	let flushing = false;
	let disposed = false;

	// xterm calls this after all preceding prompt/history bytes were parsed.
	const observer = terminal.parser.registerOscHandler(6973, (data) => {
		if (data !== 'P') return false;
		origin?.dispose();
		origin =
			shellOwnsDisplay() && terminal.buffer.active.type === 'normal'
				? terminal.registerMarker(0)
				: undefined;
		return true;
	});

	function drain() {
		if (disposed || flushing || !pending) return;
		const record = resizeRecord.exec(pending);
		if (record) {
			const before = pending.slice(0, record.index);
			pending = pending.slice(record.index + record[0].length);
			if (before) write(before);
			flushing = true;
			// Wait for queued old-width echo and prompt records before consulting the
			// marker. Queue the cursor correction ahead of the native clear/redraw.
			terminal.write('', () => {
				if (disposed) return;
				const buffer = terminal.buffer.active;
				if (
					origin &&
					!origin.isDisposed &&
					shellOwnsDisplay() &&
					buffer.type === 'normal' &&
					terminal.modes.bracketedPasteMode
				) {
					const row = origin.line - buffer.baseY + Number(record[1]);
					if (row >= 0 && row < terminal.rows) terminal.write(`\x1b[${row + 1};1H`);
				}
				flushing = false;
				drain();
			});
			return;
		}
		// Keep only a possible split record. Ordinary shell output streams directly.
		const escape = pending.lastIndexOf('\x1b');
		const suffix = escape < 0 ? '' : pending.slice(escape);
		const split =
			suffix &&
			(resizePrefix.startsWith(suffix) ||
				(suffix.startsWith(resizePrefix) &&
					/^\d{0,8}$/.test(suffix.slice(resizePrefix.length))));
		const count = split ? escape : pending.length;
		if (count) write(pending.slice(0, count));
		pending = pending.slice(count);
	}
	return {
		write(text: string) {
			if (disposed) return;
			pending += text;
			drain();
		},
		dispose() {
			disposed = true;
			pending = '';
			observer.dispose();
			origin?.dispose();
		}
	};
}
