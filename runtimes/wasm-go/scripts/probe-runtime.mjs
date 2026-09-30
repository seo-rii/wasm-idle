import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptsDir, '..');
const distRoot = path.join(projectRoot, 'dist');
const runtimeDir = path.join(distRoot, 'runtime');
const manifest = JSON.parse(
	await readFile(path.join(runtimeDir, 'runtime-manifest.v1.json'), 'utf8')
);
const { compileGo, executeBrowserGoArtifact, clearRuntimePackCache } = await import(
	pathToFileURL(path.join(distRoot, 'index.js')).href
);
const targets = ['wasip1/wasm', 'wasip2/wasm', 'wasip3/wasm', 'js/wasm'].filter(
	(target) => manifest.targets[target]
);
assert(targets.length, 'runtime manifest is missing all packaged targets');
const fixtures = [
	{
		name: 'console-stdin',
		stdin: '8 13\n',
		expected: '21\n',
		code: `package main
import (
 "bufio"
 "fmt"
 "os"
)
func main() {
 var a, b int
 fmt.Fscan(bufio.NewReader(os.Stdin), &a, &b)
 fmt.Println(a+b)
}`
	},
	{
		name: 'additional-stdlib',
		stdin: '',
		expected: `${createHash('sha256').update('payload').digest('hex')}\n`,
		code: `package main
import (
 "crypto/sha256"
 "encoding/hex"
 "fmt"
)
func main() {
 digest := sha256.Sum256([]byte("payload"))
 fmt.Println(hex.EncodeToString(digest[:]))
}`
	}
];
for (const target of targets) {
	for (const fixture of fixtures) {
		clearRuntimePackCache();
		const requests = new Map();
		const fetchImpl = async (input) => {
			const url = new URL(input instanceof Request ? input.url : String(input));
			const bytes = await readFile(fileURLToPath(url));
			requests.set(path.relative(runtimeDir, fileURLToPath(url)), bytes.length);
			return new Response(bytes);
		};
		const runtimeBaseUrl = pathToFileURL(`${runtimeDir}/`).href;
		const started = performance.now();
		const result = await compileGo(
			{ target, code: fixture.code },
			{
				manifest,
				runtimeBaseUrl,
				dependencies: { fetchImpl }
			}
		);
		assert(result.success && result.artifact, `${target}/${fixture.name}: ${result.stderr}`);
		let remaining = fixture.stdin;
		const execution = await executeBrowserGoArtifact(result.artifact, {
			manifest,
			runtimeBaseUrl,
			fetchImpl,
			stdin: () => {
				const value = remaining;
				remaining = '';
				return value || null;
			}
		});
		assert.equal(execution.exitCode, 0, `${target}/${fixture.name}: ${execution.stderr}`);
		assert.equal(execution.stdout, fixture.expected, `${target}/${fixture.name} stdout`);
		console.log(
			JSON.stringify({
				target,
				fixture: fixture.name,
				exitCode: execution.exitCode,
				milliseconds: Math.round(performance.now() - started),
				sysrootDeliveryBytes: [...requests]
					.filter(([asset]) => asset.startsWith('sysroot/'))
					.reduce((sum, [, bytes]) => sum + bytes, 0),
				chunks: result.plan?.sysrootChunks?.map((chunk) => chunk.asset) ?? [],
				stdout: execution.stdout
			})
		);
	}
}
