import { ContainerError } from '../errors.js';
import {
  createVerifiedAssetLoader, type AssetLoaderInspection, type VerifiedAssetLoaderOptions
} from './assets.js';
import {
  assertValidatedDistribution, type DistributionCommand, type DistributionPackage
} from './distribution.js';

export interface PreparedPackageFile {
  readonly path: string;
  /** Owned file bytes; the receiving filesystem must copy these when mounting. */
  readonly bytes: Uint8Array;
  readonly executable: boolean;
  readonly sha256: string;
  readonly mediaType: string;
}

export interface PreparedPackage {
  readonly id: string;
  readonly identity: string;
  readonly mount: string;
  readonly files: readonly PreparedPackageFile[];
}

export interface PreparedPackages {
  readonly distributionId: string;
  readonly distributionSha256: string;
  /** Verified dependency-first closure, published together only after every file is ready. */
  readonly packages: readonly PreparedPackage[];
}

export interface PreparedCommand extends PreparedPackages {
  readonly command: DistributionCommand;
  readonly executable: Uint8Array;
  readonly executablePath: string;
}

export interface PackagePreparationOptions {
  readonly signal?: AbortSignal;
}

export interface ContainerPackageManagerOptions extends VerifiedAssetLoaderOptions {
  readonly capabilities?: readonly string[];
  readonly maxPreparations?: number;
  /** Admission budget for concurrently preparing file copies plus command executable copies. */
  readonly maxPreparingBytes?: number;
}

export interface PackageManagerInspection {
  readonly distributionId: string;
  readonly distributionSha256: string;
  readonly pendingPackages: readonly string[];
  readonly preparingBytes: number;
  readonly assets: AssetLoaderInspection;
}

export interface ContainerPackageManager {
  resolveCommand(name: string): DistributionCommand | undefined;
  listCommands(): readonly DistributionCommand[];
  prepare(packageId: string, options?: PackagePreparationOptions): Promise<PreparedPackages>;
  prepareCommand(name: string, options?: PackagePreparationOptions): Promise<PreparedCommand>;
  inspect(): PackageManagerInspection;
  dispose(): Promise<void>;
}

interface PendingPreparation {
  readonly packageId: string;
  readonly controller: AbortController;
  readonly bytes: number;
  promise: Promise<PreparedPackages>;
}

/** Metadata-only resolution and staged preparation; this object never writes a filesystem. */
export function createContainerPackageManager(options: ContainerPackageManagerOptions): ContainerPackageManager {
  assertValidatedDistribution(options.distribution);
  const distribution = options.distribution;
  const maxPreparations = options.maxPreparations ?? 16;
  const maxPreparingBytes = options.maxPreparingBytes ?? 256 * 1024 * 1024;
  for (const [key, value] of Object.entries({ maxPreparations, maxPreparingBytes })) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new ContainerError('INVALID_ARGUMENT', `Invalid package manager limit ${key}`);
  }
  if (options.capabilities !== undefined && (!Array.isArray(options.capabilities) || options.capabilities.length > 256 || options.capabilities.some((value) => typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,127}$/u.test(value)))) {
    throw new ContainerError('INVALID_ARGUMENT', 'Capabilities must be a bounded list of host capability IDs');
  }
  const capabilities = new Set(options.capabilities ?? []);
  const packages = new Map(distribution.packages.map((pkg) => [pkg.id, pkg]));
  const commands = new Map(distribution.commands.map((command) => [command.name, command]));
  const loader = createVerifiedAssetLoader(options);
  const pending = new Set<PendingPreparation>();
  let preparingBytes = 0;
  let disposed = false;
  let disposal: Promise<void> | undefined;

  const checkOpen = () => {
    if (disposed) throw new ContainerError('DISPOSED', 'Package manager has been disposed');
  };
  const resolveCommand = (name: string): DistributionCommand | undefined => {
    checkOpen();
    if (typeof name !== 'string' || name.includes('\0') || name.length > 4096) {
      throw new ContainerError('INVALID_ARGUMENT', 'Command name must be a bounded string without NUL');
    }
    return commands.get(name.startsWith('/usr/bin/') ? name.slice('/usr/bin/'.length) : name);
  };
  const closure = (packageId: string): readonly DistributionPackage[] => {
    const seen = new Set<string>();
    const result: DistributionPackage[] = [];
    const visit = (id: string) => {
      if (seen.has(id)) return;
      const pkg = packages.get(id);
      if (!pkg) throw new ContainerError('INVALID_DISTRIBUTION', `Unknown pinned package ${id}`);
      seen.add(id);
      for (const dependency of pkg.dependencies) visit(dependency);
      result.push(pkg);
    };
    visit(packageId);
    return result;
  };

  const start = async (packageId: string, request: PackagePreparationOptions, command?: DistributionCommand): Promise<PreparedPackages | PreparedCommand> => {
    checkOpen();
    const signal = request.signal;
    if (signal?.aborted) throw new ContainerError('ABORTED', 'Package preparation canceled', { cause: signal.reason });
    if (pending.size >= maxPreparations) throw new ContainerError('RESOURCE_LIMIT', 'Too many pending package preparations');
    const required = closure(packageId);
    let bytes = 0;
    for (const pkg of required) {
      for (const capability of pkg.capabilities) {
        if (!capabilities.has(capability)) throw new ContainerError('UNSUPPORTED_PROFILE', `Package ${pkg.id} requires host capability ${capability}`);
      }
      const assets = new Map(pkg.assets.map((asset) => [asset.id, asset]));
      for (const file of pkg.files) {
        bytes += assets.get(file.asset)!.logical.bytes;
        if (command?.package === pkg.id && command.path === file.path) bytes += assets.get(file.asset)!.logical.bytes;
      }
    }
    if (!Number.isSafeInteger(bytes) || bytes > maxPreparingBytes - preparingBytes) {
      throw new ContainerError('RESOURCE_LIMIT', 'Package preparation exceeds the concurrent file-byte budget');
    }
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    const operation: PendingPreparation = {
      packageId, controller, bytes,
      promise: Promise.resolve({ distributionId: distribution.distributionId, distributionSha256: distribution.sha256, packages: [] })
    };
    pending.add(operation); preparingBytes += bytes;
    const execute = async (): Promise<PreparedPackages | PreparedCommand> => {
      const staged: PreparedPackage[] = [];
      for (const pkg of required) {
        const metadata = new Map(pkg.assets.map((asset) => [asset.id, asset]));
        const assets = new Map<string, Uint8Array>();
        for (const asset of pkg.assets) {
          controller.signal.throwIfAborted();
          assets.set(asset.id, await loader.load(pkg.id, asset.id, { signal: controller.signal }));
        }
        const files = pkg.files.map((file): PreparedPackageFile => {
          const asset = metadata.get(file.asset)!;
          return Object.freeze({
            path: file.path, bytes: Uint8Array.from(assets.get(file.asset)!), executable: file.executable,
            sha256: asset.logical.sha256, mediaType: asset.logical.mediaType
          });
        });
        staged.push(Object.freeze({ id: pkg.id, identity: pkg.identity, mount: pkg.mount, files: Object.freeze(files) }));
      }
      controller.signal.throwIfAborted();
      const base: PreparedPackages = {
        distributionId: distribution.distributionId, distributionSha256: distribution.sha256,
        packages: Object.freeze(staged)
      };
      if (!command) return Object.freeze(base);
      const pkg = staged.find((pkg) => pkg.id === command.package)!;
      const executable = Uint8Array.from(pkg.files.find((file) => file.path === command.path)!.bytes);
      return Object.freeze({ ...base, command, executable, executablePath: `${pkg.mount}/${command.path}` });
    };
    operation.promise = execute().catch((cause: unknown) => {
      if (controller.signal.aborted) throw new ContainerError('ABORTED', 'Package preparation canceled', { cause: controller.signal.reason });
      throw cause;
    }).finally(() => {
      signal?.removeEventListener('abort', abort);
      pending.delete(operation); preparingBytes -= bytes;
    });
    if (signal?.aborted) abort();
    return operation.promise;
  };

  return Object.freeze({
    resolveCommand,
    listCommands() { checkOpen(); return distribution.commands; },
    prepare(packageId: string, request: PackagePreparationOptions = {}) { return start(packageId, request); },
    async prepareCommand(name: string, request: PackagePreparationOptions = {}): Promise<PreparedCommand> {
      const command = resolveCommand(name);
      if (!command) throw new ContainerError('COMMAND_NOT_FOUND', `Command is not in this distribution: ${name}`);
      return await start(command.package, request, command) as PreparedCommand;
    },
    inspect() {
      return Object.freeze({
        distributionId: distribution.distributionId, distributionSha256: distribution.sha256,
        pendingPackages: Object.freeze([...pending].map((entry) => entry.packageId)), preparingBytes,
        assets: loader.inspect()
      });
    },
    dispose() {
      if (disposal) return disposal;
      disposed = true;
      for (const entry of pending) entry.controller.abort(new ContainerError('DISPOSED', 'Package manager disposed'));
      disposal = Promise.allSettled([loader.dispose(), ...[...pending].map((entry) => entry.promise)]).then(() => {});
      return disposal;
    }
  });
}
