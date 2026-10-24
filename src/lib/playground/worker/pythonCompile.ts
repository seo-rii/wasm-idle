import type { PyodideInterface } from 'pyodide';
import { OutputLimitError } from '@wasm-idle/core';
import type { PythonCompileResult } from '../pythonCompileOptions';

const PYTHON_COMPILE = String.raw`
def compile_bytecode(source, filename, optimization, byte_limit):
    import importlib.util
    import io
    import os
    import platform
    import py_compile
    import sys
    import tempfile
    import tokenize

    # The editor provides Unicode text. Honor its coding cookie when producing
    # the source file so py_compile cannot silently reinterpret UTF-8 bytes.
    encoding, _ = tokenize.detect_encoding(io.BytesIO(source.encode("utf-8")).readline)
    encoded_source = source.removeprefix("\ufeff").encode(encoding)

    with tempfile.TemporaryDirectory(prefix="wasm-idle-pyc-") as directory:
        source_path = os.path.join(directory, "main.py")
        output_path = os.path.join(directory, "output.pyc")
        with open(source_path, "wb") as source_file:
            source_file.write(encoded_source)
        py_compile.compile(
            source_path,
            cfile=output_path,
            dfile=filename,
            doraise=True,
            optimize=optimization,
            invalidation_mode=py_compile.PycInvalidationMode.CHECKED_HASH,
        )
        size = os.path.getsize(output_path)
        if size > byte_limit:
            return {"byteLimitExceeded": size}
        with open(output_path, "rb") as output_file:
            data = output_file.read()
    return {
        "data": data,
        "pythonVersion": platform.python_version(),
        "cacheTag": sys.implementation.cache_tag,
        "magicNumber": importlib.util.MAGIC_NUMBER.hex(),
    }

compile_bytecode(source, filename, optimization, byte_limit)
`;

/** Compile with CPython without executing source or resolving its imports. */
export function compilePythonBytecode(
	runtime: PyodideInterface,
	code: string,
	fileName: string,
	optimize: 0 | 1 | 2,
	maxArtifactBytes: number
): PythonCompileResult {
	if (typeof code !== 'string') throw new TypeError('Python source must be a string');
	if (typeof fileName !== 'string' || !/\.py$/i.test(fileName))
		throw new TypeError('Python source file name must end in .py');
	if (![0, 1, 2].includes(optimize))
		throw new TypeError('Python optimization must be 0, 1, or 2');
	if (!Number.isSafeInteger(maxArtifactBytes) || maxArtifactBytes <= 0)
		throw new TypeError('Python artifact byte limit must be a positive safe integer');

	// A private namespace keeps source and filenames out of executable bridge text.
	const globals = runtime.toPy({
		source: code,
		filename: fileName,
		optimization: optimize,
		byte_limit: maxArtifactBytes
	});
	try {
		const result = runtime.runPython(PYTHON_COMPILE, { globals });
		try {
			const converted = result.toJs({
				dict_converter: Object.fromEntries,
				create_pyproxies: false
			}) as Omit<PythonCompileResult, 'path'> | { byteLimitExceeded: number };
			if ('byteLimitExceeded' in converted) {
				throw new OutputLimitError(
					`Python bytecode is ${converted.byteLimitExceeded} bytes; limit is ${maxArtifactBytes}`,
					{
						runtimeId: 'PYTHON3',
						phase: 'compile',
						actual: converted.byteLimitExceeded,
						limit: maxArtifactBytes
					}
				);
			}
			return {
				...converted,
				path: fileName.replace(/\.py$/i, '.pyc'),
				data: Uint8Array.from(converted.data)
			};
		} finally {
			result.destroy();
		}
	} finally {
		globals.destroy();
	}
}
