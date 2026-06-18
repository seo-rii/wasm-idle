import { describe, expect, it } from 'vitest';

import { instrumentRustDebugSource, RUST_DEBUG_MARKER } from './rustDebugInstrumentation';

describe('instrumentRustDebugSource', () => {
	it('adds same-line trace markers before Rust block statements', () => {
		const source = `fn add(x: i32) -> i32 {
    let y = x + 1;
    if y > 2 {
        println!("{}", y);
    } else {
        return y;
    }
    y
}

fn main() { add(1); }
`;

		const instrumented = instrumentRustDebugSource(source);

		expect(instrumented).toContain(
			`eprintln!("${RUST_DEBUG_MARKER}:{}:{}", 2, "add"); let y = x + 1;`
		);
		expect(instrumented).toContain(
			`eprintln!("${RUST_DEBUG_MARKER}:{}:{}", 3, "add"); if y > 2`
		);
		expect(instrumented).toContain(
			`eprintln!("${RUST_DEBUG_MARKER}:{}:{}", 4, "add"); println!("{}", y);`
		);
		expect(instrumented).toContain(
			`eprintln!("${RUST_DEBUG_MARKER}:{}:{}", 6, "add"); return y;`
		);
		expect(instrumented).toContain(`eprintln!("${RUST_DEBUG_MARKER}:{}:{}", 8, "add"); y`);
		expect(instrumented).toContain(
			`fn main() { eprintln!("${RUST_DEBUG_MARKER}:{}:{}", 11, "main"); add(1); }`
		);
		expect(instrumented.split('\n')).toHaveLength(source.split('\n').length);
	});
});
