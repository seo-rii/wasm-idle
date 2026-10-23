import { serveContainerWorker } from '../../container/index.js';
import { createPlaygroundBinding } from '../index';
import { BUSYBOX_SHELL_COMMANDS } from '../../../../runtimes/wasm-busybox/commands.mjs';
import { playgroundLanguages } from '../../../routes/language-registry';
import { createWebsiteBashConfiguration } from './release';

serveContainerWorker({
	languages: playgroundLanguages,
	createBinding: createPlaygroundBinding,
	createBashConfiguration: createWebsiteBashConfiguration,
	shellCommands: BUSYBOX_SHELL_COMMANDS
});
