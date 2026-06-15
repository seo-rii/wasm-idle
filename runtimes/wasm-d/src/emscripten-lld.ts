export interface EmscriptenLldAssets {
	jsUrl: string | URL;
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

async function importLldFactory(jsUrl: string | URL) {
	const module = await import(/* @vite-ignore */ jsUrl.toString());
	const factory = module.default || module;
	if (typeof factory !== 'function') {
		throw new Error('wasm-d linker asset must export an Emscripten module factory');
	}
	return factory as EmscriptenLldFactory;
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
	const factory = await importLldFactory(assets.jsUrl);
	const wasmBinary = toArrayBuffer(assets.wasmBytes);
	const dataBytes = toArrayBuffer(assets.dataBytes);
	const lld = await factory({
		wasmBinary,
		getPreloadedPackage() {
			return dataBytes.slice(0);
		},
		locateFile(fileName: string) {
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
		const status = typeof (error as { status?: unknown })?.status === 'number'
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
}
