import type { DebugSessionController } from '@wasm-idle/debug/controller';
import { normalizeWorkspacePath } from './workspacePath';

/** Runtime frame paths can use portable separators. A literal project filename wins. */
export function workspaceDebugPath(sourcePath: string | undefined, files: readonly { path: string }[]) {
	const path = sourcePath?.replace(/^\/workspace\//u, '');
	if (!path) return;
	if (files.some((file) => file.path === path)) return path;
	try {
		const normalized = normalizeWorkspacePath(path);
		return files.find((file) => file.path === normalized)?.path;
	} catch {
		return;
	}
}


/** The debugger receives /workspace paths. Save their specifications when the editor changes project. */
export function createProjectBreakpointSelection(debug: DebugSessionController) {
	const inactiveProjects = new Map<string, DebugSessionController['sourceBreakpoints']>();
	let currentProject: string | undefined;

	return (nextProject: string) => {
		if (currentProject === nextProject) return;
		if (currentProject !== undefined) {
			const sources = debug.sourceBreakpoints.filter(
				({ lines, breakpoints }) => lines.length || breakpoints?.length
			);
			if (sources.length) inactiveProjects.set(currentProject, sources);
			for (const { sourcePath } of sources)
				void debug.setStructuredBreakpoints([], sourcePath);
		}
		for (const { sourcePath, lines, breakpoints } of inactiveProjects.get(nextProject) ?? []) {
			void debug.setStructuredBreakpoints(
				breakpoints ?? lines.map((line) => ({ line })),
				sourcePath
			);
		}
		inactiveProjects.delete(nextProject);
		currentProject = nextProject;
	};
}
