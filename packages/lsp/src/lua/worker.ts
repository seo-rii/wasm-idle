import { startWorkerLanguageServer } from '../lsp.js';
import { createLuaWorkerService } from './service.js';

startWorkerLanguageServer(createLuaWorkerService());
