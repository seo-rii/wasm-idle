set -euo pipefail
python3 - <<'PY'
from pathlib import Path
p=Path('.github/runtime-followup/publish-dotnet.sh');s=p.read_text().replace('8286647cd88275d5fb3a0dfbddd63f542771cedb','f85d57670dcadfc60d60b6d31d2088c27dcc3688')
s=s.replace('npm install --prefix /tmp/tools','npm install --legacy-peer-deps --prefix /tmp/tools')
old='git apply /tmp/dotnet.patch'
new='''git apply --exclude=runtimes/wasm-dotnet/src/compiler.ts /tmp/dotnet.patch
python3 - <<'FIX'
from pathlib import Path
p=Path('runtimes/wasm-dotnet/src/compiler.ts');s=p.read_text();a=s.index('async prepare(');b=s.index('async compile(',a);part=s[a:b]
assert part.count('await Promise.all([')==1
part=part.replace('await Promise.all([','const [runtime, references] = await Promise.all([')
part=part.replace('\\t\\t\\t]);','\\t\\t\\t]);\\n\\t\\t\\tawait runtime.prepareReferences?.(references);')
p.write_text(s[:a]+part+s[b:])
FIX'''
assert old in s;s=s.replace(old,new)
s=s.replace('node /tmp/tools/node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit','node scripts/clean-module-output.mjs\nnode /tmp/tools/node_modules/typescript/bin/tsc -p tsconfig.build.json')
s=s.replace('git add runtimes/wasm-dotnet/src','git add runtimes/wasm-dotnet/dotnet/WasmDotnet.Compiler/ReferenceSetRegistry.cs runtimes/wasm-dotnet/src')
Path('/tmp/publish-dotnet-current.sh').write_text(s)
PY
bash /tmp/publish-dotnet-current.sh
