import {
	compileTypeScript,
	createTypeScriptCompiler,
	executeBrowserTypeScriptArtifact
} from '../src/index.js';
import { describe, expect, it } from 'vitest';

describe('wasm-typescript runner contract', () => {
	it('exports a compiler factory', async () => {
		const compiler = await createTypeScriptCompiler();
		expect(typeof compiler.compile).toBe('function');
	});

	it('runs JavaScript with a CommonJS fs stdin shim', async () => {
		const result = await compileTypeScript({
			language: 'javascript',
			fileName: 'main.js',
			code: `
				const fs = require('fs');
				const input = fs.readFileSync('/dev/stdin', 'utf8').trim();
				console.log(Number(input) + 7);
			`
		});
		expect(result.success).toBe(true);
		expect(result.artifact).toBeDefined();

		const chunks = ['35\n'];
		const execution = await executeBrowserTypeScriptArtifact(result.artifact!, {
			stdin: () => chunks.shift() ?? null
		});
		expect(execution.exitCode).toBe(0);
		expect(execution.stdout).toBe('42\n');
	});

	it('reads one stdin line without waiting for EOF', async () => {
		const result = await compileTypeScript({
			language: 'javascript',
			fileName: 'main.js',
			code: `
				const fs = require('fs');
				const first = fs.readLineSync(0);
				console.log(Number(first || '4') + 7);
			`
		});
		expect(result.success).toBe(true);
		expect(result.artifact).toBeDefined();

		let readCount = 0;
		const chunks = ['35\nsecond line\n'];
		const execution = await executeBrowserTypeScriptArtifact(result.artifact!, {
			stdin: () => {
				readCount += 1;
				return chunks.shift() ?? null;
			}
		});
		expect(execution.exitCode).toBe(0);
		expect(execution.stdout).toBe('42\n');
		expect(readCount).toBe(1);
	});

	it('strips TypeScript types and lowers builtin imports before running', async () => {
		const result = await compileTypeScript({
			language: 'typescript',
			fileName: 'main.ts',
			code: `
				import fs from 'node:fs';

				const bonus: number = 3;
				const value: number = Number(fs.readFileSync(0, 'utf8').trim() || '4');
				console.log(value * 2 + bonus);
			`
		});
		expect(result.success).toBe(true);
		const chunks = ['5\n'];
		const execution = await executeBrowserTypeScriptArtifact(result.artifact!, {
			stdin: () => chunks.shift() ?? null
		});
		expect(execution.exitCode).toBe(0);
		expect(execution.stdout).toBe('13\n');
	});

	it('lowers named and namespace builtin imports', async () => {
		const result = await compileTypeScript({
			language: 'typescript',
			fileName: 'main.ts',
			code: `
				import { readFileSync as read } from 'fs';
				import * as path from 'node:path';

				const value: string = read(path.join('/dev', 'stdin'), 'utf8').trim();
				console.log(value);
			`
		});
		expect(result.success).toBe(true);
		const chunks = ['named imports\n'];
		const execution = await executeBrowserTypeScriptArtifact(result.artifact!, {
			stdin: () => chunks.shift() ?? null
		});
		expect(execution.exitCode).toBe(0);
		expect(execution.stdout).toBe('named imports\n');
	});

	it('rejects non-builtin ESM imports in the browser runner', async () => {
		const result = await compileTypeScript({
			language: 'typescript',
			fileName: 'main.ts',
			code: `
				import helper from './helper';
				console.log(helper);
			`
		});
		expect(result.success).toBe(false);
		expect(result.diagnostics[0]?.message).toContain('Only Node builtin imports are supported');
	});

	it('exposes workspace files through fs.readFileSync', async () => {
		const result = await compileTypeScript({
			language: 'javascript',
			fileName: 'main.js',
			code: `
				const fs = require('fs');
				console.log(fs.readFileSync('data/input.txt', 'utf8').trim());
			`
		});
		expect(result.success).toBe(true);
		const execution = await executeBrowserTypeScriptArtifact(result.artifact!, {
			files: [{ path: 'data/input.txt', content: 'workspace file\n' }]
		});
		expect(execution.exitCode).toBe(0);
		expect(execution.stdout).toBe('workspace file\n');
	});
});
