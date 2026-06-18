import { startWorkerLanguageServer } from '../lsp.js';
import { createGoWorkerService } from './service.js';

startWorkerLanguageServer(createGoWorkerService());
