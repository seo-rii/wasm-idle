import { startWorkerLanguageServer } from '../lsp.js';
import { createTclWorkerService } from './service.js';

startWorkerLanguageServer(createTclWorkerService());
