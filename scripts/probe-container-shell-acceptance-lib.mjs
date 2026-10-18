// Pins, script and acceptance for the shell acceptance script with actual Bash, BusyBox and Clang.
import assert from 'node:assert/strict';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { BASH_WASM_SHA256, BASH_WEBC, digest, identity } from './probe-patched-container-shell-lib.mjs';
import { FULL_SYSROOT_SHA256, loadClangBrowserInputs } from '../packages/container/scripts/clang-browser-inputs.mjs';
import { selectClangProfile } from '../examples/container/clang-profile.mjs';
import { BUSYBOX_APPLETS, BUSYBOX_SHELL_COMMANDS } from '../runtimes/wasm-busybox/commands.mjs';

export { BASH_WASM_SHA256, digest, identity };
// SDK with bridge patches 0001-0020: registry/filesystem/pipe fixes, exit-only wait,
// raw stdin, bounded native pipes, explicit /tmp and retained setup/runtime errors.
export const PACKAGE_RECEIPT = {
	bytes: 2605,
	sha256: 'ee74bc0dab416b3e1365f5380c0ab31abb45337fcbd45fa6fdb815459226f228'
};
export const BINARY_RECEIPT_SHA256 = 'a5b2e417d78986d88dceeef65e111060d38f32456f29f4d65fc57dc4179e704d';
export const SDK_WASM = {
	bytes: 9262448,
	sha256: '11063fe5d9d5d16880cb1027e50a07841271e78709788de5b65cc6b9100ea34a'
};
export const MEMORY = { initial: 35, maximum: 16384, shared: true };
// Stage 4 genuine BusyBox applets; producer and real Node/Chromium receipts are pinned below.
export const BUSYBOX = {
  "bytes": 634885,
  "sha256": "30ea0ce3a36013b343dddc0045c72f490c468268c1a1fd2050fdc8702f97bd40"
};
export { BUSYBOX_APPLETS };
// Exact producer receipt retained in runtimes/wasm-busybox/evidence/commands-review-fixes-producer.json.
export const BUSYBOX_RECEIPT_SHA256 = 'a726fa35c9959dbe85c9dfec17ddad9004ef43c403658d71c2080180afa084ad';
export const BUSYBOX_PRODUCER_REVISION = '8ead09726cfed3c758c9a6b827bf1fa020549dd4';
// wasm-llvm process-sysroot.py: the full selected-target sysroot with initial_cwd linked into crt1.o.
export const PROCESS_SYSROOT = {
	bytes: 35328000,
	sha256: 'b5c51389ce2f2b404f8b354788aa4a19a65d7e4af746cf52d24e7276d2eabf7f'
};
export const PROCESS_SYSROOT_RECEIPT_SHA256 = '105089044738721b7177c1846454d8132578d79292100d6413c56b09fd27304c';
export const RUN_TIMEOUT_MS = 300000;
export const COMMAND_TIMEOUT_MS = 240000;
// docs/container-development-plan.md, unchanged.
export const SCRIPT = [
	'set -eu',
	'mkdir -p /workspace/demo',
	'cd /workspace/demo',
	"printf '#include <stdio.h>\\nint main(void){puts(\"hello\");return 0;}\\n' > main.c",
	'clang main.c -o hello.wasm',
	'./hello.wasm | grep hello > result.txt',
	'cat result.txt'
].join('\n') + '\n';
const text = (value) => [...new TextEncoder().encode(value)];
export const SOURCE = text('#include <stdio.h>\nint main(void){puts("hello");return 0;}\n');
export const READ_FILES = ['/workspace/demo/main.c', '/workspace/demo/result.txt'];
export const BIN = '/usr/local/bin';
export const SYSROOT = '/usr/share/wasm-sysroot';
export const LLVM_EXECUTABLE = '/opt/toolchains/llvm/bin/llvm';
export const CLANG_PROFILE = Object.freeze([
	'--target=wasm32-wasi', '-fuse-ld=/opt/toolchains/llvm/bin/wasm-ld', `--sysroot=${SYSROOT}`,
	`-resource-dir=${SYSROOT}/lib/clang/22`, '-Wl,--max-memory=67108864'
]);
// The pinned Clang 22 deprecates its own default triple and says so once per driver run.
// The sysroot is laid out for wasm32-wasi only, so the profile cannot select wasm32-wasip1.
export const CLANG_TRIPLE_WARNING =
	"clang: warning: argument '--target=wasm32-wasi' is deprecated, use --target=wasm32-wasip1 instead [-Wdeprecated]\n";
// Preprocessing retains the complete pinned driver profile. The real driver
// reports the two link-only defaults as unused; preserve these exact bytes.
export const CLANG_PREPROCESS_WARNINGS = CLANG_TRIPLE_WARNING +
	"clang: warning: -Wl,--max-memory=67108864: 'linker' input unused [-Wunused-command-line-argument]\n" +
	"clang: warning: argument unused during compilation: '-fuse-ld=/opt/toolchains/llvm/bin/wasm-ld' [-Wunused-command-line-argument]\n";
// The order Bash dispatches the script's commands; the pipeline's two children may swap.
export const DISPATCHES = [
	{ path: `${BIN}/mkdir`, cwd: '/workspace' },
	{ path: `${BIN}/clang`, cwd: '/workspace/demo' },
	{ path: '/workspace/demo/hello.wasm', cwd: '/workspace/demo', pipeline: true },
	{ path: `${BIN}/grep`, cwd: '/workspace/demo', pipeline: true },
	{ path: `${BIN}/cat`, cwd: '/workspace/demo' }
];
// A third run in the same profile interrupts a running artifact and a running compile.
export const INTERRUPT_SCRIPT = [
	'set -u',
	'mkdir -p /workspace/demo',
	'cd /workspace/demo',
	"printf 'int main(void){for(;;){}}\\n' > spin.c",
	'clang spin.c -o spin.wasm',
	'./spin.wasm; printf \'spin=%d\\n\' "$?"',
	"printf '#include <stdio.h>\\nint main(void){puts(\"hello\");return 0;}\\n' > main.c",
	'clang main.c -o interrupted.wasm; printf \'clang=%d\\n\' "$?"',
	'if [ -e interrupted.wasm ]; then echo kept; else echo discarded; fi',
	'clang main.c -o hello.wasm && ./hello.wasm'
].join('\n') + '\n';
export const INTERRUPTS = [
	{ path: '/workspace/demo/spin.wasm', occurrence: 1, delayMs: 1000 },
	// The snapshot adapter reports running only after its Worker is ready; the compile itself
	// then takes about a second, so a one-second delay can arrive just as it completes.
	{ path: `${BIN}/clang`, occurrence: 2, delayMs: 50 }
];
export const INTERRUPT_DISPATCHES = [
	[`${BIN}/mkdir`, 0], [`${BIN}/clang`, 0], ['/workspace/demo/spin.wasm', 130],
	[`${BIN}/clang`, 130], [`${BIN}/clang`, 0], ['/workspace/demo/hello.wasm', 0]
];
// A fourth run with its own cache and a corrupted BusyBox body: an integrity failure, a
// compile error and a missing command each fail alone, and the shell keeps working.
export const FAILURE_SCRIPT = [
	'set -u',
	'mkdir -p /workspace/demo; printf \'mkdir=%d\\n\' "$?"',
	'mkdir -p /workspace/demo; printf \'retry=%d\\n\' "$?"',
	'cd /workspace',
	"printf 'int main(void){' > bad.c",
	'clang bad.c -o bad.wasm; printf \'bad=%d\\n\' "$?"',
	'if [ -e bad.wasm ]; then echo artifact; else echo no-artifact; fi',
	'nosuch-command; printf \'missing=%d\\n\' "$?"',
	"printf '#include <stdio.h>\\nint main(void){puts(\"hello\");return 0;}\\n' > main.c",
	'clang main.c -o hello.wasm && ./hello.wasm'
].join('\n') + '\n';
export const FAILURE_DISPATCHES = [
	[`${BIN}/mkdir`, 126, 'INTEGRITY'], [`${BIN}/mkdir`, 126, 'INTEGRITY'], [`${BIN}/clang`, 1, 'exited'],
	[`${BIN}/clang`, 0, 'exited'], ['/workspace/hello.wasm', 0, 'exited']
];
// A fifth run: Bash saves and redirects descriptors inside a piped brace group or subshell,
// where descriptor 1 is a pipe.
export const PIPELINE_SCRIPT = [
	'set -u',
	'cd /workspace',
	"printf 'top\\n' >&2",
	"{ printf 'group\\n' >&2; } | cat",
	"{ printf 'file\\n' > group-file; } | cat",
	'IFS= read -r g < group-file; printf \'file=%s\\n\' "$g"',
	"( printf 'sub\\n' > sub-file ) | cat",
	'IFS= read -r s < sub-file; printf \'sub=%s\\n\' "$s"',
	"{ printf 'kept\\n'; printf 'aside\\n' >&2; } 2> err-file | grep kept"
].join('\n') + '\n';
export const PIPELINE_DISPATCHES = [[`${BIN}/cat`, 0], [`${BIN}/cat`, 0], [`${BIN}/cat`, 0], [`${BIN}/grep`, 0]];
// Public virtual metadata is exercised by actual Bash's PATH/stat/access checks.
// Clang must start while real shell redirection descriptors remain open.
export const REDIRECTION_SCRIPT = [
	'set -eu', 'cd /workspace',
	'command -v clang > command-path', `test -f ${BIN}/clang && test -x ${BIN}/clang`,
	"printf '#include <stdio.h>\\nint main(void){puts(\"hello\");return 0;}\\n' > main.c",
	'clang main.c -o hello.wasm > compile.out 2> compile.err',
	'clang --version > version.txt 2>> compile.err',
	'./hello.wasm',
	"printf 'int main(void){' > bad.c", 'set +e',
	'clang bad.c -o bad.wasm > failed.out 2> failed.err', 'status=$?', 'set -e',
	'printf \'bad=%d\\n\' "$status"',
	'cat hello.wasm > data.wasm', 'set +e', './data.wasm > denied.out 2> denied.err',
	'status=$?', 'set -e', 'printf \'data=%d\\n\' "$status"',
	'wasm-run data.wasm', 'set +e',
	`cat ${BIN}/clang > virtual-body 2> virtual-error`, 'status=$?', 'set -e', 'printf \'virtual=%d\\n\' "$status"'
].join('\n') + '\n';
export const REDIRECTION_FILES = ['command-path', 'compile.out', 'compile.err', 'version.txt', 'failed.out', 'failed.err', 'bad.wasm', 'denied.out', 'virtual-body', 'virtual-error'].map(name => `/workspace/${name}`);
// SH-02/SH-03: the real parser/evaluator and real BusyBox commands, without LLVM.
export const SYNTAX_DIRECTORY = '/workspace/syntax 한글';
export const SYNTAX_ENVIRONMENT = Object.freeze({ CONTAINER_SYNTAX_VALUE: 'value with spaces 한글' });
export const SYNTAX_SCRIPT = String.raw`set -eu
mkdir -p '/workspace/syntax 한글'
cd '/workspace/syntax 한글'
export CONTAINER_SYNTAX_VALUE='value with spaces 한글'
printf '%s\n' 'space value' '한글 값' > 'input file'
cp 'input file' 'copy 한글'
cat 'copy 한글' > quoted.out
grep '' 'copy 한글' > empty.out
grep '^space value$' 'copy 한글' > logic.out && printf 'and\n' >> logic.out
grep 'absent' 'copy 한글' >> logic.out || printf 'or\n' >> logic.out
grep 'absent' 'copy 한글' >> logic.out && printf 'unexpected\n' >> logic.out || printf 'fallback\n' >> logic.out
value="$(cat 'input file')"
printf '<%s>\n' "$value" > substitution.out
printf '%s|%s\n' "$CONTAINER_SYNTAX_VALUE" "$PWD" > environment.out
cat < 'input file' > input.out
printf 'discard\n' > append.out
cat 'input file' > append.out
printf 'tail\n' >> append.out
{ cat 'input file'; printf 'merged\n' >&2; } > merged.out 2>&1
{ cat 'input file'; printf 'retained\n' >&2; } 2>&1 > split.out
printf 'syntax-ok\n'
`;
const syntaxInput = 'space value\n한글 값\n';
export const SYNTAX_CONTENTS = Object.freeze({
	'input file': syntaxInput, 'copy 한글': syntaxInput, 'quoted.out': syntaxInput, 'empty.out': syntaxInput,
	'logic.out': 'space value\nand\nor\nfallback\n', 'substitution.out': `<${syntaxInput.trimEnd()}>\n`,
	'environment.out': `${SYNTAX_ENVIRONMENT.CONTAINER_SYNTAX_VALUE}|${SYNTAX_DIRECTORY}\n`,
	'input.out': syntaxInput, 'append.out': `${syntaxInput}tail\n`, 'merged.out': `${syntaxInput}merged\n`, 'split.out': syntaxInput
});
export const SYNTAX_FILES = Object.keys(SYNTAX_CONTENTS).map(name => `${SYNTAX_DIRECTORY}/${name}`);
export const SYNTAX_COMMANDS = [
	['mkdir', ['-p', SYNTAX_DIRECTORY], 0], ['cp', ['input file', 'copy 한글'], 0],
	['cat', ['copy 한글'], 0], ['grep', ['', 'copy 한글'], 0],
	['grep', ['^space value$', 'copy 한글'], 0], ['grep', ['absent', 'copy 한글'], 1],
	['grep', ['absent', 'copy 한글'], 1], ['cat', ['input file'], 0], ['cat', [], 0],
	['cat', ['input file'], 0], ['cat', ['input file'], 0], ['cat', ['input file'], 0]
];
export const RUNS = ['cold', 'warm', 'interrupt', 'failure', 'pipeline', 'redirection', 'startup-failure', 'syntax'];
export const RUN_SCRIPTS = { cold: SCRIPT, warm: SCRIPT, interrupt: INTERRUPT_SCRIPT, failure: FAILURE_SCRIPT, pipeline: PIPELINE_SCRIPT,
	redirection: REDIRECTION_SCRIPT, 'startup-failure': "printf 'must-not-execute\\n'\n", syntax: SYNTAX_SCRIPT };
// Separate live profile: actual Bash keeps its producer pipe open until the
// owner edits a header and a concurrent real BusyBox reads it during Clang.
export const LIVE_CLANG_SCRIPT = [
	'set -eu', 'mkdir -p /workspace/live', 'cd /workspace/live',
	"printf 'before_editor\\n' > live.h",
	"{ printf '/* streamed input */\\n'; IFS= read -r release; test \"$release\" = release; printf '#include \"live.h\"\\n'; } | clang -E -P -x c - | cat > preprocessed.txt",
	'cat preprocessed.txt', 'clang --version 0<&- > version.txt 2> version.err'
].join('\n') + '\n';
export const LIVE_CLANG_FILES = ['/workspace/live/live.h', '/workspace/live/preprocessed.txt', '/workspace/live/version.txt', '/workspace/live/version.err'];

async function pinned(file, expected) {
	assert(path.isAbsolute(file), 'absolute input paths required');
	const stat = await lstat(file);
	assert(stat.isFile() && !stat.isSymbolicLink(), `regular pinned input required: ${file}`);
	assert.equal(stat.size, expected.bytes, `input byte count: ${file}`);
	const bytes = await readFile(file);
	assert.deepEqual(identity(bytes), expected, `input identity: ${file}`);
	return bytes;
}

export async function readPinnedProbeInputs(configuration) {
	selectClangProfile(configuration.clangFilesystem);
	assert.equal(configuration.packageReceiptSha256, PACKAGE_RECEIPT.sha256);
	const receipt = JSON.parse(await pinned(configuration.packageReceipt, PACKAGE_RECEIPT));
	assert.equal(receipt.complete, true, 'actual completed SDK package required');
	assert.equal(receipt.guestQualified, false, 'packaging is not guest acceptance');
	assert.equal(receipt.binaryReceiptIdentity.sha256, BINARY_RECEIPT_SHA256);
	assert.deepEqual(receipt.entries['wasmer_js_bg.wasm'], SDK_WASM);
	assert.deepEqual(receipt.memoryProfile, { shared: true, minimumPages: MEMORY.initial, maximumPages: MEMORY.maximum });
	assert.equal(receipt.packageId, 'sha256-' + digest(Buffer.from(JSON.stringify(receipt.entries))));
	const packageRoot = path.join(path.dirname(configuration.packageReceipt), receipt.packageId);
	const entries = new Map();
	for (const [name, expected] of Object.entries(receipt.entries)) {
		assert(/^[A-Za-z0-9_.-]+$/.test(name), 'single package entry name required');
		entries.set(name, await pinned(path.join(packageRoot, name), expected));
	}
	for (const name of ['index.mjs', 'worker.mjs', 'wasmer_js_bg.wasm'])
		assert(entries.has(name), `missing actual package entry: ${name}`);
	const bash = await pinned(configuration.bashWebc, BASH_WEBC);
	// BusyBox: the producer's passing receipt and its exact artifact.
	assert.equal(configuration.busyboxReceiptSha256, BUSYBOX_RECEIPT_SHA256);
	const busyboxReceiptBytes = await readFile(configuration.busyboxReceipt);
	assert.equal(digest(busyboxReceiptBytes), configuration.busyboxReceiptSha256, 'BusyBox receipt digest');
	const busyboxReceipt = JSON.parse(busyboxReceiptBytes);
	assert.equal(busyboxReceipt.status, 'producer-smoke-passed');
	assert.equal(busyboxReceipt.b1SmokePassed, true);
	assert.equal(busyboxReceipt.wasiNodeSmokePassed, true);
	assert.deepEqual(busyboxReceipt.nodeWasiApplets, BUSYBOX_APPLETS);
	assert.deepEqual({ bytes: busyboxReceipt.wasi.artifact.size, sha256: busyboxReceipt.wasi.artifact.sha256 }, BUSYBOX);
	const busybox = await pinned(configuration.busyboxWasm, BUSYBOX);
	// Clang/LLD/sysroot: the same producer gates as the Clang browser qualification.
	const clang = await loadClangBrowserInputs({
		CONTAINER_PRODUCER_RECEIPT: configuration.clangProducerReceipt,
		CONTAINER_PRODUCER_RECEIPT_SHA256: configuration.clangProducerReceiptSha256,
		CONTAINER_PRODUCER_SMOKE: configuration.clangProducerSmoke,
		CONTAINER_PRODUCER_SMOKE_SHA256: configuration.clangProducerSmokeSha256,
		CONTAINER_CLANG_WASM: configuration.clangWasm,
		CONTAINER_LLD_WASM: configuration.lldWasm,
		CONTAINER_SYSROOT: configuration.sysroot
	});
	// User programs need the initial_cwd contract to run in the shell's directory; the
	// process-profile sysroot is derived from the pinned one with only crt1.o changed.
	assert.equal(configuration.processSysrootReceiptSha256, PROCESS_SYSROOT_RECEIPT_SHA256);
	const processReceiptBytes = await readFile(configuration.processSysrootReceipt);
	assert.equal(digest(processReceiptBytes), PROCESS_SYSROOT_RECEIPT_SHA256, 'process sysroot receipt digest');
	const processReceipt = JSON.parse(processReceiptBytes);
	assert.equal(processReceipt.complete, true);
	assert.equal(processReceipt.producerTreeClean, true);
	assert.equal(processReceipt.inputs.sysroot.sha256, FULL_SYSROOT_SHA256);
	assert.deepEqual(processReceipt.changedEntries, ['lib/wasm32-wasi/crt1.o']);
	assert.equal(processReceipt.cwdFixture?.passed, true);
	assert.deepEqual(processReceipt.outputs['sysroot.tar'], PROCESS_SYSROOT);
	const processSysroot = await pinned(configuration.processSysroot, PROCESS_SYSROOT);
	const logical = { ...PROCESS_SYSROOT, mediaType: 'application/x-tar' };
	clang.assets.sysroot = {
		delivery: processSysroot,
		metadata: { id: 'sysroot', encoding: 'identity', delivery: logical, logical }
	};
	return {
		receipt, packageRoot, entries, bash, busybox, clang,
		busyboxReceiptSha256: configuration.busyboxReceiptSha256,
		processSysroot: { receiptSha256: PROCESS_SYSROOT_RECEIPT_SHA256, producerCommit: processReceipt.producerCommit,
			derivedFrom: FULL_SYSROOT_SHA256, crt1: processReceipt.crt1.derived }
	};
}

const decode = (bytes) => Buffer.from(Array.isArray(bytes) || bytes instanceof Uint8Array ? bytes : []).toString('utf8');
const same = (actual, expected) => Array.isArray(actual) &&
	actual.length === expected.length && actual.every((byte, index) => byte === expected[index]);

// Existing evidence predates the shared command registry. Preserve its original
// six-route contract while new receipts require the complete current inventory.
const LEGACY_SHELL_COMMANDS = Object.freeze(['cat', 'cp', 'grep', 'mkdir', 'mv', 'rm']);
const shellCommandsFor = receipt => receipt.busybox?.shellCommands === undefined ? LEGACY_SHELL_COMMANDS : BUSYBOX_SHELL_COMMANDS;

/** One run's acceptance. `downloads` are the server's body counts at the run's start and end. */
function judgeRun(run, result, downloads, assetPaths, checks, clangAdapterId = 'llvm-clang-tool-host-v1', shellCommands = LEGACY_SHELL_COMMANDS, registryMatches = true) {
	const check = (id, passed, observed) => checks.push({ id: `${run}:${id}`, passed: Boolean(passed), observed });
	const completed = result?.type === 'result' && result.backendCompleted === true;
	const output = result?.result;
	check('script', completed && output.code === 0 && decode(output.stdout) === 'hello\n' &&
		decode(output.stderr) === CLANG_TRIPLE_WARNING,
		{ type: result?.type, code: output?.code, stdout: decode(output?.stdout), stderr: decode(output?.stderr), error: result?.error });
	check('workspace-files', same(result?.files?.['/workspace/demo/main.c'], SOURCE) &&
		decode(result?.files?.['/workspace/demo/result.txt']) === 'hello\n', result?.files && Object.keys(result.files));
	check('artifact', same(result?.artifact?.magic?.slice(0, 4), [0, 97, 115, 109]) && result.artifact.bytes > 8, result?.artifact);
	// Each command reached the container in the shell's cwd and exited 0 there.
	const invocations = result?.invocations ?? [], records = result?.records ?? [];
	const order = invocations.map((invocation) => invocation.path);
	const expected = DISPATCHES.map((dispatch) => dispatch.path);
	const pipeline = (paths) => paths.map((path) => DISPATCHES.find((d) => d.path === path)?.pipeline ? 'pipeline' : path);
	check('dispatch-order', order.length === expected.length &&
		JSON.stringify(pipeline(order)) === JSON.stringify(pipeline(expected)) &&
		expected.every((path) => order.includes(path)), order);
	check('shared-cwd', DISPATCHES.every((dispatch) => invocations.find((invocation) => invocation.path === dispatch.path)?.cwd === dispatch.cwd),
		invocations.map(({ path, cwd }) => [path, cwd]));
	check('supervisor-exits', records.length === expected.length && records.every((record) =>
		record.status === 0 && record.result?.reason === 'exited' && record.result?.code === 0 && Number.isSafeInteger(record.pid)),
	records.map(({ path, status, pid }) => [path, status, pid]));
	check('artifact-in-supervisor', records.some((record) => record.path === '/workspace/demo/hello.wasm' && record.status === 0),
		records.map(({ path }) => path));
	check('processes-retired', completed && Array.isArray(result.containerProcesses) && !result.containerProcesses.length,
		result?.containerProcesses?.length);
	check('metadata-only-lookup', registryMatches && result?.assetsBeforeShell?.cachedEntries === 0 &&
		result?.lookups?.clang === 'llvm' && shellCommands.every((name) => result.lookups[name] === 'busybox'), result?.lookups);
	const clang = result?.clangCommand;
	check('clang-multicall-profile', clang?.path === 'bin/llvm' && clang.argv0 === LLVM_EXECUTABLE &&
		clang.package === 'llvm' && clang.adapter === clangAdapterId && same(clang.prefixArgs, ['clang', ...CLANG_PROFILE]), clang);
	// Lazy loading: no asset is requested before the command that needs it.
	const timeline = result?.timeline ?? [];
	const first = (predicate) => timeline.find(predicate)?.seq ?? Infinity;
	const fetches = (name) => timeline.filter((entry) => entry.type === 'fetch' && entry.url.endsWith(`/assets/${name}`));
	const dispatchOf = (path) => first((entry) => entry.type === 'dispatch' && entry.path === path);
	const fetched = (name) => downloads.end[`/assets/${name}`] - downloads.start[`/assets/${name}`];
	if (run === 'cold') {
		check('shell-lazy', ['sdk', 'bash'].every(name => fetches(name).length === 1 && fetches(name)[0].seq > first(entry => entry.type === 'shellStart') && fetched(name) === 1) &&
			result?.shellAssetsBefore?.cachedEntries === 0, { fetches: ['sdk', 'bash'].map(fetches), before: result?.shellAssetsBefore });
		check('busybox-lazy', fetches('busybox').length === 1 && fetches('busybox')[0].seq > dispatchOf(`${BIN}/mkdir`) &&
			fetched('busybox') === 1, { fetches: fetches('busybox'), mkdir: dispatchOf(`${BIN}/mkdir`) });
		check('clang-lazy', ['clang', 'lld', 'sysroot'].every((name) => fetches(name).length === 1 &&
			fetches(name)[0].seq > dispatchOf(`${BIN}/clang`) && fetched(name) === 1),
		{ clang: dispatchOf(`${BIN}/clang`), fetches: ['clang', 'lld', 'sysroot'].map((name) => fetches(name)) });
	} else {
		check('verified-cache-reuse', assetPaths.every((asset) => downloads.end[asset] === downloads.start[asset]) &&
			result?.assetsBeforeShell?.cachedEntries === 0, { downloads, assetsBeforeShell: result?.assetsBeforeShell });
	}
	check('sysroot-closure', result?.sysroot?.entries === 2285 && result.sysroot.files === 2168, result?.sysroot);
	check('public-api', result?.publicApi?.runtime?.includes('registerHostCommandDirectory') &&
		result.publicApi.directory?.includes('fromHostFileSystem') && result.publicApi.session === 'createWasixShellSession', result?.publicApi);
	check('virtual-command-metadata', registryMatches && same(Object.keys(result?.virtualCommands ?? {}).sort(), [...shellCommands, 'clang'].sort()) &&
		Object.values(result.virtualCommands).every(stat => stat.command === true && stat.mode === 0o555 && stat.size === 0), result?.virtualCommands);
	check('executable-artifact', (result?.artifact?.mode & 0o111) !== 0, result?.artifact?.mode);
	check('sdk-group-retired', result?.workerGroup?.disposed === true && result.workerGroup.active === 0 && result.workerGroup.created === result.workerGroup.terminated, result?.workerGroup);
	check('browser-errors', !result?.events?.some((event) => event.type === 'threadError') &&
		!result?.blockedRequests?.length && !result?.consoleErrors?.length, result?.consoleErrors);
	check('owned-workers-retired', result?.remainingWorkerTargets === 0, result?.remainingWorkerTargetDetails);
}

/** The owner interrupts a running artifact and a running compile; Bash continues. */
function judgeInterrupt(result, checks) {
	const check = (id, passed, observed) => checks.push({ id: `interrupt:${id}`, passed: Boolean(passed), observed });
	const completed = result?.type === 'result' && result.backendCompleted === true;
	const output = result?.result, stderr = decode(output?.stderr);
	const warnings = stderr.split(CLANG_TRIPLE_WARNING);
	check('script', completed && output.code === 0 && decode(output.stdout) === 'spin=130\nclang=130\ndiscarded\nhello\n' &&
		warnings.every((part) => part === '') && [3, 4].includes(warnings.length),
	{ type: result?.type, code: output?.code, stdout: decode(output?.stdout), stderr, error: result?.error });
	const records = result?.records ?? [];
	check('supervisor-statuses', JSON.stringify(records.map((record) => [record.path, record.status])) === JSON.stringify(INTERRUPT_DISPATCHES),
		records.map(({ path, status, startError, result: value }) => [path, status, startError ?? value?.reason]));
	// Each interrupt stopped exactly one command while it ran, between its dispatch and completion.
	const timeline = result?.timeline ?? [];
	const interrupts = timeline.filter((entry) => entry.type === 'interrupt');
	check('interrupted-while-running', interrupts.length === 2 && interrupts.every((entry) => entry.interrupted === 1) &&
		INTERRUPTS.every((plan, index) => {
			const dispatches = timeline.filter((entry) => entry.type === 'dispatch' && entry.path === plan.path);
			const ends = timeline.filter((entry) => entry.type === 'dispatchEnd' && entry.path === plan.path);
			const at = interrupts[index]?.seq;
			return at > dispatches[plan.occurrence - 1]?.seq && at < ends[plan.occurrence - 1]?.seq && ends[plan.occurrence - 1]?.status === 130;
		}), interrupts);
	check('interrupted-compile-discarded', result?.files?.['/workspace/demo/interrupted.wasm']?.error === 'ENOENT',
		result?.files?.['/workspace/demo/interrupted.wasm']);
	check('later-artifact', same(result?.artifact?.magic?.slice(0, 4), [0, 97, 115, 109]), result?.artifact);
	check('processes-retired', completed && Array.isArray(result.containerProcesses) && !result.containerProcesses.length,
		result?.containerProcesses?.length);
	check('browser-errors', !result?.events?.some((event) => event.type === 'threadError') &&
		!result?.blockedRequests?.length && !result?.consoleErrors?.length, result?.consoleErrors);
	check('owned-workers-retired', result?.remainingWorkerTargets === 0, result?.remainingWorkerTargetDetails);
}

/** Integrity failure, compile error and missing command, each contained; the shell continues. */
function judgeFailure(result, downloads, checks) {
	const check = (id, passed, observed) => checks.push({ id: `failure:${id}`, passed: Boolean(passed), observed });
	const completed = result?.type === 'result' && result.backendCompleted === true;
	const output = result?.result, stderr = decode(output?.stderr);
	const lines = stderr.split('\n').filter(Boolean);
	check('script', completed && output.code === 0 &&
		decode(output.stdout) === 'mkdir=126\nretry=126\nbad=1\nno-artifact\nmissing=127\nhello\n',
	{ type: result?.type, code: output?.code, stdout: decode(output?.stdout), stderr, error: result?.error });
	// Each integrity failure is one host diagnostic; the compiler's own diagnostics name bad.c.
	check('diagnostics', lines.filter((line) => line.startsWith('mkdir: ')).length === 2 &&
		lines.some((line) => /^bad\.c:1:\d+: error: /.test(line)) &&
		lines.some((line) => /^bash: line \d+: nosuch-command: command not found$/.test(line)), lines);
	const records = result?.records ?? [];
	check('supervisor-statuses', JSON.stringify(records.map((record) => [record.path, record.status, record.startError ?? record.result?.reason])) ===
		JSON.stringify(FAILURE_DISPATCHES), records.map(({ path, status, startError, result: value }) => [path, status, startError ?? value?.reason]));
	check('no-artifact-from-error', result?.files?.['/workspace/bad.wasm']?.error === 'ENOENT', result?.files?.['/workspace/bad.wasm']);
	check('later-artifact', same(result?.artifact?.magic?.slice(0, 4), [0, 97, 115, 109]), result?.artifact);
	// A failed body is fetched again by the retry, never served from a cache.
	const fetched = (name) => downloads.end[`/assets/${name}`] - downloads.start[`/assets/${name}`];
	check('integrity-not-cached', fetched('busybox-corrupt') === 2 && fetched('busybox') === 0, downloads);
	check('processes-retired', completed && Array.isArray(result.containerProcesses) && !result.containerProcesses.length,
		result?.containerProcesses?.length);
	check('browser-errors', !result?.events?.some((event) => event.type === 'threadError') &&
		!result?.blockedRequests?.length && !result?.consoleErrors?.length, result?.consoleErrors);
	check('owned-workers-retired', result?.remainingWorkerTargets === 0, result?.remainingWorkerTargetDetails);
}

/** Redirections inside piped groups and subshells: no `Invalid argument`, bytes land where asked. */
function judgePipeline(result, checks) {
	const check = (id, passed, observed) => checks.push({ id: `pipeline:${id}`, passed: Boolean(passed), observed });
	const completed = result?.type === 'result' && result.backendCompleted === true;
	const output = result?.result;
	check('script', completed && output.code === 0 && decode(output.stdout) === 'file=file\nsub=sub\nkept\n' &&
		decode(output.stderr) === 'top\ngroup\n',
	{ type: result?.type, code: output?.code, stdout: decode(output?.stdout), stderr: decode(output?.stderr), error: result?.error });
	check('workspace-files', decode(result?.files?.['/workspace/group-file']) === 'file\n' &&
		decode(result?.files?.['/workspace/sub-file']) === 'sub\n' && decode(result?.files?.['/workspace/err-file']) === 'aside\n',
	result?.files && Object.keys(result.files));
	const records = result?.records ?? [];
	check('supervisor-statuses', JSON.stringify(records.map((record) => [record.path, record.status])) === JSON.stringify(PIPELINE_DISPATCHES),
		records.map(({ path, status }) => [path, status]));
	check('processes-retired', completed && Array.isArray(result.containerProcesses) && !result.containerProcesses.length,
		result?.containerProcesses?.length);
	check('browser-errors', !result?.events?.some((event) => event.type === 'threadError') &&
		!result?.blockedRequests?.length && !result?.consoleErrors?.length, result?.consoleErrors);
	check('owned-workers-retired', result?.remainingWorkerTargets === 0, result?.remainingWorkerTargetDetails);
}

function judgeRedirection(result, checks) {
	const check = (id, passed, observed) => checks.push({ id: `redirection:${id}`, passed: Boolean(passed), observed });
	const output = result?.result, files = result?.files ?? {};
	check('script', result?.type === 'result' && result.backendCompleted === true && output?.code === 0 &&
		decode(output.stdout) === 'hello\nbad=1\ndata=126\nhello\nvirtual=1\n' && decode(output.stderr) === '', output);
	check('path-stat-access', decode(files['/workspace/command-path']) === `${BIN}/clang\n`, files['/workspace/command-path']);
	check('compiler-redirections', decode(files['/workspace/compile.out']) === '' &&
		decode(files['/workspace/compile.err']).includes(CLANG_TRIPLE_WARNING) && /clang version/.test(decode(files['/workspace/version.txt'])) &&
		decode(files['/workspace/failed.out']) === '' && /bad\.c:1:\d+: error:/.test(decode(files['/workspace/failed.err'])) &&
		files['/workspace/bad.wasm']?.error === 'ENOENT', Object.keys(files));
	check('artifact-mode-enforced', (result?.artifact?.mode & 0o111) !== 0 && result?.dataArtifactMode !== undefined && !(result.dataArtifactMode & 0o111) &&
		decode(files['/workspace/denied.out']) === '' && result?.records?.some(record => record.path === `${BIN}/wasm-run` && record.status === 0),
	{ artifactMode: result?.artifact?.mode, dataArtifactMode: result?.dataArtifactMode });
	check('virtual-entry-has-no-body', decode(files['/workspace/virtual-body']) === '' && decode(files['/workspace/virtual-error']).length > 0,
		files['/workspace/virtual-error']);
	check('processes-retired', Array.isArray(result?.containerProcesses) && result.containerProcesses.length === 0 && result?.workerGroup?.active === 0 && result.workerGroup.disposed === true, result?.workerGroup);
	check('browser-errors', !result?.blockedRequests?.length && !result?.consoleErrors?.length, result?.consoleErrors);
	check('owned-workers-retired', result?.remainingWorkerTargets === 0 && !result?.ownedCleanup?.cleanupError, result?.remainingWorkerTargetDetails);
}

/** Only real Bash decides these expansions, conditionals and redirection orders. */
function judgeSyntax(result, downloads, checks) {
	const check = (id, passed, observed) => checks.push({ id: `syntax:${id}`, passed: Boolean(passed), observed });
	const output = result?.result, files = result?.files ?? {}, invocations = result?.invocations ?? [], records = result?.records ?? [];
	const content = name => same(files[`${SYNTAX_DIRECTORY}/${name}`], text(SYNTAX_CONTENTS[name]));
	check('script', result?.type === 'result' && result.backendCompleted === true && output?.code === 0 && output.reason === 'exited' &&
		decode(output.stdout) === 'retained\nsyntax-ok\n' && decode(output.stderr) === '', output);
	check('quoted-argv', invocations.length === SYNTAX_COMMANDS.length && SYNTAX_COMMANDS.every(([name, args], index) =>
		invocations[index]?.path === `${BIN}/${name}` && same(invocations[index]?.argv?.slice(1), args)),
		invocations.map(({ path, argv }) => ({ path, argv })));
	check('quoted-files', ['input file', 'copy 한글', 'quoted.out', 'empty.out'].every(content), Object.keys(files));
	check('export-and-cwd', invocations.length === SYNTAX_COMMANDS.length && invocations.every((invocation, index) =>
		invocation.cwd === (index === 0 ? '/workspace' : SYNTAX_DIRECTORY) &&
		JSON.stringify(invocation.fixtureEnvironment) === JSON.stringify(index === 0 ? {} : SYNTAX_ENVIRONMENT)) && content('environment.out'),
		invocations.map(({ cwd, fixtureEnvironment }) => ({ cwd, fixtureEnvironment })));
	check('conditional-statuses', content('logic.out') && records.length === SYNTAX_COMMANDS.length && SYNTAX_COMMANDS.every(([name, , status], index) =>
		records[index]?.path === `${BIN}/${name}` && records[index].status === status && records[index].result?.reason === 'exited' &&
		records[index].result.code === status && Number.isSafeInteger(records[index].pid) && records[index].pid > 0),
		records.map(({ path, status, result, pid }) => ({ path, status, result, pid })));
	check('command-substitution', content('substitution.out'), files[`${SYNTAX_DIRECTORY}/substitution.out`]);
	check('stdin-truncate-append', ['input.out', 'append.out'].every(content), ['input.out', 'append.out'].map(name => files[`${SYNTAX_DIRECTORY}/${name}`]));
	check('redirection-order', ['merged.out', 'split.out'].every(content) && decode(output?.stdout) === 'retained\nsyntax-ok\n' && decode(output?.stderr) === '',
		['merged.out', 'split.out'].map(name => files[`${SYNTAX_DIRECTORY}/${name}`]));
	const compilerPaths = ['clang', 'lld', 'sysroot'].map(name => `/assets/${name}`);
	check('compiler-not-loaded', compilerPaths.every(path => Number.isSafeInteger(downloads.start[path]) && downloads.end[path] === downloads.start[path]) &&
		result?.sysroot === null && !(result.timeline ?? []).some(entry => entry.type === 'fetch' && compilerPaths.some(path => entry.url.endsWith(path))), downloads);
	check('public-session', result?.publicApi?.session === 'createWasixShellSession' && result.publicApi.runtime?.includes('registerHostCommand') &&
		result.publicApi.directory?.includes('fromHostFileSystem'), result?.publicApi);
	check('owned-cleanup', Array.isArray(result?.containerProcesses) && result.containerProcesses.length === 0 && result?.workerGroup?.disposed === true &&
		result.workerGroup.active === 0 && result.workerGroup.created > 0 && result.workerGroup.created === result.workerGroup.terminated &&
		result.remainingWorkerTargets === 0 && !result.ownedCleanup?.cleanupError && !result.consoleErrors?.length && !result.blockedRequests?.length,
		{ processes: result?.containerProcesses, workerGroup: result?.workerGroup, remainingWorkerTargets: result?.remainingWorkerTargets });
}

/** Live Clang has its own gate; it makes no snapshot rollback/cancel claim. */
export function judgeLiveShellAcceptance(receipt) {
	const checks = [], profile = selectClangProfile('live');
	const assets = ['sdk', 'bash', 'busybox', 'clang', 'lld', 'sysroot'].map(name => `/assets/${name}`);
	const check = (id, passed, observed) => checks.push({ id, passed: Boolean(passed), observed });
	check('live:explicit-profile', receipt.scenario === 'live-only' && receipt.clangFilesystem === 'live',
		{ scenario: receipt.scenario, clangFilesystem: receipt.clangFilesystem });
	for (const name of ['cold', 'warm']) {
		const entry = receipt.runs?.find(run => run.run === name);
		judgeRun(name, entry?.result, entry?.downloads ?? { start: {}, end: {} }, assets, checks, profile.adapterId,
			shellCommandsFor(receipt), receipt.busybox?.shellCommands === undefined || same(receipt.busybox.shellCommands, BUSYBOX_SHELL_COMMANDS));
	}
	const entry = receipt.runs?.find(run => run.run === 'live-io'), result = entry?.result, io = result?.liveIo;
	const output = result?.result, processed = result?.files?.[LIVE_CLANG_FILES[1]];
	check('live-io:actual-script-and-pipe-bytes', result?.type === 'result' && result.backendCompleted === true && output?.code === 0 &&
		decode(output.stderr) === CLANG_PREPROCESS_WARNINGS && decode(processed).trim() === 'after_editor' && same(output.stdout, processed),
		{ type: result?.type, output, processed });
	check('live-io:header-edit-during-compiler', io?.compilerRunningBeforeEdit === true &&
		decode(io.headerBefore) === 'before_editor\n' && decode(io.headerAfter) === 'after_editor\n' &&
		decode(result?.files?.[LIVE_CLANG_FILES[0]]) === 'after_editor\n', io);
	check('live-io:concurrent-real-utility', io?.utility?.code === 0 && io.utility.reason === 'exited' &&
		decode(io.utility.stdout) === 'after_editor\n' && decode(io.utility.stderr) === '' && io.compilerRunningAfterUtility === true,
		{ utility: io?.utility, compilerRunningAfterUtility: io?.compilerRunningAfterUtility });
	const invocations = result?.invocations ?? [], records = result?.records ?? [];
	check('live-io:actual-shell-dispatch', invocations.length === 5 &&
		invocations.filter(call => call.path === `${BIN}/mkdir` && call.cwd === '/workspace').length === 1 &&
		invocations.filter(call => call.path === `${BIN}/cat` && call.cwd === '/workspace/live').length === 2 &&
		invocations.some(call => call.path === `${BIN}/clang` && call.cwd === '/workspace/live' && same(call.argv?.slice(1), ['-E', '-P', '-x', 'c', '-'])), invocations);
	check('live-io:live-command-profile', result?.clangCommand?.adapter === profile.adapterId &&
		result.clangCommand.argv0 === LLVM_EXECUTABLE && records.length === 5 && records.every(record =>
			record.status === 0 && record.result?.reason === 'exited' && record.result.code === 0 && Number.isSafeInteger(record.pid)), records);
	check('live-io:closed-input-command', invocations.some(call => call.path === `${BIN}/clang` && same(call.argv?.slice(1), ['--version']) &&
		call.descriptors?.[0] === null) && decode(result?.files?.[LIVE_CLANG_FILES[2]]).startsWith('clang version ') &&
		decode(result?.files?.[LIVE_CLANG_FILES[3]]) === CLANG_TRIPLE_WARNING,
		{ stdout: result?.files?.[LIVE_CLANG_FILES[2]], stderr: result?.files?.[LIVE_CLANG_FILES[3]] });
	check('live-io:verified-cache-reuse', assets.every(path => Number.isSafeInteger(entry?.downloads?.start?.[path]) &&
		entry.downloads.start[path] === entry.downloads.end?.[path]) &&
		result?.assetsBeforeShell?.cachedEntries === 0, entry?.downloads);
	check('live-io:full-sysroot', result?.sysroot?.entries === 2285 && result.sysroot.files === 2168, result?.sysroot);
	check('live-io:owned-resources-retired', Array.isArray(result?.containerProcesses) && result.containerProcesses.length === 0 &&
		result?.workerGroup?.disposed === true && result.workerGroup.active === 0 && result.workerGroup.created === result.workerGroup.terminated &&
		result.remainingWorkerTargets === 0 && !result.ownedCleanup?.cleanupError, result?.workerGroup);
	check('live-io:browser-errors', !result?.consoleErrors?.length && !result?.blockedRequests?.length &&
		!result?.events?.some(event => event.type === 'threadError'), result?.consoleErrors);
	check('context-cleanup', receipt.initialWorkerTargets === 0 && receipt.workersAfterContextClose === 0,
		[receipt.initialWorkerTargets, receipt.workersAfterContextClose]);
	if (receipt.diagnosticOptions?.omittedTmpMount === true) check('required-mount-profile', false, 'Diagnostic run omitted common /tmp');
	const passed = checks.every(entry => entry.passed);
	return { checks, passed: checks.filter(entry => entry.passed).length, total: checks.length,
		liveShellAcceptancePassed: passed, liveCompilerFilesystemQualified: passed,
		shellAcceptancePassed: false, shellSyntaxPassed: false, commonContainerFdVfsQualified: false, shellBackendReady: false };
}

export function judgeShellAcceptance(receipt) {
	const checks = [];
	const syntaxOnly = receipt.scenario === 'syntax-only';
	const assetPaths = ['sdk', 'bash', 'busybox', 'clang', 'lld', 'sysroot'].map((name) => `/assets/${name}`);
	for (const run of syntaxOnly ? ['syntax'] : RUNS) {
		const entry = receipt.runs?.find((candidate) => candidate.run === run);
		if (run === 'interrupt') judgeInterrupt(entry?.result, checks);
		else if (run === 'failure') judgeFailure(entry?.result, entry?.downloads ?? { start: {}, end: {} }, checks);
		else if (run === 'pipeline') judgePipeline(entry?.result, checks);
		else if (run === 'redirection') judgeRedirection(entry?.result, checks);
		else if (run === 'syntax') judgeSyntax(entry?.result, entry?.downloads ?? { start: {}, end: {} }, checks);
		else if (run === 'startup-failure') {
			const result = entry?.result;
			checks.push({ id: 'startup-failure:runtime-error', passed: result?.type === 'result' && result.backendCompleted === true &&
				result.result?.code === null && result.result?.reason === 'runtime-error' && decode(result.result.stdout) === '' && decode(result.result.stderr) === '' &&
				Array.isArray(result.records) && result.records.length === 0, observed: result?.result });
			checks.push({ id: 'startup-failure:owned-cleanup', passed: result?.workerGroup?.disposed === true && result.workerGroup.active === 0 &&
				result.workerGroup.created > 0 && result.workerGroup.created === result.workerGroup.terminated && result.remainingWorkerTargets === 0 &&
				!result.ownedCleanup?.cleanupError && !result.consoleErrors?.length && !result.blockedRequests?.length, observed: result?.workerGroup });
		}
		else judgeRun(run, entry?.result, entry?.downloads ?? { start: {}, end: {} }, assetPaths, checks, undefined,
			shellCommandsFor(receipt), receipt.busybox?.shellCommands === undefined || same(receipt.busybox.shellCommands, BUSYBOX_SHELL_COMMANDS));
	}
	checks.push({ id: 'context-cleanup', passed: receipt.initialWorkerTargets === 0 && receipt.workersAfterContextClose === 0,
		observed: [receipt.initialWorkerTargets, receipt.workersAfterContextClose] });
	if (receipt.diagnosticOptions?.omittedTmpMount === true) checks.push({ id: 'required-mount-profile', passed: false,
		observed: 'Diagnostic run omitted the required common /tmp mount' });
	return {
		checks,
		passed: checks.filter((entry) => entry.passed).length,
		total: checks.length,
		shellAcceptancePassed: !syntaxOnly && checks.every((entry) => entry.passed),
		shellSyntaxPassed: checks.filter(entry => entry.id.startsWith('syntax:') || entry.id === 'context-cleanup' || entry.id === 'required-mount-profile').every(entry => entry.passed),
		commonContainerFdVfsQualified: false,
		shellBackendReady: false
	};
}
