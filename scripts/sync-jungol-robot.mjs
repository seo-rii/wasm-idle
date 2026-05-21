#!/usr/bin/env node
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter, configure } from '@zip.js/zip.js';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_SOURCE_DIR = path.resolve(REPO_ROOT, 'runtimes', 'robot-jungol', 'jungol_robot');
const FIXED_ZIP_DATE = new Date(Date.UTC(2026, 1, 9, 0, 0, 0));
const PACKAGE_FILES = [
	'__init__.py',
	'agent.py',
	'assets.py',
	'beeper.py',
	'direction.py',
	'drawer.py',
	'helper.py',
	'image_output.py',
	'json_drawer.py',
	'logger.py',
	'marker.py',
	'piece.py',
	'pillow_drawer.py',
	'position.py',
	'robot.py',
	'wall.py',
	'world.py'
];

configure({ useWebWorkers: false });

async function assertFile(filePath) {
	const fileStats = await stat(filePath).catch(() => null);
	if (!fileStats?.isFile()) throw new Error(`Missing Jungol robot source file: ${filePath}`);
}

async function writePackageZip({ sourceDir, targetPath, packageName }) {
	const writer = new Uint8ArrayWriter();
	const zipWriter = new ZipWriter(writer, {
		bufferedWrite: true,
		dataDescriptor: false,
		extendedTimestamp: false,
		keepOrder: true,
		level: 9,
		useWebWorkers: false
	});

	for (const fileName of PACKAGE_FILES) {
		const sourcePath = path.join(sourceDir, fileName);
		await assertFile(sourcePath);
		const bytes = await readFile(sourcePath);
		await zipWriter.add(`${packageName}/${fileName}`, new Uint8ArrayReader(bytes), {
			dataDescriptor: false,
			extendedTimestamp: false,
			lastModDate: FIXED_ZIP_DATE,
			level: 9
		});
	}

	const data = await zipWriter.close();
	await mkdir(path.dirname(targetPath), { recursive: true });
	await writeFile(targetPath, data);
}

export async function syncJungolRobot({
	sourceDir = DEFAULT_SOURCE_DIR,
	jungolTargetPath = path.resolve(REPO_ROOT, 'static', 'jungol-robot', 'jungol_robot.zip'),
	robotTargetPath = path.resolve(REPO_ROOT, 'static', 'robot-jungol', 'robot_jungol.zip')
} = {}) {
	const sourceStats = await stat(sourceDir).catch(() => null);
	if (!sourceStats?.isDirectory()) {
		throw new Error(`Jungol robot source directory was not found at ${sourceDir}.`);
	}

	await writePackageZip({
		sourceDir,
		targetPath: jungolTargetPath,
		packageName: 'jungol_robot'
	});
	await writePackageZip({
		sourceDir,
		targetPath: robotTargetPath,
		packageName: 'robot_jungol'
	});

	return { sourceDir, jungolTargetPath, robotTargetPath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg] = process.argv;
	const result = await syncJungolRobot({
		sourceDir: sourceDirArg ? path.resolve(sourceDirArg) : DEFAULT_SOURCE_DIR
	});
	console.log(`Synced Jungol robot zips from ${result.sourceDir}`);
}
