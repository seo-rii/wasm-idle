import { startWorkerLanguageServer } from '../lsp.js';
import { createBeamWorkerService } from './service.js';

startWorkerLanguageServer(createBeamWorkerService('elixir'));
