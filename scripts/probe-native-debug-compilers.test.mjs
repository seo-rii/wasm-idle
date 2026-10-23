import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectWasmDebugSections } from './probe-native-debug-compilers.mjs';

const header = [0, 97, 115, 109, 1, 0, 0, 0];
function moduleWithSections(sections) {
	return Uint8Array.from([
		...header,
		...sections.flatMap(([name, contents]) => {
			const nameBytes = new TextEncoder().encode(name);
			const payload = [nameBytes.length, ...nameBytes, ...contents];
			return [0, payload.length, ...payload];
		})
	]);
}

test('function names alone are not source debugging information', () => {
	const metadata = inspectWasmDebugSections(moduleWithSections([['name', [0, 0]]]));
	assert.equal(metadata.hasSourceDwarf, false);
	assert.deepEqual(metadata.dwarfSections, []);
});

test('all three nonempty source DWARF sections are required', () => {
	const sections = ['.debug_info', '.debug_abbrev', '.debug_line'].map((name) => [name, [1]]);
	assert.equal(inspectWasmDebugSections(moduleWithSections(sections)).hasSourceDwarf, true);
	sections[2][1] = [];
	assert.equal(inspectWasmDebugSections(moduleWithSections(sections)).hasSourceDwarf, false);
});

test('a truncated module cannot be misreported as a compiler without DWARF', () => {
	assert.throws(
		() => inspectWasmDebugSections(Uint8Array.from([...header, 0, 127])),
		/truncated/
	);
	assert.throws(
		() => inspectWasmDebugSections(Uint8Array.from([...header, 0, 1, 5])),
		/truncated/
	);
	assert.throws(
		() => inspectWasmDebugSections(Uint8Array.from([...header, 0, 128])),
		/truncated/
	);
	assert.throws(
		() => inspectWasmDebugSections(Uint8Array.from([...header, 0, 128, 128, 128, 128, 16])),
		/invalid/
	);
});
