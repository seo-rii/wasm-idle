export type TinyGoBootstrapVerification = {
  ok: boolean
  reason: string
}

const textDecoder = new TextDecoder()

const deriveEmbeddedManifestSelection = (manifestSource: string) => {
  let manifest: {
    entryFile?: string
    materializedFiles?: string[]
    toolchain?: {
      translationUnitPath?: string
    }
    sourceSelection?: {
      targetAssets?: string[]
      runtimeSupport?: string[]
      program?: string[]
      imported?: string[]
      stdlib?: string[]
      allCompile?: string[]
    }
  }
  try {
    manifest = JSON.parse(manifestSource) as {
      entryFile?: string
      materializedFiles?: string[]
      sourceSelection?: {
        targetAssets?: string[]
        runtimeSupport?: string[]
        program?: string[]
        imported?: string[]
        stdlib?: string[]
        allCompile?: string[]
      }
    }
  } catch {
    return null
  }

  const importedPackageFilesFromManifest = Array.isArray(manifest.sourceSelection?.imported)
    ? manifest.sourceSelection.imported
    : null
  const stdlibPackageFilesFromManifest = Array.isArray(manifest.sourceSelection?.stdlib)
    ? manifest.sourceSelection.stdlib
    : null
  const allCompileFiles = Array.isArray(manifest.sourceSelection?.allCompile)
    ? manifest.sourceSelection.allCompile
    : null
  const targetAssetFilesFromManifest = Array.isArray(manifest.sourceSelection?.targetAssets)
    ? manifest.sourceSelection.targetAssets
    : null
  const runtimeSupportFilesFromManifest = Array.isArray(manifest.sourceSelection?.runtimeSupport)
    ? manifest.sourceSelection.runtimeSupport
    : null
  const materializedFiles = Array.isArray(manifest.materializedFiles) ? manifest.materializedFiles : null

  if (
    typeof manifest.entryFile !== 'string' ||
    !Array.isArray(allCompileFiles) ||
    !Array.isArray(materializedFiles)
  ) {
    return null
  }

  const entryPackageDir = manifest.entryFile.slice(0, manifest.entryFile.lastIndexOf('/')) || '.'
  const stdlibPackageFiles =
    stdlibPackageFilesFromManifest ??
    allCompileFiles.filter((filePath) => {
      return filePath.startsWith('/working/.tinygo-root/src/')
    })
  const targetAssetFiles =
    targetAssetFilesFromManifest ?? materializedFiles.filter((filePath) => filePath.startsWith('/working/.tinygo-root/targets/'))
  const generatedFileSet = new Set<string>([
    manifest.toolchain?.translationUnitPath ?? '/working/tinygo-bootstrap.c',
    '/working/tinygo-compile-unit.json',
  ])
  const stdlibFileSet = new Set(stdlibPackageFiles)
  const targetAssetSet = new Set(targetAssetFiles)
  const runtimeSupportFiles =
    runtimeSupportFilesFromManifest ??
    materializedFiles.filter((filePath) => {
      if (generatedFileSet.has(filePath) || stdlibFileSet.has(filePath) || targetAssetSet.has(filePath)) {
        return false
      }
      return true
    })
  const importedPackageFiles =
    importedPackageFilesFromManifest ??
    allCompileFiles.filter((filePath) => {
      if (stdlibPackageFiles.includes(filePath)) {
        return false
      }
      const slashIndex = filePath.lastIndexOf('/')
      const fileDir = slashIndex > 0 ? filePath.slice(0, slashIndex) : ''
      return fileDir !== entryPackageDir
    })
  const programFiles = Array.isArray(manifest.sourceSelection?.program)
    ? manifest.sourceSelection.program
    : allCompileFiles.filter((filePath) => {
        if (importedPackageFiles.includes(filePath) || stdlibPackageFiles.includes(filePath)) {
          return false
        }
        const slashIndex = filePath.lastIndexOf('/')
        const fileDir = slashIndex > 0 ? filePath.slice(0, slashIndex) : ''
        return fileDir === entryPackageDir
      })
  const importedSet = new Set(importedPackageFiles)
  const packageFiles = programFiles.filter((path) => !importedSet.has(path))

  return {
    entryFile: manifest.entryFile,
    packageFiles,
    importedPackageFiles,
    stdlibPackageFiles,
    allCompileFiles,
    targetAssetFiles,
    runtimeSupportFiles,
    programFiles,
    materializedFiles,
  }
}

export const readTinyGoBootstrapManifest = (exportsObject: Record<string, unknown>): string | null => {
  const memory = exportsObject.memory
  const manifestPointer = exportsObject.tinygo_embedded_manifest_ptr
  const manifestLength = exportsObject.tinygo_embedded_manifest_len

  if (
    !(memory instanceof WebAssembly.Memory) ||
    typeof manifestPointer !== 'function' ||
    typeof manifestLength !== 'function'
  ) {
    return null
  }

  let byteOffset: number
  let byteLength: number
  try {
    byteOffset = Number(manifestPointer())
    byteLength = Number(manifestLength())
  } catch {
    return null
  }
  if (!Number.isInteger(byteOffset) || !Number.isInteger(byteLength) || byteOffset < 0 || byteLength < 0) {
    return null
  }
  if (byteOffset + byteLength > memory.buffer.byteLength) {
    return null
  }

  const bytes = new Uint8Array(memory.buffer, byteOffset, byteLength)
  return textDecoder.decode(bytes)
}

export const verifyTinyGoBootstrapArtifactExpectation = (
  expectedEmbeddedManifestSource: string,
  exportsObject: Record<string, unknown>,
): TinyGoBootstrapVerification => {
  const embeddedManifestSource = readTinyGoBootstrapManifest(exportsObject)
  if (!embeddedManifestSource) {
    return {
      ok: false,
      reason: 'missing embedded bootstrap manifest',
    }
  }

  try {
    const expectedManifest = JSON.parse(expectedEmbeddedManifestSource) as Record<string, unknown>
    for (const field of [
      'packageFiles',
      'importedPackageFiles',
      'stdlibPackageFiles',
      'allFiles',
      'programFiles',
      'targetAssetFiles',
      'runtimeSupportFiles',
    ]) {
      if (field in expectedManifest) {
        return {
          ok: false,
          reason: 'expected embedded bootstrap manifest uses legacy top-level source-file groups',
        }
      }
    }
  } catch {
    return {
      ok: false,
      reason: 'unable to parse expected embedded bootstrap manifest',
    }
  }

  const expectedSelection = deriveEmbeddedManifestSelection(expectedEmbeddedManifestSource)
  if (expectedSelection === null) {
    return {
      ok: false,
      reason: 'expected embedded bootstrap manifest is missing normalized source selection',
    }
  }

  try {
    const embeddedManifest = JSON.parse(embeddedManifestSource) as Record<string, unknown>
    for (const field of [
      'packageFiles',
      'importedPackageFiles',
      'stdlibPackageFiles',
      'allFiles',
      'programFiles',
      'targetAssetFiles',
      'runtimeSupportFiles',
    ]) {
      if (field in embeddedManifest) {
        return {
          ok: false,
          reason: 'embedded bootstrap manifest uses legacy top-level source-file groups',
        }
      }
    }
  } catch {
    return {
      ok: false,
      reason: 'unable to parse embedded bootstrap manifest',
    }
  }

  if (deriveEmbeddedManifestSelection(embeddedManifestSource) === null) {
    return {
      ok: false,
      reason: 'unable to parse embedded bootstrap manifest',
    }
  }

  return {
    ok: embeddedManifestSource === expectedEmbeddedManifestSource,
    reason: embeddedManifestSource === expectedEmbeddedManifestSource ? '' : 'bootstrap embedded manifest mismatch',
  }
}
