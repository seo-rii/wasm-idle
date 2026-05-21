#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v gh >/dev/null 2>&1; then
    echo "gh CLI is required but not installed." >&2
    exit 1
fi

if ! command -v git >/dev/null 2>&1; then
    echo "git is required but not installed." >&2
    exit 1
fi

workflow="deploy.yml"
watch_run=0
ref=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        -s|--s|--small)
            workflow="deploy-s.yml"
            shift
            ;;
        -r|--ref)
            if [[ $# -lt 2 ]]; then
                echo "--ref requires a value." >&2
                exit 1
            fi
            ref="$2"
            shift 2
            ;;
        -w|--watch)
            watch_run=1
            shift
            ;;
        -h|--help)
            cat <<'EOF'
Usage: ./dool-deploy.sh [options]

Triggers GitHub Actions workflow_dispatch for the dool repository.

Options:
  -s, --s, --small       Trigger deploy-s.yml instead of deploy.yml
  -r, --ref <ref>        Git ref to run the workflow on (default: current branch)
  -w, --watch            Wait for the triggered run to complete
  -h, --help             Show this help message
EOF
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            cat >&2 <<'EOF'
Usage: ./dool-deploy.sh [options]

Triggers GitHub Actions workflow_dispatch for the dool repository.

Options:
  -s, --s, --small       Trigger deploy-s.yml instead of deploy.yml
  -r, --ref <ref>        Git ref to run the workflow on (default: current branch)
  -w, --watch            Wait for the triggered run to complete
  -h, --help             Show this help message
EOF
            exit 1
            ;;
    esac
done

if [[ -z "$ref" ]]; then
    ref="$(git branch --show-current)"
fi

if [[ -z "$ref" ]]; then
    echo "Unable to determine git ref. Use --ref <ref>." >&2
    exit 1
fi

repo="$(git remote get-url origin 2>/dev/null || true)"
triggered_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [[ -n "$repo" ]]; then
    echo "Repository: $repo"
fi
echo "Workflow: $workflow"
echo "Ref: $ref"

gh workflow run "$workflow" --ref "$ref"
echo "Triggered $workflow on $ref."

if [[ "$watch_run" -eq 1 ]]; then
    echo "Waiting for the triggered run to appear..."
    run_id=""

    for _ in {1..10}; do
        run_id="$(gh run list \
            --workflow "$workflow" \
            --branch "$ref" \
            --event workflow_dispatch \
            --limit 20 \
            --json databaseId,createdAt \
            --jq "map(select(.createdAt >= \"$triggered_at\"))[0].databaseId")"

        if [[ -n "$run_id" && "$run_id" != "null" ]]; then
            break
        fi

        sleep 3
    done

    if [[ -z "$run_id" || "$run_id" == "null" ]]; then
        echo "Triggered the workflow, but could not find the new run id to watch." >&2
        exit 1
    fi

    gh run watch "$run_id"
fi
