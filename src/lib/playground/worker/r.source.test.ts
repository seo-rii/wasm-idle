import source from './r.ts?raw';
import { describe, expect, it } from 'vitest';

describe('R worker source', () => {
	it('loads the WebR module from the configured static runtime URL', () => {
		expect(source).toContain("import type { WebR } from 'webr';");
		expect(source).toContain('webr.js');
		expect(source).toContain('/* @vite-ignore */ moduleUrl');
		expect(source).not.toContain("import { ChannelType, WebR } from 'webr';");
	});
});
