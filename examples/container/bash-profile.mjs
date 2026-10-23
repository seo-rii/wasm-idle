// The demo chooses its pinned command list; execution is shared with consumers.
import { createBashProfile as createSharedBashProfile } from '../../src/lib/container/bash-profile.ts';
import { BUSYBOX_SHELL_COMMANDS } from '../../runtimes/wasm-busybox/commands.mjs';

export { BASH_BIN, BASH_SYSROOT } from '../../src/lib/container/bash-profile.ts';
export const BASH_APPLETS = BUSYBOX_SHELL_COMMANDS;
export function createBashProfile(options) {
	return createSharedBashProfile({ shellCommands: BASH_APPLETS, ...options });
}
