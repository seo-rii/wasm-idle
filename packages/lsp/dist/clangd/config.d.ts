export declare const CLANGD_WORKSPACE_PATH = "/workspace";
export declare const CLANGD_WORKSPACE_URI = "file:///workspace";
export declare const CLANGD_CPP_FILE_PATH = "/workspace/main.cpp";
export declare const CLANGD_CPP_FILE_URI = "file:///workspace/main.cpp";
export type ClangdStatus = {
    state: 'disabled';
} | {
    state: 'loading';
    loaded?: number;
    total?: number;
} | {
    state: 'ready';
} | {
    state: 'error';
    message: string;
};
export declare const normalizeClangdBaseUrl: (baseUrl: string) => string;
export declare const createClangdCompileFlags: () => string[];
//# sourceMappingURL=config.d.ts.map