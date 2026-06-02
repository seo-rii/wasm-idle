#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(THIS_DIR, '..');
const REPORT_PATH = path.join(PROJECT_DIR, '.cache', 'probes', 'last-wasm-build.json');

function parseArgs(argv) {
	const options = {
		gradle: process.env.GRADLE || 'gradle',
		task: 'buildWasmGC',
		timeoutMs: 300_000,
		extraArgs: []
	};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--') {
			options.extraArgs = argv.slice(index + 1);
			break;
		}
		if (arg === '--gradle') {
			options.gradle = argv[++index];
		} else if (arg === '--task') {
			options.task = argv[++index];
		} else if (arg === '--timeout-ms') {
			options.timeoutMs = Number(argv[++index]);
		} else {
			throw new Error(`Unknown option: ${arg}`);
		}
	}
	if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
		throw new Error('--timeout-ms must be a positive number');
	}
	return options;
}

function parseProcessTable(output) {
	const processes = new Map();
	for (const line of output.trim().split('\n')) {
		const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(.+)$/);
		if (!match) continue;
		const [, pid, ppid, rss, pcpu, cmd] = match;
		processes.set(Number(pid), {
			pid: Number(pid),
			ppid: Number(ppid),
			rss: Number(rss),
			pcpu: Number(pcpu),
			cmd
		});
	}
	return processes;
}

function collectTree(processes, rootPid) {
	const childrenByParent = new Map();
	for (const processInfo of processes.values()) {
		let children = childrenByParent.get(processInfo.ppid);
		if (!children) {
			children = [];
			childrenByParent.set(processInfo.ppid, children);
		}
		children.push(processInfo.pid);
	}
	const result = [];
	const queue = [rootPid];
	const seen = new Set();
	while (queue.length) {
		const pid = queue.shift();
		if (seen.has(pid)) continue;
		seen.add(pid);
		const processInfo = processes.get(pid);
		if (processInfo) result.push(processInfo);
		for (const childPid of childrenByParent.get(pid) || []) {
			queue.push(childPid);
		}
	}
	return result;
}

async function snapshotProcessTree(rootPid) {
	return await new Promise((resolve) => {
		const ps = spawn('ps', ['-eo', 'pid,ppid,rss,pcpu,cmd'], {
			stdio: ['ignore', 'pipe', 'ignore']
		});
		let output = '';
		ps.stdout.setEncoding('utf8');
		ps.stdout.on('data', (chunk) => {
			output += chunk;
		});
		ps.on('close', () => {
			const tree = collectTree(parseProcessTable(output), rootPid);
			resolve({
				tree,
				totalRssKb: tree.reduce((sum, processInfo) => sum + processInfo.rss, 0),
				totalCpu: tree.reduce((sum, processInfo) => sum + processInfo.pcpu, 0)
			});
		});
		ps.on('error', () => {
			resolve({ tree: [], totalRssKb: 0, totalCpu: 0 });
		});
	});
}

function signalTree(processes, signal) {
	for (const processInfo of [...processes].sort((a, b) => b.pid - a.pid)) {
		try {
			process.kill(processInfo.pid, signal);
		} catch {
			// Process already exited.
		}
	}
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const args = ['-p', PROJECT_DIR, options.task, '--no-daemon', ...options.extraArgs];
	const startedAt = new Date();
	const child = spawn(options.gradle, args, {
		cwd: PROJECT_DIR,
		stdio: 'inherit'
	});

	const samples = [];
	let peakRssKb = 0;
	let lastTree = [];
	let timedOut = false;
	const sampleTimer = setInterval(async () => {
		const sample = await snapshotProcessTree(child.pid);
		lastTree = sample.tree;
		peakRssKb = Math.max(peakRssKb, sample.totalRssKb);
		samples.push({
			elapsedMs: Date.now() - startedAt.getTime(),
			totalRssKb: sample.totalRssKb,
			totalCpu: sample.totalCpu,
			processes: sample.tree.map((processInfo) => ({
				pid: processInfo.pid,
				ppid: processInfo.ppid,
				rss: processInfo.rss,
				pcpu: processInfo.pcpu,
				cmd: processInfo.cmd
			}))
		});
	}, 1_000);

	const timeoutTimer = setTimeout(async () => {
		timedOut = true;
		const sample = await snapshotProcessTree(child.pid);
		lastTree = sample.tree;
		signalTree(sample.tree, 'SIGTERM');
		setTimeout(() => signalTree(lastTree, 'SIGKILL'), 5_000).unref();
	}, options.timeoutMs);

	const exit = await new Promise((resolve) => {
		child.on('error', (error) => resolve({ code: null, signal: null, error: error.message }));
		child.on('close', (code, signal) => resolve({ code, signal, error: null }));
	});
	clearInterval(sampleTimer);
	clearTimeout(timeoutTimer);

	const report = {
		command: [options.gradle, ...args],
		startedAt: startedAt.toISOString(),
		finishedAt: new Date().toISOString(),
		timedOut,
		timeoutMs: options.timeoutMs,
		exit,
		peakRssKb,
		peakRssMb: Math.round(peakRssKb / 1024),
		samples
	};
	await mkdir(path.dirname(REPORT_PATH), { recursive: true });
	await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
	console.log(`Wrote probe report to ${REPORT_PATH}`);

	if (exit.error) {
		throw new Error(exit.error);
	}
	if (timedOut) {
		process.exitCode = 124;
	} else if (typeof exit.code === 'number' && exit.code !== 0) {
		process.exitCode = exit.code;
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
