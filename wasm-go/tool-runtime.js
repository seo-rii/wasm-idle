import { Directory, Fd, File, Inode, OpenFile, PreopenDirectory, WASI, wasi } from './vendor/browser_wasi_shim/index.js';
import { resolveVersionedAssetUrl } from './asset-url.js';
import { fetchRuntimeAssetBytes, loadRuntimePackEntries } from './runtime-asset.js';
class CaptureFd extends Fd {
    ino = Inode.issue_ino();
    decoder = new TextDecoder();
    chunks = [];
    fd_filestat_get() {
        return {
            ret: wasi.ERRNO_SUCCESS,
            filestat: new wasi.Filestat(this.ino, wasi.FILETYPE_CHARACTER_DEVICE, 0n)
        };
    }
    fd_fdstat_get() {
        const fdstat = new wasi.Fdstat(wasi.FILETYPE_CHARACTER_DEVICE, 0);
        fdstat.fs_rights_base = BigInt(wasi.RIGHTS_FD_WRITE);
        return {
            ret: wasi.ERRNO_SUCCESS,
            fdstat
        };
    }
    fd_write(data) {
        this.chunks.push(this.decoder.decode(data, { stream: true }));
        return {
            ret: wasi.ERRNO_SUCCESS,
            nwritten: data.byteLength
        };
    }
    getText() {
        const trailing = this.decoder.decode();
        if (trailing) {
            this.chunks.push(trailing);
        }
        return this.chunks.join('');
    }
}
function normalizeGuestPath(path) {
    const normalized = path.replace(/\\/g, '/');
    const absolute = normalized.startsWith('/') ? normalized : `/${normalized}`;
    const segments = [];
    for (const segment of absolute.split('/')) {
        if (!segment || segment === '.') {
            continue;
        }
        if (segment === '..') {
            throw new Error(`wasm-go does not allow guest path traversal: ${path}`);
        }
        segments.push(segment);
    }
    return `/${segments.join('/')}`;
}
function toStandaloneBytes(value) {
    if (typeof value === 'string') {
        return new TextEncoder().encode(value);
    }
    return value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array(value);
}
function ensureDirectory(root, guestPath) {
    const normalized = normalizeGuestPath(guestPath);
    const segments = normalized.slice(1).split('/').filter(Boolean);
    let directory = root;
    for (const segment of segments) {
        const existing = directory.contents.get(segment);
        if (existing instanceof Directory) {
            directory = existing;
            continue;
        }
        const nextDirectory = new Directory(new Map());
        directory.contents.set(segment, nextDirectory);
        directory = nextDirectory;
    }
    return directory;
}
function writeFile(root, guestPath, contents, readonly = false) {
    const normalized = normalizeGuestPath(guestPath);
    const segments = normalized.slice(1).split('/');
    const parent = ensureDirectory(root, segments.slice(0, -1).join('/'));
    parent.contents.set(segments.at(-1), new File(toStandaloneBytes(contents), {
        readonly
    }));
}
function readFile(root, guestPath) {
    const normalized = normalizeGuestPath(guestPath);
    const segments = normalized.slice(1).split('/');
    let entry = root;
    for (const segment of segments) {
        if (!(entry instanceof Directory)) {
            return null;
        }
        entry = entry.contents.get(segment);
    }
    if (!(entry instanceof File)) {
        return null;
    }
    return new Uint8Array(entry.data);
}
async function loadSysrootFiles(plan, runtimeBaseUrl, fetchImpl) {
    if (plan.sysrootPack) {
        return await loadRuntimePackEntries(runtimeBaseUrl, plan.sysrootPack, fetchImpl);
    }
    return await Promise.all((plan.sysrootFiles || []).map(async (entry) => ({
        runtimePath: entry.runtimePath,
        bytes: await fetchRuntimeAssetBytes(resolveVersionedAssetUrl(runtimeBaseUrl, entry.asset), `sysroot asset ${entry.runtimePath}`, fetchImpl)
    })));
}
function collectInputFiles(invocation, plan) {
    const files = [...invocation.inputFiles];
    if (invocation.tool === 'link' && plan.link) {
        const compileOutput = plan.compile.outputPath;
        if (!files.some((file) => file.path === compileOutput)) {
            throw new Error(`missing compile output ${compileOutput} for link invocation`);
        }
    }
    return files;
}
export async function executeGoToolInvocation(invocation, plan, runtimeBaseUrl, fetchImpl = fetch) {
    const root = new Directory(new Map());
    ensureDirectory(root, '/tmp');
    for (const entry of await loadSysrootFiles(plan, runtimeBaseUrl, fetchImpl)) {
        writeFile(root, entry.runtimePath, entry.bytes, true);
    }
    for (const file of collectInputFiles(invocation, plan)) {
        writeFile(root, file.path, file.contents);
    }
    ensureDirectory(root, normalizeGuestPath(invocation.outputPath).split('/').slice(0, -1).join('/'));
    const toolBytes = await fetchRuntimeAssetBytes(resolveVersionedAssetUrl(runtimeBaseUrl, invocation.toolAsset), `${invocation.tool}.wasm`, fetchImpl);
    const stdout = new CaptureFd();
    const stderr = new CaptureFd();
    const wasiInstance = new WASI(invocation.args, Object.entries(invocation.env).map(([key, value]) => `${key}=${value}`), [
        new OpenFile(new File(new Uint8Array(), { readonly: true })),
        stdout,
        stderr,
        new PreopenDirectory('/', root.contents)
    ], { debug: false });
    const module = await WebAssembly.compile(toolBytes);
    const instance = await WebAssembly.instantiate(module, {
        wasi_snapshot_preview1: wasiInstance.wasiImport
    });
    const exitCode = wasiInstance.start(instance);
    const outputBytes = readFile(root, invocation.outputPath);
    return {
        exitCode,
        stdout: stdout.getText(),
        stderr: stderr.getText(),
        outputs: outputBytes
            ? {
                [invocation.outputPath]: outputBytes
            }
            : {}
    };
}
//# sourceMappingURL=tool-runtime.js.map