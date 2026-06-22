import { startWorkerLanguageServer } from '../lsp.js';
import { createRWorkerService } from './service.js';

startWorkerLanguageServer(createRWorkerService());
