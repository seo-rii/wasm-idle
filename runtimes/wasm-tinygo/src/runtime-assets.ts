export type TinyGoRuntimeAssetLoaderResult =
  | string
  | URL
  | ArrayBuffer
  | Uint8Array
  | Blob
  | {
      url?: string | URL | null
      data?: string | ArrayBuffer | Uint8Array | Blob | null
      mimeType?: string
    }
  | null
  | undefined

export type TinyGoRuntimeAssetLoader = (options: {
  assetPath: string
  assetUrl: string
  label: string
}) => TinyGoRuntimeAssetLoaderResult | Promise<TinyGoRuntimeAssetLoaderResult>

export type TinyGoRuntimeAssetProgress = {
  assetPath: string
  assetUrl: string
  label: string
  loaded: number
  total: number | null
}

export type TinyGoRuntimeAssetProgressCallback = (progress: TinyGoRuntimeAssetProgress) => void

export type TinyGoRuntimeAssetPackReference = {
  index: string
  asset: string
  fileCount: number
  totalBytes: number
}

export interface TinyGoRuntimePackIndexEntry {
  runtimePath: string
  offset: number
  length: number
}

export interface TinyGoRuntimePackIndex {
  format: 'wasm-tinygo-runtime-pack-index-v1' | 'wasm-rust-runtime-pack-index-v1'
  fileCount: number
  totalBytes: number
  entries: TinyGoRuntimePackIndexEntry[]
}

const runtimePackBytesCache = new Map<string, Promise<Uint8Array>>()
const runtimePackIndexCache = new Map<string, Promise<TinyGoRuntimePackIndex>>()

function expectObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`invalid ${label} in wasm-tinygo runtime pack index`)
  }
  return value as Record<string, unknown>
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`invalid ${label} in wasm-tinygo runtime pack index`)
  }
  return value
}

function expectNonNegativeInteger(value: unknown, label: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    !Number.isFinite(value)
  ) {
    throw new Error(`invalid ${label} in wasm-tinygo runtime pack index`)
  }
  return value
}

export function clearTinyGoRuntimePackCache() {
  runtimePackBytesCache.clear()
  runtimePackIndexCache.clear()
}

export function parseTinyGoRuntimePackIndex(value: unknown): TinyGoRuntimePackIndex {
  const root = expectObject(value, 'root')
  if (root.format !== 'wasm-tinygo-runtime-pack-index-v1' && root.format !== 'wasm-rust-runtime-pack-index-v1') {
    throw new Error('invalid root.format in wasm-tinygo runtime pack index')
  }
  if (!Array.isArray(root.entries)) {
    throw new Error('invalid root.entries in wasm-tinygo runtime pack index')
  }
  const totalBytes = expectNonNegativeInteger(root.totalBytes, 'root.totalBytes')
  const entries = root.entries.map((entry, index) => {
    const object = expectObject(entry, `root.entries[${index}]`)
    return {
      runtimePath: expectString(object.runtimePath, `root.entries[${index}].runtimePath`),
      offset: expectNonNegativeInteger(object.offset, `root.entries[${index}].offset`),
      length: expectNonNegativeInteger(object.length, `root.entries[${index}].length`),
    }
  })
  const fileCount = expectNonNegativeInteger(root.fileCount, 'root.fileCount')
  if (fileCount !== entries.length) {
    throw new Error('invalid root.fileCount in wasm-tinygo runtime pack index')
  }
  const seenRuntimePaths = new Set<string>()
  for (const entry of entries) {
    if (seenRuntimePaths.has(entry.runtimePath)) {
      throw new Error(
        `invalid root.entries runtimePath ${entry.runtimePath} in wasm-tinygo runtime pack index`,
      )
    }
    seenRuntimePaths.add(entry.runtimePath)
    if (entry.offset + entry.length > totalBytes) {
      throw new Error(
        `invalid runtime pack range for ${entry.runtimePath}: ${entry.offset}+${entry.length} exceeds ${totalBytes}`,
      )
    }
  }
  return {
    format: root.format,
    fileCount,
    totalBytes,
    entries,
  }
}

async function normalizeLoaderResult(
  result: TinyGoRuntimeAssetLoaderResult,
  assetPath: string,
): Promise<{ bytes?: Uint8Array; url?: string; mimeType?: string } | null> {
  if (!result) return null
  if (typeof result === 'string' || result instanceof URL) {
    return { url: String(result) }
  }
  if (result instanceof ArrayBuffer) {
    return { bytes: new Uint8Array(result) }
  }
  if (result instanceof Uint8Array) {
    return { bytes: result }
  }
  if (result instanceof Blob) {
    return { bytes: new Uint8Array(await result.arrayBuffer()), mimeType: result.type || undefined }
  }
  if (typeof result === 'object') {
    const url = result.url ? String(result.url) : undefined
    if (url) return { url }
    if (result.data === undefined || result.data === null) return null
    if (typeof result.data === 'string') {
      return { bytes: new TextEncoder().encode(result.data), mimeType: result.mimeType }
    }
    if (result.data instanceof ArrayBuffer) {
      return { bytes: new Uint8Array(result.data), mimeType: result.mimeType }
    }
    if (result.data instanceof Uint8Array) {
      return { bytes: result.data, mimeType: result.mimeType }
    }
    return {
      bytes: new Uint8Array(await result.data.arrayBuffer()),
      mimeType: result.mimeType || result.data.type || undefined,
    }
  }
  throw new Error(`unsupported wasm-tinygo asset loader result for ${assetPath}`)
}

async function fetchRuntimeAssetBytes(
  assetUrl: string,
  assetLabel: string,
  fetchImpl: typeof fetch,
  allowCompressedFallback = true,
  onProgress?: TinyGoRuntimeAssetProgressCallback,
): Promise<Uint8Array> {
  const resolvedAssetUrl = assetUrl.toString()
  const resolvedAssetUrlObject = new URL(resolvedAssetUrl)
  const emitProgress = (loaded: number, total: number | null) => {
    if (!onProgress) return
    try {
      onProgress({
        assetPath: resolvedAssetUrlObject.pathname.replace(/^\/+/, ''),
        assetUrl: resolvedAssetUrl,
        label: assetLabel,
        loaded,
        total,
      })
    } catch {}
  }
  let response: Response
  try {
    response = await fetchImpl(resolvedAssetUrl)
  } catch (error) {
    throw new Error(
      `failed to fetch ${assetLabel} from ${resolvedAssetUrl}: ${error instanceof Error ? error.message : String(error)}. This usually means the browser loaded a stale wasm-tinygo bundle or blocked a nested runtime asset request; hard refresh and resync the runtime assets.`,
    )
  }
  const contentLength = response.headers.get('content-length')
  const parsedTotal = contentLength ? Number(contentLength) : Number.NaN
  const total = Number.isFinite(parsedTotal) ? parsedTotal : null
  const chunks: Uint8Array[] = []
  let loaded = 0
  if (response.body) {
    const reader = response.body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue
        chunks.push(value)
        loaded += value.byteLength
        emitProgress(loaded, total)
      }
    } finally {
      try {
        reader.releaseLock()
      } catch {}
    }
  }
  const assetBytes =
    chunks.length > 0
      ? (() => {
          const bytes = new Uint8Array(loaded)
          let offset = 0
          for (const chunk of chunks) {
            bytes.set(chunk, offset)
            offset += chunk.byteLength
          }
          return bytes
        })()
      : response.body
        ? new Uint8Array(0)
        : new Uint8Array(await response.arrayBuffer())
  if (!loaded) {
    loaded = assetBytes.byteLength
    emitProgress(loaded, total)
  } else if (total === loaded) {
    emitProgress(loaded, total)
  }
  const assetPreview = new TextDecoder()
    .decode(assetBytes.slice(0, 128))
    .replace(/^\uFEFF/, '')
    .trimStart()
    .toLowerCase()
  const responseLooksLikeHtml =
    assetPreview.startsWith('<!doctype html') ||
    assetPreview.startsWith('<html') ||
    assetPreview.startsWith('<head') ||
    assetPreview.startsWith('<body')
  if (
    allowCompressedFallback &&
    !resolvedAssetUrlObject.pathname.endsWith('.gz') &&
    (!response.ok || responseLooksLikeHtml)
  ) {
    const compressedAssetUrl = new URL(resolvedAssetUrl)
    compressedAssetUrl.pathname = `${compressedAssetUrl.pathname}.gz`
    try {
      return await fetchRuntimeAssetBytes(
        compressedAssetUrl.toString(),
        assetLabel,
        fetchImpl,
        false,
        onProgress,
      )
    } catch {}
  }
  if (!response.ok) {
    throw new Error(
      `failed to fetch ${assetLabel} from ${resolvedAssetUrl} (status ${response.status}). This usually means the browser loaded a stale wasm-tinygo bundle or a nested runtime asset is missing.`,
    )
  }
  if (responseLooksLikeHtml) {
    throw new Error(
      `failed to fetch ${assetLabel} from ${resolvedAssetUrl}: expected a wasm-tinygo runtime asset but got HTML instead. This usually means the browser loaded a stale or wrong wasm-tinygo bundle, or the host rewrote a missing nested asset request to index.html; hard refresh and resync the runtime assets.`,
    )
  }
  if (!new URL(resolvedAssetUrl).pathname.endsWith('.gz')) {
    return assetBytes
  }
  if (assetBytes.byteLength < 2 || assetBytes[0] !== 0x1f || assetBytes[1] !== 0x8b) {
    return assetBytes
  }
  if (typeof DecompressionStream !== 'function') {
    throw new Error(
      `failed to decompress ${assetLabel} from ${resolvedAssetUrl}: this browser does not support DecompressionStream('gzip').`,
    )
  }
  try {
    const decompressedResponse = new Response(
      new Blob([assetBytes]).stream().pipeThrough(new DecompressionStream('gzip')),
    )
    return new Uint8Array(await decompressedResponse.arrayBuffer())
  } catch (error) {
    throw new Error(
      `failed to decompress ${assetLabel} from ${resolvedAssetUrl}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

async function loadRuntimePackBytes(
  assetBaseUrl: string,
  pack: TinyGoRuntimeAssetPackReference,
  fetchImpl: typeof fetch,
  loader?: TinyGoRuntimeAssetLoader,
  onProgress?: TinyGoRuntimeAssetProgressCallback,
) {
  const assetUrl = new URL(pack.asset, assetBaseUrl).toString()
  let cachedBytes = runtimePackBytesCache.get(assetUrl)
  if (!cachedBytes) {
    cachedBytes = loadRuntimeAssetBytes({
      assetPath: pack.asset,
      assetUrl,
      label: `wasm-tinygo runtime pack ${pack.asset}`,
      fetchImpl,
      loader,
      packs: null,
      onProgress,
    })
    runtimePackBytesCache.set(assetUrl, cachedBytes)
    cachedBytes.catch(() => {
      if (runtimePackBytesCache.get(assetUrl) === cachedBytes) {
        runtimePackBytesCache.delete(assetUrl)
      }
    })
  }
  return cachedBytes
}

async function loadRuntimePackIndex(
  assetBaseUrl: string,
  pack: TinyGoRuntimeAssetPackReference,
  fetchImpl: typeof fetch,
  loader?: TinyGoRuntimeAssetLoader,
  onProgress?: TinyGoRuntimeAssetProgressCallback,
) {
  const indexUrl = new URL(pack.index, assetBaseUrl).toString()
  let cachedIndex = runtimePackIndexCache.get(indexUrl)
  if (!cachedIndex) {
    cachedIndex = loadRuntimeAssetBytes({
      assetPath: pack.index,
      assetUrl: indexUrl,
      label: `wasm-tinygo runtime pack index ${pack.index}`,
      fetchImpl,
      loader,
      packs: null,
      assetBaseUrl,
      onProgress,
    }).then((value) =>
      parseTinyGoRuntimePackIndex(JSON.parse(new TextDecoder().decode(value))),
    )
    runtimePackIndexCache.set(indexUrl, cachedIndex)
    cachedIndex.catch(() => {
      if (runtimePackIndexCache.get(indexUrl) === cachedIndex) {
        runtimePackIndexCache.delete(indexUrl)
      }
    })
  }
  return cachedIndex
}

async function loadRuntimePackEntries(
  assetBaseUrl: string,
  pack: TinyGoRuntimeAssetPackReference,
  fetchImpl: typeof fetch,
  loader?: TinyGoRuntimeAssetLoader,
  onProgress?: TinyGoRuntimeAssetProgressCallback,
): Promise<Map<string, Uint8Array>> {
  const [index, packBytes] = await Promise.all([
    loadRuntimePackIndex(assetBaseUrl, pack, fetchImpl, loader, onProgress),
    loadRuntimePackBytes(assetBaseUrl, pack, fetchImpl, loader, onProgress),
  ])
  if (index.fileCount !== pack.fileCount) {
    throw new Error(
      `invalid wasm-tinygo runtime pack ${pack.index}: expected ${pack.fileCount} files but got ${index.fileCount}`,
    )
  }
  if (index.totalBytes !== pack.totalBytes) {
    throw new Error(
      `invalid wasm-tinygo runtime pack ${pack.index}: expected ${pack.totalBytes} bytes but got ${index.totalBytes}`,
    )
  }
  if (packBytes.byteLength < index.totalBytes) {
    throw new Error(
      `invalid wasm-tinygo runtime pack ${pack.asset}: expected at least ${index.totalBytes} bytes but got ${packBytes.byteLength}`,
    )
  }
  const entries = new Map<string, Uint8Array>()
  for (const entry of index.entries) {
    entries.set(entry.runtimePath, packBytes.subarray(entry.offset, entry.offset + entry.length))
  }
  return entries
}

export async function loadRuntimeAssetBytes(options: {
  assetPath: string
  assetUrl: string
  label: string
  fetchImpl?: typeof fetch
  loader?: TinyGoRuntimeAssetLoader
  assetBaseUrl?: string
  packs?: TinyGoRuntimeAssetPackReference[] | null
  onProgress?: TinyGoRuntimeAssetProgressCallback
}): Promise<Uint8Array> {
  const fetchImpl = options.fetchImpl ?? fetch
  const loader = options.loader
  if (options.packs?.length) {
    if (!options.assetBaseUrl) {
      throw new Error('wasm-tinygo asset packs require assetBaseUrl')
    }
    for (const pack of options.packs) {
      const entries = await loadRuntimePackEntries(
        options.assetBaseUrl,
        pack,
        fetchImpl,
        loader,
        options.onProgress,
      )
      const packed = entries.get(options.assetPath)
      if (packed) return packed
    }
  }
  if (loader) {
    const normalized = await normalizeLoaderResult(
      await loader({
        assetPath: options.assetPath,
        assetUrl: options.assetUrl,
        label: options.label,
      }),
      options.assetPath,
    )
    if (normalized?.bytes) return normalized.bytes
    if (normalized?.url) {
      return await fetchRuntimeAssetBytes(
        normalized.url,
        options.label,
        fetchImpl,
        true,
        options.onProgress,
      )
    }
  }
  return await fetchRuntimeAssetBytes(
    options.assetUrl,
    options.label,
    fetchImpl,
    true,
    options.onProgress,
  )
}

export async function resolveRuntimeAssetUrl(options: {
  assetPath: string
  assetUrl: string
  label: string
  loader?: TinyGoRuntimeAssetLoader
}): Promise<string> {
  const loader = options.loader
  if (!loader) return options.assetUrl
  const normalized = await normalizeLoaderResult(
    await loader({
      assetPath: options.assetPath,
      assetUrl: options.assetUrl,
      label: options.label,
    }),
    options.assetPath,
  )
  if (!normalized) return options.assetUrl
  if (normalized.url) return normalized.url
  throw new Error(
    `wasm-tinygo asset loader returned bytes for ${options.assetPath}; worker assets must be provided as URLs`,
  )
}
