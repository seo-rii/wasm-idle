import { startWorkerLanguageServer } from '../lsp.js';
import { createOctaveWorkerService } from './service.js';

startWorkerLanguageServer(createOctaveWorkerService());
