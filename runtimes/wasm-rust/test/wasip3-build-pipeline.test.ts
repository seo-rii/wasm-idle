import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDirs: string[] = [];

async function makeTempDir() {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wasm-rust-wasip3-build-'));
	tempDirs.push(dir);
	return dir;
}

async function createMissingRipgrepShim(root: string) {
	const fakeBinDir = path.join(root, 'fake-bin');
	await fs.mkdir(fakeBinDir, { recursive: true });
	await fs.writeFile(path.join(fakeBinDir, 'rg'), '#!/usr/bin/env bash\nexit 127\n', 'utf8');
	await fs.chmod(path.join(fakeBinDir, 'rg'), 0o755);
	return fakeBinDir;
}

describe('wasm32-wasip3 build pipeline', () => {
	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
	});

	it('prepares a rust source checkout that already contains wasm32-wasip3 target support', async () => {
		const root = await makeTempDir();
		const remoteRoot = path.join(root, 'remote-rust');
		const preparedRoot = path.join(root, 'prepared-rust');

		await fs.mkdir(path.join(remoteRoot, 'compiler', 'rustc_target', 'src', 'spec', 'targets'), {
			recursive: true
		});
		await fs.writeFile(
			path.join(remoteRoot, 'compiler', 'rustc_target', 'src', 'spec', 'targets', 'wasm32_wasip3.rs'),
			'// target is present\n'
		);
		await execFileAsync('git', ['init', '--initial-branch=main', remoteRoot], {
			cwd: projectRoot,
			maxBuffer: 8 * 1024 * 1024
		});
		await execFileAsync('git', ['-C', remoteRoot, 'config', 'user.email', 'wasm-rust@example.com'], {
			cwd: projectRoot,
			maxBuffer: 8 * 1024 * 1024
		});
		await execFileAsync('git', ['-C', remoteRoot, 'config', 'user.name', 'wasm-rust'], {
			cwd: projectRoot,
			maxBuffer: 8 * 1024 * 1024
		});
		await execFileAsync('git', ['-C', remoteRoot, 'add', '.'], {
			cwd: projectRoot,
			maxBuffer: 8 * 1024 * 1024
		});
		await execFileAsync('git', ['-C', remoteRoot, 'commit', '-m', 'add wasm32-wasip3 target'], {
			cwd: projectRoot,
			maxBuffer: 8 * 1024 * 1024
		});
		const expectedRevision = (
			await execFileAsync('git', ['-C', remoteRoot, 'rev-parse', 'HEAD'], {
				cwd: projectRoot,
				maxBuffer: 8 * 1024 * 1024
			})
		).stdout.trim();

		const { stdout } = await execFileAsync('bash', ['./scripts/prepare-wasip3-rust-source.sh'], {
			cwd: projectRoot,
			env: {
				...process.env,
				WASM_RUST_CUSTOM_TOOLCHAIN_ROOT: root,
				WASM_RUST_RUST_SOURCE_ROOT: preparedRoot,
				WASM_RUST_SKIP_BROWSER_PATCHED_SOURCE: '1',
				WASM_RUST_RUST_SOURCE_REMOTE: remoteRoot,
				WASM_RUST_RUST_SOURCE_REF: 'main'
			},
			maxBuffer: 8 * 1024 * 1024
		});
		const lines = stdout
			.trim()
			.split('\n')
			.map((line) => line.split('='))
			.reduce<Record<string, string>>((acc, [key, ...value]) => {
				acc[key] = value.join('=');
				return acc;
			}, {});

		expect(lines.WASM_RUST_RUST_SOURCE_ROOT).toBe(preparedRoot);
		expect(lines.WASM_RUST_RUST_SOURCE_REV).toBe(expectedRevision);
		await expect(
			fs.readFile(path.join(preparedRoot, 'compiler', 'rustc_target', 'src', 'spec', 'targets', 'wasm32_wasip3.rs'), 'utf8')
		).resolves.toContain('target is present');
	});

	it('backports wasm32-wasip3 support into an existing browser-patched Rust checkout', async () => {
		const root = await makeTempDir();
		const browserPatchedRoot = path.join(root, 'browser-patched-rust');
		const preparedRoot = path.join(root, 'prepared-rust');

		await fs.mkdir(path.join(browserPatchedRoot, 'compiler', 'rustc_target', 'src', 'spec', 'targets'), {
			recursive: true
		});
		await fs.mkdir(path.join(browserPatchedRoot, 'compiler', 'rustc_mir_build', 'src', 'build'), {
			recursive: true
		});
		await fs.mkdir(path.join(browserPatchedRoot, 'src', 'bootstrap', 'src', 'core', 'build_steps'), {
			recursive: true
		});
		await fs.mkdir(path.join(browserPatchedRoot, 'library', 'std', 'src', 'sys', 'pal'), {
			recursive: true
		});
		await fs.mkdir(path.join(browserPatchedRoot, 'library', 'std', 'src', 'os'), {
			recursive: true
		});
		await fs.writeFile(path.join(browserPatchedRoot, 'config.wasm-rust-browser.toml'), '[build]\n');
		await fs.writeFile(
			path.join(browserPatchedRoot, 'compiler', 'rustc_target', 'src', 'spec', 'targets', 'wasm32_wasip2.rs'),
			'// existing wasip2 target\n'
		);
		await fs.writeFile(
			path.join(browserPatchedRoot, 'compiler', 'rustc_target', 'src', 'spec', 'mod.rs'),
			'supported_targets! {\n    ("wasm32-wasip2", wasm32_wasip2),\n}\n'
		);
		await fs.writeFile(
			path.join(browserPatchedRoot, 'compiler', 'rustc_mir_build', 'src', 'build', 'mod.rs'),
			'pub fn preserved_build_module() {}\n'
		);
		await fs.writeFile(
			path.join(browserPatchedRoot, 'src', 'bootstrap', 'src', 'core', 'build_steps', 'compile.rs'),
			`use crate::core::builder::TargetSelection;
fn demo(target: TargetSelection, builder: &Builder<'_>, cargo: &mut Cargo) {
    let srcdir = builder
        .wasi_root(target)
        .unwrap_or_else(|| {
            panic!(
                "Target {:?} does not have a \\"wasi-root\\" key in Config.toml",
                target.triple
            )
        })
        .join("lib")
        .join(target.to_string().replace("-preview1", "").replace("p2", "").replace("p1", ""));

    if target.contains("-wasi") {
        if let Some(p) = builder.wasi_root(target) {
            let root = format!(
                "native={}/lib/{}",
                p.to_str().unwrap(),
                target.to_string().replace("-preview1", "")
            );
            cargo.rustflag("-L").rustflag(&root);
        }
    }
}
`,
			'utf8'
		);
		await fs.writeFile(
			path.join(browserPatchedRoot, 'library', 'std', 'src', 'sys', 'pal', 'mod.rs'),
			`} else if #[cfg(all(target_os = "wasi", target_env = "p2"))] {\n    mod wasip2;\n    pub use self::wasip2::*;\n}\n`,
			'utf8'
		);
		await fs.writeFile(
			path.join(browserPatchedRoot, 'library', 'std', 'src', 'os', 'mod.rs'),
			'#[cfg(any(all(target_os = "wasi", target_env = "p2"), doc))]\npub mod wasip2;\n',
			'utf8'
		);

		const { stdout } = await execFileAsync('bash', ['./scripts/prepare-wasip3-rust-source.sh'], {
			cwd: projectRoot,
			env: {
				...process.env,
				WASM_RUST_CUSTOM_TOOLCHAIN_ROOT: root,
				WASM_RUST_RUST_SOURCE_ROOT: preparedRoot,
				WASM_RUST_BROWSER_PATCHED_SOURCE_ROOT: browserPatchedRoot
			},
			maxBuffer: 8 * 1024 * 1024
		});
		const lines = stdout
			.trim()
			.split('\n')
			.map((line) => line.split('='))
			.reduce<Record<string, string>>((acc, [key, ...value]) => {
				acc[key] = value.join('=');
				return acc;
			}, {});

		expect(lines.WASM_RUST_RUST_SOURCE_ROOT).toBe(preparedRoot);
		await expect(
			fs.readFile(path.join(preparedRoot, 'compiler', 'rustc_target', 'src', 'spec', 'targets', 'wasm32_wasip3.rs'), 'utf8')
		).resolves.toContain('target.options.env = "p3".into();');
		await expect(fs.readFile(path.join(preparedRoot, 'compiler', 'rustc_target', 'src', 'spec', 'mod.rs'), 'utf8')).resolves.toContain(
			'("wasm32-wasip3", wasm32_wasip3),'
		);
		await expect(
			fs.readFile(path.join(preparedRoot, 'compiler', 'rustc_mir_build', 'src', 'build', 'mod.rs'), 'utf8')
		).resolves.toContain('preserved_build_module');
		await expect(
			fs.readFile(path.join(preparedRoot, 'src', 'bootstrap', 'src', 'core', 'build_steps', 'compile.rs'), 'utf8')
		).resolves.toContain('if target == "wasm32-wasip3" { "wasm32-wasip2".to_string() } else {');
		await expect(
			fs.readFile(path.join(preparedRoot, 'library', 'std', 'src', 'sys', 'pal', 'mod.rs'), 'utf8')
		).resolves.toContain('target_env = "p3"');
		await expect(fs.readFile(path.join(preparedRoot, 'library', 'std', 'src', 'os', 'mod.rs'), 'utf8')).resolves.toContain(
			'target_env = "p3"'
		);
	});

	it('prepares a cargo overlay that patches libc for wasm32-wasip3 builds', async () => {
		const root = await makeTempDir();
		const baseCargoHome = path.join(root, 'base-cargo-home');
		const registrySrcRoot = path.join(baseCargoHome, 'registry', 'src', 'index.test');
		const libcSourceRoot = path.join(registrySrcRoot, 'libc-0.2.183');

		await fs.mkdir(path.join(libcSourceRoot, 'src'), { recursive: true });
		await fs.writeFile(path.join(libcSourceRoot, 'Cargo.toml'), '[package]\nname = "libc"\nversion = "0.2.183"\n');
		await fs.writeFile(path.join(libcSourceRoot, 'src', 'lib.rs'), 'pub fn patched() {}\n');
		await fs.mkdir(path.join(baseCargoHome, 'registry'), { recursive: true });
		await fs.writeFile(path.join(baseCargoHome, 'credentials.toml'), '[registry]\ntoken = "demo"\n');

		const { stdout } = await execFileAsync('bash', ['./scripts/prepare-wasip3-libc-overlay.sh'], {
			cwd: projectRoot,
			env: {
				...process.env,
				WASM_RUST_CUSTOM_TOOLCHAIN_ROOT: root,
				WASM_RUST_BASE_CARGO_HOME: baseCargoHome,
				WASM_RUST_CARGO_REGISTRY_SRC_ROOT: path.join(baseCargoHome, 'registry', 'src')
			},
			maxBuffer: 8 * 1024 * 1024
		});
		const lines = stdout
			.trim()
			.split('\n')
			.map((line) => line.split('='))
			.reduce<Record<string, string>>((acc, [key, ...value]) => {
				acc[key] = value.join('=');
				return acc;
			}, {});

		const patchedSource = lines.WASM_RUST_WASIP3_LIBC_PATCH_SOURCE;
		const patchedCargoHome = lines.WASM_RUST_WASIP3_CARGO_HOME;

		expect(patchedSource).toContain(path.join(root, 'wasip3-libc-overlay'));
		await expect(fs.readFile(path.join(patchedSource, 'Cargo.toml'), 'utf8')).resolves.toContain(
			'version = "0.2.183"'
		);
		await expect(fs.readFile(path.join(patchedCargoHome, 'config.toml'), 'utf8')).resolves.toContain(
			`libc = { path = "${patchedSource}" }`
		);
		await expect(fs.lstat(path.join(patchedCargoHome, 'registry'))).resolves.toMatchObject({
			isSymbolicLink: expect.any(Function)
		});
		expect((await fs.lstat(path.join(patchedCargoHome, 'registry'))).isSymbolicLink()).toBe(true);
	});

	it('rewrites the patched libc package version to match the Rust library lock when needed', async () => {
		const root = await makeTempDir();
		const rustRoot = path.join(root, 'rust');
		const baseCargoHome = path.join(root, 'base-cargo-home');
		const registrySrcRoot = path.join(baseCargoHome, 'registry', 'src', 'index.test');
		const libcSourceRoot = path.join(registrySrcRoot, 'libc-0.2.183');

		await fs.mkdir(path.join(rustRoot, 'library'), { recursive: true });
		await fs.writeFile(
			path.join(rustRoot, 'library', 'Cargo.lock'),
			'[[package]]\nname = "libc"\nversion = "0.2.178"\n'
		);
		await fs.mkdir(path.join(libcSourceRoot, 'src'), { recursive: true });
		await fs.writeFile(path.join(libcSourceRoot, 'Cargo.toml'), '[package]\nname = "libc"\nversion = "0.2.183"\n');
		await fs.writeFile(path.join(libcSourceRoot, 'src', 'lib.rs'), 'pub fn patched() {}\n');

		const { stdout } = await execFileAsync('bash', ['./scripts/prepare-wasip3-libc-overlay.sh'], {
			cwd: projectRoot,
			env: {
				...process.env,
				WASM_RUST_CUSTOM_TOOLCHAIN_ROOT: root,
				WASM_RUST_RUST_SOURCE_ROOT: rustRoot,
				WASM_RUST_BASE_CARGO_HOME: baseCargoHome,
				WASM_RUST_CARGO_REGISTRY_SRC_ROOT: path.join(baseCargoHome, 'registry', 'src')
			},
			maxBuffer: 8 * 1024 * 1024
		});
		const lines = stdout
			.trim()
			.split('\n')
			.map((line) => line.split('='))
			.reduce<Record<string, string>>((acc, [key, ...value]) => {
				acc[key] = value.join('=');
				return acc;
			}, {});

		expect(lines.WASM_RUST_WASIP3_LIBC_PATCH_SOURCE).toContain(path.join(root, 'wasip3-libc-overlay', 'libc-0.2.178'));
		await expect(fs.readFile(path.join(lines.WASM_RUST_WASIP3_LIBC_PATCH_SOURCE, 'Cargo.toml'), 'utf8')).resolves.toContain(
			'version = "0.2.178"'
		);
	});

	it('rewrites the patched libc package version to match the Rust workspace lock when the library lock is absent', async () => {
		const root = await makeTempDir();
		const rustRoot = path.join(root, 'rust');
		const baseCargoHome = path.join(root, 'base-cargo-home');
		const registrySrcRoot = path.join(baseCargoHome, 'registry', 'src', 'index.test');
		const libcSourceRoot = path.join(registrySrcRoot, 'libc-0.2.183');

		await fs.mkdir(rustRoot, { recursive: true });
		await fs.writeFile(
			path.join(rustRoot, 'Cargo.lock'),
			'[[package]]\nname = "libc"\nversion = "0.2.153"\n'
		);
		await fs.mkdir(path.join(libcSourceRoot, 'src'), { recursive: true });
		await fs.writeFile(path.join(libcSourceRoot, 'Cargo.toml'), '[package]\nname = "libc"\nversion = "0.2.183"\n');
		await fs.writeFile(path.join(libcSourceRoot, 'src', 'lib.rs'), 'pub fn patched() {}\n');

		const { stdout } = await execFileAsync('bash', ['./scripts/prepare-wasip3-libc-overlay.sh'], {
			cwd: projectRoot,
			env: {
				...process.env,
				WASM_RUST_CUSTOM_TOOLCHAIN_ROOT: root,
				WASM_RUST_RUST_SOURCE_ROOT: rustRoot,
				WASM_RUST_BASE_CARGO_HOME: baseCargoHome,
				WASM_RUST_CARGO_REGISTRY_SRC_ROOT: path.join(baseCargoHome, 'registry', 'src')
			},
			maxBuffer: 8 * 1024 * 1024
		});
		const lines = stdout
			.trim()
			.split('\n')
			.map((line) => line.split('='))
			.reduce<Record<string, string>>((acc, [key, ...value]) => {
				acc[key] = value.join('=');
				return acc;
			}, {});

		expect(lines.WASM_RUST_WASIP3_LIBC_PATCH_SOURCE).toContain(path.join(root, 'wasip3-libc-overlay', 'libc-0.2.153'));
		await expect(fs.readFile(path.join(lines.WASM_RUST_WASIP3_LIBC_PATCH_SOURCE, 'Cargo.toml'), 'utf8')).resolves.toContain(
			'version = "0.2.153"'
		);
	});

	it('materializes the patched libc source from a downloaded crate when the cargo cache misses', async () => {
		const root = await makeTempDir();
		const archiveRoot = path.join(root, 'archive');
		const archiveSourceRoot = path.join(archiveRoot, 'libc-0.2.183');
		const cratePath = path.join(root, 'libc-0.2.183.crate');

		await fs.mkdir(path.join(archiveSourceRoot, 'src'), { recursive: true });
		await fs.writeFile(path.join(archiveSourceRoot, 'Cargo.toml'), '[package]\nname = "libc"\nversion = "0.2.183"\n');
		await fs.writeFile(path.join(archiveSourceRoot, 'src', 'lib.rs'), 'pub fn downloaded() {}\n');
		await execFileAsync('tar', ['-czf', cratePath, '-C', archiveRoot, 'libc-0.2.183'], {
			cwd: projectRoot,
			maxBuffer: 8 * 1024 * 1024
		});

		const { stdout } = await execFileAsync('bash', ['./scripts/prepare-wasip3-libc-overlay.sh'], {
			cwd: projectRoot,
			env: {
				...process.env,
				WASM_RUST_CUSTOM_TOOLCHAIN_ROOT: root,
				WASM_RUST_BASE_CARGO_HOME: path.join(root, 'base-cargo-home'),
				WASM_RUST_CARGO_REGISTRY_SRC_ROOT: path.join(root, 'missing-registry-src'),
				WASM_RUST_WASIP3_LIBC_DOWNLOAD_URL: `file://${cratePath}`
			},
			maxBuffer: 8 * 1024 * 1024
		});
		const lines = stdout
			.trim()
			.split('\n')
			.map((line) => line.split('='))
			.reduce<Record<string, string>>((acc, [key, ...value]) => {
				acc[key] = value.join('=');
				return acc;
			}, {});

		await expect(fs.readFile(path.join(lines.WASM_RUST_WASIP3_LIBC_PATCH_SOURCE, 'src', 'lib.rs'), 'utf8')).resolves.toContain(
			'downloaded'
		);
	});

	it('wires the libc cargo overlay into the custom toolchain build when wasm32-wasip3 is requested', async () => {
		const root = await makeTempDir();
		const rustRoot = path.join(root, 'rust');
		const llvmBuildDir = path.join(root, 'llvm', 'build');
		const fakeBinDir = path.join(root, 'fake-bin');
		const fakeWasiSdkRoot = path.join(root, 'wasi-sdk');
		const baseCargoHome = path.join(root, 'base-cargo-home');
		const registrySrcRoot = path.join(baseCargoHome, 'registry', 'src', 'index.test');
		const libcSourceRoot = path.join(registrySrcRoot, 'libc-0.2.183');
		const configPath = path.join(rustRoot, 'config.wasm-rust-browser.toml');
		const recordedCargoHomePath = path.join(root, 'recorded-cargo-home.txt');
		const recordedConfigPath = path.join(root, 'recorded-config-path.txt');
		const recordedPathPath = path.join(root, 'recorded-path.txt');
		const recordedThreadCFlagsPath = path.join(root, 'recorded-thread-cflags.txt');
		const recordedThreadCxxFlagsPath = path.join(root, 'recorded-thread-cxxflags.txt');

		await fs.mkdir(path.join(libcSourceRoot, 'src'), { recursive: true });
		await fs.writeFile(path.join(libcSourceRoot, 'Cargo.toml'), '[package]\nname = "libc"\nversion = "0.2.183"\n');
		await fs.writeFile(path.join(libcSourceRoot, 'src', 'lib.rs'), 'pub fn patched() {}\n');
		await fs.mkdir(llvmBuildDir, { recursive: true });
		await fs.mkdir(fakeBinDir, { recursive: true });
		await fs.mkdir(path.join(fakeWasiSdkRoot, 'bin'), { recursive: true });
		await fs.mkdir(path.join(fakeWasiSdkRoot, 'share', 'wasi-sysroot'), { recursive: true });
		await fs.mkdir(path.join(rustRoot, 'compiler', 'rustc_target', 'src', 'spec', 'targets'), {
			recursive: true
		});
		await fs.mkdir(rustRoot, { recursive: true });
		await fs.writeFile(configPath, '[build]\n');
		await fs.writeFile(
			path.join(rustRoot, 'compiler', 'rustc_target', 'src', 'spec', 'targets', 'wasm32_wasip3.rs'),
			'// target is present\n'
		);
		await fs.writeFile(
			path.join(rustRoot, 'x.py'),
			`#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$CARGO_HOME" > ${JSON.stringify(recordedCargoHomePath)}
printf '%s\\n' "$3" > ${JSON.stringify(recordedConfigPath)}
printf '%s\\n' "$PATH" > ${JSON.stringify(recordedPathPath)}
printf '%s\\n' "\${CFLAGS_wasm32_wasip1_threads:-}" > ${JSON.stringify(recordedThreadCFlagsPath)}
printf '%s\\n' "\${CXXFLAGS_wasm32_wasip1_threads:-}" > ${JSON.stringify(recordedThreadCxxFlagsPath)}
`,
			'utf8'
		);
		await fs.writeFile(
			path.join(fakeBinDir, 'cmake'),
			'#!/usr/bin/env bash\nset -euo pipefail\nexit 0\n',
			'utf8'
		);
		await fs.chmod(path.join(rustRoot, 'x.py'), 0o755);
		await fs.chmod(path.join(fakeBinDir, 'cmake'), 0o755);
		for (const toolName of ['clang', 'clang++', 'llvm-ar', 'llvm-ranlib', 'wasm-component-ld']) {
			const toolPath = path.join(fakeWasiSdkRoot, 'bin', toolName);
			await fs.writeFile(toolPath, '#!/usr/bin/env bash\nset -euo pipefail\nexit 0\n', 'utf8');
			await fs.chmod(toolPath, 0o755);
		}

		await execFileAsync('bash', ['./scripts/build-custom-rustc-toolchain.sh', '--', '--foreground'], {
			cwd: projectRoot,
			env: {
				...process.env,
				PATH: `${fakeBinDir}:${process.env.PATH || ''}`,
				WASM_RUST_CUSTOM_TOOLCHAIN_ROOT: root,
				WASM_RUST_RUST_SOURCE_ROOT: rustRoot,
				WASM_RUST_RUST_CONFIG: configPath,
				WASM_RUST_LLVM_BUILD_DIR: llvmBuildDir,
				WASM_RUST_INSTALL_TARGETS: 'x86_64-unknown-linux-gnu,wasm32-wasip3',
				WASM_RUST_WASI_SDK_ROOT: fakeWasiSdkRoot,
				WASM_RUST_BASE_CARGO_HOME: baseCargoHome,
				WASM_RUST_CARGO_REGISTRY_SRC_ROOT: path.join(baseCargoHome, 'registry', 'src')
			},
			maxBuffer: 8 * 1024 * 1024
		});

		const recordedCargoHome = (await fs.readFile(recordedCargoHomePath, 'utf8')).trim();
		const generatedConfigPath = (await fs.readFile(recordedConfigPath, 'utf8')).trim();
		const recordedPath = (await fs.readFile(recordedPathPath, 'utf8')).trim();
		const recordedThreadCFlags = (await fs.readFile(recordedThreadCFlagsPath, 'utf8')).trim();
		const recordedThreadCxxFlags = (await fs.readFile(recordedThreadCxxFlagsPath, 'utf8')).trim();
		expect(recordedCargoHome).toContain(path.join(root, 'wasip3-libc-overlay', 'cargo-home'));
		expect(generatedConfigPath).toContain(path.join(root, 'config.wasm-rust-browser.effective.toml'));
		expect(recordedPath.split(':')[0]).toBe(path.join(fakeWasiSdkRoot, 'bin'));
		expect(recordedThreadCFlags).toContain('--target=wasm32-wasip1-threads');
		expect(recordedThreadCFlags).toContain('-DBYTE_ORDER=__BYTE_ORDER__');
		expect(recordedThreadCxxFlags).toContain('--target=wasm32-wasip1-threads');
		expect(recordedThreadCxxFlags).toContain('-DBYTE_ORDER=__BYTE_ORDER__');
		await expect(fs.readFile(path.join(recordedCargoHome, 'config.toml'), 'utf8')).resolves.toContain(
			'libc = { path ='
		);
		await expect(fs.readFile(generatedConfigPath, 'utf8')).resolves.toContain(
			'target = ["x86_64-unknown-linux-gnu", "wasm32-wasip3"]'
		);
		await expect(fs.readFile(generatedConfigPath, 'utf8')).resolves.toContain("[target.'wasm32-wasip3']");
		await expect(fs.readFile(generatedConfigPath, 'utf8')).resolves.toContain(
			`linker = "${path.join(fakeWasiSdkRoot, 'bin', 'wasm-component-ld')}"`
		);
	});

	it('normalizes the browser host target backend config to llvm and invalidates stale stage2 rustc outputs', async () => {
		const root = await makeTempDir();
		const rustRoot = path.join(root, 'rust');
		const configPath = path.join(rustRoot, 'config.wasm-rust-browser.toml');
		const recordedConfigPath = path.join(root, 'recorded-config-path.txt');
		const staleStage2RustcPath = path.join(
			rustRoot,
			'build',
			'wasm32-wasip1-threads',
			'stage2',
			'bin',
			'rustc'
		);
		const staleInstalledRustcPath = path.join(rustRoot, 'dist-emit-ir', 'bin', 'rustc.wasm');

		await fs.mkdir(path.dirname(staleStage2RustcPath), { recursive: true });
		await fs.mkdir(path.dirname(staleInstalledRustcPath), { recursive: true });
		await fs.writeFile(
			configPath,
			`profile = "compiler"
change-id = 9999999

[rust]
codegen-backends = ["llvm"]

[build]
host = ["wasm32-wasip1-threads"]
target = ["x86_64-unknown-linux-gnu", "wasm32-wasip1", "wasm32-wasip2"]

[install]
prefix = "dist-emit-ir"

[target.'wasm32-wasip1-threads']
codegen-backends = ["cranelift", "llvm"]
`,
			'utf8'
		);
		await fs.writeFile(staleStage2RustcPath, 'stale-stage2-rustc', 'utf8');
		await fs.writeFile(staleInstalledRustcPath, 'stale-installed-rustc', 'utf8');
		await fs.writeFile(
			path.join(rustRoot, 'x.py'),
			`#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$3" > ${JSON.stringify(recordedConfigPath)}
exit 0
`,
			'utf8'
		);
		await fs.chmod(path.join(rustRoot, 'x.py'), 0o755);

		await execFileAsync('bash', ['./scripts/build-custom-rustc-toolchain.sh', '--', '--foreground'], {
			cwd: projectRoot,
			env: {
				...process.env,
				WASM_RUST_CUSTOM_TOOLCHAIN_ROOT: root,
				WASM_RUST_RUST_SOURCE_ROOT: rustRoot,
				WASM_RUST_RUST_CONFIG: configPath,
				WASM_RUST_INSTALL_TARGETS: 'x86_64-unknown-linux-gnu,wasm32-wasip1,wasm32-wasip2'
			},
			maxBuffer: 8 * 1024 * 1024
		});

		const generatedConfigPath = (await fs.readFile(recordedConfigPath, 'utf8')).trim();
		await expect(fs.readFile(generatedConfigPath, 'utf8')).resolves.toContain(
			'codegen-backends = ["llvm"]'
		);
		await expect(fs.readFile(generatedConfigPath, 'utf8')).resolves.not.toContain(
			'codegen-backends = ["cranelift", "llvm"]'
		);
		await expect(fs.access(staleStage2RustcPath)).rejects.toThrow();
		await expect(fs.access(staleInstalledRustcPath)).rejects.toThrow();
	});

	it('serially prebuilds llvm-cxxfilt before resuming LLVM install when the binary is missing', async () => {
		const root = await makeTempDir();
		const rustRoot = path.join(root, 'rust');
		const llvmBuildDir = path.join(root, 'llvm', 'build');
		const fakeBinDir = path.join(root, 'fake-bin');
		const configPath = path.join(rustRoot, 'config.wasm-rust-browser.toml');
		const recordedCmakeCallsPath = path.join(root, 'recorded-cmake-calls.txt');

		await fs.mkdir(path.join(llvmBuildDir, 'tools', 'llvm-cxxfilt', 'CMakeFiles', 'llvm-cxxfilt.dir'), {
			recursive: true
		});
		await fs.mkdir(path.join(llvmBuildDir, 'bin'), { recursive: true });
		await fs.mkdir(fakeBinDir, { recursive: true });
		await fs.mkdir(rustRoot, { recursive: true });
		await fs.writeFile(path.join(llvmBuildDir, 'Makefile'), 'all:\n');
		await fs.writeFile(
			path.join(llvmBuildDir, 'tools', 'llvm-cxxfilt', 'CMakeFiles', 'llvm-cxxfilt.dir', 'link.txt'),
			'placeholder\n'
		);
		await fs.writeFile(configPath, '[build]\n');
		await fs.writeFile(
			path.join(rustRoot, 'x.py'),
			'#!/usr/bin/env bash\nset -euo pipefail\nexit 0\n',
			'utf8'
		);
		await fs.writeFile(
			path.join(fakeBinDir, 'cmake'),
			`#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> ${JSON.stringify(recordedCmakeCallsPath)}
if [[ "$*" == *"--target llvm-cxxfilt"* ]]; then
  mkdir -p "$PWD/bin"
  printf '%s\\n' '#!/usr/bin/env bash' > "$PWD/bin/llvm-cxxfilt"
  chmod +x "$PWD/bin/llvm-cxxfilt"
  exit 0
fi
if [[ "$*" == *"--target install"* ]]; then
  [[ -x "$PWD/bin/llvm-cxxfilt" ]]
  exit 0
fi
exit 0
`,
			'utf8'
		);
		await fs.chmod(path.join(rustRoot, 'x.py'), 0o755);
		await fs.chmod(path.join(fakeBinDir, 'cmake'), 0o755);

		await execFileAsync('bash', ['./scripts/build-custom-rustc-toolchain.sh', '--', '--foreground'], {
			cwd: projectRoot,
			env: {
				...process.env,
				PATH: `${fakeBinDir}:${process.env.PATH || ''}`,
				WASM_RUST_CUSTOM_TOOLCHAIN_ROOT: root,
				WASM_RUST_RUST_SOURCE_ROOT: rustRoot,
				WASM_RUST_RUST_CONFIG: configPath,
				WASM_RUST_LLVM_BUILD_DIR: llvmBuildDir,
				WASM_RUST_INSTALL_TARGETS: 'x86_64-unknown-linux-gnu'
			},
			maxBuffer: 8 * 1024 * 1024
		});

		const cmakeCalls = (await fs.readFile(recordedCmakeCallsPath, 'utf8'))
			.trim()
			.split('\n')
			.filter(Boolean);
		expect(cmakeCalls[0]).toContain('--build . --target llvm-cxxfilt --config Release -- -j 1');
		expect(cmakeCalls[1]).toContain('--build . --target install --config Release -- -j 8');
		await expect(fs.access(path.join(llvmBuildDir, 'bin', 'llvm-cxxfilt'))).resolves.toBeUndefined();
	});

	it('drops a stale LLVM build dir when CMakeCache.txt points at a different source or build path', async () => {
		const root = await makeTempDir();
		const rustRoot = path.join(root, 'rust');
		const llvmBuildDir = path.join(root, 'llvm', 'build');
		const configPath = path.join(rustRoot, 'config.wasm-rust-browser.toml');
		const logPath = path.join(root, 'wasm-rust-custom-toolchain.log');
		const fakeBinDir = await createMissingRipgrepShim(root);

		await fs.mkdir(path.join(llvmBuildDir, 'tools'), { recursive: true });
		await fs.mkdir(path.join(rustRoot, 'src', 'llvm-project', 'llvm'), { recursive: true });
		await fs.writeFile(path.join(llvmBuildDir, 'Makefile'), 'all:\n');
		await fs.writeFile(
			path.join(llvmBuildDir, 'CMakeCache.txt'),
			[
				'THREADED_ENDIAN_FLAGS:STRING=-DBYTE_ORDER=__BYTE_ORDER__',
				'CMAKE_HOME_DIRECTORY:INTERNAL=/tmp/stale-rust-root/src/llvm-project/llvm',
				'CMAKE_CACHEFILE_DIR:INTERNAL=/tmp/stale-rust-root/build/wasm32-wasip1-threads/llvm/build'
			].join('\n')
		);
		await fs.writeFile(configPath, '[build]\n');
		await fs.writeFile(
			path.join(rustRoot, 'x.py'),
			'#!/usr/bin/env bash\nset -euo pipefail\nexit 0\n',
			'utf8'
		);
		await fs.chmod(path.join(rustRoot, 'x.py'), 0o755);

		await execFileAsync('bash', ['./scripts/build-custom-rustc-toolchain.sh', '--', '--foreground'], {
			cwd: projectRoot,
			env: {
				...process.env,
				PATH: `${fakeBinDir}:${process.env.PATH || ''}`,
				WASM_RUST_CUSTOM_TOOLCHAIN_ROOT: root,
				WASM_RUST_RUST_SOURCE_ROOT: rustRoot,
				WASM_RUST_RUST_CONFIG: configPath,
				WASM_RUST_LLVM_BUILD_DIR: llvmBuildDir,
				WASM_RUST_BUILD_LOG: logPath,
				WASM_RUST_INSTALL_TARGETS: 'x86_64-unknown-linux-gnu'
			},
			maxBuffer: 8 * 1024 * 1024
		});

		await expect(fs.access(llvmBuildDir)).rejects.toBeDefined();
		await expect(fs.readFile(logPath, 'utf8')).resolves.toContain('was removed because CMakeCache.txt points at stale llvm source dir');
	});

	it('removes duplicate installed rustlib artifacts before rerunning x.py install', async () => {
		const root = await makeTempDir();
		const rustRoot = path.join(root, 'rust');
		const installRoot = path.join(rustRoot, 'dist-emit-ir');
		const targetLibDir = path.join(installRoot, 'lib', 'rustlib', 'wasm32-wasip1', 'lib');
		const configPath = path.join(rustRoot, 'config.wasm-rust-browser.toml');
		const olderLibPath = path.join(targetLibDir, 'libstd-0000000000000001.rlib');
		const newerLibPath = path.join(targetLibDir, 'libstd-0000000000000002.rlib');
		const logPath = path.join(root, 'wasm-rust-custom-toolchain.log');

		await fs.mkdir(targetLibDir, { recursive: true });
		await fs.writeFile(configPath, '[build]\n\n[install]\nprefix = "dist-emit-ir"\n');
		await fs.writeFile(olderLibPath, 'older\n');
		await fs.writeFile(newerLibPath, 'newer\n');
		await fs.utimes(olderLibPath, new Date('2026-03-20T00:00:00Z'), new Date('2026-03-20T00:00:00Z'));
		await fs.utimes(newerLibPath, new Date('2026-03-21T00:00:00Z'), new Date('2026-03-21T00:00:00Z'));
		await fs.writeFile(
			path.join(rustRoot, 'x.py'),
			'#!/usr/bin/env bash\nset -euo pipefail\nexit 0\n',
			'utf8'
		);
		await fs.chmod(path.join(rustRoot, 'x.py'), 0o755);

		await execFileAsync('bash', ['./scripts/build-custom-rustc-toolchain.sh', '--', '--foreground'], {
			cwd: projectRoot,
			env: {
				...process.env,
				WASM_RUST_CUSTOM_TOOLCHAIN_ROOT: root,
				WASM_RUST_RUST_SOURCE_ROOT: rustRoot,
				WASM_RUST_RUST_CONFIG: configPath,
				WASM_RUST_INSTALL_TARGETS: 'wasm32-wasip1',
				WASM_RUST_BUILD_LOG: logPath
			},
			maxBuffer: 8 * 1024 * 1024
		});

		await expect(fs.access(olderLibPath)).rejects.toBeDefined();
		await expect(fs.readFile(newerLibPath, 'utf8')).resolves.toBe('newer\n');
		await expect(fs.readFile(logPath, 'utf8')).resolves.toContain('removed 1 duplicate installed rustlib artifact');
	});

	it('generates an x.py config when building from a fresh upstream checkout without a custom config file', async () => {
		const root = await makeTempDir();
		const rustRoot = path.join(root, 'rust');
		const llvmBuildDir = path.join(root, 'llvm', 'build');
		const fakeWasiSdkRoot = path.join(root, 'wasi-sdk');
		const baseCargoHome = path.join(root, 'base-cargo-home');
		const registrySrcRoot = path.join(baseCargoHome, 'registry', 'src', 'index.test');
		const libcSourceRoot = path.join(registrySrcRoot, 'libc-0.2.183');
		const missingConfigPath = path.join(rustRoot, 'config.wasm-rust-browser.toml');
		const recordedConfigPath = path.join(root, 'recorded-config-path.txt');
		const logPath = path.join(root, 'wasm-rust-custom-toolchain.log');

		await fs.mkdir(path.join(libcSourceRoot, 'src'), { recursive: true });
		await fs.writeFile(path.join(libcSourceRoot, 'Cargo.toml'), '[package]\nname = "libc"\nversion = "0.2.183"\n');
		await fs.writeFile(path.join(libcSourceRoot, 'src', 'lib.rs'), 'pub fn patched() {}\n');
		await fs.mkdir(path.join(fakeWasiSdkRoot, 'bin'), { recursive: true });
		await fs.mkdir(path.join(fakeWasiSdkRoot, 'share', 'wasi-sysroot'), { recursive: true });
		await fs.mkdir(path.join(rustRoot, 'compiler', 'rustc_target', 'src', 'spec', 'targets'), {
			recursive: true
		});
		await fs.writeFile(
			path.join(rustRoot, 'compiler', 'rustc_target', 'src', 'spec', 'targets', 'wasm32_wasip3.rs'),
			'// target is present\n'
		);
		await fs.writeFile(
			path.join(rustRoot, 'x.py'),
			`#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$3" > ${JSON.stringify(recordedConfigPath)}
`,
			'utf8'
		);
		await fs.chmod(path.join(rustRoot, 'x.py'), 0o755);
		for (const toolName of ['clang', 'clang++', 'llvm-ar', 'llvm-ranlib', 'wasm-component-ld']) {
			const toolPath = path.join(fakeWasiSdkRoot, 'bin', toolName);
			await fs.writeFile(toolPath, '#!/usr/bin/env bash\nset -euo pipefail\nexit 0\n', 'utf8');
			await fs.chmod(toolPath, 0o755);
		}

		await execFileAsync('bash', ['./scripts/build-custom-rustc-toolchain.sh', '--', '--foreground'], {
			cwd: projectRoot,
			env: {
				...process.env,
				WASM_RUST_CUSTOM_TOOLCHAIN_ROOT: root,
				WASM_RUST_RUST_SOURCE_ROOT: rustRoot,
				WASM_RUST_RUST_CONFIG: missingConfigPath,
				WASM_RUST_LLVM_BUILD_DIR: llvmBuildDir,
				WASM_RUST_INSTALL_TARGETS: 'x86_64-unknown-linux-gnu,wasm32-wasip1,wasm32-wasip2,wasm32-wasip3',
				WASM_RUST_WASI_SDK_ROOT: fakeWasiSdkRoot,
				WASM_RUST_BASE_CARGO_HOME: baseCargoHome,
				WASM_RUST_CARGO_REGISTRY_SRC_ROOT: path.join(baseCargoHome, 'registry', 'src')
			},
			maxBuffer: 8 * 1024 * 1024
		});

		const generatedConfigPath = (await fs.readFile(recordedConfigPath, 'utf8')).trim();
		expect(generatedConfigPath).toContain(path.join(root, 'config.wasm-rust-browser.effective.toml'));
		await expect(fs.readFile(generatedConfigPath, 'utf8')).resolves.toContain('host = ["wasm32-wasip1-threads"]');
		await expect(fs.readFile(generatedConfigPath, 'utf8')).resolves.toContain(
			'target = ["x86_64-unknown-linux-gnu", "wasm32-wasip1", "wasm32-wasip2", "wasm32-wasip3"]'
		);
		await expect(fs.readFile(generatedConfigPath, 'utf8')).resolves.toContain("[target.'wasm32-wasip2']");
		await expect(fs.readFile(logPath, 'utf8')).resolves.toContain(
			'skipping resume step and starting from x.py install'
		);
	});

	it('passes thread-aware endian defines through target-specific env vars without mutating an existing llvm config', async () => {
		const root = await makeTempDir();
		const rustRoot = path.join(root, 'rust');
		const llvmBuildDir = path.join(root, 'llvm', 'build');
		const configPath = path.join(rustRoot, 'config.wasm-rust-browser.toml');
		const recordedConfigPath = path.join(root, 'recorded-config-path.txt');
		const recordedThreadCFlagsPath = path.join(root, 'recorded-thread-cflags.txt');
		const recordedThreadCxxFlagsPath = path.join(root, 'recorded-thread-cxxflags.txt');

		await fs.mkdir(llvmBuildDir, { recursive: true });
		await fs.mkdir(rustRoot, { recursive: true });
		await fs.writeFile(configPath, '[llvm]\ncflags = "-O2"\ncxxflags = "-O3"\n[build]\n');
		await fs.writeFile(
			path.join(rustRoot, 'x.py'),
			`#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$3" > ${JSON.stringify(recordedConfigPath)}
printf '%s\\n' "\${CFLAGS_wasm32_wasip1_threads:-}" > ${JSON.stringify(recordedThreadCFlagsPath)}
printf '%s\\n' "\${CXXFLAGS_wasm32_wasip1_threads:-}" > ${JSON.stringify(recordedThreadCxxFlagsPath)}
`,
			'utf8'
		);
		await fs.chmod(path.join(rustRoot, 'x.py'), 0o755);

		await execFileAsync('bash', ['./scripts/build-custom-rustc-toolchain.sh', '--', '--foreground'], {
			cwd: projectRoot,
			env: {
				...process.env,
				WASM_RUST_CUSTOM_TOOLCHAIN_ROOT: root,
				WASM_RUST_RUST_SOURCE_ROOT: rustRoot,
				WASM_RUST_RUST_CONFIG: configPath,
				WASM_RUST_LLVM_BUILD_DIR: llvmBuildDir,
				WASM_RUST_INSTALL_TARGETS: 'x86_64-unknown-linux-gnu'
			},
			maxBuffer: 8 * 1024 * 1024
		});

		const generatedConfigPath = (await fs.readFile(recordedConfigPath, 'utf8')).trim();
		await expect(fs.readFile(generatedConfigPath, 'utf8')).resolves.toContain('cflags = "-O2"');
		await expect(fs.readFile(generatedConfigPath, 'utf8')).resolves.toContain('cxxflags = "-O3"');
		await expect(fs.readFile(recordedThreadCFlagsPath, 'utf8')).resolves.toContain(
			'--target=wasm32-wasip1-threads -DBYTE_ORDER=__BYTE_ORDER__ -DBIG_ENDIAN=__ORDER_BIG_ENDIAN__ -DLITTLE_ENDIAN=__ORDER_LITTLE_ENDIAN__'
		);
		await expect(fs.readFile(recordedThreadCxxFlagsPath, 'utf8')).resolves.toContain(
			'--target=wasm32-wasip1-threads -DBYTE_ORDER=__BYTE_ORDER__ -DBIG_ENDIAN=__ORDER_BIG_ENDIAN__ -DLITTLE_ENDIAN=__ORDER_LITTLE_ENDIAN__'
		);
	});

	it('skips external thread env flags when the rust source already carries the browser host bootstrap llvm patch', async () => {
		const root = await makeTempDir();
		const rustRoot = path.join(root, 'rust');
		const llvmBuildDir = path.join(root, 'llvm', 'build');
		const configPath = path.join(rustRoot, 'config.wasm-rust-browser.toml');
		const recordedThreadCFlagsPath = path.join(root, 'recorded-thread-cflags.txt');
		const recordedThreadCxxFlagsPath = path.join(root, 'recorded-thread-cxxflags.txt');
		const logPath = path.join(root, 'wasm-rust-custom-toolchain.log');
		const fakeBinDir = await createMissingRipgrepShim(root);

		await fs.mkdir(path.join(rustRoot, 'src', 'bootstrap', 'src', 'core', 'build_steps'), {
			recursive: true
		});
		await fs.mkdir(llvmBuildDir, { recursive: true });
		await fs.mkdir(rustRoot, { recursive: true });
		await fs.writeFile(
			path.join(rustRoot, 'src', 'bootstrap', 'src', 'core', 'build_steps', 'llvm.rs'),
			'if target.contains("wasip1-threads") {\n    cflags.push(" -matomics -mbulk-memory");\n}\n'
		);
		await fs.writeFile(configPath, '[build]\n');
		await fs.writeFile(
			path.join(rustRoot, 'x.py'),
			`#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "\${CFLAGS_wasm32_wasip1_threads:-}" > ${JSON.stringify(recordedThreadCFlagsPath)}
printf '%s\\n' "\${CXXFLAGS_wasm32_wasip1_threads:-}" > ${JSON.stringify(recordedThreadCxxFlagsPath)}
`,
			'utf8'
		);
		await fs.chmod(path.join(rustRoot, 'x.py'), 0o755);

		await execFileAsync('bash', ['./scripts/build-custom-rustc-toolchain.sh', '--', '--foreground'], {
			cwd: projectRoot,
			env: {
				...process.env,
				PATH: `${fakeBinDir}:${process.env.PATH || ''}`,
				WASM_RUST_CUSTOM_TOOLCHAIN_ROOT: root,
				WASM_RUST_RUST_SOURCE_ROOT: rustRoot,
				WASM_RUST_RUST_CONFIG: configPath,
				WASM_RUST_LLVM_BUILD_DIR: llvmBuildDir,
				WASM_RUST_INSTALL_TARGETS: 'x86_64-unknown-linux-gnu'
			},
			maxBuffer: 8 * 1024 * 1024
		});

		await expect(fs.readFile(recordedThreadCFlagsPath, 'utf8')).resolves.toBe('\n');
		await expect(fs.readFile(recordedThreadCxxFlagsPath, 'utf8')).resolves.toBe('\n');
		await expect(fs.readFile(logPath, 'utf8')).resolves.toContain(
			'skipping external CFLAGS_wasm32_wasip1_threads/CXXFLAGS_wasm32_wasip1_threads injection'
		);
	});

	it('drops a stale LLVM build directory when it exists without a generated build script', async () => {
		const root = await makeTempDir();
		const rustRoot = path.join(root, 'rust');
		const llvmBuildDir = path.join(root, 'llvm', 'build');
		const fakeBinDir = path.join(root, 'fake-bin');
		const configPath = path.join(rustRoot, 'config.wasm-rust-browser.toml');
		const logPath = path.join(root, 'wasm-rust-custom-toolchain.log');
		const recordedConfigPath = path.join(root, 'recorded-config-path.txt');
		const cmakeTouchedPath = path.join(root, 'cmake-touched.txt');

		await fs.mkdir(llvmBuildDir, { recursive: true });
		await fs.mkdir(fakeBinDir, { recursive: true });
		await fs.mkdir(rustRoot, { recursive: true });
		await fs.writeFile(configPath, '[build]\n');
		await fs.writeFile(
			path.join(rustRoot, 'x.py'),
			`#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$3" > ${JSON.stringify(recordedConfigPath)}
`,
			'utf8'
		);
		await fs.writeFile(
			path.join(fakeBinDir, 'cmake'),
			`#!/usr/bin/env bash
set -euo pipefail
printf 'invoked\\n' > ${JSON.stringify(cmakeTouchedPath)}
exit 99
`,
			'utf8'
		);
		await fs.chmod(path.join(rustRoot, 'x.py'), 0o755);
		await fs.chmod(path.join(fakeBinDir, 'cmake'), 0o755);

		await execFileAsync('bash', ['./scripts/build-custom-rustc-toolchain.sh', '--', '--foreground'], {
			cwd: projectRoot,
			env: {
				...process.env,
				PATH: `${fakeBinDir}:${process.env.PATH || ''}`,
				WASM_RUST_CUSTOM_TOOLCHAIN_ROOT: root,
				WASM_RUST_RUST_SOURCE_ROOT: rustRoot,
				WASM_RUST_RUST_CONFIG: configPath,
				WASM_RUST_LLVM_BUILD_DIR: llvmBuildDir,
				WASM_RUST_INSTALL_TARGETS: 'x86_64-unknown-linux-gnu'
			},
			maxBuffer: 8 * 1024 * 1024
		});

		await expect(fs.readFile(recordedConfigPath, 'utf8')).resolves.toContain(
			path.join(root, 'config.wasm-rust-browser.effective.toml')
		);
		await expect(fs.readFile(logPath, 'utf8')).resolves.toContain(
			'LLVM build dir'
		);
		await expect(fs.readFile(logPath, 'utf8')).resolves.toContain(
			'was removed because it lacks a generated build script; skipping resume step and starting from x.py install'
		);
		await expect(fs.stat(cmakeTouchedPath)).rejects.toMatchObject({
			code: 'ENOENT'
		});
		await expect(fs.stat(llvmBuildDir)).rejects.toMatchObject({
			code: 'ENOENT'
		});
	});

	it('drops a stale LLVM build directory when its CMake cache lacks the thread-aware endian defines', async () => {
		const root = await makeTempDir();
		const rustRoot = path.join(root, 'rust');
		const llvmBuildDir = path.join(root, 'llvm', 'build');
		const fakeBinDir = path.join(root, 'fake-bin');
		const configPath = path.join(rustRoot, 'config.wasm-rust-browser.toml');
		const logPath = path.join(root, 'wasm-rust-custom-toolchain.log');
		const recordedConfigPath = path.join(root, 'recorded-config-path.txt');
		const cmakeTouchedPath = path.join(root, 'cmake-touched.txt');

		await fs.mkdir(llvmBuildDir, { recursive: true });
		await fs.mkdir(fakeBinDir, { recursive: true });
		await fs.mkdir(rustRoot, { recursive: true });
		await fs.writeFile(configPath, '[build]\n');
		await fs.writeFile(path.join(llvmBuildDir, 'Makefile'), 'all:\n\t@true\n');
		await fs.writeFile(
			path.join(llvmBuildDir, 'CMakeCache.txt'),
			'CMAKE_C_FLAGS:STRING= --target=wasm32-wasi --target=wasm32-wasip1-threads\n'
		);
		await fs.writeFile(
			path.join(rustRoot, 'x.py'),
			`#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$3" > ${JSON.stringify(recordedConfigPath)}
`,
			'utf8'
		);
		await fs.writeFile(
			path.join(fakeBinDir, 'cmake'),
			`#!/usr/bin/env bash
set -euo pipefail
printf 'invoked\\n' > ${JSON.stringify(cmakeTouchedPath)}
exit 99
`,
			'utf8'
		);
		await fs.chmod(path.join(rustRoot, 'x.py'), 0o755);
		await fs.chmod(path.join(fakeBinDir, 'cmake'), 0o755);

		await execFileAsync('bash', ['./scripts/build-custom-rustc-toolchain.sh', '--', '--foreground'], {
			cwd: projectRoot,
			env: {
				...process.env,
				PATH: `${fakeBinDir}:${process.env.PATH || ''}`,
				WASM_RUST_CUSTOM_TOOLCHAIN_ROOT: root,
				WASM_RUST_RUST_SOURCE_ROOT: rustRoot,
				WASM_RUST_RUST_CONFIG: configPath,
				WASM_RUST_LLVM_BUILD_DIR: llvmBuildDir,
				WASM_RUST_INSTALL_TARGETS: 'x86_64-unknown-linux-gnu'
			},
			maxBuffer: 8 * 1024 * 1024
		});

		await expect(fs.readFile(recordedConfigPath, 'utf8')).resolves.toContain(
			path.join(root, 'config.wasm-rust-browser.effective.toml')
		);
		await expect(fs.readFile(logPath, 'utf8')).resolves.toContain(
			'CMakeCache.txt lacks thread-aware endian defines'
		);
		await expect(fs.stat(cmakeTouchedPath)).rejects.toMatchObject({
			code: 'ENOENT'
		});
		await expect(fs.stat(llvmBuildDir)).rejects.toMatchObject({
			code: 'ENOENT'
		});
	});

	it('disables cargo incremental and prunes stale incremental directories by default', async () => {
		const root = await makeTempDir();
		const rustRoot = path.join(root, 'rust');
		const llvmBuildDir = path.join(root, 'llvm', 'build');
		const configPath = path.join(rustRoot, 'config.wasm-rust-browser.toml');
		const logPath = path.join(root, 'wasm-rust-custom-toolchain.log');
		const recordedIncrementalPath = path.join(root, 'recorded-cargo-incremental.txt');
		const staleIncrementalDir = path.join(rustRoot, 'build', 'stage1-rustc', 'release', 'incremental');

		await fs.mkdir(staleIncrementalDir, { recursive: true });
		await fs.mkdir(llvmBuildDir, { recursive: true });
		await fs.mkdir(rustRoot, { recursive: true });
		await fs.writeFile(path.join(staleIncrementalDir, 'marker.txt'), 'stale');
		await fs.writeFile(configPath, '[build]\n');
		await fs.writeFile(
			path.join(rustRoot, 'x.py'),
			`#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "\${CARGO_INCREMENTAL:-}" > ${JSON.stringify(recordedIncrementalPath)}
`,
			'utf8'
		);
		await fs.chmod(path.join(rustRoot, 'x.py'), 0o755);

		await execFileAsync('bash', ['./scripts/build-custom-rustc-toolchain.sh', '--', '--foreground'], {
			cwd: projectRoot,
			env: {
				...process.env,
				WASM_RUST_CUSTOM_TOOLCHAIN_ROOT: root,
				WASM_RUST_RUST_SOURCE_ROOT: rustRoot,
				WASM_RUST_RUST_CONFIG: configPath,
				WASM_RUST_LLVM_BUILD_DIR: llvmBuildDir,
				WASM_RUST_INSTALL_TARGETS: 'x86_64-unknown-linux-gnu'
			},
			maxBuffer: 8 * 1024 * 1024
		});

		await expect(fs.readFile(recordedIncrementalPath, 'utf8')).resolves.toContain('0');
		await expect(fs.stat(staleIncrementalDir)).rejects.toMatchObject({
			code: 'ENOENT'
		});
		await expect(fs.readFile(logPath, 'utf8')).resolves.toContain(
			'disabled cargo incremental state for bootstrap and compiler builds'
		);
		await expect(fs.readFile(logPath, 'utf8')).resolves.toContain(
			'pruned 1 stale cargo incremental directory'
		);
	});

	it('drops stale stage1 outputs when stage1/bin/rustc is missing', async () => {
		const root = await makeTempDir();
		const rustRoot = path.join(root, 'rust');
		const llvmBuildDir = path.join(root, 'llvm', 'build');
		const configPath = path.join(rustRoot, 'config.wasm-rust-browser.toml');
		const logPath = path.join(root, 'wasm-rust-custom-toolchain.log');
		const buildHostRoot = path.join(rustRoot, 'build', 'x86_64-unknown-linux-gnu');
		const staleStage1Paths = [
			path.join(buildHostRoot, 'stage1'),
			path.join(buildHostRoot, 'stage1-rustc'),
			path.join(buildHostRoot, 'stage1-std'),
			path.join(buildHostRoot, 'stage1-tools-bin')
		];

		await fs.mkdir(llvmBuildDir, { recursive: true });
		await fs.mkdir(rustRoot, { recursive: true });
		await fs.writeFile(configPath, '[build]\n');
		for (const stalePath of staleStage1Paths) {
			await fs.mkdir(stalePath, { recursive: true });
			await fs.writeFile(path.join(stalePath, 'marker.txt'), 'stale');
		}
		await fs.writeFile(
			path.join(rustRoot, 'x.py'),
			'#!/usr/bin/env bash\nset -euo pipefail\nexit 0\n',
			'utf8'
		);
		await fs.chmod(path.join(rustRoot, 'x.py'), 0o755);

		await execFileAsync('bash', ['./scripts/build-custom-rustc-toolchain.sh', '--', '--foreground'], {
			cwd: projectRoot,
			env: {
				...process.env,
				WASM_RUST_CUSTOM_TOOLCHAIN_ROOT: root,
				WASM_RUST_RUST_SOURCE_ROOT: rustRoot,
				WASM_RUST_RUST_CONFIG: configPath,
				WASM_RUST_LLVM_BUILD_DIR: llvmBuildDir,
				WASM_RUST_INSTALL_TARGETS: 'x86_64-unknown-linux-gnu',
				WASM_RUST_BUILD_HOST_TARGET: 'x86_64-unknown-linux-gnu'
			},
			maxBuffer: 8 * 1024 * 1024
		});

		for (const stalePath of staleStage1Paths) {
			await expect(fs.stat(stalePath)).rejects.toMatchObject({
				code: 'ENOENT'
			});
		}
		await expect(fs.readFile(logPath, 'utf8')).resolves.toContain(
			'removed 4 stale stage1 paths'
		);
	});

	it('drops a stale native llvm build directory when its CMake cache captured browser-host thread flags', async () => {
		const root = await makeTempDir();
		const rustRoot = path.join(root, 'rust');
		const llvmBuildDir = path.join(root, 'llvm', 'build');
		const configPath = path.join(rustRoot, 'config.wasm-rust-browser.toml');
		const logPath = path.join(root, 'wasm-rust-custom-toolchain.log');
		const buildHostRoot = path.join(rustRoot, 'build', 'x86_64-unknown-linux-gnu');
		const staleNativeLlvmDir = path.join(buildHostRoot, 'llvm', 'build');
		const fakeBinDir = await createMissingRipgrepShim(root);

		await fs.mkdir(llvmBuildDir, { recursive: true });
		await fs.mkdir(staleNativeLlvmDir, { recursive: true });
		await fs.mkdir(rustRoot, { recursive: true });
		await fs.writeFile(configPath, '[build]\n');
		await fs.writeFile(
			path.join(staleNativeLlvmDir, 'CMakeCache.txt'),
			'CMAKE_C_FLAGS:STRING=-O2 --target=wasm32-wasip1-threads\n'
		);
		await fs.writeFile(
			path.join(rustRoot, 'x.py'),
			'#!/usr/bin/env bash\nset -euo pipefail\nexit 0\n',
			'utf8'
		);
		await fs.chmod(path.join(rustRoot, 'x.py'), 0o755);

		await execFileAsync('bash', ['./scripts/build-custom-rustc-toolchain.sh', '--', '--foreground'], {
			cwd: projectRoot,
			env: {
				...process.env,
				PATH: `${fakeBinDir}:${process.env.PATH || ''}`,
				WASM_RUST_CUSTOM_TOOLCHAIN_ROOT: root,
				WASM_RUST_RUST_SOURCE_ROOT: rustRoot,
				WASM_RUST_RUST_CONFIG: configPath,
				WASM_RUST_LLVM_BUILD_DIR: llvmBuildDir,
				WASM_RUST_INSTALL_TARGETS: 'x86_64-unknown-linux-gnu',
				WASM_RUST_BUILD_HOST_TARGET: 'x86_64-unknown-linux-gnu'
			},
			maxBuffer: 8 * 1024 * 1024
		});

		await expect(fs.stat(staleNativeLlvmDir)).rejects.toMatchObject({
			code: 'ENOENT'
		});
		await expect(fs.readFile(logPath, 'utf8')).resolves.toContain(
			'removed stale native LLVM build dir'
		);
	});

	it('terminates orphaned bootstrap helper processes before cleaning the build root', async () => {
		const root = await makeTempDir();
		const rustRoot = path.join(root, 'rust');
		const llvmBuildDir = path.join(root, 'llvm', 'build');
		const configPath = path.join(rustRoot, 'config.wasm-rust-browser.toml');
		const logPath = path.join(root, 'wasm-rust-custom-toolchain.log');
		const buildHostRoot = path.join(rustRoot, 'build', 'x86_64-unknown-linux-gnu');
		const stage1RustcPath = path.join(buildHostRoot, 'stage1', 'bin', 'rustc');
		const staleStage1RustcDir = path.join(buildHostRoot, 'stage1-rustc');
		const orphanBootstrap = spawn(
			'bash',
			['-lc', `exec -a '${path.join(rustRoot, 'build', 'bootstrap', 'debug', 'bootstrap')}' sleep 300`],
			{ stdio: 'ignore' }
		);

		await fs.mkdir(llvmBuildDir, { recursive: true });
		await fs.mkdir(rustRoot, { recursive: true });
		await fs.mkdir(path.dirname(stage1RustcPath), { recursive: true });
		await fs.mkdir(staleStage1RustcDir, { recursive: true });
		await fs.writeFile(configPath, '[build]\n');
		await fs.writeFile(stage1RustcPath, '#!/usr/bin/env bash\nexit 0\n', 'utf8');
		await fs.writeFile(path.join(staleStage1RustcDir, 'marker.txt'), 'stale');
		await fs.writeFile(
			path.join(rustRoot, 'x.py'),
			'#!/usr/bin/env bash\nset -euo pipefail\nexit 0\n',
			'utf8'
		);
		await fs.chmod(path.join(rustRoot, 'x.py'), 0o755);
		await fs.chmod(stage1RustcPath, 0o755);

		try {
			await execFileAsync('bash', ['./scripts/build-custom-rustc-toolchain.sh', '--', '--foreground'], {
				cwd: projectRoot,
				env: {
					...process.env,
					WASM_RUST_CUSTOM_TOOLCHAIN_ROOT: root,
					WASM_RUST_RUST_SOURCE_ROOT: rustRoot,
					WASM_RUST_RUST_CONFIG: configPath,
					WASM_RUST_LLVM_BUILD_DIR: llvmBuildDir,
					WASM_RUST_INSTALL_TARGETS: 'x86_64-unknown-linux-gnu',
					WASM_RUST_BUILD_HOST_TARGET: 'x86_64-unknown-linux-gnu'
				},
				maxBuffer: 8 * 1024 * 1024
			});
		} finally {
			orphanBootstrap.kill('SIGKILL');
		}

		await expect(
			execFileAsync('kill', ['-0', String(orphanBootstrap.pid)], {
				cwd: projectRoot,
				maxBuffer: 8 * 1024 * 1024
			})
		).rejects.toMatchObject({
			code: 1
		});
		await expect(fs.stat(staleStage1RustcDir)).rejects.toMatchObject({
			code: 'ENOENT'
		});
		await expect(fs.readFile(logPath, 'utf8')).resolves.toContain(
			'stale bootstrap helper process'
		);
		await expect(fs.readFile(logPath, 'utf8')).resolves.toContain(
			'stale bootstrap helper processes were terminated'
		);
	});

	it('fails fast when the Rust checkout is too old to contain wasm32-wasip3 target support', async () => {
		const root = await makeTempDir();
		const rustRoot = path.join(root, 'rust');
		const llvmBuildDir = path.join(root, 'llvm', 'build');
		const configPath = path.join(rustRoot, 'config.wasm-rust-browser.toml');
		const logPath = path.join(root, 'wasm-rust-custom-toolchain.log');
		const exitPath = path.join(root, 'wasm-rust-custom-toolchain.exit.txt');

		await fs.mkdir(llvmBuildDir, { recursive: true });
		await fs.mkdir(rustRoot, { recursive: true });
		await fs.writeFile(configPath, '[build]\n');

		await expect(
			execFileAsync('bash', ['./scripts/build-custom-rustc-toolchain.sh', '--foreground'], {
				cwd: projectRoot,
				env: {
					...process.env,
					WASM_RUST_CUSTOM_TOOLCHAIN_ROOT: root,
					WASM_RUST_RUST_SOURCE_ROOT: rustRoot,
					WASM_RUST_RUST_CONFIG: configPath,
					WASM_RUST_LLVM_BUILD_DIR: llvmBuildDir,
					WASM_RUST_INSTALL_TARGETS: 'x86_64-unknown-linux-gnu,wasm32-wasip3'
				},
				maxBuffer: 8 * 1024 * 1024
			})
		).rejects.toMatchObject({
			code: 2
		});

		await expect(fs.readFile(logPath, 'utf8')).resolves.toContain(
			'missing wasm32-wasip3 target support in rust source root'
		);
		await expect(fs.readFile(exitPath, 'utf8')).resolves.toContain('2');
	});

	it('reuses an active detached build pid instead of spawning a duplicate build', async () => {
		const root = await makeTempDir();
		const rustRoot = path.join(root, 'rust');
		const llvmBuildDir = path.join(root, 'llvm', 'build');
		const configPath = path.join(rustRoot, 'config.wasm-rust-browser.toml');
		const logPath = path.join(root, 'wasm-rust-custom-toolchain.log');
		const pidPath = path.join(root, 'wasm-rust-custom-toolchain.pid');
		const exitPath = path.join(root, 'wasm-rust-custom-toolchain.exit.txt');
		const snapshotPath = path.join(root, 'build-custom-rustc-toolchain.snapshot.sh');

		await fs.mkdir(llvmBuildDir, { recursive: true });
		await fs.mkdir(rustRoot, { recursive: true });
		await fs.writeFile(configPath, '[build]\n');
		await fs.writeFile(
			path.join(rustRoot, 'x.py'),
			`#!/usr/bin/env bash
set -euo pipefail
trap 'exit 0' TERM INT
sleep 300 &
child=$!
wait "$child"
`,
			'utf8'
		);
		await fs.chmod(path.join(rustRoot, 'x.py'), 0o755);

		const firstRun = await execFileAsync('bash', ['./scripts/build-custom-rustc-toolchain.sh'], {
			cwd: projectRoot,
			env: {
				...process.env,
				WASM_RUST_CUSTOM_TOOLCHAIN_ROOT: root,
				WASM_RUST_RUST_SOURCE_ROOT: rustRoot,
				WASM_RUST_RUST_CONFIG: configPath,
				WASM_RUST_LLVM_BUILD_DIR: llvmBuildDir,
				WASM_RUST_INSTALL_TARGETS: 'x86_64-unknown-linux-gnu',
				WASM_RUST_BUILD_HOST_TARGET: 'x86_64-unknown-linux-gnu'
			},
			maxBuffer: 8 * 1024 * 1024
		});
		const activePid = Number.parseInt(firstRun.stdout.trim(), 10);
		expect(Number.isInteger(activePid)).toBe(true);
		await expect(fs.readFile(snapshotPath, 'utf8')).resolves.toContain(
			'build-custom-rustc-toolchain'
		);

		let stablePid = activePid;
		for (let attempt = 0; attempt < 20; attempt += 1) {
			try {
				const pidContents = (await fs.readFile(pidPath, 'utf8')).trim();
				const candidatePid = Number.parseInt(pidContents, 10);
				if (!Number.isInteger(candidatePid)) {
					throw new Error(`invalid detached build pid file contents: ${pidContents}`);
				}
				process.kill(candidatePid, 0);
				stablePid = candidatePid;
				break;
			} catch (error) {
				const signalError = error as NodeJS.ErrnoException;
				if (attempt === 19 || signalError.code !== 'ESRCH') {
					throw error;
				}
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
		}

		const secondRun = await execFileAsync('bash', ['./scripts/build-custom-rustc-toolchain.sh'], {
			cwd: projectRoot,
			env: {
				...process.env,
				WASM_RUST_CUSTOM_TOOLCHAIN_ROOT: root,
				WASM_RUST_RUST_SOURCE_ROOT: rustRoot,
				WASM_RUST_RUST_CONFIG: configPath,
				WASM_RUST_LLVM_BUILD_DIR: llvmBuildDir,
				WASM_RUST_INSTALL_TARGETS: 'x86_64-unknown-linux-gnu',
				WASM_RUST_BUILD_HOST_TARGET: 'x86_64-unknown-linux-gnu'
			},
			maxBuffer: 8 * 1024 * 1024
		});
		expect(Number.parseInt(secondRun.stdout.trim(), 10)).toBe(stablePid);
		await expect(fs.readFile(logPath, 'utf8')).resolves.toContain(
			'reusing existing detached build instead of spawning a duplicate'
		);
		try {
			process.kill(stablePid, 'SIGTERM');
		} catch (error) {
			const signalError = error as NodeJS.ErrnoException;
			if (signalError.code !== 'ESRCH') {
				throw error;
			}
		}
		const watchResult = await execFileAsync(
			'node',
			['./scripts/watch-process.mjs', '--pid', String(stablePid), '--timeout-seconds', '10'],
			{
				cwd: projectRoot,
				env: {
					...process.env,
					WASM_RUST_CUSTOM_TOOLCHAIN_ROOT: root
				},
				maxBuffer: 8 * 1024 * 1024
			}
		).catch((error) => error as NodeJS.ErrnoException & { stdout?: string; stderr?: string });
		const watchStdout = 'stdout' in watchResult ? watchResult.stdout || '' : watchResult.stdout;
		expect(watchStdout).toContain('WATCH_STATUS=exited');
		const watchExitCodeLine = watchStdout
			.split('\n')
			.find((line) => line.startsWith('WATCH_EXIT_CODE='));
		const watchExitCode = Number.parseInt(watchExitCodeLine?.split('=')[1] || '', 10);
		const exitContents = await fs.readFile(exitPath, 'utf8');
		const parsedExitCode = Number.parseInt(exitContents.trim(), 10);
		if (Number.isInteger(watchExitCode)) {
			expect(watchExitCode).toBeGreaterThanOrEqual(0);
		}
		if (Number.isInteger(parsedExitCode)) {
			expect(parsedExitCode).toBeGreaterThanOrEqual(0);
			if (Number.isInteger(watchExitCode)) {
				expect(watchExitCode).toBe(parsedExitCode);
			}
		} else if (Number.isInteger(watchExitCode)) {
			expect(watchExitCode).toBeGreaterThanOrEqual(0);
		}
	}, 20000);

	it('retries x.py install once after llvm-cxxfilt is missing from a stale native LLVM tree', async () => {
		const root = await makeTempDir();
		const rustRoot = path.join(root, 'rust');
		const llvmBuildDir = path.join(root, 'llvm', 'build');
		const configPath = path.join(rustRoot, 'config.wasm-rust-browser.toml');
		const logPath = path.join(root, 'wasm-rust-custom-toolchain.log');
		const attemptsPath = path.join(root, 'xpy-attempt.txt');
		const buildHostRoot = path.join(rustRoot, 'build', 'x86_64-unknown-linux-gnu');
		const missingBinaryPath = path.join(buildHostRoot, 'llvm', 'build', 'bin', 'llvm-cxxfilt');
		const linkTxtPath = path.join(
			buildHostRoot,
			'llvm',
			'build',
			'tools',
			'llvm-cxxfilt',
			'CMakeFiles',
			'llvm-cxxfilt.dir',
			'link.txt'
		);
		const installCmakePath = path.join(
			buildHostRoot,
			'llvm',
			'build',
			'tools',
			'llvm-cxxfilt',
			'cmake_install.cmake'
		);

		await fs.mkdir(llvmBuildDir, { recursive: true });
		await fs.mkdir(rustRoot, { recursive: true });
		await fs.writeFile(configPath, '[build]\n');
		await fs.writeFile(
			path.join(rustRoot, 'x.py'),
			`#!/usr/bin/env bash
set -euo pipefail
attempt_file=${JSON.stringify(attemptsPath)}
attempt=1
if [[ -f "$attempt_file" ]]; then
  attempt=$(( $(cat "$attempt_file") + 1 ))
fi
printf '%s\\n' "$attempt" > "$attempt_file"
if [[ "$attempt" -eq 1 ]]; then
  mkdir -p ${JSON.stringify(path.dirname(linkTxtPath))} ${JSON.stringify(path.dirname(installCmakePath))} ${JSON.stringify(path.dirname(missingBinaryPath))}
  printf 'link\\n' > ${JSON.stringify(linkTxtPath)}
  printf 'install\\n' > ${JSON.stringify(installCmakePath)}
  cat >&2 <<'EOF'
CMake Error at tools/llvm-cxxfilt/cmake_install.cmake:52 (file):
  file INSTALL cannot find
  "${missingBinaryPath}":
  No such file or directory.
EOF
  exit 1
fi
exit 0
`,
			'utf8'
		);
		await fs.chmod(path.join(rustRoot, 'x.py'), 0o755);

		await execFileAsync('bash', ['./scripts/build-custom-rustc-toolchain.sh', '--', '--foreground'], {
			cwd: projectRoot,
			env: {
				...process.env,
				WASM_RUST_CUSTOM_TOOLCHAIN_ROOT: root,
				WASM_RUST_RUST_SOURCE_ROOT: rustRoot,
				WASM_RUST_RUST_CONFIG: configPath,
				WASM_RUST_LLVM_BUILD_DIR: llvmBuildDir,
				WASM_RUST_INSTALL_TARGETS: 'x86_64-unknown-linux-gnu',
				WASM_RUST_BUILD_HOST_TARGET: 'x86_64-unknown-linux-gnu'
			},
			maxBuffer: 8 * 1024 * 1024
		});

		await expect(fs.readFile(attemptsPath, 'utf8')).resolves.toContain('2');
		await expect(fs.readFile(logPath, 'utf8')).resolves.toContain(
			'after install failed because llvm-cxxfilt was missing; retrying x.py install from a clean native LLVM build'
		);
		await expect(fs.stat(path.join(buildHostRoot, 'llvm'))).rejects.toMatchObject({
			code: 'ENOENT'
		});
	});
});
