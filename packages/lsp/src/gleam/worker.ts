import { startWorkerLanguageServer } from '../lsp.js';
import { createGleamWorkerService } from './service.js';

startWorkerLanguageServer(createGleamWorkerService());
