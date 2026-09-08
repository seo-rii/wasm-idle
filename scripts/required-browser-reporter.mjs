/** Fail closed when a selected browser test was filtered, skipped, or never finished. */
export function assertRequiredBrowserTests(modules) {
	const required = modules.flatMap((module) =>
		[...module.children.allTests()].filter((test) => test.meta().requiredBrowser === true)
	);
	if (required.length === 0) throw new Error('No required browser tests were collected.');
	const incomplete = required.filter((test) => test.result().state !== 'passed');
	if (incomplete.length) {
		throw new Error(
			`Required browser tests did not pass:\n${incomplete
				.map((test) => `${test.fullName}: ${test.result().state}`)
				.join('\n')}`
		);
	}
}

export default class RequiredBrowserReporter {
	onTestRunEnd(modules) {
		assertRequiredBrowserTests(modules);
	}
}
