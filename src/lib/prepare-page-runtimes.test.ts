import source from '../../scripts/prepare-page-runtimes.mjs?raw';
import { describe, expect, it } from 'vitest';

describe('page runtime preparation', () => {
	it('bootstraps the pinned OCaml toolchain before generating a missing bundle', () => {
		const hostTools = source.indexOf("'bootstrap:host-tools'");
		const toolchain = source.indexOf("'toolchain:bootstrap'");
		const bundle = source.indexOf("'./scripts/prepare-browser-native.mjs'");

		expect(hostTools).toBeGreaterThan(0);
		expect(toolchain).toBeGreaterThan(hostTools);
		expect(bundle).toBeGreaterThan(toolchain);
	});
});
