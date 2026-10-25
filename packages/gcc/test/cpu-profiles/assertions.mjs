import assert from 'node:assert/strict';

function body(assembly, name) {
	const match = new RegExp(`^${name}:\\s*\\n([\\s\\S]*?)^\\s*\\.size\\s+${name}\\s*,`, 'm').exec(
		assembly
	);
	assert(match, `Missing complete function ${name}`);
	return match[1];
}

export function assertCaseResult(test, result) {
	if (test.expectFailure) {
		assert.notEqual(result.exitCode, 0, `${test.id}: unsupported FMA intrinsic was accepted`);
		assert.equal(result.artifact, undefined, `${test.id}: stale artifact after failure`);
		assert.match(result.stderr, /target specific option mismatch/);
		return;
	}
	assert.equal(result.exitCode, 0, `${test.id}: ${result.stderr}`);
	assert.equal(result.artifact?.cpu, test.request.cpu);
	assert.equal(result.artifact?.format, 'assembly');
	assert.equal(result.artifact?.compiler, 'gcc');
	assert.equal(result.artifact?.target, 'x86_64-linux-gnu');
	const assembly = new TextDecoder('utf-8', { fatal: true }).decode(
		new Uint8Array(result.artifact.bytes)
	);
	assert.match(assembly, /\.ident\s+"GCC:/);
	if (test.fixture === 'fma-intrinsic.c') {
		assert.match(body(assembly, 'required_fma'), /\bvfmadd(?:132|213|231)ps\b/);
		return;
	}
	const integer = body(assembly, 'integer_add');
	const scalar = body(assembly, 'multiply_add');
	const vector = body(assembly, 'vector_multiply_add');
	if (test.request.cpu === 'x86-64') {
		assert.match(integer, /\bpaddd\b/);
		for (const section of [integer, scalar, vector])
			assert.doesNotMatch(section, /%[yz]mm\d+|\bv[a-z0-9]+\b/);
		assert.match(scalar, /\bmulsd\b/);
		assert.match(scalar, /\baddsd\b/);
	} else {
		assert.match(integer, /\bvpaddd\b/);
		assert.match(integer, /%ymm\d+/);
		assert.match(vector, /%ymm\d+/);
		if (test.request.cpu === 'avx2-fma') {
			assert.match(scalar, /\bvfmadd(?:132|213|231)sd\b/);
			assert.match(vector, /\bvfmadd(?:132|213|231)ps\b/);
		} else {
			for (const section of [integer, scalar, vector])
				assert.doesNotMatch(section, /\bv(?:f|fn)m(?:add|sub)[a-z0-9]*\b/);
			assert.match(scalar, /\bvmulsd\b/);
			assert.match(scalar, /\bvaddsd\b/);
			assert.match(vector, /\bvmulps\b/);
			assert.match(vector, /\bvaddps\b/);
		}
	}
}
