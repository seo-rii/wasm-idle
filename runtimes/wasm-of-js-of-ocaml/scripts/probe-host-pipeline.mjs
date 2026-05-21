import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(scriptPath);
const projectRoot = path.resolve(scriptsDir, '..');

const [{ compile }, { createNodeSystemDispatcher }] = await Promise.all([
	import(pathToFileURL(path.join(projectRoot, 'dist', 'src', 'index.js')).href),
	import(pathToFileURL(path.join(projectRoot, 'dist', 'runtime', 'system-dispatch-node.js')).href)
]);

const opamRoot =
	process.env.OPAMROOT || path.join(process.env.HOME || '', '.cache', 'wasm-of-js-of-ocaml', 'opam');
const switchName = process.env.WASM_OF_JS_OF_OCAML_SWITCH || 'wasm-of-js-of-ocaml';
const binaryenBinDir =
	process.env.WASM_OF_JS_OF_OCAML_BINARYEN_BIN_DIR ||
	path.join(projectRoot, '.cache', 'npm', 'node_modules', '.bin');

const result = await compile(
	{
		files: {
			'hello.ml': 'let () = print_endline "hello from compile()"\n'
		},
		entry: 'hello.ml',
		target: 'wasm',
		effectsMode: 'cps'
	},
	{
		system: createNodeSystemDispatcher({
			env: {
				PATH: `${path.join(opamRoot, switchName, 'bin')}:${binaryenBinDir}:${process.env.PATH || ''}`
			}
		})
	}
);

process.stdout.write(
	JSON.stringify(
		{
			success: result.success,
			stderr: result.stderr,
			artifacts: result.artifacts.map((artifact) => ({
				path: artifact.path,
				kind: artifact.kind
			}))
		},
		null,
		2
	) + '\n'
);
