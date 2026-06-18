import { startWorkerLanguageServer } from '../lsp.js';
import { createDotnetWorkerService } from './service.js';
startWorkerLanguageServer(createDotnetWorkerService('csharp'));
//# sourceMappingURL=worker.js.map