import type { IMarker, Terminal } from '@xterm/xterm';

type CellWidth = (character: string, offset: number) => number;

// Offsets count terminal cells from column zero of the input's first screen row.
// A wide character wraps early when only one cell remains on that row.
export class InputLineLayout {
	private readonly offsets: number[] = [];
	private readonly ends: number[] = [];
	readonly end: number;

	constructor(
		private readonly characters: string[],
		private readonly columns: number,
		private readonly startColumn: number,
		width: CellWidth
	) {
		let offset = startColumn;
		for (const character of characters) {
			let start = offset;
			// One editable grapheme can occupy several xterm cells (e.g. a ZWJ
			// emoji sequence under Unicode 11) and wrap between its code points.
			for (const codePoint of character) {
				const cells = width(codePoint, offset);
				const remaining = columns - (offset % columns);
				if (cells > remaining) {
					if (offset === start) start += remaining;
					offset += remaining;
				}
				offset += cells;
			}
			this.offsets.push(start);
			this.ends.push(offset);
		}
		this.end = offset;
	}

	rowAt(index: number) {
		return index < this.characters.length
			? Math.floor(this.offsets[index] / this.columns)
			: this.lastWrittenRow(this.end);
	}

	private lastWrittenRow(offset: number) {
		// xterm waits for the next printable character before wrapping at the right margin.
		return Math.floor(Math.max(0, offset - 1) / this.columns);
	}

	rowAfterPrefix(length: number) {
		return this.lastWrittenRow(length ? this.ends[length - 1] : this.startColumn);
	}

	// Keep the caret addressable by VT cursor controls. The suffix beyond the
	// viewport is still editable and returns when the cursor moves towards it.
	visibleLength(cursor: number, rows: number) {
		const lastVisibleRow = this.rowAt(cursor) + rows - 1;
		if (this.lastWrittenRow(this.end) <= lastVisibleRow) return this.characters.length;
		let low = cursor;
		let high = this.characters.length;
		while (low < high) {
			const middle = Math.ceil((low + high) / 2);
			if (this.rowAfterPrefix(middle) <= lastVisibleRow) low = middle;
			else high = middle - 1;
		}
		return low;
	}

	private moveToCell(fromRow: number, offset: number) {
		const rows = Math.floor(offset / this.columns) - fromRow;
		const vertical = rows ? `\x1b[${Math.abs(rows)}${rows < 0 ? 'A' : 'B'}` : '';
		return vertical + `\x1b[${(offset % this.columns) + 1}G`;
	}

	moveTo(fromRow: number, index: number) {
		if (index < this.characters.length) return this.moveToCell(fromRow, this.offsets[index]);
		if (this.characters.length && this.end % this.columns === 0) {
			// CHA cannot select the pending-wrap position one past the final column.
			let last = this.characters.length - 1;
			// A horizontal tab at the pending right margin does not move the cursor.
			while (last > 0 && this.offsets[last] === this.end) last--;
			return this.moveToCell(fromRow, this.offsets[last]) + this.characters[last];
		}
		return this.moveToCell(fromRow, this.end);
	}

	redraw(fromRow: number, oldEnd: number, changed: number, cursor: number) {
		// Begin immediately after the unchanged prefix so an old wide-character
		// wrap can also be filled by a newly inserted narrow character.
		const start = changed ? this.ends[changed - 1] : this.startColumn;
		// A raw tab moves over old text without erasing it during a redraw.
		const tail = this.characters
			.slice(changed)
			.map((character, index) =>
				character === '\t'
					? ' '.repeat(this.ends[changed + index] - this.offsets[changed + index])
					: character
			)
			.join('');
		let echo = this.moveToCell(fromRow, start) + tail;
		let row = tail ? this.lastWrittenRow(this.end) : Math.floor(start / this.columns);
		for (let offset = this.end; offset < oldEnd;) {
			const count = Math.min(oldEnd - offset, this.columns - (offset % this.columns));
			echo += this.moveToCell(row, offset) + `\x1b[${count}X`;
			row = Math.floor(offset / this.columns);
			offset += count;
		}
		return echo + this.moveTo(row, cursor);
	}
}

// VT cursor moves cannot reach scrollback. Bring the draft's first retained
// row back to the top of the viewport, preserving history and prompt cells.
// xterm exposes a read-only public buffer; its circular list updates markers
// when the draft's fully occupied continuation rows are removed.
export function revealScrolledInput(term: Terminal, marker: IMarker | undefined, column: number) {
	const buffer = term.buffer.active;
	if (!marker || marker.line >= buffer.baseY || buffer.type !== 'normal') return;
	const active = (
		term as Terminal & {
			_core?: {
				buffers?: {
					active: {
						ybase: number;
						ydisp: number;
						lines: { splice(index: number, count: number): void };
					};
				};
			};
		}
	)._core?.buffers?.active;
	if (!active) return;
	const origin = Math.max(0, marker.line);
	active.lines.splice(origin + 1, active.ybase - origin);
	active.ybase = origin;
	active.ydisp = Math.min(active.ydisp, origin);
	term.refresh(0, term.rows - 1);
	// When the marker was trimmed, the oldest retained row is entirely draft.
	return marker.isDisposed ? 0 : column;
}

// Fit preserves the cells and attributes of the program's prompt, but xterm
// clamps cursorX before it reflows lines. Map that insertion point through the
// reflow, including wrapped prompts, wide cells, and gaps left by tabs/CUF.
export function fitAtInputOrigin(term: Terminal, fit: () => void) {
	const buffer = term.buffer.active;
	const cursorRow = buffer.baseY + buffer.cursorY;
	let firstRow = cursorRow;
	while (firstRow > 0 && buffer.getLine(firstRow)?.isWrapped) firstRow--;
	const marker = term.registerMarker(firstRow - cursorRow);
	const widths: number[] = [];
	for (let row = firstRow; row <= cursorRow; row++) {
		const line = buffer.getLine(row);
		if (!line) continue;
		let columns = row === cursorRow ? buffer.cursorX : term.cols;
		if (row < cursorRow) {
			const lastCell = line.getCell(columns - 1);
			const nextCell = buffer.getLine(row + 1)?.getCell(0);
			if (
				lastCell?.getCode() === 0 &&
				lastCell.getWidth() === 1 &&
				nextCell?.getWidth() === 2
			) {
				columns--; // padding before a wide character that wrapped early
			}
		}
		for (let x = 0; x < columns; x++) {
			const width = line.getCell(x)?.getWidth();
			if (width) widths.push(width);
		}
	}
	const reflow = term.options.reflowCursorLine;
	term.options.reflowCursorLine = true;
	try {
		fit();
		let offset = 0;
		for (const width of widths) {
			if (width > term.cols - (offset % term.cols)) offset++;
			offset += width;
		}
		const column = offset % term.cols;
		if (marker.isDisposed) return buffer.cursorX;
		const row = marker.line - buffer.baseY + Math.floor(offset / term.cols);
		if (row < 0) return buffer.cursorX;
		// A prompt that ends on the new right margin may need a fresh bottom row.
		if (row >= term.rows) term.write(`\x1b[${term.rows};1H\r\n`);
		else term.write(`\x1b[${row + 1};${column + 1}H`);
		return offset > 0 && column === 0 ? term.cols : column;
	} finally {
		term.options.reflowCursorLine = reflow;
		marker.dispose();
	}
}
