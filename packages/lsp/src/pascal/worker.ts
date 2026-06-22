import { startWorkerLanguageServer } from '../lsp.js';
import { createPascalWorkerService } from './service.js';

startWorkerLanguageServer(createPascalWorkerService());
