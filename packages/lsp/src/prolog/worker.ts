import { startWorkerLanguageServer } from '../lsp.js';
import { createPrologWorkerService } from './service.js';

startWorkerLanguageServer(createPrologWorkerService());
