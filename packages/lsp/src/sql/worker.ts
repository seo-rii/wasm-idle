import { startWorkerLanguageServer } from '../lsp.js';
import { createSqlWorkerService } from './service.js';

startWorkerLanguageServer(createSqlWorkerService());
