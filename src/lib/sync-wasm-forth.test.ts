import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
	mkdtemp,
	mkdir,
	lstat,
	readFile,
	readdir,
	rename,
	rm,
	symlink,
	writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FORTH_MANIFEST_FORMAT, syncWasmForthAssets } from '../../scripts/sync-wasm-forth.mjs';

const tempDirs: string[] = [];
const sourceText =
	'module.exports = { default: function WAForth() {}, isSuccess() { return true; } }; WebAssembly.instantiate;\n';
const workerText = `const format = '${FORTH_MANIFEST_FORMAT}'; self.onmessage = () => format;\n`;
const publicationJournalFormat = 'wasm-forth-publication-journal-v1';
const publicationCommitFormat = 'wasm-forth-publication-commit-v1';

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

async function makeTempDir() {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-wasm-forth-'));
	tempDirs.push(dir);
	return dir;
}

async function writeFixtureFile(baseDir: string, relativePath: string, contents: string) {
	const targetPath = path.join(baseDir, relativePath);
	await mkdir(path.dirname(targetPath), { recursive: true });
	await writeFile(targetPath, contents, 'utf8');
	return targetPath;
}

async function pathExists(filePath: string) {
	return !!(await lstat(filePath).catch(() => null));
}

async function publicationTicketNames(parentDir: string, targetDir: string) {
	const prefix = `${path.basename(targetDir)}.publication-journal.v1.json.lock-`;
	return (await readdir(parentDir)).filter((entry) => entry.startsWith(prefix));
}

function publicationExpected(runtimeLabel: string, versionSource: string) {
	const runtimeFiles = [
		['runner-worker.js', `${runtimeLabel}:runner`],
		['runtime-manifest.v2.json', `${runtimeLabel}:manifest`],
		['waforth.js', `${runtimeLabel}:waforth`]
	].map(([assetPath, contents]) => ({
		path: assetPath!,
		bytes: Buffer.byteLength(contents!),
		sha256: sha256(contents!)
	}));
	return {
		fingerprint: sha256(runtimeLabel),
		runtimeFiles,
		versionModule: {
			bytes: Buffer.byteLength(versionSource),
			sha256: sha256(versionSource)
		}
	};
}

async function writeRuntimeGeneration(targetDir: string, runtimeLabel: string) {
	await Promise.all([
		writeFixtureFile(targetDir, 'runner-worker.js', `${runtimeLabel}:runner`),
		writeFixtureFile(targetDir, 'runtime-manifest.v2.json', `${runtimeLabel}:manifest`),
		writeFixtureFile(targetDir, 'waforth.js', `${runtimeLabel}:waforth`)
	]);
}

async function writePublicationJournal({
	targetDir,
	versionModulePath,
	transactionId,
	runtimeHadCurrent = true,
	versionModuleHadCurrent = true,
	committed = false,
	markerJournalSha256
}: {
	targetDir: string;
	versionModulePath: string;
	transactionId: string;
	runtimeHadCurrent?: boolean;
	versionModuleHadCurrent?: boolean;
	committed?: boolean;
	markerJournalSha256?: string;
}) {
	const journalPath = `${targetDir}.publication-journal.v1.json`;
	const journalSource = `${JSON.stringify({
		format: publicationJournalFormat,
		transactionId,
		targetDir,
		versionModulePath,
		hadCurrent: {
			runtime: runtimeHadCurrent,
			versionModule: versionModuleHadCurrent
		},
		expected: publicationExpected('new', 'new version')
	})}\n`;
	await writeFile(journalPath, journalSource, 'utf8');
	if (committed) {
		await writeFile(
			`${journalPath}.committed`,
			`${JSON.stringify({
				format: publicationCommitFormat,
				transactionId,
				journalSha256: markerJournalSha256 ?? sha256(journalSource)
			})}\n`,
			'utf8'
		);
	}
	return journalPath;
}

async function writeInputLock(
	contents = sourceText,
	overrides: { profileId?: string; packageVersion?: string; bytes?: number; sha256?: string } = {}
) {
	const bytes = Buffer.from(contents, 'utf8');
	const packageVersion = overrides.packageVersion ?? '1.2.3';
	const lockFilePath = path.join(await makeTempDir(), 'wasm-forth-assets.lock.json');
	await writeFile(
		lockFilePath,
		`${JSON.stringify(
			{
				schemaVersion: 1,
				profileId: overrides.profileId ?? `waforth-${packageVersion}`,
				upstream: {
					packageName: 'waforth',
					packageVersion,
					assetPath: 'dist/index.js',
					bytes: overrides.bytes ?? bytes.byteLength,
					sha256: overrides.sha256 ?? sha256(bytes)
				}
			},
			null,
			'\t'
		)}\n`,
		'utf8'
	);
	return lockFilePath;
}

async function createFixture() {
	const sourceFile = await writeFixtureFile(await makeTempDir(), 'index.js', sourceText);
	const workerSourcePath = await writeFixtureFile(
		await makeTempDir(),
		'runner-worker.js',
		workerText
	);
	return {
		sourceFile,
		workerSourcePath,
		lockFilePath: await writeInputLock()
	};
}

describe('syncWasmForthAssets', () => {
	afterEach(async () => {
		vi.restoreAllMocks();
		await Promise.all(
			tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
		);
	});

	it('rejects synchronization from a worker thread before creating state', async () => {
		const syncModuleUrl = pathToFileURL(path.resolve('scripts/sync-wasm-forth.mjs')).href;
		const result = await new Promise<{ name: string; message: string }>((resolve, reject) => {
			const worker = new Worker(
				`const { parentPort } = require('node:worker_threads');
void import(${JSON.stringify(syncModuleUrl)}).then(async ({ syncWasmForthAssets }) => {
  try {
    await syncWasmForthAssets();
  } catch (error) {
    parentPort.postMessage({ name: error.name, message: error.message });
  }
});`,
				{ eval: true }
			);
			worker.once('message', resolve);
			worker.once('error', reject);
		});

		expect(result).toEqual({
			name: 'Error',
			message: 'wasm-forth asset synchronization requires the main Node thread'
		});
	});

	it('pins the source and publishes deterministic manifest and worker receipts', async () => {
		const fixture = await createFixture();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmForthVersion.ts');
		await writeFixtureFile(targetDir, 'stale.js', 'stale');

		const result = await syncWasmForthAssets({
			...fixture,
			targetDir,
			versionModulePath
		});

		expect((await readdir(targetDir)).sort()).toEqual([
			'runner-worker.js',
			'runtime-manifest.v2.json',
			'waforth.js'
		]);
		const waforthBytes = await readFile(path.join(targetDir, 'waforth.js'));
		const workerBytes = await readFile(path.join(targetDir, 'runner-worker.js'));
		expect(waforthBytes.toString('utf8')).toContain('self.WAForthPackage = module.exports;');
		expect(workerBytes.toString('utf8')).toBe(workerText);

		const manifest = JSON.parse(
			await readFile(path.join(targetDir, 'runtime-manifest.v2.json'), 'utf8')
		) as {
			format: string;
			profileId: string;
			waforthVersion: string;
			fingerprint: string;
			assets: Array<{ path: string; size: number; sha256: string }>;
		};
		expect(manifest).toMatchObject({
			format: FORTH_MANIFEST_FORMAT,
			profileId: 'waforth-1.2.3',
			waforthVersion: '1.2.3',
			fingerprint: result.fingerprint,
			assets: [
				{
					path: 'waforth.js',
					size: waforthBytes.byteLength,
					sha256: sha256(waforthBytes)
				}
			]
		});
		expect(result.workerReceipt).toEqual({
			bytes: workerBytes.byteLength,
			sha256: sha256(workerBytes)
		});
		await expect(readFile(versionModulePath, 'utf8')).resolves.toBe(
			`export const WASM_FORTH_ASSET_VERSION =\n\t'${result.fingerprint}';\nexport const WASM_FORTH_RUNNER_RECEIPT = {\n\tbytes: ${workerBytes.byteLength},\n\tsha256: '${sha256(workerBytes)}'\n} as const;\n`
		);
	});

	it('reproduces the same fingerprint and bytes from the same pinned inputs', async () => {
		const fixture = await createFixture();
		const firstTarget = await makeTempDir();
		const secondTarget = await makeTempDir();
		const firstVersion = path.join(await makeTempDir(), 'first.ts');
		const secondVersion = path.join(await makeTempDir(), 'second.ts');

		const first = await syncWasmForthAssets({
			...fixture,
			targetDir: firstTarget,
			versionModulePath: firstVersion
		});
		const second = await syncWasmForthAssets({
			...fixture,
			targetDir: secondTarget,
			versionModulePath: secondVersion
		});

		expect(second.fingerprint).toBe(first.fingerprint);
		for (const file of await readdir(firstTarget)) {
			await expect(readFile(path.join(secondTarget, file))).resolves.toEqual(
				await readFile(path.join(firstTarget, file))
			);
		}
		await expect(readFile(secondVersion, 'utf8')).resolves.toBe(
			await readFile(firstVersion, 'utf8')
		);
	});

	it('uses an adjacent generated version module for a custom target', async () => {
		const fixture = await createFixture();
		const targetDir = path.join(await makeTempDir(), 'runtime');

		const result = await syncWasmForthAssets({ ...fixture, targetDir });

		expect(result.versionModulePath).toBe(`${targetDir}.version.ts`);
		await expect(readFile(result.versionModulePath, 'utf8')).resolves.toContain(
			'WASM_FORTH_RUNNER_RECEIPT'
		);
	});

	it('rejects mismatched and malformed source bundles before replacing outputs', async () => {
		const fixture = await createFixture();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'version.ts');
		await writeFixtureFile(targetDir, 'existing.txt', 'old runtime');
		await writeFile(versionModulePath, 'old version', 'utf8');
		await writeFile(fixture.sourceFile, `${sourceText}// changed\n`, 'utf8');

		await expect(
			syncWasmForthAssets({ ...fixture, targetDir, versionModulePath })
		).rejects.toThrow('does not match its pinned receipt');
		await expect(readFile(path.join(targetDir, 'existing.txt'), 'utf8')).resolves.toBe(
			'old runtime'
		);
		await expect(readFile(versionModulePath, 'utf8')).resolves.toBe('old version');

		const malformed = 'module.exports = {};\n';
		await writeFile(fixture.sourceFile, malformed, 'utf8');
		const malformedLock = await writeInputLock(malformed);
		await expect(
			syncWasmForthAssets({
				...fixture,
				lockFilePath: malformedLock,
				targetDir,
				versionModulePath
			})
		).rejects.toThrow('does not look like the expected WebAssembly runtime');
	});

	it('rejects symlink inputs and destructive output overlap', async () => {
		const fixture = await createFixture();
		const sourceLink = path.join(await makeTempDir(), 'source-link.js');
		await symlink(fixture.sourceFile, sourceLink);

		await expect(
			syncWasmForthAssets({
				...fixture,
				sourceFile: sourceLink,
				targetDir: await makeTempDir()
			})
		).rejects.toThrow('must be a regular file');
		await expect(
			syncWasmForthAssets({
				...fixture,
				targetDir: path.dirname(fixture.sourceFile),
				versionModulePath: path.join(await makeTempDir(), 'version.ts')
			})
		).rejects.toThrow('source bundle and runtime target must not overlap');
		await expect(
			syncWasmForthAssets({
				...fixture,
				targetDir: await makeTempDir(),
				versionModulePath: fixture.lockFilePath
			})
		).rejects.toThrow('input lock and version module must not overlap');
	});

	it('rolls both outputs back when version publication fails', async () => {
		const fixture = await createFixture();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'version.ts');
		await writeFixtureFile(targetDir, 'existing.txt', 'old runtime');
		await writeFile(versionModulePath, 'old version', 'utf8');
		const journalPath = `${targetDir}.publication-journal.v1.json`;
		const renamePath = vi.fn(async (source: string, target: string) => {
			if (target === versionModulePath && source.includes('.next-')) {
				const journal = JSON.parse(await readFile(journalPath, 'utf8')) as {
					format: string;
					targetDir: string;
					versionModulePath: string;
				};
				expect(journal).toMatchObject({
					format: publicationJournalFormat,
					targetDir,
					versionModulePath
				});
				throw new Error('injected version publication failure');
			}
			await rename(source, target);
		});

		await expect(
			syncWasmForthAssets({
				...fixture,
				targetDir,
				versionModulePath,
				renamePath
			})
		).rejects.toThrow('injected version publication failure');
		await expect(readFile(path.join(targetDir, 'existing.txt'), 'utf8')).resolves.toBe(
			'old runtime'
		);
		await expect(readFile(versionModulePath, 'utf8')).resolves.toBe('old version');
		expect(await pathExists(journalPath)).toBe(false);
		expect(await pathExists(`${journalPath}.committed`)).toBe(false);
	});

	it('recovers an interrupted runtime publication before validating new inputs', async () => {
		const fixture = await createFixture();
		const root = await makeTempDir();
		const targetDir = path.join(root, 'runtime');
		const versionModulePath = path.join(root, 'wasmForthVersion.ts');
		const transactionId = '123-00000000-0000-4000-8000-000000000001';
		const previousTargetDir = `${targetDir}.previous-${transactionId}`;
		const nextVersionModulePath = `${versionModulePath}.next-${transactionId}`;
		const journalPath = `${targetDir}.publication-journal.v1.json`;

		await writeRuntimeGeneration(previousTargetDir, 'old');
		await writeRuntimeGeneration(targetDir, 'new');
		await writeFile(versionModulePath, 'old version', 'utf8');
		await writeFile(nextVersionModulePath, 'new version', 'utf8');
		await writePublicationJournal({ targetDir, versionModulePath, transactionId });
		await rm(fixture.sourceFile, { force: true });
		await rm(fixture.workerSourcePath, { force: true });

		await expect(
			syncWasmForthAssets({ ...fixture, targetDir, versionModulePath })
		).rejects.toThrow('bundle must be a regular file');
		await expect(readFile(path.join(targetDir, 'waforth.js'), 'utf8')).resolves.toBe(
			'old:waforth'
		);
		await expect(readFile(versionModulePath, 'utf8')).resolves.toBe('old version');
		expect(await pathExists(previousTargetDir)).toBe(false);
		expect(await pathExists(nextVersionModulePath)).toBe(false);
		expect(await pathExists(journalPath)).toBe(false);
	});

	it('recovers an interrupted publication before resolving a looping source path', async () => {
		const fixture = await createFixture();
		const root = await makeTempDir();
		const targetDir = path.join(root, 'runtime');
		const versionModulePath = path.join(root, 'wasmForthVersion.ts');
		const sourceLoopPath = path.join(root, 'source-loop.js');
		const transactionId = '123-00000000-0000-4000-8000-000000000007';
		const previousTargetDir = `${targetDir}.previous-${transactionId}`;
		const nextVersionModulePath = `${versionModulePath}.next-${transactionId}`;
		const journalPath = `${targetDir}.publication-journal.v1.json`;

		await writeRuntimeGeneration(previousTargetDir, 'old');
		await writeRuntimeGeneration(targetDir, 'new');
		await writeFile(versionModulePath, 'old version', 'utf8');
		await writeFile(nextVersionModulePath, 'new version', 'utf8');
		await writePublicationJournal({ targetDir, versionModulePath, transactionId });
		await symlink(path.basename(sourceLoopPath), sourceLoopPath);

		await expect(
			syncWasmForthAssets({
				...fixture,
				sourceFile: sourceLoopPath,
				targetDir,
				versionModulePath
			})
		).rejects.toMatchObject({ code: 'ELOOP' });
		await expect(readFile(path.join(targetDir, 'waforth.js'), 'utf8')).resolves.toBe(
			'old:waforth'
		);
		await expect(readFile(versionModulePath, 'utf8')).resolves.toBe('old version');
		expect(await pathExists(previousTargetDir)).toBe(false);
		expect(await pathExists(nextVersionModulePath)).toBe(false);
		expect(await pathExists(journalPath)).toBe(false);
		expect(await publicationTicketNames(root, targetDir)).toEqual([]);
	});

	it('removes bounded staging residue left before a journal was published', async () => {
		const fixture = await createFixture();
		const root = await makeTempDir();
		const targetDir = path.join(root, 'runtime');
		const versionModulePath = path.join(root, 'wasmForthVersion.ts');
		const transactionId = '123-00000000-0000-4000-8000-000000000008';
		const journalPath = `${targetDir}.publication-journal.v1.json`;
		const paths = [
			`${targetDir}.next-${transactionId}`,
			`${versionModulePath}.next-${transactionId}`,
			`${journalPath}.next-${transactionId}`,
			`${journalPath}.committed.next-${transactionId}`
		];
		await mkdir(paths[0], { recursive: true });
		await writeFile(path.join(paths[0], 'partial'), 'partial runtime', 'utf8');
		await Promise.all(paths.slice(1).map((stagingPath) => writeFile(stagingPath, 'partial')));
		await rm(fixture.sourceFile, { force: true });

		await expect(
			syncWasmForthAssets({ ...fixture, targetDir, versionModulePath })
		).rejects.toThrow('bundle must be a regular file');
		for (const stagingPath of paths) expect(await pathExists(stagingPath)).toBe(false);
		expect(await publicationTicketNames(root, targetDir)).toEqual([]);
	});

	it('does not reclaim a stale publication ticket used as a configured input', async () => {
		const fixture = await createFixture();
		const root = await makeTempDir();
		const targetDir = path.join(root, 'runtime');
		const versionModulePath = path.join(root, 'wasmForthVersion.ts');
		const sourceFile = `${targetDir}.publication-journal.v1.json.lock-2147483647-00000000-0000-4000-8000-000000000013`;
		await writeFile(sourceFile, sourceText, 'utf8');

		await expect(
			syncWasmForthAssets({
				...fixture,
				sourceFile,
				targetDir,
				versionModulePath
			})
		).rejects.toThrow('configured input overlaps a stale publication lock');
		await expect(readFile(sourceFile, 'utf8')).resolves.toBe(sourceText);
		expect(await pathExists(targetDir)).toBe(false);
		expect(await publicationTicketNames(root, targetDir)).toEqual([path.basename(sourceFile)]);
	});

	it('does not remove an orphan commit marker used as a configured input', async () => {
		const fixture = await createFixture();
		const root = await makeTempDir();
		const targetDir = path.join(root, 'runtime');
		const versionModulePath = path.join(root, 'wasmForthVersion.ts');
		const sourceFile = `${targetDir}.publication-journal.v1.json.committed`;
		await writeFile(sourceFile, sourceText, 'utf8');

		await expect(
			syncWasmForthAssets({
				...fixture,
				sourceFile,
				targetDir,
				versionModulePath
			})
		).rejects.toThrow('configured input overlaps an orphan publication commit marker');
		await expect(readFile(sourceFile, 'utf8')).resolves.toBe(sourceText);
		expect(await pathExists(targetDir)).toBe(false);
		expect(await publicationTicketNames(root, targetDir)).toEqual([]);
	});

	it('does not delete a configured source nested in orphan staging', async () => {
		const fixture = await createFixture();
		const root = await makeTempDir();
		const targetDir = path.join(root, 'runtime');
		const versionModulePath = path.join(root, 'wasmForthVersion.ts');
		const transactionId = '123-00000000-0000-4000-8000-000000000011';
		const stagedTargetDir = `${targetDir}.next-${transactionId}`;
		const stagedSourcePath = await writeFixtureFile(stagedTargetDir, 'source.js', sourceText);

		await expect(
			syncWasmForthAssets({
				...fixture,
				sourceFile: stagedSourcePath,
				targetDir,
				versionModulePath
			})
		).rejects.toThrow('configured input overlaps publication staging');
		await expect(readFile(stagedSourcePath, 'utf8')).resolves.toBe(sourceText);
		expect(await publicationTicketNames(root, targetDir)).toEqual([]);
	});

	it('does not recover through canonical aliases into transaction state', async () => {
		const fixture = await createFixture();
		const root = await makeTempDir();
		const realOutputDir = path.join(root, 'real-output');
		const outputAliasDir = path.join(root, 'output-alias');
		await mkdir(realOutputDir, { recursive: true });
		await symlink(realOutputDir, outputAliasDir, 'dir');
		const targetDir = path.join(outputAliasDir, 'runtime');
		const versionModulePath = path.join(outputAliasDir, 'wasmForthVersion.ts');
		const transactionId = '123-00000000-0000-4000-8000-000000000012';
		const previousTargetDir = `${targetDir}.previous-${transactionId}`;
		const realPreviousTargetDir = path.join(realOutputDir, `runtime.previous-${transactionId}`);
		const nextVersionModulePath = `${versionModulePath}.next-${transactionId}`;
		const stagedSourcePath = await writeFixtureFile(previousTargetDir, 'source.js', sourceText);
		const sourceAliasDir = path.join(root, 'source-alias');
		await symlink(realPreviousTargetDir, sourceAliasDir, 'dir');
		const aliasedSourcePath = path.join(sourceAliasDir, 'source.js');
		await writeRuntimeGeneration(previousTargetDir, 'old');
		await writeRuntimeGeneration(targetDir, 'new');
		await writeFile(versionModulePath, 'old version', 'utf8');
		await writeFile(nextVersionModulePath, 'new version', 'utf8');
		const journalPath = await writePublicationJournal({
			targetDir,
			versionModulePath,
			transactionId
		});

		await expect(
			syncWasmForthAssets({
				...fixture,
				sourceFile: aliasedSourcePath,
				targetDir,
				versionModulePath
			})
		).rejects.toThrow('configured input overlaps publication recovery state');
		await expect(readFile(stagedSourcePath, 'utf8')).resolves.toBe(sourceText);
		await expect(readFile(path.join(targetDir, 'waforth.js'), 'utf8')).resolves.toBe(
			'new:waforth'
		);
		expect(await pathExists(journalPath)).toBe(true);
		expect(await publicationTicketNames(realOutputDir, targetDir)).toEqual([]);
	});

	it('recovers the journal and stale lock left by a terminated producer process', async () => {
		const fixture = await createFixture();
		const root = await makeTempDir();
		const targetDir = path.join(root, 'runtime');
		const versionModulePath = path.join(root, 'wasmForthVersion.ts');
		const childScriptPath = path.join(root, 'interrupt-publication.mjs');
		const syncModuleUrl = pathToFileURL(path.resolve('scripts/sync-wasm-forth.mjs')).href;
		await writeFixtureFile(targetDir, 'existing.txt', 'old runtime');
		await writeFile(versionModulePath, 'old version', 'utf8');
		await writeFile(
			childScriptPath,
			`import { rename } from 'node:fs/promises';
import { syncWasmForthAssets } from ${JSON.stringify(syncModuleUrl)};
await syncWasmForthAssets({
  sourceFile: ${JSON.stringify(fixture.sourceFile)},
  workerSourcePath: ${JSON.stringify(fixture.workerSourcePath)},
  lockFilePath: ${JSON.stringify(fixture.lockFilePath)},
  targetDir: ${JSON.stringify(targetDir)},
  versionModulePath: ${JSON.stringify(versionModulePath)},
  renamePath: async (source, target) => {
    await rename(source, target);
    if (target === ${JSON.stringify(targetDir)} && source.includes('.next-')) process.exit(86);
  }
});
`,
			'utf8'
		);

		const childResult = await new Promise<{ code: number | null; stderr: string }>(
			(resolve, reject) => {
				const child = spawn(process.execPath, [childScriptPath], {
					stdio: ['ignore', 'ignore', 'pipe']
				});
				let stderr = '';
				child.stderr.setEncoding('utf8');
				child.stderr.on('data', (chunk: string) => {
					stderr += chunk;
				});
				child.once('error', reject);
				child.once('close', (code) => resolve({ code, stderr }));
			}
		);
		expect(childResult).toEqual({ code: 86, stderr: '' });
		const journalPath = `${targetDir}.publication-journal.v1.json`;
		expect(await pathExists(journalPath)).toBe(true);
		expect(await publicationTicketNames(root, targetDir)).toHaveLength(1);
		await rm(fixture.sourceFile, { force: true });

		await expect(
			syncWasmForthAssets({ ...fixture, targetDir, versionModulePath })
		).rejects.toThrow('bundle must be a regular file');
		await expect(readFile(path.join(targetDir, 'existing.txt'), 'utf8')).resolves.toBe(
			'old runtime'
		);
		await expect(readFile(versionModulePath, 'utf8')).resolves.toBe('old version');
		expect(await pathExists(journalPath)).toBe(false);
		expect(await publicationTicketNames(root, targetDir)).toEqual([]);
	});

	it('finalizes a committed publication before validating new inputs', async () => {
		const fixture = await createFixture();
		const root = await makeTempDir();
		const targetDir = path.join(root, 'runtime');
		const versionModulePath = path.join(root, 'wasmForthVersion.ts');
		const transactionId = '123-00000000-0000-4000-8000-000000000002';
		const previousTargetDir = `${targetDir}.previous-${transactionId}`;
		const previousVersionModulePath = `${versionModulePath}.previous-${transactionId}`;
		const journalPath = await writePublicationJournal({
			targetDir,
			versionModulePath,
			transactionId,
			committed: true
		});

		await writeRuntimeGeneration(previousTargetDir, 'old');
		await writeRuntimeGeneration(targetDir, 'new');
		await writeFile(previousVersionModulePath, 'old version', 'utf8');
		await writeFile(versionModulePath, 'new version', 'utf8');
		await writeFile(fixture.sourceFile, `${sourceText}// receipt mismatch\n`, 'utf8');

		await expect(
			syncWasmForthAssets({ ...fixture, targetDir, versionModulePath })
		).rejects.toThrow('does not match its pinned receipt');
		await expect(readFile(path.join(targetDir, 'waforth.js'), 'utf8')).resolves.toBe(
			'new:waforth'
		);
		await expect(readFile(versionModulePath, 'utf8')).resolves.toBe('new version');
		expect(await pathExists(previousTargetDir)).toBe(false);
		expect(await pathExists(previousVersionModulePath)).toBe(false);
		expect(await pathExists(journalPath)).toBe(false);
		expect(await pathExists(`${journalPath}.committed`)).toBe(false);
	});

	it('treats a marker from another transaction as uncommitted', async () => {
		const fixture = await createFixture();
		const root = await makeTempDir();
		const targetDir = path.join(root, 'runtime');
		const versionModulePath = path.join(root, 'wasmForthVersion.ts');
		const transactionId = '123-00000000-0000-4000-8000-000000000003';
		const previousTargetDir = `${targetDir}.previous-${transactionId}`;
		const nextVersionModulePath = `${versionModulePath}.next-${transactionId}`;

		await writeRuntimeGeneration(previousTargetDir, 'old');
		await writeRuntimeGeneration(targetDir, 'new');
		await writeFile(versionModulePath, 'old version', 'utf8');
		await writeFile(nextVersionModulePath, 'new version', 'utf8');
		const journalPath = await writePublicationJournal({
			targetDir,
			versionModulePath,
			transactionId,
			committed: true,
			markerJournalSha256: 'f'.repeat(64)
		});
		await rm(fixture.sourceFile, { force: true });

		await expect(
			syncWasmForthAssets({ ...fixture, targetDir, versionModulePath })
		).rejects.toThrow('bundle must be a regular file');
		await expect(readFile(path.join(targetDir, 'waforth.js'), 'utf8')).resolves.toBe(
			'old:waforth'
		);
		await expect(readFile(versionModulePath, 'utf8')).resolves.toBe('old version');
		expect(await pathExists(journalPath)).toBe(false);
		expect(await pathExists(`${journalPath}.committed`)).toBe(false);
	});

	it('retains last-good backups when committed outputs fail their journal receipts', async () => {
		const fixture = await createFixture();
		const root = await makeTempDir();
		const targetDir = path.join(root, 'runtime');
		const versionModulePath = path.join(root, 'wasmForthVersion.ts');
		const transactionId = '123-00000000-0000-4000-8000-000000000004';
		const previousTargetDir = `${targetDir}.previous-${transactionId}`;
		const previousVersionModulePath = `${versionModulePath}.previous-${transactionId}`;

		await writeRuntimeGeneration(previousTargetDir, 'old');
		await writeRuntimeGeneration(targetDir, 'new');
		await writeFile(previousVersionModulePath, 'old version', 'utf8');
		await writeFile(versionModulePath, 'new version', 'utf8');
		const journalPath = await writePublicationJournal({
			targetDir,
			versionModulePath,
			transactionId,
			committed: true
		});
		await writeFile(path.join(targetDir, 'waforth.js'), 'tampered', 'utf8');

		await expect(
			syncWasmForthAssets({ ...fixture, targetDir, versionModulePath })
		).rejects.toThrow('does not match its pinned receipt');
		await expect(readFile(path.join(previousTargetDir, 'waforth.js'), 'utf8')).resolves.toBe(
			'old:waforth'
		);
		await expect(readFile(previousVersionModulePath, 'utf8')).resolves.toBe('old version');
		expect(await pathExists(journalPath)).toBe(true);
		expect(await pathExists(`${journalPath}.committed`)).toBe(true);
	});

	it('serializes publication while the first transaction is between output renames', async () => {
		const fixture = await createFixture();
		const root = await makeTempDir();
		const targetDir = path.join(root, 'runtime');
		const versionModulePath = path.join(root, 'wasmForthVersion.ts');
		let enterCriticalSection!: () => void;
		let leaveCriticalSection!: () => void;
		const entered = new Promise<void>((resolve) => {
			enterCriticalSection = resolve;
		});
		const released = new Promise<void>((resolve) => {
			leaveCriticalSection = resolve;
		});
		const renamePath = vi.fn(async (source: string, target: string) => {
			await rename(source, target);
			if (target === targetDir && source.includes('.next-')) {
				enterCriticalSection();
				await released;
			}
		});

		const first = syncWasmForthAssets({
			...fixture,
			targetDir,
			versionModulePath,
			renamePath
		});
		await entered;
		await expect(
			syncWasmForthAssets({ ...fixture, targetDir, versionModulePath })
		).rejects.toThrow('publication is already active');
		leaveCriticalSection();
		await expect(first).resolves.toMatchObject({ targetDir, versionModulePath });
		expect(await publicationTicketNames(root, targetDir)).toEqual([]);
	});

	it('reclaims a publication lock whose owner process no longer exists', async () => {
		const fixture = await createFixture();
		const root = await makeTempDir();
		const targetDir = path.join(root, 'runtime');
		const versionModulePath = path.join(root, 'wasmForthVersion.ts');
		const lockPath = `${targetDir}.publication-journal.v1.json.lock-2147483647-00000000-0000-4000-8000-000000000005`;
		await writeFile(lockPath, '', 'utf8');

		await expect(
			syncWasmForthAssets({ ...fixture, targetDir, versionModulePath })
		).resolves.toMatchObject({ targetDir, versionModulePath });
		expect(await pathExists(lockPath)).toBe(false);
		expect(await publicationTicketNames(root, targetDir)).toEqual([]);
	});

	it('never admits two contenders that reclaim the same stale ticket', async () => {
		const fixture = await createFixture();
		const root = await makeTempDir();
		const targetDir = path.join(root, 'runtime');
		const versionModulePath = path.join(root, 'wasmForthVersion.ts');
		const staleTicketPath = `${targetDir}.publication-journal.v1.json.lock-2147483647-00000000-0000-4000-8000-000000000006`;
		await writeFile(staleTicketPath, '', 'utf8');
		let arrivals = 0;
		let releaseTickets!: () => void;
		const ticketsCreated = new Promise<void>((resolve) => {
			releaseTickets = resolve;
		});
		const onPublicationTicketCreated = async () => {
			arrivals += 1;
			if (arrivals === 2) releaseTickets();
			await ticketsCreated;
		};
		let publicationsInProgress = 0;
		let maximumConcurrentPublications = 0;
		const renamePath = async (source: string, target: string) => {
			await rename(source, target);
			if (target === targetDir && source.includes('.next-')) {
				publicationsInProgress += 1;
				maximumConcurrentPublications = Math.max(
					maximumConcurrentPublications,
					publicationsInProgress
				);
				await new Promise<void>((resolve) => setImmediate(resolve));
				publicationsInProgress -= 1;
			}
		};
		const contenderOptions: NonNullable<Parameters<typeof syncWasmForthAssets>[0]> & {
			onPublicationTicketCreated: (ticketPath: string) => Promise<void>;
		} = {
			...fixture,
			targetDir,
			versionModulePath,
			renamePath,
			onPublicationTicketCreated
		};

		const results = await Promise.allSettled([
			syncWasmForthAssets(contenderOptions),
			syncWasmForthAssets(contenderOptions)
		]);

		expect(results.filter(({ status }) => status === 'fulfilled').length).toBeLessThanOrEqual(
			1
		);
		for (const result of results) {
			if (result.status === 'rejected') {
				expect(result.reason).toBeInstanceOf(Error);
				expect((result.reason as Error).message).toContain('publication is already active');
			}
		}
		expect(maximumConcurrentPublications).toBeLessThanOrEqual(1);
		expect(await pathExists(staleTicketPath)).toBe(false);
		expect(await publicationTicketNames(root, targetDir)).toEqual([]);
		await expect(
			syncWasmForthAssets({ ...fixture, targetDir, versionModulePath })
		).resolves.toMatchObject({ targetDir, versionModulePath });
	});

	it('blocks malformed and live publication tickets before output mutation', async () => {
		const fixture = await createFixture();
		const root = await makeTempDir();
		const targetDir = path.join(root, 'runtime');
		const versionModulePath = path.join(root, 'wasmForthVersion.ts');
		const lockPrefix = `${targetDir}.publication-journal.v1.json.lock-`;
		const malformedTicketPath = `${lockPrefix}malformed`;
		await writeFile(malformedTicketPath, '', 'utf8');

		await expect(
			syncWasmForthAssets({ ...fixture, targetDir, versionModulePath })
		).rejects.toThrow('invalid ticket name');
		expect(await pathExists(targetDir)).toBe(false);
		expect(await pathExists(malformedTicketPath)).toBe(true);
		await rm(malformedTicketPath, { force: true });

		const unsafeTicketPath = `${lockPrefix}2147483647-00000000-0000-4000-8000-000000000010`;
		await symlink(fixture.sourceFile, unsafeTicketPath);
		await expect(
			syncWasmForthAssets({ ...fixture, targetDir, versionModulePath })
		).rejects.toThrow('publication lock has an unsafe type');
		expect(await pathExists(targetDir)).toBe(false);
		expect(await pathExists(unsafeTicketPath)).toBe(true);
		await rm(unsafeTicketPath, { force: true });

		const liveTicketPath = `${lockPrefix}${process.pid}-00000000-0000-4000-8000-000000000009`;
		await writeFile(liveTicketPath, '', 'utf8');
		await expect(
			syncWasmForthAssets({ ...fixture, targetDir, versionModulePath })
		).rejects.toThrow(`publication is already active in process ${process.pid}`);
		expect(await pathExists(targetDir)).toBe(false);
		expect(await pathExists(liveTicketPath)).toBe(true);
		await rm(liveTicketPath, { force: true });
		expect(await publicationTicketNames(root, targetDir)).toEqual([]);
	});

	it('rejects malformed input lock metadata and unsafe existing output types', async () => {
		const fixture = await createFixture();
		const mismatchedProfile = await writeInputLock(sourceText, {
			profileId: 'waforth-other'
		});
		await expect(
			syncWasmForthAssets({
				...fixture,
				lockFilePath: mismatchedProfile,
				targetDir: await makeTempDir()
			})
		).rejects.toThrow('profile does not match the package version');

		const targetFile = path.join(await makeTempDir(), 'runtime');
		await writeFile(targetFile, 'do not replace', 'utf8');
		await expect(syncWasmForthAssets({ ...fixture, targetDir: targetFile })).rejects.toThrow(
			'runtime target must be a directory'
		);
		await expect(readFile(targetFile, 'utf8')).resolves.toBe('do not replace');
	});
});
