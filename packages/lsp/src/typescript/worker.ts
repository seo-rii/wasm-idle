import { startWorkerLanguageServer } from '../lsp.js';
import { createTypeScriptWorkerService } from './service.js';

startWorkerLanguageServer(createTypeScriptWorkerService('typescript'));
