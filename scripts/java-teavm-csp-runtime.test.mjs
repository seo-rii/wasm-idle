import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createJavacsCspRuntime } from './teavm/javacs-csp-runtime.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UPSTREAM = path.join(ROOT, 'producers/javacs-teavm/build/dist/javacs-runtime.mjs');

test('unknown TeaVM runtimes require a reviewed bridge update', () => {
	assert.throws(
		() => createJavacsCspRuntime('export const load = () => {};'),
		/Unrecognized TeaVM/
	);
});

test(
	'CSP bridge matches the actual TeaVM runtime without string code generation',
	{
		skip: !existsSync(UPSTREAM)
	},
	async () => {
		const source = readFileSync(UPSTREAM, 'utf8');
		const original = await import(
			`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
		);
		const registered = { params: ['value'], body: 'return value;' };
		const transformed = createJavacsCspRuntime(source, [registered]);
		const context = vm.createContext(
			{
				console,
				WebAssembly,
				FinalizationRegistry,
				WeakRef,
				TextDecoder,
				TextEncoder,
				setTimeout,
				clearTimeout
			},
			{ codeGeneration: { strings: false, wasm: true } }
		);
		const script = transformed.replace(
			/export\{x as defaults,t as load,e as wrapImport\};\s*$/u,
			'globalThis.__javacsDefaults=x;'
		);
		assert.notEqual(script, transformed);
		vm.runInContext(script, context);
		function exercise(defaults) {
			const imports = {};
			defaults(imports, {}, false);
			const api = imports.teavmJso;
			const results = [];
			const identity = api.createFunction1(registered.params[0], registered.body);
			results.push(identity('original static JSBody'));
			for (let count = 0; count < 32; count++) {
				for (const supplied of [Math.max(count - 1, 0), count, count + 1]) {
					const args = Array.from({ length: supplied }, (_, i) => i);
					results.push(
						api[`callFunction${count}`]((...values) => [values.length, values], ...args)
					);
					results.push(
						api[`callMethod${count}`](
							{
								tag: 'method',
								run(...values) {
									return [this.tag, values.length, values];
								}
							},
							'run',
							...args
						)
					);
					results.push(api[`arrayOf${count}`](...args));
				}
			}
			const fn = function (a, b) {
				return [a, b];
			};
			results.push(api.defineFunction(fn, false)(1, 2, 3));
			results.push(api.defineFunction(fn, true)(1, 2, 3));
			const cls = function () {};
			api.defineMethod(
				cls,
				'run',
				function (self, a, b) {
					return [self.value, a, b];
				},
				true
			);
			const object = new cls();
			object.value = 42;
			results.push(object.run(1, 2, 3));
			results.push(api.construct1(Uint8Array, 4).length);
			results.push(api.createClass('JavacsSession', null, null).name);
			return JSON.parse(JSON.stringify(results));
		}
		assert.deepEqual(exercise(context.__javacsDefaults), exercise(original.defaults));
	}
);
