import { startWorkerLanguageServer } from '../lsp.js';
import { createOcamlWorkerService } from './service.js';

startWorkerLanguageServer(createOcamlWorkerService());
