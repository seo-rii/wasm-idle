import type { editor } from 'monaco-editor';

const lineBreak = /\r\n|\r|\n/gu;
type Layout = readonly string[];

/** Monaco has one EOL per model. Store only line separators so other bytes retain native undo. */
export function createOriginalLineEndings(text: string, modelEol: string, version: number) {
	const initial = text.match(lineBreak) ?? [];
	if (!initial.some((separator) => separator !== modelEol)) return undefined;
	let layout: Layout = initial;
	const versions = new Map<number, Layout>([[version, layout]]);
	return {
		text,
		change(model: editor.ITextModel, change: editor.IModelContentChangedEvent) {
			const version = model.getAlternativeVersionId();
			const restored = (change.isUndoing || change.isRedoing) && versions.get(version);
			if (restored) {
				layout = restored;
			} else if (change.isEolChange || change.isFlush) {
				layout = Array<string>(model.getLineCount() - 1).fill(model.getEOL());
			} else {
				// Monaco reports edits from the bottom of the old document towards its start.
				for (const { range, text } of change.changes) {
					const removed = range.endLineNumber - range.startLineNumber;
					const inserted = text.match(lineBreak) ?? [];
					if (!removed && !inserted.length) continue;
					const start = range.startLineNumber - 1;
					layout = [
						...layout.slice(0, start),
						...inserted,
						...layout.slice(start + removed)
					];
				}
			}
			versions.set(version, layout);
			let index = 0;
			this.text = model
				.getValue(undefined, true)
				.replace(lineBreak, () => layout[index++] ?? model.getEOL());
			return this.text;
		}
	};
}
