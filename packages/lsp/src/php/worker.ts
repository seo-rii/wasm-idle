import { startWorkerLanguageServer } from '../lsp.js';
import { createPhpWorkerService } from './service.js';

startWorkerLanguageServer(createPhpWorkerService());
