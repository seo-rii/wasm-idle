type Message = { jsonrpc?: unknown; id?: string | number; method?: string; params?: any };
const features = new Set([
	'textDocument/completion',
	'completionItem/resolve',
	'textDocument/hover',
	'textDocument/signatureHelp',
	'textDocument/definition',
	'textDocument/documentSymbol'
]);

/** Yield between synchronous Jedi calls. Obsolete queued work never enters Python. */
export function createPythonRequestQueue(
	deliver: (message: Message) => void,
	emit: (message: unknown) => void
) {
	const queue: Message[] = [];
	let timer: ReturnType<typeof setTimeout> | undefined;
	let disposed = false;
	const cancel = (message: Message) => {
		// Monaco's pinned native providers surface RPC cancellation errors. Settle
		// obsolete features with their empty value, as the clangd transport does.
		if (message.id !== undefined)
			emit({
				jsonrpc: '2.0',
				id: message.id,
				result: message.method?.endsWith('/resolve') ? message.params : null
			});
	};
	const remove = (predicate: (message: Message) => boolean) => {
		for (let index = queue.length - 1; index >= 0; index--) {
			if (predicate(queue[index]!)) cancel(queue.splice(index, 1)[0]!);
		}
	};
	function schedule() {
		if (timer !== undefined || disposed || !queue.length) return;
		timer = setTimeout(() => {
			timer = undefined;
			const message = queue.shift();
			try {
				if (message) deliver(message);
			} finally {
				schedule();
			}
		}, 0);
	}
	return {
		push(message: Message) {
			if (disposed) {
				cancel(message);
				return;
			}
			if (message.method === '$/cancelRequest') {
				if (message.params?.id !== undefined)
					remove((pending) => pending.id === message.params.id);
				return;
			}
			const method = message.method ?? '';
			const uri = message.params?.textDocument?.uri;
			if (
				[
					'textDocument/didOpen',
					'textDocument/didChange',
					'textDocument/didClose',
					'workspace/didChangeWatchedFiles'
				].includes(method)
			) {
				// Any document can be an imported dependency, so retire all old analysis.
				remove((pending) => features.has(pending.method ?? ''));
			}
			if (
				method === 'textDocument/didChange' &&
				message.params?.contentChanges?.length === 1 &&
				!message.params.contentChanges[0].range
			) {
				// Only adjacent full snapshots commute. Never cross open/save/close or a request.
				const previous = queue.at(-1);
				if (
					previous?.method === method &&
					previous.params?.textDocument?.uri === uri &&
					previous.params?.contentChanges?.length === 1 &&
					!previous.params.contentChanges[0].range
				)
					queue.pop();
			}
			if (features.has(method))
				remove(
					(pending) =>
						pending.method === method &&
						pending.params?.textDocument?.uri === uri &&
						method !== 'completionItem/resolve'
				);
			queue.push(message);
			schedule();
		},
		dispose() {
			disposed = true;
			if (timer !== undefined) clearTimeout(timer);
			timer = undefined;
			for (const message of queue.splice(0)) cancel(message);
		}
	};
}
