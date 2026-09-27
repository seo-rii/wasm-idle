import os
from pathlib import Path
name='probe-ruby-prepared-worker.mjs' if os.environ['LANGUAGE']=='ruby' else 'probe-php-startup-retry.mjs'
p=Path('scripts')/name
s=p.read_text()
assert s.count("import { build } from 'esbuild';")==1
s=s.replace("import { build } from 'esbuild';", "import { build as buildWithVite } from 'vite';")
assert s.count('readFile, mkdtemp, rm')==1
s=s.replace('readFile, mkdtemp, rm','readFile, writeFile, mkdtemp, rm')
helper='''// Use the repository's declared Vite dependency rather than an undeclared bundler.
async function build(options) {
	let entry = options.entryPoints?.[0];
	if (options.stdin) {
		entry = path.join(path.dirname(options.outfile), 'probe-entry.ts');
		await writeFile(entry, options.stdin.contents);
	}
	await buildWithVite({
		root,
		configFile: false,
		publicDir: false,
		logLevel: 'error',
		resolve: { alias: options.alias },
		build: {
			target: options.target,
			outDir: path.dirname(options.outfile),
			emptyOutDir: false,
			minify: false,
			copyPublicDir: false,
			lib: { entry, formats: ['es'], fileName: () => path.basename(options.outfile) },
			rollupOptions: { output: { inlineDynamicImports: true } }
		}
	});
}

'''
assert s.count('const root =')==1
s=s.replace('const root =',helper+'const root =')
for line in ["\n\t\tbundle: true,", "\n\t\tformat: 'esm',", "\n\t\tplatform: 'browser',"]:
    s=s.replace(line,'')
s=s.replace(",\n\t\t\tresolveDir: root",'')
p.write_text(s)
