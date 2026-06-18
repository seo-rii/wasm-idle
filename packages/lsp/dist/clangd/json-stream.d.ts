export declare class JsonStream {
    inJson: boolean;
    rawText: number[];
    unbalancedBraces: number;
    inString: boolean;
    inEscape: number;
    textDecoder: TextDecoder;
    insert(charCode: number): string | null;
}
//# sourceMappingURL=json-stream.d.ts.map