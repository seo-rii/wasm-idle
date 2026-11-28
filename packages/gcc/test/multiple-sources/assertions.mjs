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
	const mainLanguage = test.request.language ?? 'cpp';
	const languages = [
		mainLanguage,
		...(test.request.sources ?? []).map((unit) =>
			typeof unit === 'string' ? mainLanguage : (unit.language ?? mainLanguage)
		)
	];
	assert.deepEqual(
		result.stages
			.filter((stage) => stage.tool === 'cc1' || stage.tool === 'cc1plus')
			.map((stage) => stage.tool),
		languages.map((language) => (language === 'c' ? 'cc1' : 'cc1plus'))
	);
	const objects = result.stages
		.filter((stage) => stage.tool === 'as')
		.map((stage) => stage.argv[stage.argv.indexOf('-o') + 1]);
	assert.equal(new Set(objects).size, objects.length);
	assert.deepEqual(
		result.stages.at(-1).argv.filter((arg) => arg.startsWith('/tmp/') && arg.endsWith('.o')),
		objects
	);
}
