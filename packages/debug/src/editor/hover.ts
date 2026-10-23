import type { DebugVariable } from '@wasm-idle/core';
import type monaco from 'monaco-editor';

export interface DebugHoverValue {
	value: string;
	type?: string;
	variable?: DebugVariable;
}

export interface MonacoDebugHoverOptions {
	resolve(expression: string): Promise<DebugHoverValue | null>;
	loadChildren?: (reference: number, start: number, count: number) => Promise<DebugVariable[]>;
	onAddWatch?: (expression: string) => void;
	delayMs?: number;
	labels?: {
		addWatch?: string;
		expand?: string;
		collapse?: string;
		loadMore?: string;
		readError?: string;
	};
}

const PAGE_SIZE = 50;
const MAX_DEPTH = 8;
const MAX_ROWS = 500;

/** A variable path only; expression evaluation remains owned by the debug controller. */
export function debugHoverExpression(line: string, column: number): string | null {
	if (!Number.isSafeInteger(column) || column < 1 || column > line.length + 1) return null;
	const cursor = column - 1;
	const start = Math.max(0, cursor - 4096);
	const text = line.slice(start, cursor + 4096);
	const paths =
		/[A-Za-z_][A-Za-z0-9_]*(?:(?:\.[A-Za-z_][A-Za-z0-9_]*)|(?:\[(?:0|[1-9][0-9]*)\]))*/gu;
	for (const match of text.matchAll(paths)) {
		const begin = start + match.index;
		if (begin <= cursor && cursor < begin + match[0].length) {
			const before = line.slice(0, begin);
			const after = line.slice(begin + match[0].length);
			// A suffix of an unsupported expression can name a different local.
			// For example, the member in pointer->value is not the local value.
			if (
				/[A-Za-z0-9_]$/u.test(before) ||
				/[\].:]$/u.test(before.trimEnd()) ||
				before.trimEnd().endsWith('->') ||
				/^[A-Za-z0-9_]/u.test(after) ||
				/^(?:[\[.(]|::|->)/u.test(after.trimStart())
			) {
				return null;
			}
			return match[0].length <= 4096 ? match[0] : null;
		}
	}
	return null;
}

/** Optional, lazy debugger hover. All target values are rendered as text, never HTML. */
export function attachMonacoDebugHover(
	Monaco: typeof monaco,
	editor: monaco.editor.IStandaloneCodeEditor,
	options: MonacoDebugHoverOptions
) {
	let enabled = false;
	let disposed = false;
	let version = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let hideTimer: ReturnType<typeof setTimeout> | undefined;
	let widget: monaco.editor.IContentWidget | undefined;
	let node: HTMLDivElement | undefined;
	let pointerInside = false;
	let pendingKey = '';
	const delay = Math.min(2000, Math.max(0, options.delayMs ?? 250));
	const disposables: monaco.IDisposable[] = [];
	const labels = {
		addWatch: 'Add Watch',
		expand: 'Expand',
		collapse: 'Collapse',
		loadMore: 'Load more',
		readError: 'Unable to read children',
		...options.labels
	};

	function clear() {
		version += 1;
		clearTimeout(timer);
		clearTimeout(hideTimer);
		timer = undefined;
		hideTimer = undefined;
		pendingKey = '';
		if (widget) editor.removeContentWidget(widget);
		widget = undefined;
		node = undefined;
		pointerInside = false;
	}

	function hideSoon() {
		clearTimeout(hideTimer);
		hideTimer = setTimeout(() => {
			if (!pointerInside && !node?.contains(document.activeElement)) clear();
		}, 200);
	}

	function show(
		expression: string,
		value: DebugHoverValue,
		position: monaco.IPosition,
		requestVersion: number
	) {
		const root = document.createElement('div');
		root.className = 'wasm-idle-debug-hover';
		root.setAttribute('role', 'group');
		root.setAttribute('aria-label', `Debug value for ${expression}`);
		Object.assign(root.style, {
			maxWidth: 'min(560px, 80vw)',
			maxHeight: '320px',
			overflow: 'auto',
			padding: '8px',
			border: '1px solid var(--vscode-editorHoverWidget-border, #777)',
			background: 'var(--vscode-editorHoverWidget-background, #202124)',
			color: 'var(--vscode-editorHoverWidget-foreground, #eee)',
			fontSize: '12px'
		});
		root.addEventListener('mouseenter', () => {
			pointerInside = true;
			clearTimeout(hideTimer);
		});
		root.addEventListener('mouseleave', () => {
			pointerInside = false;
			hideSoon();
		});
		root.addEventListener('focusin', () => clearTimeout(hideTimer));
		root.addEventListener('focusout', hideSoon);
		const title = document.createElement('code');
		title.textContent = `${expression}${value.type ? `: ${value.type}` : ''} = ${value.value}`;
		root.append(title);
		if (options.onAddWatch) {
			const add = document.createElement('button');
			add.type = 'button';
			add.textContent = labels.addWatch;
			add.addEventListener('click', () => {
				if (enabled && version === requestVersion) options.onAddWatch?.(expression);
			});
			root.append(add);
		}
		let rows = 0;
		function renderVariable(variable: DebugVariable, parent: HTMLElement, depth: number) {
			if (++rows > MAX_ROWS) return;
			const row = document.createElement('div');
			const label = document.createElement('code');
			label.textContent = `${variable.name} = ${variable.value}`;
			row.append(label);
			parent.append(row);
			const reference = variable.variablesReference ?? 0;
			if (!reference || !options.loadChildren || depth >= MAX_DEPTH) return;
			const expand = document.createElement('button');
			expand.type = 'button';
			expand.textContent = labels.expand;
			expand.setAttribute('aria-label', `${labels.expand} ${variable.name}`);
			expand.setAttribute('aria-expanded', 'false');
			const children = document.createElement('div');
			children.style.paddingLeft = '12px';
			children.hidden = true;
			row.append(expand, children);
			let loaded = 0;
			let opened = false;
			let loading = false;
			const total = (variable.namedVariables ?? 0) + (variable.indexedVariables ?? 0);
			const more = document.createElement('button');
			more.type = 'button';
			more.textContent = labels.loadMore;
			more.setAttribute('aria-label', `Load more children for ${variable.name}`);
			async function load() {
				if (loading || !enabled || version !== requestVersion || rows >= MAX_ROWS) return;
				loading = true;
				expand.disabled = true;
				more.disabled = true;
				try {
					const page = await options.loadChildren!(
						reference,
						loaded,
						Math.min(PAGE_SIZE, MAX_ROWS - rows)
					);
					if (!enabled || version !== requestVersion) return;
					more.remove();
					for (const child of page.slice(0, MAX_ROWS - rows))
						renderVariable(child, children, depth + 1);
					loaded += page.length;
					if (rows < MAX_ROWS && (total ? loaded < total : page.length === PAGE_SIZE))
						children.append(more);
				} catch {
					if (version === requestVersion) {
						const error = document.createElement('span');
						error.textContent = labels.readError;
						children.append(error);
					}
				} finally {
					loading = false;
					expand.disabled = false;
					more.disabled = false;
				}
			}
			expand.addEventListener('click', () => {
				opened = !opened;
				children.hidden = !opened;
				expand.textContent = opened ? labels.collapse : labels.expand;
				expand.setAttribute('aria-expanded', String(opened));
				if (opened && !loaded) void load();
			});
			more.addEventListener('click', () => void load());
		}
		if (value.variable) renderVariable(value.variable, root, 0);
		node = root;
		widget = {
			getId: () => 'wasm-idle-debug-hover',
			getDomNode: () => root,
			getPosition: () => ({
				position,
				preference: [
					Monaco.editor.ContentWidgetPositionPreference.BELOW,
					Monaco.editor.ContentWidgetPositionPreference.ABOVE
				]
			})
		};
		editor.addContentWidget(widget);
	}

	disposables.push(
		editor.onMouseMove((event) => {
			if (!enabled || disposed) return;
			if (event.target.element && node?.contains(event.target.element)) {
				clearTimeout(hideTimer);
				return;
			}
			if (node?.contains(document.activeElement)) return;
			const position = event.target.position;
			const model = editor.getModel();
			if (
				!position ||
				!model ||
				event.target.type !== Monaco.editor.MouseTargetType.CONTENT_TEXT
			) {
				hideSoon();
				return;
			}
			const expression = debugHoverExpression(
				model.getLineContent(position.lineNumber),
				position.column
			);
			if (!expression) {
				hideSoon();
				return;
			}
			const key = `${model.uri.toString()}:${position.lineNumber}:${expression}`;
			if (pendingKey === key) {
				clearTimeout(hideTimer);
				return;
			}
			clear();
			pendingKey = key;
			const requestVersion = version;
			timer = setTimeout(() => {
				void options
					.resolve(expression)
					.then((value) => {
						if (
							value &&
							enabled &&
							!disposed &&
							version === requestVersion &&
							editor.getModel() === model
						) {
							show(expression, value, position, requestVersion);
						}
					})
					.catch(() => {});
			}, delay);
		})
	);
	disposables.push(editor.onMouseLeave(hideSoon));
	disposables.push(editor.onDidChangeModel(clear));
	disposables.push(editor.onDidChangeModelContent(clear));
	disposables.push(editor.onDidScrollChange(clear));
	return {
		clear,
		setEnabled(value: boolean) {
			clear();
			enabled = value && !disposed;
		},
		dispose() {
			disposed = true;
			enabled = false;
			clear();
			for (const disposable of disposables) disposable.dispose();
		}
	};
}
