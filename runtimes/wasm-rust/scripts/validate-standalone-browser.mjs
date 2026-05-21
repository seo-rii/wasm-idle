import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const steps = [
	{
		label: 'fast ci lane',
		command: 'pnpm',
		args: ['run', 'test:ci:fast']
	},
	{
		label: 'browser ci lane',
		command: 'pnpm',
		args: ['run', 'test:ci:browser']
	}
];

for (const step of steps) {
	console.log(`\n[wasm-rust] ${step.label}`);
	execFileSync(step.command, step.args, {
		cwd: projectRoot,
		stdio: 'inherit',
		env: {
			...process.env,
			...step.env
		}
	});
}

console.log('\n[wasm-rust] standalone browser validation complete');
