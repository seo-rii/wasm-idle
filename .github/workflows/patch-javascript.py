from pathlib import Path


def replace_once(s, old, new):
    assert s.count(old) == 1, repr(old)
    return s.replace(old, new, 1)


p = Path('runtimes/wasm-typescript/scripts/build.mjs')
s = p.read_text()
anchor = "await writeWasmTypeScriptProducerBuildReceipt({ producerDir: REPO_ROOT });"
addition = """// Keep the JavaScript entry self-contained so the existing verified Blob loader
// does not acquire an unverified dynamic-import graph.
const javascriptBuild = await build({
\tentryPoints: [path.join(REPO_ROOT, 'src', 'index.ts')],
\toutfile: path.join(REPO_ROOT, 'dist', 'javascript.js'),
\tbundle: true,
\tformat: 'esm',
\tplatform: 'browser',
\ttarget: 'es2022',
\tsourcemap: false,
\tminify: true,
\tmetafile: true,
\talias: {
\t\t'@swc/wasm-typescript': path.join(THIS_DIR, 'javascript-only-transform.mjs')
\t},
\tplugins: [emptyNodeBuiltinPlugin, swcBrowserShimPlugin],
\tbanner: { js: '/* wasm-idle JavaScript-only browser bundle */' }
});
if (Object.keys(javascriptBuild.metafile.inputs).some((name) => name.includes('node_modules/@swc/'))) {
\tthrow new Error('The JavaScript-only bundle must not include SWC');
}
if (Object.values(javascriptBuild.metafile.outputs).some((output) => output.imports.length !== 0)) {
\tthrow new Error('The JavaScript-only bundle must be self-contained');
}

"""
s = replace_once(s, anchor, addition + anchor)
p.write_text(s)

p = Path('runtimes/wasm-typescript/scripts/provenance.mjs')
s = p.read_text()
s = replace_once(s, "\tconst artifactBytes = await readFile(artifactPath);", """\tconst artifactBytes = await readFile(artifactPath);
\tconst javascriptBytes = await readFile(path.join(path.resolve(sourceDir), 'javascript.js')).catch((error) => {
\t\tif (error.code === 'ENOENT') return null;
\t\tthrow error;
\t});""")
s = replace_once(s, "\t\tartifact: {\n", """\t\t...(javascriptBytes ? {
\t\t\tjavascriptArtifact: {
\t\t\t\tpath: 'javascript.js',
\t\t\t\tbytes: javascriptBytes.byteLength,
\t\t\t\tsha256: sha256(javascriptBytes)
\t\t\t}
\t\t} : {}),
\t\tartifact: {
""")
anchor = '\treturn expected;'
s = replace_once(s, anchor, """\tif (JSON.stringify(actual.javascriptArtifact) !== JSON.stringify(expected.javascriptArtifact)) {
\t\tthrow new Error('wasm-typescript producer artifact receipt does not match javascript.js; rebuild the runtime before syncing');
\t}
""" + anchor)
p.write_text(s)

p = Path('scripts/sync-wasm-typescript.mjs')
s = p.read_text()
s = replace_once(s, 'function runtimeBuildReceipt(fingerprint, moduleReceipt, producer)', 'function runtimeBuildReceipt(fingerprint, moduleReceipt, producer, javascriptModuleReceipt = null)')
s = replace_once(s, '[ENTRY_MODULE]: moduleReceipt\n', "[ENTRY_MODULE]: moduleReceipt,\n\t\t\t...(javascriptModuleReceipt ? { 'javascript.js': javascriptModuleReceipt } : {})\n")
s = replace_once(s, 'async function writeRuntimeBuildReceipt(targetDir, fingerprint, moduleReceipt, producer)', 'async function writeRuntimeBuildReceipt(targetDir, fingerprint, moduleReceipt, producer, javascriptModuleReceipt = null)')
s = replace_once(s, 'runtimeBuildReceipt(fingerprint, moduleReceipt, producer);', 'runtimeBuildReceipt(fingerprint, moduleReceipt, producer, javascriptModuleReceipt);')
start = s.index('function renderVersionModule(')
end = s.index('\n/**', start)
s = s[:start] + r'''function renderVersionModule(fingerprint, moduleReceipt, javascriptModuleReceipt = null) {
	const typescript = `export const WASM_TYPESCRIPT_ASSET_VERSION = '${fingerprint}';

export const WASM_TYPESCRIPT_MODULE_RECEIPT = Object.freeze({
\tbytes: ${moduleReceipt.bytes},
\tsha256: '${moduleReceipt.sha256}'
});
`;
	return typescript + (javascriptModuleReceipt ? `
export const WASM_JAVASCRIPT_MODULE_RECEIPT = Object.freeze({
\tbytes: ${javascriptModuleReceipt.bytes},
\tsha256: '${javascriptModuleReceipt.sha256}'
});
` : '');
}
''' + s[end:]
s = replace_once(s, 'async function writeVersionModule(versionModulePath, fingerprint, moduleReceipt)', 'async function writeVersionModule(versionModulePath, fingerprint, moduleReceipt, javascriptModuleReceipt = null)')
s = replace_once(s, 'renderVersionModule(fingerprint, moduleReceipt);', 'renderVersionModule(fingerprint, moduleReceipt, javascriptModuleReceipt);')
s = replace_once(s, 'async function readInstalledEntryModule(targetDir)', 'async function readInstalledEntryModule(targetDir, entryModule = ENTRY_MODULE)')
s = replace_once(s, 'const modulePath = path.join(targetDir, ENTRY_MODULE);', 'const modulePath = path.join(targetDir, entryModule);')
s = replace_once(s, "throw new Error('wasm-typescript target contains both index.js and index.js.gz');", "throw new Error(`wasm-typescript target contains both ${entryModule} and ${entryModule}.gz`);")
anchor = 'export async function verifyWasmTypeScriptDist('
helper = """/** @param {string} sourceDir @returns {Promise<Readonly<TypeScriptModuleReceipt> | null>} */
async function readJavaScriptModuleReceipt(sourceDir) {
\ttry {
\t\treturn await computeModuleReceipt(path.join(sourceDir, 'javascript.js'));
\t} catch (error) {
\t\tif (error.code === 'ENOENT') return null;
\t\tthrow error;
\t}
}

"""
s = replace_once(s, anchor, helper + anchor)
anchor = '\tconst sourceModuleReceipt = await computeModuleReceipt(path.join(sourceDir, ENTRY_MODULE));'
s = replace_once(s, anchor, anchor + """
\tconst javascriptModuleReceipt = await readJavaScriptModuleReceipt(sourceDir);
\tif (javascriptModuleReceipt) {
\t\tconst installedJavaScript = computeModuleReceiptFromBytes(await readInstalledEntryModule(targetDir, 'javascript.js'));
\t\tif (JSON.stringify(installedJavaScript) !== JSON.stringify(javascriptModuleReceipt)) {
\t\t\tthrow new Error('wasm-typescript checked-in JavaScript module does not match the current producer output');
\t\t}
\t}""")
s = replace_once(s, 'runtimeBuildReceipt(fingerprint, sourceModuleReceipt, producer);', 'runtimeBuildReceipt(fingerprint, sourceModuleReceipt, producer, javascriptModuleReceipt);')
s = replace_once(s, 'renderVersionModule(fingerprint, sourceModuleReceipt);', 'renderVersionModule(fingerprint, sourceModuleReceipt, javascriptModuleReceipt);')
anchor = '\tconst moduleReceipt = await computeModuleReceipt(path.join(targetDir, ENTRY_MODULE));'
s = replace_once(s, anchor, anchor + "\n\tconst javascriptModuleReceipt = await readJavaScriptModuleReceipt(targetDir);")
s = replace_once(s, '\t\tmoduleReceipt,\n\t\tproducer\n\t);', '\t\tmoduleReceipt,\n\t\tproducer,\n\t\tjavascriptModuleReceipt\n\t);')
s = replace_once(s, 'await writeVersionModule(versionModulePath, fingerprint, moduleReceipt);', 'await writeVersionModule(versionModulePath, fingerprint, moduleReceipt, javascriptModuleReceipt);')
p.write_text(s)

p = Path('src/lib/playground/assets.ts')
s = p.read_text()
s = replace_once(s, 'export interface TypeScriptRuntimeAssetConfig {\n\tmoduleUrl?: string;', "export interface TypeScriptRuntimeAssetConfig {\n\tmoduleUrl?: string;\n\t/** Optional self-contained JavaScript-only bundle; omitted retains the legacy module. */\n\tjavascriptModuleUrl?: string;")
p.write_text(s)

p = Path('src/lib/playground/applicationAssets.ts')
s = p.read_text()
anchor = "moduleUrl: asset('wasm-typescript/index.js', WASM_TYPESCRIPT_ASSET_VERSION),"
s = replace_once(s, anchor, anchor + "\n\t\t\tjavascriptModuleUrl: asset('wasm-typescript/javascript.js', WASM_TYPESCRIPT_ASSET_VERSION),")
p.write_text(s)

p = Path('src/lib/playground/typescript.ts')
s = p.read_text()
s = replace_once(s, "import { WASM_TYPESCRIPT_MODULE_RECEIPT }", "import { WASM_TYPESCRIPT_MODULE_RECEIPT, WASM_JAVASCRIPT_MODULE_RECEIPT }")
s = replace_once(s, '\t\tlet nextModuleUrl: string;', '\t\tlet nextModuleUrl: string;\n\t\tlet selectedModuleReceipt: { readonly bytes: number; readonly sha256: string } = WASM_TYPESCRIPT_MODULE_RECEIPT;')
anchor = '\t\t\t\tconst configuredModuleUrl = configuredTypeScript?.moduleUrl;'
s = replace_once(s, anchor, """\t\t\t\tconst configuredJavaScriptModuleUrl = this.language === 'JAVASCRIPT'
\t\t\t\t\t? configuredTypeScript?.javascriptModuleUrl : undefined;
\t\t\t\tthis.requireOperationActive(activeOperation);
\t\t\t\tif (configuredJavaScriptModuleUrl !== undefined && typeof configuredJavaScriptModuleUrl !== 'string') {
\t\t\t\t\tthrow new TypeError('JavaScript runtime module URL must be a string');
\t\t\t\t}
\t\t\t\tconst configuredModuleUrl = configuredJavaScriptModuleUrl || configuredTypeScript?.moduleUrl;
\t\t\t\tif (configuredJavaScriptModuleUrl) selectedModuleReceipt = WASM_JAVASCRIPT_MODULE_RECEIPT;""")
s = s.replace('WASM_TYPESCRIPT_MODULE_RECEIPT.bytes > limits.maxAssetBytes', 'selectedModuleReceipt.bytes > limits.maxAssetBytes')
s = s.replace('actual: WASM_TYPESCRIPT_MODULE_RECEIPT.bytes', 'actual: selectedModuleReceipt.bytes')
s = s.replace('moduleReceipt: { ...WASM_TYPESCRIPT_MODULE_RECEIPT }', 'moduleReceipt: { ...selectedModuleReceipt }')
p.write_text(s)

p = Path('src/lib/sync-wasm-typescript.test.ts')
s = p.read_text()
s += """

describe('JavaScript-only runtime receipts', () => {
\tit('publishes both independently verified entries and rejects modified JavaScript bytes', async () => {
\t\tconst fixture = await createFixture();
\t\tawait writeFile(path.join(fixture.sourceDir, 'index.js'), 'export const full = true;');
\t\tawait writeFile(path.join(fixture.sourceDir, 'javascript.js'), 'export const lightweight = true;');
\t\tawait writeWasmTypeScriptProducerBuildReceipt(fixture);
\t\tawait syncWasmTypeScriptDist(fixture);
\t\tconst receipt = JSON.parse(await readFile(path.join(fixture.targetDir, 'runtime-build.json'), 'utf8'));
\t\texpect(Object.keys(receipt.assets).sort()).toEqual(['index.js', 'javascript.js']);
\t\texpect(await readFile(fixture.versionModulePath, 'utf8')).toContain('WASM_JAVASCRIPT_MODULE_RECEIPT');
\t\tawait expect(verifyWasmTypeScriptDist(fixture)).resolves.toBeDefined();
\t\tawait writeFile(path.join(fixture.targetDir, 'javascript.js'), 'tampered');
\t\tawait expect(verifyWasmTypeScriptDist(fixture)).rejects.toThrow(/JavaScript module does not match/);
\t});

\tit('verifies compressed JavaScript, rejects ambiguity, and fails on missing delivery bytes', async () => {
\t\tconst fixture = await createFixture();
\t\tawait writeFile(path.join(fixture.sourceDir, 'index.js'), 'export const full = true;');
\t\tawait writeFile(path.join(fixture.sourceDir, 'javascript.js'), 'export const lightweight = true;');
\t\tawait writeWasmTypeScriptProducerBuildReceipt(fixture);
\t\tawait syncWasmTypeScriptDist(fixture);
\t\tconst target = path.join(fixture.targetDir, 'javascript.js');
\t\tawait writeFile(target + '.gz', gzipSync(await readFile(target)));
\t\tawait expect(verifyWasmTypeScriptDist(fixture)).rejects.toThrow(/both javascript.js/);
\t\tawait rm(target);
\t\tawait expect(verifyWasmTypeScriptDist(fixture)).resolves.toBeDefined();
\t\tawait rm(target + '.gz');
\t\tawait expect(verifyWasmTypeScriptDist(fixture)).rejects.toThrow(/entry was not found/);
\t});

\tit('rejects a JavaScript producer artifact removed after receipt generation', async () => {
\t\tconst fixture = await createFixture();
\t\tawait writeFile(path.join(fixture.sourceDir, 'index.js'), 'export const full = true;');
\t\tawait writeFile(path.join(fixture.sourceDir, 'javascript.js'), 'export const lightweight = true;');
\t\tawait writeWasmTypeScriptProducerBuildReceipt(fixture);
\t\tawait rm(path.join(fixture.sourceDir, 'javascript.js'));
\t\tawait expect(syncWasmTypeScriptDist(fixture)).rejects.toThrow(/receipt does not match javascript.js/);
\t});
});
"""
p.write_text(s)
