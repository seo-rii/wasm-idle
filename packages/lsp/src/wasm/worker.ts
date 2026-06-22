import { startWorkerLanguageServer } from '../lsp.js';
import { createWasmWorkerService } from './service.js';

startWorkerLanguageServer(createWasmWorkerService());
