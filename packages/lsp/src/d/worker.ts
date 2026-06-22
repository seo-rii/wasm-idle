import { startWorkerLanguageServer } from '../lsp.js';
import { createDWorkerService } from './service.js';

startWorkerLanguageServer(createDWorkerService());
