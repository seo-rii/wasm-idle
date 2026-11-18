type CellWidth = (character: string) => number;

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
				const cells = width(codePoint);
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

	private moveToCell(fromRow: number, offset: number) {
		const rows = Math.floor(offset / this.columns) - fromRow;
		const vertical = rows ? `\x1b[${Math.abs(rows)}${rows < 0 ? 'A' : 'B'}` : '';
		return vertical + `\x1b[${(offset % this.columns) + 1}G`;
	}

	moveTo(fromRow: number, index: number) {
		if (index < this.characters.length) return this.moveToCell(fromRow, this.offsets[index]);
		if (this.characters.length && this.end % this.columns === 0) {
			// CHA cannot select the pending-wrap position one past the final column.
			const last = this.characters.length - 1;
			return this.moveToCell(fromRow, this.offsets[last]) + this.characters[last];
		}
		return this.moveToCell(fromRow, this.end);
	}

	redraw(fromRow: number, oldEnd: number, changed: number, cursor: number) {
		// Begin immediately after the unchanged prefix so an old wide-character
		// wrap can also be filled by a newly inserted narrow character.
		const start = changed ? this.ends[changed - 1] : this.startColumn;
		const tail = this.characters.slice(changed).join('');
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
