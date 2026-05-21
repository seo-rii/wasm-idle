import test from 'node:test'
import assert from 'node:assert/strict'

import {
  materializeBootstrapDispatchFiles,
  materializeGeneratedFile,
  materializeGeneratedFiles,
} from '../src/emception-files.ts'

test('materializeGeneratedFile creates missing parent directories before writing', async () => {
  const calls: string[] = []
  const existingDirectories = new Set(['/working'])

  await materializeGeneratedFile({
    exists: async () => false,
    mkdir: async (path) => {
      calls.push(`mkdir ${path}`)
      existingDirectories.add(path)
    },
    unlink: async (path) => {
      calls.push(`unlink ${path}`)
    },
    writeFile: async (path, contents) => {
      calls.push(`write ${path} ${contents}`)
      assert.ok(existingDirectories.has('/working/.tinygo-root'))
      assert.ok(existingDirectories.has('/working/.tinygo-root/targets'))
    },
  }, {
    path: '/working/.tinygo-root/targets/wasm.json',
    contents: '{"llvm-target":"wasm32-unknown-wasi"}',
  })

  assert.deepEqual(calls, [
    'mkdir /working/.tinygo-root',
    'mkdir /working/.tinygo-root/targets',
    'write /working/.tinygo-root/targets/wasm.json {"llvm-target":"wasm32-unknown-wasi"}',
  ])
})

test('materializeGeneratedFiles does not recreate the same parent directories twice', async () => {
  const calls: string[] = []

  await materializeGeneratedFiles({
    exists: async () => false,
    mkdir: async (path) => {
      calls.push(`mkdir ${path}`)
    },
    unlink: async (path) => {
      calls.push(`unlink ${path}`)
    },
    writeFile: async (path) => {
      calls.push(`write ${path}`)
    },
  }, [
    {
      path: '/working/.tinygo-root/targets/wasm.json',
      contents: '{}',
    },
    {
      path: '/working/.tinygo-root/src/runtime/gc_boehm.c',
      contents: '/* placeholder */',
    },
  ])

  assert.deepEqual(calls, [
    'mkdir /working/.tinygo-root',
    'mkdir /working/.tinygo-root/targets',
    'write /working/.tinygo-root/targets/wasm.json',
    'mkdir /working/.tinygo-root/src',
    'mkdir /working/.tinygo-root/src/runtime',
    'write /working/.tinygo-root/src/runtime/gc_boehm.c',
  ])
})

test('materializeBootstrapDispatchFiles follows bootstrapDispatch materialized order', async () => {
  const calls: string[] = []

  await materializeBootstrapDispatchFiles({
    exists: async () => false,
    mkdir: async (path) => {
      calls.push(`mkdir ${path}`)
    },
    unlink: async (path) => {
      calls.push(`unlink ${path}`)
    },
    writeFile: async (path) => {
      calls.push(`write ${path}`)
    },
  }, [
    {
      path: '/working/tinygo-bootstrap.json',
      contents: '{"bootstrapDispatch":{"materializedFiles":["/working/.tinygo-root/targets/wasm.json","/working/tinygo-bootstrap.c","/working/tinygo-bootstrap.json"]}}',
    },
    {
      path: '/working/tinygo-bootstrap.c',
      contents: '/* generated */',
    },
    {
      path: '/working/.tinygo-root/targets/wasm.json',
      contents: '{}',
    },
  ], '{"bootstrapDispatch":{"materializedFiles":["/working/.tinygo-root/targets/wasm.json","/working/tinygo-bootstrap.c","/working/tinygo-bootstrap.json"]}}')

  assert.deepEqual(calls, [
    'mkdir /working/.tinygo-root',
    'mkdir /working/.tinygo-root/targets',
    'write /working/.tinygo-root/targets/wasm.json',
    'write /working/tinygo-bootstrap.c',
    'write /working/tinygo-bootstrap.json',
  ])
})

test('materializeBootstrapDispatchFiles rejects missing generated files referenced by dispatch', async () => {
  await assert.rejects(
    () => materializeBootstrapDispatchFiles({
      exists: async () => false,
      mkdir: async () => {},
      unlink: async () => {},
      writeFile: async () => {},
    }, [], '{"bootstrapDispatch":{"materializedFiles":["/working/tinygo-bootstrap.c"]}}'),
    /dispatch requested missing generated file: \/working\/tinygo-bootstrap.c/,
  )
})

test('materializeBootstrapDispatchFiles rejects generated files outside bootstrapDispatch', async () => {
  await assert.rejects(
    () => materializeBootstrapDispatchFiles({
      exists: async () => false,
      mkdir: async () => {},
      unlink: async () => {},
      writeFile: async () => {},
    }, [
      {
        path: '/working/tinygo-bootstrap.json',
        contents: '{"bootstrapDispatch":{"materializedFiles":["/working/tinygo-bootstrap.json"]}}',
      },
      {
        path: '/working/tinygo-bootstrap.c',
        contents: '/* generated */',
      },
    ], '{"bootstrapDispatch":{"materializedFiles":["/working/tinygo-bootstrap.json"]}}'),
    /generated file missing from bootstrapDispatch.materializedFiles: \/working\/tinygo-bootstrap.c/,
  )
})

test('materializeGeneratedFile retries after unlinking a stale path when emception writeFile returns FS error', async () => {
  const calls: string[] = []
  let writeAttempts = 0

  await materializeGeneratedFile({
    exists: async () => false,
    mkdir: async () => {},
    unlink: async (path) => {
      calls.push(`unlink ${path}`)
    },
    writeFile: async (path) => {
      writeAttempts += 1
      calls.push(`write ${path} #${writeAttempts}`)
      if (writeAttempts === 1) {
        throw new Error('FS error')
      }
    },
  }, {
    path: '/working/tinygo-bootstrap.json',
    contents: '{}',
  })

  assert.deepEqual(calls, [
    'write /working/tinygo-bootstrap.json #1',
    'unlink /working/tinygo-bootstrap.json',
    'write /working/tinygo-bootstrap.json #2',
  ])
})
