import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const assetDir = path.join(projectRoot, 'static', 'wasm-kotlin');
const bridgeSourceDir = path.join(__dirname, 'kotlin-bridge', 'src');
const bridgeBuildDir = path.join(projectRoot, '.tmp', 'wasm-kotlin-bridge');
const kotlinVersion = '2.3.21';
const kotlinReflectVersion = '1.6.10';
const kotlinxCoroutinesVersion = '1.8.0';
const jetbrainsAnnotationsVersion = '13.0';
const bridgeMainClass = 'org.wasmidle.kotlin.Bridge';

const mavenCentral = 'https://repo.maven.apache.org/maven2';

const artifacts = [
	{
		name: `kotlin-compiler-embeddable-${kotlinVersion}.jar`,
		url: `${mavenCentral}/org/jetbrains/kotlin/kotlin-compiler-embeddable/${kotlinVersion}/kotlin-compiler-embeddable-${kotlinVersion}.jar`
	},
	{
		name: `kotlin-stdlib-${kotlinVersion}.jar`,
		url: `${mavenCentral}/org/jetbrains/kotlin/kotlin-stdlib/${kotlinVersion}/kotlin-stdlib-${kotlinVersion}.jar`
	},
	{
		name: `kotlin-script-runtime-${kotlinVersion}.jar`,
		url: `${mavenCentral}/org/jetbrains/kotlin/kotlin-script-runtime/${kotlinVersion}/kotlin-script-runtime-${kotlinVersion}.jar`
	},
	{
		name: `kotlin-reflect-${kotlinReflectVersion}.jar`,
		url: `${mavenCentral}/org/jetbrains/kotlin/kotlin-reflect/${kotlinReflectVersion}/kotlin-reflect-${kotlinReflectVersion}.jar`
	},
	{
		name: `kotlin-daemon-embeddable-${kotlinVersion}.jar`,
		url: `${mavenCentral}/org/jetbrains/kotlin/kotlin-daemon-embeddable/${kotlinVersion}/kotlin-daemon-embeddable-${kotlinVersion}.jar`
	},
	{
		name: `kotlinx-coroutines-core-jvm-${kotlinxCoroutinesVersion}.jar`,
		url: `${mavenCentral}/org/jetbrains/kotlinx/kotlinx-coroutines-core-jvm/${kotlinxCoroutinesVersion}/kotlinx-coroutines-core-jvm-${kotlinxCoroutinesVersion}.jar`
	},
	{
		name: `annotations-${jetbrainsAnnotationsVersion}.jar`,
		url: `${mavenCentral}/org/jetbrains/annotations/${jetbrainsAnnotationsVersion}/annotations-${jetbrainsAnnotationsVersion}.jar`
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
	const sourceFile = path.join(bridgeSourceDir, 'org', 'wasmidle', 'kotlin', 'Bridge.java');
	run('javac', ['--release', '8', '-d', classesDir, sourceFile]);
	run('jar', [
		'--create',
		'--file',
		path.join(assetDir, 'wasm-idle-kotlin-bridge.jar'),
		'-C',
		classesDir,
		'.'
	]);
}

async function writeManifest() {
	const files = [...artifacts.map((artifact) => artifact.name), 'wasm-idle-kotlin-bridge.jar'];
	const manifest = {
		kotlinVersion,
		kotlinReflectVersion,
		kotlinxCoroutinesVersion,
		jetbrainsAnnotationsVersion,
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
