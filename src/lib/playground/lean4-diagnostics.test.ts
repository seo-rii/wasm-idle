// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
import type { CompilerDiagnostic } from '@wasm-idle/terminal';

const source = readFileSync(
	new URL('../../../scripts/runtime-workers/wasm-lean4-runner-worker.js', import.meta.url),
	'utf8'
);

function diagnosticStreams(
	workspace: {
		code: string;
		activePath?: string;
		workspaceFiles?: { path: string; content: string | Uint8Array }[];
	} = { code: '' }
) {
	const markers: CompilerDiagnostic[] = [];
	const output = { stdout: '', stderr: '' };
	const api = runInNewContext(
		source + '\n({ createOutput, createDiagnostics, createDiagnosticReporter })',
		{
			__WASM_IDLE_LEAN4_ASSET_LOCK__: {},
			TextDecoder,
			self: {
				postMessage(
					message:
						| { diagnostic: CompilerDiagnostic }
						| { stream: 'stdout' | 'stderr'; output: string }
				) {
					if ('diagnostic' in message) markers.push(message.diagnostic);
					else output[message.stream] += message.output;
				}
			}
		}
	);
	const report = api.createDiagnosticReporter(workspace);
	function device(name: 'stdout' | 'stderr') {
		const diagnostics = api.createDiagnostics(report);
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

it('maps Lean scalar columns to UTF-16 using the file named by each diagnostic', () => {
	const active = 'Cases/실험.lean';
	const peer = 'Lib/Peer.lean';
	const { stdout, markers, output } = diagnosticStreams({
		activePath: active,
		code: 'first\r\n한😀😀중X\n',
		workspaceFiles: [
			{ path: active, content: 'old buffer' },
			{ path: peer, content: new TextEncoder().encode('한글Z\nA🍌Z') }
		]
	});
	const positions = [
		[active, 2, 0, 1],
		[active, 2, 2, 4],
		[active, 2, 4, 7],
		[active, 2, 5, 8],
		[active, 3, 0, 1],
		[peer, 1, 2, 3],
		[peer, 2, 2, 4],
		['Unknown.lean', 1, 6, 7],
		[active, 99, 4, 5],
		[active, 2, 99, 100]
	] as const;
	let expectedTerminal = '';
	for (const [file, line, column] of positions) {
		const text = file + ':' + line + ':' + column + ': error: unknown identifier\n';
		stdout('/workspace/' + text);
		expectedTerminal += text;
	}
	expect(
		markers.map((marker) => [marker.fileName, marker.lineNumber, marker.columnNumber])
	).toEqual(positions.map(([file, line, , editorColumn]) => [file, line, editorColumn]));
	expect(output.stdout).toBe(expectedTerminal);
});
