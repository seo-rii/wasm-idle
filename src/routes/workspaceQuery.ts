const workspaceInputParameters = [
	'code',
	'code64',
	'lang',
	'args',
	'args64',
	'rustTargetTriple',
	'rustOptimizationProfile',
	'goTarget',
	'ocamlBackend',
	'ocamlWasmBinaryenMode'
] as const;

export function hasWorkspaceQueryInput(url: URL) {
	return workspaceInputParameters.some((parameter) => url.searchParams.has(parameter));
}

/** Consume explicit inputs so reloading an edited workspace does not import them again. */
export function consumeWorkspaceQueryInput(url: URL) {
	const editableUrl = new URL(url);
	for (const parameter of workspaceInputParameters) editableUrl.searchParams.delete(parameter);
	return editableUrl;
}
