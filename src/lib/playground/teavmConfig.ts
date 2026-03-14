export const normalizeTeaVmBaseUrl = (baseUrl: string) =>
	baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

const normalizePathPrefix = (pathPrefix: string) => {
	if (!pathPrefix) return '';
	return pathPrefix.endsWith('/') ? pathPrefix.slice(0, -1) : pathPrefix;
};

export const resolveTeaVmBaseUrl = (pathPrefix = '', currentUrl = '') => {
	const configuredBaseUrl = (import.meta.env.PUBLIC_TEAVM_BASE_URL || '').trim();
	const baseUrl = configuredBaseUrl
		? normalizeTeaVmBaseUrl(configuredBaseUrl)
		: `${normalizePathPrefix(pathPrefix) || ''}/teavm/`;
	return currentUrl ? new URL(baseUrl, currentUrl).href : baseUrl;
};

export const resolveTeaVmAssetUrl = (baseUrl: string, assetPath: string) =>
	new URL(assetPath, normalizeTeaVmBaseUrl(baseUrl)).href;
