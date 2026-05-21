import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const DEFAULT_TOOLCHAIN_ROOT =
	process.env.WASM_RUST_MATCHING_NATIVE_TOOLCHAIN_ROOT ||
	path.join(
		os.homedir(),
		'.cache',
		'wasm-rust-real-rustc-20260317',
		'rust',
		'build',
		'x86_64-unknown-linux-gnu',
		'stage2'
	);
const DEFAULT_SYSROOT_ROOT =
	process.env.WASM_RUST_MATCHING_NATIVE_SYSROOT_ROOT ||
	process.env.WASM_RUST_RUSTC_ROOT ||
	path.join(os.homedir(), '.cache', 'wasm-rust-real-rustc-20260317', 'rust', 'dist-emit-ir');
const SAMPLE_PROGRAM = process.env.WASM_RUST_SAMPLE_PROGRAM || 'fn main() { println!("hi"); }\n';
const TARGET_TRIPLES = [...new Set(
	(process.env.WASM_RUST_NATIVE_TARGET_TRIPLES || 'wasm32-wasip1,wasm32-wasip2')
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean)
)];

async function pathExists(targetPath) {
	try {
		await fs.access(targetPath);
		return true;
	} catch {
		return false;
	}
}

async function captureLinkRecipe(toolchainRoot, sysrootRoot, targetTriple) {
	const tempDir = await fs.mkdtemp(
		path.join(os.tmpdir(), `wasm-rust-native-link-${targetTriple.replaceAll('-', '_')}-`)
	);
	const sourcePath = path.join(tempDir, 'main.rs');
	const linkerPath = path.join(tempDir, 'linker-wrapper.sh');
	const argsPath = path.join(tempDir, 'linker-args.txt');
	const outputPath = path.join(tempDir, 'main.wasm');
	const rustcPath = path.join(toolchainRoot, 'bin', 'rustc');

	await fs.writeFile(sourcePath, SAMPLE_PROGRAM);
	await fs.writeFile(
		linkerPath,
		[
			'#!/usr/bin/env bash',
			`printf '%s\\n' "$@" > ${JSON.stringify(argsPath)}`,
			'exit 1',
			''
		].join('\n')
	);
	await fs.chmod(linkerPath, 0o755);

	try {
		execFileSync(
			rustcPath,
			[
				'--sysroot',
				sysrootRoot,
				'--target',
				targetTriple,
				'-Clinker=' + linkerPath,
				'-Cpanic=abort',
				'-Ccodegen-units=1',
				'-Csave-temps',
				sourcePath,
				'-o',
				outputPath
			],
			{ stdio: 'ignore' }
		);
	} catch {
		if (!(await pathExists(argsPath))) {
			throw new Error(
				`rustc did not reach the linker wrapper for ${targetTriple}; missing sysroot or linker prerequisites`
			);
		}
	}

	return {
		targetTriple,
		tempDir,
		objectFiles: (await fs.readdir(tempDir)).filter((entry) => entry.endsWith('.o')).sort(),
		linkerArgs: (await fs.readFile(argsPath, 'utf8'))
			.trim()
			.split('\n')
			.filter(Boolean)
	};
}

async function main() {
	const results = [];
	for (const targetTriple of TARGET_TRIPLES) {
		try {
			results.push({
				success: true,
				...(await captureLinkRecipe(DEFAULT_TOOLCHAIN_ROOT, DEFAULT_SYSROOT_ROOT, targetTriple))
			});
		} catch (error) {
			results.push({
				success: false,
				targetTriple,
				message: error instanceof Error ? error.message : String(error)
			});
		}
	}

	console.log(
		JSON.stringify(
			{
				success: results.every((entry) => entry.success),
				toolchainRoot: DEFAULT_TOOLCHAIN_ROOT,
				sysrootRoot: DEFAULT_SYSROOT_ROOT,
				targets: results
			},
			null,
			2
		)
	);
	if (!results.every((entry) => entry.success)) {
		process.exitCode = 1;
	}
}

await main();
