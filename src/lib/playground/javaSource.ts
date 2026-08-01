export interface JavaSourceIdentity {
	mainClass: string;
	sourcePath: string;
}

export function resolveJavaSourceIdentity(code: string): JavaSourceIdentity {
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
		throw new Error('Java source must define a top-level class, record, enum, or interface');
	}
	const packageName = packageMatch?.[1] || '';
	return {
		sourcePath: packageName
			? `${packageName.replaceAll('.', '/')}/${className}.java`
			: `${className}.java`,
		mainClass: packageName ? `${packageName}.${className}` : className
	};
}
