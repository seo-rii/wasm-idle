import { startWorkerLanguageServer } from '../lsp.js';
import { createBeamWorkerService } from '../elixir/service.js';

startWorkerLanguageServer(createBeamWorkerService('erlang'));
