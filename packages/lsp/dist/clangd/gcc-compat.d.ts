export interface GccCompatibilityMemFs {
    addDirectory(path: string): void;
    addFile(path: string, contents: string): void;
}
export interface GccCompatibilityWriteFs {
    mkdirTree(path: string): void;
    writeFile(path: string, contents: string): void;
}
export interface GccCompatibilityHeader {
    path: string;
    contents: string;
}
export declare const GCC_COMPATIBILITY_HEADERS: GccCompatibilityHeader[];
export declare function installGccCompatibilityHeaders(memfs: GccCompatibilityMemFs): void;
export declare function writeGccCompatibilityHeaders(fs: GccCompatibilityWriteFs, root?: string): void;
//# sourceMappingURL=gcc-compat.d.ts.map