import type {
	DebugCommand,
	DebugFrame,
	DebugScope,
	DebugSessionEvent,
	DebugSourceBreakpoints,
	DebugVariable
} from '../options';
import type { JavaDebugLocation } from '../javaDebugSource';

export interface JavaDebugFile {
	path: string;
	sourceContentSha256: string;
	lineCount: number;
	locations: JavaDebugLocation[];
}

export function createJavaDebugRuntime(
	files: JavaDebugFile[],
	options: {
		activePath: string;
		debugPath?: string;
		breakpoints: number[];
		sourceBreakpoints?: DebugSourceBreakpoints[];
		pauseOnEntry: boolean;
	},
	emit: (event: DebugSessionEvent, stopId?: number) => void,
	read: (blocking: boolean) => string | null,
	respond: (response: {
		id: number;
		stopId: number;
		value?: unknown;
		error?: string;
	}) => void = () => {}
) {
	const sources = new Map(files.map((file) => [file.path, file]));
	const sourcePrefix = options.debugPath?.endsWith(`/${options.activePath}`)
		? options.debugPath.slice(0, -options.activePath.length)
		: '';
	const displayPath = (path: string) =>
		path === options.activePath ? options.debugPath || path : `${sourcePrefix}${path}`;
	const breakpoints = new Map<string, Set<number>>();
	let mode: DebugCommand | 'entry' = options.pauseOnEntry ? 'entry' : 'continue';
	let targetDepth = 0;
	let targetSource = '';
	let targetLine = 0;
	let targetColumn = 0;
	let pauseRequested = false;
	let stop = 0;
	let pausedFrameId: number | undefined;
	let pausedScope: DebugScope | undefined;
	let pendingInspection: { id: number; stopId: number; op: string } | undefined;
	const references = new Set<number>();
	const referenceBase = () => stop * 100_000 + 1;
	const variablePage = (value: unknown): DebugVariable[] => {
		if (!Array.isArray(value) || value.length > 1000)
			throw new Error('Invalid Java variable response');
		return value.map((item) => {
			if (
				!item ||
				typeof item.name !== 'string' ||
				typeof item.value !== 'string' ||
				typeof item.type !== 'string' ||
				!Number.isSafeInteger(item.variablesReference) ||
				item.variablesReference < 0 ||
				item.variablesReference > 4096 ||
				(item.indexedVariables !== undefined &&
					(!Number.isSafeInteger(item.indexedVariables) || item.indexedVariables < 0))
			)
				throw new Error('Invalid Java variable descriptor');
			const reference = item.variablesReference
				? referenceBase() + item.variablesReference
				: 0;
			if (reference) references.add(reference);
			return {
				name: item.name,
				value: item.value,
				type: item.type,
				variablesReference: reference,
				...(item.indexedVariables !== undefined
					? { indexedVariables: item.indexedVariables }
					: {})
			};
		});
	};
	const setBreakpoints = (sourcePath: string, lines: number[]) => {
		if (
			!Array.isArray(lines) ||
			lines.length > 1024 ||
			lines.some((line) => !Number.isSafeInteger(line) || line < 1)
		)
			throw new Error('Invalid Java breakpoint lines');
		const file = files.find((file) => displayPath(file.path) === sourcePath);
		const executable = [
			...new Set(file?.locations.map((location) => location.line) ?? [])
		].sort((a, b) => a - b);
		const resolved = [...new Set(lines)].map((requestedLine) => {
			const line = executable.find((line) => line >= requestedLine);
			return {
				requestedLine,
				line: line ?? requestedLine,
				verified: line !== undefined,
				...(line === undefined
					? { message: 'No instrumented Java statement at or after this line' }
					: {})
			};
		});
		breakpoints.set(
			sourcePath,
			new Set(resolved.filter((item) => item.verified).map((item) => item.line))
		);
		emit({
			type: 'breakpoints',
			sourcePath,
			sourceContentSha256: file?.sourceContentSha256,
			breakpoints: resolved
		});
	};
	const command = (blocking: boolean): any => {
		const raw = read(blocking);
		if (raw === null) throw new Error('Java debugger stopped');
		if (!raw) return null;
		return JSON.parse(raw);
	};
	const update = (item: any) => {
		if (item.op === 'breakpoints') setBreakpoints(item.sourcePath, item.lines);
		else if (item.op === 'pause') pauseRequested = true;
	};
	const requestError = (item: any, message: string) => {
		if (Number.isSafeInteger(item.id) && item.id > 0 && Number.isSafeInteger(item.stopId))
			respond({ id: item.id, stopId: item.stopId, error: message });
	};
	const readPaused = (): Record<string, unknown> | null => {
		for (;;) {
			const item = command(true);
			if (!item) continue;
			if (item.op === 'control') {
				if (!['continue', 'stepInto', 'nextLine', 'stepOut'].includes(item.command))
					throw new Error('Invalid Java debugger control');
				mode = item.command as DebugCommand;
				pausedFrameId = undefined;
				pausedScope = undefined;
				references.clear();
				pendingInspection = undefined;
				emit({ type: 'resume', command: mode });
				return null;
			}
			if (item.op === 'breakpoints' || item.op === 'pause') {
				update(item);
				continue;
			}
			if (
				!Number.isSafeInteger(item.id) ||
				item.id < 1 ||
				item.id > 2_147_483_647 ||
				item.stopId !== stop
			) {
				requestError(item, 'Java inspection request belongs to an earlier stop');
				continue;
			}
			if (item.op === 'scopes') {
				respond({
					id: item.id,
					stopId: stop,
					value: item.frameId === pausedFrameId && pausedScope ? [pausedScope] : []
				});
				continue;
			}
			if (item.op === 'context') {
				if (item.frameId !== pausedFrameId) {
					requestError(
						item,
						'Java values are available only for the currently stopped frame'
					);
					continue;
				}
				pendingInspection = { id: item.id, stopId: stop, op: item.op };
				return { op: item.op, id: item.id, stopId: stop };
			}
			if (item.op === 'variables') {
				const { reference, start = 0, count = 50 } = item;
				if (
					!references.has(reference) ||
					!Number.isSafeInteger(start) ||
					start < 0 ||
					!Number.isSafeInteger(count) ||
					count < 0 ||
					count > 1000
				) {
					requestError(item, 'Invalid or stale Java variable page');
					continue;
				}
				pendingInspection = { id: item.id, stopId: stop, op: item.op };
				return {
					op: item.op,
					id: item.id,
					stopId: stop,
					reference: reference - referenceBase(),
					start,
					count
				};
			}
			requestError(item, 'Unsupported Java inspection request');
		}
	};
	setBreakpoints(displayPath(options.activePath), options.breakpoints);
	for (const source of options.sourceBreakpoints ?? [])
		setBreakpoints(source.sourcePath, source.lines);
	return {
		poll(source: string, line: number, _column: number) {
			if (!sources.has(source)) throw new Error('Unknown Java debugger source');
			for (let item; (item = command(false));) {
				if (item.op === 'breakpoints' || item.op === 'pause') update(item);
				else requestError(item, 'Java inspection requires a paused frame');
			}
			return pauseRequested ||
				mode !== 'continue' ||
				breakpoints.get(displayPath(source))?.has(line)
				? {}
				: null;
		},
		pause(
			source: string,
			line: number,
			column: number,
			serialized: string,
			rawDepth: number,
			serializedVariables = '[]',
			totalVariables = 0
		) {
			if (serialized.length > 1_000_000 || !Number.isSafeInteger(rawDepth) || rawDepth < 1)
				throw new Error('Invalid Java debugger stack');
			const raw: Array<[string, string, string | null, number]> = JSON.parse(serialized);
			if (!Array.isArray(raw) || raw.length > 64)
				throw new Error('Invalid Java debugger stack');
			const frames: DebugFrame[] = [];
			for (const frame of raw) {
				if (
					!Array.isArray(frame) ||
					frame.length !== 4 ||
					typeof frame[0] !== 'string' ||
					typeof frame[1] !== 'string' ||
					typeof frame[2] !== 'string' ||
					!Number.isSafeInteger(frame[3])
				)
					continue;
				const packagePath = frame[0]
					.slice(0, Math.max(0, frame[0].lastIndexOf('.')))
					.replaceAll('.', '/');
				const relativePath = packagePath ? `${packagePath}/${frame[2]}` : frame[2];
				const candidates = files.filter((file) => file.path.split('/').pop() === frame[2]);
				const exact = candidates.filter(
					(file) => file.path === relativePath || file.path.endsWith(`/${relativePath}`)
				);
				const file =
					exact.length === 1
						? exact[0]
						: candidates.length === 1
							? candidates[0]
							: undefined;
				if (!file || frame[3] < 1 || frame[3] > file.lineCount) continue;
				frames.push({
					functionName: `${frame[0]}.${frame[1]}`,
					line: frame[3],
					sourcePath: displayPath(file.path),
					sourceContentSha256: file.sourceContentSha256
				});
			}
			const top = frames[0];
			if (!top || top.sourcePath !== displayPath(source))
				throw new Error('The Java runtime could not provide the current source stack');
			const breakpoint = breakpoints.get(displayPath(source))?.has(line) === true;
			const progressed =
				source !== targetSource ||
				line !== targetLine ||
				rawDepth !== targetDepth ||
				column === targetColumn;
			const stepping =
				mode === 'entry' ||
				(mode === 'stepInto' && progressed) ||
				(mode === 'nextLine' && rawDepth <= targetDepth && progressed) ||
				(mode === 'stepOut' && rawDepth < targetDepth);
			if (!pauseRequested && !breakpoint && !stepping) return null;
			const reason = pauseRequested
				? 'pause'
				: breakpoint
					? 'breakpoint'
					: mode === 'entry'
						? 'entry'
						: mode === 'stepInto'
							? 'step'
							: mode === 'stepOut'
								? 'stepOut'
								: 'nextLine';
			pauseRequested = false;
			stop++;
			if (
				stop > 2_147_483_647 ||
				serializedVariables.length > 1_000_000 ||
				!Number.isSafeInteger(totalVariables) ||
				totalVariables < 0 ||
				totalVariables > 1024
			)
				throw new Error('Invalid Java local snapshot');
			references.clear();
			pendingInspection = undefined;
			const locals = variablePage(JSON.parse(serializedVariables));
			frames.forEach((frame, index) => {
				frame.id = stop * 100 + index + 1;
			});
			top.line = line;
			top.column = column;
			pausedFrameId = top.id;
			pausedScope = {
				name: 'Locals',
				variablesReference: referenceBase(),
				namedVariables: totalVariables,
				expensive: false,
				variables: locals
			};
			references.add(referenceBase());
			targetDepth = rawDepth;
			targetSource = source;
			targetLine = line;
			targetColumn = column;
			emit(
				{
					type: 'pause',
					reason,
					line,
					sourcePath: top.sourcePath,
					sourceContentSha256: top.sourceContentSha256,
					frameId: top.id,
					threadId: 1,
					locals,
					scopes: [pausedScope],
					callStack: frames,
					capabilities: { readMemory: false, writeMemory: false, dataBreakpoints: false }
				},
				stop
			);
			return readPaused();
		},
		reply(id: number, stopId: number, serialized: string | null, error: string | null) {
			const inspection = pendingInspection;
			if (!inspection || inspection.id !== id || inspection.stopId !== stopId || !pausedScope)
				throw new Error('Java inspection reply belongs to an earlier request');
			pendingInspection = undefined;
			try {
				if (error) respond({ id, stopId, error });
				else {
					if (typeof serialized !== 'string' || serialized.length > 1_000_000)
						throw new Error('Invalid Java inspection response');
					const value = JSON.parse(serialized);
					respond({
						id,
						stopId,
						value: inspection.op === 'variables' ? variablePage(value) : value
					});
				}
			} catch (failure) {
				respond({
					id,
					stopId,
					error:
						failure instanceof Error ? failure.message : 'Unable to inspect Java values'
				});
			}
			return readPaused();
		}
	};
}
