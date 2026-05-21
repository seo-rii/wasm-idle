import test from 'node:test'
import assert from 'node:assert/strict'
import {
  readTinyGoBootstrapManifest,
  verifyTinyGoBootstrapArtifactExpectation,
} from '../src/bootstrap-exports.ts'

test('bootstrap-exports module no longer exposes a checksum helper', async () => {
  const module = await import('../src/bootstrap-exports.ts')
  assert.equal('readTinyGoBootstrapChecksum' in module, false)
})

test('bootstrap-exports module no longer exposes a round-trip helper', async () => {
  const module = await import('../src/bootstrap-exports.ts')
  assert.equal('compareTinyGoBootstrapManifestRoundTrip' in module, false)
})

test('bootstrap-exports module no longer exposes a planner fallback verifier', async () => {
  const module = await import('../src/bootstrap-exports.ts')
  assert.equal('verifyTinyGoBootstrapArtifact' in module, false)
})

test('readTinyGoBootstrapManifest returns embedded manifest JSON from wasm memory exports', () => {
  const manifestSource = '{"entryFile":"/workspace/main.go"}'
  const memory = new WebAssembly.Memory({ initial: 1 })
  const bytes = new TextEncoder().encode(manifestSource)
  new Uint8Array(memory.buffer).set(bytes, 32)

  const bootstrapManifest = readTinyGoBootstrapManifest({
    memory,
    tinygo_embedded_manifest_ptr: () => 32,
    tinygo_embedded_manifest_len: () => bytes.length,
  })

  assert.equal(bootstrapManifest, manifestSource)
})

test('readTinyGoBootstrapManifest returns embedded manifest JSON without a checksum field', () => {
  const manifestSource = '{"entryFile":"/workspace/main.go"}'
  const memory = new WebAssembly.Memory({ initial: 1 })
  const bytes = new TextEncoder().encode(manifestSource)
  new Uint8Array(memory.buffer).set(bytes, 16)

  const bootstrapManifest = readTinyGoBootstrapManifest({
    memory,
    tinygo_embedded_manifest_ptr: () => 16,
    tinygo_embedded_manifest_len: () => bytes.length,
  })

  assert.equal('checksum' in JSON.parse(bootstrapManifest ?? '{}'), false)
})

test('readTinyGoBootstrapManifest returns null for out-of-bounds embedded manifest pointers', () => {
  const memory = new WebAssembly.Memory({ initial: 1 })

  const bootstrapManifest = readTinyGoBootstrapManifest({
    memory,
    tinygo_embedded_manifest_ptr: () => 65535,
    tinygo_embedded_manifest_len: () => 8,
  })

  assert.equal(bootstrapManifest, null)
})

test('readTinyGoBootstrapManifest returns null when manifest export getters throw', () => {
  const memory = new WebAssembly.Memory({ initial: 1 })

  const bootstrapManifest = readTinyGoBootstrapManifest({
    memory,
    tinygo_embedded_manifest_ptr: () => {
      throw new Error('ptr exploded')
    },
    tinygo_embedded_manifest_len: () => 8,
  })

  assert.equal(bootstrapManifest, null)
})

test('verifyTinyGoBootstrapArtifactExpectation accepts a normalized embedded manifest string', () => {
  const embeddedManifest = JSON.stringify({
    entryFile: '/workspace/main.go',
    materializedFiles: [
      '/working/.tinygo-root/src/device/arm/arm.go',
      '/working/.tinygo-root/src/runtime/internal/sys/zversion.go',
      '/working/.tinygo-root/targets/wasm.json',
      '/working/tinygo-bootstrap.c',
    ],
    sourceSelection: {
      allCompile: ['/workspace/main.go'],
    },
  })
  const memory = new WebAssembly.Memory({ initial: 1 })
  const bytes = new TextEncoder().encode(embeddedManifest)
  new Uint8Array(memory.buffer).set(bytes, 32)

  const verification = verifyTinyGoBootstrapArtifactExpectation(embeddedManifest, {
    memory,
    tinygo_embedded_manifest_ptr: () => 32,
    tinygo_embedded_manifest_len: () => bytes.length,
  })

  assert.deepEqual(verification, {
    ok: true,
    reason: '',
  })
})

test('verifyTinyGoBootstrapArtifactExpectation derives target and runtime files from materialized files', () => {
  const embeddedManifest = JSON.stringify({
    entryFile: '/workspace/main.go',
    materializedFiles: [
      '/working/.tinygo-root/src/device/arm/arm.go',
      '/working/.tinygo-root/src/runtime/internal/sys/zversion.go',
      '/working/.tinygo-root/targets/wasm.json',
      '/working/tinygo-bootstrap.c',
      '/working/tinygo-compile-unit.json',
    ],
    sourceSelection: {
      allCompile: ['/workspace/main.go'],
    },
  })
  const memory = new WebAssembly.Memory({ initial: 1 })
  const bytes = new TextEncoder().encode(embeddedManifest)
  new Uint8Array(memory.buffer).set(bytes, 48)

  const verification = verifyTinyGoBootstrapArtifactExpectation(embeddedManifest, {
    memory,
    tinygo_embedded_manifest_ptr: () => 48,
    tinygo_embedded_manifest_len: () => bytes.length,
  })

  assert.deepEqual(verification, {
    ok: true,
    reason: '',
  })
})

test('verifyTinyGoBootstrapArtifactExpectation rejects legacy top-level compile groups in the expected manifest', () => {
  const embeddedManifest = JSON.stringify({
    entryFile: '/workspace/main.go',
    materializedFiles: [
      '/working/.tinygo-root/src/device/arm/arm.go',
      '/working/.tinygo-root/src/runtime/internal/sys/zversion.go',
      '/working/.tinygo-root/targets/wasm.json',
      '/working/tinygo-bootstrap.c',
    ],
    packageFiles: ['/workspace/main.go'],
    importedPackageFiles: [],
    stdlibPackageFiles: [],
    allFiles: ['/workspace/main.go'],
    sourceSelection: {
    },
  })
  const memory = new WebAssembly.Memory({ initial: 1 })
  const bytes = new TextEncoder().encode(embeddedManifest)
  new Uint8Array(memory.buffer).set(bytes, 32)

  const verification = verifyTinyGoBootstrapArtifactExpectation(embeddedManifest, {
    memory,
    tinygo_embedded_manifest_ptr: () => 32,
    tinygo_embedded_manifest_len: () => bytes.length,
  })

  assert.deepEqual(verification, {
    ok: false,
    reason: 'expected embedded bootstrap manifest uses legacy top-level source-file groups',
  })
})

test('verifyTinyGoBootstrapArtifactExpectation rejects legacy top-level source-file groups even when normalized sourceSelection exists', () => {
  const embeddedManifest = JSON.stringify({
    entryFile: '/workspace/main.go',
    materializedFiles: [
      '/working/.tinygo-root/src/device/arm/arm.go',
      '/working/.tinygo-root/src/runtime/internal/sys/zversion.go',
      '/working/.tinygo-root/targets/wasm.json',
      '/working/tinygo-bootstrap.c',
    ],
    packageFiles: ['/workspace/main.go'],
    sourceSelection: {
      allCompile: ['/workspace/main.go'],
    },
  })
  const memory = new WebAssembly.Memory({ initial: 1 })
  const bytes = new TextEncoder().encode(embeddedManifest)
  new Uint8Array(memory.buffer).set(bytes, 48)

  const verification = verifyTinyGoBootstrapArtifactExpectation(embeddedManifest, {
    memory,
    tinygo_embedded_manifest_ptr: () => 48,
    tinygo_embedded_manifest_len: () => bytes.length,
  })

  assert.deepEqual(verification, {
    ok: false,
    reason: 'expected embedded bootstrap manifest uses legacy top-level source-file groups',
  })
})

test('verifyTinyGoBootstrapArtifactExpectation reports a verified artifact without requiring checksum exports', () => {
  const embeddedManifest = JSON.stringify({
    entryFile: '/workspace/main.go',
    materializedFiles: [
      '/working/.tinygo-root/src/device/arm/arm.go',
      '/working/.tinygo-root/src/runtime/internal/sys/zversion.go',
      '/working/.tinygo-root/targets/wasm.json',
      '/working/tinygo-bootstrap.json',
      '/working/tinygo-frontend-input.json',
    ],
    sourceSelection: {
      allCompile: ['/workspace/main.go'],
    },
  })
  const memory = new WebAssembly.Memory({ initial: 1 })
  const bytes = new TextEncoder().encode(embeddedManifest)
  new Uint8Array(memory.buffer).set(bytes, 64)

  const verification = verifyTinyGoBootstrapArtifactExpectation(embeddedManifest, {
    memory,
    tinygo_embedded_manifest_len: () => bytes.length,
    tinygo_embedded_manifest_ptr: () => 64,
  })

  assert.deepEqual(verification, {
    ok: true,
    reason: '',
  })
})

test('verifyTinyGoBootstrapArtifactExpectation reports a single mismatch reason for different manifest lengths', () => {
  const expectedEmbeddedManifest = JSON.stringify({
    entryFile: '/workspace/main.go',
    materializedFiles: [
      '/working/.tinygo-root/src/device/arm/arm.go',
      '/working/.tinygo-root/src/runtime/internal/sys/zversion.go',
      '/working/.tinygo-root/targets/wasm.json',
      '/working/tinygo-bootstrap.json',
      '/working/tinygo-frontend-input.json',
    ],
    sourceSelection: {
      allCompile: ['/workspace/main.go'],
    },
  })
  const embeddedManifest = JSON.stringify({
    entryFile: '/workspace/main.go',
    materializedFiles: [
      '/working/.tinygo-root/src/device/arm/arm.go',
      '/working/.tinygo-root/src/runtime/internal/sys/zversion.go',
      '/working/.tinygo-root/targets/wasm.json',
      '/working/tinygo-bootstrap.json',
    ],
    sourceSelection: {
      allCompile: ['/workspace/main.go'],
    },
  })
  const memory = new WebAssembly.Memory({ initial: 1 })
  const bytes = new TextEncoder().encode(embeddedManifest)
  new Uint8Array(memory.buffer).set(bytes, 64)

  const verification = verifyTinyGoBootstrapArtifactExpectation(expectedEmbeddedManifest, {
    memory,
    tinygo_embedded_manifest_len: () => bytes.length,
    tinygo_embedded_manifest_ptr: () => 64,
  })

  assert.deepEqual(verification, {
    ok: false,
    reason: 'bootstrap embedded manifest mismatch',
  })
})

test('verifyTinyGoBootstrapArtifactExpectation rejects malformed embedded manifest JSON', () => {
  const expectedEmbeddedManifest = JSON.stringify({
    entryFile: '/workspace/main.go',
    materializedFiles: [
      '/working/.tinygo-root/src/device/arm/arm.go',
      '/working/.tinygo-root/src/runtime/internal/sys/zversion.go',
      '/working/.tinygo-root/targets/wasm.json',
      '/working/tinygo-bootstrap.json',
    ],
    sourceSelection: {
      allCompile: ['/workspace/main.go'],
    },
  })
  const memory = new WebAssembly.Memory({ initial: 1 })
  const bytes = new TextEncoder().encode('{')
  new Uint8Array(memory.buffer).set(bytes, 64)

  const verification = verifyTinyGoBootstrapArtifactExpectation(expectedEmbeddedManifest, {
    memory,
    tinygo_embedded_manifest_len: () => bytes.length,
    tinygo_embedded_manifest_ptr: () => 64,
  })

  assert.deepEqual(verification, {
    ok: false,
    reason: 'unable to parse embedded bootstrap manifest',
  })
})
