export const CLANGD_WORKSPACE_PATH = '/workspace';
export const CLANGD_WORKSPACE_URI = `file://${CLANGD_WORKSPACE_PATH}`;
export const CLANGD_CPP_FILE_PATH = `${CLANGD_WORKSPACE_PATH}/main.cpp`;
export const CLANGD_CPP_FILE_URI = `file://${CLANGD_CPP_FILE_PATH}`;
export const normalizeClangdBaseUrl = (baseUrl) => baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
export const createClangdCompileFlags = () => [
    '-std=gnu++2a',
    '-xc++',
    '--target=wasm32-wasi',
    '-isystem/usr/include/c++/v1',
    '-isystem/usr/include/wasm32-wasi/c++/v1',
    '-isystem/usr/include',
    '-isystem/usr/include/wasm32-wasi'
];
//# sourceMappingURL=config.js.map