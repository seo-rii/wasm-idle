export interface JavaSourceIdentity {
	mainClass: string;
	sourcePath: string;
}

export function resolveJavaSourceIdentity(code: string, activePath?: string): JavaSourceIdentity {
	const packageMatch = code.match(/^\s*package\s+([A-Za-z_][\w.]*)\s*;/m);
	const typeMatch =
		code.match(
			/^\s*public\s+(?:final\s+|abstract\s+)?(?:class|record|enum|interface)\s+([A-Za-z_]\w*)\b/m
		) ||
		code.match(
			/^\s*(?:final\s+|abstract\s+)?(?:class|record|enum|interface)\s+([A-Za-z_]\w*)\b/m
		);
	const className = typeMatch?.[1];
	if (!className) {
		// javac, rather than this filename helper, validates compact source syntax.
		const sourcePath = activePath || 'Main.java';
		return {
			sourcePath,
			mainClass: (sourcePath.split('/').pop() || sourcePath).replace(/\.java$/, '')
		};
	}
	const packageName = packageMatch?.[1] || '';
	return {
		sourcePath: packageName
			? `${packageName.replaceAll('.', '/')}/${className}.java`
			: `${className}.java`,
		mainClass: packageName ? `${packageName}.${className}` : className
	};
}
