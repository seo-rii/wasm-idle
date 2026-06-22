import { startWorkerLanguageServer } from '../lsp.js';
import { createDocumentWorkerService } from './service.js';

startWorkerLanguageServer(createDocumentWorkerService());
