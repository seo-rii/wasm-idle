import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const jsExtensions = new Set(['.js', '.mjs', '.cjs', '.json', '.node']);

export async function resolve(specifier, context, defaultResolve) {
	try {
		return await defaultResolve(specifier, context, defaultResolve);
	} catch (error) {
		if (error?.code !== 'ERR_MODULE_NOT_FOUND' && error?.code !== 'ERR_UNSUPPORTED_DIR_IMPORT') {
			throw error;
		}

		if (!specifier.startsWith('./') && !specifier.startsWith('../') && !specifier.startsWith('/')) {
			throw error;
		}

		const resolvedUrl = new URL(specifier, context.parentURL);
		const resolvedPath = fileURLToPath(resolvedUrl);
		const extension = path.extname(resolvedPath);
		if (jsExtensions.has(extension)) {
			throw error;
		}

		try {
			const resolvedStat = await stat(resolvedPath);
			if (resolvedStat.isDirectory()) {
				return defaultResolve(pathToFileURL(path.join(resolvedPath, 'index.js')).href, context, defaultResolve);
			}
		} catch {}

		return defaultResolve(pathToFileURL(`${resolvedPath}.js`).href, context, defaultResolve);
	}
}
