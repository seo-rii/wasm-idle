import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { beforeAll, describe, expect, it } from 'vitest';

import { instrumentRustDebugSource, RUST_DEBUG_MARKER } from '../src/debug-instrumenter.js';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const builtAssetPath = path.join(projectRoot, 'dist', 'debug-instrumenter.js');

describe('instrumentRustDebugSource', () => {
	it('adds same-line trace markers before Rust block statements', () => {
		const source = `fn add(x: i32) -> i32 {
    let y = x + 1;
    if y > 2 {
        println!("{}", y);
    } else {
        return y;
    }
    y
}

fn main() { add(1); }
`;

		const instrumented = instrumentRustDebugSource(source);

		expect(instrumented).toContain(
			`eprintln!("${RUST_DEBUG_MARKER}:{}:{}", 2, "add"); let y = x + 1;`
		);
		expect(instrumented).toContain(
			`eprintln!("${RUST_DEBUG_MARKER}:{}:{}", 3, "add"); if y > 2`
		);
		expect(instrumented).toContain(
			`eprintln!("${RUST_DEBUG_MARKER}:{}:{}", 4, "add"); println!("{}", y);`
		);
		expect(instrumented).toContain(
			`eprintln!("${RUST_DEBUG_MARKER}:{}:{}", 6, "add"); return y;`
		);
		expect(instrumented).toContain(`eprintln!("${RUST_DEBUG_MARKER}:{}:{}", 8, "add"); y`);
		expect(instrumented).toContain(
			`fn main() { eprintln!("${RUST_DEBUG_MARKER}:{}:{}", 11, "main"); add(1); }`
		);
		expect(instrumented.split('\n')).toHaveLength(source.split('\n').length);
	});

	it('returns source unchanged when no block statement can be instrumented', () => {
		const source = 'fn main() {}\n';

		expect(instrumentRustDebugSource(source)).toBe(source);
	});
});

describe('debug instrumenter browser asset', () => {
	beforeAll(async () => {
		await execFileAsync('pnpm', ['run', 'build:js'], {
			cwd: projectRoot,
			timeout: 30_000
		});
	}, 40_000);

	it('is minified, self-contained ESM with the public instrumentation exports', async () => {
		const builtSource = await readFile(builtAssetPath, 'utf8');

		expect(builtSource).not.toContain('@lezer/rust');
		expect(builtSource).not.toContain('sourceMappingURL');
		expect(builtSource.trim().split('\n')).toHaveLength(1);

		const moduleUrl = `data:text/javascript;base64,${Buffer.from(builtSource).toString('base64')}`;
		const instrumenter = (await import(/* @vite-ignore */ moduleUrl)) as {
			RUST_DEBUG_MARKER: string;
			instrumentRustDebugSource: (source: string) => string;
		};

		expect(Object.keys(instrumenter).sort()).toEqual([
			'RUST_DEBUG_MARKER',
			'instrumentRustDebugSource'
		]);
		expect(instrumenter.RUST_DEBUG_MARKER).toBe(RUST_DEBUG_MARKER);
		expect(instrumenter.instrumentRustDebugSource('fn main() { println!("hi"); }')).toBe(
			`fn main() { eprintln!("${RUST_DEBUG_MARKER}:{}:{}", 1, "main"); println!("hi"); }`
		);
	});
});
