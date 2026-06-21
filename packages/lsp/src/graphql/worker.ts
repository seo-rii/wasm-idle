import { startWorkerLanguageServer } from '../lsp.js';
import { createGraphqlWorkerService } from './service.js';

startWorkerLanguageServer(createGraphqlWorkerService());
