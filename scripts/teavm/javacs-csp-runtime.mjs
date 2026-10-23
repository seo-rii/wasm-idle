// TeaVM 0.16's JSO bridge uses dynamic Function constructors for ordinary JS calls.
// Replace only that platform bridge with equivalent closures for this fixed LSP profile.
// The compiler, language server, Wasm and the rest of the Apache-2.0 runtime are unchanged.
import { createHash } from 'node:crypto';
import ts from 'typescript';

export const JAVACS_TEAVM_RUNTIME_SHA256 =
	'd4fc035b410f444f79f49e3890643b8bfd644a02dcfc597e3fcaa8a07bafca08';

/**
 * @param {string} source
 * @param {{params:string[], body:string}[]} [bodies] Exact AOT-generated TeaVM @JSBody inventory.
 */
export function createJavacsCspRuntime(source, bodies = []) {
	if (createHash('sha256').update(source).digest('hex') !== JAVACS_TEAVM_RUNTIME_SHA256) {
		throw new Error('Unrecognized TeaVM 0.16 runtime; review its CSP bridge before updating');
	}
	if (!Array.isArray(bodies) || bodies.length > 4096)
		throw new Error('Invalid TeaVM static JSBody inventory');
	const entries = new Map();
	for (const entry of bodies) {
		if (
			!Array.isArray(entry.params) ||
			!entry.params.every(
				(name) => typeof name === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(name)
			) ||
			typeof entry.body !== 'string' ||
			entry.body.length > 1024 * 1024
		)
			throw new Error('Invalid TeaVM static JSBody');
		const key = JSON.stringify([...entry.params, entry.body]);
		const expression = `function(wrapCallFromJavaToJs${entry.params.length ? ',' : ''}${entry.params.join(',')}){${entry.body}\n}`;
		const parsed = ts.createSourceFile(
			'jso.js',
			`const body=${expression};`,
			ts.ScriptTarget.Latest,
			true,
			ts.ScriptKind.JS
		);
		if (parsed.parseDiagnostics.length) throw new Error('Invalid TeaVM static JSBody syntax');
		entries.set(key, expression);
	}
	const staticBodies = `const __javacsBodies=new Map([${[...entries].map(([key, expression]) => `[${JSON.stringify(key)},${expression}]`).join(',')}]);`;
	const file = ts.createSourceFile(
		'runtime.js',
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.JS
	);
	/** @type {{start:number,end:number,text:string}[]} */
	const edits = [];
	/** @param {ts.Node} node @param {string} text */
	const replace = (node, text) =>
		edits.push({ start: node.getStart(file), end: node.getEnd(), text });
	/** @param {ts.Node} node */
	function visit(node) {
		if (ts.isFunctionDeclaration(node)) {
			const name = node.name?.text;
			if (name === 'D') replace(node, 'function D(name){return __javacsGlobal(name).value;}');
			else if (name === 'O')
				replace(
					node,
					'function O(name,value){const target=__javacsGlobal(name,true);target.owner[target.key]=value;}'
				);
			else if (name === 'S' && node.parameters.length === 2)
				replace(
					node,
					'function S(fn,vararg){const wrapped=function(...args){try{return fn(...__javacsArgs(fn.length,vararg,args));}catch(error){j(error);}};Object.defineProperty(wrapped,"length",{value:fn.length-(vararg?1:0)});return wrapped;}'
				);
			else if (name === 'W' && node.parameters.length === 2)
				replace(
					node,
					'function W(name,constructor){const wrapped=function(marker,javaObject){return constructor.call(this,marker,javaObject);};Object.defineProperty(wrapped,"name",{value:name});return wrapped;}'
				);
		}
		if (ts.isMethodDeclaration(node) && node.name.getText(file) === 'defineMethod')
			replace(
				node,
				'defineMethod(cls,name,fn,vararg){const wrapped=function(...args){try{return fn(this,...__javacsArgs(fn.length-1,vararg,args));}catch(error){j(error);}};Object.defineProperty(wrapped,"length",{value:fn.length-1-(vararg?1:0)});cls.prototype[name]=wrapped;}'
			);
		if (ts.isForStatement(node) && node.condition?.getText(file) === 'e<32')
			replace(
				node,
				'for(let count=0;count<32;++count){const api=t.teavmJso;api["createFunction"+count]=(...parts)=>{const body=__javacsBodies.get(JSON.stringify(parts));if(!body)throw new Error("Unregistered TeaVM static JSBody");return body.bind(globalThis,k);};api["bindFunction"+count]=(fn,...args)=>fn.bind(null,...args);api["callFunction"+count]=(fn,...args)=>{try{return fn(...__javacsArgs(count,false,args));}catch(error){x(error);}};api["callMethod"+count]=(instance,method,...args)=>{try{return instance!==null?instance[method](...__javacsArgs(count,false,args)):D(method)(...__javacsArgs(count,false,args));}catch(error){x(error);}};api["construct"+count]=(constructor,...args)=>{try{return Reflect.construct(constructor,__javacsArgs(count,false,args));}catch(error){x(error);}};api["arrayOf"+count]=(...args)=>__javacsArgs(count,false,args);}'
			);
		ts.forEachChild(node, visit);
	}
	visit(file);
	if (edits.length !== 6) throw new Error('TeaVM CSP bridge structure changed');
	let result = source;
	for (const edit of edits.sort((a, b) => b.start - a.start))
		result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
	if (/\bnew\s+Function\b|\beval\s*\(/u.test(result))
		throw new Error('Dynamic JavaScript remains in TeaVM CSP runtime');
	return `// TeaVM runtime (Apache-2.0); CSP bridge adapted by wasm-idle.\n${helpers}\n${staticBodies}\n${result}`;
}

const helpers = `
function __javacsGlobal(name, allowMissing = false) {
  const parts = String(name).split('.');
  if (!parts.every(part => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(part))) throw new Error('Unsupported JavaScript global name');
  let owner = globalThis;
  for (let i = 0; i < parts.length - 1; ++i) owner = owner[parts[i]];
  const key = parts[parts.length - 1];
  if (!allowMissing && !(key in owner)) throw new ReferenceError(name + ' is not defined');
  return {owner, key, value: owner[key]};
}
function __javacsArgs(count, vararg, incoming) {
  const args = new Array(count);
  for (let i = 0; i < count; ++i) args[i] = incoming[i];
  if (vararg) args[count - 1] = incoming.slice(count - 1);
  return args;
}
`;
