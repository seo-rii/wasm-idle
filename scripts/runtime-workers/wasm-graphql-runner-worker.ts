import { executeGraphql } from './graphql-execution';

self.addEventListener('message', (event) => {
	const message = event.data;
	if (message?.run !== true) return;
	const outcome = executeGraphql(message, () => {
		self.postMessage({ type: 'execution-ready' });
	});
	for (const diagnostic of outcome.diagnostics) self.postMessage({ diagnostic });
	self.postMessage({ output: `${JSON.stringify(outcome.result)}\n` });
	self.postMessage({ results: outcome.ok });
});
