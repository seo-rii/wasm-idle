#!/usr/bin/env node
import { access, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** @param {string} text */
const quote = (text) => `'${text.replaceAll("'", "'\\''")}'`;

/**
 * Linux CI launcher: fresh heap statistics, unchanged browser and caller flags.
 * @param {string} executable
 * @param {string} destination
 */
export async function createPreciseChromiumLauncher(executable, destination) {
	if (typeof executable !== 'string' || typeof destination !== 'string' ||
		!path.isAbsolute(executable) || !path.isAbsolute(destination) ||
		/[\0\r\n]/u.test(executable + destination) ||
		path.resolve(executable) === path.resolve(destination))
		throw new Error('Distinct absolute executable and destination paths are required');
	await access(executable, constants.X_OK);
	await writeFile(destination,
		`#!/bin/sh\nexec ${quote(executable)} --enable-precise-memory-info "$@"\n`,
		{ encoding: 'utf8', mode: 0o700, flag: 'wx' });
	return destination;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	if (process.argv.length !== 4) {
		console.error('Usage: precise-chromium-launcher.mjs /absolute/chromium /absolute/new-launcher');
		process.exitCode = 1;
	} else {
		createPreciseChromiumLauncher(process.argv[2], process.argv[3]).catch((error) => {
			console.error(error.message); process.exitCode = 1;
		});
	}
}
