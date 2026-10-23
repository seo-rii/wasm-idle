import type {
	DebugCommand,
	DebugFrame,
	DebugSessionEvent,
	DebugSourceBreakpoints
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
	emit: (event: DebugSessionEvent) => void,
	read: (blocking: boolean) => string | null
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
	setBreakpoints(displayPath(options.activePath), options.breakpoints);
	for (const source of options.sourceBreakpoints ?? [])
		setBreakpoints(source.sourcePath, source.lines);
	return {
		poll(source: string, line: number, _column: number) {
			if (!sources.has(source)) throw new Error('Unknown Java debugger source');
			for (let item; (item = command(false));) update(item);
			return pauseRequested ||
				mode !== 'continue' ||
				breakpoints.get(displayPath(source))?.has(line)
				? {}
				: null;
		},
		pause(source: string, line: number, column: number, serialized: string, rawDepth: number) {
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
			if (!pauseRequested && !breakpoint && !stepping) return;
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
			frames.forEach((frame, index) => {
				frame.id = stop * 100 + index + 1;
			});
			top.line = line;
			top.column = column;
			emit({
				type: 'pause',
				reason,
				line,
				sourcePath: top.sourcePath,
				sourceContentSha256: top.sourceContentSha256,
				frameId: top.id,
				threadId: 1,
				locals: [],
				scopes: [],
				callStack: frames,
				capabilities: { readMemory: false, writeMemory: false, dataBreakpoints: false }
			});
			for (;;) {
				const item = command(true);
				if (!item) continue;
				if (item.op === 'control') {
					if (!['continue', 'stepInto', 'nextLine', 'stepOut'].includes(item.command))
						throw new Error('Invalid Java debugger control');
					mode = item.command as DebugCommand;
					targetDepth = rawDepth;
					targetSource = source;
					targetLine = line;
					targetColumn = column;
					emit({ type: 'resume', command: mode });
					break;
				}
				update(item);
			}
		}
	};
}
