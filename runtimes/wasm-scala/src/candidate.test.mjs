import assert from 'node:assert/strict';
import test from 'node:test';
import { ScalaCandidate } from './candidate.js';

const files = [{ path: 'Main.scala', content: 'object Main' }];
const tick = () => new Promise((resolve) => setImmediate(resolve));

function setup(options = {}) {
	const workers = [];
	const candidate = new ScalaCandidate({
		...options,
		workerFactory(kind) {
			const listeners = new Map();
			const worker = {
				kind,
				messages: [],
				terminated: false,
				postMessage(message) {
					this.messages.push(message);
				},
				terminate() {
					this.terminated = true;
				},
				addEventListener(type, listener) {
					if (!listeners.has(type)) listeners.set(type, new Set());
					listeners.get(type).add(listener);
				},
				removeEventListener(type, listener) {
					listeners.get(type)?.delete(listener);
				},
				reply(message) {
					const event = { data: message };
					this.onmessage?.(event);
					for (const listener of listeners.get('message') ?? []) listener(event);
				},
				fail(message) {
					const event = { message };
					this.onerror?.(event);
					for (const listener of listeners.get('error') ?? []) listener(event);
				},
				compiled(code = 'generated program', diagnostics = []) {
					this.reply({
						id: this.messages.at(-1).id,
						type: 'compiled',
						code,
						diagnostics
					});
				},
				exit(exitCode = 0) {
					this.reply({ id: this.messages.at(-1).id, type: 'exit', exitCode });
				}
			};
			workers.push(worker);
			return worker;
		}
	});
	return { candidate, workers };
}

test('compiler is retained for warm compiles and disposed explicitly', async (t) => {
	const { candidate, workers } = setup();
	t.after(() => candidate.dispose());
	const first = candidate.compile(files);
	await tick();
	assert.equal(workers[0].kind, 'compiler');
	assert.deepEqual(workers[0].messages[0].files, files);
	workers[0].compiled('first');
	const firstResult = await first;
	assert.equal(firstResult.code, 'first');
	assert.deepEqual(firstResult.diagnostics, []);
	const second = candidate.compile(files);
	await tick();
	assert.equal(workers.length, 1);
	workers[0].compiled('second');
	assert.equal((await second).code, 'second');
	assert.equal(workers[0].terminated, false);
	candidate.dispose();
	assert.equal(workers[0].terminated, true);
});

test('failed compile returns no executable artifact and never starts execution', async (t) => {
	const { candidate, workers } = setup();
	t.after(() => candidate.dispose());
	const running = candidate.run({ files });
	const rejected = assert.rejects(running, /type mismatch/i);
	await tick();
	workers[0].reply({
		id: workers[0].messages[0].id,
		type: 'error',
		message: 'type mismatch',
		diagnostics: [{ message: 'type mismatch' }]
	});
	await rejected;
	assert.equal(workers.length, 1);
	const recovery = candidate.compile(files);
	await tick();
	workers.at(-1).compiled('recovered');
	assert.equal((await recovery).code, 'recovered');
});

test('every run gets a fresh execution worker and forwards stdin, arguments, and exact output', async (t) => {
	const { candidate, workers } = setup();
	t.after(() => candidate.dispose());
	const output = [];
	for (let index = 0; index < 2; index++) {
		const running = candidate.run(
			{ files, stdin: '한글\n', args: ['one'] },
			{ onOutput: (type, data) => output.push({ type, data }) }
		);
		await tick();
		workers[0].compiled(`code ${index}`, [{ message: 'warning' }]);
		await tick();
		const worker = workers.at(-1);
		assert.equal(worker.kind, 'execution');
		const request = worker.messages[0];
		assert.equal(request.code, `code ${index}`);
		assert.equal(request.stdin, '한글\n');
		assert.deepEqual(request.args, ['one']);
		worker.reply({ id: request.id, type: 'stdout', data: ' \n\n' });
		worker.reply({ id: request.id, type: 'stderr', data: '\terror' });
		worker.exit();
		assert.deepEqual(await running, { exitCode: 0, diagnostics: [{ message: 'warning' }] });
		assert.equal(worker.terminated, true);
	}
	assert.equal(workers.filter((worker) => worker.kind === 'compiler').length, 1);
	assert.equal(workers.filter((worker) => worker.kind === 'execution').length, 2);
	assert.deepEqual(
		output.map(({ type, data }) => ({ type, data })),
		[
			{ type: 'stdout', data: ' \n\n' },
			{ type: 'stderr', data: '\terror' },
			{ type: 'stdout', data: ' \n\n' },
			{ type: 'stderr', data: '\terror' }
		]
	);
});

test('stop terminates active compiler and allows a fresh request', async (t) => {
	const { candidate, workers } = setup();
	t.after(() => candidate.dispose());
	const first = candidate.compile(files);
	const rejected = assert.rejects(first);
	await tick();
	candidate.stop();
	await rejected;
	assert.equal(workers[0].terminated, true);
	const second = candidate.compile(files);
	await tick();
	assert.equal(workers.length, 2);
	workers[1].compiled();
	await second;
});

test('stop terminates execution while keeping the compiler warm', async (t) => {
	const { candidate, workers } = setup();
	t.after(() => candidate.dispose());
	const running = candidate.run({ files });
	const rejected = assert.rejects(running);
	await tick();
	workers[0].compiled();
	await tick();
	candidate.stop();
	await rejected;
	assert.equal(workers[1].terminated, true);
	assert.equal(workers[0].terminated, false);
});

test('compiler timeout terminates stuck compiler', async (t) => {
	const { candidate, workers } = setup({ timeoutMs: 20 });
	t.after(() => candidate.dispose());
	await assert.rejects(candidate.compile(files), /timeout|timed out/i);
	assert.equal(workers[0].terminated, true);
});

test('execution timeout terminates only the execution worker', async (t) => {
	const { candidate, workers } = setup();
	t.after(() => candidate.dispose());
	const running = candidate.run({ files }, { timeoutMs: 20 });
	const rejected = assert.rejects(running, /timeout|timed out/i);
	await tick();
	workers[0].compiled();
	await rejected;
	assert.equal(workers[1].terminated, true);
	assert.equal(workers[0].terminated, false);
});

test('abort rejects old request and stale replies cannot complete the next request', async (t) => {
	const { candidate, workers } = setup();
	t.after(() => candidate.dispose());
	const controller = new AbortController();
	const first = candidate.compile(files, { signal: controller.signal });
	const rejected = assert.rejects(first);
	await tick();
	const staleWorker = workers[0];
	const staleId = staleWorker.messages[0].id;
	controller.abort();
	await rejected;
	assert.equal(staleWorker.terminated, true);
	let settled = false;
	const second = candidate.compile(files).then((result) => {
		settled = true;
		return result;
	});
	await tick();
	staleWorker.reply({ id: staleId, type: 'compiled', code: 'stale', diagnostics: [] });
	const active = workers.at(-1);
	active.reply({ id: staleId, type: 'compiled', code: 'stale', diagnostics: [] });
	await tick();
	assert.equal(settled, false);
	active.compiled('fresh');
	assert.equal((await second).code, 'fresh');
});

test('overlapping operations are rejected without replacing the active request', async (t) => {
	const { candidate, workers } = setup();
	t.after(() => candidate.dispose());
	const first = candidate.compile(files);
	await tick();
	await assert.rejects(async () => candidate.compile(files), /busy|active|overlap|progress/i);
	await assert.rejects(async () => candidate.run({ files }), /busy|active|overlap|progress/i);
	assert.equal(workers.length, 1);
	assert.equal(workers[0].messages.length, 1);
	workers[0].compiled('first');
	assert.equal((await first).code, 'first');
});

for (const action of ['stop', 'dispose']) {
	test(`${action} between compile reply and execution prevents launch`, async () => {
		const { candidate, workers } = setup({ timeoutMs: 20 });
		const running = candidate.run({ files }, { timeoutMs: 20 });
		const rejected = assert.rejects(running, /aborted|disposed/i);
		workers[0].compiled();
		candidate[action]();
		await rejected;
		assert.equal(workers.length, 1, 'No execution worker after cancellation');
		if (action === 'stop') {
			const recovery = candidate.run({ files }, { timeoutMs: 20 });
			workers[0].compiled();
			await tick();
			workers[1].exit();
			assert.equal((await recovery).exitCode, 0);
		}
		candidate.dispose();
	});
	test(`${action} after successful compile reply rejects pending compile`, async () => {
		const { candidate, workers } = setup({ timeoutMs: 20 });
		const compiling = candidate.compile(files);
		const rejected = assert.rejects(compiling, /aborted|disposed/i);
		workers[0].compiled();
		candidate[action]();
		await rejected;
		candidate.dispose();
	});
}
