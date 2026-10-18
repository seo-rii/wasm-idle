// Canonical applet inventory for the container BusyBox producer. Keep the
// effective producer configuration, applet-list smoke and distribution in sync.
export const BUSYBOX_COMMAND_STAGE = 2;
export const BUSYBOX_APPLETS = Object.freeze([
  "base64",
  "basename",
  "cat",
  "cmp",
  "cp",
  "cut",
  "diff",
  "dirname",
  "echo",
  "false",
  "find",
  "grep",
  "head",
  "hexdump",
  "ln",
  "ls",
  "mkdir",
  "mv",
  "od",
  "printf",
  "pwd",
  "readlink",
  "realpath",
  "rm",
  "rmdir",
  "sed",
  "sha256sum",
  "sort",
  "tail",
  "tee",
  "tr",
  "true",
  "uniq",
  "wc"
]);

// Direct container callers may use every compiled applet or the multicall entry.
export const BUSYBOX_COMMANDS = Object.freeze(['busybox', ...BUSYBOX_APPLETS]);

// Bash owns these names. External routes expose the remaining applets and the
// multicall entry, including `busybox --list` and `busybox <applet> ...`.
export const BUSYBOX_SHELL_BUILTINS = Object.freeze(['echo', 'false', 'printf', 'pwd', 'true']);
export const BUSYBOX_SHELL_COMMANDS = Object.freeze(BUSYBOX_COMMANDS.filter(name => !BUSYBOX_SHELL_BUILTINS.includes(name)));
