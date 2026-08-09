export interface EmscriptenLldAssets {
	jsUrl: string | URL;
	jsBytes: Uint8Array;
	wasmBytes: Uint8Array;
	dataBytes: Uint8Array;
}

export interface EmscriptenLldRunOptions {
	stdout?: (chunk: string) => void;
	stderr?: (chunk: string) => void;
}

export interface EmscriptenLldRunResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	output?: Uint8Array;
}

interface EmscriptenFs {
	mkdir(path: string): void;
	writeFile(path: string, data: string | Uint8Array): void;
	readFile(path: string): Uint8Array;
	analyzePath?: (path: string) => { exists?: boolean };
}

interface EmscriptenLldModule {
	FS: EmscriptenFs;
	callMain(args: string[]): number | Promise<number>;
}

type EmscriptenLldFactory = (module?: Record<string, unknown>) => Promise<EmscriptenLldModule>;

function toArrayBuffer(bytes: Uint8Array) {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function createObjectUrl(bytes: ArrayBuffer, type: string) {
	if (
		typeof Blob !== 'function' ||
		typeof URL === 'undefined' ||
		typeof URL.createObjectURL !== 'function'
	) {
		return null;
	}
	return URL.createObjectURL(new Blob([bytes], { type }));
}

async function importLldFactory(jsBytes: Uint8Array, jsUrl: string | URL) {
	const runtimeGlobal = globalThis as typeof globalThis & {
		process?: { versions?: { node?: string } };
	};
	if (runtimeGlobal.process?.versions?.node) {
		const source = new TextDecoder('utf-8', { fatal: true })
			.decode(jsBytes)
			.replaceAll('import.meta.url', JSON.stringify(new URL(jsUrl.toString()).href));
		const module = await import(
			/* @vite-ignore */ `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`
		);
		const factory = module.default || module;
		if (typeof factory !== 'function') {
			throw new Error('wasm-d linker asset must export an Emscripten module factory');
		}
		return factory as EmscriptenLldFactory;
	}
	const jsObjectUrl = createObjectUrl(toArrayBuffer(jsBytes), 'text/javascript');
	if (!jsObjectUrl) {
		throw new Error('wasm-d linker asset requires Blob module URL support');
	}
	try {
		const module = await import(/* @vite-ignore */ jsObjectUrl);
		const factory = module.default || module;
		if (typeof factory !== 'function') {
			throw new Error('wasm-d linker asset must export an Emscripten module factory');
		}
		return factory as EmscriptenLldFactory;
	} finally {
		try {
			URL.revokeObjectURL(jsObjectUrl);
		} catch {
			// Blob cleanup must not replace module import success or failure.
		}
	}
}

function ensureEmscriptenDirectory(fs: EmscriptenFs, directoryPath: string) {
	const normalized = directoryPath.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
	if (normalized === '/') return;
	const segments = normalized.split('/').filter(Boolean);
	let current = '';
	for (const segment of segments) {
		current += `/${segment}`;
		if (fs.analyzePath?.(current).exists) continue;
		try {
			fs.mkdir(current);
		} catch (error) {
			if (!fs.analyzePath?.(current).exists) throw error;
		}
	}
}

function parentDirectory(filePath: string) {
	const normalized = filePath.replace(/\\/g, '/');
	const index = normalized.lastIndexOf('/');
	return index <= 0 ? '/' : normalized.slice(0, index);
}

export async function runEmscriptenLld(
	args: string[],
	files: Map<string, Uint8Array>,
	outputPath: string,
	assets: EmscriptenLldAssets,
	options: EmscriptenLldRunOptions = {}
): Promise<EmscriptenLldRunResult> {
	const stdout: string[] = [];
	const stderr: string[] = [];
	const factory = await importLldFactory(assets.jsBytes, assets.jsUrl);
	const wasmBinary = toArrayBuffer(assets.wasmBytes);
	const dataBytes = toArrayBuffer(assets.dataBytes);
	const wasmObjectUrl = createObjectUrl(wasmBinary, 'application/wasm');
	const dataObjectUrl = createObjectUrl(dataBytes, 'application/octet-stream');

	try {
		const lld = await factory({
			wasmBinary,
			getPreloadedPackage() {
				return dataBytes.slice(0);
			},
			locateFile(fileName: string) {
				if (wasmObjectUrl && fileName.endsWith('.wasm')) return wasmObjectUrl;
				if (dataObjectUrl && fileName.endsWith('.data')) return dataObjectUrl;
				return new URL(fileName, assets.jsUrl).href;
			},
			print(line: string) {
				const chunk = `${line}\n`;
				stdout.push(chunk);
				options.stdout?.(chunk);
			},
			printErr(line: string) {
				const chunk = `${line}\n`;
				stderr.push(chunk);
				options.stderr?.(chunk);
			},
			quit(_status: number, toThrow: unknown) {
				throw toThrow;
			}
		});

		for (const [filePath, bytes] of files) {
			ensureEmscriptenDirectory(lld.FS, parentDirectory(filePath));
			lld.FS.writeFile(filePath, bytes);
		}

		let exitCode = 0;
		try {
			exitCode = Number(await lld.callMain(['-flavor', 'wasm', ...args])) || 0;
		} catch (error) {
			const status =
				typeof (error as { status?: unknown })?.status === 'number'
					? Number((error as { status: number }).status)
					: 1;
			exitCode = status;
			if (!(error instanceof Error && error.name === 'ExitStatus')) {
				stderr.push(`${error instanceof Error ? error.message : String(error)}\n`);
			}
		}

		let output: Uint8Array | undefined;
		if (exitCode === 0) {
			output = new Uint8Array(lld.FS.readFile(outputPath));
		}

		return {
			exitCode,
			stdout: stdout.join(''),
			stderr: stderr.join(''),
			output
		};
	} finally {
		if (wasmObjectUrl) {
			try {
				URL.revokeObjectURL(wasmObjectUrl);
			} catch {
				// Cleanup must not replace the linker result.
			}
		}
		if (dataObjectUrl) {
			try {
				URL.revokeObjectURL(dataObjectUrl);
			} catch {
				// Cleanup must not replace the linker result.
			}
		}
	}
}
