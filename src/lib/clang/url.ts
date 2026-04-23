const normalizeBaseUrl = (baseUrl: string) =>
	baseUrl ? (baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`) : '/clang/';

export const memfsUrl = (baseUrl: string) => `${normalizeBaseUrl(baseUrl)}bin/memfs.zip`;
export const clangUrl = (baseUrl: string) => `${normalizeBaseUrl(baseUrl)}bin/clang.zip`;
export const lldUrl = (baseUrl: string) => `${normalizeBaseUrl(baseUrl)}bin/lld.zip`;
export const rootUrl = (baseUrl: string) => `${normalizeBaseUrl(baseUrl)}bin/sysroot.tar.zip`;
