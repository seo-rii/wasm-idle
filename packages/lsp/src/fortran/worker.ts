import { startWorkerLanguageServer } from '../lsp.js';
import { createFortranWorkerService } from './service.js';

startWorkerLanguageServer(createFortranWorkerService());
