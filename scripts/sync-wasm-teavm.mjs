import { execFile as execFileCallback, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const execFile = promisify(execFileCallback);
const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'teavm');
const DEFAULT_CORE_GENERATED_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'packages',
	'core',
	'src',
	'teavm-runtime.generated.ts'
);
const DEFAULT_WRAPPER_GENERATED_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'runtimes',
	'teavm',
	'src',
	'runtime.generated.ts'
);
const DEFAULT_LOCK_FILE_PATH = path.resolve(THIS_DIR, 'wasm-teavm-assets.lock.json');
const MANIFEST_FILE = 'runtime-manifest.v2.json';
const LEGACY_MANIFEST_FILE = 'runtime-manifest.v1.json';
const FINGERPRINT_DOMAIN = 'wasm-idle:teavm-runtime-manifest:v2';
const LOGICAL_ASSETS = Object.freeze([
	'compiler.wasm-runtime.js',
	'compiler.wasm',
	'compiler.wasm-deobfuscator.wasm',
	'compile-classlib-teavm.bin',
	'runtime-classlib-teavm.bin'
]);
const EXPECTED_ROOT_KEYS = Object.freeze(
	[
		'build',
		'components',
		'legalFiles',
		'licenseExpression',
		'outputs',
		'profileId',
		'producer',
		'provenanceLevel',
		'schemaVersion',
		'source'
	].sort()
);
const OUTPUT_KEYS = Object.freeze(['bytes', 'mediaType', 'path', 'sha256', 'storage'].sort());
const STORAGE_KEYS = Object.freeze(['bytes', 'encoding', 'path', 'sha256'].sort());
const LEGAL_KEYS = Object.freeze(
	['bytes', 'mediaType', 'sha256', 'sourcePath', 'targetPath'].sort()
);

export const TEAVM_MANIFEST_FORMAT = 'wasm-teavm-runtime-manifest-v2';

/** @typedef {{bytes: number; sha256: string}} Receipt */
/** @typedef {{path: string; mediaType: string; bytes: number; sha256: string; storage: {path: string; encoding: 'identity' | 'gzip'; bytes: number; sha256: string}}} OutputReceipt */
/** @typedef {{sourcePath: string; targetPath: string; mediaType: string; bytes: number; sha256: string}} LegalReceipt */
/** @typedef {{target: string; temporary: string; previous: string; hadTarget: boolean; backedUp: boolean; published: boolean}} Publication */

/** @param {Uint8Array | string} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

/** @param {unknown} value @param {readonly string[]} expectedKeys */
const hasExactKeys = (value, expectedKeys) =>
	isObject(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expectedKeys);

/** @param {unknown} value @returns {string} */
function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (isObject(value)) {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
			.join(',')}}`;
	}
	const primitive = JSON.stringify(value);
	if (primitive === undefined) throw new Error('TeaVM manifest contains a non-JSON value');
	return primitive;
}

/** @param {string} parent @param {string} candidate */
function containsPath(parent, candidate) {
	const relative = path.relative(parent, candidate);
	return (
		relative === '' ||
		(!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
	);
}

/** @param {string} left @param {string} right */
const pathsOverlap = (left, right) => containsPath(left, right) || containsPath(right, left);

/** @param {string} value @param {string} label */
function validateRelativePath(value, label) {
	if (
		typeof value !== 'string' ||
		!value ||
		path.isAbsolute(value) ||
		value.includes('\\') ||
		value.includes('\0') ||
		value.split('/').some((part) => !part || part === '.' || part === '..')
	) {
		throw new Error(`${label} must be a safe relative path`);
	}
	return value;
}

/** @param {unknown} value @param {string} label @returns {Receipt} */
function validateReceipt(value, label) {
	if (
		!isObject(value) ||
		!Number.isSafeInteger(value.bytes) ||
		/** @type {number} */ (value.bytes) <= 0 ||
		typeof value.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.sha256)
	) {
		throw new Error(`${label} has invalid size or SHA-256 metadata`);
	}
	return { bytes: /** @type {number} */ (value.bytes), sha256: value.sha256 };
}

/** @param {unknown} value @returns {OutputReceipt} */
function validateOutput(value) {
	if (
		!hasExactKeys(value, OUTPUT_KEYS) ||
		typeof value.path !== 'string' ||
		!LOGICAL_ASSETS.includes(value.path) ||
		typeof value.mediaType !== 'string' ||
		!hasExactKeys(value.storage, STORAGE_KEYS)
	) {
		throw new Error('TeaVM output lock has an invalid asset entry');
	}
	const logical = validateReceipt(value, `TeaVM ${value.path}`);
	const storage = validateReceipt(value.storage, `TeaVM ${value.path} storage`);
	const storagePath = validateRelativePath(
		value.storage.path,
		`TeaVM ${value.path} storage path`
	);
	if (
		(value.storage.encoding !== 'identity' && value.storage.encoding !== 'gzip') ||
		(value.storage.encoding === 'identity' && storagePath !== value.path) ||
		(value.storage.encoding === 'gzip' && storagePath !== `${value.path}.gz`)
	) {
		throw new Error(`TeaVM ${value.path} has invalid storage metadata`);
	}
	return {
		path: value.path,
		mediaType: value.mediaType,
		...logical,
		storage: { path: storagePath, encoding: value.storage.encoding, ...storage }
	};
}

/** @param {unknown} value @returns {LegalReceipt} */
function validateLegalFile(value) {
	if (
		!hasExactKeys(value, LEGAL_KEYS) ||
		typeof value.mediaType !== 'string' ||
		value.mediaType.length === 0
	) {
		throw new Error('TeaVM input lock has an invalid legal-file entry');
	}
	const receipt = validateReceipt(value, 'TeaVM legal file');
	return {
		sourcePath: validateRelativePath(value.sourcePath, 'TeaVM legal source path'),
		targetPath: validateRelativePath(value.targetPath, 'TeaVM legal target path'),
		mediaType: value.mediaType,
		...receipt
	};
}

/** @param {string} lockFilePath */
export async function readTeaVmInputLock(lockFilePath = DEFAULT_LOCK_FILE_PATH) {
	let value;
	try {
		value = JSON.parse(await readFile(lockFilePath, 'utf8'));
	} catch (error) {
		throw new Error(
			`TeaVM input lock is not valid JSON: ${error instanceof Error ? error.message : error}`
		);
	}
	if (
		!hasExactKeys(value, EXPECTED_ROOT_KEYS) ||
		value.schemaVersion !== 1 ||
		typeof value.profileId !== 'string' ||
		!value.profileId ||
		typeof value.provenanceLevel !== 'string' ||
		!value.provenanceLevel ||
		typeof value.licenseExpression !== 'string' ||
		!value.licenseExpression ||
		!isObject(value.source) ||
		!isObject(value.components) ||
		!isObject(value.build) ||
		!isObject(value.producer) ||
		!Array.isArray(value.outputs) ||
		!Array.isArray(value.legalFiles)
	) {
		throw new Error('TeaVM input lock has an invalid root shape');
	}
	const outputs = value.outputs.map(validateOutput);
	if (
		outputs.length !== LOGICAL_ASSETS.length ||
		new Set(outputs.map(({ path: assetPath }) => assetPath)).size !== LOGICAL_ASSETS.length ||
		LOGICAL_ASSETS.some((asset) => !outputs.some(({ path: candidate }) => candidate === asset))
	) {
		throw new Error('TeaVM input lock must describe exactly five outputs');
	}
	const legalFiles = value.legalFiles.map(validateLegalFile);
	if (
		legalFiles.length === 0 ||
		new Set(legalFiles.map(({ targetPath }) => targetPath)).size !== legalFiles.length
	) {
		throw new Error('TeaVM input lock has missing or duplicate legal files');
	}
	return Object.freeze({
		...value,
		outputs: Object.freeze(outputs),
		legalFiles: Object.freeze(legalFiles)
	});
}

/** @param {Record<string, unknown>} manifest */
export function computeTeaVmManifestFingerprint(manifest) {
	const body = { ...manifest };
	delete body.fingerprint;
	return sha256(`${FINGERPRINT_DOMAIN}\n${canonicalJson(body)}`);
}

/** @param {string} filePath */
async function requireRegularFile(filePath) {
	const entry = await lstat(filePath).catch(() => null);
	if (!entry?.isFile() || entry.isSymbolicLink()) {
		throw new Error(`TeaVM input must be a regular file: ${filePath}`);
	}
}

/** @param {string} filePath @param {Receipt} receipt @param {string} label */
async function verifyFileReceipt(filePath, receipt, label) {
	await requireRegularFile(filePath);
	const bytes = await readFile(filePath);
	if (bytes.byteLength !== receipt.bytes || sha256(bytes) !== receipt.sha256) {
		throw new Error(`${label} does not match the input lock`);
	}
	return bytes;
}

/** @param {string} distDir @param {readonly OutputReceipt[]} outputs */
async function readDistribution(distDir, outputs) {
	const directory = await lstat(distDir).catch(() => null);
	if (!directory?.isDirectory() || directory.isSymbolicLink()) {
		throw new Error(`TeaVM distribution must be a real directory: ${distDir}`);
	}
	const entries = await readdir(distDir, { withFileTypes: true });
	if (
		entries.length !== LOGICAL_ASSETS.length ||
		entries.some((entry) => !entry.isFile() || !LOGICAL_ASSETS.includes(entry.name))
	) {
		throw new Error('TeaVM distribution must contain exactly five logical assets');
	}
	const logicalBytes = new Map();
	for (const output of outputs) {
		const bytes = await readFile(path.join(distDir, output.path));
		if (bytes.byteLength !== output.bytes || sha256(bytes) !== output.sha256) {
			throw new Error(`TeaVM ${output.path} does not match the output lock`);
		}
		if (
			output.path.endsWith('.wasm') &&
			!Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))
		) {
			throw new Error(`TeaVM ${output.path} has an invalid WebAssembly header`);
		}
		if (
			output.path.endsWith('-classlib-teavm.bin') &&
			(bytes[0] !== 0x1f || bytes[1] !== 0x8b)
		) {
			throw new Error(`TeaVM ${output.path} has an invalid classlib archive header`);
		}
		logicalBytes.set(output.path, bytes);
	}
	return logicalBytes;
}

/** @param {'core' | 'wrapper'} kind @param {string} fingerprint @param {readonly OutputReceipt[]} outputs */
function renderGeneratedModule(kind, fingerprint, outputs) {
	const versionName = kind === 'core' ? 'TEAVM_RUNTIME_ASSET_VERSION' : 'TEAVM_ASSET_VERSION';
	const receiptsName = kind === 'core' ? 'TEAVM_RUNTIME_ASSET_RECEIPTS' : 'TEAVM_ASSET_RECEIPTS';
	const entries = outputs
		.map(
			(output) =>
				`\t'${output.path}': Object.freeze({\n\t\tbytes: ${output.bytes},\n\t\tsha256: '${output.sha256}'\n\t})`
		)
		.join(',\n');
	return `// Generated by scripts/sync-wasm-teavm.mjs. Do not edit.\n\nexport const ${versionName} =\n\t'${fingerprint}';\n\nexport const ${receiptsName} = Object.freeze({\n${entries}\n});\n`;
}

/** @param {Publication[]} publications */
async function publishAll(publications) {
	try {
		for (const publication of publications) {
			const targetEntry = await lstat(publication.target).catch(() => null);
			if (targetEntry?.isSymbolicLink()) {
				throw new Error(
					`TeaVM publication target must not be a symlink: ${publication.target}`
				);
			}
			publication.hadTarget = !!targetEntry;
			if (publication.hadTarget) {
				await rename(publication.target, publication.previous);
				publication.backedUp = true;
			}
			await rename(publication.temporary, publication.target);
			publication.published = true;
		}
	} catch (error) {
		for (const publication of [...publications].reverse()) {
			if (publication.published) {
				await rm(publication.target, { recursive: true, force: true }).catch(
					() => undefined
				);
			}
			if (publication.backedUp) {
				await rename(publication.previous, publication.target).catch(() => undefined);
			}
		}
		throw error;
	}
	for (const publication of publications) {
		if (publication.backedUp) {
			await rm(publication.previous, { recursive: true, force: true });
		}
	}
}

/**
 * @param {{distDir: string; targetDir?: string; coreGeneratedModulePath?: string; wrapperGeneratedModulePath?: string; lockFilePath?: string; repoRoot?: string}} options
 */
export async function syncWasmTeaVmAssets(options) {
	if (!options?.distDir) throw new Error('TeaVM sync requires an explicit distDir');
	const repoRoot = path.resolve(options.repoRoot ?? REPO_ROOT);
	const distDir = path.resolve(options.distDir);
	const targetDir = path.resolve(options.targetDir ?? DEFAULT_TARGET_DIR);
	const coreGeneratedModulePath = path.resolve(
		options.coreGeneratedModulePath ?? DEFAULT_CORE_GENERATED_MODULE_PATH
	);
	const wrapperGeneratedModulePath = path.resolve(
		options.wrapperGeneratedModulePath ?? DEFAULT_WRAPPER_GENERATED_MODULE_PATH
	);
	const lock = await readTeaVmInputLock(options.lockFilePath ?? DEFAULT_LOCK_FILE_PATH);
	const publicationTargets = [targetDir, coreGeneratedModulePath, wrapperGeneratedModulePath];
	if (
		publicationTargets.some((target) => pathsOverlap(distDir, target)) ||
		publicationTargets.some((target, index) =>
			publicationTargets.slice(index + 1).some((other) => pathsOverlap(target, other))
		)
	) {
		throw new Error('TeaVM source and publication paths must not overlap');
	}
	const logicalBytes = await readDistribution(distDir, lock.outputs);
	const storedBytes = new Map();
	for (const output of lock.outputs) {
		const logical = logicalBytes.get(output.path);
		const stored =
			output.storage.encoding === 'gzip'
				? gzipSync(logical, { level: 9, mtime: 0 })
				: logical;
		if (
			stored.byteLength !== output.storage.bytes ||
			sha256(stored) !== output.storage.sha256
		) {
			throw new Error(`TeaVM ${output.path} storage does not match the output lock`);
		}
		storedBytes.set(output.storage.path, stored);
	}
	const legalBytes = new Map();
	for (const legalFile of lock.legalFiles) {
		legalBytes.set(
			legalFile.targetPath,
			await verifyFileReceipt(
				path.resolve(repoRoot, legalFile.sourcePath),
				legalFile,
				`TeaVM ${legalFile.sourcePath}`
			)
		);
	}
	const manifestBody = {
		format: TEAVM_MANIFEST_FORMAT,
		runtime: 'teavm-javac',
		profileId: lock.profileId,
		provenanceLevel: lock.provenanceLevel,
		licenseExpression: lock.licenseExpression,
		source: lock.source,
		components: lock.components,
		build: lock.build,
		producer: lock.producer,
		legalFiles: lock.legalFiles.map(({ sourcePath: _sourcePath, targetPath, ...receipt }) => ({
			path: targetPath,
			...receipt
		})),
		assets: lock.outputs
	};
	const manifest = {
		...manifestBody,
		fingerprint: computeTeaVmManifestFingerprint(manifestBody)
	};
	const suffix = randomUUID();
	const temporaryTargetDir = path.join(
		path.dirname(targetDir),
		`.${path.basename(targetDir)}.tmp-${suffix}`
	);
	const temporaryCoreModule = `${coreGeneratedModulePath}.tmp-${suffix}`;
	const temporaryWrapperModule = `${wrapperGeneratedModulePath}.tmp-${suffix}`;
	await mkdir(path.dirname(targetDir), { recursive: true });
	await mkdir(temporaryTargetDir, { recursive: false });
	await mkdir(path.dirname(coreGeneratedModulePath), { recursive: true });
	await mkdir(path.dirname(wrapperGeneratedModulePath), { recursive: true });
	try {
		for (const [storagePath, bytes] of storedBytes) {
			const outputPath = path.join(temporaryTargetDir, storagePath);
			await mkdir(path.dirname(outputPath), { recursive: true });
			await writeFile(outputPath, bytes);
		}
		for (const [targetPath, bytes] of legalBytes) {
			const outputPath = path.join(temporaryTargetDir, targetPath);
			await mkdir(path.dirname(outputPath), { recursive: true });
			await writeFile(outputPath, bytes);
		}
		await writeFile(
			path.join(temporaryTargetDir, MANIFEST_FILE),
			`${JSON.stringify(manifest, null, '\t')}\n`
		);
		await writeFile(
			temporaryCoreModule,
			renderGeneratedModule('core', manifest.fingerprint, lock.outputs)
		);
		await writeFile(
			temporaryWrapperModule,
			renderGeneratedModule('wrapper', manifest.fingerprint, lock.outputs)
		);
		/** @type {Publication[]} */
		const publications = [
			{
				target: targetDir,
				temporary: temporaryTargetDir,
				previous: `${targetDir}.previous-${suffix}`,
				hadTarget: false,
				backedUp: false,
				published: false
			},
			{
				target: coreGeneratedModulePath,
				temporary: temporaryCoreModule,
				previous: `${coreGeneratedModulePath}.previous-${suffix}`,
				hadTarget: false,
				backedUp: false,
				published: false
			},
			{
				target: wrapperGeneratedModulePath,
				temporary: temporaryWrapperModule,
				previous: `${wrapperGeneratedModulePath}.previous-${suffix}`,
				hadTarget: false,
				backedUp: false,
				published: false
			}
		];
		await publishAll(publications);
	} finally {
		await rm(temporaryTargetDir, { recursive: true, force: true });
		await rm(temporaryCoreModule, { force: true });
		await rm(temporaryWrapperModule, { force: true });
	}
	return Object.freeze({
		distDir,
		targetDir,
		coreGeneratedModulePath,
		wrapperGeneratedModulePath,
		manifestPath: path.join(targetDir, MANIFEST_FILE),
		fingerprint: manifest.fingerprint,
		legacyManifestRemoved: !(await lstat(path.join(targetDir, LEGACY_MANIFEST_FILE)).catch(
			() => null
		))
	});
}

/** @param {string} command @param {string[]} args @param {{cwd: string; env: NodeJS.ProcessEnv}} options */
function runCommand(command, args, options) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { ...options, stdio: 'inherit' });
		child.once('error', reject);
		child.once('exit', (code, signal) => {
			if (code === 0) resolve(undefined);
			else
				reject(
					new Error(
						`${command} failed with ${signal ? `signal ${signal}` : `exit ${code}`}`
					)
				);
		});
	});
}

/** @param {string} sourceDir @param {ReturnType<typeof readTeaVmInputLock> extends Promise<infer T> ? T : never} lock */
async function verifySourceCheckout(sourceDir, lock) {
	const source = lock.source;
	if (
		!isObject(source) ||
		typeof source.repository !== 'string' ||
		typeof source.revision !== 'string' ||
		!/^[a-f0-9]{40}$/u.test(source.revision) ||
		!Array.isArray(source.buildInputs)
	) {
		throw new Error('TeaVM producer lock has invalid source metadata');
	}
	const git = async (...args) =>
		(
			await execFile('git', ['-C', sourceDir, ...args], {
				encoding: 'utf8',
				maxBuffer: 1024 * 1024
			})
		).stdout.trim();
	if ((await git('rev-parse', 'HEAD')) !== source.revision) {
		throw new Error('TeaVM source checkout revision does not match the input lock');
	}
	if (await git('status', '--porcelain', '--untracked-files=no')) {
		throw new Error('TeaVM source checkout has tracked modifications');
	}
	const actualRemote = (await git('remote', 'get-url', 'origin')).replace(/\/$/u, '');
	const expectedRemote = source.repository.replace(/\/$/u, '');
	if (actualRemote !== expectedRemote) {
		throw new Error('TeaVM source checkout remote does not match the input lock');
	}
	for (const input of source.buildInputs) {
		if (!isObject(input) || typeof input.path !== 'string') {
			throw new Error('TeaVM producer lock has an invalid build input');
		}
		await verifyFileReceipt(
			path.resolve(sourceDir, validateRelativePath(input.path, 'TeaVM build input path')),
			validateReceipt(input, `TeaVM ${input.path}`),
			`TeaVM source input ${input.path}`
		);
	}
}

/** @param {string} releaseSource */
function parseJdkRelease(releaseSource) {
	return Object.fromEntries(
		releaseSource
			.split(/\r?\n/u)
			.filter(Boolean)
			.map((line) => {
				const separator = line.indexOf('=');
				if (separator <= 0) throw new Error('Pinned JDK release file is malformed');
				const key = line.slice(0, separator);
				const rawValue = line.slice(separator + 1);
				return [key, rawValue.replace(/^"|"$/gu, '')];
			})
	);
}

/** @param {string} root @param {string} name */
async function findFileByName(root, name) {
	for (const entry of await readdir(root, { withFileTypes: true })) {
		const entryPath = path.join(root, entry.name);
		if (entry.isDirectory()) {
			const nested = await findFileByName(entryPath, name);
			if (nested) return nested;
		} else if (entry.isFile() && entry.name === name) {
			return entryPath;
		}
	}
	return undefined;
}

/** @param {unknown} value @param {string} label */
function requireObject(value, label) {
	if (!isObject(value)) throw new Error(`TeaVM producer lock has invalid ${label}`);
	return value;
}

/**
 * @param {{sourceDir: string; jdkArchivePath?: string; targetDir?: string; coreGeneratedModulePath?: string; wrapperGeneratedModulePath?: string; lockFilePath?: string; repoRoot?: string; commandRunner?: typeof runCommand}} options
 */
export async function produceWasmTeaVmAssets(options) {
	if (!options?.sourceDir) throw new Error('TeaVM producer requires an explicit sourceDir');
	const jdkArchivePath = path.resolve(
		options.jdkArchivePath ?? process.env.WASM_IDLE_TEAVM_JDK_ARCHIVE ?? ''
	);
	if (!options.jdkArchivePath && !process.env.WASM_IDLE_TEAVM_JDK_ARCHIVE) {
		throw new Error('TeaVM producer requires an explicit jdkArchivePath');
	}
	const repoRoot = path.resolve(options.repoRoot ?? REPO_ROOT);
	const sourceDir = path.resolve(options.sourceDir);
	const lockFilePath = path.resolve(options.lockFilePath ?? DEFAULT_LOCK_FILE_PATH);
	const lock = await readTeaVmInputLock(lockFilePath);
	const build = requireObject(lock.build, 'build metadata');
	const producer = requireObject(lock.producer, 'producer metadata');
	const host = requireObject(build.host, 'host metadata');
	const jdk = requireObject(build.jdk, 'JDK metadata');
	const jdkArchive = requireObject(jdk.archive, 'JDK archive metadata');
	const gradle = requireObject(build.gradle, 'Gradle metadata');
	const node = requireObject(build.node, 'Node metadata');
	const overlay = requireObject(build.overlay, 'overlay metadata');
	if (overlay.mode !== 'gradle-source-set') {
		throw new Error('TeaVM producer requires the integrated Gradle overlay source set');
	}
	const components = requireObject(lock.components, 'component metadata');
	const teavm = requireObject(components.teavm, 'TeaVM component metadata');
	const openjdk = requireObject(components.openjdk, 'OpenJDK metadata');
	const openjdkArchive = requireObject(openjdk.archive, 'OpenJDK archive metadata');
	const verificationMetadata = requireObject(
		gradle.verificationMetadata,
		'Gradle verification metadata'
	);
	if (
		host.os !== process.platform ||
		host.arch !== process.arch ||
		node.version !== process.versions.node ||
		node.zlib !== process.versions.zlib
	) {
		throw new Error('TeaVM producer host or Node/zlib identity does not match the input lock');
	}
	await verifySourceCheckout(sourceDir, lock);
	await verifyFileReceipt(
		jdkArchivePath,
		validateReceipt(jdkArchive, 'TeaVM JDK archive'),
		'TeaVM JDK archive'
	);
	if (typeof verificationMetadata.path !== 'string') {
		throw new Error('TeaVM producer lock has invalid Gradle verification-metadata path');
	}
	const verificationMetadataBytes = await verifyFileReceipt(
		path.resolve(
			repoRoot,
			validateRelativePath(
				verificationMetadata.path,
				'TeaVM Gradle verification-metadata path'
			)
		),
		validateReceipt(verificationMetadata, 'TeaVM Gradle verification metadata'),
		'TeaVM Gradle verification metadata'
	);
	// wasm-idle patches applied to the teavm-javac source before it is built.
	if (build.sourcePatches !== undefined && !Array.isArray(build.sourcePatches)) {
		throw new Error('TeaVM producer lock has invalid source patches');
	}
	const sourcePatchPaths = [];
	for (const sourcePatch of build.sourcePatches ?? []) {
		if (!isObject(sourcePatch) || typeof sourcePatch.path !== 'string') {
			throw new Error('TeaVM producer lock has an invalid source patch');
		}
		const sourcePatchPath = path.resolve(
			repoRoot,
			validateRelativePath(sourcePatch.path, 'TeaVM source patch path')
		);
		await verifyFileReceipt(
			sourcePatchPath,
			validateReceipt(sourcePatch, `TeaVM source patch ${sourcePatch.path}`),
			`TeaVM source patch ${sourcePatch.path}`
		);
		sourcePatchPaths.push(sourcePatchPath);
	}
	if (!Array.isArray(producer.files) || producer.files.length === 0) {
		throw new Error('TeaVM producer lock is missing producer file receipts');
	}
	for (const producerFile of producer.files) {
		if (!isObject(producerFile) || typeof producerFile.path !== 'string') {
			throw new Error('TeaVM producer lock has an invalid producer file receipt');
		}
		await verifyFileReceipt(
			path.resolve(
				repoRoot,
				validateRelativePath(producerFile.path, 'TeaVM producer file path')
			),
			validateReceipt(producerFile, `TeaVM producer ${producerFile.path}`),
			`TeaVM producer ${producerFile.path}`
		);
	}
	const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'wasm-idle-teavm-producer-'));
	const run = options.commandRunner ?? runCommand;
	try {
		const sourceArchive = path.join(temporaryRoot, 'source.tar');
		const buildRoot = path.join(temporaryRoot, 'source');
		const jdkExtractRoot = path.join(temporaryRoot, 'jdk');
		const gradleUserHome = path.join(temporaryRoot, 'gradle-home');
		const distDir = path.join(temporaryRoot, 'dist');
		await Promise.all([
			mkdir(buildRoot),
			mkdir(jdkExtractRoot),
			mkdir(gradleUserHome),
			mkdir(distDir)
		]);
		await run(
			'git',
			[
				'-C',
				sourceDir,
				'archive',
				'--format=tar',
				`--output=${sourceArchive}`,
				lock.source.revision
			],
			{
				cwd: sourceDir,
				env: process.env
			}
		);
		await run('tar', ['-xf', sourceArchive, '-C', buildRoot], {
			cwd: temporaryRoot,
			env: process.env
		});
		for (const sourcePatchPath of sourcePatchPaths) {
			// The ceiling keeps git from treating an enclosing repository as the patch root.
			await run('git', ['apply', '--verbose', sourcePatchPath], {
				cwd: buildRoot,
				env: { ...process.env, GIT_CEILING_DIRECTORIES: temporaryRoot }
			});
		}
		if (!Array.isArray(overlay.sources) || overlay.sources.length === 0) {
			throw new Error('TeaVM producer lock is missing integrated overlay source receipts');
		}
		for (const source of overlay.sources) {
			if (!isObject(source) || typeof source.path !== 'string')
				throw new Error('Invalid TeaVM overlay source');
			await verifyFileReceipt(
				path.join(
					buildRoot,
					validateRelativePath(source.path, 'TeaVM overlay source path')
				),
				validateReceipt(source, 'TeaVM overlay source'),
				`TeaVM integrated overlay ${source.path}`
			);
		}
		await run('tar', ['-xzf', jdkArchivePath, '-C', jdkExtractRoot], {
			cwd: temporaryRoot,
			env: process.env
		});
		await writeFile(
			path.join(buildRoot, 'gradle', 'verification-metadata.xml'),
			verificationMetadataBytes
		);
		const jdkDirectories = (await readdir(jdkExtractRoot, { withFileTypes: true })).filter(
			(entry) => entry.isDirectory()
		);
		if (jdkDirectories.length !== 1) {
			throw new Error('Pinned TeaVM JDK archive must contain exactly one root directory');
		}
		const javaHome = path.join(jdkExtractRoot, jdkDirectories[0].name);
		const expectedRelease = requireObject(jdk.release, 'JDK release metadata');
		const actualRelease = parseJdkRelease(
			await readFile(path.join(javaHome, 'release'), 'utf8')
		);
		for (const [key, expected] of Object.entries(expectedRelease)) {
			if (actualRelease[key] !== expected) {
				throw new Error(`Pinned TeaVM JDK release identity mismatch for ${key}`);
			}
		}
		if (typeof gradle.distributionSha256 !== 'string') {
			throw new Error('TeaVM producer lock has invalid Gradle distribution metadata');
		}
		const wrapperPropertiesPath = path.join(
			buildRoot,
			'gradle',
			'wrapper',
			'gradle-wrapper.properties'
		);
		const wrapperProperties = await readFile(wrapperPropertiesPath, 'utf8');
		if (
			!wrapperProperties
				.replaceAll('\\:', ':')
				.includes(`distributionUrl=${gradle.distributionUrl}`)
		) {
			throw new Error('TeaVM Gradle distribution URL differs from its lock');
		}
		await writeFile(
			wrapperPropertiesPath,
			`${wrapperProperties.trimEnd()}\ndistributionSha256Sum=${gradle.distributionSha256}\n`
		);
		await writeFile(
			path.join(gradleUserHome, 'gradle.properties'),
			'org.gradle.jvmargs=-Xmx512m -XX:MaxMetaspaceSize=256m\norg.gradle.workers.max=1\norg.gradle.parallel=false\n'
		);
		const buildEnvironment = {
			...process.env,
			JAVA_HOME: javaHome,
			GRADLE_USER_HOME: gradleUserHome,
			PATH: `${path.join(javaHome, 'bin')}${path.delimiter}${process.env.PATH ?? ''}`
		};
		await run(
			'./gradlew',
			['--no-daemon', '--dependency-verification', 'strict', 'clean', ':javac:downloadJDK'],
			{
				cwd: buildRoot,
				env: buildEnvironment
			}
		);
		const openjdkZip = path.join(buildRoot, 'javac', 'build', `jdk-${openjdk.revision}.zip`);
		await verifyFileReceipt(
			openjdkZip,
			validateReceipt(openjdkArchive, 'TeaVM OpenJDK source archive'),
			'TeaVM OpenJDK source archive'
		);
		await run(
			'./gradlew',
			['--no-daemon', '--dependency-verification', 'strict', ':compiler:createDist'],
			{
				cwd: buildRoot,
				env: buildEnvironment
			}
		);
		const deobfuscatorName = `teavm-wasm-gc-deobfuscator-${teavm.version}.jar`;
		if (!Array.isArray(teavm.artifacts))
			throw new Error('TeaVM component artifact receipts are missing');
		const deobfuscatorArtifact = teavm.artifacts.find(
			(artifact) => isObject(artifact) && artifact.name === deobfuscatorName
		);
		if (!isObject(deobfuscatorArtifact))
			throw new Error('TeaVM stack deobfuscator input is missing');
		let deobfuscatorJar;
		for (const cache of [
			path.join(gradleUserHome, 'caches'),
			buildEnvironment.GRADLE_RO_DEP_CACHE
		]) {
			if (!cache) continue;
			const directory = path.join(
				cache,
				'modules-2',
				'files-2.1',
				'org.teavm',
				'teavm-wasm-gc-deobfuscator'
			);
			deobfuscatorJar = await findFileByName(directory, deobfuscatorName).catch((error) => {
				if (error.code === 'ENOENT') return undefined;
				throw error;
			});
			if (deobfuscatorJar) break;
		}
		if (!deobfuscatorJar)
			throw new Error('TeaVM stack deobfuscator dependency was not resolved');
		await verifyFileReceipt(
			deobfuscatorJar,
			validateReceipt(deobfuscatorArtifact, 'TeaVM stack deobfuscator JAR'),
			'TeaVM stack deobfuscator JAR'
		);
		await run(
			'unzip',
			[
				'-q',
				path.join(buildRoot, 'compiler/build/distributions/dist.zip'),
				...LOGICAL_ASSETS.filter((asset) => asset !== 'compiler.wasm-deobfuscator.wasm'),
				'-d',
				distDir
			],
			{
				cwd: temporaryRoot,
				env: buildEnvironment
			}
		);
		const { stdout: deobfuscatorBytes } = await execFile(
			'unzip',
			['-p', deobfuscatorJar, 'org/teavm/backend/wasm/deobfuscator.wasm'],
			{
				encoding: 'buffer',
				maxBuffer: 1024 * 1024
			}
		);
		await writeFile(path.join(distDir, 'compiler.wasm-deobfuscator.wasm'), deobfuscatorBytes);
		// The Gradle source set already applied and verified every classlib replacement.
		// Transactional publication below rejects any output differing from the independently
		// reproduced five-asset receipt, including the JAR's deobfuscator resource.
		return await syncWasmTeaVmAssets({
			distDir,
			targetDir: options.targetDir,
			coreGeneratedModulePath: options.coreGeneratedModulePath,
			wrapperGeneratedModulePath: options.wrapperGeneratedModulePath,
			lockFilePath,
			repoRoot
		});
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

/** @param {string[]} args */
export function assertTeaVmProducerArgs(args) {
	if (args.length < 2 || args.length > 3) {
		throw new Error(
			'TeaVM producer requires sourceDir and jdkArchivePath, plus optional targetDir'
		);
	}
	for (const arg of args) {
		if (arg.startsWith('-')) throw new Error(`Unknown TeaVM producer option: ${arg}`);
	}
}

async function main() {
	const args = process.argv.slice(2);
	assertTeaVmProducerArgs(args);
	const result = await produceWasmTeaVmAssets({
		sourceDir: path.resolve(args[0]),
		jdkArchivePath: path.resolve(args[1]),
		targetDir: args[2] ? path.resolve(args[2]) : undefined
	});
	console.log(`Produced TeaVM profile ${result.fingerprint} at ${result.targetDir}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	try {
		await main();
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}
