const QUOTE = 34;
const LEFT_BRACE = 123;
const RIGHT_BRACE = 125;
const BACKSLASH = 92;

export class JsonStream {
	inJson = false;
	rawText: number[] = [];
	unbalancedBraces = 0;
	inString = false;
	inEscape = 0;
	textDecoder = new TextDecoder();

	insert(charCode: number): string | null {
		if (!this.inJson && charCode === LEFT_BRACE) {
			this.inJson = true;
			this.rawText = [];
		}
		if (!this.inJson) return null;
		this.rawText.push(charCode);
		if (this.inString) {
			if (this.inEscape) {
				if (charCode === 75) this.inEscape += 4;
				this.inEscape -= 1;
			} else if (charCode === BACKSLASH) {
				this.inEscape = 1;
			} else if (charCode === QUOTE) {
				this.inString = false;
			}
		} else if (charCode === LEFT_BRACE) {
			this.unbalancedBraces += 1;
		} else if (charCode === RIGHT_BRACE) {
			this.unbalancedBraces -= 1;
			if (this.unbalancedBraces === 0) {
				this.inJson = false;
				return this.textDecoder.decode(new Uint8Array(this.rawText));
			}
		} else if (charCode === QUOTE) {
			this.inString = true;
		}
		return null;
	}
}
