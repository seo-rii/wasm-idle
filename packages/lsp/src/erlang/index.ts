export { getErlangLanguageServer, type ErlangLanguageServerOptions } from './server.js';
export {
	createBeamWorkerService,
	type BeamDiagnosticRunnerRequest,
	type BeamDiagnosticRunnerResult,
	type BeamLanguageServerLanguage,
	type BeamWorkerOptions,
	type RunBeamDiagnostics
} from '../elixir/service.js';
