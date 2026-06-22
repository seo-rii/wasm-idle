import { startWorkerLanguageServer } from '../lsp.js';
import { createLispWorkerService } from './service.js';

startWorkerLanguageServer(createLispWorkerService());
