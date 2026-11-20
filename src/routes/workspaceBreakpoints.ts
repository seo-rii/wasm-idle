import type { DebugSessionController } from '@wasm-idle/debug/controller';

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
