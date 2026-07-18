export {
	getAssemblyScriptLanguageServer,
	type AssemblyScriptLanguageServerConfig,
	type AssemblyScriptLanguageServerOptions
} from './server.js';
export {
	createAssemblyScriptWorkerService,
	type AssemblyScriptWorkerOptions,
	type LoadAssemblyScriptCompiler
} from './service.js';
export { resolveAssemblyScriptLanguageServerModuleUrl } from '../runtime.js';
