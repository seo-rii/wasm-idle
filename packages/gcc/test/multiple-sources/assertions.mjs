import assert from 'node:assert/strict';

export function assertCaseResult(test, result) {
	assert.equal(result.stages.length, test.stageCount, `${test.id}: unexpected stage count`);
	if (test.expectFailure) {
		assert.notEqual(result.exitCode, 0, `${test.id}: invalid program compiled`);
		assert.equal(result.artifact, undefined, `${test.id}: stale artifact after failure`);
		assert.equal(result.stages.at(-1).tool, test.failureTool);
		assert(result.stderr.includes(test.diagnostic), result.stderr);
		return;
	}
	assert.equal(result.exitCode, 0, `${test.id}: ${result.stderr}`);
	assert.equal(result.artifact?.format, 'elf-executable');
	assert.equal(result.artifact?.compiler, 'gcc');
	assert.equal(result.artifact?.target, 'x86_64-linux-gnu');
	assert.equal(result.stages.at(-1).tool, 'ld');
	const frontend = test.request.language === 'c' ? 'cc1' : 'cc1plus';
	const units = result.stages.filter((stage) => stage.tool === frontend);
	assert.equal(units.length, 1 + (test.request.sources?.length ?? 0));
	const objects = result.stages
		.filter((stage) => stage.tool === 'as')
		.map((stage) => stage.argv[stage.argv.indexOf('-o') + 1]);
	assert.equal(new Set(objects).size, objects.length);
	assert.deepEqual(
		result.stages
			.at(-1)
			.argv.filter((arg) => arg.startsWith('/workspace/') && arg.endsWith('.o')),
		objects
	);
}
