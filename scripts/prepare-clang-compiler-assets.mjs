#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

import { prepareClangCompilerAssets } from './prepare-clangd-assets.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const result = await prepareClangCompilerAssets();
	console.log(
		`Prepared Clang compiler assets (${result.downloaded} downloaded, ${result.reused} reused).`
	);
}
