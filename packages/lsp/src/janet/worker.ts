import { startWorkerLanguageServer } from '../lsp.js';
import { createJanetWorkerService } from './service.js';

startWorkerLanguageServer(createJanetWorkerService());
