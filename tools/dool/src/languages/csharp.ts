import pathUtil from 'path'
import {JudgeType} from '../types/judgement'
import {SourceLanguage} from '../types/source'

const csharpProjectPath = '__csharp__'
const csharpPublishPath = '__csharp_publish__'
const csharpDotnetHomePath = '__csharp_dotnet_home__'
const csharpNugetPackagesPath = '__csharp_nuget_packages__'
const csharpTargetName = 'Main'
const csharpRuntime = 'linux-x64'
const csharpDotnetEnv = [
    'DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1',
    'DOTNET_CLI_TELEMETRY_OPTOUT=1',
    'DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE=1',
    'DOTNET_GENERATE_ASPNET_CERTIFICATE=false',
    'DOTNET_NOLOGO=1',
    'MSBuildEnableWorkloadResolver=false',
].join(' ')

export function build(path: string, uid: string, sourceName: string[] = ['Main.cs'], targetName = csharpTargetName) {
    const projectRoot = `${path}/${csharpProjectPath}`
    const publishRoot = `${path}/${csharpPublishPath}`
    const dotnetHomeRoot = `${path}/${csharpDotnetHomePath}`
    const nugetPackagesRoot = `${path}/${csharpNugetPackagesPath}`
    const dotnetEnv = `env HOME=${JSON.stringify(dotnetHomeRoot)} DOTNET_CLI_HOME=${JSON.stringify(dotnetHomeRoot)} NUGET_PACKAGES=${JSON.stringify(nugetPackagesRoot)} ${csharpDotnetEnv}`
    const copySources = sourceName
        .map((name) => {
            const sourcePath = JSON.stringify(`${path}/${name}`)
            const targetPath = JSON.stringify(`${projectRoot}/${name}`)
            const targetDir = JSON.stringify(pathUtil.posix.dirname(`${projectRoot}/${name}`))
            return `mkdir -p ${targetDir} && cp ${sourcePath} ${targetPath}`
        })
        .join(' && ')

    return `mkdir -p ${JSON.stringify(dotnetHomeRoot)} ${JSON.stringify(nugetPackagesRoot)} && ${dotnetEnv} dotnet new console --force --no-restore --verbosity quiet -n ${targetName} -o ${projectRoot} && rm -f ${JSON.stringify(`${projectRoot}/Program.cs`)} && ${copySources} && ${dotnetEnv} dotnet restore ${projectRoot} --runtime ${csharpRuntime} --verbosity quiet && ${dotnetEnv} dotnet publish ${projectRoot} --no-restore --configuration Release --self-contained true --runtime ${csharpRuntime} --verbosity quiet -o ${publishRoot}`
}

export function getExecuteCommand(
    path: string,
    uid: string,
    sourceName: string = 'Main'
) {
    return `env DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1 ${path}/${csharpPublishPath}/${csharpTargetName}`
}

export function getLanguage() {
    return SourceLanguage.CSHARP
}

export function getExtension() {
    return 'cs'
}

export function getSupportedType() {
    return [
        JudgeType.CommonJudge
    ]
}

export function getTimeLimit(baseTime: number) {
    return baseTime * 2 + 1000
}

export function getMemoryLimit(baseMemory: number) {
    return baseMemory * 2 + 1024 + 256
}
