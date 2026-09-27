import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, rm, cp, rename, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { syncWasmRubyAssets } from './sync-wasm-ruby.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifestName = 'runtime-split.v1.json';
const logicalModulePath = 'runtime.mjs.bin';
const mountPaths = [
	'/usr',
	'/usr/local',
	'/usr/local/lib',
	'/usr/local/lib/ruby',
	'/usr/local/lib/ruby/3.4.0',
	'/usr/local/lib/ruby/gems',
	'/usr/local/lib/ruby/gems/3.4.0',
	'/bundle'
];

/** Derive a separate filesystem from the real, locked embedded-stdlib VM. */
export async function buildRubySplitAssets(options = {}) {
	const nodeModulesDir =
		options.nodeModulesDir ||
		(await import('node:fs/promises').then((fs) =>
			fs.realpath(path.join(repoRoot, 'node_modules'))
		));
	const targetDir = options.targetDir || path.join(repoRoot, 'static/wasm-ruby/split');
	const generatedPath =
		options.generatedPath || path.join(repoRoot, 'packages/core/src/ruby-split.generated.ts');
	const temporary = await mkdtemp(path.join(tmpdir(), 'wasm-idle-ruby-split-'));
	try {
		const baseline = path.join(temporary, 'embedded');
		// Existing attested npm input trees, producer, legal files and derived wrapper
		// are all checked before the additional core binary can be used.
		const verified = await syncWasmRubyAssets({
			repoRoot,
			nodeModulesDir,
			targetDir: baseline
		});
		const inputLock = JSON.parse(
			await readFile(path.join(repoRoot, 'scripts/wasm-ruby-assets.lock.json'), 'utf8')
		);
		const rubyPackage = path.join(nodeModulesDir, '@ruby/3.4-wasm-wasi');
		const embedded = await readFile(path.join(rubyPackage, 'dist/ruby+stdlib.wasm'));
		const core = await readFile(path.join(rubyPackage, 'dist/ruby.wasm'));
		const wrapper = await readFile(path.join(baseline, logicalModulePath));
		const { DefaultRubyVM } = await import(
			pathToFileURL(path.join(nodeModulesDir, '@ruby/wasm-wasi/dist/esm/node.js')).href
		);
		const { vm } = await DefaultRubyVM(await WebAssembly.compile(embedded));
		const extracted = JSON.parse(
			vm
				.eval(
					`require "json"
      def collect_split_files(path, result)
        stat = File.lstat(path)
        if stat.directory?
          result << [path, nil]
          Dir.children(path).sort.each { |child| collect_split_files(path + "/" + child, result) }
        elsif stat.file?
          result << [path, [File.binread(path)].pack("m0")]
        else
          raise "Unsupported stdlib filesystem entry: #{path}"
        end
      end
      result=[]
      ["/usr", "/bundle"].each { |root| collect_split_files(root, result) }
      result.to_json`
				)
				.toString()
		);
		extracted.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
		let offset = 0;
		const chunks = [];
		const index = extracted.map(([filePath, base64]) => {
			if (
				!/^\/(usr|bundle)(\/[^/]+)*$/.test(filePath) ||
				filePath.split('/').some((x) => x === '.' || x === '..') ||
				/[\\\0:]/.test(filePath)
			)
				throw Error('Invalid extracted path');
			if (base64 === null) return { path: filePath, kind: 'directory' };
			const bytes = Buffer.from(base64, 'base64');
			const entry = { path: filePath, kind: 'file', offset, length: bytes.length };
			offset += bytes.length;
			chunks.push(bytes);
			return entry;
		});
		if (index.length > 4096 || offset > 24 * 1024 * 1024) throw Error('Unexpected stdlib size');
		const indexBytes = Buffer.from(JSON.stringify(index));
		if (indexBytes.length > 1024 * 1024) throw Error('Unexpected stdlib index size');
		const header = Buffer.alloc(16);
		header.write('RUBYFS1\0', 0, 'ascii');
		header.writeUInt32LE(indexBytes.length, 8);
		header.writeUInt32LE(index.length, 12);
		const pack = Buffer.concat([header, indexBytes, ...chunks]);
		const output = path.join(temporary, 'split');
		await mkdir(output);
		const logical = { module: wrapper, wasm: core, stdlib: pack };
		const names = {
			module: 'runtime.mjs.bin',
			wasm: 'ruby-core.wasm.gz.bin',
			stdlib: 'stdlib.pack.gz.bin'
		};
		const assets = {};
		for (const [name, bytes] of Object.entries(logical)) {
			const stored = name === 'module' ? bytes : gzipSync(bytes, { level: 9, mtime: 0 });
			assets[name] = {
				path: names[name],
				encoding: name === 'module' ? 'identity' : 'gzip',
				bytes: stored.length,
				sha256: sha256(stored),
				logicalBytes: bytes.length,
				logicalSha256: sha256(bytes)
			};
			await writeFile(path.join(output, names[name]), stored);
		}
		const metadata = {
			format: 'wasm-ruby-split-v1',
			profileId: inputLock.profileId + '-split-stdlib-v1',
			source: {
				embeddedManifestFingerprint: verified.fingerprint,
				npmPackages: inputLock.packages,
				embeddedWasm: { bytes: embedded.length, sha256: sha256(embedded) },
				coreWasm: { bytes: core.length, sha256: sha256(core) }
			},
			mountPaths,
			fileCount: index.filter((x) => x.kind === 'file').length,
			directoryCount: index.filter((x) => x.kind === 'directory').length,
			assets
		};
		const manifestBytes = Buffer.from(JSON.stringify(metadata, null, 2) + '\n');
		await writeFile(path.join(output, manifestName), manifestBytes);
		const bundle = {
			profileId: metadata.profileId,
			version: sha256(manifestBytes),
			manifest: {
				path: manifestName,
				bytes: manifestBytes.length,
				sha256: sha256(manifestBytes)
			},
			mountPaths,
			assets
		};
		const generated = `// Generated by scripts/sync-wasm-ruby-split.mjs from verified npm inputs.\nconst freeze = <T>(value: T): Readonly<T> => { if(value && typeof value === 'object') { for(const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };\nexport const RUBY_SPLIT_BUNDLE = freeze(${JSON.stringify(bundle, null, 2)} as const);\n`;
		if (options.verify) {
			for (const name of [...Object.values(names), manifestName]) {
				if (
					!Buffer.from(await readFile(path.join(targetDir, name))).equals(
						await readFile(path.join(output, name))
					)
				)
					throw Error('Stale Ruby split asset: ' + name);
			}
			if ((await readFile(generatedPath, 'utf8')) !== generated)
				throw Error('Stale Ruby split receipts');
		} else {
			// Stage the directory before publication; do not modify the embedded profile.
			await mkdir(path.dirname(targetDir), { recursive: true });
			await mkdir(path.dirname(generatedPath), { recursive: true });
			const staging = targetDir + '.stage';
			await rm(staging, { recursive: true, force: true });
			await cp(output, staging, { recursive: true });
			await rm(targetDir, { recursive: true, force: true });
			await rename(staging, targetDir);
			await writeFile(generatedPath, generated);
		}
		return {
			bundle,
			fileCount: metadata.fileCount,
			directoryCount: metadata.directoryCount,
			totalLogicalBytes: wrapper.length + core.length + pack.length
		};
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}

/** Standard sync entry: retain the embedded profile and publish the split profile. */
export async function syncWasmRubyProfiles(options = {}) {
	const result = await syncWasmRubyAssets(options);
	await buildRubySplitAssets({
		nodeModulesDir: result.sourceDir,
		targetDir: path.join(result.targetDir, 'split'),
		generatedPath:
			options.splitGeneratedPath ||
			path.join(repoRoot, 'packages/core/src/ruby-split.generated.ts')
	});
	return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
	console.log(
		JSON.stringify(
			await buildRubySplitAssets({ verify: process.argv.includes('--verify') }),
			null,
			2
		)
	);
