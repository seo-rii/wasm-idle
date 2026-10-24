import type { PyodideInterface } from 'pyodide';
import { OutputLimitError } from '@wasm-idle/core';
import {
	resolvePythonBytecodeOptions,
	type PythonCompileOptions,
	type PythonCompileResult
} from '../pythonCompileOptions';

const PYTHON_COMPILE = String.raw`
def compile_bytecode(source, filename, optimization, byte_limit, invalidation_mode, timestamp):
    import codecs
    import importlib.util
    import io
    import os
    import platform
    import py_compile
    import sys
    import tempfile
    import tokenize

    source_text = source.removeprefix("\ufeff")
    encoding = "utf-8"
    # Read only the coding-cookie metadata. detect_encoding also validates
    # header bytes, which do not yet exist in the declared encoding.
    # Universal newlines apply only to this scan, preserving the source hash.
    with io.StringIO(source_text, newline=None) as lines:
        for _ in range(2):
            header = lines.readline().encode("ascii", "replace")
            cookie = tokenize.cookie_re.match(header)
            if cookie:
                encoding = tokenize._get_normal_name(cookie.group(1).decode("ascii"))
                try:
                    codecs.lookup(encoding)
                except LookupError:
                    raise SyntaxError("unknown encoding: " + encoding) from None
                break
            if not tokenize.blank_re.match(header):
                break
    if source.startswith("\ufeff"):
        if encoding != "utf-8":
            raise SyntaxError("encoding problem: utf-8")
        encoding = "utf-8-sig"
    # Encode the original text; py_compile validates the actual source bytes.
    encoded_source = source_text.encode(encoding)
    mode = {
        "checked-hash": py_compile.PycInvalidationMode.CHECKED_HASH,
        "unchecked-hash": py_compile.PycInvalidationMode.UNCHECKED_HASH,
        "timestamp": py_compile.PycInvalidationMode.TIMESTAMP,
    }[invalidation_mode]

    with tempfile.TemporaryDirectory(prefix="wasm-idle-pyc-") as directory:
        source_path = os.path.join(directory, "main.py")
        output_path = os.path.join(directory, "output.pyc")
        with open(source_path, "wb") as source_file:
            source_file.write(encoded_source)
        if invalidation_mode == "timestamp":
            os.utime(source_path, (timestamp, timestamp))
        py_compile.compile(
            source_path,
            cfile=output_path,
            dfile=filename,
            doraise=True,
            optimize=optimization,
            invalidation_mode=mode,
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

compile_bytecode(source, filename, optimization, byte_limit, invalidation_mode, timestamp)
`;

/** Compile with CPython without executing source or resolving its imports. */
export function compilePythonBytecode(
	runtime: PyodideInterface,
	code: string,
	fileName: string,
	optimize: 0 | 1 | 2,
	maxArtifactBytes: number,
	options: Pick<PythonCompileOptions, 'invalidationMode' | 'timestamp'> = {}
): PythonCompileResult {
	if (typeof code !== 'string') throw new TypeError('Python source must be a string');
	if (typeof fileName !== 'string' || !/\.py$/i.test(fileName))
		throw new TypeError('Python source file name must end in .py');
	if (![0, 1, 2].includes(optimize))
		throw new TypeError('Python optimization must be 0, 1, or 2');
	if (!Number.isSafeInteger(maxArtifactBytes) || maxArtifactBytes <= 0)
		throw new TypeError('Python artifact byte limit must be a positive safe integer');
	const { invalidationMode, timestamp } = resolvePythonBytecodeOptions(options);

	// A private namespace keeps source and filenames out of executable bridge text.
	const globals = runtime.toPy({
		source: code,
		filename: fileName,
		optimization: optimize,
		byte_limit: maxArtifactBytes,
		invalidation_mode: invalidationMode,
		timestamp: timestamp ?? 0
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
