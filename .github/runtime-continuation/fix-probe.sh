set -euo pipefail
python3 - <<'PY'
from pathlib import Path
p=Path('.github/runtime-continuation/validate-publish.sh')
s=p.read_text(); old='git apply /tmp/runtime-change.patch'
assert s.count(old)==1
s=s.replace(old,old+'''
if [ "$LANGUAGE" = ruby ]; then
    python3 - <<'FIX'
from pathlib import Path
p=Path('scripts/probe-ruby-prepared-worker.mjs');s=p.read_text()
assert s.count("name.slice('/assets/'.length)")==1
assert s.count("name.startsWith('/assets/')")==1
s=s.replace("name.slice('/assets/'.length)","name.slice('/assets/split/'.length)").replace("name.startsWith('/assets/')","name.startsWith('/assets/split/')")
p.write_text(s)
FIX
fi''')
p.write_text(s)
PY
