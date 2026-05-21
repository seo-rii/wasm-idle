const { createClangCompiler, executeBrowserClangArtifact } = await import(
	new URL('../dist/index.js', import.meta.url)
);

const compiler = await createClangCompiler();
const result = await compiler.compile({
	language: 'C',
	code: '#include <stdio.h>\nint main() { puts("probe-ok"); }\n'
});

if (!result.success || !result.artifact) {
	throw new Error(result.stderr || 'wasm-clang smoke compile failed');
}

const execution = await executeBrowserClangArtifact(result.artifact);
if (!execution.stdout.includes('probe-ok')) {
	throw new Error(`wasm-clang smoke execution failed: ${execution.stdout}`);
}

const pbdsResult = await compiler.compile({
	language: 'CPP',
	code: `#include <bits/stdc++.h>
#include <bits/extc++.h>
#include <ext/rope>
#include <ext/pb_ds/assoc_container.hpp>
#include <ext/pb_ds/tree_policy.hpp>
using namespace std;
using namespace __gnu_cxx;
using namespace __gnu_pbds;

using ordered_set = tree<int, null_type, less<int>, rb_tree_tag, tree_order_statistics_node_update>;

int main() {
	ordered_set values;
	values.insert(10);
	values.insert(3);
	values.insert(7);
	gp_hash_table<int, int> table;
	table[4] = 9;
	crope text("abc");
	text.insert(1, "XY");
	text.erase(3, 1);
	__gnu_pbds::priority_queue<int> heap;
	heap.push(2);
	heap.push(5);
	hash_standard_resize_policy<> resize_policy;
	(void)resize_policy;
	cout << *values.find_by_order(1) << " " << values.order_of_key(8) << " " << table[4] << " " << text << " " << heap.top() << "\\n";
}
`
});

if (!pbdsResult.success || !pbdsResult.artifact) {
	throw new Error(pbdsResult.stderr || 'wasm-clang PBDS smoke compile failed');
}

const pbdsExecution = await executeBrowserClangArtifact(pbdsResult.artifact);
if (pbdsExecution.stdout.trim() !== '7 2 9 aXYc 5') {
	throw new Error(`wasm-clang PBDS smoke execution failed: ${pbdsExecution.stdout}`);
}

console.log('wasm-clang smoke runtime verified');
