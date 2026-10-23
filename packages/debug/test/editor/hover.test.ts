import { afterEach, describe, expect, it, vi } from 'vitest';

import { attachMonacoDebugHover, debugHoverExpression } from '../../src/editor/hover.js';

function setup(resolve = vi.fn(async () => ({ value: '7' }))) {
	let mouseMove: (event: unknown) => void = () => {};
	let modelChange = () => {};
	const model = {
		uri: { toString: () => 'file:///main.cpp' },
		getLineContent: () => 'items[2].value + other'
	};
	const dispose = vi.fn();
	const editor = {
		getModel: () => model,
		onMouseMove: (listener: typeof mouseMove) => {
			mouseMove = listener;
			return { dispose };
		},
		onMouseLeave: () => ({ dispose }),
		onDidChangeModel: (listener: typeof modelChange) => {
			modelChange = listener;
			return { dispose };
		},
		onDidChangeModelContent: () => ({ dispose }),
		onDidScrollChange: () => ({ dispose }),
		addContentWidget: vi.fn((widget) => document.body.append(widget.getDomNode())),
		removeContentWidget: vi.fn((widget) => widget.getDomNode().remove())
	};
	const Monaco = {
		editor: {
			MouseTargetType: { CONTENT_TEXT: 6 },
			ContentWidgetPositionPreference: { BELOW: 2, ABOVE: 1 }
		}
	};
	const loadChildren = vi.fn(async (_reference: number, _start: number, _count: number) => [
		{ name: '[0]', value: '<script>unsafe</script>' }
	]);
	const onAddWatch = vi.fn();
	const hover = attachMonacoDebugHover(Monaco as never, editor as never, {
		resolve,
		loadChildren,
		onAddWatch,
		delayMs: 0
	});
	hover.setEnabled(true);
	return {
		hover,
		editor,
		loadChildren,
		onAddWatch,
		dispose,
		changeModel: () => modelChange(),
		move: (column = 3) =>
			mouseMove({ target: { type: 6, position: { lineNumber: 1, column } } })
	};
}

afterEach(() => {
	document.body.replaceChildren();
	vi.useRealTimers();
});

describe('debugHoverExpression', () => {
	it('selects a bounded variable path containing the cursor', () => {
		expect(debugHoverExpression('items[2].value + other', 11)).toBe('items[2].value');
		expect(debugHoverExpression('items[2].value + other', 18)).toBe('other');
		expect(debugHoverExpression('x + y', 3)).toBeNull();
		expect(debugHoverExpression('return value;', 10)).toBe('value');
		expect(debugHoverExpression('value ? other : last', 10)).toBe('other');
		expect(debugHoverExpression('value', -1)).toBeNull();
		expect(debugHoverExpression('x'.repeat(5000), 2500)).toBeNull();
	});

	it.each([
		['pointer->value', 11],
		['pointer -> value', 13],
		['items[index].value', 16],
		['items[index]', 3],
		['make().value', 9],
		['namespace::value', 14],
		['1value', 4],
		['items[01]', 3]
	])('does not resolve an unsupported expression fragment: %s', (line, column) => {
		expect(debugHoverExpression(line, column)).toBeNull();
	});
});

describe('debug hover lifecycle', () => {
	it('keeps keyboard controls available after the pointer leaves', async () => {
		vi.useFakeTimers();
		const fixture = setup();
		fixture.move();
		await vi.runAllTimersAsync();
		const root = document.querySelector('.wasm-idle-debug-hover') as HTMLDivElement;
		const addWatch = root.querySelector('button') as HTMLButtonElement;
		addWatch.focus();
		root.dispatchEvent(new MouseEvent('mouseleave'));
		fixture.move(18);
		await vi.advanceTimersByTimeAsync(250);
		expect(document.activeElement).toBe(addWatch);
		expect(root.isConnected).toBe(true);
		addWatch.click();
		expect(fixture.onAddWatch).toHaveBeenCalledWith('items[2].value');
		addWatch.blur();
		await vi.advanceTimersByTimeAsync(250);
		expect(root.isConnected).toBe(false);
		fixture.hover.dispose();
	});
	it('loads children only on expansion and renders untrusted values as text', async () => {
		vi.useFakeTimers();
		const resolve = vi.fn(async () => ({
			value: 'size=1',
			variable: { name: 'items', value: 'size=1', variablesReference: 4, indexedVariables: 1 }
		}));
		const fixture = setup(resolve);
		fixture.move();
		await vi.runAllTimersAsync();
		expect(resolve).toHaveBeenCalledWith('items[2].value');
		expect(fixture.loadChildren).not.toHaveBeenCalled();
		(document.querySelector('[aria-label="Expand items"]') as HTMLButtonElement).click();
		await Promise.resolve();
		expect(fixture.loadChildren).toHaveBeenCalledWith(4, 0, 50);
		expect(document.body.textContent).toContain('<script>unsafe</script>');
		expect(document.querySelector('script')).toBeNull();
		(document.querySelector('button') as HTMLButtonElement).click();
		expect(fixture.onAddWatch).toHaveBeenCalledWith('items[2].value');
		fixture.hover.dispose();
		expect(fixture.dispose).toHaveBeenCalledTimes(5);
		expect(document.body.textContent).toBe('');
	});

	it('discards a delayed result after resume, model change, or disposal', async () => {
		vi.useFakeTimers();
		let finish!: (value: { value: string }) => void;
		const fixture = setup(
			vi.fn(
				() =>
					new Promise((resolve) => {
						finish = resolve;
					})
			)
		);
		fixture.move();
		await vi.runAllTimersAsync();
		fixture.hover.setEnabled(false);
		finish({ value: 'obsolete' });
		await Promise.resolve();
		expect(fixture.editor.addContentWidget).not.toHaveBeenCalled();
		fixture.hover.setEnabled(true);
		fixture.move();
		await vi.runAllTimersAsync();
		fixture.changeModel();
		finish({ value: 'old model' });
		await Promise.resolve();
		expect(fixture.editor.addContentWidget).not.toHaveBeenCalled();
		fixture.hover.dispose();
	});
});
