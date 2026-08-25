export interface DapEvent {
	event: string;
	body?: unknown;
}

/**
 * A transport-independent DAP session.
 *
 * `request()` resolves to the response body, not the DAP response envelope.
 * Implementations may use MessagePort, a worker, a socket, or another transport.
 */
export interface DapSession {
	request<TBody = unknown>(command: string, requestArguments?: unknown): Promise<TBody>;
	onEvent(listener: (event: DapEvent) => void): () => void;
}

export interface DapInitializeRequestArguments {
	clientID?: string;
	clientName?: string;
	adapterID: string;
	locale?: string;
	linesStartAt1: boolean;
	columnsStartAt1: boolean;
	pathFormat: 'path' | 'uri';
	supportsVariableType: boolean;
	supportsVariablePaging: boolean;
	supportsRunInTerminalRequest: boolean;
	supportsMemoryReferences: boolean;
	supportsProgressReporting: boolean;
	supportsInvalidatedEvent: boolean;
	supportsMemoryEvent: boolean;
}

export interface DapCapabilities {
	supportsConfigurationDoneRequest?: boolean;
	supportsConditionalBreakpoints?: boolean;
	supportsLogPoints?: boolean;
	supportsEvaluateForHovers?: boolean;
	supportsReadMemoryRequest?: boolean;
	supportsWriteMemoryRequest?: boolean;
	supportsDataBreakpoints?: boolean;
	/** LLDB extension: dataBreakpointInfo accepts `bytes` with `asAddress`. */
	supportsDataBreakpointBytes?: boolean;
	supportsSetVariable?: boolean;
	supportsRestartRequest?: boolean;
	supportsTerminateRequest?: boolean;
	supportTerminateDebuggee?: boolean;
}
