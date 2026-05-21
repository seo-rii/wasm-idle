#!/usr/bin/env bash
set -euo pipefail

IMAGE_REF="${1:-}"

if [ -z "$IMAGE_REF" ]; then
    echo "usage: $0 <image-ref>" >&2
    exit 1
fi

REPO_DIGEST="$(docker image inspect "$IMAGE_REF" --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}' 2>/dev/null || true)"

echo "## Judge Toolchain Versions"
echo
echo "- Image: \`$IMAGE_REF\`"

if [ -n "$REPO_DIGEST" ]; then
    echo "- Repo digest: \`$REPO_DIGEST\`"
fi

echo

docker run --rm -i --entrypoint bash "$IMAGE_REF" <<'EOF'
set -euo pipefail

report() {
    local name="$1"
    shift
    local output

    if output="$("$@" 2>&1)"; then
        :
    else
        output="<command failed>"
    fi

    output="$(printf "%s" "$output" | sed -n "1p" | tr -d "\r" | sed "s/|/\\\\|/g")"
    printf '| %s | `%s` |\n' "$name" "$output"
}

echo "| Tool | Version |"
echo "| --- | --- |"
report "Node.js" node --version
report "npm" npm --version
report "pnpm" pnpm --version
report "TypeScript" tsc --version
report "GCC" gcc --version
report "G++" g++ --version
report "Python" python3.13 --version
report "PyPy" pypy3 --version
report "Java compiler" javac -version
report "Java runtime" java -version
report "Rust" rustc --version
report "Go" go version
report "OCaml (native)" ocamlopt -version
report "OCaml (bytecode)" ocamlc -version
report "GHC" ghc --version
report "Kotlin/Native" kotlinc-native -version
report "Ruby" ruby -e "print RUBY_VERSION, \"\n\""
report "Elixir" elixir -e "IO.puts(System.version())"
report "PHP" php --version
report ".NET" dotnet --version
report "Lua compiler" luac5.4 -v
report "Lua runtime" lua5.4 -v
report "Perl" perl -e "print sprintf(q(v%vd\n), \$^V)"
EOF
