import { startWorkerLanguageServer } from '../lsp.js';
import { createPerlWorkerService } from './service.js';

startWorkerLanguageServer(createPerlWorkerService());
