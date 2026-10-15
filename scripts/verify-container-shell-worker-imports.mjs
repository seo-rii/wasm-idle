// Pinned Rust source-shape guard only; this does not typecheck or execute Wasm.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const compact = (source) => source.replace(/\/\/[^\n]*/g, '').replace(/\s+/g, '');
const functionSource = (source, name) => {
	const match = source.match(
		new RegExp(`^(?:pub(?:\\([^\\n]*\\))? )?fn ${name}\\([\\s\\S]*?^\\}`, 'm')
	);
	assert(match, `Missing pinned Rust function: ${name}`);
	return compact(match[0]);
};

export function verifyShellWorkerImportSources({ lib, env, syscall }) {
	const single = functionSource(lib, 'generate_import_object_from_env');
	const worker = functionSource(lib, 'import_object_for_all_wasi_versions');
	const factory = (context) =>
		`let shell=namespace!{"exec_v1"=>wasmer::Function::new_typed_with_env(&mut*store,${context},syscalls::proc_exec_v1),};imports.extend(&imports!{"wasm_idle_shell_v1"=>shell});`;
	assert(
		single.includes(`ifmatches!(version,WasiVersion::Wasix32v1){${compact(factory('ctx'))}}`),
		'Version-specific resolver must retain the wasm32 private exec_v1 binding'
	);
	assert(
		worker.includes(
			`ifmodule.imports().functions().any(|import|import.module()=="wasix_32v1"){${compact(factory('env'))}}`
		),
		'SDK Worker resolver must register the same exec_v1 binding under the wasm32 import gate'
	);
	assert.equal(
		(worker.match(/"wasm_idle_shell_v1"/g) ?? []).length,
		1,
		'Worker resolver must not register an additional ungated private namespace'
	);
	assert(
		compact(env).includes(
			'import_object_for_all_wasi_versions(&module,&mutstore,&func_env.env);'
		),
		'WasiEnv instantiation must use the guarded Worker resolver'
	);
	const entry = functionSource(syscall, 'proc_exec_v1');
	assert(
		entry.startsWith(
			"pubfnproc_exec_v1(mutctx:FunctionEnvMut<'_,WasiEnv>,name:WasmPtr<u8,Memory32>,name_len:u32,args:WasmPtr<u8,Memory32>,args_len:u32,envs:WasmPtr<u8,Memory32>,envs_len:u32,flags:u32,)->Result<Errno,WasiError>{"
		),
		'Private exec_v1 must retain three wasm32 pointers, four u32 values and the errno result'
	);
	return {
		status: 'source-shape-checked-not-typechecked',
		namespace: 'wasm_idle_shell_v1',
		function: 'exec_v1',
		parameters: ['i32', 'i32', 'i32', 'i32', 'i32', 'i32', 'i32'],
		result: 'i32',
		workerGate: 'actual wasix_32v1 function import',
		guestQualified: false
	};
}

export async function verifyShellWorkerImports(source) {
	assert(isAbsolute(source), 'Absolute prepared WASIX source directory required');
	const files = {
		lib: 'src/lib.rs',
		env: 'src/state/env.rs',
		syscall: 'src/syscalls/wasix/proc_exec_v1.rs'
	};
	const sources = {};
	const identities = {};
	for (const [key, relative] of Object.entries(files)) {
		const bytes = await readFile(join(source, relative));
		sources[key] = bytes.toString('utf8');
		identities[relative] = {
			bytes: bytes.length,
			sha256: createHash('sha256').update(bytes).digest('hex')
		};
	}
	return { ...verifyShellWorkerImportSources(sources), sources: identities };
}

if (
	process.argv[1] &&
	(await realpath(process.argv[1]).catch(() => null)) ===
		(await realpath(fileURLToPath(import.meta.url)))
) {
	try {
		assert.equal(
			process.argv.length,
			3,
			'usage: verify-container-shell-worker-imports.mjs /absolute/prepared/wasmer-wasix'
		);
		console.log(JSON.stringify(await verifyShellWorkerImports(process.argv[2]), null, 2));
	} catch (error) {
		console.error(String(error));
		process.exitCode = 1;
	}
}
