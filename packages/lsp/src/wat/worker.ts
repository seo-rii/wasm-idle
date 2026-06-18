import { startWorkerLanguageServer } from '../lsp.js';
import { createWatWorkerService } from './service.js';

startWorkerLanguageServer(createWatWorkerService());
