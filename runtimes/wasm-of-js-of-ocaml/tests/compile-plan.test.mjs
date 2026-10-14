import assert from 'node:assert/strict';
import test from 'node:test';

import { createCompileHandler } from '../src/compiler-worker.ts';

async function compileSourceArgs(request) {
	const invocations = [];
	const handleCompile = createCompileHandler({
		system: async (argv) => {
			invocations.push(argv);
			return { exitCode: 0, stdout: '', stderr: '' };
		}
	});
	const result = await handleCompile({ target: 'js', ...request });
	assert.equal(result.success, true, result.stderr);
	const ocamlcArgv = invocations[0];
	return ocamlcArgv.slice(ocamlcArgv.indexOf('-o') + 2);
}

test('ocamlc receives interfaces before implementations and the entry module last', async () => {
	const files = {
		'main.ml': 'let () = print_endline (Util.greet (Alpha.name ()))\n',
		'util.ml': 'let greet name = "hello " ^ name\n',
		'alpha.ml': 'let name () = "alpha"\n',
		'alpha.mli': 'val name : unit -> string\n',
		'README.md': '# notes\n',
		'input.txt': '42\n'
	};
	const expected = [
		'/workspace/alpha.mli',
		'/workspace/alpha.ml',
		'/workspace/util.ml',
		'/workspace/main.ml'
	];

	assert.deepEqual(await compileSourceArgs({ files, entry: 'main.ml' }), expected);
	assert.deepEqual(
		await compileSourceArgs({ files, entry: 'main.ml', packages: ['str'] }),
		expected
	);
});

test('the entry interface precedes the entry implementation at the end', async () => {
	assert.deepEqual(
		await compileSourceArgs({
			files: {
				'main.mli': '',
				'main.ml': 'let () = Zeta.run ()\n',
				'zeta.ml': 'let run () = ()\n'
			},
			entry: 'main.ml'
		}),
		['/workspace/zeta.ml', '/workspace/main.mli', '/workspace/main.ml']
	);
});

test('a non-OCaml entry is still passed to ocamlc so it reports the input', async () => {
	assert.deepEqual(
		await compileSourceArgs({
			files: {
				'main.txt': 'not ocaml\n',
				'util.ml': 'let x = 1\n'
			},
			entry: 'main.txt'
		}),
		['/workspace/util.ml', '/workspace/main.txt']
	);
});
