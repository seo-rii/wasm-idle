import { startWorkerLanguageServer } from '../lsp.js';
import { createZigWorkerService } from './service.js';

startWorkerLanguageServer(createZigWorkerService());
