export interface MonoDebugCommandResponse {
	id: number;
	value: string;
}

/** Transport to Mono's own soft debugger. It does not implement source-level DAP/CDP semantics. */
export interface MonoDebugAgentConnection {
	versionReply: MonoDebugCommandResponse;
	sendCommand(
		commandSet: number,
		command: number,
		parametersBase64?: string
	): MonoDebugCommandResponse;
	attach(): void;
	detach(): void;
}

type MonoRuntimeInternals = {
	mono_wasm_runtime_is_ready?: boolean;
	mono_wasm_send_dbg_command?: (
		id: number,
		commandSet: number,
		command: number,
		parameters: string
	) => MonoDebugCommandResponse;
	mono_wasm_debugger_attached?: () => void;
	mono_wasm_detach_debugger?: () => void;
};

export function connectMonoDebugAgent(runtime: unknown): MonoDebugAgentConnection {
	const internal = (runtime as { INTERNAL?: MonoRuntimeInternals } | undefined)?.INTERNAL;
	if (
		!internal?.mono_wasm_runtime_is_ready ||
		typeof internal.mono_wasm_send_dbg_command !== 'function' ||
		typeof internal.mono_wasm_debugger_attached !== 'function' ||
		typeof internal.mono_wasm_detach_debugger !== 'function'
	) {
		throw new Error(
			'The .NET runtime does not expose a ready Mono debugger agent. Use a debugger-enabled runtime bundle.'
		);
	}
	let commandId = 1;
	const sendCommand = (commandSet: number, command: number, parametersBase64 = '') => {
		if (
			![commandSet, command].every(
				(value) => Number.isInteger(value) && value >= 1 && value <= 255
			)
		) {
			throw new Error(
				'Mono debugger commands must use byte-sized command-set and command IDs.'
			);
		}
		if (
			!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
				parametersBase64
			)
		) {
			throw new Error('Mono debugger command parameters must be base64.');
		}
		const id = commandId++;
		const response = internal.mono_wasm_send_dbg_command!(
			id,
			commandSet,
			command,
			parametersBase64
		);
		if (response?.id !== id || typeof response.value !== 'string') {
			throw new Error('Mono debugger agent returned an invalid command response.');
		}
		return response;
	};
	// VM.Version (command set 1, command 1) is the real agent handshake used by
	// dotnet/runtime's BrowserDebugProxy. JS wrapper presence alone is insufficient.
	const versionReply = sendCommand(1, 1);
	if (!versionReply.value)
		throw new Error('Mono debugger agent returned an empty VM.Version response.');
	return {
		versionReply,
		sendCommand,
		attach: () => internal.mono_wasm_debugger_attached!(),
		detach: () => internal.mono_wasm_detach_debugger!()
	};
}
