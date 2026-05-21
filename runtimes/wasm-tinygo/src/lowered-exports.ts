import type { TinyGoLoweredArtifactManifest, TinyGoLoweredIRManifest, TinyGoLoweredSourcesManifest } from './compile-unit'

export type TinyGoLoweredArtifactProbeVerification = {
  units: Array<{
    id: string
    exportName: string
    sourceFileCount: number
    kindTag: number
    sourceHash: number
    importCount: number
    importPathHash: number
    blankImportCount: number
    dotImportCount: number
    aliasedImportCount: number
    functionCount: number
    functionNameHash: number
    funcLiteralCount: number
    funcParameterCount: number
    funcResultCount: number
    variadicParameterCount: number
    namedResultCount: number
    typeParameterCount: number
    genericFunctionCount: number
    genericTypeCount: number
    callExpressionCount: number
    builtinCallCount: number
    appendCallCount: number
    lenCallCount: number
    makeCallCount: number
    capCallCount: number
    copyCallCount: number
    panicCallCount: number
    recoverCallCount: number
    newCallCount: number
    deleteCallCount: number
    compositeLiteralCount: number
    selectorExpressionCount: number
    selectorNameHash: number
    indexExpressionCount: number
    sliceExpressionCount: number
    keyValueExpressionCount: number
    typeAssertionCount: number
    blankIdentifierCount: number
    blankAssignmentTargetCount: number
    unaryExpressionCount: number
    binaryExpressionCount: number
    sendStatementCount: number
    receiveExpressionCount: number
    assignStatementCount: number
    defineStatementCount: number
    incStatementCount: number
    decStatementCount: number
    returnStatementCount: number
    goStatementCount: number
    deferStatementCount: number
    ifStatementCount: number
    rangeStatementCount: number
    switchStatementCount: number
    typeSwitchStatementCount: number
    typeSwitchCaseClauseCount: number
    typeSwitchGuardNameHash: number
    typeSwitchCaseTypeHash: number
    selectStatementCount: number
    switchCaseClauseCount: number
    selectCommClauseCount: number
    forStatementCount: number
    breakStatementCount: number
    breakLabelNameHash: number
    continueStatementCount: number
    continueLabelNameHash: number
    labeledStatementCount: number
    labelNameHash: number
    gotoStatementCount: number
    gotoLabelNameHash: number
    fallthroughStatementCount: number
    methodCount: number
    methodNameHash: number
    methodSignatureHash: number
    exportedMethodNameHash: number
    exportedMethodSignatureHash: number
    exportedFunctionCount: number
    exportedFunctionNameHash: number
    typeCount: number
    typeNameHash: number
    exportedTypeCount: number
    exportedTypeNameHash: number
    structTypeCount: number
    interfaceTypeCount: number
    mapTypeCount: number
    chanTypeCount: number
    sendOnlyChanTypeCount: number
    receiveOnlyChanTypeCount: number
    arrayTypeCount: number
    sliceTypeCount: number
    pointerTypeCount: number
    structFieldCount: number
    embeddedStructFieldCount: number
    taggedStructFieldCount: number
    structFieldNameHash: number
    structFieldTypeHash: number
    embeddedStructFieldTypeHash: number
    taggedStructFieldTagHash: number
    interfaceMethodCount: number
    interfaceMethodNameHash: number
    interfaceMethodSignatureHash: number
    embeddedInterfaceMethodCount: number
    embeddedInterfaceMethodNameHash: number
    constCount: number
    constNameHash: number
    varCount: number
    varNameHash: number
    exportedConstCount: number
    exportedConstNameHash: number
    exportedVarCount: number
    exportedVarNameHash: number
    declarationCount: number
    declarationNameHash: number
    declarationSignatureHash: number
    declarationKindHash: number
    declarationExportedCount: number
    declarationExportedNameHash: number
    declarationExportedSignatureHash: number
    declarationExportedKindHash: number
    declarationMethodCount: number
    declarationMethodNameHash: number
    declarationMethodSignatureHash: number
    declarationMethodKindHash: number
    placeholderBlockCount: number
    placeholderBlockHash: number
    placeholderBlockSignatureHash: number
    placeholderBlockRuntimeHash: number
    loweringBlockCount: number
    loweringBlockHash: number
    loweringBlockRuntimeHash: number
    mainCount: number
    initCount: number
  }>
}

export type TinyGoLoweredObjectFileVerification = {
  objectFiles: Array<{
    path: string
    size: number
    format: 'wasm'
  }>
  totalBytes: number
}

export type TinyGoLoweredBitcodeFileVerification = {
  bitcodeFiles: Array<{
    path: string
    size: number
    format: 'llvm-bc'
  }>
  totalBytes: number
}

export type TinyGoFinalArtifactFileVerification = {
  path: string
  size: number
  format: 'wasm'
}

export const verifyTinyGoLoweredArtifactExports = (
  instance: WebAssembly.Instance,
  loweredSourcesManifest: TinyGoLoweredSourcesManifest,
  sourceFileContents: Record<string, string | Uint8Array> = {},
  loweredIRManifest?: TinyGoLoweredIRManifest,
): TinyGoLoweredArtifactProbeVerification => {
  if (!Array.isArray(loweredSourcesManifest.units)) {
    throw new Error('frontend lowered sources manifest was missing normalized units')
  }

  const exportsObject = instance.exports as Record<string, unknown>
  const textEncoder = new TextEncoder()
  const textDecoder = new TextDecoder()
  const sanitizedSourceTextByFile: Record<string, string> = {}
  const typeContextSourceTextByFile: Record<string, string> = {}
  for (const unit of loweredSourcesManifest.units) {
    for (const sourceFile of unit.sourceFiles ?? []) {
      if (sanitizedSourceTextByFile[sourceFile] !== undefined) {
        continue
      }
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? textDecoder.decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      const sanitizedSourceText = sourceText
        .replace(/`[\s\S]*?`/g, (match) => ' '.repeat(match.length))
        .replace(/"(?:\\.|[^"\\])*"/g, (match) => ' '.repeat(match.length))
        .replace(/'(?:\\.|[^'\\])*'/g, (match) => ' '.repeat(match.length))
        .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
        .replace(/\/\/[^\n]*/g, (match) => ' '.repeat(match.length))
      sanitizedSourceTextByFile[sourceFile] = sanitizedSourceText
      const typeContextSourceText = [...sanitizedSourceText]
      const funcKeywordPattern = /\bfunc\b/g
      while (true) {
        const funcKeywordMatch = funcKeywordPattern.exec(sanitizedSourceText)
        if (funcKeywordMatch === null) {
          break
        }
        const bodyStartIndex = sanitizedSourceText.indexOf('{', funcKeywordMatch.index)
        if (bodyStartIndex < 0) {
          break
        }
        let bodyDepth = 1
        let bodyEndIndex = bodyStartIndex + 1
        while (bodyEndIndex < sanitizedSourceText.length && bodyDepth > 0) {
          if (sanitizedSourceText[bodyEndIndex] === '{') {
            bodyDepth += 1
          } else if (sanitizedSourceText[bodyEndIndex] === '}') {
            bodyDepth -= 1
          }
          bodyEndIndex += 1
        }
        if (bodyDepth > 0) {
          break
        }
        for (let blankIndex = bodyStartIndex + 1; blankIndex < bodyEndIndex - 1; blankIndex += 1) {
          if (typeContextSourceText[blankIndex] !== '\n') {
            typeContextSourceText[blankIndex] = ' '
          }
        }
        funcKeywordPattern.lastIndex = bodyEndIndex
      }
      typeContextSourceTextByFile[sourceFile] = typeContextSourceText.join('')
    }
  }
  const units: TinyGoLoweredArtifactProbeVerification['units'] = []
  for (const unit of loweredSourcesManifest.units) {
    if (typeof unit.id !== 'string' || unit.id === '' || !Array.isArray(unit.sourceFiles) || typeof unit.kind !== 'string') {
      throw new Error('frontend lowered sources manifest was missing normalized units')
    }
    const symbolID = unit.id.replaceAll('-', '_').replaceAll('/', '_').replaceAll('.', '_')
    const loweredIRUnit = (loweredIRManifest?.units ?? []).find((loweredUnit) => (loweredUnit.id ?? '') === unit.id)
    const exportName = `tinygo_lowered_${symbolID}_source_file_count`
    const exportValue = exportsObject[exportName]
    if (typeof exportValue !== 'function') {
      throw new Error(`frontend lowered artifact probe missing export ${exportName}`)
    }
    const sourceFileCount = Number(exportValue())
    if (!Number.isInteger(sourceFileCount) || sourceFileCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid source file count for ${exportName}`)
    }
    if (sourceFileCount !== unit.sourceFiles.length) {
      throw new Error('frontend lowered artifact probe did not match lowered sources manifest')
    }
    const kindExportName = `tinygo_lowered_${symbolID}_kind_tag`
    const kindExportValue = exportsObject[kindExportName]
    if (typeof kindExportValue !== 'function') {
      throw new Error(`frontend lowered artifact probe missing export ${kindExportName}`)
    }
    const kindTag = Number(kindExportValue())
    if (!Number.isInteger(kindTag) || kindTag < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid kind tag for ${kindExportName}`)
    }
    const expectedKindTag = unit.kind === 'program' ? 1 : unit.kind === 'imported' ? 2 : unit.kind === 'stdlib' ? 3 : 0
    if (kindTag !== expectedKindTag) {
      throw new Error('frontend lowered artifact probe kind tag did not match lowered sources manifest')
    }
    const sourceHashExportName = `tinygo_lowered_${symbolID}_source_hash`
    const sourceHashExportValue = exportsObject[sourceHashExportName]
    if (typeof sourceHashExportValue !== 'function') {
      throw new Error(`frontend lowered artifact probe missing export ${sourceHashExportName}`)
    }
    const sourceHash = Number(sourceHashExportValue())
    if (!Number.isInteger(sourceHash) || sourceHash < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid source hash for ${sourceHashExportName}`)
    }
    let expectedSourceHash = 0
    let position = 1
    for (const sourceFile of unit.sourceFiles) {
      const sourceBytes =
        typeof sourceFileContents[sourceFile] === 'string'
          ? textEncoder.encode(sourceFileContents[sourceFile] as string)
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? sourceFileContents[sourceFile] as Uint8Array
            : textEncoder.encode(sourceFile)
      for (const byte of sourceBytes) {
        expectedSourceHash = (expectedSourceHash + (byte * position)) >>> 0
        position += 1
      }
      expectedSourceHash = (expectedSourceHash + (0x0a * position)) >>> 0
      position += 1
    }
    if (sourceHash !== expectedSourceHash) {
      throw new Error('frontend lowered artifact probe source hash did not match lowered sources manifest')
    }
    const importCountExportName = `tinygo_lowered_${symbolID}_import_count`
    const importCountExportValue = exportsObject[importCountExportName]
    if (typeof importCountExportValue !== 'function') {
      throw new Error(`frontend lowered artifact probe missing export ${importCountExportName}`)
    }
    const importCount = Number(importCountExportValue())
    if (!Number.isInteger(importCount) || importCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid import count for ${importCountExportName}`)
    }
    let expectedImportCount = 0
    let expectedImportPathHash = 0
    let importPathHashPosition = 1
    let expectedBlankImportCount = 0
    let expectedDotImportCount = 0
    let expectedAliasedImportCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      const importPaths: string[] = []
      for (const match of sourceText.matchAll(/^\s*import\s+(?:(_|\.|[A-Za-z_]\w*)\s+)?"([^"]+)"/gm)) {
        if (match[1] === '_') {
          expectedBlankImportCount += 1
        }
        if (match[1] === '.') {
          expectedDotImportCount += 1
        }
        if (typeof match[1] === 'string' && match[1] !== '_' && match[1] !== '.') {
          expectedAliasedImportCount += 1
        }
        importPaths.push(match[2])
      }
      for (const match of sourceText.matchAll(/^\s*import\s*\(([\s\S]*?)^\s*\)/gm)) {
        for (const importMatch of match[1].matchAll(/^\s*(?:(_|\.|[A-Za-z_]\w*)\s+)?"([^"]+)"/gm)) {
          if (importMatch[1] === '_') {
            expectedBlankImportCount += 1
          }
          if (importMatch[1] === '.') {
            expectedDotImportCount += 1
          }
          if (typeof importMatch[1] === 'string' && importMatch[1] !== '_' && importMatch[1] !== '.') {
            expectedAliasedImportCount += 1
          }
          importPaths.push(importMatch[2])
        }
      }
      expectedImportCount += importPaths.length
      for (const importPath of importPaths) {
        for (const byte of textEncoder.encode(importPath)) {
          expectedImportPathHash = (expectedImportPathHash + (byte * importPathHashPosition)) >>> 0
          importPathHashPosition += 1
        }
        expectedImportPathHash = (expectedImportPathHash + (0x0a * importPathHashPosition)) >>> 0
        importPathHashPosition += 1
      }
    }
    if (importCount !== expectedImportCount) {
      throw new Error('frontend lowered artifact probe import count did not match lowered sources manifest')
    }
    const importPathHashExportName = `tinygo_lowered_${symbolID}_import_path_hash`
    const importPathHashExportValue = exportsObject[importPathHashExportName]
    if (typeof importPathHashExportValue !== 'function') {
      throw new Error(`frontend lowered artifact probe missing export ${importPathHashExportName}`)
    }
    const importPathHash = Number(importPathHashExportValue())
    if (!Number.isInteger(importPathHash) || importPathHash < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid import path hash for ${importPathHashExportName}`)
    }
    if (importPathHash !== expectedImportPathHash) {
      throw new Error('frontend lowered artifact probe import path hash did not match lowered sources manifest')
    }
    const blankImportCountExportName = `tinygo_lowered_${symbolID}_blank_import_count`
    const blankImportCountExportValue = exportsObject[blankImportCountExportName]
    const blankImportCount = typeof blankImportCountExportValue === 'function' ? Number(blankImportCountExportValue()) : expectedBlankImportCount
    if (!Number.isInteger(blankImportCount) || blankImportCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid blank import count for ${blankImportCountExportName}`)
    }
    if (typeof blankImportCountExportValue === 'function' && blankImportCount !== expectedBlankImportCount) {
      throw new Error('frontend lowered artifact probe blank import count did not match lowered sources manifest')
    }
    const dotImportCountExportName = `tinygo_lowered_${symbolID}_dot_import_count`
    const dotImportCountExportValue = exportsObject[dotImportCountExportName]
    const dotImportCount = typeof dotImportCountExportValue === 'function' ? Number(dotImportCountExportValue()) : expectedDotImportCount
    if (!Number.isInteger(dotImportCount) || dotImportCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid dot import count for ${dotImportCountExportName}`)
    }
    if (typeof dotImportCountExportValue === 'function' && dotImportCount !== expectedDotImportCount) {
      throw new Error('frontend lowered artifact probe dot import count did not match lowered sources manifest')
    }
    const aliasedImportCountExportName = `tinygo_lowered_${symbolID}_aliased_import_count`
    const aliasedImportCountExportValue = exportsObject[aliasedImportCountExportName]
    const aliasedImportCount = typeof aliasedImportCountExportValue === 'function' ? Number(aliasedImportCountExportValue()) : expectedAliasedImportCount
    if (!Number.isInteger(aliasedImportCount) || aliasedImportCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid aliased import count for ${aliasedImportCountExportName}`)
    }
    if (typeof aliasedImportCountExportValue === 'function' && aliasedImportCount !== expectedAliasedImportCount) {
      throw new Error('frontend lowered artifact probe aliased import count did not match lowered sources manifest')
    }
    const functionCountExportName = `tinygo_lowered_${symbolID}_function_count`
    const functionCountExportValue = exportsObject[functionCountExportName]
    if (typeof functionCountExportValue !== 'function') {
      throw new Error(`frontend lowered artifact probe missing export ${functionCountExportName}`)
    }
    const functionCount = Number(functionCountExportValue())
    if (!Number.isInteger(functionCount) || functionCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid function count for ${functionCountExportName}`)
    }
    let expectedFunctionCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedFunctionCount += (sourceText.match(/^\s*func(?:\s*\(|\s+[A-Za-z_])/gm) ?? []).length
    }
    if (functionCount !== expectedFunctionCount) {
      throw new Error('frontend lowered artifact probe function count did not match lowered sources manifest')
    }
    const placeholderBlockCountExportName = `tinygo_lowered_${symbolID}_placeholder_block_count`
    const placeholderBlockCountExportValue = exportsObject[placeholderBlockCountExportName]
    const expectedPlaceholderBlockCount = Array.isArray(loweredIRUnit?.placeholderBlocks)
      ? (loweredIRUnit?.placeholderBlocks ?? []).length
      : expectedImportCount + expectedFunctionCount + ((loweredIRUnit?.declarations ?? []).length)
    const placeholderBlockCount =
      typeof placeholderBlockCountExportValue === 'function' ? Number(placeholderBlockCountExportValue()) : expectedPlaceholderBlockCount
    if (!Number.isInteger(placeholderBlockCount) || placeholderBlockCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid placeholder block count for ${placeholderBlockCountExportName}`)
    }
    if (typeof placeholderBlockCountExportValue === 'function' && placeholderBlockCount !== expectedPlaceholderBlockCount) {
      throw new Error('frontend lowered artifact probe placeholder block count did not match lowered sources manifest')
    }
    const placeholderBlockHashExportName = `tinygo_lowered_${symbolID}_placeholder_block_hash`
    const placeholderBlockHashExportValue = exportsObject[placeholderBlockHashExportName]
    let expectedPlaceholderBlockHash = 0
    if (Array.isArray(loweredIRUnit?.placeholderBlocks)) {
      let placeholderBlockHashPosition = 1
      for (const placeholderBlock of loweredIRUnit?.placeholderBlocks ?? []) {
        for (const byte of textEncoder.encode(placeholderBlock.value ?? '')) {
          expectedPlaceholderBlockHash = (expectedPlaceholderBlockHash + (byte * placeholderBlockHashPosition)) >>> 0
          placeholderBlockHashPosition += 1
        }
        expectedPlaceholderBlockHash = (expectedPlaceholderBlockHash + (0x0a * placeholderBlockHashPosition)) >>> 0
        placeholderBlockHashPosition += 1
      }
    } else if (loweredIRUnit) {
      let placeholderBlockHashPosition = 1
      for (const loweredImport of loweredIRUnit.imports ?? []) {
        const placeholderBlock =
          loweredImport.alias && loweredImport.alias !== ''
            ? `import:${loweredImport.alias}=${loweredImport.path ?? ''}`
            : `import:${loweredImport.path ?? ''}`
        for (const byte of textEncoder.encode(placeholderBlock)) {
          expectedPlaceholderBlockHash = (expectedPlaceholderBlockHash + (byte * placeholderBlockHashPosition)) >>> 0
          placeholderBlockHashPosition += 1
        }
        expectedPlaceholderBlockHash = (expectedPlaceholderBlockHash + (0x0a * placeholderBlockHashPosition)) >>> 0
        placeholderBlockHashPosition += 1
      }
      for (const loweredFunction of loweredIRUnit.functions ?? []) {
        const placeholderBlock =
          `function:${loweredFunction.name ?? ''}:` +
          `${loweredFunction.exported ? 1 : 0}:` +
          `${loweredFunction.method ? 1 : 0}:` +
          `${loweredFunction.main ? 1 : 0}:` +
          `${loweredFunction.init ? 1 : 0}:` +
          `${loweredFunction.parameters ?? 0}:` +
          `${loweredFunction.results ?? 0}`
        for (const byte of textEncoder.encode(placeholderBlock)) {
          expectedPlaceholderBlockHash = (expectedPlaceholderBlockHash + (byte * placeholderBlockHashPosition)) >>> 0
          placeholderBlockHashPosition += 1
        }
        expectedPlaceholderBlockHash = (expectedPlaceholderBlockHash + (0x0a * placeholderBlockHashPosition)) >>> 0
        placeholderBlockHashPosition += 1
      }
      for (const declaration of loweredIRUnit.declarations ?? []) {
        const placeholderBlock =
          `declaration:${declaration.kind ?? ''}:${declaration.name ?? ''}:` +
          `${declaration.exported ? 1 : 0}:` +
          `${declaration.method ? 1 : 0}`
        for (const byte of textEncoder.encode(placeholderBlock)) {
          expectedPlaceholderBlockHash = (expectedPlaceholderBlockHash + (byte * placeholderBlockHashPosition)) >>> 0
          placeholderBlockHashPosition += 1
        }
        expectedPlaceholderBlockHash = (expectedPlaceholderBlockHash + (0x0a * placeholderBlockHashPosition)) >>> 0
        placeholderBlockHashPosition += 1
      }
    }
    const placeholderBlockHash =
      typeof placeholderBlockHashExportValue === 'function' ? Number(placeholderBlockHashExportValue()) : expectedPlaceholderBlockHash
    if (!Number.isInteger(placeholderBlockHash) || placeholderBlockHash < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid placeholder block hash for ${placeholderBlockHashExportName}`)
    }
    if (typeof placeholderBlockHashExportValue === 'function' && loweredIRUnit && placeholderBlockHash !== expectedPlaceholderBlockHash) {
      throw new Error('frontend lowered artifact probe placeholder block hash did not match lowered sources manifest')
    }
    const placeholderBlockSignatureHashExportName = `tinygo_lowered_${symbolID}_placeholder_block_signature_hash`
    const placeholderBlockSignatureHashExportValue = exportsObject[placeholderBlockSignatureHashExportName]
    let expectedPlaceholderBlockSignatureHash = 0
    if (loweredIRUnit) {
      let placeholderBlockSignatureHashPosition = 1
      if (
        Array.isArray(loweredIRUnit.placeholderBlocks) &&
        loweredIRUnit.placeholderBlocks.every((placeholderBlock) => typeof placeholderBlock?.signature === 'string')
      ) {
        for (const placeholderBlock of loweredIRUnit.placeholderBlocks ?? []) {
          for (const byte of textEncoder.encode(placeholderBlock.signature ?? '')) {
            expectedPlaceholderBlockSignatureHash = (expectedPlaceholderBlockSignatureHash + (byte * placeholderBlockSignatureHashPosition)) >>> 0
            placeholderBlockSignatureHashPosition += 1
          }
          expectedPlaceholderBlockSignatureHash = (expectedPlaceholderBlockSignatureHash + (0x0a * placeholderBlockSignatureHashPosition)) >>> 0
          placeholderBlockSignatureHashPosition += 1
        }
      } else {
        for (const loweredImport of loweredIRUnit.imports ?? []) {
          const placeholderBlockSignature =
            loweredImport.alias && loweredImport.alias !== ''
              ? `${loweredImport.alias}=${loweredImport.path ?? ''}`
              : `${loweredImport.path ?? ''}`
          for (const byte of textEncoder.encode(placeholderBlockSignature)) {
            expectedPlaceholderBlockSignatureHash = (expectedPlaceholderBlockSignatureHash + (byte * placeholderBlockSignatureHashPosition)) >>> 0
            placeholderBlockSignatureHashPosition += 1
          }
          expectedPlaceholderBlockSignatureHash = (expectedPlaceholderBlockSignatureHash + (0x0a * placeholderBlockSignatureHashPosition)) >>> 0
          placeholderBlockSignatureHashPosition += 1
        }
        for (const loweredFunction of loweredIRUnit.functions ?? []) {
          const placeholderBlockSignature = `${loweredFunction.name ?? ''}:${loweredFunction.exported ? '1' : '0'}:${loweredFunction.method ? '1' : '0'}:${loweredFunction.main ? '1' : '0'}:${loweredFunction.init ? '1' : '0'}:${loweredFunction.parameters ?? 0}:${loweredFunction.results ?? 0}`
          for (const byte of textEncoder.encode(placeholderBlockSignature)) {
            expectedPlaceholderBlockSignatureHash = (expectedPlaceholderBlockSignatureHash + (byte * placeholderBlockSignatureHashPosition)) >>> 0
            placeholderBlockSignatureHashPosition += 1
          }
          expectedPlaceholderBlockSignatureHash = (expectedPlaceholderBlockSignatureHash + (0x0a * placeholderBlockSignatureHashPosition)) >>> 0
          placeholderBlockSignatureHashPosition += 1
        }
        for (const declaration of loweredIRUnit.declarations ?? []) {
          const placeholderBlockSignature = `${declaration.kind ?? ''}:${declaration.name ?? ''}:${declaration.exported ? '1' : '0'}:${declaration.method ? '1' : '0'}`
          for (const byte of textEncoder.encode(placeholderBlockSignature)) {
            expectedPlaceholderBlockSignatureHash = (expectedPlaceholderBlockSignatureHash + (byte * placeholderBlockSignatureHashPosition)) >>> 0
            placeholderBlockSignatureHashPosition += 1
          }
          expectedPlaceholderBlockSignatureHash = (expectedPlaceholderBlockSignatureHash + (0x0a * placeholderBlockSignatureHashPosition)) >>> 0
          placeholderBlockSignatureHashPosition += 1
        }
      }
    }
    const placeholderBlockSignatureHash =
      typeof placeholderBlockSignatureHashExportValue === 'function'
        ? Number(placeholderBlockSignatureHashExportValue())
        : expectedPlaceholderBlockSignatureHash
    if (!Number.isInteger(placeholderBlockSignatureHash) || placeholderBlockSignatureHash < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid placeholder block signature hash for ${placeholderBlockSignatureHashExportName}`)
    }
    if (
      typeof placeholderBlockSignatureHashExportValue === 'function' &&
      loweredIRUnit &&
      placeholderBlockSignatureHash !== expectedPlaceholderBlockSignatureHash
    ) {
      throw new Error('frontend lowered artifact probe placeholder block signature hash did not match lowered sources manifest')
    }
    const placeholderBlockRuntimeHashExportName = `tinygo_lowered_${symbolID}_placeholder_block_runtime_hash`
    const placeholderBlockRuntimeHashExportValue = exportsObject[placeholderBlockRuntimeHashExportName]
    const placeholderBlockRuntimeHash =
      typeof placeholderBlockRuntimeHashExportValue === 'function'
        ? Number(placeholderBlockRuntimeHashExportValue())
        : expectedPlaceholderBlockHash
    if (!Number.isInteger(placeholderBlockRuntimeHash) || placeholderBlockRuntimeHash < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid placeholder block runtime hash for ${placeholderBlockRuntimeHashExportName}`)
    }
    if (typeof placeholderBlockRuntimeHashExportValue === 'function' && loweredIRUnit && placeholderBlockRuntimeHash !== expectedPlaceholderBlockHash) {
      throw new Error('frontend lowered artifact probe placeholder block runtime hash did not match lowered sources manifest')
    }
    const loweringBlockCountExportName = `tinygo_lowered_${symbolID}_lowering_block_count`
    const loweringBlockCountExportValue = exportsObject[loweringBlockCountExportName]
    const expectedLoweringBlockCount = expectedPlaceholderBlockCount
    const loweringBlockCount =
      typeof loweringBlockCountExportValue === 'function' ? Number(loweringBlockCountExportValue()) : expectedLoweringBlockCount
    if (!Number.isInteger(loweringBlockCount) || loweringBlockCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid lowering block count for ${loweringBlockCountExportName}`)
    }
    if (typeof loweringBlockCountExportValue === 'function' && loweringBlockCount !== expectedLoweringBlockCount) {
      throw new Error('frontend lowered artifact probe lowering block count did not match lowered sources manifest')
    }
    const loweringBlockHashExportName = `tinygo_lowered_${symbolID}_lowering_block_hash`
    const loweringBlockHashExportValue = exportsObject[loweringBlockHashExportName]
    let expectedLoweringBlockHash = 0
    if (loweredIRUnit) {
      let loweringBlockHashPosition = 1
      const expectedLoweringBlocks = Array.isArray(loweredIRUnit.loweringBlocks)
        ? loweredIRUnit.loweringBlocks.map((loweringBlock) => loweringBlock.value ?? '')
        : [
            ...(loweredIRUnit.imports ?? []).map((loweredImport, loweredImportIndex) =>
              `tinygo_lower_unit_begin("${loweredIRUnit.id ?? ''}", "${loweredIRUnit.kind ?? ''}", "${loweredIRUnit.packageName ?? ''}", ${(loweredIRUnit.sourceFiles ?? []).length});` +
              `tinygo_lower_import_begin();` +
              `tinygo_emit_import_index(${loweredImportIndex});` +
              `tinygo_emit_import_alias("${loweredImport.alias ?? ''}");` +
              `tinygo_emit_import_path("${loweredImport.path ?? ''}");` +
              `tinygo_emit_import_signature("${loweredImport.alias ? `${loweredImport.alias}=` : ''}${loweredImport.path ?? ''}");` +
              `tinygo_lower_import_end();` +
              `tinygo_lower_unit_end()`,
            ),
            ...(loweredIRUnit.functions ?? []).map((loweredFunction, loweredFunctionIndex) =>
              `tinygo_lower_unit_begin("${loweredIRUnit.id ?? ''}", "${loweredIRUnit.kind ?? ''}", "${loweredIRUnit.packageName ?? ''}", ${(loweredIRUnit.sourceFiles ?? []).length});` +
              `tinygo_lower_function_begin("${loweredIRUnit.packageName ?? ''}", "${loweredFunction.name ?? ''}");` +
              `tinygo_emit_function_index(${loweredFunctionIndex});` +
              `tinygo_emit_function_flags(` +
              `${loweredFunction.exported ? 1 : 0}, ` +
              `${loweredFunction.method ? 1 : 0}, ` +
              `${loweredFunction.main ? 1 : 0}, ` +
              `${loweredFunction.init ? 1 : 0});` +
              `tinygo_emit_function_signature(${loweredFunction.parameters ?? 0}, ${loweredFunction.results ?? 0});` +
              `tinygo_emit_function_stream("${loweredFunction.name ?? ''}:${loweredFunction.exported ? '1' : '0'}:${loweredFunction.method ? '1' : '0'}:${loweredFunction.main ? '1' : '0'}:${loweredFunction.init ? '1' : '0'}:${loweredFunction.parameters ?? 0}:${loweredFunction.results ?? 0}");` +
              `tinygo_lower_function_end();` +
              `tinygo_lower_unit_end()`,
            ),
            ...(loweredIRUnit.declarations ?? []).map((declaration, declarationIndex) =>
              `tinygo_lower_unit_begin("${loweredIRUnit.id ?? ''}", "${loweredIRUnit.kind ?? ''}", "${loweredIRUnit.packageName ?? ''}", ${(loweredIRUnit.sourceFiles ?? []).length});` +
              `tinygo_lower_declaration_begin("${loweredIRUnit.packageName ?? ''}", "${declaration.kind ?? ''}", "${declaration.name ?? ''}");` +
              `tinygo_emit_declaration_index(${declarationIndex});` +
              `tinygo_emit_declaration_flags(${declaration.exported ? 1 : 0}, ${declaration.method ? 1 : 0});` +
              `tinygo_emit_declaration_signature("${declaration.kind ?? ''}:${declaration.name ?? ''}:${declaration.exported ? 1 : 0}:${declaration.method ? 1 : 0}");` +
              `tinygo_lower_declaration_end();` +
              `tinygo_lower_unit_end()`,
            ),
          ]
      for (const loweringBlock of expectedLoweringBlocks) {
        for (const byte of textEncoder.encode(loweringBlock)) {
          expectedLoweringBlockHash = (expectedLoweringBlockHash + (byte * loweringBlockHashPosition)) >>> 0
          loweringBlockHashPosition += 1
        }
        expectedLoweringBlockHash = (expectedLoweringBlockHash + (0x0a * loweringBlockHashPosition)) >>> 0
        loweringBlockHashPosition += 1
      }
    }
    const loweringBlockHash =
      typeof loweringBlockHashExportValue === 'function' ? Number(loweringBlockHashExportValue()) : expectedLoweringBlockHash
    if (!Number.isInteger(loweringBlockHash) || loweringBlockHash < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid lowering block hash for ${loweringBlockHashExportName}`)
    }
    if (typeof loweringBlockHashExportValue === 'function' && loweredIRUnit && loweringBlockHash !== expectedLoweringBlockHash) {
      throw new Error('frontend lowered artifact probe lowering block hash did not match lowered sources manifest')
    }
    const loweringBlockRuntimeHashExportName = `tinygo_lowered_${symbolID}_lowering_block_runtime_hash`
    const loweringBlockRuntimeHashExportValue = exportsObject[loweringBlockRuntimeHashExportName]
    const loweringBlockRuntimeHash =
      typeof loweringBlockRuntimeHashExportValue === 'function'
        ? Number(loweringBlockRuntimeHashExportValue())
        : expectedLoweringBlockHash
    if (!Number.isInteger(loweringBlockRuntimeHash) || loweringBlockRuntimeHash < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid lowering block runtime hash for ${loweringBlockRuntimeHashExportName}`)
    }
    if (typeof loweringBlockRuntimeHashExportValue === 'function' && loweredIRUnit && loweringBlockRuntimeHash !== expectedLoweringBlockHash) {
      throw new Error('frontend lowered artifact probe lowering block runtime hash did not match lowered sources manifest')
    }
    const funcLiteralCountExportName = `tinygo_lowered_${symbolID}_func_literal_count`
    const funcLiteralCountExportValue = exportsObject[funcLiteralCountExportName]
    let expectedFuncLiteralCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      for (const match of sourceText.matchAll(/\bfunc\s*\(/g)) {
        const tail = sourceText.slice(match.index)
        if (/^func\s*\([^)]*\)\s*[A-Za-z_]\w*\s*\(/.test(tail)) {
          continue
        }
        expectedFuncLiteralCount += 1
      }
    }
    const funcLiteralCount = typeof funcLiteralCountExportValue === 'function' ? Number(funcLiteralCountExportValue()) : expectedFuncLiteralCount
    if (!Number.isInteger(funcLiteralCount) || funcLiteralCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid func literal count for ${funcLiteralCountExportName}`)
    }
    if (typeof funcLiteralCountExportValue === 'function' && funcLiteralCount !== expectedFuncLiteralCount) {
      throw new Error('frontend lowered artifact probe func literal count did not match lowered sources manifest')
    }
    const funcParameterCountExportName = `tinygo_lowered_${symbolID}_func_parameter_count`
    const funcParameterCountExportValue = exportsObject[funcParameterCountExportName]
    const funcResultCountExportName = `tinygo_lowered_${symbolID}_func_result_count`
    const funcResultCountExportValue = exportsObject[funcResultCountExportName]
    let expectedFuncParameterCount = 0
    let expectedFuncResultCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      for (const match of sourceText.matchAll(/\bfunc(?:\s*\([^)]*\))?\s+[A-Za-z_]\w*(?:\s*\[[^\]]+\])?\s*\(([^)]*)\)\s*([^{\n]*)\{/g)) {
        const paramsText = match[1].trim()
        if (paramsText !== '') {
          expectedFuncParameterCount += paramsText.split(',').map((part) => part.trim()).filter((part) => part !== '').length
        }
        const resultsText = match[2].trim()
        if (resultsText === '') {
          continue
        }
        if (resultsText.startsWith('(') && resultsText.endsWith(')')) {
          const innerResultsText = resultsText.slice(1, -1).trim()
          if (innerResultsText !== '') {
            expectedFuncResultCount += innerResultsText.split(',').map((part) => part.trim()).filter((part) => part !== '').length
          }
          continue
        }
        expectedFuncResultCount += 1
      }
      for (const match of sourceText.matchAll(/\bfunc\s*\(([^)]*)\)\s*([^{\n]*)\{/g)) {
        const tail = sourceText.slice(match.index)
        if (/^func\s*\([^)]*\)\s*[A-Za-z_]\w*\s*\(/.test(tail)) {
          continue
        }
        const paramsText = match[1].trim()
        if (paramsText !== '') {
          expectedFuncParameterCount += paramsText.split(',').map((part) => part.trim()).filter((part) => part !== '').length
        }
        const resultsText = match[2].trim()
        if (resultsText === '') {
          continue
        }
        if (resultsText.startsWith('(') && resultsText.endsWith(')')) {
          const innerResultsText = resultsText.slice(1, -1).trim()
          if (innerResultsText !== '') {
            expectedFuncResultCount += innerResultsText.split(',').map((part) => part.trim()).filter((part) => part !== '').length
          }
          continue
        }
        expectedFuncResultCount += 1
      }
    }
    const funcParameterCount =
      typeof funcParameterCountExportValue === 'function' ? Number(funcParameterCountExportValue()) : expectedFuncParameterCount
    if (!Number.isInteger(funcParameterCount) || funcParameterCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid func parameter count for ${funcParameterCountExportName}`)
    }
    if (typeof funcParameterCountExportValue === 'function' && funcParameterCount !== expectedFuncParameterCount) {
      throw new Error('frontend lowered artifact probe func parameter count did not match lowered sources manifest')
    }
    const funcResultCount = typeof funcResultCountExportValue === 'function' ? Number(funcResultCountExportValue()) : expectedFuncResultCount
    if (!Number.isInteger(funcResultCount) || funcResultCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid func result count for ${funcResultCountExportName}`)
    }
    if (typeof funcResultCountExportValue === 'function' && funcResultCount !== expectedFuncResultCount) {
      throw new Error('frontend lowered artifact probe func result count did not match lowered sources manifest')
    }
    const variadicParameterCountExportName = `tinygo_lowered_${symbolID}_variadic_parameter_count`
    const variadicParameterCountExportValue = exportsObject[variadicParameterCountExportName]
    const namedResultCountExportName = `tinygo_lowered_${symbolID}_named_result_count`
    const namedResultCountExportValue = exportsObject[namedResultCountExportName]
    let expectedVariadicParameterCount = 0
    let expectedNamedResultCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      for (const match of sourceText.matchAll(/\bfunc(?:\s*\([^)]*\))?\s+[A-Za-z_]\w*(?:\s*\[[^\]]+\])?\s*\(([^)]*)\)\s*([^{\n]*)\{/g)) {
        const paramsText = match[1].trim()
        if (paramsText !== '') {
          expectedVariadicParameterCount += (paramsText.match(/\.\.\./g) ?? []).length
        }
        const resultsText = match[2].trim()
        if (!(resultsText.startsWith('(') && resultsText.endsWith(')'))) {
          continue
        }
        const innerResultsText = resultsText.slice(1, -1).trim()
        if (innerResultsText === '') {
          continue
        }
        for (const resultPart of innerResultsText.split(',').map((part) => part.trim()).filter((part) => part !== '')) {
          if (/^[A-Za-z_]\w*\s+/.test(resultPart)) {
            expectedNamedResultCount += 1
          }
        }
      }
      for (const match of sourceText.matchAll(/\bfunc\s*\(([^)]*)\)\s*([^{\n]*)\{/g)) {
        const tail = sourceText.slice(match.index)
        if (/^func\s*\([^)]*\)\s*[A-Za-z_]\w*\s*\(/.test(tail)) {
          continue
        }
        const paramsText = match[1].trim()
        if (paramsText !== '') {
          expectedVariadicParameterCount += (paramsText.match(/\.\.\./g) ?? []).length
        }
        const resultsText = match[2].trim()
        if (!(resultsText.startsWith('(') && resultsText.endsWith(')'))) {
          continue
        }
        const innerResultsText = resultsText.slice(1, -1).trim()
        if (innerResultsText === '') {
          continue
        }
        for (const resultPart of innerResultsText.split(',').map((part) => part.trim()).filter((part) => part !== '')) {
          if (/^[A-Za-z_]\w*\s+/.test(resultPart)) {
            expectedNamedResultCount += 1
          }
        }
      }
    }
    const variadicParameterCount =
      typeof variadicParameterCountExportValue === 'function' ? Number(variadicParameterCountExportValue()) : expectedVariadicParameterCount
    if (!Number.isInteger(variadicParameterCount) || variadicParameterCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid variadic parameter count for ${variadicParameterCountExportName}`)
    }
    if (typeof variadicParameterCountExportValue === 'function' && variadicParameterCount !== expectedVariadicParameterCount) {
      throw new Error('frontend lowered artifact probe variadic parameter count did not match lowered sources manifest')
    }
    const namedResultCount =
      typeof namedResultCountExportValue === 'function' ? Number(namedResultCountExportValue()) : expectedNamedResultCount
    if (!Number.isInteger(namedResultCount) || namedResultCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid named result count for ${namedResultCountExportName}`)
    }
    if (typeof namedResultCountExportValue === 'function' && namedResultCount !== expectedNamedResultCount) {
      throw new Error('frontend lowered artifact probe named result count did not match lowered sources manifest')
    }
    const typeParameterCountExportName = `tinygo_lowered_${symbolID}_type_parameter_count`
    const typeParameterCountExportValue = exportsObject[typeParameterCountExportName]
    let expectedTypeParameterCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      for (const match of sourceText.matchAll(/\bfunc(?:\s*\([^)]*\))?\s+[A-Za-z_]\w*\s*\[([^\]]+)\]\s*\(/g)) {
        expectedTypeParameterCount += match[1].split(',').map((part) => part.trim()).filter((part) => part !== '').length
      }
      for (const match of sourceText.matchAll(/^\s*type\s+[A-Za-z_]\w*\s*\[([^\]]+)\]/gm)) {
        expectedTypeParameterCount += match[1].split(',').map((part) => part.trim()).filter((part) => part !== '').length
      }
    }
    const typeParameterCount =
      typeof typeParameterCountExportValue === 'function' ? Number(typeParameterCountExportValue()) : expectedTypeParameterCount
    if (!Number.isInteger(typeParameterCount) || typeParameterCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid type parameter count for ${typeParameterCountExportName}`)
    }
    if (typeof typeParameterCountExportValue === 'function' && typeParameterCount !== expectedTypeParameterCount) {
      throw new Error('frontend lowered artifact probe type parameter count did not match lowered sources manifest')
    }
    const genericFunctionCountExportName = `tinygo_lowered_${symbolID}_generic_function_count`
    const genericFunctionCountExportValue = exportsObject[genericFunctionCountExportName]
    let expectedGenericFunctionCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedGenericFunctionCount += (sourceText.match(/^\s*func(?:\s*\([^)]*\))?\s+[A-Za-z_]\w*\s*\[[^\]]+\]\s*\(/gm) ?? []).length
    }
    const genericFunctionCount =
      typeof genericFunctionCountExportValue === 'function' ? Number(genericFunctionCountExportValue()) : expectedGenericFunctionCount
    if (!Number.isInteger(genericFunctionCount) || genericFunctionCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid generic function count for ${genericFunctionCountExportName}`)
    }
    if (typeof genericFunctionCountExportValue === 'function' && genericFunctionCount !== expectedGenericFunctionCount) {
      throw new Error('frontend lowered artifact probe generic function count did not match lowered sources manifest')
    }
    const genericTypeCountExportName = `tinygo_lowered_${symbolID}_generic_type_count`
    const genericTypeCountExportValue = exportsObject[genericTypeCountExportName]
    let expectedGenericTypeCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedGenericTypeCount += (sourceText.match(/^\s*type\s+[A-Za-z_]\w*\s*\[[^\]]+\]/gm) ?? []).length
    }
    const genericTypeCount =
      typeof genericTypeCountExportValue === 'function' ? Number(genericTypeCountExportValue()) : expectedGenericTypeCount
    if (!Number.isInteger(genericTypeCount) || genericTypeCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid generic type count for ${genericTypeCountExportName}`)
    }
    if (typeof genericTypeCountExportValue === 'function' && genericTypeCount !== expectedGenericTypeCount) {
      throw new Error('frontend lowered artifact probe generic type count did not match lowered sources manifest')
    }
    const methodCountExportName = `tinygo_lowered_${symbolID}_method_count`
    const methodCountExportValue = exportsObject[methodCountExportName]
    const callExpressionCountExportName = `tinygo_lowered_${symbolID}_call_expression_count`
    const callExpressionCountExportValue = exportsObject[callExpressionCountExportName]
    let expectedCallExpressionCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      const normalizedSourceText = sourceText
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/"(?:\\.|[^"\\])*"/g, '""')
        .replace(/`[\s\S]*?`/g, '``')
      const callSearchSourceText = normalizedSourceText.replace(/\binterface\s*\{[\s\S]*?\}/g, 'interface{}')
      expectedCallExpressionCount +=
        [...callSearchSourceText.matchAll(/\b([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?)\s*\(/g)].filter((match) => match[1] !== 'func').length -
        (callSearchSourceText.match(/^\s*func(?:\s*\([^)]*\))?\s+[A-Za-z_]\w*(?:\s*\[[^\]]+\])?\s*\(/gm) ?? []).length
    }
    const callExpressionCount = typeof callExpressionCountExportValue === 'function' ? Number(callExpressionCountExportValue()) : expectedCallExpressionCount
    if (!Number.isInteger(callExpressionCount) || callExpressionCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid call expression count for ${callExpressionCountExportName}`)
    }
    if (typeof callExpressionCountExportValue === 'function' && callExpressionCount !== expectedCallExpressionCount) {
      throw new Error('frontend lowered artifact probe call expression count did not match lowered sources manifest')
    }
    const builtinCallCountExportName = `tinygo_lowered_${symbolID}_builtin_call_count`
    const builtinCallCountExportValue = exportsObject[builtinCallCountExportName]
    let expectedBuiltinCallCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedBuiltinCallCount += (
        sourceText.match(/\b(?:append|cap|clear|close|complex|copy|delete|imag|len|make|max|min|new|panic|print|println|real|recover)\s*\(/g) ?? []
      ).length
    }
    const builtinCallCount =
      typeof builtinCallCountExportValue === 'function' ? Number(builtinCallCountExportValue()) : expectedBuiltinCallCount
    if (!Number.isInteger(builtinCallCount) || builtinCallCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid builtin call count for ${builtinCallCountExportName}`)
    }
    if (typeof builtinCallCountExportValue === 'function' && builtinCallCount !== expectedBuiltinCallCount) {
      throw new Error('frontend lowered artifact probe builtin call count did not match lowered sources manifest')
    }
    const appendCallCountExportName = `tinygo_lowered_${symbolID}_append_call_count`
    const appendCallCountExportValue = exportsObject[appendCallCountExportName]
    let expectedAppendCallCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedAppendCallCount += (sourceText.match(/\bappend\s*\(/g) ?? []).length
    }
    const appendCallCount =
      typeof appendCallCountExportValue === 'function' ? Number(appendCallCountExportValue()) : expectedAppendCallCount
    if (!Number.isInteger(appendCallCount) || appendCallCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid append call count for ${appendCallCountExportName}`)
    }
    if (typeof appendCallCountExportValue === 'function' && appendCallCount !== expectedAppendCallCount) {
      throw new Error('frontend lowered artifact probe append call count did not match lowered sources manifest')
    }
    const lenCallCountExportName = `tinygo_lowered_${symbolID}_len_call_count`
    const lenCallCountExportValue = exportsObject[lenCallCountExportName]
    let expectedLenCallCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedLenCallCount += (sourceText.match(/\blen\s*\(/g) ?? []).length
    }
    const lenCallCount = typeof lenCallCountExportValue === 'function' ? Number(lenCallCountExportValue()) : expectedLenCallCount
    if (!Number.isInteger(lenCallCount) || lenCallCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid len call count for ${lenCallCountExportName}`)
    }
    if (typeof lenCallCountExportValue === 'function' && lenCallCount !== expectedLenCallCount) {
      throw new Error('frontend lowered artifact probe len call count did not match lowered sources manifest')
    }
    const makeCallCountExportName = `tinygo_lowered_${symbolID}_make_call_count`
    const makeCallCountExportValue = exportsObject[makeCallCountExportName]
    let expectedMakeCallCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedMakeCallCount += (sourceText.match(/\bmake\s*\(/g) ?? []).length
    }
    const makeCallCount =
      typeof makeCallCountExportValue === 'function' ? Number(makeCallCountExportValue()) : expectedMakeCallCount
    if (!Number.isInteger(makeCallCount) || makeCallCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid make call count for ${makeCallCountExportName}`)
    }
    if (typeof makeCallCountExportValue === 'function' && makeCallCount !== expectedMakeCallCount) {
      throw new Error('frontend lowered artifact probe make call count did not match lowered sources manifest')
    }
    const capCallCountExportName = `tinygo_lowered_${symbolID}_cap_call_count`
    const capCallCountExportValue = exportsObject[capCallCountExportName]
    let expectedCapCallCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedCapCallCount += (sourceText.match(/\bcap\s*\(/g) ?? []).length
    }
    const capCallCount =
      typeof capCallCountExportValue === 'function' ? Number(capCallCountExportValue()) : expectedCapCallCount
    if (!Number.isInteger(capCallCount) || capCallCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid cap call count for ${capCallCountExportName}`)
    }
    if (typeof capCallCountExportValue === 'function' && capCallCount !== expectedCapCallCount) {
      throw new Error('frontend lowered artifact probe cap call count did not match lowered sources manifest')
    }
    const copyCallCountExportName = `tinygo_lowered_${symbolID}_copy_call_count`
    const copyCallCountExportValue = exportsObject[copyCallCountExportName]
    let expectedCopyCallCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedCopyCallCount += (sourceText.match(/\bcopy\s*\(/g) ?? []).length
    }
    const copyCallCount =
      typeof copyCallCountExportValue === 'function' ? Number(copyCallCountExportValue()) : expectedCopyCallCount
    if (!Number.isInteger(copyCallCount) || copyCallCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid copy call count for ${copyCallCountExportName}`)
    }
    if (typeof copyCallCountExportValue === 'function' && copyCallCount !== expectedCopyCallCount) {
      throw new Error('frontend lowered artifact probe copy call count did not match lowered sources manifest')
    }
    const panicCallCountExportName = `tinygo_lowered_${symbolID}_panic_call_count`
    const panicCallCountExportValue = exportsObject[panicCallCountExportName]
    let expectedPanicCallCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedPanicCallCount += (sourceText.match(/\bpanic\s*\(/g) ?? []).length
    }
    const panicCallCount =
      typeof panicCallCountExportValue === 'function' ? Number(panicCallCountExportValue()) : expectedPanicCallCount
    if (!Number.isInteger(panicCallCount) || panicCallCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid panic call count for ${panicCallCountExportName}`)
    }
    if (typeof panicCallCountExportValue === 'function' && panicCallCount !== expectedPanicCallCount) {
      throw new Error('frontend lowered artifact probe panic call count did not match lowered sources manifest')
    }
    const recoverCallCountExportName = `tinygo_lowered_${symbolID}_recover_call_count`
    const recoverCallCountExportValue = exportsObject[recoverCallCountExportName]
    let expectedRecoverCallCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedRecoverCallCount += (sourceText.match(/\brecover\s*\(/g) ?? []).length
    }
    const recoverCallCount =
      typeof recoverCallCountExportValue === 'function' ? Number(recoverCallCountExportValue()) : expectedRecoverCallCount
    if (!Number.isInteger(recoverCallCount) || recoverCallCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid recover call count for ${recoverCallCountExportName}`)
    }
    if (typeof recoverCallCountExportValue === 'function' && recoverCallCount !== expectedRecoverCallCount) {
      throw new Error('frontend lowered artifact probe recover call count did not match lowered sources manifest')
    }
    const newCallCountExportName = `tinygo_lowered_${symbolID}_new_call_count`
    const newCallCountExportValue = exportsObject[newCallCountExportName]
    let expectedNewCallCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedNewCallCount += (sourceText.match(/\bnew\s*\(/g) ?? []).length
    }
    const newCallCount =
      typeof newCallCountExportValue === 'function' ? Number(newCallCountExportValue()) : expectedNewCallCount
    if (!Number.isInteger(newCallCount) || newCallCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid new call count for ${newCallCountExportName}`)
    }
    if (typeof newCallCountExportValue === 'function' && newCallCount !== expectedNewCallCount) {
      throw new Error('frontend lowered artifact probe new call count did not match lowered sources manifest')
    }
    const deleteCallCountExportName = `tinygo_lowered_${symbolID}_delete_call_count`
    const deleteCallCountExportValue = exportsObject[deleteCallCountExportName]
    let expectedDeleteCallCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedDeleteCallCount += (sourceText.match(/\bdelete\s*\(/g) ?? []).length
    }
    const deleteCallCount =
      typeof deleteCallCountExportValue === 'function' ? Number(deleteCallCountExportValue()) : expectedDeleteCallCount
    if (!Number.isInteger(deleteCallCount) || deleteCallCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid delete call count for ${deleteCallCountExportName}`)
    }
    if (typeof deleteCallCountExportValue === 'function' && deleteCallCount !== expectedDeleteCallCount) {
      throw new Error('frontend lowered artifact probe delete call count did not match lowered sources manifest')
    }
    const compositeLiteralCountExportName = `tinygo_lowered_${symbolID}_composite_literal_count`
    const compositeLiteralCountExportValue = exportsObject[compositeLiteralCountExportName]
    let expectedCompositeLiteralCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      const normalizedSourceText = sourceText
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/"(?:\\.|[^"\\])*"/g, '""')
        .replace(/`[\s\S]*?`/g, '``')
      expectedCompositeLiteralCount += (
        normalizedSourceText.match(/(?:=|:=|return\s+|,|\()\s*(?:\[\])?(?:[A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)?)\s*\{/g) ?? []
      ).length
      expectedCompositeLiteralCount += (
        normalizedSourceText.match(/(?:=|:=|return\s+|,|\()\s*map\s*\[[^\]]+\]\s*(?:[A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)?)\s*\{/g) ?? []
      ).length
    }
    const compositeLiteralCount =
      typeof compositeLiteralCountExportValue === 'function' ? Number(compositeLiteralCountExportValue()) : expectedCompositeLiteralCount
    if (!Number.isInteger(compositeLiteralCount) || compositeLiteralCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid composite literal count for ${compositeLiteralCountExportName}`)
    }
    if (typeof compositeLiteralCountExportValue === 'function' && compositeLiteralCount !== expectedCompositeLiteralCount) {
      throw new Error('frontend lowered artifact probe composite literal count did not match lowered sources manifest')
    }
    const selectorExpressionCountExportName = `tinygo_lowered_${symbolID}_selector_expression_count`
    const selectorExpressionCountExportValue = exportsObject[selectorExpressionCountExportName]
    let expectedSelectorExpressionCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      const normalizedSourceText = sourceText
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/"(?:\\.|[^"\\])*"/g, '""')
        .replace(/`[\s\S]*?`/g, '``')
      expectedSelectorExpressionCount += (normalizedSourceText.match(/\b[A-Za-z_]\w*\s*\.\s*[A-Za-z_]\w*\b/g) ?? []).length
    }
    const selectorExpressionCount =
      typeof selectorExpressionCountExportValue === 'function' ? Number(selectorExpressionCountExportValue()) : expectedSelectorExpressionCount
    if (!Number.isInteger(selectorExpressionCount) || selectorExpressionCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid selector expression count for ${selectorExpressionCountExportName}`)
    }
    if (typeof selectorExpressionCountExportValue === 'function' && selectorExpressionCount !== expectedSelectorExpressionCount) {
      throw new Error('frontend lowered artifact probe selector expression count did not match lowered sources manifest')
    }
    const selectorNameHashExportName = `tinygo_lowered_${symbolID}_selector_name_hash`
    const selectorNameHashExportValue = exportsObject[selectorNameHashExportName]
    let expectedSelectorNameHash = 0
    let expectedSelectorNameHashPosition = 1
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      const normalizedSourceText = sourceText
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/"(?:\\.|[^"\\])*"/g, '""')
        .replace(/`[\s\S]*?`/g, '``')
      for (const match of normalizedSourceText.matchAll(/\b[A-Za-z_]\w*\s*\.\s*([A-Za-z_]\w*)\b/g)) {
        for (const byte of textEncoder.encode(match[1])) {
          expectedSelectorNameHash = (expectedSelectorNameHash + (byte * expectedSelectorNameHashPosition)) >>> 0
          expectedSelectorNameHashPosition += 1
        }
        expectedSelectorNameHash = (expectedSelectorNameHash + (0x0a * expectedSelectorNameHashPosition)) >>> 0
        expectedSelectorNameHashPosition += 1
      }
    }
    if (typeof selectorNameHashExportValue !== 'function') {
      if (expectedSelectorNameHash !== 0) {
        throw new Error(`frontend lowered artifact probe missing export ${selectorNameHashExportName}`)
      }
    }
    const selectorNameHash = typeof selectorNameHashExportValue === 'function' ? Number(selectorNameHashExportValue()) : 0
    if (!Number.isInteger(selectorNameHash) || selectorNameHash < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid selector name hash for ${selectorNameHashExportName}`)
    }
    if (selectorNameHash !== expectedSelectorNameHash) {
      throw new Error('frontend lowered artifact probe selector name hash did not match lowered sources manifest')
    }
    const indexExpressionCountExportName = `tinygo_lowered_${symbolID}_index_expression_count`
    const indexExpressionCountExportValue = exportsObject[indexExpressionCountExportName]
    let expectedIndexExpressionCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      const normalizedSourceText = sourceText
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/"(?:\\.|[^"\\])*"/g, '""')
        .replace(/`[\s\S]*?`/g, '``')
      expectedIndexExpressionCount += (normalizedSourceText.match(/\b[A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)?\s*\[[^\]\n:]+\]/g) ?? []).length
    }
    const indexExpressionCount =
      typeof indexExpressionCountExportValue === 'function' ? Number(indexExpressionCountExportValue()) : expectedIndexExpressionCount
    if (!Number.isInteger(indexExpressionCount) || indexExpressionCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid index expression count for ${indexExpressionCountExportName}`)
    }
    if (typeof indexExpressionCountExportValue === 'function' && indexExpressionCount !== expectedIndexExpressionCount) {
      throw new Error('frontend lowered artifact probe index expression count did not match lowered sources manifest')
    }
    const sliceExpressionCountExportName = `tinygo_lowered_${symbolID}_slice_expression_count`
    const sliceExpressionCountExportValue = exportsObject[sliceExpressionCountExportName]
    let expectedSliceExpressionCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      const normalizedSourceText = sourceText
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/"(?:\\.|[^"\\])*"/g, '""')
        .replace(/`[\s\S]*?`/g, '``')
      expectedSliceExpressionCount += (normalizedSourceText.match(/\b[A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)?\s*\[[^\]\n]*:[^\]\n]*\]/g) ?? []).length
    }
    const sliceExpressionCount =
      typeof sliceExpressionCountExportValue === 'function' ? Number(sliceExpressionCountExportValue()) : expectedSliceExpressionCount
    if (!Number.isInteger(sliceExpressionCount) || sliceExpressionCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid slice expression count for ${sliceExpressionCountExportName}`)
    }
    if (typeof sliceExpressionCountExportValue === 'function' && sliceExpressionCount !== expectedSliceExpressionCount) {
      throw new Error('frontend lowered artifact probe slice expression count did not match lowered sources manifest')
    }
    const keyValueExpressionCountExportName = `tinygo_lowered_${symbolID}_key_value_expression_count`
    const keyValueExpressionCountExportValue = exportsObject[keyValueExpressionCountExportName]
    let expectedKeyValueExpressionCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      const normalizedSourceText = sourceText
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/"(?:\\.|[^"\\])*"/g, '""')
        .replace(/`[\s\S]*?`/g, '``')
      for (const match of [
        ...normalizedSourceText.matchAll(/(?:=|:=|return\s+|,|\()\s*(?:\[\])?(?:[A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)?)\s*\{([^{}]*)\}/g),
        ...normalizedSourceText.matchAll(/(?:=|:=|return\s+|,|\()\s*map\s*\[[^\]]+\]\s*(?:[A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)?)\s*\{([^{}]*)\}/g),
      ]) {
        expectedKeyValueExpressionCount += (match[1].match(/\b[A-Za-z_]\w*\s*:/g) ?? []).length
      }
    }
    const keyValueExpressionCount =
      typeof keyValueExpressionCountExportValue === 'function' ? Number(keyValueExpressionCountExportValue()) : expectedKeyValueExpressionCount
    if (!Number.isInteger(keyValueExpressionCount) || keyValueExpressionCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid key value expression count for ${keyValueExpressionCountExportName}`)
    }
    if (typeof keyValueExpressionCountExportValue === 'function' && keyValueExpressionCount !== expectedKeyValueExpressionCount) {
      throw new Error('frontend lowered artifact probe key value expression count did not match lowered sources manifest')
    }
    const typeAssertionCountExportName = `tinygo_lowered_${symbolID}_type_assertion_count`
    const typeAssertionCountExportValue = exportsObject[typeAssertionCountExportName]
    let expectedTypeAssertionCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      const normalizedSourceText = sourceText
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/"(?:\\.|[^"\\])*"/g, '""')
        .replace(/`[\s\S]*?`/g, '``')
      expectedTypeAssertionCount += (normalizedSourceText.match(/\.\s*\(\s*[A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)?\s*\)/g) ?? []).length
    }
    const typeAssertionCount =
      typeof typeAssertionCountExportValue === 'function' ? Number(typeAssertionCountExportValue()) : expectedTypeAssertionCount
    if (!Number.isInteger(typeAssertionCount) || typeAssertionCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid type assertion count for ${typeAssertionCountExportName}`)
    }
    if (typeof typeAssertionCountExportValue === 'function' && typeAssertionCount !== expectedTypeAssertionCount) {
      throw new Error('frontend lowered artifact probe type assertion count did not match lowered sources manifest')
    }
    const blankIdentifierCountExportName = `tinygo_lowered_${symbolID}_blank_identifier_count`
    const blankIdentifierCountExportValue = exportsObject[blankIdentifierCountExportName]
    let expectedBlankIdentifierCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      const normalizedSourceText = sourceText
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/"(?:\\.|[^"\\])*"/g, '""')
        .replace(/`[\s\S]*?`/g, '``')
      expectedBlankIdentifierCount += (normalizedSourceText.match(/\b_\b/g) ?? []).length
    }
    const blankIdentifierCount =
      typeof blankIdentifierCountExportValue === 'function' ? Number(blankIdentifierCountExportValue()) : expectedBlankIdentifierCount
    if (!Number.isInteger(blankIdentifierCount) || blankIdentifierCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid blank identifier count for ${blankIdentifierCountExportName}`)
    }
    if (typeof blankIdentifierCountExportValue === 'function' && blankIdentifierCount !== expectedBlankIdentifierCount) {
      throw new Error('frontend lowered artifact probe blank identifier count did not match lowered sources manifest')
    }
    const blankAssignmentTargetCountExportName = `tinygo_lowered_${symbolID}_blank_assignment_target_count`
    const blankAssignmentTargetCountExportValue = exportsObject[blankAssignmentTargetCountExportName]
    let expectedBlankAssignmentTargetCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      const normalizedSourceText = sourceText
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/"(?:\\.|[^"\\])*"/g, '""')
        .replace(/`[\s\S]*?`/g, '``')
      expectedBlankAssignmentTargetCount += (normalizedSourceText.match(/(?:^|[(,;{])\s*_\s*(?::=|=)/gm) ?? []).length
    }
    const blankAssignmentTargetCount =
      typeof blankAssignmentTargetCountExportValue === 'function' ? Number(blankAssignmentTargetCountExportValue()) : expectedBlankAssignmentTargetCount
    if (!Number.isInteger(blankAssignmentTargetCount) || blankAssignmentTargetCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid blank assignment target count for ${blankAssignmentTargetCountExportName}`)
    }
    if (typeof blankAssignmentTargetCountExportValue === 'function' && blankAssignmentTargetCount !== expectedBlankAssignmentTargetCount) {
      throw new Error('frontend lowered artifact probe blank assignment target count did not match lowered sources manifest')
    }
    const unaryExpressionCountExportName = `tinygo_lowered_${symbolID}_unary_expression_count`
    const unaryExpressionCountExportValue = exportsObject[unaryExpressionCountExportName]
    let expectedUnaryExpressionCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      const normalizedSourceText = sourceText
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/"(?:\\.|[^"\\])*"/g, '""')
        .replace(/`[\s\S]*?`/g, '``')
      expectedUnaryExpressionCount +=
        (normalizedSourceText.match(/<-/g) ?? []).length -
        (normalizedSourceText.match(/\b(?!case\b)[A-Za-z_]\w*\s*<-\s*/g) ?? []).length
      expectedUnaryExpressionCount += (
        normalizedSourceText.match(/(?:^|[=(:,{\[]\s*|return\s+|case\s+)(?:-(?!-)|\+(?!\+)|!|\^|\*|&)\s*(?:[A-Za-z_]\w*|\d+|\()/gm) ?? []
      ).length
    }
    const unaryExpressionCount =
      typeof unaryExpressionCountExportValue === 'function' ? Number(unaryExpressionCountExportValue()) : expectedUnaryExpressionCount
    if (!Number.isInteger(unaryExpressionCount) || unaryExpressionCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid unary expression count for ${unaryExpressionCountExportName}`)
    }
    if (typeof unaryExpressionCountExportValue === 'function' && unaryExpressionCount !== expectedUnaryExpressionCount) {
      throw new Error('frontend lowered artifact probe unary expression count did not match lowered sources manifest')
    }
    const binaryExpressionCountExportName = `tinygo_lowered_${symbolID}_binary_expression_count`
    const binaryExpressionCountExportValue = exportsObject[binaryExpressionCountExportName]
    let expectedBinaryExpressionCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      const normalizedSourceText = sourceText
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/"(?:\\.|[^"\\])*"/g, '""')
        .replace(/`[\s\S]*?`/g, '``')
      expectedBinaryExpressionCount += (
        normalizedSourceText.match(/(?:[A-Za-z_]\w*|\d+|\)|\])\s*(?:==|!=|<=|>=|&&|\|\||<<|>>|&\^|\+(?!\+)|-(?!-)|\*|\/|%|&(?!&)|\|(?!\|)|\^(?!\^)|<(?![-=])|>(?![>=]))\s*(?:[A-Za-z_]\w*|\d+|\(|\[|-)/g) ?? []
      ).length
    }
    const binaryExpressionCount =
      typeof binaryExpressionCountExportValue === 'function' ? Number(binaryExpressionCountExportValue()) : expectedBinaryExpressionCount
    if (!Number.isInteger(binaryExpressionCount) || binaryExpressionCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid binary expression count for ${binaryExpressionCountExportName}`)
    }
    if (typeof binaryExpressionCountExportValue === 'function' && binaryExpressionCount !== expectedBinaryExpressionCount) {
      throw new Error('frontend lowered artifact probe binary expression count did not match lowered sources manifest')
    }
    const sendStatementCountExportName = `tinygo_lowered_${symbolID}_send_statement_count`
    const sendStatementCountExportValue = exportsObject[sendStatementCountExportName]
    let expectedSendStatementCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedSendStatementCount += (sourceText.match(/\b(?!case\b)[A-Za-z_]\w*\s*<-\s*/g) ?? []).length
    }
    const sendStatementCount = typeof sendStatementCountExportValue === 'function' ? Number(sendStatementCountExportValue()) : expectedSendStatementCount
    if (!Number.isInteger(sendStatementCount) || sendStatementCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid send statement count for ${sendStatementCountExportName}`)
    }
    if (typeof sendStatementCountExportValue === 'function' && sendStatementCount !== expectedSendStatementCount) {
      throw new Error('frontend lowered artifact probe send statement count did not match lowered sources manifest')
    }
    const receiveExpressionCountExportName = `tinygo_lowered_${symbolID}_receive_expression_count`
    const receiveExpressionCountExportValue = exportsObject[receiveExpressionCountExportName]
    let expectedReceiveExpressionCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedReceiveExpressionCount += (sourceText.match(/<-/g) ?? []).length
      expectedReceiveExpressionCount -= (sourceText.match(/\b(?!case\b)[A-Za-z_]\w*\s*<-\s*/g) ?? []).length
    }
    const receiveExpressionCount = typeof receiveExpressionCountExportValue === 'function' ? Number(receiveExpressionCountExportValue()) : expectedReceiveExpressionCount
    if (!Number.isInteger(receiveExpressionCount) || receiveExpressionCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid receive expression count for ${receiveExpressionCountExportName}`)
    }
    if (typeof receiveExpressionCountExportValue === 'function' && receiveExpressionCount !== expectedReceiveExpressionCount) {
      throw new Error('frontend lowered artifact probe receive expression count did not match lowered sources manifest')
    }
    const defineStatementCountExportName = `tinygo_lowered_${symbolID}_define_statement_count`
    const defineStatementCountExportValue = exportsObject[defineStatementCountExportName]
    let expectedDefineStatementCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedDefineStatementCount += (sourceText.match(/:=/g) ?? []).length
    }
    const defineStatementCount = typeof defineStatementCountExportValue === 'function' ? Number(defineStatementCountExportValue()) : expectedDefineStatementCount
    if (!Number.isInteger(defineStatementCount) || defineStatementCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid define statement count for ${defineStatementCountExportName}`)
    }
    if (typeof defineStatementCountExportValue === 'function' && defineStatementCount !== expectedDefineStatementCount) {
      throw new Error('frontend lowered artifact probe define statement count did not match lowered sources manifest')
    }
    const assignStatementCountExportName = `tinygo_lowered_${symbolID}_assign_statement_count`
    const assignStatementCountExportValue = exportsObject[assignStatementCountExportName]
    let expectedAssignStatementCount = expectedDefineStatementCount
    for (const sourceFile of unit.sourceFiles) {
      const sourceText = sanitizedSourceTextByFile[sourceFile] ?? ''
      if (sourceText === '') {
        continue
      }
      expectedAssignStatementCount += (sourceText.match(/(?<!\b(?:var|const)\s)\b[A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*\s*=(?!=)\s*/g) ?? []).length
    }
    const assignStatementCount = typeof assignStatementCountExportValue === 'function' ? Number(assignStatementCountExportValue()) : expectedAssignStatementCount
    if (!Number.isInteger(assignStatementCount) || assignStatementCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid assign statement count for ${assignStatementCountExportName}`)
    }
    if (typeof assignStatementCountExportValue === 'function' && assignStatementCount !== expectedAssignStatementCount) {
      throw new Error('frontend lowered artifact probe assign statement count did not match lowered sources manifest')
    }
    const incStatementCountExportName = `tinygo_lowered_${symbolID}_inc_statement_count`
    const incStatementCountExportValue = exportsObject[incStatementCountExportName]
    let expectedIncStatementCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedIncStatementCount += (sourceText.match(/\+\+/g) ?? []).length
    }
    const incStatementCount = typeof incStatementCountExportValue === 'function' ? Number(incStatementCountExportValue()) : expectedIncStatementCount
    if (!Number.isInteger(incStatementCount) || incStatementCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid increment statement count for ${incStatementCountExportName}`)
    }
    if (typeof incStatementCountExportValue === 'function' && incStatementCount !== expectedIncStatementCount) {
      throw new Error('frontend lowered artifact probe increment statement count did not match lowered sources manifest')
    }
    const decStatementCountExportName = `tinygo_lowered_${symbolID}_dec_statement_count`
    const decStatementCountExportValue = exportsObject[decStatementCountExportName]
    let expectedDecStatementCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedDecStatementCount += (sourceText.match(/--/g) ?? []).length
    }
    const decStatementCount = typeof decStatementCountExportValue === 'function' ? Number(decStatementCountExportValue()) : expectedDecStatementCount
    if (!Number.isInteger(decStatementCount) || decStatementCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid decrement statement count for ${decStatementCountExportName}`)
    }
    if (typeof decStatementCountExportValue === 'function' && decStatementCount !== expectedDecStatementCount) {
      throw new Error('frontend lowered artifact probe decrement statement count did not match lowered sources manifest')
    }
    const returnStatementCountExportName = `tinygo_lowered_${symbolID}_return_statement_count`
    const returnStatementCountExportValue = exportsObject[returnStatementCountExportName]
    let expectedReturnStatementCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText = sanitizedSourceTextByFile[sourceFile] ?? ''
      if (sourceText === '') {
        continue
      }
      expectedReturnStatementCount += (sourceText.match(/\breturn\b/g) ?? []).length
    }
    const returnStatementCount = typeof returnStatementCountExportValue === 'function' ? Number(returnStatementCountExportValue()) : expectedReturnStatementCount
    if (!Number.isInteger(returnStatementCount) || returnStatementCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid return statement count for ${returnStatementCountExportName}`)
    }
    if (typeof returnStatementCountExportValue === 'function' && returnStatementCount !== expectedReturnStatementCount) {
      throw new Error('frontend lowered artifact probe return statement count did not match lowered sources manifest')
    }
    const goStatementCountExportName = `tinygo_lowered_${symbolID}_go_statement_count`
    const goStatementCountExportValue = exportsObject[goStatementCountExportName]
    let expectedGoStatementCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      for (const match of sourceText.matchAll(/^\s*func(?:\s*\([^)]*\))?\s+[A-Za-z_]\w*\s*\([^)]*\)\s*(?:[^{\n]+)?\{([^}]*)\}/gm)) {
        expectedGoStatementCount += (match[1].match(/\bgo\s+[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?\s*\(/g) ?? []).length
      }
    }
    const goStatementCount = typeof goStatementCountExportValue === 'function' ? Number(goStatementCountExportValue()) : expectedGoStatementCount
    if (!Number.isInteger(goStatementCount) || goStatementCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid go statement count for ${goStatementCountExportName}`)
    }
    if (typeof goStatementCountExportValue === 'function' && goStatementCount !== expectedGoStatementCount) {
      throw new Error('frontend lowered artifact probe go statement count did not match lowered sources manifest')
    }
    const deferStatementCountExportName = `tinygo_lowered_${symbolID}_defer_statement_count`
    const deferStatementCountExportValue = exportsObject[deferStatementCountExportName]
    let expectedDeferStatementCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      for (const match of sourceText.matchAll(/^\s*func(?:\s*\([^)]*\))?\s+[A-Za-z_]\w*\s*\([^)]*\)\s*(?:[^{\n]+)?\{([^}]*)\}/gm)) {
        expectedDeferStatementCount += (match[1].match(/\bdefer\s+[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?\s*\(/g) ?? []).length
      }
    }
    const deferStatementCount = typeof deferStatementCountExportValue === 'function' ? Number(deferStatementCountExportValue()) : expectedDeferStatementCount
    if (!Number.isInteger(deferStatementCount) || deferStatementCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid defer statement count for ${deferStatementCountExportName}`)
    }
    if (typeof deferStatementCountExportValue === 'function' && deferStatementCount !== expectedDeferStatementCount) {
      throw new Error('frontend lowered artifact probe defer statement count did not match lowered sources manifest')
    }
    const ifStatementCountExportName = `tinygo_lowered_${symbolID}_if_statement_count`
    const ifStatementCountExportValue = exportsObject[ifStatementCountExportName]
    let expectedIfStatementCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      for (const match of sourceText.matchAll(/^\s*func(?:\s*\([^)]*\))?\s+[A-Za-z_]\w*\s*\([^)]*\)\s*(?:[^{\n]+)?\{([^}]*)\}/gm)) {
        expectedIfStatementCount += (match[1].match(/\bif\b/g) ?? []).length
      }
    }
    const ifStatementCount = typeof ifStatementCountExportValue === 'function' ? Number(ifStatementCountExportValue()) : expectedIfStatementCount
    if (!Number.isInteger(ifStatementCount) || ifStatementCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid if statement count for ${ifStatementCountExportName}`)
    }
    if (typeof ifStatementCountExportValue === 'function' && ifStatementCount !== expectedIfStatementCount) {
      throw new Error('frontend lowered artifact probe if statement count did not match lowered sources manifest')
    }
    const rangeStatementCountExportName = `tinygo_lowered_${symbolID}_range_statement_count`
    const rangeStatementCountExportValue = exportsObject[rangeStatementCountExportName]
    let expectedRangeStatementCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      for (const match of sourceText.matchAll(/^\s*func(?:\s*\([^)]*\))?\s+[A-Za-z_]\w*\s*\([^)]*\)\s*(?:[^{\n]+)?\{([^}]*)\}/gm)) {
        expectedRangeStatementCount += (match[1].match(/\bfor\b[^{\n]*\brange\b/g) ?? []).length
      }
    }
    const rangeStatementCount = typeof rangeStatementCountExportValue === 'function' ? Number(rangeStatementCountExportValue()) : expectedRangeStatementCount
    if (!Number.isInteger(rangeStatementCount) || rangeStatementCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid range statement count for ${rangeStatementCountExportName}`)
    }
    if (typeof rangeStatementCountExportValue === 'function' && rangeStatementCount !== expectedRangeStatementCount) {
      throw new Error('frontend lowered artifact probe range statement count did not match lowered sources manifest')
    }
    const switchStatementCountExportName = `tinygo_lowered_${symbolID}_switch_statement_count`
    const switchStatementCountExportValue = exportsObject[switchStatementCountExportName]
    let expectedSwitchStatementCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      for (const match of sourceText.matchAll(/^\s*func(?:\s*\([^)]*\))?\s+[A-Za-z_]\w*\s*\([^)]*\)\s*(?:[^{\n]+)?\{([^}]*)\}/gm)) {
        expectedSwitchStatementCount += (match[1].match(/\bswitch\b/g) ?? []).length
      }
    }
    const switchStatementCount = typeof switchStatementCountExportValue === 'function' ? Number(switchStatementCountExportValue()) : expectedSwitchStatementCount
    if (!Number.isInteger(switchStatementCount) || switchStatementCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid switch statement count for ${switchStatementCountExportName}`)
    }
    if (typeof switchStatementCountExportValue === 'function' && switchStatementCount !== expectedSwitchStatementCount) {
      throw new Error('frontend lowered artifact probe switch statement count did not match lowered sources manifest')
    }
    const typeSwitchStatementCountExportName = `tinygo_lowered_${symbolID}_type_switch_statement_count`
    const typeSwitchStatementCountExportValue = exportsObject[typeSwitchStatementCountExportName]
    let expectedTypeSwitchStatementCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedTypeSwitchStatementCount += (sourceText.match(/\bswitch\s+[^{}]*\.\(\s*type\s*\)/g) ?? []).length
    }
    const typeSwitchStatementCount = typeof typeSwitchStatementCountExportValue === 'function' ? Number(typeSwitchStatementCountExportValue()) : expectedTypeSwitchStatementCount
    if (!Number.isInteger(typeSwitchStatementCount) || typeSwitchStatementCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid type switch statement count for ${typeSwitchStatementCountExportName}`)
    }
    if (typeof typeSwitchStatementCountExportValue === 'function' && typeSwitchStatementCount !== expectedTypeSwitchStatementCount) {
      throw new Error('frontend lowered artifact probe type switch statement count did not match lowered sources manifest')
    }
    const typeSwitchCaseClauseCountExportName = `tinygo_lowered_${symbolID}_type_switch_case_clause_count`
    const typeSwitchCaseClauseCountExportValue = exportsObject[typeSwitchCaseClauseCountExportName]
    let expectedTypeSwitchCaseClauseCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      for (const match of sourceText.matchAll(/\bswitch\s+[^{}]*\.\(\s*type\s*\)\s*\{([^}]*)\}/gm)) {
        expectedTypeSwitchCaseClauseCount += (match[1].match(/\bcase\b/g) ?? []).length
        expectedTypeSwitchCaseClauseCount += (match[1].match(/\bdefault\b/g) ?? []).length
      }
    }
    const typeSwitchCaseClauseCount =
      typeof typeSwitchCaseClauseCountExportValue === 'function' ? Number(typeSwitchCaseClauseCountExportValue()) : expectedTypeSwitchCaseClauseCount
    if (!Number.isInteger(typeSwitchCaseClauseCount) || typeSwitchCaseClauseCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid type switch case clause count for ${typeSwitchCaseClauseCountExportName}`)
    }
    if (typeof typeSwitchCaseClauseCountExportValue === 'function' && typeSwitchCaseClauseCount !== expectedTypeSwitchCaseClauseCount) {
      throw new Error('frontend lowered artifact probe type switch case clause count did not match lowered sources manifest')
    }
    const typeSwitchGuardNameHashExportName = `tinygo_lowered_${symbolID}_type_switch_guard_name_hash`
    const typeSwitchGuardNameHashExportValue = exportsObject[typeSwitchGuardNameHashExportName]
    let expectedTypeSwitchGuardNameHash = 0
    let expectedTypeSwitchGuardNameHashPosition = 1
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      for (const match of sourceText.matchAll(/\bswitch\s+([A-Za-z_]\w*)\s*:=\s*[^{}]*\.\(\s*type\s*\)/g)) {
        for (const byte of textEncoder.encode(match[1])) {
          expectedTypeSwitchGuardNameHash = (expectedTypeSwitchGuardNameHash + (byte * expectedTypeSwitchGuardNameHashPosition)) >>> 0
          expectedTypeSwitchGuardNameHashPosition += 1
        }
        expectedTypeSwitchGuardNameHash = (expectedTypeSwitchGuardNameHash + (0x0a * expectedTypeSwitchGuardNameHashPosition)) >>> 0
        expectedTypeSwitchGuardNameHashPosition += 1
      }
    }
    const typeSwitchGuardNameHash =
      typeof typeSwitchGuardNameHashExportValue === 'function' ? Number(typeSwitchGuardNameHashExportValue()) : expectedTypeSwitchGuardNameHash
    if (!Number.isInteger(typeSwitchGuardNameHash) || typeSwitchGuardNameHash < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid type switch guard name hash for ${typeSwitchGuardNameHashExportName}`)
    }
    if (typeof typeSwitchGuardNameHashExportValue === 'function' && typeSwitchGuardNameHash !== expectedTypeSwitchGuardNameHash) {
      throw new Error('frontend lowered artifact probe type switch guard name hash did not match lowered sources manifest')
    }
    const typeSwitchCaseTypeHashExportName = `tinygo_lowered_${symbolID}_type_switch_case_type_hash`
    const typeSwitchCaseTypeHashExportValue = exportsObject[typeSwitchCaseTypeHashExportName]
    let expectedTypeSwitchCaseTypeHash = 0
    let expectedTypeSwitchCaseTypeHashPosition = 1
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      for (const match of sourceText.matchAll(/\bswitch\s+[^{}]*\.\(\s*type\s*\)\s*\{([^}]*)\}/gm)) {
        for (const caseMatch of match[1].matchAll(/\bcase\s+([^:]+):/g)) {
          for (const typeExpression of caseMatch[1].split(',').map((part) => part.trim()).filter((part) => part !== '')) {
            for (const byte of textEncoder.encode(typeExpression)) {
              expectedTypeSwitchCaseTypeHash = (expectedTypeSwitchCaseTypeHash + (byte * expectedTypeSwitchCaseTypeHashPosition)) >>> 0
              expectedTypeSwitchCaseTypeHashPosition += 1
            }
            expectedTypeSwitchCaseTypeHash = (expectedTypeSwitchCaseTypeHash + (0x0a * expectedTypeSwitchCaseTypeHashPosition)) >>> 0
            expectedTypeSwitchCaseTypeHashPosition += 1
          }
        }
      }
    }
    const typeSwitchCaseTypeHash =
      typeof typeSwitchCaseTypeHashExportValue === 'function' ? Number(typeSwitchCaseTypeHashExportValue()) : expectedTypeSwitchCaseTypeHash
    if (!Number.isInteger(typeSwitchCaseTypeHash) || typeSwitchCaseTypeHash < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid type switch case type hash for ${typeSwitchCaseTypeHashExportName}`)
    }
    if (typeof typeSwitchCaseTypeHashExportValue === 'function' && typeSwitchCaseTypeHash !== expectedTypeSwitchCaseTypeHash) {
      throw new Error('frontend lowered artifact probe type switch case type hash did not match lowered sources manifest')
    }
    const selectStatementCountExportName = `tinygo_lowered_${symbolID}_select_statement_count`
    const selectStatementCountExportValue = exportsObject[selectStatementCountExportName]
    let expectedSelectStatementCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      for (const match of sourceText.matchAll(/^\s*func(?:\s*\([^)]*\))?\s+[A-Za-z_]\w*\s*\([^)]*\)\s*(?:[^{\n]+)?\{([^}]*)\}/gm)) {
        expectedSelectStatementCount += (match[1].match(/\bselect\b/g) ?? []).length
      }
    }
    const selectStatementCount = typeof selectStatementCountExportValue === 'function' ? Number(selectStatementCountExportValue()) : expectedSelectStatementCount
    if (!Number.isInteger(selectStatementCount) || selectStatementCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid select statement count for ${selectStatementCountExportName}`)
    }
    if (typeof selectStatementCountExportValue === 'function' && selectStatementCount !== expectedSelectStatementCount) {
      throw new Error('frontend lowered artifact probe select statement count did not match lowered sources manifest')
    }
    const switchCaseClauseCountExportName = `tinygo_lowered_${symbolID}_switch_case_clause_count`
    const switchCaseClauseCountExportValue = exportsObject[switchCaseClauseCountExportName]
    let expectedSwitchCaseClauseCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      for (const match of sourceText.matchAll(/\bswitch\b[^{]*\{([^}]*)\}/gm)) {
        expectedSwitchCaseClauseCount += (match[1].match(/\bcase\b/g) ?? []).length
        expectedSwitchCaseClauseCount += (match[1].match(/\bdefault\b/g) ?? []).length
      }
    }
    const switchCaseClauseCount = typeof switchCaseClauseCountExportValue === 'function' ? Number(switchCaseClauseCountExportValue()) : expectedSwitchCaseClauseCount
    if (!Number.isInteger(switchCaseClauseCount) || switchCaseClauseCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid switch case clause count for ${switchCaseClauseCountExportName}`)
    }
    if (typeof switchCaseClauseCountExportValue === 'function' && switchCaseClauseCount !== expectedSwitchCaseClauseCount) {
      throw new Error('frontend lowered artifact probe switch case clause count did not match lowered sources manifest')
    }
    const selectCommClauseCountExportName = `tinygo_lowered_${symbolID}_select_comm_clause_count`
    const selectCommClauseCountExportValue = exportsObject[selectCommClauseCountExportName]
    let expectedSelectCommClauseCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      for (const match of sourceText.matchAll(/\bselect\b[^{]*\{([^}]*)\}/gm)) {
        expectedSelectCommClauseCount += (match[1].match(/\bcase\b/g) ?? []).length
        expectedSelectCommClauseCount += (match[1].match(/\bdefault\b/g) ?? []).length
      }
    }
    const selectCommClauseCount = typeof selectCommClauseCountExportValue === 'function' ? Number(selectCommClauseCountExportValue()) : expectedSelectCommClauseCount
    if (!Number.isInteger(selectCommClauseCount) || selectCommClauseCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid select comm clause count for ${selectCommClauseCountExportName}`)
    }
    if (typeof selectCommClauseCountExportValue === 'function' && selectCommClauseCount !== expectedSelectCommClauseCount) {
      throw new Error('frontend lowered artifact probe select comm clause count did not match lowered sources manifest')
    }
    const forStatementCountExportName = `tinygo_lowered_${symbolID}_for_statement_count`
    const forStatementCountExportValue = exportsObject[forStatementCountExportName]
    let expectedForStatementCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      for (const match of sourceText.matchAll(/^\s*func(?:\s*\([^)]*\))?\s+[A-Za-z_]\w*\s*\([^)]*\)\s*(?:[^{\n]+)?\{([^}]*)\}/gm)) {
        expectedForStatementCount += (match[1].match(/\bfor\b/g) ?? []).length
        expectedForStatementCount -= (match[1].match(/\bfor\b[^{\n]*\brange\b/g) ?? []).length
      }
    }
    const forStatementCount = typeof forStatementCountExportValue === 'function' ? Number(forStatementCountExportValue()) : expectedForStatementCount
    if (!Number.isInteger(forStatementCount) || forStatementCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid for statement count for ${forStatementCountExportName}`)
    }
    if (typeof forStatementCountExportValue === 'function' && forStatementCount !== expectedForStatementCount) {
      throw new Error('frontend lowered artifact probe for statement count did not match lowered sources manifest')
    }
    const breakStatementCountExportName = `tinygo_lowered_${symbolID}_break_statement_count`
    const breakStatementCountExportValue = exportsObject[breakStatementCountExportName]
    let expectedBreakStatementCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      for (const match of sourceText.matchAll(/^\s*func(?:\s*\([^)]*\))?\s+[A-Za-z_]\w*\s*\([^)]*\)\s*(?:[^{\n]+)?\{([^}]*)\}/gm)) {
        expectedBreakStatementCount += (match[1].match(/\bbreak\b/g) ?? []).length
      }
    }
    const breakStatementCount = typeof breakStatementCountExportValue === 'function' ? Number(breakStatementCountExportValue()) : expectedBreakStatementCount
    if (!Number.isInteger(breakStatementCount) || breakStatementCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid break statement count for ${breakStatementCountExportName}`)
    }
    if (typeof breakStatementCountExportValue === 'function' && breakStatementCount !== expectedBreakStatementCount) {
      throw new Error('frontend lowered artifact probe break statement count did not match lowered sources manifest')
    }
    const breakLabelNameHashExportName = `tinygo_lowered_${symbolID}_break_label_name_hash`
    const breakLabelNameHashExportValue = exportsObject[breakLabelNameHashExportName]
    let expectedBreakLabelNameHash = 0
    let expectedBreakLabelNameHashPosition = 1
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      for (const match of sourceText.matchAll(/\bbreak\s+([A-Za-z_]\w*)/g)) {
        for (const byte of textEncoder.encode(match[1])) {
          expectedBreakLabelNameHash = (expectedBreakLabelNameHash + (byte * expectedBreakLabelNameHashPosition)) >>> 0
          expectedBreakLabelNameHashPosition += 1
        }
        expectedBreakLabelNameHash = (expectedBreakLabelNameHash + (0x0a * expectedBreakLabelNameHashPosition)) >>> 0
        expectedBreakLabelNameHashPosition += 1
      }
    }
    if (typeof breakLabelNameHashExportValue !== 'function') {
      if (expectedBreakLabelNameHash !== 0) {
        throw new Error(`frontend lowered artifact probe missing export ${breakLabelNameHashExportName}`)
      }
    }
    const breakLabelNameHash = typeof breakLabelNameHashExportValue === 'function' ? Number(breakLabelNameHashExportValue()) : 0
    if (!Number.isInteger(breakLabelNameHash) || breakLabelNameHash < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid break label name hash for ${breakLabelNameHashExportName}`)
    }
    if (breakLabelNameHash !== expectedBreakLabelNameHash) {
      throw new Error('frontend lowered artifact probe break label name hash did not match lowered sources manifest')
    }
    const continueStatementCountExportName = `tinygo_lowered_${symbolID}_continue_statement_count`
    const continueStatementCountExportValue = exportsObject[continueStatementCountExportName]
    let expectedContinueStatementCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      for (const match of sourceText.matchAll(/^\s*func(?:\s*\([^)]*\))?\s+[A-Za-z_]\w*\s*\([^)]*\)\s*(?:[^{\n]+)?\{([^}]*)\}/gm)) {
        expectedContinueStatementCount += (match[1].match(/\bcontinue\b/g) ?? []).length
      }
    }
    const continueStatementCount = typeof continueStatementCountExportValue === 'function' ? Number(continueStatementCountExportValue()) : expectedContinueStatementCount
    if (!Number.isInteger(continueStatementCount) || continueStatementCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid continue statement count for ${continueStatementCountExportName}`)
    }
    if (typeof continueStatementCountExportValue === 'function' && continueStatementCount !== expectedContinueStatementCount) {
      throw new Error('frontend lowered artifact probe continue statement count did not match lowered sources manifest')
    }
    const continueLabelNameHashExportName = `tinygo_lowered_${symbolID}_continue_label_name_hash`
    const continueLabelNameHashExportValue = exportsObject[continueLabelNameHashExportName]
    let expectedContinueLabelNameHash = 0
    let expectedContinueLabelNameHashPosition = 1
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      for (const match of sourceText.matchAll(/\bcontinue\s+([A-Za-z_]\w*)/g)) {
        for (const byte of textEncoder.encode(match[1])) {
          expectedContinueLabelNameHash = (expectedContinueLabelNameHash + (byte * expectedContinueLabelNameHashPosition)) >>> 0
          expectedContinueLabelNameHashPosition += 1
        }
        expectedContinueLabelNameHash = (expectedContinueLabelNameHash + (0x0a * expectedContinueLabelNameHashPosition)) >>> 0
        expectedContinueLabelNameHashPosition += 1
      }
    }
    if (typeof continueLabelNameHashExportValue !== 'function') {
      if (expectedContinueLabelNameHash !== 0) {
        throw new Error(`frontend lowered artifact probe missing export ${continueLabelNameHashExportName}`)
      }
    }
    const continueLabelNameHash = typeof continueLabelNameHashExportValue === 'function' ? Number(continueLabelNameHashExportValue()) : 0
    if (!Number.isInteger(continueLabelNameHash) || continueLabelNameHash < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid continue label name hash for ${continueLabelNameHashExportName}`)
    }
    if (continueLabelNameHash !== expectedContinueLabelNameHash) {
      throw new Error('frontend lowered artifact probe continue label name hash did not match lowered sources manifest')
    }
    const labeledStatementCountExportName = `tinygo_lowered_${symbolID}_labeled_statement_count`
    const labeledStatementCountExportValue = exportsObject[labeledStatementCountExportName]
    let expectedLabeledStatementCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedLabeledStatementCount += (sourceText.match(/^\s*(?!default:)[A-Za-z_]\w*:\s*$/gm) ?? []).length
    }
    const labeledStatementCount = typeof labeledStatementCountExportValue === 'function' ? Number(labeledStatementCountExportValue()) : expectedLabeledStatementCount
    if (!Number.isInteger(labeledStatementCount) || labeledStatementCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid labeled statement count for ${labeledStatementCountExportName}`)
    }
    if (typeof labeledStatementCountExportValue === 'function' && labeledStatementCount !== expectedLabeledStatementCount) {
      throw new Error('frontend lowered artifact probe labeled statement count did not match lowered sources manifest')
    }
    const labelNameHashExportName = `tinygo_lowered_${symbolID}_label_name_hash`
    const labelNameHashExportValue = exportsObject[labelNameHashExportName]
    let expectedLabelNameHash = 0
    let expectedLabelNameHashPosition = 1
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      for (const match of sourceText.matchAll(/^\s*(?!default:)([A-Za-z_]\w*):\s*$/gm)) {
        for (const byte of textEncoder.encode(match[1])) {
          expectedLabelNameHash = (expectedLabelNameHash + (byte * expectedLabelNameHashPosition)) >>> 0
          expectedLabelNameHashPosition += 1
        }
        expectedLabelNameHash = (expectedLabelNameHash + (0x0a * expectedLabelNameHashPosition)) >>> 0
        expectedLabelNameHashPosition += 1
      }
    }
    if (typeof labelNameHashExportValue !== 'function') {
      if (expectedLabelNameHash !== 0) {
        throw new Error(`frontend lowered artifact probe missing export ${labelNameHashExportName}`)
      }
    }
    const labelNameHash = typeof labelNameHashExportValue === 'function' ? Number(labelNameHashExportValue()) : 0
    if (!Number.isInteger(labelNameHash) || labelNameHash < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid label name hash for ${labelNameHashExportName}`)
    }
    if (labelNameHash !== expectedLabelNameHash) {
      throw new Error('frontend lowered artifact probe label name hash did not match lowered sources manifest')
    }
    const gotoStatementCountExportName = `tinygo_lowered_${symbolID}_goto_statement_count`
    const gotoStatementCountExportValue = exportsObject[gotoStatementCountExportName]
    let expectedGotoStatementCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedGotoStatementCount += (sourceText.match(/\bgoto\s+[A-Za-z_]\w*/g) ?? []).length
    }
    const gotoStatementCount = typeof gotoStatementCountExportValue === 'function' ? Number(gotoStatementCountExportValue()) : expectedGotoStatementCount
    if (!Number.isInteger(gotoStatementCount) || gotoStatementCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid goto statement count for ${gotoStatementCountExportName}`)
    }
    if (typeof gotoStatementCountExportValue === 'function' && gotoStatementCount !== expectedGotoStatementCount) {
      throw new Error('frontend lowered artifact probe goto statement count did not match lowered sources manifest')
    }
    const gotoLabelNameHashExportName = `tinygo_lowered_${symbolID}_goto_label_name_hash`
    const gotoLabelNameHashExportValue = exportsObject[gotoLabelNameHashExportName]
    let expectedGotoLabelNameHash = 0
    let expectedGotoLabelNameHashPosition = 1
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      for (const match of sourceText.matchAll(/\bgoto\s+([A-Za-z_]\w*)/g)) {
        for (const byte of textEncoder.encode(match[1])) {
          expectedGotoLabelNameHash = (expectedGotoLabelNameHash + (byte * expectedGotoLabelNameHashPosition)) >>> 0
          expectedGotoLabelNameHashPosition += 1
        }
        expectedGotoLabelNameHash = (expectedGotoLabelNameHash + (0x0a * expectedGotoLabelNameHashPosition)) >>> 0
        expectedGotoLabelNameHashPosition += 1
      }
    }
    if (typeof gotoLabelNameHashExportValue !== 'function') {
      if (expectedGotoLabelNameHash !== 0) {
        throw new Error(`frontend lowered artifact probe missing export ${gotoLabelNameHashExportName}`)
      }
    }
    const gotoLabelNameHash = typeof gotoLabelNameHashExportValue === 'function' ? Number(gotoLabelNameHashExportValue()) : 0
    if (!Number.isInteger(gotoLabelNameHash) || gotoLabelNameHash < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid goto label name hash for ${gotoLabelNameHashExportName}`)
    }
    if (gotoLabelNameHash !== expectedGotoLabelNameHash) {
      throw new Error('frontend lowered artifact probe goto label name hash did not match lowered sources manifest')
    }
    const fallthroughStatementCountExportName = `tinygo_lowered_${symbolID}_fallthrough_statement_count`
    const fallthroughStatementCountExportValue = exportsObject[fallthroughStatementCountExportName]
    let expectedFallthroughStatementCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedFallthroughStatementCount += (sourceText.match(/\bfallthrough\b/g) ?? []).length
    }
    const fallthroughStatementCount = typeof fallthroughStatementCountExportValue === 'function' ? Number(fallthroughStatementCountExportValue()) : expectedFallthroughStatementCount
    if (!Number.isInteger(fallthroughStatementCount) || fallthroughStatementCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid fallthrough statement count for ${fallthroughStatementCountExportName}`)
    }
    if (typeof fallthroughStatementCountExportValue === 'function' && fallthroughStatementCount !== expectedFallthroughStatementCount) {
      throw new Error('frontend lowered artifact probe fallthrough statement count did not match lowered sources manifest')
    }
    if (typeof methodCountExportValue !== 'function') {
      throw new Error(`frontend lowered artifact probe missing export ${methodCountExportName}`)
    }
    const methodCount = Number(methodCountExportValue())
    if (!Number.isInteger(methodCount) || methodCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid method count for ${methodCountExportName}`)
    }
    let expectedMethodCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedMethodCount += (sourceText.match(/^\s*func\s*\([^)]*\)\s*[A-Za-z_]\w*\s*\(/gm) ?? []).length
    }
    if (methodCount !== expectedMethodCount) {
      throw new Error('frontend lowered artifact probe method count did not match lowered sources manifest')
    }
    const methodNameHashExportName = `tinygo_lowered_${symbolID}_method_name_hash`
    const methodNameHashExportValue = exportsObject[methodNameHashExportName]
    let expectedMethodNameHash = 0
    let expectedMethodNameHashPosition = 1
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      for (const match of sourceText.matchAll(/^\s*func\s*\([^)]*\)\s+([A-Za-z_]\w*)(?:\s*\[[^\]]+\])?\s*\(/gm)) {
        for (const byte of textEncoder.encode(match[1])) {
          expectedMethodNameHash = (expectedMethodNameHash + (byte * expectedMethodNameHashPosition)) >>> 0
          expectedMethodNameHashPosition += 1
        }
        expectedMethodNameHash = (expectedMethodNameHash + (0x0a * expectedMethodNameHashPosition)) >>> 0
        expectedMethodNameHashPosition += 1
      }
    }
    const methodNameHash =
      typeof methodNameHashExportValue === 'function' ? Number(methodNameHashExportValue()) : expectedMethodNameHash
    if (!Number.isInteger(methodNameHash) || methodNameHash < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid method name hash for ${methodNameHashExportName}`)
    }
    if (typeof methodNameHashExportValue === 'function' && methodNameHash !== expectedMethodNameHash) {
      throw new Error('frontend lowered artifact probe method name hash did not match lowered sources manifest')
    }
    const methodSignatureHashExportName = `tinygo_lowered_${symbolID}_method_signature_hash`
    const methodSignatureHashExportValue = exportsObject[methodSignatureHashExportName]
    let expectedMethodSignatureHash = 0
    let expectedMethodSignatureHashPosition = 1
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      for (const match of sourceText.matchAll(/^\s*func\s*\([^)]*\)\s+[A-Za-z_]\w*(?:\s*\[[^\]]+\])?\s*(?:\([^)]*\)(?:\s*\([^)]*\)|\s+[^{\n]+)?)\s*\{/gm)) {
        for (const byte of textEncoder.encode(match[0].replace(/\s*\{$/, '').trim())) {
          expectedMethodSignatureHash = (expectedMethodSignatureHash + (byte * expectedMethodSignatureHashPosition)) >>> 0
          expectedMethodSignatureHashPosition += 1
        }
        expectedMethodSignatureHash = (expectedMethodSignatureHash + (0x0a * expectedMethodSignatureHashPosition)) >>> 0
        expectedMethodSignatureHashPosition += 1
      }
    }
    const methodSignatureHash =
      typeof methodSignatureHashExportValue === 'function' ? Number(methodSignatureHashExportValue()) : expectedMethodSignatureHash
    if (!Number.isInteger(methodSignatureHash) || methodSignatureHash < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid method signature hash for ${methodSignatureHashExportName}`)
    }
    if (typeof methodSignatureHashExportValue === 'function' && methodSignatureHash !== expectedMethodSignatureHash) {
      throw new Error('frontend lowered artifact probe method signature hash did not match lowered sources manifest')
    }
    const exportedMethodNameHashExportName = `tinygo_lowered_${symbolID}_exported_method_name_hash`
    const exportedMethodNameHashExportValue = exportsObject[exportedMethodNameHashExportName]
    let expectedExportedMethodNameHash = 0
    let expectedExportedMethodNameHashPosition = 1
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      for (const match of sourceText.matchAll(/^\s*func\s*\([^)]*\)\s+([A-Z]\w*)(?:\s*\[[^\]]+\])?\s*\(/gm)) {
        for (const byte of textEncoder.encode(match[1])) {
          expectedExportedMethodNameHash = (expectedExportedMethodNameHash + (byte * expectedExportedMethodNameHashPosition)) >>> 0
          expectedExportedMethodNameHashPosition += 1
        }
        expectedExportedMethodNameHash = (expectedExportedMethodNameHash + (0x0a * expectedExportedMethodNameHashPosition)) >>> 0
        expectedExportedMethodNameHashPosition += 1
      }
    }
    const exportedMethodNameHash =
      typeof exportedMethodNameHashExportValue === 'function' ? Number(exportedMethodNameHashExportValue()) : expectedExportedMethodNameHash
    if (!Number.isInteger(exportedMethodNameHash) || exportedMethodNameHash < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid exported method name hash for ${exportedMethodNameHashExportName}`)
    }
    if (typeof exportedMethodNameHashExportValue === 'function' && exportedMethodNameHash !== expectedExportedMethodNameHash) {
      throw new Error('frontend lowered artifact probe exported method name hash did not match lowered sources manifest')
    }
    const exportedMethodSignatureHashExportName = `tinygo_lowered_${symbolID}_exported_method_signature_hash`
    const exportedMethodSignatureHashExportValue = exportsObject[exportedMethodSignatureHashExportName]
    let expectedExportedMethodSignatureHash = 0
    let expectedExportedMethodSignatureHashPosition = 1
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      for (const match of sourceText.matchAll(/^\s*func\s*\([^)]*\)\s+([A-Z]\w*)(?:\s*\[[^\]]+\])?\s*(?:\([^)]*\)(?:\s*\([^)]*\)|\s+[^{\n]+)?)\s*\{/gm)) {
        for (const byte of textEncoder.encode(match[0].replace(/\s*\{$/, '').trim())) {
          expectedExportedMethodSignatureHash = (expectedExportedMethodSignatureHash + (byte * expectedExportedMethodSignatureHashPosition)) >>> 0
          expectedExportedMethodSignatureHashPosition += 1
        }
        expectedExportedMethodSignatureHash = (expectedExportedMethodSignatureHash + (0x0a * expectedExportedMethodSignatureHashPosition)) >>> 0
        expectedExportedMethodSignatureHashPosition += 1
      }
    }
    const exportedMethodSignatureHash =
      typeof exportedMethodSignatureHashExportValue === 'function'
        ? Number(exportedMethodSignatureHashExportValue())
        : expectedExportedMethodSignatureHash
    if (!Number.isInteger(exportedMethodSignatureHash) || exportedMethodSignatureHash < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid exported method signature hash for ${exportedMethodSignatureHashExportName}`)
    }
    if (typeof exportedMethodSignatureHashExportValue === 'function' && exportedMethodSignatureHash !== expectedExportedMethodSignatureHash) {
      throw new Error('frontend lowered artifact probe exported method signature hash did not match lowered sources manifest')
    }
    const exportedFunctionCountExportName = `tinygo_lowered_${symbolID}_exported_function_count`
    const exportedFunctionCountExportValue = exportsObject[exportedFunctionCountExportName]
    if (typeof exportedFunctionCountExportValue !== 'function') {
      throw new Error(`frontend lowered artifact probe missing export ${exportedFunctionCountExportName}`)
    }
    const exportedFunctionCount = Number(exportedFunctionCountExportValue())
    if (!Number.isInteger(exportedFunctionCount) || exportedFunctionCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid exported function count for ${exportedFunctionCountExportName}`)
    }
    let expectedExportedFunctionCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedExportedFunctionCount += (sourceText.match(/^\s*func\s+[A-Z]\w*(?:\s*\[[^\]]+\])?\s*\(/gm) ?? []).length
    }
    if (exportedFunctionCount !== expectedExportedFunctionCount) {
      throw new Error('frontend lowered artifact probe exported function count did not match lowered sources manifest')
    }
    const exportedFunctionNameHashExportName = `tinygo_lowered_${symbolID}_exported_function_name_hash`
    const exportedFunctionNameHashExportValue = exportsObject[exportedFunctionNameHashExportName]
    let expectedExportedFunctionNameHash = 0
    let expectedExportedFunctionNameHashPosition = 1
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      for (const match of sourceText.matchAll(/^\s*func\s+([A-Z]\w*)(?:\s*\[[^\]]+\])?\s*\(/gm)) {
        for (const byte of textEncoder.encode(match[1])) {
          expectedExportedFunctionNameHash = (expectedExportedFunctionNameHash + (byte * expectedExportedFunctionNameHashPosition)) >>> 0
          expectedExportedFunctionNameHashPosition += 1
        }
        expectedExportedFunctionNameHash = (expectedExportedFunctionNameHash + (0x0a * expectedExportedFunctionNameHashPosition)) >>> 0
        expectedExportedFunctionNameHashPosition += 1
      }
    }
    const exportedFunctionNameHash =
      typeof exportedFunctionNameHashExportValue === 'function'
        ? Number(exportedFunctionNameHashExportValue())
        : expectedExportedFunctionNameHash
    if (!Number.isInteger(exportedFunctionNameHash) || exportedFunctionNameHash < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid exported function name hash for ${exportedFunctionNameHashExportName}`)
    }
    if (
      typeof exportedFunctionNameHashExportValue === 'function' &&
      exportedFunctionNameHash !== expectedExportedFunctionNameHash
    ) {
      throw new Error('frontend lowered artifact probe exported function name hash did not match lowered sources manifest')
    }
    const typeCountExportName = `tinygo_lowered_${symbolID}_type_count`
    const typeCountExportValue = exportsObject[typeCountExportName]
    if (typeof typeCountExportValue !== 'function') {
      throw new Error(`frontend lowered artifact probe missing export ${typeCountExportName}`)
    }
    const typeCount = Number(typeCountExportValue())
    if (!Number.isInteger(typeCount) || typeCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid type count for ${typeCountExportName}`)
    }
    let expectedTypeCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedTypeCount += (sourceText.match(/^\s*type\s+[A-Za-z_]\w*/gm) ?? []).length
    }
    if (typeCount !== expectedTypeCount) {
      throw new Error('frontend lowered artifact probe type count did not match lowered sources manifest')
    }
    const typeNameHashExportName = `tinygo_lowered_${symbolID}_type_name_hash`
    const typeNameHashExportValue = exportsObject[typeNameHashExportName]
    let expectedTypeNameHash = 0
    let expectedTypeNameHashPosition = 1
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      for (const match of sourceText.matchAll(/^\s*type\s+([A-Za-z_]\w*)\b/gm)) {
        for (const byte of textEncoder.encode(match[1])) {
          expectedTypeNameHash = (expectedTypeNameHash + (byte * expectedTypeNameHashPosition)) >>> 0
          expectedTypeNameHashPosition += 1
        }
        expectedTypeNameHash = (expectedTypeNameHash + (0x0a * expectedTypeNameHashPosition)) >>> 0
        expectedTypeNameHashPosition += 1
      }
    }
    const typeNameHash =
      typeof typeNameHashExportValue === 'function' ? Number(typeNameHashExportValue()) : expectedTypeNameHash
    if (!Number.isInteger(typeNameHash) || typeNameHash < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid type name hash for ${typeNameHashExportName}`)
    }
    if (typeof typeNameHashExportValue === 'function' && typeNameHash !== expectedTypeNameHash) {
      throw new Error('frontend lowered artifact probe type name hash did not match lowered sources manifest')
    }
    const exportedTypeCountExportName = `tinygo_lowered_${symbolID}_exported_type_count`
    const exportedTypeCountExportValue = exportsObject[exportedTypeCountExportName]
    if (typeof exportedTypeCountExportValue !== 'function') {
      throw new Error(`frontend lowered artifact probe missing export ${exportedTypeCountExportName}`)
    }
    const exportedTypeCount = Number(exportedTypeCountExportValue())
    if (!Number.isInteger(exportedTypeCount) || exportedTypeCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid exported type count for ${exportedTypeCountExportName}`)
    }
    let expectedExportedTypeCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedExportedTypeCount += (sourceText.match(/^\s*type\s+[A-Z]\w*/gm) ?? []).length
    }
    if (exportedTypeCount !== expectedExportedTypeCount) {
      throw new Error('frontend lowered artifact probe exported type count did not match lowered sources manifest')
    }
    const exportedTypeNameHashExportName = `tinygo_lowered_${symbolID}_exported_type_name_hash`
    const exportedTypeNameHashExportValue = exportsObject[exportedTypeNameHashExportName]
    let expectedExportedTypeNameHash = 0
    let expectedExportedTypeNameHashPosition = 1
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      for (const match of sourceText.matchAll(/^\s*type\s+([A-Z]\w*)\b/gm)) {
        for (const byte of textEncoder.encode(match[1])) {
          expectedExportedTypeNameHash = (expectedExportedTypeNameHash + (byte * expectedExportedTypeNameHashPosition)) >>> 0
          expectedExportedTypeNameHashPosition += 1
        }
        expectedExportedTypeNameHash = (expectedExportedTypeNameHash + (0x0a * expectedExportedTypeNameHashPosition)) >>> 0
        expectedExportedTypeNameHashPosition += 1
      }
    }
    const exportedTypeNameHash =
      typeof exportedTypeNameHashExportValue === 'function'
        ? Number(exportedTypeNameHashExportValue())
        : expectedExportedTypeNameHash
    if (!Number.isInteger(exportedTypeNameHash) || exportedTypeNameHash < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid exported type name hash for ${exportedTypeNameHashExportName}`)
    }
    if (
      typeof exportedTypeNameHashExportValue === 'function' &&
      exportedTypeNameHash !== expectedExportedTypeNameHash
    ) {
      throw new Error('frontend lowered artifact probe exported type name hash did not match lowered sources manifest')
    }
    const structTypeCountExportName = `tinygo_lowered_${symbolID}_struct_type_count`
    const structTypeCountExportValue = exportsObject[structTypeCountExportName]
    if (typeof structTypeCountExportValue !== 'function') {
      throw new Error(`frontend lowered artifact probe missing export ${structTypeCountExportName}`)
    }
    const structTypeCount = Number(structTypeCountExportValue())
    if (!Number.isInteger(structTypeCount) || structTypeCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid struct type count for ${structTypeCountExportName}`)
    }
    let expectedStructTypeCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedStructTypeCount += (sourceText.match(/^\s*type\s+[A-Za-z_]\w*(?:\s*\[[^\]]+\])?\s+struct\b/gm) ?? []).length
    }
    if (structTypeCount !== expectedStructTypeCount) {
      throw new Error('frontend lowered artifact probe struct type count did not match lowered sources manifest')
    }
    const interfaceTypeCountExportName = `tinygo_lowered_${symbolID}_interface_type_count`
    const interfaceTypeCountExportValue = exportsObject[interfaceTypeCountExportName]
    if (typeof interfaceTypeCountExportValue !== 'function') {
      throw new Error(`frontend lowered artifact probe missing export ${interfaceTypeCountExportName}`)
    }
    const interfaceTypeCount = Number(interfaceTypeCountExportValue())
    if (!Number.isInteger(interfaceTypeCount) || interfaceTypeCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid interface type count for ${interfaceTypeCountExportName}`)
    }
    let expectedInterfaceTypeCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedInterfaceTypeCount += (sourceText.match(/^\s*type\s+[A-Za-z_]\w*(?:\s*\[[^\]]+\])?\s+interface\b/gm) ?? []).length
    }
    if (interfaceTypeCount !== expectedInterfaceTypeCount) {
      throw new Error('frontend lowered artifact probe interface type count did not match lowered sources manifest')
    }
    const mapTypeCountExportName = `tinygo_lowered_${symbolID}_map_type_count`
    const mapTypeCountExportValue = exportsObject[mapTypeCountExportName]
    let expectedMapTypeCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedMapTypeCount += (sourceText.match(/\bmap\s*\[/g) ?? []).length
    }
    const mapTypeCount = typeof mapTypeCountExportValue === 'function' ? Number(mapTypeCountExportValue()) : expectedMapTypeCount
    if (!Number.isInteger(mapTypeCount) || mapTypeCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid map type count for ${mapTypeCountExportName}`)
    }
    if (typeof mapTypeCountExportValue === 'function' && mapTypeCount !== expectedMapTypeCount) {
      throw new Error('frontend lowered artifact probe map type count did not match lowered sources manifest')
    }
    const chanTypeCountExportName = `tinygo_lowered_${symbolID}_chan_type_count`
    const chanTypeCountExportValue = exportsObject[chanTypeCountExportName]
    let expectedChanTypeCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedChanTypeCount += (sourceText.match(/(?:<-\s*chan|chan\s*<-|\bchan\b)/g) ?? []).length
    }
    const chanTypeCount = typeof chanTypeCountExportValue === 'function' ? Number(chanTypeCountExportValue()) : expectedChanTypeCount
    if (!Number.isInteger(chanTypeCount) || chanTypeCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid chan type count for ${chanTypeCountExportName}`)
    }
    if (typeof chanTypeCountExportValue === 'function' && chanTypeCount !== expectedChanTypeCount) {
      throw new Error('frontend lowered artifact probe chan type count did not match lowered sources manifest')
    }
    const sendOnlyChanTypeCountExportName = `tinygo_lowered_${symbolID}_send_only_chan_type_count`
    const sendOnlyChanTypeCountExportValue = exportsObject[sendOnlyChanTypeCountExportName]
    let expectedSendOnlyChanTypeCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedSendOnlyChanTypeCount += (sourceText.match(/\bchan\s*<-/g) ?? []).length
    }
    const sendOnlyChanTypeCount =
      typeof sendOnlyChanTypeCountExportValue === 'function' ? Number(sendOnlyChanTypeCountExportValue()) : expectedSendOnlyChanTypeCount
    if (!Number.isInteger(sendOnlyChanTypeCount) || sendOnlyChanTypeCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid send-only chan type count for ${sendOnlyChanTypeCountExportName}`)
    }
    if (typeof sendOnlyChanTypeCountExportValue === 'function' && sendOnlyChanTypeCount !== expectedSendOnlyChanTypeCount) {
      throw new Error('frontend lowered artifact probe send-only chan type count did not match lowered sources manifest')
    }
    const receiveOnlyChanTypeCountExportName = `tinygo_lowered_${symbolID}_receive_only_chan_type_count`
    const receiveOnlyChanTypeCountExportValue = exportsObject[receiveOnlyChanTypeCountExportName]
    let expectedReceiveOnlyChanTypeCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedReceiveOnlyChanTypeCount += (sourceText.match(/<-\s*chan\b/g) ?? []).length
    }
    const receiveOnlyChanTypeCount =
      typeof receiveOnlyChanTypeCountExportValue === 'function' ? Number(receiveOnlyChanTypeCountExportValue()) : expectedReceiveOnlyChanTypeCount
    if (!Number.isInteger(receiveOnlyChanTypeCount) || receiveOnlyChanTypeCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid receive-only chan type count for ${receiveOnlyChanTypeCountExportName}`)
    }
    if (typeof receiveOnlyChanTypeCountExportValue === 'function' && receiveOnlyChanTypeCount !== expectedReceiveOnlyChanTypeCount) {
      throw new Error('frontend lowered artifact probe receive-only chan type count did not match lowered sources manifest')
    }
    const arrayTypeCountExportName = `tinygo_lowered_${symbolID}_array_type_count`
    const arrayTypeCountExportValue = exportsObject[arrayTypeCountExportName]
    let expectedArrayTypeCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedArrayTypeCount += [...sourceText.matchAll(/\[[^\]\n]*\](?=\s*(?:\[[^\]\n]*\]|[\*A-Za-z_]|map\s*\[|chan\b|<-|struct\b|interface\b))/gm)].length
    }
    const arrayTypeCount = typeof arrayTypeCountExportValue === 'function' ? Number(arrayTypeCountExportValue()) : expectedArrayTypeCount
    if (!Number.isInteger(arrayTypeCount) || arrayTypeCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid array type count for ${arrayTypeCountExportName}`)
    }
    if (typeof arrayTypeCountExportValue === 'function' && arrayTypeCount !== expectedArrayTypeCount) {
      throw new Error('frontend lowered artifact probe array type count did not match lowered sources manifest')
    }
    const sliceTypeCountExportName = `tinygo_lowered_${symbolID}_slice_type_count`
    const sliceTypeCountExportValue = exportsObject[sliceTypeCountExportName]
    let expectedSliceTypeCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedSliceTypeCount += [...sourceText.matchAll(/\[\](?=\s*(?:\[[^\]\n]*\]|[\*A-Za-z_]|map\s*\[|chan\b|<-|struct\b|interface\b))/gm)].length
    }
    const sliceTypeCount = typeof sliceTypeCountExportValue === 'function' ? Number(sliceTypeCountExportValue()) : expectedSliceTypeCount
    if (!Number.isInteger(sliceTypeCount) || sliceTypeCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid slice type count for ${sliceTypeCountExportName}`)
    }
    if (typeof sliceTypeCountExportValue === 'function' && sliceTypeCount !== expectedSliceTypeCount) {
      throw new Error('frontend lowered artifact probe slice type count did not match lowered sources manifest')
    }
    const pointerTypeCountExportName = `tinygo_lowered_${symbolID}_pointer_type_count`
    const pointerTypeCountExportValue = exportsObject[pointerTypeCountExportName]
    let expectedPointerTypeCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText = typeContextSourceTextByFile[sourceFile] ?? ''
      if (sourceText === '') {
        continue
      }
      for (const match of sourceText.matchAll(/(?:\b[A-Za-z_]\w*\s+|[(),\]])(\*+)(?=\s*(?:\[[^\]\n]*\]|[\*A-Za-z_]|map\s*\[|chan\b|<-|struct\b|interface\b))/gm)) {
        expectedPointerTypeCount += match[1].length
      }
    }
    const pointerTypeCount = typeof pointerTypeCountExportValue === 'function' ? Number(pointerTypeCountExportValue()) : expectedPointerTypeCount
    if (!Number.isInteger(pointerTypeCount) || pointerTypeCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid pointer type count for ${pointerTypeCountExportName}`)
    }
    if (typeof pointerTypeCountExportValue === 'function' && pointerTypeCount !== expectedPointerTypeCount) {
      throw new Error('frontend lowered artifact probe pointer type count did not match lowered sources manifest')
    }
    const structFieldCountExportName = `tinygo_lowered_${symbolID}_struct_field_count`
    const structFieldCountExportValue = exportsObject[structFieldCountExportName]
    let expectedStructFieldCount = 0
    let expectedEmbeddedStructFieldCount = 0
    let expectedTaggedStructFieldCount = 0
    let expectedStructFieldNameHash = 0
    let expectedStructFieldNameHashPosition = 1
    let expectedStructFieldTypeHash = 0
    let expectedStructFieldTypeHashPosition = 1
    let expectedEmbeddedStructFieldTypeHash = 0
    let expectedEmbeddedStructFieldTypeHashPosition = 1
    let expectedTaggedStructFieldTagHash = 0
    let expectedTaggedStructFieldTagHashPosition = 1
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      for (const match of sourceText.matchAll(/type\s+[A-Za-z_]\w*\s+struct\s*\{([^}]*)\}/g)) {
        for (const field of match[1].split(/[;\n]/).map((entry) => entry.trim()).filter((entry) => entry !== '')) {
          const tagMatch = field.match(/\s+(`[^`]*`)\s*$/)
          if (tagMatch) {
            expectedTaggedStructFieldCount += 1
            for (const byte of textEncoder.encode(tagMatch[1])) {
              expectedTaggedStructFieldTagHash = (expectedTaggedStructFieldTagHash + (byte * expectedTaggedStructFieldTagHashPosition)) >>> 0
              expectedTaggedStructFieldTagHashPosition += 1
            }
            expectedTaggedStructFieldTagHash = (expectedTaggedStructFieldTagHash + (0x0a * expectedTaggedStructFieldTagHashPosition)) >>> 0
            expectedTaggedStructFieldTagHashPosition += 1
          }
          const fieldWithoutTag = field.replace(/\s+`[^`]*`\s*$/, '')
          if (!/\s/.test(fieldWithoutTag)) {
            expectedStructFieldCount += 1
            expectedEmbeddedStructFieldCount += 1
            for (const byte of textEncoder.encode(fieldWithoutTag)) {
              expectedEmbeddedStructFieldTypeHash = (expectedEmbeddedStructFieldTypeHash + (byte * expectedEmbeddedStructFieldTypeHashPosition)) >>> 0
              expectedEmbeddedStructFieldTypeHashPosition += 1
            }
            expectedEmbeddedStructFieldTypeHash = (expectedEmbeddedStructFieldTypeHash + (0x0a * expectedEmbeddedStructFieldTypeHashPosition)) >>> 0
            expectedEmbeddedStructFieldTypeHashPosition += 1
            continue
          }
          const namedFieldMatch = fieldWithoutTag.match(/^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s+/)
          if (!namedFieldMatch) {
            continue
          }
          const fieldTypeMatch = fieldWithoutTag.match(/^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s+(.+)$/)
          const fieldTypeSource = fieldTypeMatch?.[2]?.trim() ?? ''
          const fieldNames = namedFieldMatch[1].split(',').map((entry) => entry.trim()).filter((entry) => entry !== '')
          expectedStructFieldCount += fieldNames.length
          for (const fieldName of fieldNames) {
            for (const byte of textEncoder.encode(fieldName)) {
              expectedStructFieldNameHash = (expectedStructFieldNameHash + (byte * expectedStructFieldNameHashPosition)) >>> 0
              expectedStructFieldNameHashPosition += 1
            }
            expectedStructFieldNameHash = (expectedStructFieldNameHash + (0x0a * expectedStructFieldNameHashPosition)) >>> 0
            expectedStructFieldNameHashPosition += 1
            for (const byte of textEncoder.encode(fieldTypeSource)) {
              expectedStructFieldTypeHash = (expectedStructFieldTypeHash + (byte * expectedStructFieldTypeHashPosition)) >>> 0
              expectedStructFieldTypeHashPosition += 1
            }
            expectedStructFieldTypeHash = (expectedStructFieldTypeHash + (0x0a * expectedStructFieldTypeHashPosition)) >>> 0
            expectedStructFieldTypeHashPosition += 1
          }
        }
      }
    }
    if (typeof structFieldCountExportValue !== 'function') {
      if (expectedStructFieldCount !== 0) {
        throw new Error(`frontend lowered artifact probe missing export ${structFieldCountExportName}`)
      }
    }
    const structFieldCount = typeof structFieldCountExportValue === 'function' ? Number(structFieldCountExportValue()) : 0
    if (!Number.isInteger(structFieldCount) || structFieldCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid struct field count for ${structFieldCountExportName}`)
    }
    if (structFieldCount !== expectedStructFieldCount) {
      throw new Error('frontend lowered artifact probe struct field count did not match lowered sources manifest')
    }
    const embeddedStructFieldCountExportName = `tinygo_lowered_${symbolID}_embedded_struct_field_count`
    const embeddedStructFieldCountExportValue = exportsObject[embeddedStructFieldCountExportName]
    if (typeof embeddedStructFieldCountExportValue !== 'function') {
      if (expectedEmbeddedStructFieldCount !== 0) {
        throw new Error(`frontend lowered artifact probe missing export ${embeddedStructFieldCountExportName}`)
      }
    }
    const embeddedStructFieldCount = typeof embeddedStructFieldCountExportValue === 'function' ? Number(embeddedStructFieldCountExportValue()) : 0
    if (!Number.isInteger(embeddedStructFieldCount) || embeddedStructFieldCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid embedded struct field count for ${embeddedStructFieldCountExportName}`)
    }
    if (embeddedStructFieldCount !== expectedEmbeddedStructFieldCount) {
      throw new Error('frontend lowered artifact probe embedded struct field count did not match lowered sources manifest')
    }
    const taggedStructFieldCountExportName = `tinygo_lowered_${symbolID}_tagged_struct_field_count`
    const taggedStructFieldCountExportValue = exportsObject[taggedStructFieldCountExportName]
    if (typeof taggedStructFieldCountExportValue !== 'function') {
      if (expectedTaggedStructFieldCount !== 0) {
        throw new Error(`frontend lowered artifact probe missing export ${taggedStructFieldCountExportName}`)
      }
    }
    const taggedStructFieldCount = typeof taggedStructFieldCountExportValue === 'function' ? Number(taggedStructFieldCountExportValue()) : 0
    if (!Number.isInteger(taggedStructFieldCount) || taggedStructFieldCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid tagged struct field count for ${taggedStructFieldCountExportName}`)
    }
    if (taggedStructFieldCount !== expectedTaggedStructFieldCount) {
      throw new Error('frontend lowered artifact probe tagged struct field count did not match lowered sources manifest')
    }
    const structFieldNameHashExportName = `tinygo_lowered_${symbolID}_struct_field_name_hash`
    const structFieldNameHashExportValue = exportsObject[structFieldNameHashExportName]
    if (typeof structFieldNameHashExportValue !== 'function') {
      if (expectedStructFieldNameHash !== 0) {
        throw new Error(`frontend lowered artifact probe missing export ${structFieldNameHashExportName}`)
      }
    }
    const structFieldNameHash = typeof structFieldNameHashExportValue === 'function' ? Number(structFieldNameHashExportValue()) : 0
    if (!Number.isInteger(structFieldNameHash) || structFieldNameHash < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid struct field name hash for ${structFieldNameHashExportName}`)
    }
    if (structFieldNameHash !== expectedStructFieldNameHash) {
      throw new Error('frontend lowered artifact probe struct field name hash did not match lowered sources manifest')
    }
    const structFieldTypeHashExportName = `tinygo_lowered_${symbolID}_struct_field_type_hash`
    const structFieldTypeHashExportValue = exportsObject[structFieldTypeHashExportName]
    if (typeof structFieldTypeHashExportValue !== 'function') {
      if (expectedStructFieldTypeHash !== 0) {
        throw new Error(`frontend lowered artifact probe missing export ${structFieldTypeHashExportName}`)
      }
    }
    const structFieldTypeHash = typeof structFieldTypeHashExportValue === 'function' ? Number(structFieldTypeHashExportValue()) : 0
    if (!Number.isInteger(structFieldTypeHash) || structFieldTypeHash < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid struct field type hash for ${structFieldTypeHashExportName}`)
    }
    if (structFieldTypeHash !== expectedStructFieldTypeHash) {
      throw new Error('frontend lowered artifact probe struct field type hash did not match lowered sources manifest')
    }
    const embeddedStructFieldTypeHashExportName = `tinygo_lowered_${symbolID}_embedded_struct_field_type_hash`
    const embeddedStructFieldTypeHashExportValue = exportsObject[embeddedStructFieldTypeHashExportName]
    if (typeof embeddedStructFieldTypeHashExportValue !== 'function') {
      if (expectedEmbeddedStructFieldTypeHash !== 0) {
        throw new Error(`frontend lowered artifact probe missing export ${embeddedStructFieldTypeHashExportName}`)
      }
    }
    const embeddedStructFieldTypeHash =
      typeof embeddedStructFieldTypeHashExportValue === 'function' ? Number(embeddedStructFieldTypeHashExportValue()) : 0
    if (!Number.isInteger(embeddedStructFieldTypeHash) || embeddedStructFieldTypeHash < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid embedded struct field type hash for ${embeddedStructFieldTypeHashExportName}`)
    }
    if (embeddedStructFieldTypeHash !== expectedEmbeddedStructFieldTypeHash) {
      throw new Error('frontend lowered artifact probe embedded struct field type hash did not match lowered sources manifest')
    }
    const taggedStructFieldTagHashExportName = `tinygo_lowered_${symbolID}_tagged_struct_field_tag_hash`
    const taggedStructFieldTagHashExportValue = exportsObject[taggedStructFieldTagHashExportName]
    if (typeof taggedStructFieldTagHashExportValue !== 'function') {
      if (expectedTaggedStructFieldTagHash !== 0) {
        throw new Error(`frontend lowered artifact probe missing export ${taggedStructFieldTagHashExportName}`)
      }
    }
    const taggedStructFieldTagHash =
      typeof taggedStructFieldTagHashExportValue === 'function' ? Number(taggedStructFieldTagHashExportValue()) : 0
    if (!Number.isInteger(taggedStructFieldTagHash) || taggedStructFieldTagHash < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid tagged struct field tag hash for ${taggedStructFieldTagHashExportName}`)
    }
    if (taggedStructFieldTagHash !== expectedTaggedStructFieldTagHash) {
      throw new Error('frontend lowered artifact probe tagged struct field tag hash did not match lowered sources manifest')
    }
    const interfaceMethodCountExportName = `tinygo_lowered_${symbolID}_interface_method_count`
    const interfaceMethodCountExportValue = exportsObject[interfaceMethodCountExportName]
    let expectedInterfaceMethodCount = 0
    let expectedInterfaceMethodNameHash = 0
    let expectedInterfaceMethodNameHashPosition = 1
    let expectedInterfaceMethodSignatureHash = 0
    let expectedInterfaceMethodSignatureHashPosition = 1
    let expectedEmbeddedInterfaceMethodCount = 0
    let expectedEmbeddedInterfaceMethodNameHash = 0
    let expectedEmbeddedInterfaceMethodNameHashPosition = 1
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      for (const match of sourceText.matchAll(/type\s+[A-Za-z_]\w*\s+interface\s*\{([^}]*)\}/g)) {
        for (const method of match[1].split(/[;\n]/).map((entry) => entry.trim()).filter((entry) => entry !== '')) {
          expectedInterfaceMethodCount += 1
          if (!method.includes('(')) {
            expectedEmbeddedInterfaceMethodCount += 1
            for (const byte of textEncoder.encode(method)) {
              expectedEmbeddedInterfaceMethodNameHash =
                (expectedEmbeddedInterfaceMethodNameHash + (byte * expectedEmbeddedInterfaceMethodNameHashPosition)) >>> 0
              expectedEmbeddedInterfaceMethodNameHashPosition += 1
            }
            expectedEmbeddedInterfaceMethodNameHash =
              (expectedEmbeddedInterfaceMethodNameHash + (0x0a * expectedEmbeddedInterfaceMethodNameHashPosition)) >>> 0
            expectedEmbeddedInterfaceMethodNameHashPosition += 1
            continue
          }
          const methodNameMatch = method.match(/^([A-Za-z_]\w*)\s*\(/)
          if (!methodNameMatch) {
            continue
          }
          const methodSignatureSource = method.slice(method.indexOf('(')).trim()
          for (const byte of textEncoder.encode(methodNameMatch[1])) {
            expectedInterfaceMethodNameHash = (expectedInterfaceMethodNameHash + (byte * expectedInterfaceMethodNameHashPosition)) >>> 0
            expectedInterfaceMethodNameHashPosition += 1
          }
          expectedInterfaceMethodNameHash = (expectedInterfaceMethodNameHash + (0x0a * expectedInterfaceMethodNameHashPosition)) >>> 0
          expectedInterfaceMethodNameHashPosition += 1
          for (const byte of textEncoder.encode(methodSignatureSource)) {
            expectedInterfaceMethodSignatureHash = (expectedInterfaceMethodSignatureHash + (byte * expectedInterfaceMethodSignatureHashPosition)) >>> 0
            expectedInterfaceMethodSignatureHashPosition += 1
          }
          expectedInterfaceMethodSignatureHash = (expectedInterfaceMethodSignatureHash + (0x0a * expectedInterfaceMethodSignatureHashPosition)) >>> 0
          expectedInterfaceMethodSignatureHashPosition += 1
        }
      }
    }
    if (typeof interfaceMethodCountExportValue !== 'function') {
      if (expectedInterfaceMethodCount !== 0) {
        throw new Error(`frontend lowered artifact probe missing export ${interfaceMethodCountExportName}`)
      }
    }
    const interfaceMethodCount = typeof interfaceMethodCountExportValue === 'function' ? Number(interfaceMethodCountExportValue()) : 0
    if (!Number.isInteger(interfaceMethodCount) || interfaceMethodCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid interface method count for ${interfaceMethodCountExportName}`)
    }
    if (interfaceMethodCount !== expectedInterfaceMethodCount) {
      throw new Error('frontend lowered artifact probe interface method count did not match lowered sources manifest')
    }
    const interfaceMethodNameHashExportName = `tinygo_lowered_${symbolID}_interface_method_name_hash`
    const interfaceMethodNameHashExportValue = exportsObject[interfaceMethodNameHashExportName]
    if (typeof interfaceMethodNameHashExportValue !== 'function') {
      if (expectedInterfaceMethodNameHash !== 0) {
        throw new Error(`frontend lowered artifact probe missing export ${interfaceMethodNameHashExportName}`)
      }
    }
    const interfaceMethodNameHash =
      typeof interfaceMethodNameHashExportValue === 'function' ? Number(interfaceMethodNameHashExportValue()) : 0
    if (!Number.isInteger(interfaceMethodNameHash) || interfaceMethodNameHash < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid interface method name hash for ${interfaceMethodNameHashExportName}`)
    }
    if (interfaceMethodNameHash !== expectedInterfaceMethodNameHash) {
      throw new Error('frontend lowered artifact probe interface method name hash did not match lowered sources manifest')
    }
    const interfaceMethodSignatureHashExportName = `tinygo_lowered_${symbolID}_interface_method_signature_hash`
    const interfaceMethodSignatureHashExportValue = exportsObject[interfaceMethodSignatureHashExportName]
    if (typeof interfaceMethodSignatureHashExportValue !== 'function') {
      if (expectedInterfaceMethodSignatureHash !== 0) {
        throw new Error(`frontend lowered artifact probe missing export ${interfaceMethodSignatureHashExportName}`)
      }
    }
    const interfaceMethodSignatureHash =
      typeof interfaceMethodSignatureHashExportValue === 'function' ? Number(interfaceMethodSignatureHashExportValue()) : 0
    if (!Number.isInteger(interfaceMethodSignatureHash) || interfaceMethodSignatureHash < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid interface method signature hash for ${interfaceMethodSignatureHashExportName}`)
    }
    if (interfaceMethodSignatureHash !== expectedInterfaceMethodSignatureHash) {
      throw new Error('frontend lowered artifact probe interface method signature hash did not match lowered sources manifest')
    }
    const embeddedInterfaceMethodCountExportName = `tinygo_lowered_${symbolID}_embedded_interface_method_count`
    const embeddedInterfaceMethodCountExportValue = exportsObject[embeddedInterfaceMethodCountExportName]
    if (typeof embeddedInterfaceMethodCountExportValue !== 'function') {
      if (expectedEmbeddedInterfaceMethodCount !== 0) {
        throw new Error(`frontend lowered artifact probe missing export ${embeddedInterfaceMethodCountExportName}`)
      }
    }
    const embeddedInterfaceMethodCount =
      typeof embeddedInterfaceMethodCountExportValue === 'function' ? Number(embeddedInterfaceMethodCountExportValue()) : 0
    if (!Number.isInteger(embeddedInterfaceMethodCount) || embeddedInterfaceMethodCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid embedded interface method count for ${embeddedInterfaceMethodCountExportName}`)
    }
    if (embeddedInterfaceMethodCount !== expectedEmbeddedInterfaceMethodCount) {
      throw new Error('frontend lowered artifact probe embedded interface method count did not match lowered sources manifest')
    }
    const embeddedInterfaceMethodNameHashExportName = `tinygo_lowered_${symbolID}_embedded_interface_method_name_hash`
    const embeddedInterfaceMethodNameHashExportValue = exportsObject[embeddedInterfaceMethodNameHashExportName]
    if (typeof embeddedInterfaceMethodNameHashExportValue !== 'function') {
      if (expectedEmbeddedInterfaceMethodNameHash !== 0) {
        throw new Error(`frontend lowered artifact probe missing export ${embeddedInterfaceMethodNameHashExportName}`)
      }
    }
    const embeddedInterfaceMethodNameHash =
      typeof embeddedInterfaceMethodNameHashExportValue === 'function' ? Number(embeddedInterfaceMethodNameHashExportValue()) : 0
    if (!Number.isInteger(embeddedInterfaceMethodNameHash) || embeddedInterfaceMethodNameHash < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid embedded interface method name hash for ${embeddedInterfaceMethodNameHashExportName}`)
    }
    if (embeddedInterfaceMethodNameHash !== expectedEmbeddedInterfaceMethodNameHash) {
      throw new Error('frontend lowered artifact probe embedded interface method name hash did not match lowered sources manifest')
    }
    const constCountExportName = `tinygo_lowered_${symbolID}_const_count`
    const constCountExportValue = exportsObject[constCountExportName]
    if (typeof constCountExportValue !== 'function') {
      throw new Error(`frontend lowered artifact probe missing export ${constCountExportName}`)
    }
    const constCount = Number(constCountExportValue())
    if (!Number.isInteger(constCount) || constCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid const count for ${constCountExportName}`)
    }
    let expectedConstCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedConstCount += (sourceText.match(/^\s*const\s+[A-Za-z_]\w*/gm) ?? []).length
      for (const blockMatch of sourceText.matchAll(/^\s*const\s*\(([\s\S]*?)^\s*\)/gm)) {
        for (const line of blockMatch[1].split('\n').map((entry) => entry.trim()).filter((entry) => entry !== '')) {
          if (/^[A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*\b/.test(line)) {
            expectedConstCount += 1
          }
        }
      }
    }
    if (constCount !== expectedConstCount) {
      throw new Error('frontend lowered artifact probe const count did not match lowered sources manifest')
    }
    const constNameHashExportName = `tinygo_lowered_${symbolID}_const_name_hash`
    const constNameHashExportValue = exportsObject[constNameHashExportName]
    let expectedConstNameHash = 0
    let expectedConstNameHashPosition = 1
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      for (const match of sourceText.matchAll(/^\s*const\s+([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)/gm)) {
        for (const name of match[1].split(',').map((entry) => entry.trim()).filter((entry) => entry !== '')) {
          for (const byte of textEncoder.encode(name)) {
            expectedConstNameHash = (expectedConstNameHash + (byte * expectedConstNameHashPosition)) >>> 0
            expectedConstNameHashPosition += 1
          }
          expectedConstNameHash = (expectedConstNameHash + (0x0a * expectedConstNameHashPosition)) >>> 0
          expectedConstNameHashPosition += 1
        }
      }
      for (const blockMatch of sourceText.matchAll(/^\s*const\s*\(([\s\S]*?)^\s*\)/gm)) {
        for (const line of blockMatch[1].split('\n').map((entry) => entry.trim()).filter((entry) => entry !== '')) {
          const nameMatch = line.match(/^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\b/)
          if (!nameMatch) {
            continue
          }
          for (const name of nameMatch[1].split(',').map((entry) => entry.trim()).filter((entry) => entry !== '')) {
            for (const byte of textEncoder.encode(name)) {
              expectedConstNameHash = (expectedConstNameHash + (byte * expectedConstNameHashPosition)) >>> 0
              expectedConstNameHashPosition += 1
            }
            expectedConstNameHash = (expectedConstNameHash + (0x0a * expectedConstNameHashPosition)) >>> 0
            expectedConstNameHashPosition += 1
          }
        }
      }
    }
    const constNameHash =
      typeof constNameHashExportValue === 'function' ? Number(constNameHashExportValue()) : expectedConstNameHash
    if (!Number.isInteger(constNameHash) || constNameHash < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid const name hash for ${constNameHashExportName}`)
    }
    if (typeof constNameHashExportValue === 'function' && constNameHash !== expectedConstNameHash) {
      throw new Error('frontend lowered artifact probe const name hash did not match lowered sources manifest')
    }
    const varCountExportName = `tinygo_lowered_${symbolID}_var_count`
    const varCountExportValue = exportsObject[varCountExportName]
    if (typeof varCountExportValue !== 'function') {
      throw new Error(`frontend lowered artifact probe missing export ${varCountExportName}`)
    }
    const varCount = Number(varCountExportValue())
    if (!Number.isInteger(varCount) || varCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid var count for ${varCountExportName}`)
    }
    let expectedVarCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedVarCount += (sourceText.match(/^\s*var\s+[A-Za-z_]\w*/gm) ?? []).length
      for (const blockMatch of sourceText.matchAll(/^\s*var\s*\(([\s\S]*?)^\s*\)/gm)) {
        for (const line of blockMatch[1].split('\n').map((entry) => entry.trim()).filter((entry) => entry !== '')) {
          if (/^[A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*\b/.test(line)) {
            expectedVarCount += 1
          }
        }
      }
    }
    if (varCount !== expectedVarCount) {
      throw new Error('frontend lowered artifact probe var count did not match lowered sources manifest')
    }
    const varNameHashExportName = `tinygo_lowered_${symbolID}_var_name_hash`
    const varNameHashExportValue = exportsObject[varNameHashExportName]
    let expectedVarNameHash = 0
    let expectedVarNameHashPosition = 1
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      for (const match of sourceText.matchAll(/^\s*var\s+([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)/gm)) {
        for (const name of match[1].split(',').map((entry) => entry.trim()).filter((entry) => entry !== '')) {
          for (const byte of textEncoder.encode(name)) {
            expectedVarNameHash = (expectedVarNameHash + (byte * expectedVarNameHashPosition)) >>> 0
            expectedVarNameHashPosition += 1
          }
          expectedVarNameHash = (expectedVarNameHash + (0x0a * expectedVarNameHashPosition)) >>> 0
          expectedVarNameHashPosition += 1
        }
      }
      for (const blockMatch of sourceText.matchAll(/^\s*var\s*\(([\s\S]*?)^\s*\)/gm)) {
        for (const line of blockMatch[1].split('\n').map((entry) => entry.trim()).filter((entry) => entry !== '')) {
          const nameMatch = line.match(/^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\b/)
          if (!nameMatch) {
            continue
          }
          for (const name of nameMatch[1].split(',').map((entry) => entry.trim()).filter((entry) => entry !== '')) {
            for (const byte of textEncoder.encode(name)) {
              expectedVarNameHash = (expectedVarNameHash + (byte * expectedVarNameHashPosition)) >>> 0
              expectedVarNameHashPosition += 1
            }
            expectedVarNameHash = (expectedVarNameHash + (0x0a * expectedVarNameHashPosition)) >>> 0
            expectedVarNameHashPosition += 1
          }
        }
      }
    }
    const varNameHash = typeof varNameHashExportValue === 'function' ? Number(varNameHashExportValue()) : expectedVarNameHash
    if (!Number.isInteger(varNameHash) || varNameHash < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid var name hash for ${varNameHashExportName}`)
    }
    if (typeof varNameHashExportValue === 'function' && varNameHash !== expectedVarNameHash) {
      throw new Error('frontend lowered artifact probe var name hash did not match lowered sources manifest')
    }
    const exportedConstCountExportName = `tinygo_lowered_${symbolID}_exported_const_count`
    const exportedConstCountExportValue = exportsObject[exportedConstCountExportName]
    if (typeof exportedConstCountExportValue !== 'function') {
      throw new Error(`frontend lowered artifact probe missing export ${exportedConstCountExportName}`)
    }
    const exportedConstCount = Number(exportedConstCountExportValue())
    if (!Number.isInteger(exportedConstCount) || exportedConstCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid exported const count for ${exportedConstCountExportName}`)
    }
    let expectedExportedConstCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedExportedConstCount += (sourceText.match(/^\s*const\s+[A-Z]\w*/gm) ?? []).length
      for (const blockMatch of sourceText.matchAll(/^\s*const\s*\(([\s\S]*?)^\s*\)/gm)) {
        for (const line of blockMatch[1].split('\n').map((entry) => entry.trim()).filter((entry) => entry !== '')) {
          const nameMatch = line.match(/^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\b/)
          if (!nameMatch) {
            continue
          }
          for (const name of nameMatch[1].split(',').map((entry) => entry.trim()).filter((entry) => entry !== '')) {
            if (/^[A-Z]/.test(name)) {
              expectedExportedConstCount += 1
            }
          }
        }
      }
    }
    if (exportedConstCount !== expectedExportedConstCount) {
      throw new Error('frontend lowered artifact probe exported const count did not match lowered sources manifest')
    }
    const exportedConstNameHashExportName = `tinygo_lowered_${symbolID}_exported_const_name_hash`
    const exportedConstNameHashExportValue = exportsObject[exportedConstNameHashExportName]
    let expectedExportedConstNameHash = 0
    let expectedExportedConstNameHashPosition = 1
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      for (const match of sourceText.matchAll(/^\s*const\s+([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)/gm)) {
        for (const name of match[1].split(',').map((entry) => entry.trim()).filter((entry) => /^[A-Z]\w*$/.test(entry))) {
          for (const byte of textEncoder.encode(name)) {
            expectedExportedConstNameHash = (expectedExportedConstNameHash + (byte * expectedExportedConstNameHashPosition)) >>> 0
            expectedExportedConstNameHashPosition += 1
          }
          expectedExportedConstNameHash = (expectedExportedConstNameHash + (0x0a * expectedExportedConstNameHashPosition)) >>> 0
          expectedExportedConstNameHashPosition += 1
        }
      }
      for (const blockMatch of sourceText.matchAll(/^\s*const\s*\(([\s\S]*?)^\s*\)/gm)) {
        for (const line of blockMatch[1].split('\n').map((entry) => entry.trim()).filter((entry) => entry !== '')) {
          const nameMatch = line.match(/^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\b/)
          if (!nameMatch) {
            continue
          }
          for (const name of nameMatch[1].split(',').map((entry) => entry.trim()).filter((entry) => /^[A-Z]\w*$/.test(entry))) {
            for (const byte of textEncoder.encode(name)) {
              expectedExportedConstNameHash = (expectedExportedConstNameHash + (byte * expectedExportedConstNameHashPosition)) >>> 0
              expectedExportedConstNameHashPosition += 1
            }
            expectedExportedConstNameHash = (expectedExportedConstNameHash + (0x0a * expectedExportedConstNameHashPosition)) >>> 0
            expectedExportedConstNameHashPosition += 1
          }
        }
      }
    }
    const exportedConstNameHash =
      typeof exportedConstNameHashExportValue === 'function' ? Number(exportedConstNameHashExportValue()) : expectedExportedConstNameHash
    if (!Number.isInteger(exportedConstNameHash) || exportedConstNameHash < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid exported const name hash for ${exportedConstNameHashExportName}`)
    }
    if (typeof exportedConstNameHashExportValue === 'function' && exportedConstNameHash !== expectedExportedConstNameHash) {
      throw new Error('frontend lowered artifact probe exported const name hash did not match lowered sources manifest')
    }
    const exportedVarCountExportName = `tinygo_lowered_${symbolID}_exported_var_count`
    const exportedVarCountExportValue = exportsObject[exportedVarCountExportName]
    if (typeof exportedVarCountExportValue !== 'function') {
      throw new Error(`frontend lowered artifact probe missing export ${exportedVarCountExportName}`)
    }
    const exportedVarCount = Number(exportedVarCountExportValue())
    if (!Number.isInteger(exportedVarCount) || exportedVarCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid exported var count for ${exportedVarCountExportName}`)
    }
    let expectedExportedVarCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedExportedVarCount += (sourceText.match(/^\s*var\s+[A-Z]\w*/gm) ?? []).length
      for (const blockMatch of sourceText.matchAll(/^\s*var\s*\(([\s\S]*?)^\s*\)/gm)) {
        for (const line of blockMatch[1].split('\n').map((entry) => entry.trim()).filter((entry) => entry !== '')) {
          const nameMatch = line.match(/^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\b/)
          if (!nameMatch) {
            continue
          }
          for (const name of nameMatch[1].split(',').map((entry) => entry.trim()).filter((entry) => entry !== '')) {
            if (/^[A-Z]/.test(name)) {
              expectedExportedVarCount += 1
            }
          }
        }
      }
    }
    if (exportedVarCount !== expectedExportedVarCount) {
      throw new Error('frontend lowered artifact probe exported var count did not match lowered sources manifest')
    }
    const exportedVarNameHashExportName = `tinygo_lowered_${symbolID}_exported_var_name_hash`
    const exportedVarNameHashExportValue = exportsObject[exportedVarNameHashExportName]
    let expectedExportedVarNameHash = 0
    let expectedExportedVarNameHashPosition = 1
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      for (const match of sourceText.matchAll(/^\s*var\s+([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)/gm)) {
        for (const name of match[1].split(',').map((entry) => entry.trim()).filter((entry) => /^[A-Z]\w*$/.test(entry))) {
          for (const byte of textEncoder.encode(name)) {
            expectedExportedVarNameHash = (expectedExportedVarNameHash + (byte * expectedExportedVarNameHashPosition)) >>> 0
            expectedExportedVarNameHashPosition += 1
          }
          expectedExportedVarNameHash = (expectedExportedVarNameHash + (0x0a * expectedExportedVarNameHashPosition)) >>> 0
          expectedExportedVarNameHashPosition += 1
        }
      }
      for (const blockMatch of sourceText.matchAll(/^\s*var\s*\(([\s\S]*?)^\s*\)/gm)) {
        for (const line of blockMatch[1].split('\n').map((entry) => entry.trim()).filter((entry) => entry !== '')) {
          const nameMatch = line.match(/^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\b/)
          if (!nameMatch) {
            continue
          }
          for (const name of nameMatch[1].split(',').map((entry) => entry.trim()).filter((entry) => /^[A-Z]\w*$/.test(entry))) {
            for (const byte of textEncoder.encode(name)) {
              expectedExportedVarNameHash = (expectedExportedVarNameHash + (byte * expectedExportedVarNameHashPosition)) >>> 0
              expectedExportedVarNameHashPosition += 1
            }
            expectedExportedVarNameHash = (expectedExportedVarNameHash + (0x0a * expectedExportedVarNameHashPosition)) >>> 0
            expectedExportedVarNameHashPosition += 1
          }
        }
      }
    }
    const exportedVarNameHash =
      typeof exportedVarNameHashExportValue === 'function' ? Number(exportedVarNameHashExportValue()) : expectedExportedVarNameHash
    if (!Number.isInteger(exportedVarNameHash) || exportedVarNameHash < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid exported var name hash for ${exportedVarNameHashExportName}`)
    }
    if (typeof exportedVarNameHashExportValue === 'function' && exportedVarNameHash !== expectedExportedVarNameHash) {
      throw new Error('frontend lowered artifact probe exported var name hash did not match lowered sources manifest')
    }
    let declarationCount = 0
    let declarationNameHash = 0
    let declarationSignatureHash = 0
    let declarationKindHash = 0
    let declarationExportedCount = 0
    let declarationExportedNameHash = 0
    let declarationExportedSignatureHash = 0
    let declarationExportedKindHash = 0
    let declarationMethodCount = 0
    let declarationMethodNameHash = 0
    let declarationMethodSignatureHash = 0
    let declarationMethodKindHash = 0
    if (loweredIRUnit) {
      const declarationCountExportName = `tinygo_lowered_${symbolID}_declaration_count`
      const declarationCountExportValue = exportsObject[declarationCountExportName]
      if (typeof declarationCountExportValue !== 'function') {
        throw new Error(`frontend lowered artifact probe missing export ${declarationCountExportName}`)
      }
      declarationCount = Number(declarationCountExportValue())
      if (!Number.isInteger(declarationCount) || declarationCount < 0) {
        throw new Error(`frontend lowered artifact probe returned an invalid declaration count for ${declarationCountExportName}`)
      }
      const expectedDeclarationCount = (loweredIRUnit.declarations ?? []).length
      if (declarationCount !== expectedDeclarationCount) {
        throw new Error('frontend lowered artifact probe declaration count did not match lowered ir manifest')
      }
      const declarationNameHashExportName = `tinygo_lowered_${symbolID}_declaration_name_hash`
      const declarationNameHashExportValue = exportsObject[declarationNameHashExportName]
      if (typeof declarationNameHashExportValue !== 'function') {
        throw new Error(`frontend lowered artifact probe missing export ${declarationNameHashExportName}`)
      }
      declarationNameHash = Number(declarationNameHashExportValue())
      if (!Number.isInteger(declarationNameHash) || declarationNameHash < 0) {
        throw new Error(`frontend lowered artifact probe returned an invalid declaration name hash for ${declarationNameHashExportName}`)
      }
      let expectedDeclarationNameHash = 0
      let declarationNameHashPosition = 1
      for (const declaration of loweredIRUnit.declarations ?? []) {
        const declarationName = declaration.name ?? ''
        if (declarationName === '') {
          continue
        }
        for (const byte of textEncoder.encode(declarationName)) {
          expectedDeclarationNameHash = (expectedDeclarationNameHash + (byte * declarationNameHashPosition)) >>> 0
          declarationNameHashPosition += 1
        }
        expectedDeclarationNameHash = (expectedDeclarationNameHash + (0x0a * declarationNameHashPosition)) >>> 0
        declarationNameHashPosition += 1
      }
      if (declarationNameHash !== expectedDeclarationNameHash) {
        throw new Error('frontend lowered artifact probe declaration name hash did not match lowered ir manifest')
      }
      const declarationSignatureHashExportName = `tinygo_lowered_${symbolID}_declaration_signature_hash`
      const declarationSignatureHashExportValue = exportsObject[declarationSignatureHashExportName]
      if (typeof declarationSignatureHashExportValue !== 'function') {
        throw new Error(`frontend lowered artifact probe missing export ${declarationSignatureHashExportName}`)
      }
      declarationSignatureHash = Number(declarationSignatureHashExportValue())
      if (!Number.isInteger(declarationSignatureHash) || declarationSignatureHash < 0) {
        throw new Error(`frontend lowered artifact probe returned an invalid declaration signature hash for ${declarationSignatureHashExportName}`)
      }
      let expectedDeclarationSignatureHash = 0
      let declarationSignatureHashPosition = 1
      for (const declaration of loweredIRUnit.declarations ?? []) {
        const declarationSignature = `${declaration.kind ?? ''}:${declaration.name ?? ''}:${declaration.exported ? '1' : '0'}:${declaration.method ? '1' : '0'}`
        for (const byte of textEncoder.encode(declarationSignature)) {
          expectedDeclarationSignatureHash = (expectedDeclarationSignatureHash + (byte * declarationSignatureHashPosition)) >>> 0
          declarationSignatureHashPosition += 1
        }
        expectedDeclarationSignatureHash = (expectedDeclarationSignatureHash + (0x0a * declarationSignatureHashPosition)) >>> 0
        declarationSignatureHashPosition += 1
      }
      if (declarationSignatureHash !== expectedDeclarationSignatureHash) {
        throw new Error('frontend lowered artifact probe declaration signature hash did not match lowered ir manifest')
      }
      const declarationKindHashExportName = `tinygo_lowered_${symbolID}_declaration_kind_hash`
      const declarationKindHashExportValue = exportsObject[declarationKindHashExportName]
      if (typeof declarationKindHashExportValue !== 'function') {
        throw new Error(`frontend lowered artifact probe missing export ${declarationKindHashExportName}`)
      }
      declarationKindHash = Number(declarationKindHashExportValue())
      if (!Number.isInteger(declarationKindHash) || declarationKindHash < 0) {
        throw new Error(`frontend lowered artifact probe returned an invalid declaration kind hash for ${declarationKindHashExportName}`)
      }
      let expectedDeclarationKindHash = 0
      let declarationKindHashPosition = 1
      for (const declaration of loweredIRUnit.declarations ?? []) {
        for (const byte of textEncoder.encode(declaration.kind ?? '')) {
          expectedDeclarationKindHash = (expectedDeclarationKindHash + (byte * declarationKindHashPosition)) >>> 0
          declarationKindHashPosition += 1
        }
        expectedDeclarationKindHash = (expectedDeclarationKindHash + (0x0a * declarationKindHashPosition)) >>> 0
        declarationKindHashPosition += 1
      }
      if (declarationKindHash !== expectedDeclarationKindHash) {
        throw new Error('frontend lowered artifact probe declaration kind hash did not match lowered ir manifest')
      }
      const declarationExportedCountExportName = `tinygo_lowered_${symbolID}_declaration_exported_count`
      const declarationExportedCountExportValue = exportsObject[declarationExportedCountExportName]
      if (typeof declarationExportedCountExportValue !== 'function') {
        throw new Error(`frontend lowered artifact probe missing export ${declarationExportedCountExportName}`)
      }
      declarationExportedCount = Number(declarationExportedCountExportValue())
      if (!Number.isInteger(declarationExportedCount) || declarationExportedCount < 0) {
        throw new Error(`frontend lowered artifact probe returned an invalid declaration exported count for ${declarationExportedCountExportName}`)
      }
      const expectedDeclarationExportedCount = (loweredIRUnit.declarations ?? []).filter((declaration) => declaration.exported).length
      if (declarationExportedCount !== expectedDeclarationExportedCount) {
        throw new Error('frontend lowered artifact probe declaration exported count did not match lowered ir manifest')
      }
      const declarationExportedNameHashExportName = `tinygo_lowered_${symbolID}_declaration_exported_name_hash`
      const declarationExportedNameHashExportValue = exportsObject[declarationExportedNameHashExportName]
      if (typeof declarationExportedNameHashExportValue !== 'function') {
        throw new Error(`frontend lowered artifact probe missing export ${declarationExportedNameHashExportName}`)
      }
      declarationExportedNameHash = Number(declarationExportedNameHashExportValue())
      if (!Number.isInteger(declarationExportedNameHash) || declarationExportedNameHash < 0) {
        throw new Error(`frontend lowered artifact probe returned an invalid declaration exported name hash for ${declarationExportedNameHashExportName}`)
      }
      let expectedDeclarationExportedNameHash = 0
      let declarationExportedNameHashPosition = 1
      for (const declaration of (loweredIRUnit.declarations ?? []).filter((candidate) => candidate.exported)) {
        const declarationName = declaration.name ?? ''
        if (declarationName === '') {
          continue
        }
        for (const byte of textEncoder.encode(declarationName)) {
          expectedDeclarationExportedNameHash = (expectedDeclarationExportedNameHash + (byte * declarationExportedNameHashPosition)) >>> 0
          declarationExportedNameHashPosition += 1
        }
        expectedDeclarationExportedNameHash = (expectedDeclarationExportedNameHash + (0x0a * declarationExportedNameHashPosition)) >>> 0
        declarationExportedNameHashPosition += 1
      }
      if (declarationExportedNameHash !== expectedDeclarationExportedNameHash) {
        throw new Error('frontend lowered artifact probe declaration exported name hash did not match lowered ir manifest')
      }
      const declarationExportedSignatureHashExportName = `tinygo_lowered_${symbolID}_declaration_exported_signature_hash`
      const declarationExportedSignatureHashExportValue = exportsObject[declarationExportedSignatureHashExportName]
      if (typeof declarationExportedSignatureHashExportValue !== 'function') {
        throw new Error(`frontend lowered artifact probe missing export ${declarationExportedSignatureHashExportName}`)
      }
      declarationExportedSignatureHash = Number(declarationExportedSignatureHashExportValue())
      if (!Number.isInteger(declarationExportedSignatureHash) || declarationExportedSignatureHash < 0) {
        throw new Error(`frontend lowered artifact probe returned an invalid declaration exported signature hash for ${declarationExportedSignatureHashExportName}`)
      }
      let expectedDeclarationExportedSignatureHash = 0
      let declarationExportedSignatureHashPosition = 1
      for (const declaration of (loweredIRUnit.declarations ?? []).filter((candidate) => candidate.exported)) {
        const declarationSignature = `${declaration.kind ?? ''}:${declaration.name ?? ''}:${declaration.exported ? '1' : '0'}:${declaration.method ? '1' : '0'}`
        for (const byte of textEncoder.encode(declarationSignature)) {
          expectedDeclarationExportedSignatureHash = (expectedDeclarationExportedSignatureHash + (byte * declarationExportedSignatureHashPosition)) >>> 0
          declarationExportedSignatureHashPosition += 1
        }
        expectedDeclarationExportedSignatureHash = (expectedDeclarationExportedSignatureHash + (0x0a * declarationExportedSignatureHashPosition)) >>> 0
        declarationExportedSignatureHashPosition += 1
      }
      if (declarationExportedSignatureHash !== expectedDeclarationExportedSignatureHash) {
        throw new Error('frontend lowered artifact probe declaration exported signature hash did not match lowered ir manifest')
      }
      const declarationExportedKindHashExportName = `tinygo_lowered_${symbolID}_declaration_exported_kind_hash`
      const declarationExportedKindHashExportValue = exportsObject[declarationExportedKindHashExportName]
      if (typeof declarationExportedKindHashExportValue !== 'function') {
        throw new Error(`frontend lowered artifact probe missing export ${declarationExportedKindHashExportName}`)
      }
      declarationExportedKindHash = Number(declarationExportedKindHashExportValue())
      if (!Number.isInteger(declarationExportedKindHash) || declarationExportedKindHash < 0) {
        throw new Error(`frontend lowered artifact probe returned an invalid declaration exported kind hash for ${declarationExportedKindHashExportName}`)
      }
      let expectedDeclarationExportedKindHash = 0
      let declarationExportedKindHashPosition = 1
      for (const declaration of (loweredIRUnit.declarations ?? []).filter((candidate) => candidate.exported)) {
        for (const byte of textEncoder.encode(declaration.kind ?? '')) {
          expectedDeclarationExportedKindHash = (expectedDeclarationExportedKindHash + (byte * declarationExportedKindHashPosition)) >>> 0
          declarationExportedKindHashPosition += 1
        }
        expectedDeclarationExportedKindHash = (expectedDeclarationExportedKindHash + (0x0a * declarationExportedKindHashPosition)) >>> 0
        declarationExportedKindHashPosition += 1
      }
      if (declarationExportedKindHash !== expectedDeclarationExportedKindHash) {
        throw new Error('frontend lowered artifact probe declaration exported kind hash did not match lowered ir manifest')
      }
      const declarationMethodCountExportName = `tinygo_lowered_${symbolID}_declaration_method_count`
      const declarationMethodCountExportValue = exportsObject[declarationMethodCountExportName]
      if (typeof declarationMethodCountExportValue !== 'function') {
        throw new Error(`frontend lowered artifact probe missing export ${declarationMethodCountExportName}`)
      }
      declarationMethodCount = Number(declarationMethodCountExportValue())
      if (!Number.isInteger(declarationMethodCount) || declarationMethodCount < 0) {
        throw new Error(`frontend lowered artifact probe returned an invalid declaration method count for ${declarationMethodCountExportName}`)
      }
      const expectedDeclarationMethodCount = (loweredIRUnit.declarations ?? []).filter((declaration) => declaration.method).length
      if (declarationMethodCount !== expectedDeclarationMethodCount) {
        throw new Error('frontend lowered artifact probe declaration method count did not match lowered ir manifest')
      }
      const declarationMethodNameHashExportName = `tinygo_lowered_${symbolID}_declaration_method_name_hash`
      const declarationMethodNameHashExportValue = exportsObject[declarationMethodNameHashExportName]
      if (typeof declarationMethodNameHashExportValue !== 'function') {
        throw new Error(`frontend lowered artifact probe missing export ${declarationMethodNameHashExportName}`)
      }
      declarationMethodNameHash = Number(declarationMethodNameHashExportValue())
      if (!Number.isInteger(declarationMethodNameHash) || declarationMethodNameHash < 0) {
        throw new Error(`frontend lowered artifact probe returned an invalid declaration method name hash for ${declarationMethodNameHashExportName}`)
      }
      let expectedDeclarationMethodNameHash = 0
      let declarationMethodNameHashPosition = 1
      for (const declaration of (loweredIRUnit.declarations ?? []).filter((candidate) => candidate.method)) {
        const declarationName = declaration.name ?? ''
        if (declarationName === '') {
          continue
        }
        for (const byte of textEncoder.encode(declarationName)) {
          expectedDeclarationMethodNameHash = (expectedDeclarationMethodNameHash + (byte * declarationMethodNameHashPosition)) >>> 0
          declarationMethodNameHashPosition += 1
        }
        expectedDeclarationMethodNameHash = (expectedDeclarationMethodNameHash + (0x0a * declarationMethodNameHashPosition)) >>> 0
        declarationMethodNameHashPosition += 1
      }
      if (declarationMethodNameHash !== expectedDeclarationMethodNameHash) {
        throw new Error('frontend lowered artifact probe declaration method name hash did not match lowered ir manifest')
      }
      const declarationMethodSignatureHashExportName = `tinygo_lowered_${symbolID}_declaration_method_signature_hash`
      const declarationMethodSignatureHashExportValue = exportsObject[declarationMethodSignatureHashExportName]
      if (typeof declarationMethodSignatureHashExportValue !== 'function') {
        throw new Error(`frontend lowered artifact probe missing export ${declarationMethodSignatureHashExportName}`)
      }
      declarationMethodSignatureHash = Number(declarationMethodSignatureHashExportValue())
      if (!Number.isInteger(declarationMethodSignatureHash) || declarationMethodSignatureHash < 0) {
        throw new Error(`frontend lowered artifact probe returned an invalid declaration method signature hash for ${declarationMethodSignatureHashExportName}`)
      }
      let expectedDeclarationMethodSignatureHash = 0
      let declarationMethodSignatureHashPosition = 1
      for (const declaration of (loweredIRUnit.declarations ?? []).filter((candidate) => candidate.method)) {
        const declarationSignature = `${declaration.kind ?? ''}:${declaration.name ?? ''}:${declaration.exported ? '1' : '0'}:${declaration.method ? '1' : '0'}`
        for (const byte of textEncoder.encode(declarationSignature)) {
          expectedDeclarationMethodSignatureHash = (expectedDeclarationMethodSignatureHash + (byte * declarationMethodSignatureHashPosition)) >>> 0
          declarationMethodSignatureHashPosition += 1
        }
        expectedDeclarationMethodSignatureHash = (expectedDeclarationMethodSignatureHash + (0x0a * declarationMethodSignatureHashPosition)) >>> 0
        declarationMethodSignatureHashPosition += 1
      }
      if (declarationMethodSignatureHash !== expectedDeclarationMethodSignatureHash) {
        throw new Error('frontend lowered artifact probe declaration method signature hash did not match lowered ir manifest')
      }
      const declarationMethodKindHashExportName = `tinygo_lowered_${symbolID}_declaration_method_kind_hash`
      const declarationMethodKindHashExportValue = exportsObject[declarationMethodKindHashExportName]
      if (typeof declarationMethodKindHashExportValue !== 'function') {
        throw new Error(`frontend lowered artifact probe missing export ${declarationMethodKindHashExportName}`)
      }
      declarationMethodKindHash = Number(declarationMethodKindHashExportValue())
      if (!Number.isInteger(declarationMethodKindHash) || declarationMethodKindHash < 0) {
        throw new Error(`frontend lowered artifact probe returned an invalid declaration method kind hash for ${declarationMethodKindHashExportName}`)
      }
      let expectedDeclarationMethodKindHash = 0
      let declarationMethodKindHashPosition = 1
      for (const declaration of (loweredIRUnit.declarations ?? []).filter((candidate) => candidate.method)) {
        for (const byte of textEncoder.encode(declaration.kind ?? '')) {
          expectedDeclarationMethodKindHash = (expectedDeclarationMethodKindHash + (byte * declarationMethodKindHashPosition)) >>> 0
          declarationMethodKindHashPosition += 1
        }
        expectedDeclarationMethodKindHash = (expectedDeclarationMethodKindHash + (0x0a * declarationMethodKindHashPosition)) >>> 0
        declarationMethodKindHashPosition += 1
      }
      if (declarationMethodKindHash !== expectedDeclarationMethodKindHash) {
        throw new Error('frontend lowered artifact probe declaration method kind hash did not match lowered ir manifest')
      }
    }
    const mainCountExportName = `tinygo_lowered_${symbolID}_main_count`
    const mainCountExportValue = exportsObject[mainCountExportName]
    if (typeof mainCountExportValue !== 'function') {
      throw new Error(`frontend lowered artifact probe missing export ${mainCountExportName}`)
    }
    const mainCount = Number(mainCountExportValue())
    if (!Number.isInteger(mainCount) || mainCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid main count for ${mainCountExportName}`)
    }
    const initCountExportName = `tinygo_lowered_${symbolID}_init_count`
    const initCountExportValue = exportsObject[initCountExportName]
    if (typeof initCountExportValue !== 'function') {
      throw new Error(`frontend lowered artifact probe missing export ${initCountExportName}`)
    }
    const initCount = Number(initCountExportValue())
    if (!Number.isInteger(initCount) || initCount < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid init count for ${initCountExportName}`)
    }
    let expectedMainCount = 0
    let expectedInitCount = 0
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      expectedMainCount += (sourceText.match(/^\s*func\s+main\s*\(/gm) ?? []).length
      expectedInitCount += (sourceText.match(/^\s*func\s+init\s*\(/gm) ?? []).length
    }
    if (mainCount !== expectedMainCount) {
      throw new Error('frontend lowered artifact probe main count did not match lowered sources manifest')
    }
    if (initCount !== expectedInitCount) {
      throw new Error('frontend lowered artifact probe init count did not match lowered sources manifest')
    }
    const functionNameHashExportName = `tinygo_lowered_${symbolID}_function_name_hash`
    const functionNameHashExportValue = exportsObject[functionNameHashExportName]
    let expectedFunctionNameHash = 0
    let functionNameHashPosition = 1
    for (const sourceFile of unit.sourceFiles) {
      const sourceText =
        typeof sourceFileContents[sourceFile] === 'string'
          ? sourceFileContents[sourceFile] as string
          : sourceFileContents[sourceFile] instanceof Uint8Array
            ? new TextDecoder().decode(sourceFileContents[sourceFile] as Uint8Array)
            : ''
      if (sourceText === '') {
        continue
      }
      for (const match of sourceText.matchAll(/^\s*func(?:\s*\([^)]*\))?\s+([A-Za-z_]\w*)(?:\s*\[[^\]]+\])?\s*\(/gm)) {
        for (const byte of textEncoder.encode(match[1])) {
          expectedFunctionNameHash = (expectedFunctionNameHash + (byte * functionNameHashPosition)) >>> 0
          functionNameHashPosition += 1
        }
        expectedFunctionNameHash = (expectedFunctionNameHash + (0x0a * functionNameHashPosition)) >>> 0
        functionNameHashPosition += 1
      }
    }
    const functionNameHash = typeof functionNameHashExportValue === 'function' ? Number(functionNameHashExportValue()) : expectedFunctionNameHash
    if (!Number.isInteger(functionNameHash) || functionNameHash < 0) {
      throw new Error(`frontend lowered artifact probe returned an invalid function name hash for ${functionNameHashExportName}`)
    }
    if (typeof functionNameHashExportValue === 'function' && functionNameHash !== expectedFunctionNameHash) {
      throw new Error('frontend lowered artifact probe function name hash did not match lowered sources manifest')
    }
    units.push({
      id: unit.id,
      exportName,
      sourceFileCount,
      kindTag,
      sourceHash,
      importCount,
      importPathHash,
      blankImportCount,
      dotImportCount,
      aliasedImportCount,
      functionCount,
      functionNameHash,
      funcLiteralCount,
      funcParameterCount,
      funcResultCount,
      variadicParameterCount,
      namedResultCount,
      typeParameterCount,
      genericFunctionCount,
      genericTypeCount,
      callExpressionCount,
      builtinCallCount,
      appendCallCount,
      lenCallCount,
      makeCallCount,
      capCallCount,
      copyCallCount,
      panicCallCount,
      recoverCallCount,
      newCallCount,
      deleteCallCount,
      compositeLiteralCount,
      selectorExpressionCount,
      selectorNameHash,
      indexExpressionCount,
      sliceExpressionCount,
      keyValueExpressionCount,
      typeAssertionCount,
      blankIdentifierCount,
      blankAssignmentTargetCount,
      unaryExpressionCount,
      binaryExpressionCount,
      sendStatementCount,
      receiveExpressionCount,
      assignStatementCount,
      defineStatementCount,
      incStatementCount,
      decStatementCount,
      returnStatementCount,
      goStatementCount,
      deferStatementCount,
      ifStatementCount,
      rangeStatementCount,
      switchStatementCount,
      typeSwitchStatementCount,
      typeSwitchCaseClauseCount,
      typeSwitchGuardNameHash,
      typeSwitchCaseTypeHash,
      selectStatementCount,
      switchCaseClauseCount,
      selectCommClauseCount,
      forStatementCount,
      breakStatementCount,
      breakLabelNameHash,
      continueStatementCount,
      continueLabelNameHash,
      labeledStatementCount,
      labelNameHash,
      gotoStatementCount,
      gotoLabelNameHash,
      fallthroughStatementCount,
      methodCount,
      methodNameHash,
      methodSignatureHash,
      exportedMethodNameHash,
      exportedMethodSignatureHash,
      exportedFunctionCount,
      exportedFunctionNameHash,
      typeCount,
      typeNameHash,
      exportedTypeCount,
      exportedTypeNameHash,
      structTypeCount,
      interfaceTypeCount,
      mapTypeCount,
      chanTypeCount,
      sendOnlyChanTypeCount,
      receiveOnlyChanTypeCount,
      arrayTypeCount,
      sliceTypeCount,
      pointerTypeCount,
      structFieldCount,
      embeddedStructFieldCount,
      taggedStructFieldCount,
      structFieldNameHash,
      structFieldTypeHash,
      embeddedStructFieldTypeHash,
      taggedStructFieldTagHash,
      interfaceMethodCount,
      interfaceMethodNameHash,
      interfaceMethodSignatureHash,
      embeddedInterfaceMethodCount,
      embeddedInterfaceMethodNameHash,
      constCount,
      constNameHash,
      varCount,
      varNameHash,
      exportedConstCount,
      exportedConstNameHash,
      exportedVarCount,
      exportedVarNameHash,
      declarationCount,
      declarationNameHash,
      declarationSignatureHash,
      declarationKindHash,
      declarationExportedCount,
      declarationExportedNameHash,
      declarationExportedSignatureHash,
      declarationExportedKindHash,
      declarationMethodCount,
      declarationMethodNameHash,
      declarationMethodSignatureHash,
      declarationMethodKindHash,
      placeholderBlockCount,
      placeholderBlockHash,
      placeholderBlockSignatureHash,
      placeholderBlockRuntimeHash,
      loweringBlockCount,
      loweringBlockHash,
      loweringBlockRuntimeHash,
      mainCount,
      initCount,
    })
  }
  return { units }
}

export const verifyTinyGoLoweredObjectFiles = (
  loweredArtifactManifest: TinyGoLoweredArtifactManifest,
  loweredObjectFiles: Array<{
    path: string
    bytes: string | Uint8Array
  }>,
): TinyGoLoweredObjectFileVerification => {
  if (!Array.isArray(loweredArtifactManifest.objectFiles)) {
    throw new Error('frontend lowered artifact manifest was missing normalized object files')
  }

  if (JSON.stringify(loweredArtifactManifest.objectFiles) !== JSON.stringify(loweredObjectFiles.map((file) => file.path))) {
    throw new Error('frontend lowered object files did not match lowered artifact manifest')
  }

  const objectFiles: TinyGoLoweredObjectFileVerification['objectFiles'] = []
  let totalBytes = 0
  const textEncoder = new TextEncoder()
  for (const loweredObjectFile of loweredObjectFiles) {
    const bytes = typeof loweredObjectFile.bytes === 'string' ? textEncoder.encode(loweredObjectFile.bytes) : loweredObjectFile.bytes
    if (
      bytes.byteLength < 4 ||
      bytes[0] !== 0x00 ||
      bytes[1] !== 0x61 ||
      bytes[2] !== 0x73 ||
      bytes[3] !== 0x6d
    ) {
      throw new Error('frontend lowered object file was not a wasm object')
    }
    totalBytes += bytes.byteLength
    objectFiles.push({
      path: loweredObjectFile.path,
      size: bytes.byteLength,
      format: 'wasm',
    })
  }
  return {
    objectFiles,
    totalBytes,
  }
}

export const verifyTinyGoLoweredBitcodeFiles = (
  expectedBitcodeOutputs: string[],
  loweredBitcodeFiles: Array<{
    path: string
    bytes: string | Uint8Array
  }>,
): TinyGoLoweredBitcodeFileVerification => {
  if (JSON.stringify(expectedBitcodeOutputs) !== JSON.stringify(loweredBitcodeFiles.map((file) => file.path))) {
    throw new Error('frontend lowered bitcode files did not match lowered bitcode outputs')
  }

  const textEncoder = new TextEncoder()
  const bitcodeFiles: TinyGoLoweredBitcodeFileVerification['bitcodeFiles'] = []
  let totalBytes = 0
  for (const loweredBitcodeFile of loweredBitcodeFiles) {
    const bytes = typeof loweredBitcodeFile.bytes === 'string' ? textEncoder.encode(loweredBitcodeFile.bytes) : loweredBitcodeFile.bytes
    if (
      bytes.byteLength < 4 ||
      bytes[0] !== 0x42 ||
      bytes[1] !== 0x43 ||
      bytes[2] !== 0xc0 ||
      bytes[3] !== 0xde
    ) {
      throw new Error('frontend lowered bitcode file was not llvm bitcode')
    }
    totalBytes += bytes.byteLength
    bitcodeFiles.push({
      path: loweredBitcodeFile.path,
      size: bytes.byteLength,
      format: 'llvm-bc',
    })
  }
  return {
    bitcodeFiles,
    totalBytes,
  }
}

export const verifyTinyGoFinalArtifactFile = (
  commandArtifactManifest: {
    artifactOutputPath?: string
  },
  finalArtifactFile: {
    path: string
    bytes: string | Uint8Array
  },
): TinyGoFinalArtifactFileVerification => {
  if (commandArtifactManifest.artifactOutputPath !== finalArtifactFile.path) {
    throw new Error('frontend final artifact path did not match command artifact manifest')
  }

  const textEncoder = new TextEncoder()
  const bytes = typeof finalArtifactFile.bytes === 'string' ? textEncoder.encode(finalArtifactFile.bytes) : finalArtifactFile.bytes
  if (
    bytes.byteLength < 4 ||
    bytes[0] !== 0x00 ||
    bytes[1] !== 0x61 ||
    bytes[2] !== 0x73 ||
    bytes[3] !== 0x6d
  ) {
    throw new Error('frontend final artifact was not a wasm binary')
  }

  return {
    path: finalArtifactFile.path,
    size: bytes.byteLength,
    format: 'wasm',
  }
}
