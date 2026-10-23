const channel = 'wasm-idle-cdp-v1';
const enabled = new Map();
const sessions = new Map();
const connections = new Map();
const allowedCommands = new Set([
	'Debugger.enable',
	'Debugger.disable',
	'Debugger.setBreakpoint',
	'Debugger.setBreakpointByUrl',
	'Debugger.removeBreakpoint',
	'Debugger.getPossibleBreakpoints',
	'Debugger.getScriptSource',
	'Debugger.pause',
	'Debugger.resume',
	'Debugger.stepInto',
	'Debugger.stepOver',
	'Debugger.stepOut',
	'Debugger.evaluateOnCallFrame',
	'Debugger.setPauseOnExceptions',
	'Debugger.setBlackboxPatterns',
	'Runtime.getProperties',
	'Runtime.releaseObject',
	'Runtime.releaseObjectGroup'
]);

function emit(tabId, message, frameId = 0) {
	void chrome.tabs
		.sendMessage(tabId, { channel, direction: 'event', ...message }, { frameId })
		.catch(() => undefined);
}

function forgetTab(tabId, reason) {
	enabled.delete(tabId);
	for (const [key, target] of sessions) if (target.tabId === tabId) sessions.delete(key);
	for (const [id, target] of connections) {
		if (target.tabId !== tabId) continue;
		emit(
			tabId,
			{ connection: id, method: 'Inspector.detached', params: { reason } },
			target.frameId
		);
		connections.delete(id);
	}
	void chrome.action.setBadgeText({ tabId, text: '' }).catch(() => undefined);
}

export async function toggleDebugger(tab) {
	if (tab.id === undefined || !tab.url || !/^https?:/.test(tab.url)) return;
	try {
		if (enabled.has(tab.id)) {
			await chrome.debugger.detach({ tabId: tab.id });
			forgetTab(tab.id, 'Debugger disabled');
			return;
		}
		await chrome.debugger.attach({ tabId: tab.id }, '1.3');
		enabled.set(tab.id, new URL(tab.url).origin);
		await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
		await chrome.debugger.sendCommand({ tabId: tab.id }, 'Target.setAutoAttach', {
			autoAttach: true,
			waitForDebuggerOnStart: false,
			flatten: true,
			filter: [{ type: 'worker', exclude: false }]
		});
		await chrome.action.setBadgeText({ tabId: tab.id, text: 'ON' });
	} catch (error) {
		if (enabled.has(tab.id))
			await chrome.debugger.detach({ tabId: tab.id }).catch(() => undefined);
		forgetTab(tab.id, error?.message || String(error));
		await chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
	}
}
chrome.action.onClicked.addListener(toggleDebugger);

chrome.debugger.onEvent.addListener((source, method, params) => {
	if (method === 'Target.attachedToTarget' && params?.targetInfo?.type === 'worker') {
		sessions.set(`${source.tabId}:${params.sessionId}`, {
			tabId: source.tabId,
			sessionId: params.sessionId
		});
		// The playground's container owner creates execution Workers of its own.
		// Auto-attachment is scoped to one target, so opt in at each Worker level.
		void chrome.debugger
			.sendCommand(
				{ tabId: source.tabId, sessionId: params.sessionId },
				'Target.setAutoAttach',
				{
					autoAttach: true,
					waitForDebuggerOnStart: false,
					flatten: true,
					filter: [{ type: 'worker', exclude: false }]
				}
			)
			.catch(() => undefined);
	}
	if (method === 'Target.detachedFromTarget') {
		sessions.delete(`${source.tabId}:${params.sessionId}`);
		for (const [id, target] of connections) {
			if (target.tabId !== source.tabId || target.sessionId !== params.sessionId) continue;
			emit(
				target.tabId,
				{
					connection: id,
					method: 'Inspector.detached',
					params: { reason: 'Worker closed' }
				},
				target.frameId
			);
			connections.delete(id);
		}
	}
	for (const [id, target] of connections) {
		if (target.tabId === source.tabId && target.sessionId === source.sessionId) {
			emit(target.tabId, { connection: id, method, params }, target.frameId);
		}
	}
});
chrome.debugger.onDetach.addListener((source, reason) => forgetTab(source.tabId, reason));
chrome.tabs.onRemoved.addListener((tabId) => forgetTab(tabId, 'Tab closed'));

async function handle(message, sender) {
	const tabId = sender.tab?.id;
	if (tabId === undefined || sender.frameId !== 0 || enabled.get(tabId) !== sender.origin)
		throw new Error('Click the wasm-idle debugger extension on this tab first.');
	if (message.op === 'ping') return { version: 1 };
	if (message.op === 'connect') {
		if (
			typeof message.workerName !== 'string' ||
			!/^wasm-idle-cdp:[a-zA-Z0-9-]{1,80}$/.test(message.workerName)
		) {
			throw new Error('Invalid wasm-idle Worker name');
		}
		const deadline = Date.now() + 5000;
		do {
			for (const target of sessions.values()) {
				if (target.tabId !== tabId) continue;
				let result;
				try {
					result = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
						expression: 'globalThis.name',
						returnByValue: true,
						silent: true
					});
				} catch {
					continue;
				}
				if (result?.result?.value !== message.workerName) continue;
				if (
					[...connections.values()].some(
						(item) => item.tabId === tabId && item.sessionId === target.sessionId
					)
				) {
					throw new Error('This Worker already has a debugger connection');
				}
				const id = crypto.randomUUID();
				connections.set(id, { ...target, frameId: sender.frameId });
				return { connection: id };
			}
			await new Promise((resolve) => setTimeout(resolve, 50));
		} while (Date.now() < deadline && enabled.has(tabId));
		throw new Error(
			'The wasm-idle execution Worker was not found. Re-enable the extension and retry.'
		);
	}
	const target = connections.get(message.connection);
	if (!target || target.tabId !== tabId || target.frameId !== sender.frameId) {
		throw new Error('Debugger connection is closed');
	}
	if (message.op === 'disconnect') {
		connections.delete(message.connection);
		await chrome.debugger
			.sendCommand({ tabId, sessionId: target.sessionId }, 'Debugger.disable')
			.catch(() => undefined);
		return {};
	}
	if (message.op !== 'command' || !allowedCommands.has(message.method)) {
		throw new Error('Unsupported debugger command');
	}
	return await chrome.debugger.sendCommand(
		{ tabId, sessionId: target.sessionId },
		message.method,
		message.params || {}
	);
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
	if (message?.channel !== channel || message.direction !== 'request') return;
	handle(message, sender).then(
		(result) => respond({ result }),
		(error) => respond({ error: error?.message || String(error) })
	);
	return true;
});
