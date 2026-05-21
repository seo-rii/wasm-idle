export type GeneratedFile = {
  path: string
  contents: string
}

export type EmceptionWritableFileSystem = {
  exists(path: string): Promise<boolean>
  mkdir(path: string): Promise<void>
  unlink(path: string): Promise<void>
  writeFile(path: string, contents: string): Promise<void>
}

export const materializeGeneratedFile = async (
  fileSystem: EmceptionWritableFileSystem,
  file: GeneratedFile,
  createdDirectories = new Set<string>(),
) => {
  const segments = file.path.split('/').filter(Boolean)
  let currentPath = ''
  for (const [index, segment] of segments.entries()) {
    currentPath += `/${segment}`
    if (index == 0 || index == segments.length - 1 || createdDirectories.has(currentPath)) {
      continue
    }
    try {
      await fileSystem.mkdir(currentPath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes('exists')) {
        throw error
      }
    }
    createdDirectories.add(currentPath)
  }
  if (await fileSystem.exists(file.path)) {
    await fileSystem.unlink(file.path)
  }
  try {
    await fileSystem.writeFile(file.path, file.contents)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes('FS error')) {
      throw error
    }
    try {
      await fileSystem.unlink(file.path)
    } catch {
      throw error
    }
    await fileSystem.writeFile(file.path, file.contents)
  }
}

export const materializeGeneratedFiles = async (
  fileSystem: EmceptionWritableFileSystem,
  files: GeneratedFile[],
) => {
  const createdDirectories = new Set<string>()
  for (const file of files) {
    await materializeGeneratedFile(fileSystem, file, createdDirectories)
  }
}

export const selectBootstrapDispatchFiles = (
  files: GeneratedFile[],
  plannerManifestSource: string,
) => {
  const plannerManifest = JSON.parse(plannerManifestSource) as {
    bootstrapDispatch?: {
      materializedFiles?: string[]
    }
  }

  if (!Array.isArray(plannerManifest.bootstrapDispatch?.materializedFiles)) {
    throw new Error('planner bootstrapDispatch.materializedFiles is missing')
  }

  const filesByPath = new Map<string, GeneratedFile>()
  for (const file of files) {
    if (filesByPath.has(file.path)) {
      throw new Error(`duplicate generated file path: ${file.path}`)
    }
    filesByPath.set(file.path, file)
  }

  const dispatchPaths = plannerManifest.bootstrapDispatch.materializedFiles
  const dispatchPathSet = new Set(dispatchPaths)
  for (const file of files) {
    if (!dispatchPathSet.has(file.path)) {
      throw new Error(`generated file missing from bootstrapDispatch.materializedFiles: ${file.path}`)
    }
  }

  const orderedFiles: GeneratedFile[] = []
  for (const path of dispatchPaths) {
    const file = filesByPath.get(path)
    if (!file) {
      throw new Error(`dispatch requested missing generated file: ${path}`)
    }
    orderedFiles.push(file)
  }

  return orderedFiles
}

export const materializeBootstrapDispatchFiles = async (
  fileSystem: EmceptionWritableFileSystem,
  files: GeneratedFile[],
  plannerManifestSource: string,
) => {
  const orderedFiles = selectBootstrapDispatchFiles(files, plannerManifestSource)
  await materializeGeneratedFiles(fileSystem, orderedFiles)
}
