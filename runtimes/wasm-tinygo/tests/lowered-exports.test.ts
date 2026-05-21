import assert from 'node:assert/strict'
import test from 'node:test'
import {
  verifyTinyGoLoweredArtifactExports,
  verifyTinyGoFinalArtifactFile,
  verifyTinyGoLoweredBitcodeFiles,
  verifyTinyGoLoweredObjectFiles,
} from '../src/lowered-exports.ts'

const expectedSourceHash = (
  sourceFiles: string[],
  sourceFileContents: Record<string, string | Uint8Array> = {},
) => {
  const bytes = new TextEncoder()
  let hash = 0
  let position = 1
  for (const sourceFile of sourceFiles) {
    const sourceBytes =
      typeof sourceFileContents[sourceFile] === 'string'
        ? bytes.encode(sourceFileContents[sourceFile] as string)
        : sourceFileContents[sourceFile] instanceof Uint8Array
          ? sourceFileContents[sourceFile] as Uint8Array
          : bytes.encode(sourceFile)
    for (const byte of sourceBytes) {
      hash = (hash + (byte * position)) >>> 0
      position += 1
    }
    hash = (hash + (0x0a * position)) >>> 0
    position += 1
  }
  return hash
}

const expectedImportPathHash = (
  sourceFiles: string[],
  sourceFileContents: Record<string, string | Uint8Array> = {},
) => {
  let hash = 0
  let position = 1
  for (const sourceFile of sourceFiles) {
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
      importPaths.push(match[2])
  }
  for (const blockMatch of sourceText.matchAll(/^\s*import\s*\(([\s\S]*?)^\s*\)/gm)) {
      for (const importMatch of blockMatch[1].matchAll(/^\s*(?:(_|\.|[A-Za-z_]\w*)\s+)?"([^"]+)"/gm)) {
        importPaths.push(importMatch[2])
      }
    }
    for (const importPath of importPaths) {
      for (const byte of new TextEncoder().encode(importPath)) {
        hash = (hash + (byte * position)) >>> 0
        position += 1
      }
      hash = (hash + (0x0a * position)) >>> 0
      position += 1
    }
  }
  return hash
}

const expectedFunctionNameHash = (
  sourceFiles: string[],
  sourceFileContents: Record<string, string | Uint8Array> = {},
) => {
  let hash = 0
  let position = 1
  for (const sourceFile of sourceFiles) {
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
      for (const byte of new TextEncoder().encode(match[1])) {
        hash = (hash + (byte * position)) >>> 0
        position += 1
      }
      hash = (hash + (0x0a * position)) >>> 0
      position += 1
    }
  }
  return hash
}

const expectedMethodNameHash = (
  sourceFiles: string[],
  sourceFileContents: Record<string, string | Uint8Array> = {},
) => {
  let hash = 0
  let position = 1
  for (const sourceFile of sourceFiles) {
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
      for (const byte of new TextEncoder().encode(match[1])) {
        hash = (hash + (byte * position)) >>> 0
        position += 1
      }
      hash = (hash + (0x0a * position)) >>> 0
      position += 1
    }
  }
  return hash
}

const expectedMethodSignatureHash = (
  sourceFiles: string[],
  sourceFileContents: Record<string, string | Uint8Array> = {},
) => {
  let hash = 0
  let position = 1
  for (const sourceFile of sourceFiles) {
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
      for (const byte of new TextEncoder().encode(match[0].replace(/\s*\{$/, '').trim())) {
        hash = (hash + (byte * position)) >>> 0
        position += 1
      }
      hash = (hash + (0x0a * position)) >>> 0
      position += 1
    }
  }
  return hash
}

const expectedExportedMethodSignatureHash = (
  sourceFiles: string[],
  sourceFileContents: Record<string, string | Uint8Array> = {},
) => {
  let hash = 0
  let position = 1
  for (const sourceFile of sourceFiles) {
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
      for (const byte of new TextEncoder().encode(match[0].replace(/\s*\{$/, '').trim())) {
        hash = (hash + (byte * position)) >>> 0
        position += 1
      }
      hash = (hash + (0x0a * position)) >>> 0
      position += 1
    }
  }
  return hash
}

const expectedExportedMethodNameHash = (
  sourceFiles: string[],
  sourceFileContents: Record<string, string | Uint8Array> = {},
) => {
  let hash = 0
  let position = 1
  for (const sourceFile of sourceFiles) {
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
      for (const byte of new TextEncoder().encode(match[1])) {
        hash = (hash + (byte * position)) >>> 0
        position += 1
      }
      hash = (hash + (0x0a * position)) >>> 0
      position += 1
    }
  }
  return hash
}

const expectedExportedFunctionNameHash = (
  sourceFiles: string[],
  sourceFileContents: Record<string, string | Uint8Array> = {},
) => {
  let hash = 0
  let position = 1
  for (const sourceFile of sourceFiles) {
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
      for (const byte of new TextEncoder().encode(match[1])) {
        hash = (hash + (byte * position)) >>> 0
        position += 1
      }
      hash = (hash + (0x0a * position)) >>> 0
      position += 1
    }
  }
  return hash
}

const expectedDeclarationNameHash = (
  declarations: Array<{
    name?: string
  }>,
) => {
  let hash = 0
  let position = 1
  for (const declaration of declarations) {
    const name = declaration.name ?? ''
    if (name === '') {
      continue
    }
    for (const byte of new TextEncoder().encode(name)) {
      hash = (hash + (byte * position)) >>> 0
      position += 1
    }
    hash = (hash + (0x0a * position)) >>> 0
    position += 1
  }
  return hash
}

const expectedDeclarationSignatureHash = (
  declarations: Array<{
    kind?: string
    name?: string
    exported?: boolean
    method?: boolean
  }>,
) => {
  let hash = 0
  let position = 1
  for (const declaration of declarations) {
    const signature = `${declaration.kind ?? ''}:${declaration.name ?? ''}:${declaration.exported ? '1' : '0'}:${declaration.method ? '1' : '0'}`
    for (const byte of new TextEncoder().encode(signature)) {
      hash = (hash + (byte * position)) >>> 0
      position += 1
    }
    hash = (hash + (0x0a * position)) >>> 0
    position += 1
  }
  return hash
}

const expectedDeclarationKindHash = (
  declarations: Array<{
    kind?: string
  }>,
) => {
  let hash = 0
  let position = 1
  for (const declaration of declarations) {
    for (const byte of new TextEncoder().encode(declaration.kind ?? '')) {
      hash = (hash + (byte * position)) >>> 0
      position += 1
    }
    hash = (hash + (0x0a * position)) >>> 0
    position += 1
  }
  return hash
}

const expectedDeclarationExportedCount = (
  declarations: Array<{
    exported?: boolean
  }>,
) => declarations.filter((declaration) => declaration.exported).length

const expectedDeclarationExportedNameHash = (
  declarations: Array<{
    name?: string
    exported?: boolean
  }>,
) => expectedDeclarationNameHash(declarations.filter((declaration) => declaration.exported))

const expectedDeclarationExportedSignatureHash = (
  declarations: Array<{
    kind?: string
    name?: string
    exported?: boolean
    method?: boolean
  }>,
) => expectedDeclarationSignatureHash(declarations.filter((declaration) => declaration.exported))

const expectedDeclarationExportedKindHash = (
  declarations: Array<{
    kind?: string
    exported?: boolean
  }>,
) => expectedDeclarationKindHash(declarations.filter((declaration) => declaration.exported))

const expectedDeclarationMethodCount = (
  declarations: Array<{
    method?: boolean
  }>,
) => declarations.filter((declaration) => declaration.method).length

const expectedDeclarationMethodNameHash = (
  declarations: Array<{
    name?: string
    method?: boolean
  }>,
) => expectedDeclarationNameHash(declarations.filter((declaration) => declaration.method))

const expectedDeclarationMethodSignatureHash = (
  declarations: Array<{
    kind?: string
    name?: string
    exported?: boolean
    method?: boolean
  }>,
) => expectedDeclarationSignatureHash(declarations.filter((declaration) => declaration.method))

const expectedDeclarationMethodKindHash = (
  declarations: Array<{
    kind?: string
    method?: boolean
  }>,
) => expectedDeclarationKindHash(declarations.filter((declaration) => declaration.method))

const expectedPlaceholderBlockHash = (
  loweredUnit: {
    placeholderBlocks?: Array<{
      value?: string
    }>
    imports?: Array<{
      path?: string
      alias?: string
    }>
    functions?: Array<{
      name?: string
      method?: boolean
    }>
    declarations?: Array<{
      kind?: string
      name?: string
      method?: boolean
    }>
  },
) => {
  let hash = 0
  let position = 1
  if (Array.isArray(loweredUnit.placeholderBlocks)) {
    for (const placeholderBlock of loweredUnit.placeholderBlocks ?? []) {
      for (const byte of new TextEncoder().encode(placeholderBlock.value ?? '')) {
        hash = (hash + (byte * position)) >>> 0
        position += 1
      }
      hash = (hash + (0x0a * position)) >>> 0
      position += 1
    }
    return hash
  }
  for (const loweredImport of loweredUnit.imports ?? []) {
    const placeholderBlock =
      loweredImport.alias && loweredImport.alias !== ''
        ? `import:${loweredImport.alias}=${loweredImport.path ?? ''}`
        : `import:${loweredImport.path ?? ''}`
    for (const byte of new TextEncoder().encode(placeholderBlock)) {
      hash = (hash + (byte * position)) >>> 0
      position += 1
    }
    hash = (hash + (0x0a * position)) >>> 0
    position += 1
  }
  for (const loweredFunction of loweredUnit.functions ?? []) {
    const placeholderBlock = `${loweredFunction.method ? 'function' : 'function'}:${loweredFunction.name ?? ''}:${loweredFunction.exported ? '1' : '0'}:${loweredFunction.method ? '1' : '0'}:${loweredFunction.main ? '1' : '0'}:${loweredFunction.init ? '1' : '0'}:${loweredFunction.parameters ?? 0}:${loweredFunction.results ?? 0}`
    for (const byte of new TextEncoder().encode(placeholderBlock)) {
      hash = (hash + (byte * position)) >>> 0
      position += 1
    }
    hash = (hash + (0x0a * position)) >>> 0
    position += 1
  }
  for (const declaration of loweredUnit.declarations ?? []) {
    const placeholderBlock = `declaration:${declaration.kind ?? ''}:${declaration.name ?? ''}:${declaration.exported ? '1' : '0'}:${declaration.method ? '1' : '0'}`
    for (const byte of new TextEncoder().encode(placeholderBlock)) {
      hash = (hash + (byte * position)) >>> 0
      position += 1
    }
    hash = (hash + (0x0a * position)) >>> 0
    position += 1
  }
  return hash
}

const expectedPlaceholderBlockSignatureHash = (
  loweredUnit: {
    placeholderBlocks?: Array<{
      signature?: string
    }>
    imports?: Array<{
      path?: string
      alias?: string
    }>
    functions?: Array<{
      name?: string
      exported?: boolean
      method?: boolean
      main?: boolean
      init?: boolean
      parameters?: number
      results?: number
    }>
    declarations?: Array<{
      kind?: string
      name?: string
      exported?: boolean
      method?: boolean
    }>
  },
) => {
  let hash = 0
  let position = 1
  if (Array.isArray(loweredUnit.placeholderBlocks) && loweredUnit.placeholderBlocks.every((placeholderBlock) => typeof placeholderBlock.signature === 'string')) {
    for (const placeholderBlock of loweredUnit.placeholderBlocks ?? []) {
      for (const byte of new TextEncoder().encode(placeholderBlock.signature ?? '')) {
        hash = (hash + (byte * position)) >>> 0
        position += 1
      }
      hash = (hash + (0x0a * position)) >>> 0
      position += 1
    }
    return hash
  }
  for (const loweredImport of loweredUnit.imports ?? []) {
    const placeholderBlockSignature =
      loweredImport.alias && loweredImport.alias !== ''
        ? `${loweredImport.alias}=${loweredImport.path ?? ''}`
        : `${loweredImport.path ?? ''}`
    for (const byte of new TextEncoder().encode(placeholderBlockSignature)) {
      hash = (hash + (byte * position)) >>> 0
      position += 1
    }
    hash = (hash + (0x0a * position)) >>> 0
    position += 1
  }
  for (const loweredFunction of loweredUnit.functions ?? []) {
    const placeholderBlockSignature = `${loweredFunction.name ?? ''}:${loweredFunction.exported ? '1' : '0'}:${loweredFunction.method ? '1' : '0'}:${loweredFunction.main ? '1' : '0'}:${loweredFunction.init ? '1' : '0'}:${loweredFunction.parameters ?? 0}:${loweredFunction.results ?? 0}`
    for (const byte of new TextEncoder().encode(placeholderBlockSignature)) {
      hash = (hash + (byte * position)) >>> 0
      position += 1
    }
    hash = (hash + (0x0a * position)) >>> 0
    position += 1
  }
  for (const declaration of loweredUnit.declarations ?? []) {
    const placeholderBlockSignature = `${declaration.kind ?? ''}:${declaration.name ?? ''}:${declaration.exported ? '1' : '0'}:${declaration.method ? '1' : '0'}`
    for (const byte of new TextEncoder().encode(placeholderBlockSignature)) {
      hash = (hash + (byte * position)) >>> 0
      position += 1
    }
    hash = (hash + (0x0a * position)) >>> 0
    position += 1
  }
  return hash
}

const expectedLoweringBlockHash = (
  loweredUnit: {
    id?: string
    kind?: string
    packageName?: string
    sourceFiles?: string[]
    imports?: Array<{
      path?: string
      alias?: string
    }>
    functions?: Array<{
      name?: string
      exported?: boolean
      method?: boolean
      main?: boolean
      init?: boolean
      parameters?: number
      results?: number
    }>
    declarations?: Array<{
      kind?: string
      name?: string
      exported?: boolean
      method?: boolean
    }>
  },
) => {
  let hash = 0
  let position = 1
  for (const [loweredImportIndex, loweredImport] of (loweredUnit.imports ?? []).entries()) {
    const loweringBlock =
      `tinygo_lower_unit_begin("${loweredUnit.id ?? ''}", "${loweredUnit.kind ?? ''}", "${loweredUnit.packageName ?? ''}", ${(loweredUnit.sourceFiles ?? []).length});` +
      `tinygo_lower_import_begin();` +
      `tinygo_emit_import_index(${loweredImportIndex});` +
      `tinygo_emit_import_alias("${loweredImport.alias ?? ''}");` +
      `tinygo_emit_import_path("${loweredImport.path ?? ''}");` +
      `tinygo_emit_import_signature("${loweredImport.alias ? `${loweredImport.alias}=` : ''}${loweredImport.path ?? ''}");` +
      `tinygo_lower_import_end();` +
      `tinygo_lower_unit_end()`
    for (const byte of new TextEncoder().encode(loweringBlock)) {
      hash = (hash + (byte * position)) >>> 0
      position += 1
    }
    hash = (hash + (0x0a * position)) >>> 0
    position += 1
  }
  for (const [loweredFunctionIndex, loweredFunction] of (loweredUnit.functions ?? []).entries()) {
    const loweringBlock =
      `tinygo_lower_unit_begin("${loweredUnit.id ?? ''}", "${loweredUnit.kind ?? ''}", "${loweredUnit.packageName ?? ''}", ${(loweredUnit.sourceFiles ?? []).length});` +
      `tinygo_lower_function_begin("${loweredUnit.packageName ?? ''}", "${loweredFunction.name ?? ''}");` +
      `tinygo_emit_function_index(${loweredFunctionIndex});` +
      `tinygo_emit_function_flags(` +
      `${loweredFunction.exported ? '1' : '0'}, ` +
      `${loweredFunction.method ? '1' : '0'}, ` +
      `${loweredFunction.main ? '1' : '0'}, ` +
      `${loweredFunction.init ? '1' : '0'});` +
      `tinygo_emit_function_signature(${loweredFunction.parameters ?? 0}, ${loweredFunction.results ?? 0});` +
      `tinygo_emit_function_stream("${loweredFunction.name ?? ''}:${loweredFunction.exported ? '1' : '0'}:${loweredFunction.method ? '1' : '0'}:${loweredFunction.main ? '1' : '0'}:${loweredFunction.init ? '1' : '0'}:${loweredFunction.parameters ?? 0}:${loweredFunction.results ?? 0}");` +
      `tinygo_lower_function_end();` +
      `tinygo_lower_unit_end()`
    for (const byte of new TextEncoder().encode(loweringBlock)) {
      hash = (hash + (byte * position)) >>> 0
      position += 1
    }
    hash = (hash + (0x0a * position)) >>> 0
    position += 1
  }
  for (const [declarationIndex, declaration] of (loweredUnit.declarations ?? []).entries()) {
    const loweringBlock =
      `tinygo_lower_unit_begin("${loweredUnit.id ?? ''}", "${loweredUnit.kind ?? ''}", "${loweredUnit.packageName ?? ''}", ${(loweredUnit.sourceFiles ?? []).length});` +
      `tinygo_lower_declaration_begin("${loweredUnit.packageName ?? ''}", "${declaration.kind ?? ''}", "${declaration.name ?? ''}");` +
      `tinygo_emit_declaration_index(${declarationIndex});` +
      `tinygo_emit_declaration_flags(${declaration.exported ? '1' : '0'}, ${declaration.method ? '1' : '0'});` +
      `tinygo_emit_declaration_signature("${declaration.kind ?? ''}:${declaration.name ?? ''}:${declaration.exported ? '1' : '0'}:${declaration.method ? '1' : '0'}");` +
      `tinygo_lower_declaration_end();` +
      `tinygo_lower_unit_end()`
    for (const byte of new TextEncoder().encode(loweringBlock)) {
      hash = (hash + (byte * position)) >>> 0
      position += 1
    }
    hash = (hash + (0x0a * position)) >>> 0
    position += 1
  }
  return hash
}

const expectedTypeNameHash = (
  sourceFiles: string[],
  sourceFileContents: Record<string, string | Uint8Array> = {},
) => {
  let hash = 0
  let position = 1
  for (const sourceFile of sourceFiles) {
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
      for (const byte of new TextEncoder().encode(match[1])) {
        hash = (hash + (byte * position)) >>> 0
        position += 1
      }
      hash = (hash + (0x0a * position)) >>> 0
      position += 1
    }
  }
  return hash
}

const expectedExportedTypeNameHash = (
  sourceFiles: string[],
  sourceFileContents: Record<string, string | Uint8Array> = {},
) => {
  let hash = 0
  let position = 1
  for (const sourceFile of sourceFiles) {
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
      for (const byte of new TextEncoder().encode(match[1])) {
        hash = (hash + (byte * position)) >>> 0
        position += 1
      }
      hash = (hash + (0x0a * position)) >>> 0
      position += 1
    }
  }
  return hash
}

const expectedSelectorNameHash = (
  sourceFiles: string[],
  sourceFileContents: Record<string, string | Uint8Array> = {},
) => {
  let hash = 0
  let position = 1
  for (const sourceFile of sourceFiles) {
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
      for (const byte of new TextEncoder().encode(match[1])) {
        hash = (hash + (byte * position)) >>> 0
        position += 1
      }
      hash = (hash + (0x0a * position)) >>> 0
      position += 1
    }
  }
  return hash
}

const expectedLabelNameHash = (
  sourceFiles: string[],
  sourceFileContents: Record<string, string | Uint8Array> = {},
) => {
  let hash = 0
  let position = 1
  for (const sourceFile of sourceFiles) {
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
      for (const byte of new TextEncoder().encode(match[1])) {
        hash = (hash + (byte * position)) >>> 0
        position += 1
      }
      hash = (hash + (0x0a * position)) >>> 0
      position += 1
    }
  }
  return hash
}

const expectedGotoLabelNameHash = (
  sourceFiles: string[],
  sourceFileContents: Record<string, string | Uint8Array> = {},
) => {
  let hash = 0
  let position = 1
  for (const sourceFile of sourceFiles) {
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
      for (const byte of new TextEncoder().encode(match[1])) {
        hash = (hash + (byte * position)) >>> 0
        position += 1
      }
      hash = (hash + (0x0a * position)) >>> 0
      position += 1
    }
  }
  return hash
}

const expectedBreakLabelNameHash = (
  sourceFiles: string[],
  sourceFileContents: Record<string, string | Uint8Array> = {},
) => {
  let hash = 0
  let position = 1
  for (const sourceFile of sourceFiles) {
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
      for (const byte of new TextEncoder().encode(match[1])) {
        hash = (hash + (byte * position)) >>> 0
        position += 1
      }
      hash = (hash + (0x0a * position)) >>> 0
      position += 1
    }
  }
  return hash
}

const expectedContinueLabelNameHash = (
  sourceFiles: string[],
  sourceFileContents: Record<string, string | Uint8Array> = {},
) => {
  let hash = 0
  let position = 1
  for (const sourceFile of sourceFiles) {
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
      for (const byte of new TextEncoder().encode(match[1])) {
        hash = (hash + (byte * position)) >>> 0
        position += 1
      }
      hash = (hash + (0x0a * position)) >>> 0
      position += 1
    }
  }
  return hash
}

const expectedConstNameHash = (
  sourceFiles: string[],
  sourceFileContents: Record<string, string | Uint8Array> = {},
) => {
  let hash = 0
  let position = 1
  for (const sourceFile of sourceFiles) {
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
        for (const byte of new TextEncoder().encode(name)) {
          hash = (hash + (byte * position)) >>> 0
          position += 1
        }
        hash = (hash + (0x0a * position)) >>> 0
        position += 1
      }
    }
    for (const blockMatch of sourceText.matchAll(/^\s*const\s*\(([\s\S]*?)^\s*\)/gm)) {
      for (const line of blockMatch[1].split('\n').map((entry) => entry.trim()).filter((entry) => entry !== '')) {
        const nameMatch = line.match(/^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\b/)
        if (!nameMatch) {
          continue
        }
        for (const name of nameMatch[1].split(',').map((entry) => entry.trim()).filter((entry) => entry !== '')) {
          for (const byte of new TextEncoder().encode(name)) {
            hash = (hash + (byte * position)) >>> 0
            position += 1
          }
          hash = (hash + (0x0a * position)) >>> 0
          position += 1
        }
      }
    }
  }
  return hash
}

const expectedExportedConstNameHash = (
  sourceFiles: string[],
  sourceFileContents: Record<string, string | Uint8Array> = {},
) => {
  let hash = 0
  let position = 1
  for (const sourceFile of sourceFiles) {
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
        for (const byte of new TextEncoder().encode(name)) {
          hash = (hash + (byte * position)) >>> 0
          position += 1
        }
        hash = (hash + (0x0a * position)) >>> 0
        position += 1
      }
    }
    for (const blockMatch of sourceText.matchAll(/^\s*const\s*\(([\s\S]*?)^\s*\)/gm)) {
      for (const line of blockMatch[1].split('\n').map((entry) => entry.trim()).filter((entry) => entry !== '')) {
        const nameMatch = line.match(/^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\b/)
        if (!nameMatch) {
          continue
        }
        for (const name of nameMatch[1].split(',').map((entry) => entry.trim()).filter((entry) => /^[A-Z]\w*$/.test(entry))) {
          for (const byte of new TextEncoder().encode(name)) {
            hash = (hash + (byte * position)) >>> 0
            position += 1
          }
          hash = (hash + (0x0a * position)) >>> 0
          position += 1
        }
      }
    }
  }
  return hash
}

const expectedVarNameHash = (
  sourceFiles: string[],
  sourceFileContents: Record<string, string | Uint8Array> = {},
) => {
  let hash = 0
  let position = 1
  for (const sourceFile of sourceFiles) {
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
        for (const byte of new TextEncoder().encode(name)) {
          hash = (hash + (byte * position)) >>> 0
          position += 1
        }
        hash = (hash + (0x0a * position)) >>> 0
        position += 1
      }
    }
    for (const blockMatch of sourceText.matchAll(/^\s*var\s*\(([\s\S]*?)^\s*\)/gm)) {
      for (const line of blockMatch[1].split('\n').map((entry) => entry.trim()).filter((entry) => entry !== '')) {
        const nameMatch = line.match(/^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\b/)
        if (!nameMatch) {
          continue
        }
        for (const name of nameMatch[1].split(',').map((entry) => entry.trim()).filter((entry) => entry !== '')) {
          for (const byte of new TextEncoder().encode(name)) {
            hash = (hash + (byte * position)) >>> 0
            position += 1
          }
          hash = (hash + (0x0a * position)) >>> 0
          position += 1
        }
      }
    }
  }
  return hash
}

const expectedExportedVarNameHash = (
  sourceFiles: string[],
  sourceFileContents: Record<string, string | Uint8Array> = {},
) => {
  let hash = 0
  let position = 1
  for (const sourceFile of sourceFiles) {
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
        for (const byte of new TextEncoder().encode(name)) {
          hash = (hash + (byte * position)) >>> 0
          position += 1
        }
        hash = (hash + (0x0a * position)) >>> 0
        position += 1
      }
    }
    for (const blockMatch of sourceText.matchAll(/^\s*var\s*\(([\s\S]*?)^\s*\)/gm)) {
      for (const line of blockMatch[1].split('\n').map((entry) => entry.trim()).filter((entry) => entry !== '')) {
        const nameMatch = line.match(/^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\b/)
        if (!nameMatch) {
          continue
        }
        for (const name of nameMatch[1].split(',').map((entry) => entry.trim()).filter((entry) => /^[A-Z]\w*$/.test(entry))) {
          for (const byte of new TextEncoder().encode(name)) {
            hash = (hash + (byte * position)) >>> 0
            position += 1
          }
          hash = (hash + (0x0a * position)) >>> 0
          position += 1
        }
      }
    }
  }
  return hash
}

const expectedStructFieldNameHash = (
  sourceFiles: string[],
  sourceFileContents: Record<string, string | Uint8Array> = {},
) => {
  let hash = 0
  let position = 1
  for (const sourceFile of sourceFiles) {
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
        const fieldWithoutTag = field.replace(/\s+`[^`]*`\s*$/, '')
        if (!/\s/.test(fieldWithoutTag)) {
          continue
        }
        const namedFieldMatch = fieldWithoutTag.match(/^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s+/)
        if (!namedFieldMatch) {
          continue
        }
        for (const fieldName of namedFieldMatch[1].split(',').map((entry) => entry.trim()).filter((entry) => entry !== '')) {
          for (const byte of new TextEncoder().encode(fieldName)) {
            hash = (hash + (byte * position)) >>> 0
            position += 1
          }
          hash = (hash + (0x0a * position)) >>> 0
          position += 1
        }
      }
    }
  }
  return hash
}

const expectedStructFieldTypeHash = (
  sourceFiles: string[],
  sourceFileContents: Record<string, string | Uint8Array> = {},
) => {
  let hash = 0
  let position = 1
  for (const sourceFile of sourceFiles) {
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
        const fieldWithoutTag = field.replace(/\s+`[^`]*`\s*$/, '')
        if (!/\s/.test(fieldWithoutTag)) {
          continue
        }
        const namedFieldMatch = fieldWithoutTag.match(/^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s+(.+)$/)
        if (!namedFieldMatch) {
          continue
        }
        const fieldNames = namedFieldMatch[1].split(',').map((entry) => entry.trim()).filter((entry) => entry !== '')
        for (const _fieldName of fieldNames) {
          for (const byte of new TextEncoder().encode(namedFieldMatch[2])) {
            hash = (hash + (byte * position)) >>> 0
            position += 1
          }
          hash = (hash + (0x0a * position)) >>> 0
          position += 1
        }
      }
    }
  }
  return hash
}

const expectedEmbeddedStructFieldTypeHash = (
  sourceFiles: string[],
  sourceFileContents: Record<string, string | Uint8Array> = {},
) => {
  let hash = 0
  let position = 1
  for (const sourceFile of sourceFiles) {
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
        const fieldWithoutTag = field.replace(/\s+`[^`]*`\s*$/, '')
        if (/\s/.test(fieldWithoutTag)) {
          continue
        }
        for (const byte of new TextEncoder().encode(fieldWithoutTag)) {
          hash = (hash + (byte * position)) >>> 0
          position += 1
        }
        hash = (hash + (0x0a * position)) >>> 0
        position += 1
      }
    }
  }
  return hash
}

const expectedTaggedStructFieldTagHash = (
  sourceFiles: string[],
  sourceFileContents: Record<string, string | Uint8Array> = {},
) => {
  let hash = 0
  let position = 1
  for (const sourceFile of sourceFiles) {
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
        if (!tagMatch) {
          continue
        }
        for (const byte of new TextEncoder().encode(tagMatch[1])) {
          hash = (hash + (byte * position)) >>> 0
          position += 1
        }
        hash = (hash + (0x0a * position)) >>> 0
        position += 1
      }
    }
  }
  return hash
}

const expectedInterfaceMethodNameHash = (
  sourceFiles: string[],
  sourceFileContents: Record<string, string | Uint8Array> = {},
) => {
  let hash = 0
  let position = 1
  for (const sourceFile of sourceFiles) {
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
        const methodNameMatch = method.match(/^([A-Za-z_]\w*)\s*\(/)
        if (!methodNameMatch) {
          continue
        }
        for (const byte of new TextEncoder().encode(methodNameMatch[1])) {
          hash = (hash + (byte * position)) >>> 0
          position += 1
        }
        hash = (hash + (0x0a * position)) >>> 0
        position += 1
      }
    }
  }
  return hash
}

const expectedInterfaceMethodSignatureHash = (
  sourceFiles: string[],
  sourceFileContents: Record<string, string | Uint8Array> = {},
) => {
  let hash = 0
  let position = 1
  for (const sourceFile of sourceFiles) {
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
        const signatureStart = method.indexOf('(')
        if (signatureStart === -1) {
          continue
        }
        for (const byte of new TextEncoder().encode(method.slice(signatureStart).trim())) {
          hash = (hash + (byte * position)) >>> 0
          position += 1
        }
        hash = (hash + (0x0a * position)) >>> 0
        position += 1
      }
    }
  }
  return hash
}

const expectedEmbeddedInterfaceMethodNameHash = (
  sourceFiles: string[],
  sourceFileContents: Record<string, string | Uint8Array> = {},
) => {
  let hash = 0
  let position = 1
  for (const sourceFile of sourceFiles) {
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
        if (method.includes('(')) {
          continue
        }
        for (const byte of new TextEncoder().encode(method)) {
          hash = (hash + (byte * position)) >>> 0
          position += 1
        }
        hash = (hash + (0x0a * position)) >>> 0
        position += 1
      }
    }
  }
  return hash
}

test('verifyTinyGoLoweredArtifactExports accepts deterministic lowered source file count exports', () => {
  const programSourceFiles = ['/workspace/main.go']
  const sourceFileContents = {
    '/workspace/main.go': 'package main\nimport "fmt"\ntype App struct{ Name string }\ntype Service interface{ Run() }\nconst Version = 1\nvar Ready = true\nfunc (App) Serve() {}\nfunc Hello() { defer fmt.Println("bye"); if Ready { fmt.Println("hi") } }\nfunc Loop(items []int) { for range items {} }\nfunc Choose(value int) { switch value { case 1: case 2: default: } }\nfunc Await(ch chan int) { select { case <-ch: case <-ch: default: } }\nfunc pump(ch chan int) { ch <- 1; <-ch }\nfunc assignAll() { value := 1; value = value + 1 }\nfunc bump() { value := 1; value++; value-- }\nfunc exprs(ch chan int) int { value := -1; <-ch; return value + 2 }\nfunc grow(items []int) []int { return append(items, 1) }\nfunc sizes(items []int) int { buffer := make([]int, len(items)); return len(buffer) }\nfunc literals() { app := App{Name: "codex"}; _ = app.Name; fmt.Println(app.Name); app.Serve() }\nfunc access(items []int) int { _ = items[0]; return len(items[1:]) }\nfunc assertAny(value any) string { text, _ := value.(string); return text }\nfunc route(value int) {\nstart:\n\tswitch value {\n\tcase 0:\n\t\tgoto start\n\tcase 1:\n\t\tfallthrough\n\tdefault:\n\t}\n}\nfunc loopForever() { for { break } }\nfunc step() { for { continue } }\nfunc main() { go Hello(); Loop(nil); return }\n',
    '/working/.tinygo-root/src/fmt/print.go': 'package fmt\n',
    '/working/.tinygo-root/src/errors/errors.go': 'package errors\n',
  }
  const stdlibSourceFiles = [
    '/working/.tinygo-root/src/fmt/print.go',
    '/working/.tinygo-root/src/errors/errors.go',
  ]
  const loweredIRManifest = {
    units: [
      {
        id: 'program-000',
        declarations: [
          { kind: 'type', name: 'App', exported: true, method: false },
          { kind: 'type', name: 'Service', exported: true, method: false },
          { kind: 'const', name: 'Version', exported: true, method: false },
          { kind: 'var', name: 'Ready', exported: true, method: false },
          { kind: 'function', name: 'Serve', exported: true, method: true },
          { kind: 'function', name: 'Hello', exported: true, method: false },
          { kind: 'function', name: 'Loop', exported: true, method: false },
          { kind: 'function', name: 'Choose', exported: true, method: false },
          { kind: 'function', name: 'Await', exported: true, method: false },
          { kind: 'function', name: 'pump', exported: false, method: false },
          { kind: 'function', name: 'assignAll', exported: false, method: false },
          { kind: 'function', name: 'bump', exported: false, method: false },
          { kind: 'function', name: 'exprs', exported: false, method: false },
          { kind: 'function', name: 'grow', exported: false, method: false },
          { kind: 'function', name: 'sizes', exported: false, method: false },
          { kind: 'function', name: 'literals', exported: false, method: false },
          { kind: 'function', name: 'access', exported: false, method: false },
          { kind: 'function', name: 'assertAny', exported: false, method: false },
          { kind: 'function', name: 'route', exported: false, method: false },
          { kind: 'function', name: 'loopForever', exported: false, method: false },
          { kind: 'function', name: 'step', exported: false, method: false },
          { kind: 'function', name: 'main', exported: false, method: false },
        ],
      },
      {
        id: 'stdlib-000',
        declarations: [],
      },
    ],
  }
  const verification = verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(programSourceFiles, sourceFileContents),
      tinygo_lowered_program_000_import_count: () => 1,
      tinygo_lowered_program_000_import_path_hash: () => expectedImportPathHash(programSourceFiles, sourceFileContents),
      tinygo_lowered_program_000_blank_import_count: () => 0,
      tinygo_lowered_program_000_dot_import_count: () => 0,
      tinygo_lowered_program_000_aliased_import_count: () => 0,
      tinygo_lowered_program_000_function_count: () => 18,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(programSourceFiles, sourceFileContents),
      tinygo_lowered_program_000_func_literal_count: () => 0,
      tinygo_lowered_program_000_func_parameter_count: () => 10,
      tinygo_lowered_program_000_func_result_count: () => 5,
      tinygo_lowered_program_000_variadic_parameter_count: () => 0,
      tinygo_lowered_program_000_named_result_count: () => 0,
      tinygo_lowered_program_000_type_parameter_count: () => 0,
      tinygo_lowered_program_000_generic_function_count: () => 0,
      tinygo_lowered_program_000_generic_type_count: () => 0,
      tinygo_lowered_program_000_call_expression_count: () => 11,
      tinygo_lowered_program_000_builtin_call_count: () => 5,
      tinygo_lowered_program_000_append_call_count: () => 1,
      tinygo_lowered_program_000_len_call_count: () => 3,
      tinygo_lowered_program_000_make_call_count: () => 1,
      tinygo_lowered_program_000_cap_call_count: () => 0,
      tinygo_lowered_program_000_copy_call_count: () => 0,
      tinygo_lowered_program_000_panic_call_count: () => 0,
      tinygo_lowered_program_000_recover_call_count: () => 0,
      tinygo_lowered_program_000_new_call_count: () => 0,
      tinygo_lowered_program_000_delete_call_count: () => 0,
      tinygo_lowered_program_000_composite_literal_count: () => 1,
      tinygo_lowered_program_000_selector_expression_count: () => 6,
      tinygo_lowered_program_000_selector_name_hash: () => expectedSelectorNameHash(programSourceFiles, sourceFileContents),
      tinygo_lowered_program_000_index_expression_count: () => 1,
      tinygo_lowered_program_000_slice_expression_count: () => 1,
      tinygo_lowered_program_000_key_value_expression_count: () => 1,
      tinygo_lowered_program_000_type_assertion_count: () => 1,
      tinygo_lowered_program_000_blank_identifier_count: () => 3,
      tinygo_lowered_program_000_blank_assignment_target_count: () => 3,
      tinygo_lowered_program_000_unary_expression_count: () => 5,
      tinygo_lowered_program_000_binary_expression_count: () => 2,
      tinygo_lowered_program_000_send_statement_count: () => 1,
      tinygo_lowered_program_000_receive_expression_count: () => 4,
      tinygo_lowered_program_000_assign_statement_count: () => 9,
      tinygo_lowered_program_000_define_statement_count: () => 6,
      tinygo_lowered_program_000_inc_statement_count: () => 1,
      tinygo_lowered_program_000_dec_statement_count: () => 1,
      tinygo_lowered_program_000_return_statement_count: () => 6,
      tinygo_lowered_program_000_go_statement_count: () => 1,
      tinygo_lowered_program_000_defer_statement_count: () => 1,
      tinygo_lowered_program_000_if_statement_count: () => 1,
      tinygo_lowered_program_000_range_statement_count: () => 1,
      tinygo_lowered_program_000_switch_statement_count: () => 2,
      tinygo_lowered_program_000_type_switch_statement_count: () => 0,
      tinygo_lowered_program_000_type_switch_case_clause_count: () => 0,
      tinygo_lowered_program_000_type_switch_guard_name_hash: () => 0,
      tinygo_lowered_program_000_type_switch_case_type_hash: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 1,
      tinygo_lowered_program_000_switch_case_clause_count: () => 6,
      tinygo_lowered_program_000_select_comm_clause_count: () => 3,
      tinygo_lowered_program_000_for_statement_count: () => 2,
      tinygo_lowered_program_000_break_statement_count: () => 1,
      tinygo_lowered_program_000_break_label_name_hash: () => expectedBreakLabelNameHash(programSourceFiles, sourceFileContents),
      tinygo_lowered_program_000_continue_statement_count: () => 1,
      tinygo_lowered_program_000_continue_label_name_hash: () => expectedContinueLabelNameHash(programSourceFiles, sourceFileContents),
      tinygo_lowered_program_000_labeled_statement_count: () => 1,
      tinygo_lowered_program_000_label_name_hash: () => expectedLabelNameHash(programSourceFiles, sourceFileContents),
      tinygo_lowered_program_000_goto_statement_count: () => 1,
      tinygo_lowered_program_000_goto_label_name_hash: () => expectedGotoLabelNameHash(programSourceFiles, sourceFileContents),
      tinygo_lowered_program_000_fallthrough_statement_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 1,
      tinygo_lowered_program_000_method_name_hash: () => expectedMethodNameHash(programSourceFiles, sourceFileContents),
      tinygo_lowered_program_000_method_signature_hash: () => expectedMethodSignatureHash(programSourceFiles, sourceFileContents),
      tinygo_lowered_program_000_exported_method_name_hash: () => expectedExportedMethodNameHash(programSourceFiles, sourceFileContents),
      tinygo_lowered_program_000_exported_method_signature_hash: () => expectedExportedMethodSignatureHash(programSourceFiles, sourceFileContents),
      tinygo_lowered_program_000_exported_function_count: () => 4,
      tinygo_lowered_program_000_exported_function_name_hash: () => expectedExportedFunctionNameHash(programSourceFiles, sourceFileContents),
      tinygo_lowered_program_000_type_count: () => 2,
      tinygo_lowered_program_000_type_name_hash: () => expectedTypeNameHash(programSourceFiles, sourceFileContents),
      tinygo_lowered_program_000_exported_type_count: () => 2,
      tinygo_lowered_program_000_exported_type_name_hash: () => expectedExportedTypeNameHash(programSourceFiles, sourceFileContents),
      tinygo_lowered_program_000_struct_type_count: () => 1,
      tinygo_lowered_program_000_interface_type_count: () => 1,
      tinygo_lowered_program_000_map_type_count: () => 0,
      tinygo_lowered_program_000_chan_type_count: () => 3,
      tinygo_lowered_program_000_send_only_chan_type_count: () => 0,
      tinygo_lowered_program_000_receive_only_chan_type_count: () => 0,
      tinygo_lowered_program_000_array_type_count: () => 6,
      tinygo_lowered_program_000_slice_type_count: () => 6,
      tinygo_lowered_program_000_pointer_type_count: () => 0,
      tinygo_lowered_program_000_struct_field_count: () => 1,
      tinygo_lowered_program_000_embedded_struct_field_count: () => 0,
      tinygo_lowered_program_000_tagged_struct_field_count: () => 0,
      tinygo_lowered_program_000_struct_field_name_hash: () => expectedStructFieldNameHash(programSourceFiles, sourceFileContents),
      tinygo_lowered_program_000_struct_field_type_hash: () => expectedStructFieldTypeHash(programSourceFiles, sourceFileContents),
      tinygo_lowered_program_000_embedded_struct_field_type_hash: () => expectedEmbeddedStructFieldTypeHash(programSourceFiles, sourceFileContents),
      tinygo_lowered_program_000_interface_method_count: () => 1,
      tinygo_lowered_program_000_interface_method_name_hash: () => expectedInterfaceMethodNameHash(programSourceFiles, sourceFileContents),
      tinygo_lowered_program_000_interface_method_signature_hash: () => expectedInterfaceMethodSignatureHash(programSourceFiles, sourceFileContents),
      tinygo_lowered_program_000_const_count: () => 1,
      tinygo_lowered_program_000_const_name_hash: () => expectedConstNameHash(programSourceFiles, sourceFileContents),
      tinygo_lowered_program_000_var_count: () => 1,
      tinygo_lowered_program_000_var_name_hash: () => expectedVarNameHash(programSourceFiles, sourceFileContents),
      tinygo_lowered_program_000_exported_const_count: () => 1,
      tinygo_lowered_program_000_exported_const_name_hash: () => expectedExportedConstNameHash(programSourceFiles, sourceFileContents),
      tinygo_lowered_program_000_exported_var_count: () => 1,
      tinygo_lowered_program_000_exported_var_name_hash: () => expectedExportedVarNameHash(programSourceFiles, sourceFileContents),
      tinygo_lowered_program_000_declaration_count: () => loweredIRManifest.units[0].declarations.length,
      tinygo_lowered_program_000_declaration_name_hash: () => expectedDeclarationNameHash(loweredIRManifest.units[0].declarations),
      tinygo_lowered_program_000_declaration_signature_hash: () => expectedDeclarationSignatureHash(loweredIRManifest.units[0].declarations),
      tinygo_lowered_program_000_declaration_kind_hash: () => expectedDeclarationKindHash(loweredIRManifest.units[0].declarations),
      tinygo_lowered_program_000_declaration_exported_count: () => expectedDeclarationExportedCount(loweredIRManifest.units[0].declarations),
      tinygo_lowered_program_000_declaration_exported_name_hash: () => expectedDeclarationExportedNameHash(loweredIRManifest.units[0].declarations),
      tinygo_lowered_program_000_declaration_exported_signature_hash: () => expectedDeclarationExportedSignatureHash(loweredIRManifest.units[0].declarations),
      tinygo_lowered_program_000_declaration_exported_kind_hash: () => expectedDeclarationExportedKindHash(loweredIRManifest.units[0].declarations),
      tinygo_lowered_program_000_declaration_method_count: () => expectedDeclarationMethodCount(loweredIRManifest.units[0].declarations),
      tinygo_lowered_program_000_declaration_method_name_hash: () => expectedDeclarationMethodNameHash(loweredIRManifest.units[0].declarations),
      tinygo_lowered_program_000_declaration_method_signature_hash: () => expectedDeclarationMethodSignatureHash(loweredIRManifest.units[0].declarations),
      tinygo_lowered_program_000_declaration_method_kind_hash: () => expectedDeclarationMethodKindHash(loweredIRManifest.units[0].declarations),
      tinygo_lowered_program_000_placeholder_block_count: () => 41,
      tinygo_lowered_program_000_placeholder_block_hash: () => expectedPlaceholderBlockHash(loweredIRManifest.units[0]),
      tinygo_lowered_program_000_placeholder_block_signature_hash: () => expectedPlaceholderBlockSignatureHash(loweredIRManifest.units[0]),
      tinygo_lowered_program_000_placeholder_block_runtime_hash: () => expectedPlaceholderBlockHash(loweredIRManifest.units[0]),
      tinygo_lowered_program_000_lowering_block_count: () => 41,
      tinygo_lowered_program_000_lowering_block_hash: () => expectedLoweringBlockHash(loweredIRManifest.units[0]),
      tinygo_lowered_program_000_lowering_block_runtime_hash: () => expectedLoweringBlockHash(loweredIRManifest.units[0]),
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
      tinygo_lowered_stdlib_000_source_file_count: () => 2,
      tinygo_lowered_stdlib_000_kind_tag: () => 3,
      tinygo_lowered_stdlib_000_source_hash: () => expectedSourceHash(stdlibSourceFiles, sourceFileContents),
      tinygo_lowered_stdlib_000_import_count: () => 0,
      tinygo_lowered_stdlib_000_import_path_hash: () => expectedImportPathHash(stdlibSourceFiles, sourceFileContents),
      tinygo_lowered_stdlib_000_blank_import_count: () => 0,
      tinygo_lowered_stdlib_000_dot_import_count: () => 0,
      tinygo_lowered_stdlib_000_aliased_import_count: () => 0,
      tinygo_lowered_stdlib_000_function_count: () => 0,
      tinygo_lowered_stdlib_000_function_name_hash: () => 0,
      tinygo_lowered_stdlib_000_func_literal_count: () => 0,
      tinygo_lowered_stdlib_000_func_parameter_count: () => 0,
      tinygo_lowered_stdlib_000_func_result_count: () => 0,
      tinygo_lowered_stdlib_000_variadic_parameter_count: () => 0,
      tinygo_lowered_stdlib_000_named_result_count: () => 0,
      tinygo_lowered_stdlib_000_type_parameter_count: () => 0,
      tinygo_lowered_stdlib_000_generic_function_count: () => 0,
      tinygo_lowered_stdlib_000_generic_type_count: () => 0,
      tinygo_lowered_stdlib_000_call_expression_count: () => 0,
      tinygo_lowered_stdlib_000_builtin_call_count: () => 0,
      tinygo_lowered_stdlib_000_append_call_count: () => 0,
      tinygo_lowered_stdlib_000_len_call_count: () => 0,
      tinygo_lowered_stdlib_000_make_call_count: () => 0,
      tinygo_lowered_stdlib_000_cap_call_count: () => 0,
      tinygo_lowered_stdlib_000_copy_call_count: () => 0,
      tinygo_lowered_stdlib_000_panic_call_count: () => 0,
      tinygo_lowered_stdlib_000_recover_call_count: () => 0,
      tinygo_lowered_stdlib_000_new_call_count: () => 0,
      tinygo_lowered_stdlib_000_delete_call_count: () => 0,
      tinygo_lowered_stdlib_000_composite_literal_count: () => 0,
      tinygo_lowered_stdlib_000_selector_expression_count: () => 0,
      tinygo_lowered_stdlib_000_selector_name_hash: () => expectedSelectorNameHash(stdlibSourceFiles, sourceFileContents),
      tinygo_lowered_stdlib_000_index_expression_count: () => 0,
      tinygo_lowered_stdlib_000_slice_expression_count: () => 0,
      tinygo_lowered_stdlib_000_key_value_expression_count: () => 0,
      tinygo_lowered_stdlib_000_type_assertion_count: () => 0,
      tinygo_lowered_stdlib_000_blank_identifier_count: () => 0,
      tinygo_lowered_stdlib_000_blank_assignment_target_count: () => 0,
      tinygo_lowered_stdlib_000_unary_expression_count: () => 0,
      tinygo_lowered_stdlib_000_binary_expression_count: () => 0,
      tinygo_lowered_stdlib_000_send_statement_count: () => 0,
      tinygo_lowered_stdlib_000_receive_expression_count: () => 0,
      tinygo_lowered_stdlib_000_assign_statement_count: () => 0,
      tinygo_lowered_stdlib_000_define_statement_count: () => 0,
      tinygo_lowered_stdlib_000_inc_statement_count: () => 0,
      tinygo_lowered_stdlib_000_dec_statement_count: () => 0,
      tinygo_lowered_stdlib_000_return_statement_count: () => 0,
      tinygo_lowered_stdlib_000_go_statement_count: () => 0,
      tinygo_lowered_stdlib_000_defer_statement_count: () => 0,
      tinygo_lowered_stdlib_000_if_statement_count: () => 0,
      tinygo_lowered_stdlib_000_range_statement_count: () => 0,
      tinygo_lowered_stdlib_000_switch_statement_count: () => 0,
      tinygo_lowered_stdlib_000_type_switch_statement_count: () => 0,
      tinygo_lowered_stdlib_000_type_switch_case_clause_count: () => 0,
      tinygo_lowered_stdlib_000_type_switch_guard_name_hash: () => 0,
      tinygo_lowered_stdlib_000_type_switch_case_type_hash: () => 0,
      tinygo_lowered_stdlib_000_select_statement_count: () => 0,
      tinygo_lowered_stdlib_000_switch_case_clause_count: () => 0,
      tinygo_lowered_stdlib_000_select_comm_clause_count: () => 0,
      tinygo_lowered_stdlib_000_for_statement_count: () => 0,
      tinygo_lowered_stdlib_000_break_statement_count: () => 0,
      tinygo_lowered_stdlib_000_break_label_name_hash: () => expectedBreakLabelNameHash(stdlibSourceFiles, sourceFileContents),
      tinygo_lowered_stdlib_000_continue_statement_count: () => 0,
      tinygo_lowered_stdlib_000_continue_label_name_hash: () => expectedContinueLabelNameHash(stdlibSourceFiles, sourceFileContents),
      tinygo_lowered_stdlib_000_labeled_statement_count: () => 0,
      tinygo_lowered_stdlib_000_label_name_hash: () => expectedLabelNameHash(stdlibSourceFiles, sourceFileContents),
      tinygo_lowered_stdlib_000_goto_statement_count: () => 0,
      tinygo_lowered_stdlib_000_goto_label_name_hash: () => expectedGotoLabelNameHash(stdlibSourceFiles, sourceFileContents),
      tinygo_lowered_stdlib_000_fallthrough_statement_count: () => 0,
      tinygo_lowered_stdlib_000_method_count: () => 0,
      tinygo_lowered_stdlib_000_method_name_hash: () => expectedMethodNameHash(stdlibSourceFiles, sourceFileContents),
      tinygo_lowered_stdlib_000_method_signature_hash: () => expectedMethodSignatureHash(stdlibSourceFiles, sourceFileContents),
      tinygo_lowered_stdlib_000_exported_method_name_hash: () => expectedExportedMethodNameHash(stdlibSourceFiles, sourceFileContents),
      tinygo_lowered_stdlib_000_exported_method_signature_hash: () => expectedExportedMethodSignatureHash(stdlibSourceFiles, sourceFileContents),
      tinygo_lowered_stdlib_000_exported_function_count: () => 0,
      tinygo_lowered_stdlib_000_exported_function_name_hash: () => expectedExportedFunctionNameHash(stdlibSourceFiles, sourceFileContents),
      tinygo_lowered_stdlib_000_type_count: () => 0,
      tinygo_lowered_stdlib_000_type_name_hash: () => expectedTypeNameHash(stdlibSourceFiles, sourceFileContents),
      tinygo_lowered_stdlib_000_exported_type_count: () => 0,
      tinygo_lowered_stdlib_000_exported_type_name_hash: () => expectedExportedTypeNameHash(stdlibSourceFiles, sourceFileContents),
      tinygo_lowered_stdlib_000_struct_type_count: () => 0,
      tinygo_lowered_stdlib_000_interface_type_count: () => 0,
      tinygo_lowered_stdlib_000_map_type_count: () => 0,
      tinygo_lowered_stdlib_000_chan_type_count: () => 0,
      tinygo_lowered_stdlib_000_send_only_chan_type_count: () => 0,
      tinygo_lowered_stdlib_000_receive_only_chan_type_count: () => 0,
      tinygo_lowered_stdlib_000_array_type_count: () => 0,
      tinygo_lowered_stdlib_000_slice_type_count: () => 0,
      tinygo_lowered_stdlib_000_pointer_type_count: () => 0,
      tinygo_lowered_stdlib_000_struct_field_count: () => 0,
      tinygo_lowered_stdlib_000_embedded_struct_field_count: () => 0,
      tinygo_lowered_stdlib_000_tagged_struct_field_count: () => 0,
      tinygo_lowered_stdlib_000_struct_field_name_hash: () => expectedStructFieldNameHash(stdlibSourceFiles, sourceFileContents),
      tinygo_lowered_stdlib_000_struct_field_type_hash: () => expectedStructFieldTypeHash(stdlibSourceFiles, sourceFileContents),
      tinygo_lowered_stdlib_000_embedded_struct_field_type_hash: () => expectedEmbeddedStructFieldTypeHash(stdlibSourceFiles, sourceFileContents),
      tinygo_lowered_stdlib_000_interface_method_count: () => 0,
      tinygo_lowered_stdlib_000_interface_method_name_hash: () => expectedInterfaceMethodNameHash(stdlibSourceFiles, sourceFileContents),
      tinygo_lowered_stdlib_000_interface_method_signature_hash: () => expectedInterfaceMethodSignatureHash(stdlibSourceFiles, sourceFileContents),
      tinygo_lowered_stdlib_000_const_count: () => 0,
      tinygo_lowered_stdlib_000_const_name_hash: () => expectedConstNameHash(stdlibSourceFiles, sourceFileContents),
      tinygo_lowered_stdlib_000_var_count: () => 0,
      tinygo_lowered_stdlib_000_var_name_hash: () => expectedVarNameHash(stdlibSourceFiles, sourceFileContents),
      tinygo_lowered_stdlib_000_exported_const_count: () => 0,
      tinygo_lowered_stdlib_000_exported_const_name_hash: () => expectedExportedConstNameHash(stdlibSourceFiles, sourceFileContents),
      tinygo_lowered_stdlib_000_exported_var_count: () => 0,
      tinygo_lowered_stdlib_000_exported_var_name_hash: () => expectedExportedVarNameHash(stdlibSourceFiles, sourceFileContents),
      tinygo_lowered_stdlib_000_declaration_count: () => 0,
      tinygo_lowered_stdlib_000_declaration_name_hash: () => 0,
      tinygo_lowered_stdlib_000_declaration_signature_hash: () => 0,
      tinygo_lowered_stdlib_000_declaration_kind_hash: () => 0,
      tinygo_lowered_stdlib_000_declaration_exported_count: () => 0,
      tinygo_lowered_stdlib_000_declaration_exported_name_hash: () => 0,
      tinygo_lowered_stdlib_000_declaration_exported_signature_hash: () => 0,
      tinygo_lowered_stdlib_000_declaration_exported_kind_hash: () => 0,
      tinygo_lowered_stdlib_000_declaration_method_count: () => 0,
      tinygo_lowered_stdlib_000_declaration_method_name_hash: () => 0,
      tinygo_lowered_stdlib_000_declaration_method_signature_hash: () => 0,
      tinygo_lowered_stdlib_000_declaration_method_kind_hash: () => 0,
      tinygo_lowered_stdlib_000_placeholder_block_count: () => 0,
      tinygo_lowered_stdlib_000_placeholder_block_hash: () => expectedPlaceholderBlockHash(loweredIRManifest.units[1]),
      tinygo_lowered_stdlib_000_placeholder_block_signature_hash: () => expectedPlaceholderBlockSignatureHash(loweredIRManifest.units[1]),
      tinygo_lowered_stdlib_000_placeholder_block_runtime_hash: () => expectedPlaceholderBlockHash(loweredIRManifest.units[1]),
      tinygo_lowered_stdlib_000_lowering_block_count: () => 0,
      tinygo_lowered_stdlib_000_lowering_block_hash: () => expectedLoweringBlockHash(loweredIRManifest.units[1]),
      tinygo_lowered_stdlib_000_lowering_block_runtime_hash: () => expectedLoweringBlockHash(loweredIRManifest.units[1]),
      tinygo_lowered_stdlib_000_main_count: () => 0,
      tinygo_lowered_stdlib_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: programSourceFiles,
      },
      {
        id: 'stdlib-000',
        kind: 'stdlib',
        sourceFiles: stdlibSourceFiles,
      },
    ],
  }, sourceFileContents, loweredIRManifest)

  assert.deepEqual(verification.units, [
    {
      id: 'program-000',
      exportName: 'tinygo_lowered_program_000_source_file_count',
      sourceFileCount: 1,
      kindTag: 1,
      sourceHash: expectedSourceHash(programSourceFiles, sourceFileContents),
      importCount: 1,
      importPathHash: expectedImportPathHash(programSourceFiles, sourceFileContents),
      blankImportCount: 0,
      dotImportCount: 0,
      aliasedImportCount: 0,
      functionCount: 18,
      functionNameHash: expectedFunctionNameHash(programSourceFiles, sourceFileContents),
      funcLiteralCount: 0,
      funcParameterCount: 10,
      funcResultCount: 5,
      variadicParameterCount: 0,
      namedResultCount: 0,
      typeParameterCount: 0,
      genericFunctionCount: 0,
      genericTypeCount: 0,
      callExpressionCount: 11,
      builtinCallCount: 5,
      appendCallCount: 1,
      lenCallCount: 3,
      makeCallCount: 1,
      capCallCount: 0,
      copyCallCount: 0,
      panicCallCount: 0,
      recoverCallCount: 0,
      newCallCount: 0,
      deleteCallCount: 0,
      compositeLiteralCount: 1,
      selectorExpressionCount: 6,
      selectorNameHash: expectedSelectorNameHash(programSourceFiles, sourceFileContents),
      indexExpressionCount: 1,
      sliceExpressionCount: 1,
      keyValueExpressionCount: 1,
      typeAssertionCount: 1,
      blankIdentifierCount: 3,
      blankAssignmentTargetCount: 3,
      unaryExpressionCount: 5,
      binaryExpressionCount: 2,
      sendStatementCount: 1,
      receiveExpressionCount: 4,
      assignStatementCount: 9,
      defineStatementCount: 6,
      incStatementCount: 1,
      decStatementCount: 1,
      returnStatementCount: 6,
      goStatementCount: 1,
      deferStatementCount: 1,
      ifStatementCount: 1,
      rangeStatementCount: 1,
      switchStatementCount: 2,
      typeSwitchStatementCount: 0,
      typeSwitchCaseClauseCount: 0,
      typeSwitchGuardNameHash: 0,
      typeSwitchCaseTypeHash: 0,
      selectStatementCount: 1,
      switchCaseClauseCount: 6,
      selectCommClauseCount: 3,
      forStatementCount: 2,
      breakStatementCount: 1,
      breakLabelNameHash: expectedBreakLabelNameHash(programSourceFiles, sourceFileContents),
      continueStatementCount: 1,
      continueLabelNameHash: expectedContinueLabelNameHash(programSourceFiles, sourceFileContents),
      labeledStatementCount: 1,
      labelNameHash: expectedLabelNameHash(programSourceFiles, sourceFileContents),
      gotoStatementCount: 1,
      gotoLabelNameHash: expectedGotoLabelNameHash(programSourceFiles, sourceFileContents),
      fallthroughStatementCount: 1,
      methodCount: 1,
      methodNameHash: expectedMethodNameHash(programSourceFiles, sourceFileContents),
      methodSignatureHash: expectedMethodSignatureHash(programSourceFiles, sourceFileContents),
      exportedMethodNameHash: expectedExportedMethodNameHash(programSourceFiles, sourceFileContents),
      exportedMethodSignatureHash: expectedExportedMethodSignatureHash(programSourceFiles, sourceFileContents),
      exportedFunctionCount: 4,
      exportedFunctionNameHash: expectedExportedFunctionNameHash(programSourceFiles, sourceFileContents),
      typeCount: 2,
      typeNameHash: expectedTypeNameHash(programSourceFiles, sourceFileContents),
      exportedTypeCount: 2,
      exportedTypeNameHash: expectedExportedTypeNameHash(programSourceFiles, sourceFileContents),
      structTypeCount: 1,
      interfaceTypeCount: 1,
      mapTypeCount: 0,
      chanTypeCount: 3,
      sendOnlyChanTypeCount: 0,
      receiveOnlyChanTypeCount: 0,
      arrayTypeCount: 6,
      sliceTypeCount: 6,
      pointerTypeCount: 0,
      structFieldCount: 1,
      embeddedStructFieldCount: 0,
      taggedStructFieldCount: 0,
      structFieldNameHash: expectedStructFieldNameHash(programSourceFiles, sourceFileContents),
      structFieldTypeHash: expectedStructFieldTypeHash(programSourceFiles, sourceFileContents),
      embeddedStructFieldTypeHash: expectedEmbeddedStructFieldTypeHash(programSourceFiles, sourceFileContents),
      taggedStructFieldTagHash: expectedTaggedStructFieldTagHash(programSourceFiles, sourceFileContents),
      interfaceMethodCount: 1,
      interfaceMethodNameHash: expectedInterfaceMethodNameHash(programSourceFiles, sourceFileContents),
      interfaceMethodSignatureHash: expectedInterfaceMethodSignatureHash(programSourceFiles, sourceFileContents),
      embeddedInterfaceMethodNameHash: expectedEmbeddedInterfaceMethodNameHash(programSourceFiles, sourceFileContents),
      embeddedInterfaceMethodCount: 0,
      constCount: 1,
      constNameHash: expectedConstNameHash(programSourceFiles, sourceFileContents),
      varCount: 1,
      varNameHash: expectedVarNameHash(programSourceFiles, sourceFileContents),
      exportedConstCount: 1,
      exportedConstNameHash: expectedExportedConstNameHash(programSourceFiles, sourceFileContents),
      exportedVarCount: 1,
      exportedVarNameHash: expectedExportedVarNameHash(programSourceFiles, sourceFileContents),
      declarationCount: loweredIRManifest.units[0].declarations.length,
      declarationNameHash: expectedDeclarationNameHash(loweredIRManifest.units[0].declarations),
      declarationSignatureHash: expectedDeclarationSignatureHash(loweredIRManifest.units[0].declarations),
      declarationKindHash: expectedDeclarationKindHash(loweredIRManifest.units[0].declarations),
      declarationExportedCount: expectedDeclarationExportedCount(loweredIRManifest.units[0].declarations),
      declarationExportedNameHash: expectedDeclarationExportedNameHash(loweredIRManifest.units[0].declarations),
      declarationExportedSignatureHash: expectedDeclarationExportedSignatureHash(loweredIRManifest.units[0].declarations),
      declarationExportedKindHash: expectedDeclarationExportedKindHash(loweredIRManifest.units[0].declarations),
      declarationMethodCount: expectedDeclarationMethodCount(loweredIRManifest.units[0].declarations),
      declarationMethodNameHash: expectedDeclarationMethodNameHash(loweredIRManifest.units[0].declarations),
      declarationMethodSignatureHash: expectedDeclarationMethodSignatureHash(loweredIRManifest.units[0].declarations),
      declarationMethodKindHash: expectedDeclarationMethodKindHash(loweredIRManifest.units[0].declarations),
      placeholderBlockCount: 41,
      placeholderBlockHash: expectedPlaceholderBlockHash(loweredIRManifest.units[0]),
      placeholderBlockSignatureHash: expectedPlaceholderBlockSignatureHash(loweredIRManifest.units[0]),
      placeholderBlockRuntimeHash: expectedPlaceholderBlockHash(loweredIRManifest.units[0]),
      loweringBlockCount: 41,
      loweringBlockHash: expectedLoweringBlockHash(loweredIRManifest.units[0]),
      loweringBlockRuntimeHash: expectedLoweringBlockHash(loweredIRManifest.units[0]),
      mainCount: 1,
      initCount: 0,
    },
    {
      id: 'stdlib-000',
      exportName: 'tinygo_lowered_stdlib_000_source_file_count',
      sourceFileCount: 2,
      kindTag: 3,
      sourceHash: expectedSourceHash(stdlibSourceFiles, sourceFileContents),
      importCount: 0,
      importPathHash: expectedImportPathHash(stdlibSourceFiles, sourceFileContents),
      blankImportCount: 0,
      dotImportCount: 0,
      aliasedImportCount: 0,
      functionCount: 0,
      functionNameHash: 0,
      funcLiteralCount: 0,
      funcParameterCount: 0,
      funcResultCount: 0,
      variadicParameterCount: 0,
      namedResultCount: 0,
      typeParameterCount: 0,
      genericFunctionCount: 0,
      genericTypeCount: 0,
      callExpressionCount: 0,
      builtinCallCount: 0,
      appendCallCount: 0,
      lenCallCount: 0,
      makeCallCount: 0,
      capCallCount: 0,
      copyCallCount: 0,
      panicCallCount: 0,
      recoverCallCount: 0,
      newCallCount: 0,
      deleteCallCount: 0,
      compositeLiteralCount: 0,
      selectorExpressionCount: 0,
      selectorNameHash: expectedSelectorNameHash(stdlibSourceFiles, sourceFileContents),
      indexExpressionCount: 0,
      sliceExpressionCount: 0,
      keyValueExpressionCount: 0,
      typeAssertionCount: 0,
      blankIdentifierCount: 0,
      blankAssignmentTargetCount: 0,
      unaryExpressionCount: 0,
      binaryExpressionCount: 0,
      sendStatementCount: 0,
      receiveExpressionCount: 0,
      assignStatementCount: 0,
      defineStatementCount: 0,
      incStatementCount: 0,
      decStatementCount: 0,
      returnStatementCount: 0,
      goStatementCount: 0,
      deferStatementCount: 0,
      ifStatementCount: 0,
      rangeStatementCount: 0,
      switchStatementCount: 0,
      typeSwitchStatementCount: 0,
      typeSwitchCaseClauseCount: 0,
      typeSwitchGuardNameHash: 0,
      typeSwitchCaseTypeHash: 0,
      selectStatementCount: 0,
      switchCaseClauseCount: 0,
      selectCommClauseCount: 0,
      forStatementCount: 0,
      breakStatementCount: 0,
      breakLabelNameHash: expectedBreakLabelNameHash(stdlibSourceFiles, sourceFileContents),
      continueStatementCount: 0,
      continueLabelNameHash: expectedContinueLabelNameHash(stdlibSourceFiles, sourceFileContents),
      labeledStatementCount: 0,
      labelNameHash: expectedLabelNameHash(stdlibSourceFiles, sourceFileContents),
      gotoStatementCount: 0,
      gotoLabelNameHash: expectedGotoLabelNameHash(stdlibSourceFiles, sourceFileContents),
      fallthroughStatementCount: 0,
      methodCount: 0,
      methodNameHash: expectedMethodNameHash(stdlibSourceFiles, sourceFileContents),
      methodSignatureHash: expectedMethodSignatureHash(stdlibSourceFiles, sourceFileContents),
      exportedMethodNameHash: expectedExportedMethodNameHash(stdlibSourceFiles, sourceFileContents),
      exportedMethodSignatureHash: expectedExportedMethodSignatureHash(stdlibSourceFiles, sourceFileContents),
      exportedFunctionCount: 0,
      exportedFunctionNameHash: expectedExportedFunctionNameHash(stdlibSourceFiles, sourceFileContents),
      typeCount: 0,
      typeNameHash: expectedTypeNameHash(stdlibSourceFiles, sourceFileContents),
      exportedTypeCount: 0,
      exportedTypeNameHash: expectedExportedTypeNameHash(stdlibSourceFiles, sourceFileContents),
      structTypeCount: 0,
      interfaceTypeCount: 0,
      mapTypeCount: 0,
      chanTypeCount: 0,
      sendOnlyChanTypeCount: 0,
      receiveOnlyChanTypeCount: 0,
      arrayTypeCount: 0,
      sliceTypeCount: 0,
      pointerTypeCount: 0,
      structFieldCount: 0,
      embeddedStructFieldCount: 0,
      taggedStructFieldCount: 0,
      structFieldNameHash: expectedStructFieldNameHash(stdlibSourceFiles, sourceFileContents),
      structFieldTypeHash: expectedStructFieldTypeHash(stdlibSourceFiles, sourceFileContents),
      embeddedStructFieldTypeHash: expectedEmbeddedStructFieldTypeHash(stdlibSourceFiles, sourceFileContents),
      taggedStructFieldTagHash: expectedTaggedStructFieldTagHash(stdlibSourceFiles, sourceFileContents),
      interfaceMethodCount: 0,
      interfaceMethodNameHash: expectedInterfaceMethodNameHash(stdlibSourceFiles, sourceFileContents),
      interfaceMethodSignatureHash: expectedInterfaceMethodSignatureHash(stdlibSourceFiles, sourceFileContents),
      embeddedInterfaceMethodNameHash: expectedEmbeddedInterfaceMethodNameHash(stdlibSourceFiles, sourceFileContents),
      embeddedInterfaceMethodCount: 0,
      constCount: 0,
      constNameHash: expectedConstNameHash(stdlibSourceFiles, sourceFileContents),
      varCount: 0,
      varNameHash: expectedVarNameHash(stdlibSourceFiles, sourceFileContents),
      exportedConstCount: 0,
      exportedConstNameHash: expectedExportedConstNameHash(stdlibSourceFiles, sourceFileContents),
      exportedVarCount: 0,
      exportedVarNameHash: expectedExportedVarNameHash(stdlibSourceFiles, sourceFileContents),
      declarationCount: 0,
      declarationNameHash: 0,
      declarationSignatureHash: 0,
      declarationKindHash: 0,
      declarationExportedCount: 0,
      declarationExportedNameHash: 0,
      declarationExportedSignatureHash: 0,
      declarationExportedKindHash: 0,
      declarationMethodCount: 0,
      declarationMethodNameHash: 0,
      declarationMethodSignatureHash: 0,
      declarationMethodKindHash: 0,
      placeholderBlockCount: 0,
      placeholderBlockHash: expectedPlaceholderBlockHash(loweredIRManifest.units[1]),
      placeholderBlockSignatureHash: expectedPlaceholderBlockSignatureHash(loweredIRManifest.units[1]),
      placeholderBlockRuntimeHash: expectedPlaceholderBlockHash(loweredIRManifest.units[1]),
      loweringBlockCount: 0,
      loweringBlockHash: expectedLoweringBlockHash(loweredIRManifest.units[1]),
      loweringBlockRuntimeHash: expectedLoweringBlockHash(loweredIRManifest.units[1]),
      mainCount: 0,
      initCount: 0,
    },
  ])
})

test('verifyTinyGoLoweredArtifactExports rejects missing lowered source file count exports', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {},
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }), /frontend lowered artifact probe missing export tinygo_lowered_program_000_source_file_count/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered source file count exports', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 2,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go']),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }), /frontend lowered artifact probe did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered kind tags', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_imported_000_source_file_count: () => 1,
      tinygo_lowered_imported_000_kind_tag: () => 1,
      tinygo_lowered_imported_000_source_hash: () => expectedSourceHash(['/workspace/lib/helper.go']),
      tinygo_lowered_imported_000_import_count: () => 0,
      tinygo_lowered_imported_000_import_path_hash: () => 0,
      tinygo_lowered_imported_000_function_count: () => 0,
      tinygo_lowered_imported_000_method_count: () => 0,
      tinygo_lowered_imported_000_exported_function_count: () => 0,
      tinygo_lowered_imported_000_type_count: () => 0,
      tinygo_lowered_imported_000_exported_type_count: () => 0,
      tinygo_lowered_imported_000_struct_type_count: () => 0,
      tinygo_lowered_imported_000_interface_type_count: () => 0,
      tinygo_lowered_imported_000_const_count: () => 0,
      tinygo_lowered_imported_000_var_count: () => 0,
      tinygo_lowered_imported_000_exported_const_count: () => 0,
      tinygo_lowered_imported_000_exported_var_count: () => 0,
      tinygo_lowered_imported_000_main_count: () => 0,
      tinygo_lowered_imported_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'imported-000',
        kind: 'imported',
        sourceFiles: ['/workspace/lib/helper.go'],
      },
    ],
  }), /frontend lowered artifact probe kind tag did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered source hashes', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => 0,
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }), /frontend lowered artifact probe source hash did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered import path hashes', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nimport "fmt"\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 1,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nimport "fmt"\nfunc main() {}\n',
  }), /frontend lowered artifact probe import path hash did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered blank import counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nimport (\n\t_ "unsafe"\n\t. "fmt"\n)\nfunc main() { Println("hi") }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 2,
      tinygo_lowered_program_000_import_path_hash: () => expectedImportPathHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nimport (\n\t_ "unsafe"\n\t. "fmt"\n)\nfunc main() { Println("hi") }\n',
      }),
      tinygo_lowered_program_000_blank_import_count: () => 0,
      tinygo_lowered_program_000_dot_import_count: () => 1,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nimport (\n\t_ "unsafe"\n\t. "fmt"\n)\nfunc main() { Println("hi") }\n',
  }), /frontend lowered artifact probe blank import count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered dot import counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nimport (\n\t_ "unsafe"\n\t. "fmt"\n)\nfunc main() { Println("hi") }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 2,
      tinygo_lowered_program_000_import_path_hash: () => expectedImportPathHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nimport (\n\t_ "unsafe"\n\t. "fmt"\n)\nfunc main() { Println("hi") }\n',
      }),
      tinygo_lowered_program_000_blank_import_count: () => 1,
      tinygo_lowered_program_000_dot_import_count: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nimport (\n\t_ "unsafe"\n\t. "fmt"\n)\nfunc main() { Println("hi") }\n',
  }), /frontend lowered artifact probe dot import count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered aliased import counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nimport ioalias "io"\nfunc main(reader ioalias.Reader) { _ = reader }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 1,
      tinygo_lowered_program_000_import_path_hash: () => expectedImportPathHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nimport ioalias "io"\nfunc main(reader ioalias.Reader) { _ = reader }\n',
      }),
      tinygo_lowered_program_000_blank_import_count: () => 0,
      tinygo_lowered_program_000_dot_import_count: () => 0,
      tinygo_lowered_program_000_aliased_import_count: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nimport ioalias "io"\nfunc main(reader ioalias.Reader) { _ = reader }\n',
  }), /frontend lowered artifact probe aliased import count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered function counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc main() {}\n',
  }), /frontend lowered artifact probe function count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered function name hashes', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc Hello() {}\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 2,
      tinygo_lowered_program_000_function_name_hash: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 1,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc Hello() {}\nfunc main() {}\n',
  }), /frontend lowered artifact probe function name hash did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered func literal counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc main() { _ = func(value int) int { return value + 1 } }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc main() { _ = func(value int) int { return value + 1 } }\n',
      }),
      tinygo_lowered_program_000_func_literal_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc main() { _ = func(value int) int { return value + 1 } }\n',
  }), /frontend lowered artifact probe func literal count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered func parameter counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc add(a int, b string) (int, error) { return 0, nil }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc add(a int, b string) (int, error) { return 0, nil }\n',
      }),
      tinygo_lowered_program_000_func_literal_count: () => 0,
      tinygo_lowered_program_000_func_parameter_count: () => 1,
      tinygo_lowered_program_000_func_result_count: () => 2,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc add(a int, b string) (int, error) { return 0, nil }\n',
  }), /frontend lowered artifact probe func parameter count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered func result counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc add(a int, b string) (int, error) { return 0, nil }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc add(a int, b string) (int, error) { return 0, nil }\n',
      }),
      tinygo_lowered_program_000_func_literal_count: () => 0,
      tinygo_lowered_program_000_func_parameter_count: () => 2,
      tinygo_lowered_program_000_func_result_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc add(a int, b string) (int, error) { return 0, nil }\n',
  }), /frontend lowered artifact probe func result count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered variadic parameter counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc add(prefix string, values ...int) { _ = prefix; _ = values }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc add(prefix string, values ...int) { _ = prefix; _ = values }\n',
      }),
      tinygo_lowered_program_000_func_literal_count: () => 0,
      tinygo_lowered_program_000_func_parameter_count: () => 2,
      tinygo_lowered_program_000_func_result_count: () => 0,
      tinygo_lowered_program_000_variadic_parameter_count: () => 0,
      tinygo_lowered_program_000_named_result_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc add(prefix string, values ...int) { _ = prefix; _ = values }\n',
  }), /frontend lowered artifact probe variadic parameter count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered named result counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc add() (total int, err error) { return 0, nil }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc add() (total int, err error) { return 0, nil }\n',
      }),
      tinygo_lowered_program_000_func_literal_count: () => 0,
      tinygo_lowered_program_000_func_parameter_count: () => 0,
      tinygo_lowered_program_000_func_result_count: () => 2,
      tinygo_lowered_program_000_variadic_parameter_count: () => 0,
      tinygo_lowered_program_000_named_result_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc add() (total int, err error) { return 0, nil }\n',
  }), /frontend lowered artifact probe named result count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered type parameter counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype Box[T any, U comparable] struct{ Left T; Right U }\nfunc Convert[A any, B any](in A) B { var zero B; return zero }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype Box[T any, U comparable] struct{ Left T; Right U }\nfunc Convert[A any, B any](in A) B { var zero B; return zero }\n',
      }),
      tinygo_lowered_program_000_func_literal_count: () => 0,
      tinygo_lowered_program_000_func_parameter_count: () => 1,
      tinygo_lowered_program_000_func_result_count: () => 1,
      tinygo_lowered_program_000_variadic_parameter_count: () => 0,
      tinygo_lowered_program_000_named_result_count: () => 0,
      tinygo_lowered_program_000_type_parameter_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 1,
      tinygo_lowered_program_000_type_count: () => 1,
      tinygo_lowered_program_000_exported_type_count: () => 1,
      tinygo_lowered_program_000_struct_type_count: () => 1,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 1,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\ntype Box[T any, U comparable] struct{ Left T; Right U }\nfunc Convert[A any, B any](in A) B { var zero B; return zero }\n',
  }), /frontend lowered artifact probe type parameter count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered generic function counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc Convert[A any, B any](in A) B { var zero B; return zero }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc Convert[A any, B any](in A) B { var zero B; return zero }\n',
      }),
      tinygo_lowered_program_000_func_literal_count: () => 0,
      tinygo_lowered_program_000_func_parameter_count: () => 1,
      tinygo_lowered_program_000_func_result_count: () => 1,
      tinygo_lowered_program_000_variadic_parameter_count: () => 0,
      tinygo_lowered_program_000_named_result_count: () => 0,
      tinygo_lowered_program_000_type_parameter_count: () => 2,
      tinygo_lowered_program_000_generic_function_count: () => 0,
      tinygo_lowered_program_000_generic_type_count: () => 0,
      tinygo_lowered_program_000_call_expression_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 1,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 1,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc Convert[A any, B any](in A) B { var zero B; return zero }\n',
  }), /frontend lowered artifact probe generic function count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered generic type counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype Box[T any, U comparable] struct{ Left T; Right U }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 0,
      tinygo_lowered_program_000_function_name_hash: () => 0,
      tinygo_lowered_program_000_func_literal_count: () => 0,
      tinygo_lowered_program_000_func_parameter_count: () => 0,
      tinygo_lowered_program_000_func_result_count: () => 0,
      tinygo_lowered_program_000_variadic_parameter_count: () => 0,
      tinygo_lowered_program_000_named_result_count: () => 0,
      tinygo_lowered_program_000_type_parameter_count: () => 2,
      tinygo_lowered_program_000_generic_function_count: () => 0,
      tinygo_lowered_program_000_generic_type_count: () => 0,
      tinygo_lowered_program_000_call_expression_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 1,
      tinygo_lowered_program_000_exported_type_count: () => 1,
      tinygo_lowered_program_000_struct_type_count: () => 1,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\ntype Box[T any, U comparable] struct{ Left T; Right U }\n',
  }), /frontend lowered artifact probe generic type count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered call expression counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nimport "fmt"\nfunc Hello() { fmt.Println("hi") }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 1,
      tinygo_lowered_program_000_import_path_hash: () => expectedImportPathHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nimport "fmt"\nfunc Hello() { fmt.Println("hi") }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_function_count: () => 2,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nimport "fmt"\nfunc Hello() { fmt.Println("hi") }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 1,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nimport "fmt"\nfunc Hello() { fmt.Println("hi") }\nfunc main() {}\n',
  }), /frontend lowered artifact probe call expression count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered send statement counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc pump(ch chan int) { ch <- 1; <-ch }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc pump(ch chan int) { ch <- 1; <-ch }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 0,
      tinygo_lowered_program_000_send_statement_count: () => 0,
      tinygo_lowered_program_000_receive_expression_count: () => 1,
      tinygo_lowered_program_000_return_statement_count: () => 0,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 0,
      tinygo_lowered_program_000_switch_case_clause_count: () => 0,
      tinygo_lowered_program_000_select_comm_clause_count: () => 0,
      tinygo_lowered_program_000_for_statement_count: () => 0,
      tinygo_lowered_program_000_break_statement_count: () => 0,
      tinygo_lowered_program_000_continue_statement_count: () => 0,
      tinygo_lowered_program_000_labeled_statement_count: () => 0,
      tinygo_lowered_program_000_goto_statement_count: () => 0,
      tinygo_lowered_program_000_fallthrough_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_struct_field_count: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc pump(ch chan int) { ch <- 1; <-ch }\n',
  }), /frontend lowered artifact probe send statement count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered receive expression counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc pump(ch chan int) { ch <- 1; <-ch }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc pump(ch chan int) { ch <- 1; <-ch }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 0,
      tinygo_lowered_program_000_send_statement_count: () => 1,
      tinygo_lowered_program_000_receive_expression_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 0,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 0,
      tinygo_lowered_program_000_switch_case_clause_count: () => 0,
      tinygo_lowered_program_000_select_comm_clause_count: () => 0,
      tinygo_lowered_program_000_for_statement_count: () => 0,
      tinygo_lowered_program_000_break_statement_count: () => 0,
      tinygo_lowered_program_000_continue_statement_count: () => 0,
      tinygo_lowered_program_000_labeled_statement_count: () => 0,
      tinygo_lowered_program_000_goto_statement_count: () => 0,
      tinygo_lowered_program_000_fallthrough_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_struct_field_count: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc pump(ch chan int) { ch <- 1; <-ch }\n',
  }), /frontend lowered artifact probe receive expression count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered assign statement counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc assignAll() { value := 1; value = value + 1 }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc assignAll() { value := 1; value = value + 1 }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 0,
      tinygo_lowered_program_000_send_statement_count: () => 0,
      tinygo_lowered_program_000_receive_expression_count: () => 0,
      tinygo_lowered_program_000_assign_statement_count: () => 0,
      tinygo_lowered_program_000_define_statement_count: () => 1,
      tinygo_lowered_program_000_return_statement_count: () => 0,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 0,
      tinygo_lowered_program_000_switch_case_clause_count: () => 0,
      tinygo_lowered_program_000_select_comm_clause_count: () => 0,
      tinygo_lowered_program_000_for_statement_count: () => 0,
      tinygo_lowered_program_000_break_statement_count: () => 0,
      tinygo_lowered_program_000_continue_statement_count: () => 0,
      tinygo_lowered_program_000_labeled_statement_count: () => 0,
      tinygo_lowered_program_000_goto_statement_count: () => 0,
      tinygo_lowered_program_000_fallthrough_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_struct_field_count: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc assignAll() { value := 1; value = value + 1 }\n',
  }), /frontend lowered artifact probe assign statement count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports ignores string literal equals signs when checking assign statement counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc main() { print("factorial_plus_bonus=") }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc main() { print("factorial_plus_bonus=") }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 1,
      tinygo_lowered_program_000_builtin_call_count: () => 1,
      tinygo_lowered_program_000_assign_statement_count: () => 0,
      tinygo_lowered_program_000_define_statement_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc main() { print("factorial_plus_bonus=") }\n',
  }), /frontend lowered artifact probe missing export tinygo_lowered_program_000_struct_type_count/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered define statement counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc assignAll() { value := 1; value = value + 1 }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc assignAll() { value := 1; value = value + 1 }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 0,
      tinygo_lowered_program_000_send_statement_count: () => 0,
      tinygo_lowered_program_000_receive_expression_count: () => 0,
      tinygo_lowered_program_000_assign_statement_count: () => 2,
      tinygo_lowered_program_000_define_statement_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 0,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 0,
      tinygo_lowered_program_000_switch_case_clause_count: () => 0,
      tinygo_lowered_program_000_select_comm_clause_count: () => 0,
      tinygo_lowered_program_000_for_statement_count: () => 0,
      tinygo_lowered_program_000_break_statement_count: () => 0,
      tinygo_lowered_program_000_continue_statement_count: () => 0,
      tinygo_lowered_program_000_labeled_statement_count: () => 0,
      tinygo_lowered_program_000_goto_statement_count: () => 0,
      tinygo_lowered_program_000_fallthrough_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_struct_field_count: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc assignAll() { value := 1; value = value + 1 }\n',
  }), /frontend lowered artifact probe define statement count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered increment statement counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc bump() { value := 1; value++; value-- }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc bump() { value := 1; value++; value-- }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 0,
      tinygo_lowered_program_000_send_statement_count: () => 0,
      tinygo_lowered_program_000_receive_expression_count: () => 0,
      tinygo_lowered_program_000_assign_statement_count: () => 1,
      tinygo_lowered_program_000_define_statement_count: () => 1,
      tinygo_lowered_program_000_inc_statement_count: () => 0,
      tinygo_lowered_program_000_dec_statement_count: () => 1,
      tinygo_lowered_program_000_return_statement_count: () => 0,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 0,
      tinygo_lowered_program_000_switch_case_clause_count: () => 0,
      tinygo_lowered_program_000_select_comm_clause_count: () => 0,
      tinygo_lowered_program_000_for_statement_count: () => 0,
      tinygo_lowered_program_000_break_statement_count: () => 0,
      tinygo_lowered_program_000_continue_statement_count: () => 0,
      tinygo_lowered_program_000_labeled_statement_count: () => 0,
      tinygo_lowered_program_000_goto_statement_count: () => 0,
      tinygo_lowered_program_000_fallthrough_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_struct_field_count: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc bump() { value := 1; value++; value-- }\n',
  }), /frontend lowered artifact probe increment statement count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered decrement statement counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc bump() { value := 1; value++; value-- }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc bump() { value := 1; value++; value-- }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 0,
      tinygo_lowered_program_000_send_statement_count: () => 0,
      tinygo_lowered_program_000_receive_expression_count: () => 0,
      tinygo_lowered_program_000_assign_statement_count: () => 1,
      tinygo_lowered_program_000_define_statement_count: () => 1,
      tinygo_lowered_program_000_inc_statement_count: () => 1,
      tinygo_lowered_program_000_dec_statement_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 0,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 0,
      tinygo_lowered_program_000_switch_case_clause_count: () => 0,
      tinygo_lowered_program_000_select_comm_clause_count: () => 0,
      tinygo_lowered_program_000_for_statement_count: () => 0,
      tinygo_lowered_program_000_break_statement_count: () => 0,
      tinygo_lowered_program_000_continue_statement_count: () => 0,
      tinygo_lowered_program_000_labeled_statement_count: () => 0,
      tinygo_lowered_program_000_goto_statement_count: () => 0,
      tinygo_lowered_program_000_fallthrough_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_struct_field_count: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc bump() { value := 1; value++; value-- }\n',
  }), /frontend lowered artifact probe decrement statement count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered unary expression counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc exprs(ch chan int) int { value := -1; <-ch; return value + 2 }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc exprs(ch chan int) int { value := -1; <-ch; return value + 2 }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 0,
      tinygo_lowered_program_000_unary_expression_count: () => 1,
      tinygo_lowered_program_000_binary_expression_count: () => 0,
      tinygo_lowered_program_000_send_statement_count: () => 0,
      tinygo_lowered_program_000_receive_expression_count: () => 1,
      tinygo_lowered_program_000_assign_statement_count: () => 1,
      tinygo_lowered_program_000_define_statement_count: () => 1,
      tinygo_lowered_program_000_inc_statement_count: () => 0,
      tinygo_lowered_program_000_dec_statement_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 1,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 0,
      tinygo_lowered_program_000_switch_case_clause_count: () => 0,
      tinygo_lowered_program_000_select_comm_clause_count: () => 0,
      tinygo_lowered_program_000_for_statement_count: () => 0,
      tinygo_lowered_program_000_break_statement_count: () => 0,
      tinygo_lowered_program_000_continue_statement_count: () => 0,
      tinygo_lowered_program_000_labeled_statement_count: () => 0,
      tinygo_lowered_program_000_goto_statement_count: () => 0,
      tinygo_lowered_program_000_fallthrough_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_struct_field_count: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc exprs(ch chan int) int { value := -1; <-ch; return value + 2 }\n',
  }), /frontend lowered artifact probe unary expression count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered binary expression counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc exprs(ch chan int) int { value := -1; <-ch; return value + 2 }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc exprs(ch chan int) int { value := -1; <-ch; return value + 2 }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 0,
      tinygo_lowered_program_000_unary_expression_count: () => 2,
      tinygo_lowered_program_000_binary_expression_count: () => 2,
      tinygo_lowered_program_000_send_statement_count: () => 0,
      tinygo_lowered_program_000_receive_expression_count: () => 1,
      tinygo_lowered_program_000_assign_statement_count: () => 1,
      tinygo_lowered_program_000_define_statement_count: () => 1,
      tinygo_lowered_program_000_inc_statement_count: () => 0,
      tinygo_lowered_program_000_dec_statement_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 1,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 0,
      tinygo_lowered_program_000_switch_case_clause_count: () => 0,
      tinygo_lowered_program_000_select_comm_clause_count: () => 0,
      tinygo_lowered_program_000_for_statement_count: () => 0,
      tinygo_lowered_program_000_break_statement_count: () => 0,
      tinygo_lowered_program_000_continue_statement_count: () => 0,
      tinygo_lowered_program_000_labeled_statement_count: () => 0,
      tinygo_lowered_program_000_goto_statement_count: () => 0,
      tinygo_lowered_program_000_fallthrough_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_struct_field_count: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc exprs(ch chan int) int { value := -1; <-ch; return value + 2 }\n',
  }), /frontend lowered artifact probe binary expression count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered builtin call counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc grow(items []int) []int { return append(items, 1) }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc grow(items []int) []int { return append(items, 1) }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 1,
      tinygo_lowered_program_000_builtin_call_count: () => 0,
      tinygo_lowered_program_000_append_call_count: () => 1,
      tinygo_lowered_program_000_unary_expression_count: () => 0,
      tinygo_lowered_program_000_binary_expression_count: () => 1,
      tinygo_lowered_program_000_send_statement_count: () => 0,
      tinygo_lowered_program_000_receive_expression_count: () => 0,
      tinygo_lowered_program_000_assign_statement_count: () => 0,
      tinygo_lowered_program_000_define_statement_count: () => 0,
      tinygo_lowered_program_000_inc_statement_count: () => 0,
      tinygo_lowered_program_000_dec_statement_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 1,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 0,
      tinygo_lowered_program_000_switch_case_clause_count: () => 0,
      tinygo_lowered_program_000_select_comm_clause_count: () => 0,
      tinygo_lowered_program_000_for_statement_count: () => 0,
      tinygo_lowered_program_000_break_statement_count: () => 0,
      tinygo_lowered_program_000_continue_statement_count: () => 0,
      tinygo_lowered_program_000_labeled_statement_count: () => 0,
      tinygo_lowered_program_000_goto_statement_count: () => 0,
      tinygo_lowered_program_000_fallthrough_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_struct_field_count: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc grow(items []int) []int { return append(items, 1) }\n',
  }), /frontend lowered artifact probe builtin call count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered append call counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc grow(items []int) []int { return append(items, 1) }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc grow(items []int) []int { return append(items, 1) }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 1,
      tinygo_lowered_program_000_builtin_call_count: () => 1,
      tinygo_lowered_program_000_append_call_count: () => 0,
      tinygo_lowered_program_000_unary_expression_count: () => 0,
      tinygo_lowered_program_000_binary_expression_count: () => 0,
      tinygo_lowered_program_000_send_statement_count: () => 0,
      tinygo_lowered_program_000_receive_expression_count: () => 0,
      tinygo_lowered_program_000_assign_statement_count: () => 0,
      tinygo_lowered_program_000_define_statement_count: () => 0,
      tinygo_lowered_program_000_inc_statement_count: () => 0,
      tinygo_lowered_program_000_dec_statement_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 1,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 0,
      tinygo_lowered_program_000_switch_case_clause_count: () => 0,
      tinygo_lowered_program_000_select_comm_clause_count: () => 0,
      tinygo_lowered_program_000_for_statement_count: () => 0,
      tinygo_lowered_program_000_break_statement_count: () => 0,
      tinygo_lowered_program_000_continue_statement_count: () => 0,
      tinygo_lowered_program_000_labeled_statement_count: () => 0,
      tinygo_lowered_program_000_goto_statement_count: () => 0,
      tinygo_lowered_program_000_fallthrough_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_struct_field_count: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc grow(items []int) []int { return append(items, 1) }\n',
  }), /frontend lowered artifact probe append call count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered len call counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc sizes(items []int) int { buffer := make([]int, len(items)); return len(buffer) }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc sizes(items []int) int { buffer := make([]int, len(items)); return len(buffer) }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 3,
      tinygo_lowered_program_000_builtin_call_count: () => 3,
      tinygo_lowered_program_000_append_call_count: () => 0,
      tinygo_lowered_program_000_len_call_count: () => 1,
      tinygo_lowered_program_000_make_call_count: () => 1,
      tinygo_lowered_program_000_unary_expression_count: () => 0,
      tinygo_lowered_program_000_binary_expression_count: () => 0,
      tinygo_lowered_program_000_send_statement_count: () => 0,
      tinygo_lowered_program_000_receive_expression_count: () => 0,
      tinygo_lowered_program_000_assign_statement_count: () => 1,
      tinygo_lowered_program_000_define_statement_count: () => 1,
      tinygo_lowered_program_000_inc_statement_count: () => 0,
      tinygo_lowered_program_000_dec_statement_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 1,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 0,
      tinygo_lowered_program_000_switch_case_clause_count: () => 0,
      tinygo_lowered_program_000_select_comm_clause_count: () => 0,
      tinygo_lowered_program_000_for_statement_count: () => 0,
      tinygo_lowered_program_000_break_statement_count: () => 0,
      tinygo_lowered_program_000_continue_statement_count: () => 0,
      tinygo_lowered_program_000_labeled_statement_count: () => 0,
      tinygo_lowered_program_000_goto_statement_count: () => 0,
      tinygo_lowered_program_000_fallthrough_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_struct_field_count: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc sizes(items []int) int { buffer := make([]int, len(items)); return len(buffer) }\n',
  }), /frontend lowered artifact probe len call count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered make call counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc sizes(items []int) int { buffer := make([]int, len(items)); return len(buffer) }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc sizes(items []int) int { buffer := make([]int, len(items)); return len(buffer) }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 3,
      tinygo_lowered_program_000_builtin_call_count: () => 3,
      tinygo_lowered_program_000_append_call_count: () => 0,
      tinygo_lowered_program_000_len_call_count: () => 2,
      tinygo_lowered_program_000_make_call_count: () => 0,
      tinygo_lowered_program_000_unary_expression_count: () => 0,
      tinygo_lowered_program_000_binary_expression_count: () => 0,
      tinygo_lowered_program_000_send_statement_count: () => 0,
      tinygo_lowered_program_000_receive_expression_count: () => 0,
      tinygo_lowered_program_000_assign_statement_count: () => 1,
      tinygo_lowered_program_000_define_statement_count: () => 1,
      tinygo_lowered_program_000_inc_statement_count: () => 0,
      tinygo_lowered_program_000_dec_statement_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 1,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 0,
      tinygo_lowered_program_000_switch_case_clause_count: () => 0,
      tinygo_lowered_program_000_select_comm_clause_count: () => 0,
      tinygo_lowered_program_000_for_statement_count: () => 0,
      tinygo_lowered_program_000_break_statement_count: () => 0,
      tinygo_lowered_program_000_continue_statement_count: () => 0,
      tinygo_lowered_program_000_labeled_statement_count: () => 0,
      tinygo_lowered_program_000_goto_statement_count: () => 0,
      tinygo_lowered_program_000_fallthrough_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_struct_field_count: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc sizes(items []int) int { buffer := make([]int, len(items)); return len(buffer) }\n',
  }), /frontend lowered artifact probe make call count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered cap call counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc clone(dst, src []int) int { _ = copy(dst, src); return cap(dst) }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc clone(dst, src []int) int { _ = copy(dst, src); return cap(dst) }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 2,
      tinygo_lowered_program_000_builtin_call_count: () => 2,
      tinygo_lowered_program_000_append_call_count: () => 0,
      tinygo_lowered_program_000_len_call_count: () => 0,
      tinygo_lowered_program_000_make_call_count: () => 0,
      tinygo_lowered_program_000_cap_call_count: () => 0,
      tinygo_lowered_program_000_copy_call_count: () => 1,
      tinygo_lowered_program_000_unary_expression_count: () => 0,
      tinygo_lowered_program_000_binary_expression_count: () => 0,
      tinygo_lowered_program_000_send_statement_count: () => 0,
      tinygo_lowered_program_000_receive_expression_count: () => 0,
      tinygo_lowered_program_000_assign_statement_count: () => 1,
      tinygo_lowered_program_000_define_statement_count: () => 0,
      tinygo_lowered_program_000_inc_statement_count: () => 0,
      tinygo_lowered_program_000_dec_statement_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 1,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 0,
      tinygo_lowered_program_000_switch_case_clause_count: () => 0,
      tinygo_lowered_program_000_select_comm_clause_count: () => 0,
      tinygo_lowered_program_000_for_statement_count: () => 0,
      tinygo_lowered_program_000_break_statement_count: () => 0,
      tinygo_lowered_program_000_continue_statement_count: () => 0,
      tinygo_lowered_program_000_labeled_statement_count: () => 0,
      tinygo_lowered_program_000_goto_statement_count: () => 0,
      tinygo_lowered_program_000_fallthrough_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_struct_field_count: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc clone(dst, src []int) int { _ = copy(dst, src); return cap(dst) }\n',
  }), /frontend lowered artifact probe cap call count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered copy call counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc clone(dst, src []int) int { _ = copy(dst, src); return cap(dst) }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc clone(dst, src []int) int { _ = copy(dst, src); return cap(dst) }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 2,
      tinygo_lowered_program_000_builtin_call_count: () => 2,
      tinygo_lowered_program_000_append_call_count: () => 0,
      tinygo_lowered_program_000_len_call_count: () => 0,
      tinygo_lowered_program_000_make_call_count: () => 0,
      tinygo_lowered_program_000_cap_call_count: () => 1,
      tinygo_lowered_program_000_copy_call_count: () => 0,
      tinygo_lowered_program_000_unary_expression_count: () => 0,
      tinygo_lowered_program_000_binary_expression_count: () => 0,
      tinygo_lowered_program_000_send_statement_count: () => 0,
      tinygo_lowered_program_000_receive_expression_count: () => 0,
      tinygo_lowered_program_000_assign_statement_count: () => 1,
      tinygo_lowered_program_000_define_statement_count: () => 0,
      tinygo_lowered_program_000_inc_statement_count: () => 0,
      tinygo_lowered_program_000_dec_statement_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 1,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 0,
      tinygo_lowered_program_000_switch_case_clause_count: () => 0,
      tinygo_lowered_program_000_select_comm_clause_count: () => 0,
      tinygo_lowered_program_000_for_statement_count: () => 0,
      tinygo_lowered_program_000_break_statement_count: () => 0,
      tinygo_lowered_program_000_continue_statement_count: () => 0,
      tinygo_lowered_program_000_labeled_statement_count: () => 0,
      tinygo_lowered_program_000_goto_statement_count: () => 0,
      tinygo_lowered_program_000_fallthrough_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_struct_field_count: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc clone(dst, src []int) int { _ = copy(dst, src); return cap(dst) }\n',
  }), /frontend lowered artifact probe copy call count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered panic call counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc guard() { _ = recover(); panic("boom") }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc guard() { _ = recover(); panic("boom") }\n',
      }),
      tinygo_lowered_program_000_func_literal_count: () => 0,
      tinygo_lowered_program_000_call_expression_count: () => 2,
      tinygo_lowered_program_000_builtin_call_count: () => 2,
      tinygo_lowered_program_000_append_call_count: () => 0,
      tinygo_lowered_program_000_len_call_count: () => 0,
      tinygo_lowered_program_000_make_call_count: () => 0,
      tinygo_lowered_program_000_cap_call_count: () => 0,
      tinygo_lowered_program_000_copy_call_count: () => 0,
      tinygo_lowered_program_000_panic_call_count: () => 0,
      tinygo_lowered_program_000_recover_call_count: () => 1,
      tinygo_lowered_program_000_unary_expression_count: () => 0,
      tinygo_lowered_program_000_binary_expression_count: () => 0,
      tinygo_lowered_program_000_send_statement_count: () => 0,
      tinygo_lowered_program_000_receive_expression_count: () => 0,
      tinygo_lowered_program_000_assign_statement_count: () => 1,
      tinygo_lowered_program_000_define_statement_count: () => 0,
      tinygo_lowered_program_000_inc_statement_count: () => 0,
      tinygo_lowered_program_000_dec_statement_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 0,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 0,
      tinygo_lowered_program_000_switch_case_clause_count: () => 0,
      tinygo_lowered_program_000_select_comm_clause_count: () => 0,
      tinygo_lowered_program_000_for_statement_count: () => 0,
      tinygo_lowered_program_000_break_statement_count: () => 0,
      tinygo_lowered_program_000_continue_statement_count: () => 0,
      tinygo_lowered_program_000_labeled_statement_count: () => 0,
      tinygo_lowered_program_000_goto_statement_count: () => 0,
      tinygo_lowered_program_000_fallthrough_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_struct_field_count: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc guard() { _ = recover(); panic("boom") }\n',
  }), /frontend lowered artifact probe panic call count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered recover call counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc guard() { _ = recover(); panic("boom") }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc guard() { _ = recover(); panic("boom") }\n',
      }),
      tinygo_lowered_program_000_func_literal_count: () => 0,
      tinygo_lowered_program_000_call_expression_count: () => 2,
      tinygo_lowered_program_000_builtin_call_count: () => 2,
      tinygo_lowered_program_000_append_call_count: () => 0,
      tinygo_lowered_program_000_len_call_count: () => 0,
      tinygo_lowered_program_000_make_call_count: () => 0,
      tinygo_lowered_program_000_cap_call_count: () => 0,
      tinygo_lowered_program_000_copy_call_count: () => 0,
      tinygo_lowered_program_000_panic_call_count: () => 1,
      tinygo_lowered_program_000_recover_call_count: () => 0,
      tinygo_lowered_program_000_unary_expression_count: () => 0,
      tinygo_lowered_program_000_binary_expression_count: () => 0,
      tinygo_lowered_program_000_send_statement_count: () => 0,
      tinygo_lowered_program_000_receive_expression_count: () => 0,
      tinygo_lowered_program_000_assign_statement_count: () => 1,
      tinygo_lowered_program_000_define_statement_count: () => 0,
      tinygo_lowered_program_000_inc_statement_count: () => 0,
      tinygo_lowered_program_000_dec_statement_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 0,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 0,
      tinygo_lowered_program_000_switch_case_clause_count: () => 0,
      tinygo_lowered_program_000_select_comm_clause_count: () => 0,
      tinygo_lowered_program_000_for_statement_count: () => 0,
      tinygo_lowered_program_000_break_statement_count: () => 0,
      tinygo_lowered_program_000_continue_statement_count: () => 0,
      tinygo_lowered_program_000_labeled_statement_count: () => 0,
      tinygo_lowered_program_000_goto_statement_count: () => 0,
      tinygo_lowered_program_000_fallthrough_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_struct_field_count: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc guard() { _ = recover(); panic("boom") }\n',
  }), /frontend lowered artifact probe recover call count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered new call counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc useMap(m map[string]int) *int { delete(m, "x"); return new(int) }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc useMap(m map[string]int) *int { delete(m, "x"); return new(int) }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 2,
      tinygo_lowered_program_000_builtin_call_count: () => 2,
      tinygo_lowered_program_000_append_call_count: () => 0,
      tinygo_lowered_program_000_len_call_count: () => 0,
      tinygo_lowered_program_000_make_call_count: () => 0,
      tinygo_lowered_program_000_cap_call_count: () => 0,
      tinygo_lowered_program_000_copy_call_count: () => 0,
      tinygo_lowered_program_000_panic_call_count: () => 0,
      tinygo_lowered_program_000_recover_call_count: () => 0,
      tinygo_lowered_program_000_new_call_count: () => 0,
      tinygo_lowered_program_000_delete_call_count: () => 1,
      tinygo_lowered_program_000_unary_expression_count: () => 0,
      tinygo_lowered_program_000_binary_expression_count: () => 0,
      tinygo_lowered_program_000_send_statement_count: () => 0,
      tinygo_lowered_program_000_receive_expression_count: () => 0,
      tinygo_lowered_program_000_assign_statement_count: () => 0,
      tinygo_lowered_program_000_define_statement_count: () => 0,
      tinygo_lowered_program_000_inc_statement_count: () => 0,
      tinygo_lowered_program_000_dec_statement_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 1,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 0,
      tinygo_lowered_program_000_switch_case_clause_count: () => 0,
      tinygo_lowered_program_000_select_comm_clause_count: () => 0,
      tinygo_lowered_program_000_for_statement_count: () => 0,
      tinygo_lowered_program_000_break_statement_count: () => 0,
      tinygo_lowered_program_000_continue_statement_count: () => 0,
      tinygo_lowered_program_000_labeled_statement_count: () => 0,
      tinygo_lowered_program_000_goto_statement_count: () => 0,
      tinygo_lowered_program_000_fallthrough_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_map_type_count: () => 1,
      tinygo_lowered_program_000_chan_type_count: () => 0,
      tinygo_lowered_program_000_send_only_chan_type_count: () => 0,
      tinygo_lowered_program_000_receive_only_chan_type_count: () => 0,
      tinygo_lowered_program_000_array_type_count: () => 0,
      tinygo_lowered_program_000_pointer_type_count: () => 1,
      tinygo_lowered_program_000_struct_field_count: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc useMap(m map[string]int) *int { delete(m, "x"); return new(int) }\n',
  }), /frontend lowered artifact probe new call count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered delete call counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc useMap(m map[string]int) *int { delete(m, "x"); return new(int) }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc useMap(m map[string]int) *int { delete(m, "x"); return new(int) }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 2,
      tinygo_lowered_program_000_builtin_call_count: () => 2,
      tinygo_lowered_program_000_append_call_count: () => 0,
      tinygo_lowered_program_000_len_call_count: () => 0,
      tinygo_lowered_program_000_make_call_count: () => 0,
      tinygo_lowered_program_000_cap_call_count: () => 0,
      tinygo_lowered_program_000_copy_call_count: () => 0,
      tinygo_lowered_program_000_panic_call_count: () => 0,
      tinygo_lowered_program_000_recover_call_count: () => 0,
      tinygo_lowered_program_000_new_call_count: () => 1,
      tinygo_lowered_program_000_delete_call_count: () => 0,
      tinygo_lowered_program_000_unary_expression_count: () => 0,
      tinygo_lowered_program_000_binary_expression_count: () => 0,
      tinygo_lowered_program_000_send_statement_count: () => 0,
      tinygo_lowered_program_000_receive_expression_count: () => 0,
      tinygo_lowered_program_000_assign_statement_count: () => 0,
      tinygo_lowered_program_000_define_statement_count: () => 0,
      tinygo_lowered_program_000_inc_statement_count: () => 0,
      tinygo_lowered_program_000_dec_statement_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 1,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 0,
      tinygo_lowered_program_000_switch_case_clause_count: () => 0,
      tinygo_lowered_program_000_select_comm_clause_count: () => 0,
      tinygo_lowered_program_000_for_statement_count: () => 0,
      tinygo_lowered_program_000_break_statement_count: () => 0,
      tinygo_lowered_program_000_continue_statement_count: () => 0,
      tinygo_lowered_program_000_labeled_statement_count: () => 0,
      tinygo_lowered_program_000_goto_statement_count: () => 0,
      tinygo_lowered_program_000_fallthrough_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_map_type_count: () => 1,
      tinygo_lowered_program_000_chan_type_count: () => 0,
      tinygo_lowered_program_000_send_only_chan_type_count: () => 0,
      tinygo_lowered_program_000_receive_only_chan_type_count: () => 0,
      tinygo_lowered_program_000_array_type_count: () => 0,
      tinygo_lowered_program_000_pointer_type_count: () => 1,
      tinygo_lowered_program_000_struct_field_count: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc useMap(m map[string]int) *int { delete(m, "x"); return new(int) }\n',
  }), /frontend lowered artifact probe delete call count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered composite literal counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype App struct{ Name string }\nfunc literals() { app := App{Name: "codex"}; _ = app }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype App struct{ Name string }\nfunc literals() { app := App{Name: "codex"}; _ = app }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 0,
      tinygo_lowered_program_000_builtin_call_count: () => 0,
      tinygo_lowered_program_000_append_call_count: () => 0,
      tinygo_lowered_program_000_len_call_count: () => 0,
      tinygo_lowered_program_000_make_call_count: () => 0,
      tinygo_lowered_program_000_composite_literal_count: () => 0,
      tinygo_lowered_program_000_selector_expression_count: () => 0,
      tinygo_lowered_program_000_unary_expression_count: () => 0,
      tinygo_lowered_program_000_binary_expression_count: () => 0,
      tinygo_lowered_program_000_send_statement_count: () => 0,
      tinygo_lowered_program_000_receive_expression_count: () => 0,
      tinygo_lowered_program_000_assign_statement_count: () => 2,
      tinygo_lowered_program_000_define_statement_count: () => 1,
      tinygo_lowered_program_000_inc_statement_count: () => 0,
      tinygo_lowered_program_000_dec_statement_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 0,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 0,
      tinygo_lowered_program_000_switch_case_clause_count: () => 0,
      tinygo_lowered_program_000_select_comm_clause_count: () => 0,
      tinygo_lowered_program_000_for_statement_count: () => 0,
      tinygo_lowered_program_000_break_statement_count: () => 0,
      tinygo_lowered_program_000_continue_statement_count: () => 0,
      tinygo_lowered_program_000_labeled_statement_count: () => 0,
      tinygo_lowered_program_000_goto_statement_count: () => 0,
      tinygo_lowered_program_000_fallthrough_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 1,
      tinygo_lowered_program_000_exported_type_count: () => 1,
      tinygo_lowered_program_000_struct_type_count: () => 1,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_struct_field_count: () => 1,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\ntype App struct{ Name string }\nfunc literals() { app := App{Name: "codex"}; _ = app }\n',
  }), /frontend lowered artifact probe composite literal count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered selector expression counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nimport "fmt"\ntype App struct{ Name string }\nfunc (App) Serve() {}\nfunc literals() { app := App{Name: "codex"}; _ = app.Name; fmt.Println(app.Name); app.Serve() }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 1,
      tinygo_lowered_program_000_import_path_hash: () => expectedImportPathHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nimport "fmt"\ntype App struct{ Name string }\nfunc (App) Serve() {}\nfunc literals() { app := App{Name: "codex"}; _ = app.Name; fmt.Println(app.Name); app.Serve() }\n',
      }),
      tinygo_lowered_program_000_function_count: () => 2,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nimport "fmt"\ntype App struct{ Name string }\nfunc (App) Serve() {}\nfunc literals() { app := App{Name: "codex"}; _ = app.Name; fmt.Println(app.Name); app.Serve() }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 2,
      tinygo_lowered_program_000_builtin_call_count: () => 0,
      tinygo_lowered_program_000_append_call_count: () => 0,
      tinygo_lowered_program_000_len_call_count: () => 0,
      tinygo_lowered_program_000_make_call_count: () => 0,
      tinygo_lowered_program_000_composite_literal_count: () => 1,
      tinygo_lowered_program_000_selector_expression_count: () => 5,
      tinygo_lowered_program_000_unary_expression_count: () => 0,
      tinygo_lowered_program_000_binary_expression_count: () => 0,
      tinygo_lowered_program_000_send_statement_count: () => 0,
      tinygo_lowered_program_000_receive_expression_count: () => 0,
      tinygo_lowered_program_000_assign_statement_count: () => 2,
      tinygo_lowered_program_000_define_statement_count: () => 1,
      tinygo_lowered_program_000_inc_statement_count: () => 0,
      tinygo_lowered_program_000_dec_statement_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 0,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 0,
      tinygo_lowered_program_000_switch_case_clause_count: () => 0,
      tinygo_lowered_program_000_select_comm_clause_count: () => 0,
      tinygo_lowered_program_000_for_statement_count: () => 0,
      tinygo_lowered_program_000_break_statement_count: () => 0,
      tinygo_lowered_program_000_continue_statement_count: () => 0,
      tinygo_lowered_program_000_labeled_statement_count: () => 0,
      tinygo_lowered_program_000_goto_statement_count: () => 0,
      tinygo_lowered_program_000_fallthrough_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 1,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 1,
      tinygo_lowered_program_000_exported_type_count: () => 1,
      tinygo_lowered_program_000_struct_type_count: () => 1,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_struct_field_count: () => 1,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nimport "fmt"\ntype App struct{ Name string }\nfunc (App) Serve() {}\nfunc literals() { app := App{Name: "codex"}; _ = app.Name; fmt.Println(app.Name); app.Serve() }\n',
  }), /frontend lowered artifact probe selector expression count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered selector name hashes', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nimport "fmt"\ntype App struct{ Name string }\nfunc (App) Serve() {}\nfunc literals() { app := App{Name: "codex"}; _ = app.Name; fmt.Println(app.Name); app.Serve() }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 1,
      tinygo_lowered_program_000_import_path_hash: () => expectedImportPathHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nimport "fmt"\ntype App struct{ Name string }\nfunc (App) Serve() {}\nfunc literals() { app := App{Name: "codex"}; _ = app.Name; fmt.Println(app.Name); app.Serve() }\n',
      }),
      tinygo_lowered_program_000_function_count: () => 2,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nimport "fmt"\ntype App struct{ Name string }\nfunc (App) Serve() {}\nfunc literals() { app := App{Name: "codex"}; _ = app.Name; fmt.Println(app.Name); app.Serve() }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 2,
      tinygo_lowered_program_000_builtin_call_count: () => 0,
      tinygo_lowered_program_000_append_call_count: () => 0,
      tinygo_lowered_program_000_len_call_count: () => 0,
      tinygo_lowered_program_000_make_call_count: () => 0,
      tinygo_lowered_program_000_composite_literal_count: () => 1,
      tinygo_lowered_program_000_selector_expression_count: () => 4,
      tinygo_lowered_program_000_selector_name_hash: () => 0,
      tinygo_lowered_program_000_unary_expression_count: () => 0,
      tinygo_lowered_program_000_binary_expression_count: () => 0,
      tinygo_lowered_program_000_send_statement_count: () => 0,
      tinygo_lowered_program_000_receive_expression_count: () => 0,
      tinygo_lowered_program_000_assign_statement_count: () => 2,
      tinygo_lowered_program_000_define_statement_count: () => 1,
      tinygo_lowered_program_000_inc_statement_count: () => 0,
      tinygo_lowered_program_000_dec_statement_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 0,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 0,
      tinygo_lowered_program_000_switch_case_clause_count: () => 0,
      tinygo_lowered_program_000_select_comm_clause_count: () => 0,
      tinygo_lowered_program_000_for_statement_count: () => 0,
      tinygo_lowered_program_000_break_statement_count: () => 0,
      tinygo_lowered_program_000_continue_statement_count: () => 0,
      tinygo_lowered_program_000_labeled_statement_count: () => 0,
      tinygo_lowered_program_000_goto_statement_count: () => 0,
      tinygo_lowered_program_000_fallthrough_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 1,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 1,
      tinygo_lowered_program_000_exported_type_count: () => 1,
      tinygo_lowered_program_000_struct_type_count: () => 1,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_struct_field_count: () => 1,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nimport "fmt"\ntype App struct{ Name string }\nfunc (App) Serve() {}\nfunc literals() { app := App{Name: "codex"}; _ = app.Name; fmt.Println(app.Name); app.Serve() }\n',
  }), /frontend lowered artifact probe selector name hash did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered index expression counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc access(items []int) int { _ = items[0]; return len(items[1:]) }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc access(items []int) int { _ = items[0]; return len(items[1:]) }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 1,
      tinygo_lowered_program_000_builtin_call_count: () => 1,
      tinygo_lowered_program_000_append_call_count: () => 0,
      tinygo_lowered_program_000_len_call_count: () => 1,
      tinygo_lowered_program_000_make_call_count: () => 0,
      tinygo_lowered_program_000_composite_literal_count: () => 0,
      tinygo_lowered_program_000_selector_expression_count: () => 0,
      tinygo_lowered_program_000_index_expression_count: () => 0,
      tinygo_lowered_program_000_slice_expression_count: () => 1,
      tinygo_lowered_program_000_unary_expression_count: () => 0,
      tinygo_lowered_program_000_binary_expression_count: () => 0,
      tinygo_lowered_program_000_send_statement_count: () => 0,
      tinygo_lowered_program_000_receive_expression_count: () => 0,
      tinygo_lowered_program_000_assign_statement_count: () => 1,
      tinygo_lowered_program_000_define_statement_count: () => 0,
      tinygo_lowered_program_000_inc_statement_count: () => 0,
      tinygo_lowered_program_000_dec_statement_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 1,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 0,
      tinygo_lowered_program_000_switch_case_clause_count: () => 0,
      tinygo_lowered_program_000_select_comm_clause_count: () => 0,
      tinygo_lowered_program_000_for_statement_count: () => 0,
      tinygo_lowered_program_000_break_statement_count: () => 0,
      tinygo_lowered_program_000_continue_statement_count: () => 0,
      tinygo_lowered_program_000_labeled_statement_count: () => 0,
      tinygo_lowered_program_000_goto_statement_count: () => 0,
      tinygo_lowered_program_000_fallthrough_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_struct_field_count: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc access(items []int) int { _ = items[0]; return len(items[1:]) }\n',
  }), /frontend lowered artifact probe index expression count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered slice expression counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc access(items []int) int { _ = items[0]; return len(items[1:]) }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc access(items []int) int { _ = items[0]; return len(items[1:]) }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 1,
      tinygo_lowered_program_000_builtin_call_count: () => 1,
      tinygo_lowered_program_000_append_call_count: () => 0,
      tinygo_lowered_program_000_len_call_count: () => 1,
      tinygo_lowered_program_000_make_call_count: () => 0,
      tinygo_lowered_program_000_composite_literal_count: () => 0,
      tinygo_lowered_program_000_selector_expression_count: () => 0,
      tinygo_lowered_program_000_index_expression_count: () => 1,
      tinygo_lowered_program_000_slice_expression_count: () => 0,
      tinygo_lowered_program_000_unary_expression_count: () => 0,
      tinygo_lowered_program_000_binary_expression_count: () => 0,
      tinygo_lowered_program_000_send_statement_count: () => 0,
      tinygo_lowered_program_000_receive_expression_count: () => 0,
      tinygo_lowered_program_000_assign_statement_count: () => 1,
      tinygo_lowered_program_000_define_statement_count: () => 0,
      tinygo_lowered_program_000_inc_statement_count: () => 0,
      tinygo_lowered_program_000_dec_statement_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 1,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 0,
      tinygo_lowered_program_000_switch_case_clause_count: () => 0,
      tinygo_lowered_program_000_select_comm_clause_count: () => 0,
      tinygo_lowered_program_000_for_statement_count: () => 0,
      tinygo_lowered_program_000_break_statement_count: () => 0,
      tinygo_lowered_program_000_continue_statement_count: () => 0,
      tinygo_lowered_program_000_labeled_statement_count: () => 0,
      tinygo_lowered_program_000_goto_statement_count: () => 0,
      tinygo_lowered_program_000_fallthrough_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_struct_field_count: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc access(items []int) int { _ = items[0]; return len(items[1:]) }\n',
  }), /frontend lowered artifact probe slice expression count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered key value expression counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype App struct{ Name string }\nfunc probe() { app := App{Name: "codex"}; _ = app }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype App struct{ Name string }\nfunc probe() { app := App{Name: "codex"}; _ = app }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 0,
      tinygo_lowered_program_000_builtin_call_count: () => 0,
      tinygo_lowered_program_000_append_call_count: () => 0,
      tinygo_lowered_program_000_len_call_count: () => 0,
      tinygo_lowered_program_000_make_call_count: () => 0,
      tinygo_lowered_program_000_composite_literal_count: () => 1,
      tinygo_lowered_program_000_selector_expression_count: () => 0,
      tinygo_lowered_program_000_index_expression_count: () => 0,
      tinygo_lowered_program_000_slice_expression_count: () => 0,
      tinygo_lowered_program_000_key_value_expression_count: () => 0,
      tinygo_lowered_program_000_type_assertion_count: () => 0,
      tinygo_lowered_program_000_unary_expression_count: () => 0,
      tinygo_lowered_program_000_binary_expression_count: () => 0,
      tinygo_lowered_program_000_send_statement_count: () => 0,
      tinygo_lowered_program_000_receive_expression_count: () => 0,
      tinygo_lowered_program_000_assign_statement_count: () => 2,
      tinygo_lowered_program_000_define_statement_count: () => 1,
      tinygo_lowered_program_000_inc_statement_count: () => 0,
      tinygo_lowered_program_000_dec_statement_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 0,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 0,
      tinygo_lowered_program_000_switch_case_clause_count: () => 0,
      tinygo_lowered_program_000_select_comm_clause_count: () => 0,
      tinygo_lowered_program_000_for_statement_count: () => 0,
      tinygo_lowered_program_000_break_statement_count: () => 0,
      tinygo_lowered_program_000_continue_statement_count: () => 0,
      tinygo_lowered_program_000_labeled_statement_count: () => 0,
      tinygo_lowered_program_000_goto_statement_count: () => 0,
      tinygo_lowered_program_000_fallthrough_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 1,
      tinygo_lowered_program_000_exported_type_count: () => 1,
      tinygo_lowered_program_000_struct_type_count: () => 1,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_struct_field_count: () => 1,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\ntype App struct{ Name string }\nfunc probe() { app := App{Name: "codex"}; _ = app }\n',
  }), /frontend lowered artifact probe key value expression count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered type assertion counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc probe(value any) string { text, _ := value.(string); return text }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc probe(value any) string { text, _ := value.(string); return text }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 0,
      tinygo_lowered_program_000_builtin_call_count: () => 0,
      tinygo_lowered_program_000_append_call_count: () => 0,
      tinygo_lowered_program_000_len_call_count: () => 0,
      tinygo_lowered_program_000_make_call_count: () => 0,
      tinygo_lowered_program_000_composite_literal_count: () => 0,
      tinygo_lowered_program_000_selector_expression_count: () => 0,
      tinygo_lowered_program_000_index_expression_count: () => 0,
      tinygo_lowered_program_000_slice_expression_count: () => 0,
      tinygo_lowered_program_000_key_value_expression_count: () => 0,
      tinygo_lowered_program_000_type_assertion_count: () => 0,
      tinygo_lowered_program_000_unary_expression_count: () => 0,
      tinygo_lowered_program_000_binary_expression_count: () => 0,
      tinygo_lowered_program_000_send_statement_count: () => 0,
      tinygo_lowered_program_000_receive_expression_count: () => 0,
      tinygo_lowered_program_000_assign_statement_count: () => 1,
      tinygo_lowered_program_000_define_statement_count: () => 1,
      tinygo_lowered_program_000_inc_statement_count: () => 0,
      tinygo_lowered_program_000_dec_statement_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 1,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 0,
      tinygo_lowered_program_000_switch_case_clause_count: () => 0,
      tinygo_lowered_program_000_select_comm_clause_count: () => 0,
      tinygo_lowered_program_000_for_statement_count: () => 0,
      tinygo_lowered_program_000_break_statement_count: () => 0,
      tinygo_lowered_program_000_continue_statement_count: () => 0,
      tinygo_lowered_program_000_labeled_statement_count: () => 0,
      tinygo_lowered_program_000_goto_statement_count: () => 0,
      tinygo_lowered_program_000_fallthrough_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_struct_field_count: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc probe(value any) string { text, _ := value.(string); return text }\n',
  }), /frontend lowered artifact probe type assertion count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered blank identifier counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc probe(value any) string { text, _ := value.(string); _ = text; _ = value; return text }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc probe(value any) string { text, _ := value.(string); _ = text; _ = value; return text }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 0,
      tinygo_lowered_program_000_builtin_call_count: () => 0,
      tinygo_lowered_program_000_append_call_count: () => 0,
      tinygo_lowered_program_000_len_call_count: () => 0,
      tinygo_lowered_program_000_make_call_count: () => 0,
      tinygo_lowered_program_000_composite_literal_count: () => 0,
      tinygo_lowered_program_000_selector_expression_count: () => 0,
      tinygo_lowered_program_000_index_expression_count: () => 0,
      tinygo_lowered_program_000_slice_expression_count: () => 0,
      tinygo_lowered_program_000_key_value_expression_count: () => 0,
      tinygo_lowered_program_000_type_assertion_count: () => 1,
      tinygo_lowered_program_000_blank_identifier_count: () => 0,
      tinygo_lowered_program_000_blank_assignment_target_count: () => 3,
      tinygo_lowered_program_000_unary_expression_count: () => 0,
      tinygo_lowered_program_000_binary_expression_count: () => 0,
      tinygo_lowered_program_000_send_statement_count: () => 0,
      tinygo_lowered_program_000_receive_expression_count: () => 0,
      tinygo_lowered_program_000_assign_statement_count: () => 3,
      tinygo_lowered_program_000_define_statement_count: () => 1,
      tinygo_lowered_program_000_inc_statement_count: () => 0,
      tinygo_lowered_program_000_dec_statement_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 1,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 0,
      tinygo_lowered_program_000_switch_case_clause_count: () => 0,
      tinygo_lowered_program_000_select_comm_clause_count: () => 0,
      tinygo_lowered_program_000_for_statement_count: () => 0,
      tinygo_lowered_program_000_break_statement_count: () => 0,
      tinygo_lowered_program_000_continue_statement_count: () => 0,
      tinygo_lowered_program_000_labeled_statement_count: () => 0,
      tinygo_lowered_program_000_goto_statement_count: () => 0,
      tinygo_lowered_program_000_fallthrough_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_struct_field_count: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc probe(value any) string { text, _ := value.(string); _ = text; _ = value; return text }\n',
  }), /frontend lowered artifact probe blank identifier count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered blank assignment target counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc probe(value any) string { text, _ := value.(string); _ = text; _ = value; return text }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc probe(value any) string { text, _ := value.(string); _ = text; _ = value; return text }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 0,
      tinygo_lowered_program_000_builtin_call_count: () => 0,
      tinygo_lowered_program_000_append_call_count: () => 0,
      tinygo_lowered_program_000_len_call_count: () => 0,
      tinygo_lowered_program_000_make_call_count: () => 0,
      tinygo_lowered_program_000_composite_literal_count: () => 0,
      tinygo_lowered_program_000_selector_expression_count: () => 0,
      tinygo_lowered_program_000_index_expression_count: () => 0,
      tinygo_lowered_program_000_slice_expression_count: () => 0,
      tinygo_lowered_program_000_key_value_expression_count: () => 0,
      tinygo_lowered_program_000_type_assertion_count: () => 1,
      tinygo_lowered_program_000_blank_identifier_count: () => 3,
      tinygo_lowered_program_000_blank_assignment_target_count: () => 0,
      tinygo_lowered_program_000_unary_expression_count: () => 0,
      tinygo_lowered_program_000_binary_expression_count: () => 0,
      tinygo_lowered_program_000_send_statement_count: () => 0,
      tinygo_lowered_program_000_receive_expression_count: () => 0,
      tinygo_lowered_program_000_assign_statement_count: () => 3,
      tinygo_lowered_program_000_define_statement_count: () => 1,
      tinygo_lowered_program_000_inc_statement_count: () => 0,
      tinygo_lowered_program_000_dec_statement_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 1,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 0,
      tinygo_lowered_program_000_switch_case_clause_count: () => 0,
      tinygo_lowered_program_000_select_comm_clause_count: () => 0,
      tinygo_lowered_program_000_for_statement_count: () => 0,
      tinygo_lowered_program_000_break_statement_count: () => 0,
      tinygo_lowered_program_000_continue_statement_count: () => 0,
      tinygo_lowered_program_000_labeled_statement_count: () => 0,
      tinygo_lowered_program_000_goto_statement_count: () => 0,
      tinygo_lowered_program_000_fallthrough_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_struct_field_count: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc probe(value any) string { text, _ := value.(string); _ = text; _ = value; return text }\n',
  }), /frontend lowered artifact probe blank assignment target count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered return statement counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc main() { return }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc main() { return }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc main() { return }\n',
  }), /frontend lowered artifact probe return statement count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports counts returns after nested blocks', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc factorial(n int) int { if n <= 1 { return 1 }; return n }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc factorial(n int) int { if n <= 1 { return 1 }; return n }\n',
      }),
      tinygo_lowered_program_000_binary_expression_count: () => 1,
      tinygo_lowered_program_000_return_statement_count: () => 2,
      tinygo_lowered_program_000_if_statement_count: () => 1,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc factorial(n int) int { if n <= 1 { return 1 }; return n }\n',
  }), /frontend lowered artifact probe missing export tinygo_lowered_program_000_method_count/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered go statement counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc Hello() {}\nfunc main() { go Hello() }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 2,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc Hello() {}\nfunc main() { go Hello() }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 1,
      tinygo_lowered_program_000_return_statement_count: () => 0,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 1,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc Hello() {}\nfunc main() { go Hello() }\n',
  }), /frontend lowered artifact probe go statement count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered defer statement counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc Hello() {}\nfunc main() { defer Hello() }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 2,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc Hello() {}\nfunc main() { defer Hello() }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 1,
      tinygo_lowered_program_000_return_statement_count: () => 0,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 1,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc Hello() {}\nfunc main() { defer Hello() }\n',
  }), /frontend lowered artifact probe defer statement count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered if statement counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc main() { if true {} }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc main() { if true {} }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 0,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc main() { if true {} }\n',
  }), /frontend lowered artifact probe if statement count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered range statement counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc Loop(items []int) { for range items {} }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc Loop(items []int) { for range items {} }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 0,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 1,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc Loop(items []int) { for range items {} }\n',
  }), /frontend lowered artifact probe range statement count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered switch statement counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc Choose(value int) { switch value { case 1: } }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc Choose(value int) { switch value { case 1: } }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 0,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 1,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc Choose(value int) { switch value { case 1: } }\n',
  }), /frontend lowered artifact probe switch statement count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered type switch statement counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc classify(value any) { switch value.(type) { case string: default: } }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc classify(value any) { switch value.(type) { case string: default: } }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 0,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 1,
      tinygo_lowered_program_000_type_switch_statement_count: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc classify(value any) { switch value.(type) { case string: default: } }\n',
  }), /frontend lowered artifact probe type switch statement count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered type switch case clause counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc classify(value any) { switch value.(type) { case string: case int, int32: default: } }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc classify(value any) { switch value.(type) { case string: case int, int32: default: } }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 0,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 1,
      tinygo_lowered_program_000_type_switch_statement_count: () => 1,
      tinygo_lowered_program_000_type_switch_case_clause_count: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 0,
      tinygo_lowered_program_000_switch_case_clause_count: () => 3,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc classify(value any) { switch value.(type) { case string: case int, int32: default: } }\n',
  }), /frontend lowered artifact probe type switch case clause count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered type switch guard name hashes', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc classify(value any) { switch typed := value.(type) { case string: _ = typed; default: } }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc classify(value any) { switch typed := value.(type) { case string: _ = typed; default: } }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 0,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 1,
      tinygo_lowered_program_000_type_switch_statement_count: () => 1,
      tinygo_lowered_program_000_type_switch_case_clause_count: () => 2,
      tinygo_lowered_program_000_type_switch_guard_name_hash: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 0,
      tinygo_lowered_program_000_switch_case_clause_count: () => 2,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc classify(value any) { switch typed := value.(type) { case string: _ = typed; default: } }\n',
  }), /frontend lowered artifact probe type switch guard name hash did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered type switch case type hashes', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc classify(value any) { switch value.(type) { case string: case int, int32: default: } }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc classify(value any) { switch value.(type) { case string: case int, int32: default: } }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 0,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 1,
      tinygo_lowered_program_000_type_switch_statement_count: () => 1,
      tinygo_lowered_program_000_type_switch_case_clause_count: () => 3,
      tinygo_lowered_program_000_type_switch_guard_name_hash: () => 0,
      tinygo_lowered_program_000_type_switch_case_type_hash: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 0,
      tinygo_lowered_program_000_switch_case_clause_count: () => 3,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc classify(value any) { switch value.(type) { case string: case int, int32: default: } }\n',
  }), /frontend lowered artifact probe type switch case type hash did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered select statement counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc Await(ch chan int) { select { case <-ch: default: } }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc Await(ch chan int) { select { case <-ch: default: } }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 0,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 1,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc Await(ch chan int) { select { case <-ch: default: } }\n',
  }), /frontend lowered artifact probe select statement count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered switch case clause counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc Choose(value int) { switch value { case 1: case 2: default: } }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc Choose(value int) { switch value { case 1: case 2: default: } }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 0,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 1,
      tinygo_lowered_program_000_select_statement_count: () => 0,
      tinygo_lowered_program_000_switch_case_clause_count: () => 0,
      tinygo_lowered_program_000_select_comm_clause_count: () => 0,
      tinygo_lowered_program_000_for_statement_count: () => 0,
      tinygo_lowered_program_000_break_statement_count: () => 0,
      tinygo_lowered_program_000_continue_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 1,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc Choose(value int) { switch value { case 1: case 2: default: } }\n',
  }), /frontend lowered artifact probe switch case clause count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered select comm clause counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc Await(ch chan int) { select { case <-ch: case <-ch: default: } }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc Await(ch chan int) { select { case <-ch: case <-ch: default: } }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 0,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 1,
      tinygo_lowered_program_000_switch_case_clause_count: () => 0,
      tinygo_lowered_program_000_select_comm_clause_count: () => 0,
      tinygo_lowered_program_000_for_statement_count: () => 0,
      tinygo_lowered_program_000_break_statement_count: () => 0,
      tinygo_lowered_program_000_continue_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 1,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc Await(ch chan int) { select { case <-ch: case <-ch: default: } }\n',
  }), /frontend lowered artifact probe select comm clause count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered for statement counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc loopForever() { for { break } }\nfunc step() { for { continue } }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 2,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc loopForever() { for { break } }\nfunc step() { for { continue } }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 0,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 0,
      tinygo_lowered_program_000_for_statement_count: () => 0,
      tinygo_lowered_program_000_break_statement_count: () => 1,
      tinygo_lowered_program_000_continue_statement_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc loopForever() { for { break } }\nfunc step() { for { continue } }\n',
  }), /frontend lowered artifact probe for statement count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered break statement counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc loopForever() { for { break } }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc loopForever() { for { break } }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 0,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 0,
      tinygo_lowered_program_000_for_statement_count: () => 1,
      tinygo_lowered_program_000_break_statement_count: () => 0,
      tinygo_lowered_program_000_continue_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc loopForever() { for { break } }\n',
  }), /frontend lowered artifact probe break statement count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered continue statement counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc step() { for { continue } }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc step() { for { continue } }\n',
      }),
      tinygo_lowered_program_000_call_expression_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 0,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 0,
      tinygo_lowered_program_000_for_statement_count: () => 1,
      tinygo_lowered_program_000_break_statement_count: () => 0,
      tinygo_lowered_program_000_continue_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc step() { for { continue } }\n',
  }), /frontend lowered artifact probe continue statement count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered labeled statement counts', () => {
  assert.throws(
    () =>
      verifyTinyGoLoweredArtifactExports(
        {
          exports: {
          tinygo_lowered_program_000_source_file_count: () => 1,
          tinygo_lowered_program_000_kind_tag: () => 1,
          tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
            '/workspace/main.go': 'package main\nfunc route(value int) {\nstart:\n\tswitch value {\n\tcase 0:\n\t\tgoto start\n\tcase 1:\n\t\tfallthrough\n\tdefault:\n\t}\n}\n',
          }),
          tinygo_lowered_program_000_import_count: () => 0,
          tinygo_lowered_program_000_import_path_hash: () => 0,
          tinygo_lowered_program_000_function_count: () => 1,
          tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
            '/workspace/main.go': 'package main\nfunc route(value int) {\nstart:\n\tswitch value {\n\tcase 0:\n\t\tgoto start\n\tcase 1:\n\t\tfallthrough\n\tdefault:\n\t}\n}\n',
          }),
          tinygo_lowered_program_000_call_expression_count: () => 0,
          tinygo_lowered_program_000_return_statement_count: () => 0,
          tinygo_lowered_program_000_go_statement_count: () => 0,
          tinygo_lowered_program_000_defer_statement_count: () => 0,
          tinygo_lowered_program_000_if_statement_count: () => 0,
          tinygo_lowered_program_000_range_statement_count: () => 0,
          tinygo_lowered_program_000_switch_statement_count: () => 1,
          tinygo_lowered_program_000_select_statement_count: () => 0,
          tinygo_lowered_program_000_switch_case_clause_count: () => 3,
          tinygo_lowered_program_000_select_comm_clause_count: () => 0,
          tinygo_lowered_program_000_for_statement_count: () => 0,
          tinygo_lowered_program_000_break_statement_count: () => 0,
          tinygo_lowered_program_000_continue_statement_count: () => 0,
          tinygo_lowered_program_000_labeled_statement_count: () => 0,
          tinygo_lowered_program_000_goto_statement_count: () => 1,
          tinygo_lowered_program_000_fallthrough_statement_count: () => 1,
          tinygo_lowered_program_000_method_count: () => 0,
          tinygo_lowered_program_000_exported_function_count: () => 0,
          tinygo_lowered_program_000_type_count: () => 0,
          tinygo_lowered_program_000_exported_type_count: () => 0,
          tinygo_lowered_program_000_struct_type_count: () => 0,
          tinygo_lowered_program_000_interface_type_count: () => 0,
          tinygo_lowered_program_000_struct_field_count: () => 0,
          tinygo_lowered_program_000_interface_method_count: () => 0,
          tinygo_lowered_program_000_const_count: () => 0,
          tinygo_lowered_program_000_var_count: () => 0,
          tinygo_lowered_program_000_exported_const_count: () => 0,
          tinygo_lowered_program_000_exported_var_count: () => 0,
          tinygo_lowered_program_000_main_count: () => 0,
        },
        },
        {
          units: [
          {
            id: 'program-000',
            kind: 'program',
            sourceFiles: ['/workspace/main.go'],
          },
        ],
        },
        {
          '/workspace/main.go': 'package main\nfunc route(value int) {\nstart:\n\tswitch value {\n\tcase 0:\n\t\tgoto start\n\tcase 1:\n\t\tfallthrough\n\tdefault:\n\t}\n}\n',
        },
      ),
    /frontend lowered artifact probe labeled statement count did not match lowered sources manifest/,
  )
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered goto statement counts', () => {
  assert.throws(
    () =>
      verifyTinyGoLoweredArtifactExports(
        {
          exports: {
          tinygo_lowered_program_000_source_file_count: () => 1,
          tinygo_lowered_program_000_kind_tag: () => 1,
          tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
            '/workspace/main.go': 'package main\nfunc route(value int) {\nstart:\n\tswitch value {\n\tcase 0:\n\t\tgoto start\n\tcase 1:\n\t\tfallthrough\n\tdefault:\n\t}\n}\n',
          }),
          tinygo_lowered_program_000_import_count: () => 0,
          tinygo_lowered_program_000_import_path_hash: () => 0,
          tinygo_lowered_program_000_function_count: () => 1,
          tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
            '/workspace/main.go': 'package main\nfunc route(value int) {\nstart:\n\tswitch value {\n\tcase 0:\n\t\tgoto start\n\tcase 1:\n\t\tfallthrough\n\tdefault:\n\t}\n}\n',
          }),
          tinygo_lowered_program_000_call_expression_count: () => 0,
          tinygo_lowered_program_000_return_statement_count: () => 0,
          tinygo_lowered_program_000_go_statement_count: () => 0,
          tinygo_lowered_program_000_defer_statement_count: () => 0,
          tinygo_lowered_program_000_if_statement_count: () => 0,
          tinygo_lowered_program_000_range_statement_count: () => 0,
          tinygo_lowered_program_000_switch_statement_count: () => 1,
          tinygo_lowered_program_000_select_statement_count: () => 0,
          tinygo_lowered_program_000_switch_case_clause_count: () => 3,
          tinygo_lowered_program_000_select_comm_clause_count: () => 0,
          tinygo_lowered_program_000_for_statement_count: () => 0,
          tinygo_lowered_program_000_break_statement_count: () => 0,
          tinygo_lowered_program_000_continue_statement_count: () => 0,
          tinygo_lowered_program_000_labeled_statement_count: () => 1,
          tinygo_lowered_program_000_label_name_hash: () => expectedLabelNameHash(['/workspace/main.go'], {
            '/workspace/main.go': 'package main\nfunc route(value int) {\nstart:\n\tswitch value {\n\tcase 0:\n\t\tgoto start\n\tcase 1:\n\t\tfallthrough\n\tdefault:\n\t}\n}\n',
          }),
          tinygo_lowered_program_000_goto_statement_count: () => 0,
          tinygo_lowered_program_000_goto_label_name_hash: () => expectedGotoLabelNameHash(['/workspace/main.go'], {
            '/workspace/main.go': 'package main\nfunc route(value int) {\nstart:\n\tswitch value {\n\tcase 0:\n\t\tgoto start\n\tcase 1:\n\t\tfallthrough\n\tdefault:\n\t}\n}\n',
          }),
          tinygo_lowered_program_000_fallthrough_statement_count: () => 1,
          tinygo_lowered_program_000_method_count: () => 0,
          tinygo_lowered_program_000_exported_function_count: () => 0,
          tinygo_lowered_program_000_type_count: () => 0,
          tinygo_lowered_program_000_exported_type_count: () => 0,
          tinygo_lowered_program_000_struct_type_count: () => 0,
          tinygo_lowered_program_000_interface_type_count: () => 0,
          tinygo_lowered_program_000_struct_field_count: () => 0,
          tinygo_lowered_program_000_interface_method_count: () => 0,
          tinygo_lowered_program_000_const_count: () => 0,
          tinygo_lowered_program_000_var_count: () => 0,
          tinygo_lowered_program_000_exported_const_count: () => 0,
          tinygo_lowered_program_000_exported_var_count: () => 0,
          tinygo_lowered_program_000_main_count: () => 0,
        },
        },
        {
          units: [
          {
            id: 'program-000',
            kind: 'program',
            sourceFiles: ['/workspace/main.go'],
          },
        ],
        },
        {
          '/workspace/main.go': 'package main\nfunc route(value int) {\nstart:\n\tswitch value {\n\tcase 0:\n\t\tgoto start\n\tcase 1:\n\t\tfallthrough\n\tdefault:\n\t}\n}\n',
        },
      ),
    /frontend lowered artifact probe goto statement count did not match lowered sources manifest/,
  )
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered fallthrough statement counts', () => {
  assert.throws(
    () =>
      verifyTinyGoLoweredArtifactExports(
        {
          exports: {
          tinygo_lowered_program_000_source_file_count: () => 1,
          tinygo_lowered_program_000_kind_tag: () => 1,
          tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
            '/workspace/main.go': 'package main\nfunc route(value int) {\nstart:\n\tswitch value {\n\tcase 0:\n\t\tgoto start\n\tcase 1:\n\t\tfallthrough\n\tdefault:\n\t}\n}\n',
          }),
          tinygo_lowered_program_000_import_count: () => 0,
          tinygo_lowered_program_000_import_path_hash: () => 0,
          tinygo_lowered_program_000_function_count: () => 1,
          tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
            '/workspace/main.go': 'package main\nfunc route(value int) {\nstart:\n\tswitch value {\n\tcase 0:\n\t\tgoto start\n\tcase 1:\n\t\tfallthrough\n\tdefault:\n\t}\n}\n',
          }),
          tinygo_lowered_program_000_call_expression_count: () => 0,
          tinygo_lowered_program_000_return_statement_count: () => 0,
          tinygo_lowered_program_000_go_statement_count: () => 0,
          tinygo_lowered_program_000_defer_statement_count: () => 0,
          tinygo_lowered_program_000_if_statement_count: () => 0,
          tinygo_lowered_program_000_range_statement_count: () => 0,
          tinygo_lowered_program_000_switch_statement_count: () => 1,
          tinygo_lowered_program_000_select_statement_count: () => 0,
          tinygo_lowered_program_000_switch_case_clause_count: () => 3,
          tinygo_lowered_program_000_select_comm_clause_count: () => 0,
          tinygo_lowered_program_000_for_statement_count: () => 0,
          tinygo_lowered_program_000_break_statement_count: () => 0,
          tinygo_lowered_program_000_continue_statement_count: () => 0,
          tinygo_lowered_program_000_labeled_statement_count: () => 1,
          tinygo_lowered_program_000_label_name_hash: () => expectedLabelNameHash(['/workspace/main.go'], {
            '/workspace/main.go': 'package main\nfunc route(value int) {\nstart:\n\tswitch value {\n\tcase 0:\n\t\tgoto start\n\tcase 1:\n\t\tfallthrough\n\tdefault:\n\t}\n}\n',
          }),
          tinygo_lowered_program_000_goto_statement_count: () => 1,
          tinygo_lowered_program_000_goto_label_name_hash: () => expectedGotoLabelNameHash(['/workspace/main.go'], {
            '/workspace/main.go': 'package main\nfunc route(value int) {\nstart:\n\tswitch value {\n\tcase 0:\n\t\tgoto start\n\tcase 1:\n\t\tfallthrough\n\tdefault:\n\t}\n}\n',
          }),
          tinygo_lowered_program_000_fallthrough_statement_count: () => 0,
          tinygo_lowered_program_000_method_count: () => 0,
          tinygo_lowered_program_000_exported_function_count: () => 0,
          tinygo_lowered_program_000_type_count: () => 0,
          tinygo_lowered_program_000_exported_type_count: () => 0,
          tinygo_lowered_program_000_struct_type_count: () => 0,
          tinygo_lowered_program_000_interface_type_count: () => 0,
          tinygo_lowered_program_000_struct_field_count: () => 0,
          tinygo_lowered_program_000_interface_method_count: () => 0,
          tinygo_lowered_program_000_const_count: () => 0,
          tinygo_lowered_program_000_var_count: () => 0,
          tinygo_lowered_program_000_exported_const_count: () => 0,
          tinygo_lowered_program_000_exported_var_count: () => 0,
          tinygo_lowered_program_000_main_count: () => 0,
        },
        },
        {
          units: [
          {
            id: 'program-000',
            kind: 'program',
            sourceFiles: ['/workspace/main.go'],
          },
        ],
        },
        {
          '/workspace/main.go': 'package main\nfunc route(value int) {\nstart:\n\tswitch value {\n\tcase 0:\n\t\tgoto start\n\tcase 1:\n\t\tfallthrough\n\tdefault:\n\t}\n}\n',
        },
      ),
    /frontend lowered artifact probe fallthrough statement count did not match lowered sources manifest/,
  )
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered label name hashes', () => {
  assert.throws(
    () =>
      verifyTinyGoLoweredArtifactExports(
        {
          exports: {
            tinygo_lowered_program_000_source_file_count: () => 1,
            tinygo_lowered_program_000_kind_tag: () => 1,
            tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
              '/workspace/main.go': 'package main\nfunc route(value int) {\nstart:\n\tif value > 0 {\n\t\tgoto start\n\t}\n}\n',
            }),
            tinygo_lowered_program_000_import_count: () => 0,
            tinygo_lowered_program_000_import_path_hash: () => 0,
            tinygo_lowered_program_000_function_count: () => 1,
            tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
              '/workspace/main.go': 'package main\nfunc route(value int) {\nstart:\n\tif value > 0 {\n\t\tgoto start\n\t}\n}\n',
            }),
            tinygo_lowered_program_000_call_expression_count: () => 0,
            tinygo_lowered_program_000_return_statement_count: () => 0,
            tinygo_lowered_program_000_go_statement_count: () => 0,
            tinygo_lowered_program_000_defer_statement_count: () => 0,
            tinygo_lowered_program_000_if_statement_count: () => 1,
            tinygo_lowered_program_000_range_statement_count: () => 0,
            tinygo_lowered_program_000_switch_statement_count: () => 0,
            tinygo_lowered_program_000_select_statement_count: () => 0,
            tinygo_lowered_program_000_switch_case_clause_count: () => 0,
            tinygo_lowered_program_000_select_comm_clause_count: () => 0,
            tinygo_lowered_program_000_for_statement_count: () => 0,
            tinygo_lowered_program_000_break_statement_count: () => 0,
            tinygo_lowered_program_000_continue_statement_count: () => 0,
            tinygo_lowered_program_000_labeled_statement_count: () => 1,
            tinygo_lowered_program_000_label_name_hash: () => 0,
            tinygo_lowered_program_000_goto_statement_count: () => 1,
            tinygo_lowered_program_000_fallthrough_statement_count: () => 0,
            tinygo_lowered_program_000_method_count: () => 0,
            tinygo_lowered_program_000_exported_function_count: () => 0,
            tinygo_lowered_program_000_type_count: () => 0,
            tinygo_lowered_program_000_exported_type_count: () => 0,
            tinygo_lowered_program_000_struct_type_count: () => 0,
            tinygo_lowered_program_000_interface_type_count: () => 0,
            tinygo_lowered_program_000_struct_field_count: () => 0,
            tinygo_lowered_program_000_interface_method_count: () => 0,
            tinygo_lowered_program_000_const_count: () => 0,
            tinygo_lowered_program_000_var_count: () => 0,
            tinygo_lowered_program_000_exported_const_count: () => 0,
            tinygo_lowered_program_000_exported_var_count: () => 0,
            tinygo_lowered_program_000_main_count: () => 0,
            tinygo_lowered_program_000_init_count: () => 0,
          },
        },
        {
          units: [
            {
              id: 'program-000',
              kind: 'program',
              sourceFiles: ['/workspace/main.go'],
            },
          ],
        },
        {
          '/workspace/main.go': 'package main\nfunc route(value int) {\nstart:\n\tif value > 0 {\n\t\tgoto start\n\t}\n}\n',
        },
      ),
    /frontend lowered artifact probe label name hash did not match lowered sources manifest/,
  )
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered goto label name hashes', () => {
  assert.throws(
    () =>
      verifyTinyGoLoweredArtifactExports(
        {
          exports: {
            tinygo_lowered_program_000_source_file_count: () => 1,
            tinygo_lowered_program_000_kind_tag: () => 1,
            tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
              '/workspace/main.go': 'package main\nfunc route(value int) {\nstart:\n\tif value > 0 {\n\t\tgoto start\n\t}\n}\n',
            }),
            tinygo_lowered_program_000_import_count: () => 0,
            tinygo_lowered_program_000_import_path_hash: () => 0,
            tinygo_lowered_program_000_function_count: () => 1,
            tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
              '/workspace/main.go': 'package main\nfunc route(value int) {\nstart:\n\tif value > 0 {\n\t\tgoto start\n\t}\n}\n',
            }),
            tinygo_lowered_program_000_call_expression_count: () => 0,
            tinygo_lowered_program_000_return_statement_count: () => 0,
            tinygo_lowered_program_000_go_statement_count: () => 0,
            tinygo_lowered_program_000_defer_statement_count: () => 0,
            tinygo_lowered_program_000_if_statement_count: () => 1,
            tinygo_lowered_program_000_range_statement_count: () => 0,
            tinygo_lowered_program_000_switch_statement_count: () => 0,
            tinygo_lowered_program_000_select_statement_count: () => 0,
            tinygo_lowered_program_000_switch_case_clause_count: () => 0,
            tinygo_lowered_program_000_select_comm_clause_count: () => 0,
            tinygo_lowered_program_000_for_statement_count: () => 0,
            tinygo_lowered_program_000_break_statement_count: () => 0,
            tinygo_lowered_program_000_continue_statement_count: () => 0,
            tinygo_lowered_program_000_labeled_statement_count: () => 1,
            tinygo_lowered_program_000_label_name_hash: () => expectedLabelNameHash(['/workspace/main.go'], {
              '/workspace/main.go': 'package main\nfunc route(value int) {\nstart:\n\tif value > 0 {\n\t\tgoto start\n\t}\n}\n',
            }),
            tinygo_lowered_program_000_goto_statement_count: () => 1,
            tinygo_lowered_program_000_goto_label_name_hash: () => 0,
            tinygo_lowered_program_000_fallthrough_statement_count: () => 0,
            tinygo_lowered_program_000_method_count: () => 0,
            tinygo_lowered_program_000_exported_function_count: () => 0,
            tinygo_lowered_program_000_type_count: () => 0,
            tinygo_lowered_program_000_exported_type_count: () => 0,
            tinygo_lowered_program_000_struct_type_count: () => 0,
            tinygo_lowered_program_000_interface_type_count: () => 0,
            tinygo_lowered_program_000_struct_field_count: () => 0,
            tinygo_lowered_program_000_interface_method_count: () => 0,
            tinygo_lowered_program_000_const_count: () => 0,
            tinygo_lowered_program_000_var_count: () => 0,
            tinygo_lowered_program_000_exported_const_count: () => 0,
            tinygo_lowered_program_000_exported_var_count: () => 0,
            tinygo_lowered_program_000_main_count: () => 0,
            tinygo_lowered_program_000_init_count: () => 0,
          },
        },
        {
          units: [
            {
              id: 'program-000',
              kind: 'program',
              sourceFiles: ['/workspace/main.go'],
            },
          ],
        },
        {
          '/workspace/main.go': 'package main\nfunc route(value int) {\nstart:\n\tif value > 0 {\n\t\tgoto start\n\t}\n}\n',
        },
      ),
    /frontend lowered artifact probe goto label name hash did not match lowered sources manifest/,
  )
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered break label name hashes', () => {
  assert.throws(
    () =>
      verifyTinyGoLoweredArtifactExports(
        {
          exports: {
            tinygo_lowered_program_000_source_file_count: () => 1,
            tinygo_lowered_program_000_kind_tag: () => 1,
            tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
              '/workspace/main.go': 'package main\nfunc route(items []int) {\nouter:\n\tfor range items {\n\t\tbreak outer\n\t}\n}\n',
            }),
            tinygo_lowered_program_000_import_count: () => 0,
            tinygo_lowered_program_000_import_path_hash: () => 0,
            tinygo_lowered_program_000_function_count: () => 1,
            tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
              '/workspace/main.go': 'package main\nfunc route(items []int) {\nouter:\n\tfor range items {\n\t\tbreak outer\n\t}\n}\n',
            }),
            tinygo_lowered_program_000_call_expression_count: () => 0,
            tinygo_lowered_program_000_return_statement_count: () => 0,
            tinygo_lowered_program_000_go_statement_count: () => 0,
            tinygo_lowered_program_000_defer_statement_count: () => 0,
            tinygo_lowered_program_000_if_statement_count: () => 0,
            tinygo_lowered_program_000_range_statement_count: () => 1,
            tinygo_lowered_program_000_switch_statement_count: () => 0,
            tinygo_lowered_program_000_select_statement_count: () => 0,
            tinygo_lowered_program_000_switch_case_clause_count: () => 0,
            tinygo_lowered_program_000_select_comm_clause_count: () => 0,
            tinygo_lowered_program_000_for_statement_count: () => 0,
            tinygo_lowered_program_000_break_statement_count: () => 1,
            tinygo_lowered_program_000_break_label_name_hash: () => 0,
            tinygo_lowered_program_000_continue_statement_count: () => 0,
            tinygo_lowered_program_000_labeled_statement_count: () => 1,
            tinygo_lowered_program_000_label_name_hash: () => expectedLabelNameHash(['/workspace/main.go'], {
              '/workspace/main.go': 'package main\nfunc route(items []int) {\nouter:\n\tfor range items {\n\t\tbreak outer\n\t}\n}\n',
            }),
            tinygo_lowered_program_000_goto_statement_count: () => 0,
            tinygo_lowered_program_000_goto_label_name_hash: () => 0,
            tinygo_lowered_program_000_fallthrough_statement_count: () => 0,
            tinygo_lowered_program_000_method_count: () => 0,
            tinygo_lowered_program_000_exported_function_count: () => 0,
            tinygo_lowered_program_000_type_count: () => 0,
            tinygo_lowered_program_000_exported_type_count: () => 0,
            tinygo_lowered_program_000_struct_type_count: () => 0,
            tinygo_lowered_program_000_interface_type_count: () => 0,
            tinygo_lowered_program_000_struct_field_count: () => 0,
            tinygo_lowered_program_000_interface_method_count: () => 0,
            tinygo_lowered_program_000_const_count: () => 0,
            tinygo_lowered_program_000_var_count: () => 0,
            tinygo_lowered_program_000_exported_const_count: () => 0,
            tinygo_lowered_program_000_exported_var_count: () => 0,
            tinygo_lowered_program_000_main_count: () => 0,
            tinygo_lowered_program_000_init_count: () => 0,
          },
        },
        {
          units: [
            {
              id: 'program-000',
              kind: 'program',
              sourceFiles: ['/workspace/main.go'],
            },
          ],
        },
        {
          '/workspace/main.go': 'package main\nfunc route(items []int) {\nouter:\n\tfor range items {\n\t\tbreak outer\n\t}\n}\n',
        },
      ),
    /frontend lowered artifact probe break label name hash did not match lowered sources manifest/,
  )
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered continue label name hashes', () => {
  assert.throws(
    () =>
      verifyTinyGoLoweredArtifactExports(
        {
          exports: {
            tinygo_lowered_program_000_source_file_count: () => 1,
            tinygo_lowered_program_000_kind_tag: () => 1,
            tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
              '/workspace/main.go': 'package main\nfunc route(items []int) {\nouter:\n\tfor range items {\n\t\tfor range items {\n\t\t\tcontinue outer\n\t\t}\n\t}\n}\n',
            }),
            tinygo_lowered_program_000_import_count: () => 0,
            tinygo_lowered_program_000_import_path_hash: () => 0,
            tinygo_lowered_program_000_function_count: () => 1,
            tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
              '/workspace/main.go': 'package main\nfunc route(items []int) {\nouter:\n\tfor range items {\n\t\tfor range items {\n\t\t\tcontinue outer\n\t\t}\n\t}\n}\n',
            }),
            tinygo_lowered_program_000_call_expression_count: () => 0,
            tinygo_lowered_program_000_return_statement_count: () => 0,
            tinygo_lowered_program_000_go_statement_count: () => 0,
            tinygo_lowered_program_000_defer_statement_count: () => 0,
            tinygo_lowered_program_000_if_statement_count: () => 0,
            tinygo_lowered_program_000_range_statement_count: () => 2,
            tinygo_lowered_program_000_switch_statement_count: () => 0,
            tinygo_lowered_program_000_select_statement_count: () => 0,
            tinygo_lowered_program_000_switch_case_clause_count: () => 0,
            tinygo_lowered_program_000_select_comm_clause_count: () => 0,
            tinygo_lowered_program_000_for_statement_count: () => 0,
            tinygo_lowered_program_000_break_statement_count: () => 0,
            tinygo_lowered_program_000_break_label_name_hash: () => 0,
            tinygo_lowered_program_000_continue_statement_count: () => 1,
            tinygo_lowered_program_000_continue_label_name_hash: () => 0,
            tinygo_lowered_program_000_labeled_statement_count: () => 1,
            tinygo_lowered_program_000_label_name_hash: () => expectedLabelNameHash(['/workspace/main.go'], {
              '/workspace/main.go': 'package main\nfunc route(items []int) {\nouter:\n\tfor range items {\n\t\tfor range items {\n\t\t\tcontinue outer\n\t\t}\n\t}\n}\n',
            }),
            tinygo_lowered_program_000_goto_statement_count: () => 0,
            tinygo_lowered_program_000_goto_label_name_hash: () => 0,
            tinygo_lowered_program_000_fallthrough_statement_count: () => 0,
            tinygo_lowered_program_000_method_count: () => 0,
            tinygo_lowered_program_000_exported_function_count: () => 0,
            tinygo_lowered_program_000_type_count: () => 0,
            tinygo_lowered_program_000_exported_type_count: () => 0,
            tinygo_lowered_program_000_struct_type_count: () => 0,
            tinygo_lowered_program_000_interface_type_count: () => 0,
            tinygo_lowered_program_000_struct_field_count: () => 0,
            tinygo_lowered_program_000_interface_method_count: () => 0,
            tinygo_lowered_program_000_const_count: () => 0,
            tinygo_lowered_program_000_var_count: () => 0,
            tinygo_lowered_program_000_exported_const_count: () => 0,
            tinygo_lowered_program_000_exported_var_count: () => 0,
            tinygo_lowered_program_000_main_count: () => 0,
            tinygo_lowered_program_000_init_count: () => 0,
          },
        },
        {
          units: [
            {
              id: 'program-000',
              kind: 'program',
              sourceFiles: ['/workspace/main.go'],
            },
          ],
        },
        {
          '/workspace/main.go': 'package main\nfunc route(items []int) {\nouter:\n\tfor range items {\n\t\tfor range items {\n\t\t\tcontinue outer\n\t\t}\n\t}\n}\n',
        },
      ),
    /frontend lowered artifact probe continue label name hash did not match lowered sources manifest/,
  )
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered main counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc main() {}\n',
  }), /frontend lowered artifact probe main count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered init counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc init() {}\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 2,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc init() {}\nfunc main() {}\n',
  }), /frontend lowered artifact probe init count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered placeholder block counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nimport "fmt"\nfunc main() { fmt.Println("hi") }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 1,
      tinygo_lowered_program_000_import_path_hash: () => expectedImportPathHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nimport "fmt"\nfunc main() { fmt.Println("hi") }\n',
      }),
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_placeholder_block_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nimport "fmt"\nfunc main() { fmt.Println("hi") }\n',
  }), /frontend lowered artifact probe placeholder block count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered placeholder block hashes', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nimport "fmt"\nfunc main() { fmt.Println("hi") }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 1,
      tinygo_lowered_program_000_import_path_hash: () => expectedImportPathHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nimport "fmt"\nfunc main() { fmt.Println("hi") }\n',
      }),
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_placeholder_block_count: () => 3,
      tinygo_lowered_program_000_placeholder_block_hash: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nimport "fmt"\nfunc main() { fmt.Println("hi") }\n',
  }, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        packageDir: '/workspace',
        sourceFiles: ['/workspace/main.go'],
        loweredSourcePath: '/working/tinygo-lowered/program-000.c',
        packageName: 'main',
        imports: [{ path: 'fmt' }],
        functions: [{ name: 'main', exported: false, method: false, main: true, init: false, parameters: 0, results: 0 }],
        types: [],
        constants: [],
        variables: [],
        declarations: [{ kind: 'function', name: 'main', exported: false, method: false }],
      },
    ],
  }), /frontend lowered artifact probe placeholder block hash did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports prefers canonical placeholder block signatures when present', () => {
  const canonicalSignatureHash = ((values: string[]) => {
    let hash = 0
    let position = 1
    for (const value of values) {
      for (const byte of new TextEncoder().encode(value)) {
        hash = (hash + (byte * position)) >>> 0
        position += 1
      }
      hash = (hash + (0x0a * position)) >>> 0
      position += 1
    }
    return hash
  })(['sig-function', 'sig-declaration'])

  const programSourceFiles = ['/workspace/main.go']
  const sourceFileContents = {
    '/workspace/main.go': 'package main\nfunc main() {}\n',
  }
  const loweredIRManifest = {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        packageDir: '/workspace',
        sourceFiles: ['/workspace/main.go'],
        loweredSourcePath: '/working/tinygo-lowered/program-000.c',
        packageName: 'main',
        imports: [],
        functions: [{ name: 'main', exported: false, method: false, main: true, init: false, parameters: 0, results: 0 }],
        types: [],
        constants: [],
        variables: [],
        declarations: [{ kind: 'function', name: 'main', exported: false, method: false }],
        placeholderBlocks: [
          { stage: 'function', index: 0, value: 'function:main:0:0:1:0:0:0', signature: 'sig-function' },
          { stage: 'declaration', index: 0, value: 'declaration:function:main:0:0', signature: 'sig-declaration' },
        ],
      },
    ],
  }
  const instance = {
    exports: new Proxy({
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(programSourceFiles, sourceFileContents),
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(programSourceFiles, sourceFileContents),
      tinygo_lowered_program_000_declaration_count: () => 1,
      tinygo_lowered_program_000_declaration_name_hash: () => expectedDeclarationNameHash(loweredIRManifest.units[0].declarations),
      tinygo_lowered_program_000_declaration_signature_hash: () => expectedDeclarationSignatureHash(loweredIRManifest.units[0].declarations),
      tinygo_lowered_program_000_declaration_kind_hash: () => expectedDeclarationKindHash(loweredIRManifest.units[0].declarations),
      tinygo_lowered_program_000_placeholder_block_count: () => 2,
      tinygo_lowered_program_000_placeholder_block_hash: () => expectedPlaceholderBlockHash(loweredIRManifest.units[0]),
      tinygo_lowered_program_000_placeholder_block_signature_hash: () => canonicalSignatureHash,
      tinygo_lowered_program_000_placeholder_block_runtime_hash: () => expectedPlaceholderBlockHash(loweredIRManifest.units[0]),
      tinygo_lowered_program_000_lowering_block_count: () => 2,
      tinygo_lowered_program_000_lowering_block_hash: () => expectedLoweringBlockHash(loweredIRManifest.units[0]),
      tinygo_lowered_program_000_lowering_block_runtime_hash: () => expectedLoweringBlockHash(loweredIRManifest.units[0]),
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    }, {
      get(target, prop) {
        if (typeof prop === 'string' && prop in target) {
          return target[prop as keyof typeof target]
        }
        return () => 0
      },
    }),
  } as unknown as WebAssembly.Instance

  assert.doesNotThrow(() => verifyTinyGoLoweredArtifactExports(instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: programSourceFiles,
      },
    ],
  }, sourceFileContents, loweredIRManifest))
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered placeholder block signature hashes', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nimport "fmt"\nfunc main() { fmt.Println("hi") }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 1,
      tinygo_lowered_program_000_import_path_hash: () => expectedImportPathHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nimport "fmt"\nfunc main() { fmt.Println("hi") }\n',
      }),
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_placeholder_block_count: () => 3,
      tinygo_lowered_program_000_placeholder_block_hash: () => expectedPlaceholderBlockHash({
        imports: [{ path: 'fmt' }],
        functions: [{ name: 'main', exported: false, method: false, main: true, init: false, parameters: 0, results: 0 }],
        declarations: [{ kind: 'function', name: 'main', exported: false, method: false }],
      }),
      tinygo_lowered_program_000_placeholder_block_signature_hash: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nimport "fmt"\nfunc main() { fmt.Println("hi") }\n',
  }, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        packageDir: '/workspace',
        sourceFiles: ['/workspace/main.go'],
        loweredSourcePath: '/working/tinygo-lowered/program-000.c',
        packageName: 'main',
        imports: [{ path: 'fmt' }],
        functions: [{ name: 'main', exported: false, method: false, main: true, init: false, parameters: 0, results: 0 }],
        types: [],
        constants: [],
        variables: [],
        declarations: [{ kind: 'function', name: 'main', exported: false, method: false }],
      },
    ],
  }), /frontend lowered artifact probe placeholder block signature hash did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered placeholder block runtime hashes', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nimport "fmt"\nfunc main() { fmt.Println("hi") }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 1,
      tinygo_lowered_program_000_import_path_hash: () => expectedImportPathHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nimport "fmt"\nfunc main() { fmt.Println("hi") }\n',
      }),
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_placeholder_block_count: () => 3,
      tinygo_lowered_program_000_placeholder_block_hash: () => expectedPlaceholderBlockHash({
        imports: [{ path: 'fmt' }],
        functions: [{ name: 'main', exported: false, method: false, main: true, init: false, parameters: 0, results: 0 }],
        declarations: [{ kind: 'function', name: 'main', exported: false, method: false }],
      }),
      tinygo_lowered_program_000_placeholder_block_signature_hash: () => expectedPlaceholderBlockSignatureHash({
        imports: [{ path: 'fmt' }],
        functions: [{ name: 'main', exported: false, method: false, main: true, init: false, parameters: 0, results: 0 }],
        declarations: [{ kind: 'function', name: 'main', exported: false, method: false }],
      }),
      tinygo_lowered_program_000_placeholder_block_runtime_hash: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nimport "fmt"\nfunc main() { fmt.Println("hi") }\n',
  }, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        packageDir: '/workspace',
        sourceFiles: ['/workspace/main.go'],
        loweredSourcePath: '/working/tinygo-lowered/program-000.c',
        packageName: 'main',
        imports: [{ path: 'fmt' }],
        functions: [{ name: 'main', exported: false, method: false, main: true, init: false, parameters: 0, results: 0 }],
        types: [],
        constants: [],
        variables: [],
        declarations: [{ kind: 'function', name: 'main', exported: false, method: false }],
      },
    ],
  }), /frontend lowered artifact probe placeholder block runtime hash did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered lowering block counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nimport "fmt"\nfunc main() { fmt.Println("hi") }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 1,
      tinygo_lowered_program_000_import_path_hash: () => expectedImportPathHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nimport "fmt"\nfunc main() { fmt.Println("hi") }\n',
      }),
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_placeholder_block_count: () => 3,
      tinygo_lowered_program_000_lowering_block_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nimport "fmt"\nfunc main() { fmt.Println("hi") }\n',
  }, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        packageDir: '/workspace',
        sourceFiles: ['/workspace/main.go'],
        loweredSourcePath: '/working/tinygo-lowered/program-000.c',
        packageName: 'main',
        imports: [{ path: 'fmt' }],
        functions: [{ name: 'main', exported: false, method: false, main: true, init: false, parameters: 0, results: 0 }],
        types: [],
        constants: [],
        variables: [],
        declarations: [{ kind: 'function', name: 'main', exported: false, method: false }],
      },
    ],
  }), /frontend lowered artifact probe lowering block count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered lowering block hashes', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nimport "fmt"\nfunc main() { fmt.Println("hi") }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 1,
      tinygo_lowered_program_000_import_path_hash: () => expectedImportPathHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nimport "fmt"\nfunc main() { fmt.Println("hi") }\n',
      }),
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_placeholder_block_count: () => 3,
      tinygo_lowered_program_000_lowering_block_count: () => 3,
      tinygo_lowered_program_000_lowering_block_hash: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nimport "fmt"\nfunc main() { fmt.Println("hi") }\n',
  }, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        packageDir: '/workspace',
        sourceFiles: ['/workspace/main.go'],
        loweredSourcePath: '/working/tinygo-lowered/program-000.c',
        packageName: 'main',
        imports: [{ path: 'fmt' }],
        functions: [{ name: 'main', exported: false, method: false, main: true, init: false, parameters: 0, results: 0 }],
        types: [],
        constants: [],
        variables: [],
        declarations: [{ kind: 'function', name: 'main', exported: false, method: false }],
      },
    ],
  }), /frontend lowered artifact probe lowering block hash did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports uses lowered IR lowering blocks as the lowering block hash source of truth', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => expectedImportPathHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_placeholder_block_count: () => 2,
      tinygo_lowered_program_000_lowering_block_count: () => 2,
      tinygo_lowered_program_000_lowering_block_hash: () => expectedLoweringBlockHash({
        id: 'program-000',
        kind: 'program',
        packageName: 'main',
        sourceFiles: ['/workspace/main.go'],
        functions: [{ name: 'main', exported: false, method: false, main: true, init: false, parameters: 0, results: 0 }],
        declarations: [{ kind: 'function', name: 'main', exported: false, method: false }],
      }),
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc main() {}\n',
  }, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        packageDir: '/workspace',
        sourceFiles: ['/workspace/main.go'],
        loweredSourcePath: '/working/tinygo-lowered/program-000.c',
        packageName: 'main',
        imports: [],
        functions: [{ name: 'main', exported: false, method: false, main: true, init: false, parameters: 0, results: 0 }],
        types: [],
        constants: [],
        variables: [],
        declarations: [{ kind: 'function', name: 'main', exported: false, method: false }],
        loweringBlocks: [
          {
            stage: 'function',
            index: 0,
            value: 'tampered lowering block',
          },
          {
            stage: 'declaration',
            index: 0,
            value: 'tinygo_lower_unit_begin("program-000", "program", "main", 1);tinygo_lower_declaration_begin("main", "function", "main");tinygo_emit_declaration_index(0);tinygo_emit_declaration_flags(0, 0);tinygo_emit_declaration_signature("function:main:0:0");tinygo_lower_declaration_end();tinygo_lower_unit_end()',
          },
        ],
      },
    ],
  }), /frontend lowered artifact probe lowering block hash did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered lowering block runtime hashes', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nimport "fmt"\nfunc main() { fmt.Println("hi") }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 1,
      tinygo_lowered_program_000_import_path_hash: () => expectedImportPathHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nimport "fmt"\nfunc main() { fmt.Println("hi") }\n',
      }),
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_placeholder_block_count: () => 3,
      tinygo_lowered_program_000_lowering_block_count: () => 3,
      tinygo_lowered_program_000_lowering_block_hash: () => expectedLoweringBlockHash({
        id: 'program-000',
        kind: 'program',
        packageName: 'main',
        sourceFiles: ['/workspace/main.go'],
        imports: [{ path: 'fmt' }],
        functions: [{ name: 'main', exported: false, method: false, main: true, init: false, parameters: 0, results: 0 }],
        declarations: [{ kind: 'function', name: 'main', exported: false, method: false }],
      }),
      tinygo_lowered_program_000_lowering_block_runtime_hash: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nimport "fmt"\nfunc main() { fmt.Println("hi") }\n',
  }, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        packageDir: '/workspace',
        sourceFiles: ['/workspace/main.go'],
        loweredSourcePath: '/working/tinygo-lowered/program-000.c',
        packageName: 'main',
        imports: [{ path: 'fmt' }],
        functions: [{ name: 'main', exported: false, method: false, main: true, init: false, parameters: 0, results: 0 }],
        types: [],
        constants: [],
        variables: [],
        declarations: [{ kind: 'function', name: 'main', exported: false, method: false }],
      },
    ],
  }), /frontend lowered artifact probe lowering block runtime hash did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered method counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype App struct{}\nfunc (App) Serve() {}\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 2,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 1,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 1,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\ntype App struct{}\nfunc (App) Serve() {}\nfunc main() {}\n',
  }), /frontend lowered artifact probe method count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered method name hashes', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype App struct{}\nfunc (App) Serve() {}\nfunc (App) Reset() {}\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 3,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype App struct{}\nfunc (App) Serve() {}\nfunc (App) Reset() {}\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_method_count: () => 2,
      tinygo_lowered_program_000_method_name_hash: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 1,
      tinygo_lowered_program_000_exported_type_count: () => 1,
      tinygo_lowered_program_000_struct_type_count: () => 1,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\ntype App struct{}\nfunc (App) Serve() {}\nfunc (App) Reset() {}\nfunc main() {}\n',
  }), /frontend lowered artifact probe method name hash did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered exported function counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc Hello() {}\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 2,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc Hello() {}\nfunc main() {}\n',
  }), /frontend lowered artifact probe exported function count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered exported function name hashes', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc helper() {}\nfunc Hello() {}\nfunc Exported() {}\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 4,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc helper() {}\nfunc Hello() {}\nfunc Exported() {}\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 2,
      tinygo_lowered_program_000_exported_function_name_hash: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc helper() {}\nfunc Hello() {}\nfunc Exported() {}\nfunc main() {}\n',
  }), /frontend lowered artifact probe exported function name hash did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered exported method name hashes', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype App struct{}\nfunc (App) serve() {}\nfunc (App) Reset() {}\nfunc (App) Start() {}\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 4,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype App struct{}\nfunc (App) serve() {}\nfunc (App) Reset() {}\nfunc (App) Start() {}\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_method_count: () => 3,
      tinygo_lowered_program_000_method_name_hash: () => expectedMethodNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype App struct{}\nfunc (App) serve() {}\nfunc (App) Reset() {}\nfunc (App) Start() {}\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_exported_method_name_hash: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 1,
      tinygo_lowered_program_000_exported_type_count: () => 1,
      tinygo_lowered_program_000_struct_type_count: () => 1,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_const_name_hash: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_exported_var_name_hash: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\ntype App struct{}\nfunc (App) serve() {}\nfunc (App) Reset() {}\nfunc (App) Start() {}\nfunc main() {}\n',
  }), /frontend lowered artifact probe exported method name hash did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered exported method signature hashes', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype App struct{}\nfunc (App) serve() {}\nfunc (App) Reset() error { return nil }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_blank_import_count: () => 0,
      tinygo_lowered_program_000_dot_import_count: () => 0,
      tinygo_lowered_program_000_aliased_import_count: () => 0,
      tinygo_lowered_program_000_function_count: () => 3,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype App struct{}\nfunc (App) serve() {}\nfunc (App) Reset() error { return nil }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_func_literal_count: () => 0,
      tinygo_lowered_program_000_func_parameter_count: () => 0,
      tinygo_lowered_program_000_func_result_count: () => 1,
      tinygo_lowered_program_000_variadic_parameter_count: () => 0,
      tinygo_lowered_program_000_named_result_count: () => 0,
      tinygo_lowered_program_000_type_parameter_count: () => 0,
      tinygo_lowered_program_000_generic_function_count: () => 0,
      tinygo_lowered_program_000_generic_type_count: () => 0,
      tinygo_lowered_program_000_call_expression_count: () => 0,
      tinygo_lowered_program_000_builtin_call_count: () => 0,
      tinygo_lowered_program_000_append_call_count: () => 0,
      tinygo_lowered_program_000_len_call_count: () => 0,
      tinygo_lowered_program_000_make_call_count: () => 0,
      tinygo_lowered_program_000_cap_call_count: () => 0,
      tinygo_lowered_program_000_copy_call_count: () => 0,
      tinygo_lowered_program_000_panic_call_count: () => 0,
      tinygo_lowered_program_000_recover_call_count: () => 0,
      tinygo_lowered_program_000_new_call_count: () => 0,
      tinygo_lowered_program_000_delete_call_count: () => 0,
      tinygo_lowered_program_000_composite_literal_count: () => 0,
      tinygo_lowered_program_000_selector_expression_count: () => 0,
      tinygo_lowered_program_000_selector_name_hash: () => 0,
      tinygo_lowered_program_000_index_expression_count: () => 0,
      tinygo_lowered_program_000_slice_expression_count: () => 0,
      tinygo_lowered_program_000_key_value_expression_count: () => 0,
      tinygo_lowered_program_000_type_assertion_count: () => 0,
      tinygo_lowered_program_000_blank_identifier_count: () => 0,
      tinygo_lowered_program_000_blank_assignment_target_count: () => 0,
      tinygo_lowered_program_000_unary_expression_count: () => 0,
      tinygo_lowered_program_000_binary_expression_count: () => 0,
      tinygo_lowered_program_000_send_statement_count: () => 0,
      tinygo_lowered_program_000_receive_expression_count: () => 0,
      tinygo_lowered_program_000_assign_statement_count: () => 0,
      tinygo_lowered_program_000_define_statement_count: () => 0,
      tinygo_lowered_program_000_inc_statement_count: () => 0,
      tinygo_lowered_program_000_dec_statement_count: () => 0,
      tinygo_lowered_program_000_return_statement_count: () => 1,
      tinygo_lowered_program_000_go_statement_count: () => 0,
      tinygo_lowered_program_000_defer_statement_count: () => 0,
      tinygo_lowered_program_000_if_statement_count: () => 0,
      tinygo_lowered_program_000_range_statement_count: () => 0,
      tinygo_lowered_program_000_switch_statement_count: () => 0,
      tinygo_lowered_program_000_type_switch_statement_count: () => 0,
      tinygo_lowered_program_000_type_switch_case_clause_count: () => 0,
      tinygo_lowered_program_000_type_switch_guard_name_hash: () => 0,
      tinygo_lowered_program_000_type_switch_case_type_hash: () => 0,
      tinygo_lowered_program_000_select_statement_count: () => 0,
      tinygo_lowered_program_000_switch_case_clause_count: () => 0,
      tinygo_lowered_program_000_select_comm_clause_count: () => 0,
      tinygo_lowered_program_000_for_statement_count: () => 0,
      tinygo_lowered_program_000_break_statement_count: () => 0,
      tinygo_lowered_program_000_break_label_name_hash: () => 0,
      tinygo_lowered_program_000_continue_statement_count: () => 0,
      tinygo_lowered_program_000_continue_label_name_hash: () => 0,
      tinygo_lowered_program_000_labeled_statement_count: () => 0,
      tinygo_lowered_program_000_label_name_hash: () => 0,
      tinygo_lowered_program_000_goto_statement_count: () => 0,
      tinygo_lowered_program_000_goto_label_name_hash: () => 0,
      tinygo_lowered_program_000_fallthrough_statement_count: () => 0,
      tinygo_lowered_program_000_method_count: () => 2,
      tinygo_lowered_program_000_method_name_hash: () => expectedMethodNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype App struct{}\nfunc (App) serve() {}\nfunc (App) Reset() error { return nil }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_method_signature_hash: () => expectedMethodSignatureHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype App struct{}\nfunc (App) serve() {}\nfunc (App) Reset() error { return nil }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_exported_method_name_hash: () => expectedExportedMethodNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype App struct{}\nfunc (App) serve() {}\nfunc (App) Reset() error { return nil }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_exported_method_signature_hash: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_exported_function_name_hash: () => 0,
      tinygo_lowered_program_000_type_count: () => 1,
      tinygo_lowered_program_000_type_name_hash: () => expectedTypeNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype App struct{}\nfunc (App) serve() {}\nfunc (App) Reset() error { return nil }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_exported_type_count: () => 1,
      tinygo_lowered_program_000_exported_type_name_hash: () => expectedExportedTypeNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype App struct{}\nfunc (App) serve() {}\nfunc (App) Reset() error { return nil }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_struct_type_count: () => 1,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_map_type_count: () => 0,
      tinygo_lowered_program_000_chan_type_count: () => 0,
      tinygo_lowered_program_000_send_only_chan_type_count: () => 0,
      tinygo_lowered_program_000_receive_only_chan_type_count: () => 0,
      tinygo_lowered_program_000_array_type_count: () => 0,
      tinygo_lowered_program_000_slice_type_count: () => 0,
      tinygo_lowered_program_000_pointer_type_count: () => 0,
      tinygo_lowered_program_000_struct_field_count: () => 0,
      tinygo_lowered_program_000_embedded_struct_field_count: () => 0,
      tinygo_lowered_program_000_tagged_struct_field_count: () => 0,
      tinygo_lowered_program_000_struct_field_name_hash: () => 0,
      tinygo_lowered_program_000_struct_field_type_hash: () => 0,
      tinygo_lowered_program_000_embedded_struct_field_type_hash: () => 0,
      tinygo_lowered_program_000_tagged_struct_field_tag_hash: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_interface_method_name_hash: () => 0,
      tinygo_lowered_program_000_interface_method_signature_hash: () => 0,
      tinygo_lowered_program_000_embedded_interface_method_count: () => 0,
      tinygo_lowered_program_000_embedded_interface_method_name_hash: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_const_name_hash: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_var_name_hash: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_const_name_hash: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_exported_var_name_hash: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\ntype App struct{}\nfunc (App) serve() {}\nfunc (App) Reset() error { return nil }\nfunc main() {}\n',
  }), /frontend lowered artifact probe exported method signature hash did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered method signature hashes', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
      exports: {
        tinygo_lowered_program_000_kind_tag: () => 1,
        tinygo_lowered_program_000_source_file_count: () => 1,
        tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
          '/workspace/main.go': 'package main\ntype App struct{}\nfunc (App) Run() {}\nfunc main() {}\n',
        }),
        tinygo_lowered_program_000_import_count: () => 0,
        tinygo_lowered_program_000_import_path_hash: () => 0,
        tinygo_lowered_program_000_blank_import_count: () => 0,
        tinygo_lowered_program_000_dot_import_count: () => 0,
        tinygo_lowered_program_000_aliased_import_count: () => 0,
        tinygo_lowered_program_000_function_count: () => 2,
        tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
          '/workspace/main.go': 'package main\ntype App struct{}\nfunc (App) Run() {}\nfunc main() {}\n',
        }),
        tinygo_lowered_program_000_func_literal_count: () => 0,
        tinygo_lowered_program_000_func_parameter_count: () => 0,
        tinygo_lowered_program_000_func_result_count: () => 0,
        tinygo_lowered_program_000_variadic_parameter_count: () => 0,
        tinygo_lowered_program_000_named_result_count: () => 0,
        tinygo_lowered_program_000_type_parameter_count: () => 0,
        tinygo_lowered_program_000_generic_function_count: () => 0,
        tinygo_lowered_program_000_generic_type_count: () => 0,
        tinygo_lowered_program_000_call_expression_count: () => 0,
        tinygo_lowered_program_000_builtin_call_count: () => 0,
        tinygo_lowered_program_000_append_call_count: () => 0,
        tinygo_lowered_program_000_len_call_count: () => 0,
        tinygo_lowered_program_000_make_call_count: () => 0,
        tinygo_lowered_program_000_cap_call_count: () => 0,
        tinygo_lowered_program_000_copy_call_count: () => 0,
        tinygo_lowered_program_000_panic_call_count: () => 0,
        tinygo_lowered_program_000_recover_call_count: () => 0,
        tinygo_lowered_program_000_new_call_count: () => 0,
        tinygo_lowered_program_000_delete_call_count: () => 0,
        tinygo_lowered_program_000_composite_literal_count: () => 0,
        tinygo_lowered_program_000_selector_expression_count: () => 0,
        tinygo_lowered_program_000_selector_name_hash: () => 0,
        tinygo_lowered_program_000_index_expression_count: () => 0,
        tinygo_lowered_program_000_slice_expression_count: () => 0,
        tinygo_lowered_program_000_key_value_expression_count: () => 0,
        tinygo_lowered_program_000_type_assertion_count: () => 0,
        tinygo_lowered_program_000_blank_identifier_count: () => 0,
        tinygo_lowered_program_000_blank_assignment_target_count: () => 0,
        tinygo_lowered_program_000_unary_expression_count: () => 0,
        tinygo_lowered_program_000_binary_expression_count: () => 0,
        tinygo_lowered_program_000_send_statement_count: () => 0,
        tinygo_lowered_program_000_receive_expression_count: () => 0,
        tinygo_lowered_program_000_assign_statement_count: () => 0,
        tinygo_lowered_program_000_define_statement_count: () => 0,
        tinygo_lowered_program_000_inc_statement_count: () => 0,
        tinygo_lowered_program_000_dec_statement_count: () => 0,
        tinygo_lowered_program_000_return_statement_count: () => 0,
        tinygo_lowered_program_000_go_statement_count: () => 0,
        tinygo_lowered_program_000_defer_statement_count: () => 0,
        tinygo_lowered_program_000_if_statement_count: () => 0,
        tinygo_lowered_program_000_range_statement_count: () => 0,
        tinygo_lowered_program_000_switch_statement_count: () => 0,
        tinygo_lowered_program_000_type_switch_statement_count: () => 0,
        tinygo_lowered_program_000_type_switch_case_clause_count: () => 0,
        tinygo_lowered_program_000_type_switch_guard_name_hash: () => 0,
        tinygo_lowered_program_000_type_switch_case_type_hash: () => 0,
        tinygo_lowered_program_000_select_statement_count: () => 0,
        tinygo_lowered_program_000_switch_case_clause_count: () => 0,
        tinygo_lowered_program_000_select_comm_clause_count: () => 0,
        tinygo_lowered_program_000_for_statement_count: () => 0,
        tinygo_lowered_program_000_break_statement_count: () => 0,
        tinygo_lowered_program_000_break_label_name_hash: () => 0,
        tinygo_lowered_program_000_continue_statement_count: () => 0,
        tinygo_lowered_program_000_continue_label_name_hash: () => 0,
        tinygo_lowered_program_000_labeled_statement_count: () => 0,
        tinygo_lowered_program_000_label_name_hash: () => 0,
        tinygo_lowered_program_000_goto_statement_count: () => 0,
        tinygo_lowered_program_000_goto_label_name_hash: () => 0,
        tinygo_lowered_program_000_fallthrough_statement_count: () => 0,
        tinygo_lowered_program_000_method_count: () => 1,
        tinygo_lowered_program_000_method_name_hash: () => expectedMethodNameHash(['/workspace/main.go'], {
          '/workspace/main.go': 'package main\ntype App struct{}\nfunc (App) Run() {}\nfunc main() {}\n',
        }),
        tinygo_lowered_program_000_method_signature_hash: () => 0,
        tinygo_lowered_program_000_exported_method_name_hash: () => expectedExportedMethodNameHash(['/workspace/main.go'], {
          '/workspace/main.go': 'package main\ntype App struct{}\nfunc (App) Run() {}\nfunc main() {}\n',
        }),
        tinygo_lowered_program_000_exported_function_count: () => 0,
        tinygo_lowered_program_000_exported_function_name_hash: () => 0,
        tinygo_lowered_program_000_type_count: () => 1,
        tinygo_lowered_program_000_type_name_hash: () => expectedTypeNameHash(['/workspace/main.go'], {
          '/workspace/main.go': 'package main\ntype App struct{}\nfunc (App) Run() {}\nfunc main() {}\n',
        }),
        tinygo_lowered_program_000_exported_type_count: () => 1,
        tinygo_lowered_program_000_exported_type_name_hash: () => expectedExportedTypeNameHash(['/workspace/main.go'], {
          '/workspace/main.go': 'package main\ntype App struct{}\nfunc (App) Run() {}\nfunc main() {}\n',
        }),
        tinygo_lowered_program_000_struct_type_count: () => 1,
        tinygo_lowered_program_000_interface_type_count: () => 0,
        tinygo_lowered_program_000_map_type_count: () => 0,
        tinygo_lowered_program_000_chan_type_count: () => 0,
        tinygo_lowered_program_000_send_only_chan_type_count: () => 0,
        tinygo_lowered_program_000_receive_only_chan_type_count: () => 0,
        tinygo_lowered_program_000_array_type_count: () => 0,
        tinygo_lowered_program_000_slice_type_count: () => 0,
        tinygo_lowered_program_000_pointer_type_count: () => 0,
        tinygo_lowered_program_000_struct_field_count: () => 0,
        tinygo_lowered_program_000_embedded_struct_field_count: () => 0,
        tinygo_lowered_program_000_tagged_struct_field_count: () => 0,
        tinygo_lowered_program_000_struct_field_name_hash: () => 0,
        tinygo_lowered_program_000_struct_field_type_hash: () => 0,
        tinygo_lowered_program_000_embedded_struct_field_type_hash: () => 0,
        tinygo_lowered_program_000_tagged_struct_field_tag_hash: () => 0,
        tinygo_lowered_program_000_interface_method_count: () => 0,
        tinygo_lowered_program_000_interface_method_name_hash: () => 0,
        tinygo_lowered_program_000_interface_method_signature_hash: () => 0,
        tinygo_lowered_program_000_embedded_interface_method_count: () => 0,
        tinygo_lowered_program_000_embedded_interface_method_name_hash: () => 0,
        tinygo_lowered_program_000_const_count: () => 0,
        tinygo_lowered_program_000_const_name_hash: () => 0,
        tinygo_lowered_program_000_var_count: () => 0,
        tinygo_lowered_program_000_var_name_hash: () => 0,
        tinygo_lowered_program_000_exported_const_count: () => 0,
        tinygo_lowered_program_000_exported_const_name_hash: () => 0,
        tinygo_lowered_program_000_exported_var_count: () => 0,
        tinygo_lowered_program_000_exported_var_name_hash: () => 0,
        tinygo_lowered_program_000_main_count: () => 1,
        tinygo_lowered_program_000_init_count: () => 0,
      },
    } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\ntype App struct{}\nfunc (App) Run() {}\nfunc main() {}\n',
  }), /frontend lowered artifact probe method signature hash did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered type counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype App struct{}\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 1,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\ntype App struct{}\nfunc main() {}\n',
  }), /frontend lowered artifact probe type count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered exported type counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype App struct{}\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 1,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 1,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\ntype App struct{}\nfunc main() {}\n',
  }), /frontend lowered artifact probe exported type count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered const counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nconst Version = 1\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nconst Version = 1\nfunc main() {}\n',
  }), /frontend lowered artifact probe const count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered var counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nvar ready = true\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nvar ready = true\nfunc main() {}\n',
  }), /frontend lowered artifact probe var count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered exported const counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nconst Version = 1\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 1,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nconst Version = 1\nfunc main() {}\n',
  }), /frontend lowered artifact probe exported const count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered exported var counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nvar Ready = true\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 1,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nvar Ready = true\nfunc main() {}\n',
  }), /frontend lowered artifact probe exported var count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered struct type counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype App struct{}\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 1,
      tinygo_lowered_program_000_exported_type_count: () => 1,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\ntype App struct{}\nfunc main() {}\n',
  }), /frontend lowered artifact probe struct type count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered interface type counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype Service interface{ Run() }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 1,
      tinygo_lowered_program_000_exported_type_count: () => 1,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\ntype Service interface{ Run() }\nfunc main() {}\n',
  }), /frontend lowered artifact probe interface type count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered map type counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc probe(items map[string]int) { _ = items }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_map_type_count: () => 0,
      tinygo_lowered_program_000_chan_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc probe(items map[string]int) { _ = items }\n',
  }), /frontend lowered artifact probe map type count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered chan type counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc probe(input chan int, output chan<- int, recv <-chan int) { _ = input; _ = output; _ = recv }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_map_type_count: () => 0,
      tinygo_lowered_program_000_chan_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc probe(input chan int, output chan<- int, recv <-chan int) { _ = input; _ = output; _ = recv }\n',
  }), /frontend lowered artifact probe chan type count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered send-only chan type counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc probe(input chan int, output chan<- int, recv <-chan int) { _ = input; _ = output; _ = recv }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_map_type_count: () => 0,
      tinygo_lowered_program_000_chan_type_count: () => 3,
      tinygo_lowered_program_000_send_only_chan_type_count: () => 0,
      tinygo_lowered_program_000_receive_only_chan_type_count: () => 1,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc probe(input chan int, output chan<- int, recv <-chan int) { _ = input; _ = output; _ = recv }\n',
  }), /frontend lowered artifact probe send-only chan type count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered receive-only chan type counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc probe(input chan int, output chan<- int, recv <-chan int) { _ = input; _ = output; _ = recv }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_map_type_count: () => 0,
      tinygo_lowered_program_000_chan_type_count: () => 3,
      tinygo_lowered_program_000_send_only_chan_type_count: () => 1,
      tinygo_lowered_program_000_receive_only_chan_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc probe(input chan int, output chan<- int, recv <-chan int) { _ = input; _ = output; _ = recv }\n',
  }), /frontend lowered artifact probe receive-only chan type count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered array type counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nfunc probe(items [3]int, slice []string) { _ = items; _ = slice }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_map_type_count: () => 0,
      tinygo_lowered_program_000_chan_type_count: () => 0,
      tinygo_lowered_program_000_array_type_count: () => 0,
      tinygo_lowered_program_000_pointer_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nfunc probe(items [3]int, slice []string) { _ = items; _ = slice }\n',
  }), /frontend lowered artifact probe array type count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered pointer type counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype Item struct{}\nfunc probe(ptr *Item, nested **Item) { _ = ptr; _ = nested }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 1,
      tinygo_lowered_program_000_exported_type_count: () => 1,
      tinygo_lowered_program_000_struct_type_count: () => 1,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_map_type_count: () => 0,
      tinygo_lowered_program_000_chan_type_count: () => 0,
      tinygo_lowered_program_000_array_type_count: () => 0,
      tinygo_lowered_program_000_pointer_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 0,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\ntype Item struct{}\nfunc probe(ptr *Item, nested **Item) { _ = ptr; _ = nested }\n',
  }), /frontend lowered artifact probe pointer type count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered slice type counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype Bag struct{ Values []int }\nfunc main(items []byte, nested [][]string) { _ = items; _ = nested }\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 1,
      tinygo_lowered_program_000_exported_type_count: () => 1,
      tinygo_lowered_program_000_struct_type_count: () => 1,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_map_type_count: () => 0,
      tinygo_lowered_program_000_chan_type_count: () => 0,
      tinygo_lowered_program_000_array_type_count: () => 4,
      tinygo_lowered_program_000_slice_type_count: () => 0,
      tinygo_lowered_program_000_pointer_type_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\ntype Bag struct{ Values []int }\nfunc main(items []byte, nested [][]string) { _ = items; _ = nested }\n',
  }), /frontend lowered artifact probe slice type count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered struct field counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype App struct{ Name string }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 1,
      tinygo_lowered_program_000_exported_type_count: () => 1,
      tinygo_lowered_program_000_struct_type_count: () => 1,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_struct_field_count: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\ntype App struct{ Name string }\nfunc main() {}\n',
  }), /frontend lowered artifact probe struct field count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered interface method counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype Service interface{ Run() }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 1,
      tinygo_lowered_program_000_exported_type_count: () => 1,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 1,
      tinygo_lowered_program_000_struct_field_count: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\ntype Service interface{ Run() }\nfunc main() {}\n',
  }), /frontend lowered artifact probe interface method count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered embedded struct field counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype Base struct{}\ntype App struct{ Base; Name string }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 2,
      tinygo_lowered_program_000_exported_type_count: () => 2,
      tinygo_lowered_program_000_struct_type_count: () => 2,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_struct_field_count: () => 2,
      tinygo_lowered_program_000_embedded_struct_field_count: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_embedded_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\ntype Base struct{}\ntype App struct{ Base; Name string }\nfunc main() {}\n',
  }), /frontend lowered artifact probe embedded struct field count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered embedded struct field type hashes', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype Base struct{}\ntype Named struct{}\ntype App struct{ Base; Named; Name string }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype Base struct{}\ntype Named struct{}\ntype App struct{ Base; Named; Name string }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 3,
      tinygo_lowered_program_000_type_name_hash: () => expectedTypeNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype Base struct{}\ntype Named struct{}\ntype App struct{ Base; Named; Name string }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_exported_type_count: () => 3,
      tinygo_lowered_program_000_exported_type_name_hash: () => expectedExportedTypeNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype Base struct{}\ntype Named struct{}\ntype App struct{ Base; *Named; Name string }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_struct_type_count: () => 3,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_map_type_count: () => 0,
      tinygo_lowered_program_000_chan_type_count: () => 0,
      tinygo_lowered_program_000_send_only_chan_type_count: () => 0,
      tinygo_lowered_program_000_receive_only_chan_type_count: () => 0,
      tinygo_lowered_program_000_array_type_count: () => 0,
      tinygo_lowered_program_000_slice_type_count: () => 0,
      tinygo_lowered_program_000_pointer_type_count: () => 0,
      tinygo_lowered_program_000_struct_field_count: () => 3,
      tinygo_lowered_program_000_embedded_struct_field_count: () => 2,
      tinygo_lowered_program_000_tagged_struct_field_count: () => 0,
      tinygo_lowered_program_000_struct_field_name_hash: () => expectedStructFieldNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype Base struct{}\ntype Named struct{}\ntype App struct{ Base; Named; Name string }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_struct_field_type_hash: () => expectedStructFieldTypeHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype Base struct{}\ntype Named struct{}\ntype App struct{ Base; Named; Name string }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_embedded_struct_field_type_hash: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_interface_method_name_hash: () => 0,
      tinygo_lowered_program_000_embedded_interface_method_count: () => 0,
      tinygo_lowered_program_000_embedded_interface_method_name_hash: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\ntype Base struct{}\ntype Named struct{}\ntype App struct{ Base; Named; Name string }\nfunc main() {}\n',
  }), /frontend lowered artifact probe embedded struct field type hash did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered embedded interface method counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype Runner interface{ Run() }\ntype Service interface{ Runner; Close() }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 2,
      tinygo_lowered_program_000_exported_type_count: () => 2,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 2,
      tinygo_lowered_program_000_struct_field_count: () => 0,
      tinygo_lowered_program_000_embedded_struct_field_count: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 3,
      tinygo_lowered_program_000_interface_method_name_hash: () => expectedInterfaceMethodNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype Runner interface{ Run() }\ntype Service interface{ Runner; Close() }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_interface_method_signature_hash: () => expectedInterfaceMethodSignatureHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype Runner interface{ Run() }\ntype Service interface{ Runner; Close() }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_embedded_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\ntype Runner interface{ Run() }\ntype Service interface{ Runner; Close() }\nfunc main() {}\n',
  }), /frontend lowered artifact probe embedded interface method count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered interface method name hashes', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype Runner interface{ Run() }\ntype Service interface{ Runner; Close(); Reset() error }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 2,
      tinygo_lowered_program_000_exported_type_count: () => 2,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 2,
      tinygo_lowered_program_000_struct_field_count: () => 0,
      tinygo_lowered_program_000_embedded_struct_field_count: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 4,
      tinygo_lowered_program_000_interface_method_name_hash: () => 0,
      tinygo_lowered_program_000_embedded_interface_method_count: () => 1,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\ntype Runner interface{ Run() }\ntype Service interface{ Runner; Close(); Reset() error }\nfunc main() {}\n',
  }), /frontend lowered artifact probe interface method name hash did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered interface method signature hashes', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype Runner interface{ Run() }\ntype Service interface{ Runner; Close(); Reset() error }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 2,
      tinygo_lowered_program_000_exported_type_count: () => 2,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 2,
      tinygo_lowered_program_000_struct_field_count: () => 0,
      tinygo_lowered_program_000_embedded_struct_field_count: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 4,
      tinygo_lowered_program_000_interface_method_name_hash: () => expectedInterfaceMethodNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype Runner interface{ Run() }\ntype Service interface{ Runner; Close(); Reset() error }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_interface_method_signature_hash: () => 0,
      tinygo_lowered_program_000_embedded_interface_method_count: () => 1,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\ntype Runner interface{ Run() }\ntype Service interface{ Runner; Close(); Reset() error }\nfunc main() {}\n',
  }), /frontend lowered artifact probe interface method signature hash did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered embedded interface method name hashes', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype Runner interface{ Run() }\ntype Closer interface{ Close() }\ntype Service interface{ Runner; Closer; Reset() error }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 3,
      tinygo_lowered_program_000_exported_type_count: () => 3,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 3,
      tinygo_lowered_program_000_struct_field_count: () => 0,
      tinygo_lowered_program_000_embedded_struct_field_count: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 5,
      tinygo_lowered_program_000_interface_method_name_hash: () => expectedInterfaceMethodNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype Runner interface{ Run() }\ntype Closer interface{ Close() }\ntype Service interface{ Runner; Closer; Reset() error }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_interface_method_signature_hash: () => expectedInterfaceMethodSignatureHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype Runner interface{ Run() }\ntype Closer interface{ Close() }\ntype Service interface{ Runner; Closer; Reset() error }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_embedded_interface_method_name_hash: () => 0,
      tinygo_lowered_program_000_embedded_interface_method_count: () => 2,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\ntype Runner interface{ Run() }\ntype Closer interface{ Close() }\ntype Service interface{ Runner; Closer; Reset() error }\nfunc main() {}\n',
  }), /frontend lowered artifact probe embedded interface method name hash did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered type name hashes', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype runner struct{}\ntype App struct{}\ntype Service interface{ Run() }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 3,
      tinygo_lowered_program_000_type_name_hash: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 2,
      tinygo_lowered_program_000_struct_type_count: () => 2,
      tinygo_lowered_program_000_interface_type_count: () => 1,
      tinygo_lowered_program_000_struct_field_count: () => 0,
      tinygo_lowered_program_000_embedded_struct_field_count: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 1,
      tinygo_lowered_program_000_interface_method_name_hash: () => expectedInterfaceMethodNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype runner struct{}\ntype App struct{}\ntype Service interface{ Run() }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_embedded_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\ntype runner struct{}\ntype App struct{}\ntype Service interface{ Run() }\nfunc main() {}\n',
  }), /frontend lowered artifact probe type name hash did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered exported type name hashes', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype runner struct{}\ntype App struct{}\ntype service interface{ Run() }\ntype Public interface{ Close() }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 4,
      tinygo_lowered_program_000_type_name_hash: () => expectedTypeNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype runner struct{}\ntype App struct{}\ntype service interface{ Run() }\ntype Public interface{ Close() }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_exported_type_count: () => 2,
      tinygo_lowered_program_000_exported_type_name_hash: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 2,
      tinygo_lowered_program_000_interface_type_count: () => 2,
      tinygo_lowered_program_000_struct_field_count: () => 0,
      tinygo_lowered_program_000_embedded_struct_field_count: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 2,
      tinygo_lowered_program_000_interface_method_name_hash: () => expectedInterfaceMethodNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype runner struct{}\ntype App struct{}\ntype service interface{ Run() }\ntype Public interface{ Close() }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_embedded_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_const_name_hash: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_var_name_hash: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\ntype runner struct{}\ntype App struct{}\ntype service interface{ Run() }\ntype Public interface{ Close() }\nfunc main() {}\n',
  }), /frontend lowered artifact probe exported type name hash did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered const name hashes', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nconst (\n\tversion = 1\n\tAppName = "wasm"\n)\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_struct_field_count: () => 0,
      tinygo_lowered_program_000_embedded_struct_field_count: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_embedded_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 2,
      tinygo_lowered_program_000_const_name_hash: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 1,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nconst (\n\tversion = 1\n\tAppName = "wasm"\n)\nfunc main() {}\n',
  }), /frontend lowered artifact probe const name hash did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered var name hashes', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nvar (\n\tready = true\n\tAppState = "boot"\n)\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_struct_field_count: () => 0,
      tinygo_lowered_program_000_embedded_struct_field_count: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_embedded_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_const_name_hash: () => 0,
      tinygo_lowered_program_000_var_count: () => 2,
      tinygo_lowered_program_000_var_name_hash: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 1,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nvar (\n\tready = true\n\tAppState = "boot"\n)\nfunc main() {}\n',
  }), /frontend lowered artifact probe var name hash did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered exported const name hashes', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nconst (\n\tversion = 1\n\tAppName = "wasm"\n\tBuild, Ready = 1, 2\n)\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_struct_field_count: () => 0,
      tinygo_lowered_program_000_embedded_struct_field_count: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_embedded_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 3,
      tinygo_lowered_program_000_const_name_hash: () => expectedConstNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nconst (\n\tversion = 1\n\tAppName = "wasm"\n\tBuild, Ready = 1, 2\n)\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 3,
      tinygo_lowered_program_000_exported_const_name_hash: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nconst (\n\tversion = 1\n\tAppName = "wasm"\n\tBuild, Ready = 1, 2\n)\nfunc main() {}\n',
  }), /frontend lowered artifact probe exported const name hash did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered exported var name hashes', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nvar (\n\tready = true\n\tAppState = "boot"\n\tCount, Size = 1, 2\n)\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 0,
      tinygo_lowered_program_000_exported_type_count: () => 0,
      tinygo_lowered_program_000_struct_type_count: () => 0,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_struct_field_count: () => 0,
      tinygo_lowered_program_000_embedded_struct_field_count: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_embedded_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_const_name_hash: () => 0,
      tinygo_lowered_program_000_var_count: () => 3,
      tinygo_lowered_program_000_var_name_hash: () => expectedVarNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\nvar (\n\tready = true\n\tAppState = "boot"\n\tCount, Size = 1, 2\n)\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_const_name_hash: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 3,
      tinygo_lowered_program_000_exported_var_name_hash: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\nvar (\n\tready = true\n\tAppState = "boot"\n\tCount, Size = 1, 2\n)\nfunc main() {}\n',
  }), /frontend lowered artifact probe exported var name hash did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered tagged struct field counts', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype App struct{ Name string `json:"name"`; Count int `json:"count"`; Ready bool }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 1,
      tinygo_lowered_program_000_exported_type_count: () => 1,
      tinygo_lowered_program_000_struct_type_count: () => 1,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_struct_field_count: () => 3,
      tinygo_lowered_program_000_embedded_struct_field_count: () => 0,
      tinygo_lowered_program_000_tagged_struct_field_count: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_embedded_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\ntype App struct{ Name string `json:"name"`; Count int `json:"count"`; Ready bool }\nfunc main() {}\n',
  }), /frontend lowered artifact probe tagged struct field count did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered tagged struct field tag hashes', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype App struct{ Name string `json:\"name\"`; Count int `db:\"count\"`; Ready bool }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_function_name_hash: () => expectedFunctionNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype App struct{ Name string `json:\"name\"`; Count int `db:\"count\"`; Ready bool }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 1,
      tinygo_lowered_program_000_type_name_hash: () => expectedTypeNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype App struct{ Name string `json:\"name\"`; Count int `db:\"count\"`; Ready bool }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_exported_type_count: () => 1,
      tinygo_lowered_program_000_exported_type_name_hash: () => expectedExportedTypeNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype App struct{ Name string `json:\"name\"`; Count int `db:\"count\"`; Ready bool }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_struct_type_count: () => 1,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_map_type_count: () => 0,
      tinygo_lowered_program_000_chan_type_count: () => 0,
      tinygo_lowered_program_000_send_only_chan_type_count: () => 0,
      tinygo_lowered_program_000_receive_only_chan_type_count: () => 0,
      tinygo_lowered_program_000_array_type_count: () => 0,
      tinygo_lowered_program_000_slice_type_count: () => 0,
      tinygo_lowered_program_000_pointer_type_count: () => 0,
      tinygo_lowered_program_000_struct_field_count: () => 3,
      tinygo_lowered_program_000_embedded_struct_field_count: () => 0,
      tinygo_lowered_program_000_tagged_struct_field_count: () => 2,
      tinygo_lowered_program_000_struct_field_name_hash: () => expectedStructFieldNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype App struct{ Name string `json:\"name\"`; Count int `db:\"count\"`; Ready bool }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_struct_field_type_hash: () => expectedStructFieldTypeHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype App struct{ Name string `json:\"name\"`; Count int `db:\"count\"`; Ready bool }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_embedded_struct_field_type_hash: () => 0,
      tinygo_lowered_program_000_tagged_struct_field_tag_hash: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_interface_method_name_hash: () => 0,
      tinygo_lowered_program_000_embedded_interface_method_count: () => 0,
      tinygo_lowered_program_000_embedded_interface_method_name_hash: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\ntype App struct{ Name string `json:\"name\"`; Count int `db:\"count\"`; Ready bool }\nfunc main() {}\n',
  }), /frontend lowered artifact probe tagged struct field tag hash did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered struct field name hashes', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype Base struct{}\ntype App struct{ Base; Name string; Count, Size int; Ready bool `json:"ready"` }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 2,
      tinygo_lowered_program_000_exported_type_count: () => 2,
      tinygo_lowered_program_000_struct_type_count: () => 2,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_struct_field_count: () => 5,
      tinygo_lowered_program_000_embedded_struct_field_count: () => 1,
      tinygo_lowered_program_000_tagged_struct_field_count: () => 1,
      tinygo_lowered_program_000_struct_field_name_hash: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_embedded_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\ntype Base struct{}\ntype App struct{ Base; Name string; Count, Size int; Ready bool `json:"ready"` }\nfunc main() {}\n',
  }), /frontend lowered artifact probe struct field name hash did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredArtifactExports rejects mismatched lowered struct field type hashes', () => {
  assert.throws(() => verifyTinyGoLoweredArtifactExports({
    exports: {
      tinygo_lowered_program_000_source_file_count: () => 1,
      tinygo_lowered_program_000_kind_tag: () => 1,
      tinygo_lowered_program_000_source_hash: () => expectedSourceHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype Base struct{}\ntype App struct{ Base; Name string; Count, Size int; Ready bool `json:"ready"` }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_import_count: () => 0,
      tinygo_lowered_program_000_import_path_hash: () => 0,
      tinygo_lowered_program_000_function_count: () => 1,
      tinygo_lowered_program_000_method_count: () => 0,
      tinygo_lowered_program_000_exported_function_count: () => 0,
      tinygo_lowered_program_000_type_count: () => 2,
      tinygo_lowered_program_000_exported_type_count: () => 2,
      tinygo_lowered_program_000_struct_type_count: () => 2,
      tinygo_lowered_program_000_interface_type_count: () => 0,
      tinygo_lowered_program_000_struct_field_count: () => 5,
      tinygo_lowered_program_000_embedded_struct_field_count: () => 1,
      tinygo_lowered_program_000_tagged_struct_field_count: () => 1,
      tinygo_lowered_program_000_struct_field_name_hash: () => expectedStructFieldNameHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype Base struct{}\ntype App struct{ Base; Name string; Count, Size int; Ready bool `json:"ready"` }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_embedded_struct_field_type_hash: () => expectedEmbeddedStructFieldTypeHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype Base struct{}\ntype App struct{ Base; Name string; Count, Size int; Ready bool `json:"ready"` }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_tagged_struct_field_tag_hash: () => expectedTaggedStructFieldTagHash(['/workspace/main.go'], {
        '/workspace/main.go': 'package main\ntype Base struct{}\ntype App struct{ Base; Name string; Count, Size int; Ready bool `json:"ready"` }\nfunc main() {}\n',
      }),
      tinygo_lowered_program_000_struct_field_type_hash: () => 0,
      tinygo_lowered_program_000_interface_method_count: () => 0,
      tinygo_lowered_program_000_embedded_interface_method_count: () => 0,
      tinygo_lowered_program_000_const_count: () => 0,
      tinygo_lowered_program_000_var_count: () => 0,
      tinygo_lowered_program_000_exported_const_count: () => 0,
      tinygo_lowered_program_000_exported_var_count: () => 0,
      tinygo_lowered_program_000_main_count: () => 1,
      tinygo_lowered_program_000_init_count: () => 0,
    },
  } as unknown as WebAssembly.Instance, {
    units: [
      {
        id: 'program-000',
        kind: 'program',
        sourceFiles: ['/workspace/main.go'],
      },
    ],
  }, {
    '/workspace/main.go': 'package main\ntype Base struct{}\ntype App struct{ Base; Name string; Count, Size int; Ready bool `json:"ready"` }\nfunc main() {}\n',
  }), /frontend lowered artifact probe struct field type hash did not match lowered sources manifest/)
})

test('verifyTinyGoLoweredObjectFiles accepts wasm object files that match the lowered artifact manifest', () => {
  const verification = verifyTinyGoLoweredObjectFiles({
    objectFiles: [
      '/working/tinygo-lowered/program-000.o',
      '/working/tinygo-lowered/stdlib-000.o',
    ],
  }, [
    {
      path: '/working/tinygo-lowered/program-000.o',
      bytes: new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01]),
    },
    {
      path: '/working/tinygo-lowered/stdlib-000.o',
      bytes: new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x02, 0x03]),
    },
  ])

  assert.deepEqual(verification.objectFiles, [
    {
      path: '/working/tinygo-lowered/program-000.o',
      size: 5,
      format: 'wasm',
    },
    {
      path: '/working/tinygo-lowered/stdlib-000.o',
      size: 6,
      format: 'wasm',
    },
  ])
  assert.equal(verification.totalBytes, 11)
})

test('verifyTinyGoLoweredObjectFiles rejects mismatched lowered object paths', () => {
  assert.throws(() => verifyTinyGoLoweredObjectFiles({
    objectFiles: [
      '/working/tinygo-lowered/program-000.o',
    ],
  }, [
    {
      path: '/working/tinygo-lowered/program-001.o',
      bytes: new Uint8Array([0x00, 0x61, 0x73, 0x6d]),
    },
  ]), /frontend lowered object files did not match lowered artifact manifest/)
})

test('verifyTinyGoLoweredObjectFiles rejects non-wasm lowered object files', () => {
  assert.throws(() => verifyTinyGoLoweredObjectFiles({
    objectFiles: [
      '/working/tinygo-lowered/program-000.o',
    ],
  }, [
    {
      path: '/working/tinygo-lowered/program-000.o',
      bytes: new Uint8Array([0x62, 0x61, 0x64, 0x21]),
    },
  ]), /frontend lowered object file was not a wasm object/)
})

test('verifyTinyGoLoweredBitcodeFiles accepts llvm bitcode files in deterministic order', () => {
  const verification = verifyTinyGoLoweredBitcodeFiles([
    '/working/tinygo-work/program-000.bc',
    '/working/tinygo-work/stdlib-000.bc',
  ], [
    {
      path: '/working/tinygo-work/program-000.bc',
      bytes: new Uint8Array([0x42, 0x43, 0xc0, 0xde, 0x01]),
    },
    {
      path: '/working/tinygo-work/stdlib-000.bc',
      bytes: new Uint8Array([0x42, 0x43, 0xc0, 0xde, 0x02, 0x03]),
    },
  ])

  assert.deepEqual(verification.bitcodeFiles, [
    {
      path: '/working/tinygo-work/program-000.bc',
      size: 5,
      format: 'llvm-bc',
    },
    {
      path: '/working/tinygo-work/stdlib-000.bc',
      size: 6,
      format: 'llvm-bc',
    },
  ])
  assert.equal(verification.totalBytes, 11)
})

test('verifyTinyGoLoweredBitcodeFiles rejects mismatched bitcode output paths', () => {
  assert.throws(() => verifyTinyGoLoweredBitcodeFiles([
    '/working/tinygo-work/program-000.bc',
  ], [
    {
      path: '/working/tinygo-work/program-001.bc',
      bytes: new Uint8Array([0x42, 0x43, 0xc0, 0xde]),
    },
  ]), /frontend lowered bitcode files did not match lowered bitcode outputs/)
})

test('verifyTinyGoLoweredBitcodeFiles rejects non-bitcode outputs', () => {
  assert.throws(() => verifyTinyGoLoweredBitcodeFiles([
    '/working/tinygo-work/program-000.bc',
  ], [
    {
      path: '/working/tinygo-work/program-000.bc',
      bytes: new Uint8Array([0x00, 0x61, 0x73, 0x6d]),
    },
  ]), /frontend lowered bitcode file was not llvm bitcode/)
})

test('verifyTinyGoFinalArtifactFile accepts a wasm artifact that matches the command artifact manifest', () => {
  const verification = verifyTinyGoFinalArtifactFile({
    artifactOutputPath: '/working/out.wasm',
  }, {
    path: '/working/out.wasm',
    bytes: new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x02]),
  })

  assert.deepEqual(verification, {
    path: '/working/out.wasm',
    size: 6,
    format: 'wasm',
  })
})

test('verifyTinyGoFinalArtifactFile rejects a final artifact path that does not match the command artifact manifest', () => {
  assert.throws(() => verifyTinyGoFinalArtifactFile({
    artifactOutputPath: '/working/out.wasm',
  }, {
    path: '/working/out-alt.wasm',
    bytes: new Uint8Array([0x00, 0x61, 0x73, 0x6d]),
  }), /frontend final artifact path did not match command artifact manifest/)
})

test('verifyTinyGoFinalArtifactFile rejects a non-wasm final artifact', () => {
  assert.throws(() => verifyTinyGoFinalArtifactFile({
    artifactOutputPath: '/working/out.wasm',
  }, {
    path: '/working/out.wasm',
    bytes: new Uint8Array([0x62, 0x61, 0x64, 0x21]),
  }), /frontend final artifact was not a wasm binary/)
})
