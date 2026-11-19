// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
import type { CompilerDiagnostic } from '@wasm-idle/terminal';

const source = readFileSync(
	new URL('../../../scripts/runtime-workers/wasm-lean4-runner-worker.js', import.meta.url),
	'utf8'
);

function diagnosticStreams() {
	const markers: CompilerDiagnostic[] = [];
	const output = { stdout: '', stderr: '' };
	const api = runInNewContext(source + '\n({ createOutput, createDiagnostics })', {
		__WASM_IDLE_LEAN4_ASSET_LOCK__: {},
		TextDecoder,
		self: {
			postMessage(message: { stream: 'stdout' | 'stderr'; output: string }) {
				output[message.stream] += message.output;
			}
		}
	});
	function device(name: 'stdout' | 'stderr') {
		const diagnostics = api.createDiagnostics((value: CompilerDiagnostic) =>
			markers.push(value)
		);
		const sink = api.createOutput(name, diagnostics);
		let nextWriteSize = Infinity;
		const stream = {
			stream_ops: {
				write(_stream: unknown, bytes: Uint8Array, offset: number, size: number) {
					const written = Math.min(size, nextWriteSize);
					nextWriteSize = Infinity;
					for (const byte of bytes.subarray(offset, offset + written)) sink.byte(byte);
					return written;
				}
			}
		};
		diagnostics.bindWrites(stream);
		return (text: string, firstWriteSize = Infinity) => {
			const bytes = new TextEncoder().encode(text);
			nextWriteSize = firstWriteSize;
			let offset = 0;
			while (offset < bytes.length)
				offset += stream.stream_ops.write(stream, bytes, offset, bytes.length - offset);
		};
	}
	return { stdout: device('stdout'), stderr: device('stderr'), markers, output };
}

it('keeps multiline Lean messages intact and separates messages within and after a write', () => {
	const { stdout, stderr, markers, output } = diagnosticStreams();
	stdout(
		'/workspace/A.lean:1:2: warning: first\n\nHint: first hint\n/workspace/B.lean:2:3: error(tag): next\n\nNote: last paragraph\n'
	);
	stdout('Hint: program output\n');
	stderr('Note: program stderr\n');
	expect(markers).toEqual([
		{
			fileName: 'A.lean',
			lineNumber: 1,
			columnNumber: 3,
			severity: 'warning',
			message: 'first\n\nHint: first hint'
		},
		{
			fileName: 'B.lean',
			lineNumber: 2,
			columnNumber: 4,
			severity: 'error',
			message: 'next\n\nNote: last paragraph'
		}
	]);
	expect(output.stdout).toBe(
		'A.lean:1:2: warning: first\n\nHint: first hint\nB.lean:2:3: error(tag): next\n\nNote: last paragraph\nHint: program output\n'
	);
	expect(output.stderr).toBe('Note: program stderr\n');
});

it('keeps a diagnostic open when the device accepts only its first line', () => {
	const { stdout, markers } = diagnosticStreams();
	const header = '/workspace/Main.lean:3:4: error: first\n';
	stdout(header + '\nHint: continued after a short write\n', header.length);
	expect(markers.map((marker) => marker.message)).toEqual([
		'first\n\nHint: continued after a short write'
	]);
});

it('collects long partial lines across writes while an independent stream remains live', () => {
	const { stdout, stderr, markers, output } = diagnosticStreams();
	const start = 'x'.repeat(5000);
	stdout('/workspace/Main.lean:1:0: error: ' + start);
	expect(output.stdout).toContain('Main.lean:1:0: error: ');
	expect(markers).toEqual([]);
	stderr('ordinary stderr\n');
	stdout('한글\n\nHint: 끝\n');
	expect(markers[0].message).toBe(start + '한글\n\nHint: 끝');
	expect(output.stdout).toBe('Main.lean:1:0: error: ' + start + '한글\n\nHint: 끝\n');
	expect(output.stderr).toBe('ordinary stderr\n');
});
