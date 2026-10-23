import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

// Execute the shipped browser engine in a Node host without rebuilding PHP.
// Fetch only immutable local assets; the normal bootstrap verifies their receipts.
const root = path.resolve(
	process.argv[2] || new URL('../../../static/wasm-php/', import.meta.url).pathname
);
const output = path.resolve(process.argv[3] || 'out/php-debug-agent.json');
const mode = process.argv[4] || 'asyncify';
if (!['asyncify', 'jspi', 'auto'].includes(mode))
	throw new Error('Expected asyncify, jspi or auto');
const hostProcess = process;
const originalFetch = fetch;
const requested = [];
globalThis.self = globalThis;
globalThis.location = pathToFileURL(path.join(root, 'startup.mjs'));
globalThis.fetch = async (input) => {
	const url = new URL(String(input));
	if (url.protocol !== 'file:') throw new Error('Debug probe only fetches local PHP assets');
	const file = fileURLToPath(url);
	if (!file.startsWith(`${root}${path.sep}`))
		throw new Error('PHP asset is outside runtime directory');
	let bytes;
	try {
		bytes = await readFile(file);
	} catch (error) {
		if (error.code !== 'ENOENT') throw error;
		bytes = gunzipSync(await readFile(`${file}.gz`));
	}
	requested.push({
		path: path.relative(root, file),
		bytes: bytes.length,
		sha256: createHash('sha256').update(bytes).digest('hex')
	});
	return new Response(bytes, {
		headers: {
			'Content-Type': file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream'
		}
	});
};
// Select Emscripten's browser/worker host path; its browser bundle intentionally
// excludes Node filesystem adapters. This process is a dedicated probe host.
globalThis.process = undefined;
let php;
let result;
try {
	const { createPhp84 } = await import(pathToFileURL(path.join(root, 'startup.mjs')).href);
	php = await createPhp84({ asyncMode: mode });
	const info = await php.run({
		code: '<?php echo json_encode(["version"=>PHP_VERSION,"xdebug"=>extension_loaded("xdebug"),"xdebug_break"=>function_exists("xdebug_break"),"xdebug_mode"=>ini_get("xdebug.mode"),"extensions"=>get_loaded_extensions()]);'
	});
	if (info.exitCode !== 0 || info.errors)
		throw new Error(info.errors || `PHP exited ${info.exitCode}`);
	const capabilities = JSON.parse(info.text);
	const stdin = '7\n';
	const io = await php.run({
		code: '<?php echo ((int)file_get_contents("php://input")+5)."\\n";',
		body: new TextEncoder().encode(stdin)
	});
	if (io.exitCode !== 0 || io.errors || io.text !== '12\n')
		throw new Error(
			`PHP stdin/stdout control failed: ${JSON.stringify({ stdout: io.text, stderr: io.errors, exitCode: io.exitCode })}`
		);
	result = {
		status: capabilities.xdebug ? 'candidate' : 'blocked',
		capabilities,
		stdin,
		stdout: io.text,
		stderr: io.errors,
		exitCode: io.exitCode,
		...(capabilities.xdebug
			? {}
			: { blocker: 'The shipped PHP engine does not contain the Xdebug extension.' })
	};
} catch (error) {
	result = { status: 'probe-error', error: String(error) };
} finally {
	try {
		php?.exit();
	} finally {
		globalThis.process = hostProcess;
		globalThis.fetch = originalFetch;
	}
}
await mkdir(path.dirname(output), { recursive: true });
await writeFile(
	output,
	`${JSON.stringify(
		{
			schemaVersion: 1,
			probedAt: new Date().toISOString(),
			mode,
			...result,
			requested,
			breakpointsFramesLocalsVerified: false
		},
		null,
		2
	)}\n`
);
console.log(`PHP debugger probe: ${output}`);
if (result.status === 'probe-error') process.exitCode = 1;
