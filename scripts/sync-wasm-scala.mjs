import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const assetDir = path.join(projectRoot, 'static', 'wasm-scala');
const bridgeSourceDir = path.join(__dirname, 'scala-bridge', 'src');
const bridgeBuildDir = path.join(projectRoot, '.tmp', 'wasm-scala-bridge');
const scalaVersion = '2.13.18';
const bridgeMainClass = 'org.wasmidle.scala.Bridge';

const artifacts = [
	{
		name: `scala-library-${scalaVersion}.jar`,
		url: `https://repo1.maven.org/maven2/org/scala-lang/scala-library/${scalaVersion}/scala-library-${scalaVersion}.jar`
	},
	{
		name: `scala-reflect-${scalaVersion}.jar`,
		url: `https://repo1.maven.org/maven2/org/scala-lang/scala-reflect/${scalaVersion}/scala-reflect-${scalaVersion}.jar`
	},
	{
		name: `scala-compiler-${scalaVersion}.jar`,
		url: `https://repo1.maven.org/maven2/org/scala-lang/scala-compiler/${scalaVersion}/scala-compiler-${scalaVersion}.jar`
	}
];

async function downloadArtifact(artifact) {
	const outputPath = path.join(assetDir, artifact.name);
	if (existsSync(outputPath)) return;
	const response = await fetch(artifact.url);
	if (!response.ok) {
		throw new Error(`failed to download ${artifact.url}: ${response.status}`);
	}
	await writeFile(outputPath, new Uint8Array(await response.arrayBuffer()));
}

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: projectRoot,
		stdio: 'inherit',
		...options
	});
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(' ')} failed with ${result.status}`);
	}
}

async function sha256(filePath) {
	const bytes = await readFile(filePath);
	return createHash('sha256').update(bytes).digest('hex');
}

async function buildBridge() {
	await rm(bridgeBuildDir, { force: true, recursive: true });
	const classesDir = path.join(bridgeBuildDir, 'classes');
	await mkdir(classesDir, { recursive: true });
	const sourceFile = path.join(bridgeSourceDir, 'org', 'wasmidle', 'scala', 'Bridge.java');
	run('javac', ['--release', '8', '-d', classesDir, sourceFile]);
	run('jar', [
		'--create',
		'--file',
		path.join(assetDir, 'wasm-idle-scala-bridge.jar'),
		'-C',
		classesDir,
		'.'
	]);
}

async function writeManifest() {
	const files = [...artifacts.map((artifact) => artifact.name), 'wasm-idle-scala-bridge.jar'];
	const manifest = {
		scalaVersion,
		bridgeMainClass,
		files: Object.fromEntries(
			await Promise.all(
				files.map(async (file) => [
					file,
					{
						sha256: await sha256(path.join(assetDir, file))
					}
				])
			)
		)
	};
	await writeFile(path.join(assetDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

await mkdir(assetDir, { recursive: true });
for (const artifact of artifacts) {
	await downloadArtifact(artifact);
}
await buildBridge();
await writeManifest();
await rm(bridgeBuildDir, { force: true, recursive: true });
