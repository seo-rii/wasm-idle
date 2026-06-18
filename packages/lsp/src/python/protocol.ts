export type PythonLspStatus =
	| { state: 'disabled' }
	| { state: 'loading'; stage?: string }
	| { state: 'ready' }
	| { state: 'error'; message: string };

export interface PythonLspWorkerInitMessage {
	type: 'init';
	pyodideBaseUrl: string;
}

export type PythonLspWorkerInboundMessage = PythonLspWorkerInitMessage | Record<string, unknown>;

export type PythonLspWorkerOutboundMessage =
	| { type: 'progress'; stage: string }
	| { type: 'ready' }
	| { type: 'error'; error: string };
