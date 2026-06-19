import { startWorkerLanguageServer } from '../lsp.js';
import { createHaskellWorkerService } from './service.js';

startWorkerLanguageServer(createHaskellWorkerService());
