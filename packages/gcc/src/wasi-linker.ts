import {
	ConsoleStdout,
	Directory,
	File,
	OpenFile,
	PreopenDirectory,
	WASI,
	type Inode
} from '@bjorn3/browser_wasi_shim';

/** Host the producer's real wasm-ld WASI executable; it only receives object/library bytes. */
export async function runWasiGccLinker(
	module: WebAssembly.Module,
	argv: readonly string[],
	files: Iterable<readonly [string, Uint8Array]>,
	outputPath: string,
	print: (stream: 'stdout' | 'stderr', text: string) => void
) {
	const root = new Directory(new Map());
	function parent(path: string) {
		const segments = path.split('/').filter(Boolean);
		let directory = root;
		for (const name of segments.slice(0, -1)) {
			let next = directory.contents.get(name);
			if (!next) {
				next = new Directory(new Map());
				directory.contents.set(name, next);
			}
			if (!(next instanceof Directory))
				throw new Error('GCC linker file/directory collision');
			directory = next;
		}
		return { directory, name: segments.at(-1)! };
	}
	for (const [path, contents] of files) {
		const { directory, name } = parent(path);
		directory.contents.set(name, new File(contents));
	}
	parent('/tmp/.keep');
	const decoder = { stdout: new TextDecoder(), stderr: new TextDecoder() };
	const capture = (stream: 'stdout' | 'stderr') =>
		new ConsoleStdout((bytes) => {
			const text = decoder[stream].decode(bytes, { stream: true });
			if (text) print(stream, text);
		});
	const wasi = new WASI(
		['wasm-ld', ...argv],
		['PWD=/workspace'],
		[
			new OpenFile(new File(new Uint8Array())),
			capture('stdout'),
			capture('stderr'),
			new PreopenDirectory('/', root.contents)
		],
		{ debug: false }
	);
	const instance = await WebAssembly.instantiate(module, {
		wasi_snapshot_preview1: wasi.wasiImport
	});
	const exitCode = wasi.start(instance as unknown as Parameters<WASI['start']>[0]);
	for (const stream of ['stdout', 'stderr'] as const) {
		const tail = decoder[stream].decode();
		if (tail) print(stream, tail);
	}
	let output: Inode | undefined = root;
	for (const name of outputPath.split('/').filter(Boolean))
		output = output instanceof Directory ? output.contents.get(name) : undefined;
	if (exitCode === 0 && !(output instanceof File))
		throw new Error('GCC WASI linker produced no output');
	return {
		exitCode,
		peakMemoryBytes: (instance.exports.memory as WebAssembly.Memory).buffer.byteLength,
		output: output instanceof File ? Uint8Array.from(output.data) : undefined
	};
}
