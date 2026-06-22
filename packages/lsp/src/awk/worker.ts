import { startWorkerLanguageServer } from '../lsp.js';
import { createAwkWorkerService } from './service.js';

startWorkerLanguageServer(createAwkWorkerService());
