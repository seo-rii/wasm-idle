import { verifyRuntimeAssetIntegrity } from '@wasm-idle/core';
import { ContainerError } from '../errors.js';

/** These are exact byte identities. A transport's HTTP Content-Encoding is not this encoding. */
export interface DistributionByteIdentity {
  readonly sha256: string;
  readonly bytes: number;
  readonly mediaType: string;
}

export interface DistributionAsset {
  readonly id: string;
  readonly url: string;
  readonly encoding: 'identity' | 'gzip';
  readonly delivery: DistributionByteIdentity;
  readonly logical: DistributionByteIdentity;
}

export interface DistributionFile {
  /** Canonical relative POSIX path inside this package's readonly mount. */
  readonly path: string;
  readonly asset: string;
  readonly executable: boolean;
}

export interface DistributionPackage {
  readonly id: string;
  /** Producer-selected immutable identity, authenticated by the distribution lock. */
  readonly identity: string;
  readonly producer: Readonly<{ repository: string; revision: string; receiptSha256: string }>;
  readonly dependencies: readonly string[];
  readonly mount: string;
  readonly capabilities: readonly string[];
  readonly assets: readonly DistributionAsset[];
  readonly files: readonly DistributionFile[];
}

export interface DistributionCommand {
  readonly name: string;
  readonly package: string;
  /** Key into the host's explicit adapter registry; never a module URL. */
  readonly adapter: string;
  readonly path: string;
  readonly argv0: string;
  readonly prefixArgs: readonly string[];
}

export interface DistributionLimits {
  readonly maxManifestBytes: number;
  readonly maxPackages: number;
  readonly maxCommands: number;
  readonly maxAssets: number;
  readonly maxFiles: number;
  readonly maxAssetBytes: number;
  readonly maxFileBytes: number;
  readonly maxTotalAssetBytes: number;
  readonly maxTotalFileBytes: number;
  readonly maxPathDepth: number;
  readonly maxDependencyDepth: number;
}

export const DEFAULT_DISTRIBUTION_LIMITS: Readonly<DistributionLimits> = Object.freeze({
  maxManifestBytes: 2 * 1024 * 1024,
  maxPackages: 128,
  maxCommands: 2048,
  maxAssets: 4096,
  maxFiles: 16384,
  maxAssetBytes: 128 * 1024 * 1024,
  maxFileBytes: 128 * 1024 * 1024,
  maxTotalAssetBytes: 512 * 1024 * 1024,
  maxTotalFileBytes: 512 * 1024 * 1024,
  maxPathDepth: 32,
  maxDependencyDepth: 32
});

export interface ValidatedDistribution {
  readonly schemaVersion: 1;
  readonly distributionId: string;
  readonly sha256: string;
  readonly packages: readonly DistributionPackage[];
  readonly commands: readonly DistributionCommand[];
  readonly limits: Readonly<DistributionLimits>;
}

export interface ValidateDistributionOptions {
  readonly bytes: Uint8Array;
  /** Trust root supplied by the application, independently of these manifest bytes. */
  readonly expectedSha256: string;
  readonly adapterIds: readonly string[];
  /** Exact canonical HTTP(S) URLs approved by the application; no prefix matching. */
  readonly allowedAssetURLs: readonly string[];
  readonly limits?: Partial<DistributionLimits>;
  readonly signal?: AbortSignal;
}

const validatedDistributions = new WeakSet<ValidatedDistribution>();
const digestPattern = /^[a-f0-9]{64}$/u;
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,127}$/u;
const encoder = new TextEncoder();

function invalid(message: string): never {
  throw new ContainerError('INVALID_DISTRIBUTION', message);
}

function object(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} must be an object`);
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) invalid(`${label} has unsupported field ${key}`);
  }
  return record;
}

function string(value: unknown, label: string, maxLength = 4096): string {
  if (typeof value !== 'string' || value.length > maxLength || value.includes('\0')) {
    invalid(`${label} must be a bounded string without NUL`);
  }
  // Reject unmatched surrogates: the filesystem's profile is UTF-8 paths/arguments.
  if (new TextDecoder().decode(encoder.encode(value)) !== value) invalid(`${label} is not valid Unicode`);
  return value;
}

function id(value: unknown, label: string): string {
  const result = string(value, label, 128);
  if (!idPattern.test(result)) invalid(`${label} is not a valid identifier`);
  return result;
}

function array(value: unknown, max: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > max) invalid(`${label} must be an array of at most ${max} entries`);
  return value;
}

function identifiers(value: unknown, max: number, label: string): readonly string[] {
  const result = array(value, max, label).map((entry) => id(entry, label));
  if (new Set(result).size !== result.length) invalid(`${label} contains duplicate entries`);
  return Object.freeze(result);
}

function byteIdentity(value: unknown, max: number, label: string): DistributionByteIdentity {
  const record = object(value, ['sha256', 'bytes', 'mediaType'], label);
  if (typeof record.sha256 !== 'string' || !digestPattern.test(record.sha256)) invalid(`${label} has invalid SHA-256`);
  if (!Number.isSafeInteger(record.bytes) || (record.bytes as number) < 0 || (record.bytes as number) > max) {
    invalid(`${label} exceeds its byte limit or has an invalid size`);
  }
  const mediaType = string(record.mediaType, `${label}.mediaType`, 128);
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(mediaType)) invalid(`${label} has invalid MIME type`);
  return Object.freeze({ sha256: record.sha256, bytes: record.bytes as number, mediaType });
}

function canonicalURL(value: unknown, label: string): string {
  const result = string(value, label);
  let parsed: URL;
  try { parsed = new URL(result); } catch { invalid(`${label} must be an absolute HTTP(S) URL`); }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash || parsed.href !== result) {
    invalid(`${label} must be a canonical uncredentialed HTTP(S) URL without a fragment`);
  }
  return result;
}

function relativePath(value: unknown, limits: DistributionLimits, label: string): string {
  const path = string(value, label);
  const parts = path.split('/');
  if (encoder.encode(path).byteLength > 4096 || parts.length > limits.maxPathDepth || parts.some((part) => !part || part === '.' || part === '..')) {
    invalid(`${label} must be a bounded canonical relative POSIX path`);
  }
  return path;
}

function mountPath(value: unknown, limits: DistributionLimits): string {
  const path = string(value, 'package.mount');
  if (!path.startsWith('/opt/toolchains/') && !path.startsWith('/usr/share/')) {
    invalid('Package mounts must be below /opt/toolchains or /usr/share');
  }
  relativePath(path.slice(1), limits, 'package.mount');
  return path;
}

/** Internal runtime check prevents an unvalidated object from bypassing the lock verifier. */
export function assertValidatedDistribution(value: ValidatedDistribution): void {
  if (!validatedDistributions.has(value)) invalid('A distribution must be produced by validateDistribution()');
}

/** Verifies a host pin before parsing. Validation/command lookup never fetch asset bodies. */
export async function validateDistribution(options: ValidateDistributionOptions): Promise<ValidatedDistribution> {
  const signal = options.signal;
  signal?.throwIfAborted();
  const limits = Object.freeze({ ...DEFAULT_DISTRIBUTION_LIMITS, ...options.limits });
  for (const [key, value] of Object.entries(limits)) {
    if (!(key in DEFAULT_DISTRIBUTION_LIMITS) || !Number.isSafeInteger(value) || value <= 0) invalid(`Invalid distribution limit ${key}`);
  }
  if (!(options.bytes instanceof Uint8Array) || options.bytes.byteLength > limits.maxManifestBytes) invalid('Manifest bytes are invalid or exceed the manifest limit');
  if (!digestPattern.test(options.expectedSha256)) invalid('An independent expected SHA-256 digest is required');
  // Snapshot all host policy before hashing: neither bytes nor allowlists can race validation.
  const bytes = Uint8Array.from(options.bytes);
  const expectedSha256 = options.expectedSha256;
  const adapters = new Set(identifiers(options.adapterIds, limits.maxCommands, 'adapterIds'));
  const urls = new Set(array(options.allowedAssetURLs, limits.maxAssets, 'allowedAssetURLs').map((url) => canonicalURL(url, 'allowedAssetURL')));
  try {
    await verifyRuntimeAssetIntegrity({ asset: 'container-distribution', bytes, expected: expectedSha256 });
  } catch (cause) {
    throw new ContainerError('INTEGRITY', 'Distribution does not match its application lock', { cause });
  }
  signal?.throwIfAborted();
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch (cause) { throw new ContainerError('INVALID_DISTRIBUTION', 'Distribution must be UTF-8 JSON', { cause }); }
  const manifest = object(parsed, ['schemaVersion', 'distributionId', 'packages', 'commands'], 'distribution');
  if (manifest.schemaVersion !== 1) invalid('Unsupported distribution schemaVersion');
  const distributionId = id(manifest.distributionId, 'distributionId');
  const packages: DistributionPackage[] = [];
  const byPackage = new Map<string, DistributionPackage>();
  let assetCount = 0;
  let fileCount = 0;
  let assetBytes = 0;
  let fileBytes = 0;
  for (const value of array(manifest.packages, limits.maxPackages, 'packages')) {
    const pkg = object(value, ['id', 'identity', 'producer', 'dependencies', 'mount', 'capabilities', 'assets', 'files'], 'package');
    const packageId = id(pkg.id, 'package.id');
    if (byPackage.has(packageId)) invalid(`Duplicate package ${packageId}`);
    const identity = string(pkg.identity, 'package.identity', 71);
    if (!/^sha256:[a-f0-9]{64}$/u.test(identity)) invalid(`Package ${packageId} needs an immutable sha256 identity`);
    const producer = object(pkg.producer, ['repository', 'revision', 'receiptSha256'], 'producer');
    const repository = canonicalURL(producer.repository, 'producer.repository');
    const revision = string(producer.revision, 'producer.revision', 64);
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(revision)) invalid('Producer revision must be an exact source revision');
    const receiptSha256 = string(producer.receiptSha256, 'producer.receiptSha256', 64);
    if (!digestPattern.test(receiptSha256)) invalid('Producer receipt SHA-256 is required');
    const mount = mountPath(pkg.mount, limits);
    for (const previous of packages) {
      if (mount === previous.mount || mount.startsWith(`${previous.mount}/`) || previous.mount.startsWith(`${mount}/`)) invalid('Package mount paths overlap');
    }
    const assets = array(pkg.assets, limits.maxAssets, 'package.assets').map((value): DistributionAsset => {
      const asset = object(value, ['id', 'url', 'encoding', 'delivery', 'logical'], 'asset');
      const assetId = id(asset.id, 'asset.id');
      const url = canonicalURL(asset.url, 'asset.url');
      if (!urls.has(url)) invalid(`Asset URL is not approved: ${url}`);
      if (asset.encoding !== 'identity' && asset.encoding !== 'gzip') invalid('Only direct identity/gzip assets are supported; archives require a separate verified extractor');
      const delivery = byteIdentity(asset.delivery, limits.maxAssetBytes, 'asset.delivery');
      const logical = byteIdentity(asset.logical, limits.maxFileBytes, 'asset.logical');
      if (asset.encoding === 'identity' && (delivery.sha256 !== logical.sha256 || delivery.bytes !== logical.bytes || delivery.mediaType !== logical.mediaType)) invalid('Identity encoding must preserve byte identity and MIME type');
      if (++assetCount > limits.maxAssets || (assetBytes += delivery.bytes + logical.bytes) > limits.maxTotalAssetBytes) invalid('Distribution asset budget exceeded');
      return Object.freeze({ id: assetId, url, encoding: asset.encoding, delivery, logical });
    });
    const byAsset = new Map(assets.map((asset) => [asset.id, asset]));
    if (byAsset.size !== assets.length) invalid(`Duplicate asset ID in ${packageId}`);
    const files = array(pkg.files, limits.maxFiles, 'package.files').map((value): DistributionFile => {
      const file = object(value, ['path', 'asset', 'executable'], 'file');
      const path = relativePath(file.path, limits, 'file.path');
      const assetId = id(file.asset, 'file.asset');
      const asset = byAsset.get(assetId);
      if (!asset) invalid(`Unknown file asset ${assetId}`);
      if (typeof file.executable !== 'boolean') invalid('file.executable must be an explicit boolean');
      if (++fileCount > limits.maxFiles || (fileBytes += asset.logical.bytes) > limits.maxTotalFileBytes) invalid('Distribution file budget exceeded');
      return Object.freeze({ path, asset: assetId, executable: file.executable });
    });
    const paths = new Set<string>();
    for (const file of files) {
      if (paths.has(file.path)) invalid(`Duplicate file ${file.path}`);
      paths.add(file.path);
    }
    for (const path of paths) {
      const parts = path.split('/');
      for (let end = 1; end < parts.length; end++) {
        if (paths.has(parts.slice(0, end).join('/'))) invalid(`File/directory prefix collision at ${path}`);
      }
    }
    const result: DistributionPackage = Object.freeze({
      id: packageId, identity, producer: Object.freeze({ repository, revision, receiptSha256 }),
      mount, dependencies: identifiers(pkg.dependencies, limits.maxPackages, 'package.dependencies'),
      capabilities: identifiers(pkg.capabilities, 64, 'package.capabilities'),
      assets: Object.freeze(assets), files: Object.freeze(files)
    });
    packages.push(result);
    byPackage.set(packageId, result);
  }
  // DFS includes depth even for already visited nodes: a long alternate route must not evade it.
  const heights = new Map<string, number>();
  const visiting = new Set<string>();
  const visit = (packageId: string, depth: number): number => {
    if (depth > limits.maxDependencyDepth) invalid('Dependency graph exceeds its depth limit');
    const pkg = byPackage.get(packageId);
    if (!pkg) invalid(`Unknown package dependency ${packageId}`);
    if (visiting.has(packageId)) invalid(`Dependency cycle at ${packageId}`);
    const known = heights.get(packageId);
    if (known !== undefined) {
      if (depth + known - 1 > limits.maxDependencyDepth) invalid('Dependency graph exceeds its depth limit');
      return known;
    }
    visiting.add(packageId);
    let height = 1;
    for (const dependency of pkg.dependencies) height = Math.max(height, 1 + visit(dependency, depth + 1));
    visiting.delete(packageId);
    heights.set(packageId, height);
    return height;
  };
  for (const pkg of packages) visit(pkg.id, 1);
  const names = new Set<string>();
  const commands = array(manifest.commands, limits.maxCommands, 'commands').map((value): DistributionCommand => {
    const command = object(value, ['name', 'package', 'adapter', 'path', 'argv0', 'prefixArgs'], 'command');
    const name = id(command.name, 'command.name');
    if (names.has(name)) invalid(`Duplicate command ${name}`);
    names.add(name);
    const packageId = id(command.package, 'command.package');
    const pkg = byPackage.get(packageId);
    if (!pkg) invalid(`Unknown command package ${packageId}`);
    const adapter = id(command.adapter, 'command.adapter');
    if (!adapters.has(adapter)) invalid(`Unregistered command adapter ${adapter}`);
    const path = relativePath(command.path, limits, 'command.path');
    if (!pkg.files.some((file) => file.path === path && file.executable)) invalid(`Command ${name} must refer to an executable package file`);
    const argv0 = string(command.argv0, 'command.argv0');
    if (!argv0) invalid('command.argv0 must not be empty');
    const prefixArgs = Object.freeze(array(command.prefixArgs, 64, 'command.prefixArgs').map((value) => string(value, 'command.prefixArgs')));
    return Object.freeze({ name, package: packageId, adapter, path, argv0, prefixArgs });
  });
  const result: ValidatedDistribution = Object.freeze({
    schemaVersion: 1, distributionId, sha256: expectedSha256, packages: Object.freeze(packages),
    commands: Object.freeze(commands), limits
  });
  validatedDistributions.add(result);
  return result;
}
