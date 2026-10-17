#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '..');
const ASSET_VERIFIERS = new Set(['verify:page-c3', 'verify:page-lfortran', 'check:assets-lock']);
const ASSET_PREPARATION = new Set([
	'sync:wasm-lean4',
	'prepare:test-assets',
	'build:page-runtimes',
	'sync:page-runtimes',
	'build:static-runtime-modules',
	'prepare:wasm-debug-release',
	'sync:wasm-commonlisp',
	'layer:static-runtimes',
	'compress:static-runtimes',
	'assets:lock'
]);

/** The opt-in changes deployment checks only; runtime byte verification stays enabled.
 * @param {Record<string, string | undefined>} [environment]
 */
export function shouldSkipAssetVerification(environment = process.env) {
	return environment.WASM_IDLE_SKIP_ASSET_VERIFICATION === '1';
}

/** Keep package.json's ordinary page:build chain as the source of build ordering.
 * Opt-in page invocations select known pnpm tasks, never interpret a caller's shell text.
 * @param {Record<string, string>} scripts
 * @param {Record<string, string | undefined>} [environment]
 */
export function createPagePlan(scripts, environment = process.env) {
	const skipVerification = shouldSkipAssetVerification(environment);
	const reuseAssets = environment.WASM_IDLE_PAGE_REUSE_ASSETS === '1';
	const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
	const tasks = [];
	if (!skipVerification && !reuseAssets) {
		tasks.push({ command: pnpm, args: ['run', 'page:build'] });
	} else {
		if (typeof scripts['page:build'] !== 'string') throw new Error('Missing page:build script');
		for (const step of scripts['page:build'].split(' && ')) {
			const tokens = step.split(' ');
			if (
				tokens.length < 3 ||
				tokens[0] !== 'pnpm' ||
				tokens[1] !== 'run' ||
				tokens.some((token) => !/^[a-zA-Z0-9:_./-]+$/u.test(token))
			)
				throw new Error(`Unsupported page:build command: ${step}`);
			const script = tokens[2];
			if (skipVerification && ASSET_VERIFIERS.has(script)) continue;
			if (reuseAssets && ASSET_PREPARATION.has(script)) continue;
			tasks.push({ command: pnpm, args: tokens.slice(1) });
		}
	}
	if (!skipVerification)
		tasks.push({ command: pnpm, args: ['run', 'test:browser:audit:full', '--use-build'] });
	tasks.push({ command: process.execPath, args: ['gh-pages.js'] });
	return tasks;
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	try {
		if (process.argv.length > 2) throw new Error('Usage: npm run page');
		const { scripts } = JSON.parse(
			await readFile(path.join(REPO_ROOT, 'package.json'), 'utf8')
		);
		if (shouldSkipAssetVerification())
			console.log(
				'Skipping deployment asset verification and full browser audit for this invocation.'
			);
		if (process.env.WASM_IDLE_PAGE_REUSE_ASSETS === '1')
			console.log(
				'Reusing the prepared static runtime assets; rebuilding the website and container example.'
			);
		for (const { command, args } of createPagePlan(scripts)) {
			console.log(`Running ${path.basename(command)} ${args.join(' ')}`);
			await new Promise((resolve, reject) => {
				const child = spawn(command, args, {
					cwd: REPO_ROOT,
					env: process.env,
					stdio: 'inherit'
				});
				child.on('error', reject);
				child.on('close', (code, signal) => {
					if (code === 0) resolve();
					else
						reject(
							new Error(`${command} ${args.join(' ')} failed (${signal || code})`)
						);
				});
			});
		}
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}
