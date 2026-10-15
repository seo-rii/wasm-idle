// Small source-shape mutations test the guard, not Wasmer or a guest runtime.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { verifyShellWorkerImportSources } from './verify-container-shell-worker-imports.mjs';

const factory = (context) => `
        let shell = namespace! {
            "exec_v1" => wasmer::Function::new_typed_with_env(
                &mut *store, ${context}, syscalls::proc_exec_v1),
        };
        imports.extend(&imports! { "wasm_idle_shell_v1" => shell });`;
const lib = `pub fn generate_import_object_from_env() {
    if matches!(version, WasiVersion::Wasix32v1) { ${factory('ctx')} }
}
fn import_object_for_all_wasi_versions() {
    if module.imports().functions().any(|import| import.module() == "wasix_32v1") {
        ${factory('env')}
    }
}
`;
const sources = {
	lib,
	env: 'let imports = import_object_for_all_wasi_versions(&module, &mut store, &func_env.env);',
	syscall: await readFile(
		new URL('../runtimes/wasm-bash/bridge/proc_exec_v1.rs', import.meta.url),
		'utf8'
	)
};

test('both gated factories and the existing seven-i32 ABI are required without guest qualification', () => {
	const result = verifyShellWorkerImportSources(sources);
	assert.equal(result.guestQualified, false);
	assert.deepEqual(result.parameters, Array(7).fill('i32'));
});

test('the known missing actual Worker resolver fails even when the version-specific resolver is correct', () => {
	assert.throws(
		() =>
			verifyShellWorkerImportSources({
				...sources,
				lib: lib.replace(factory('env'), '')
			}),
		/SDK Worker resolver/
	);
});

test('wasm64, unconditional registration and the wrong runtime context fail the Worker guard', () => {
	for (const changed of [
		lib.replace('import.module() == "wasix_32v1"', 'import.module() == "wasix_64v1"'),
		lib.replace(
			'if module.imports().functions().any(|import| import.module() == "wasix_32v1")',
			'if true'
		),
		lib.replace(factory('env'), factory('ctx'))
	])
		assert.throws(
			() => verifyShellWorkerImportSources({ ...sources, lib: changed }),
			/SDK Worker resolver/
		);
});

test('the executed resolver and private pointer width cannot silently drift', () => {
	assert.throws(
		() => verifyShellWorkerImportSources({ ...sources, env: '' }),
		/WasiEnv instantiation/
	);
	assert.throws(
		() =>
			verifyShellWorkerImportSources({
				...sources,
				syscall: sources.syscall.replace('Memory32', 'Memory64')
			}),
		/Private exec_v1/
	);
});
