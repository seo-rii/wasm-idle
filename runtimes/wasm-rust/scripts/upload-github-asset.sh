#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
    cat <<'EOF'
Usage: ./scripts/upload-github-asset.sh --tag <tag> [options] [asset[#label] ...]

Upload one or more assets to a GitHub release using gh CLI.

Options:
  -t, --tag <tag>           Release tag to upload to
  -r, --repo <owner/name>   GitHub repository (default: GH_REPO or origin remote)
  -C, --create-release      Create the release first if it does not exist
  -T, --target <ref>        Git ref or commit for --create-release (default: HEAD)
  -b, --build               Run `pnpm build` before packaging/upload
  -p, --pack-dist [path]    Create a .tgz from ./dist and upload it
                            If path is omitted, defaults to ./artifacts/wasm-rust-<tag>.tgz
  -c, --clobber             Replace an existing asset with the same name
  -h, --help                Show this help message

Examples:
  ./scripts/upload-github-asset.sh --tag v0.1.0 ./dist/runtime/runtime-manifest.v3.json
  ./scripts/upload-github-asset.sh --tag v0.1.0 --create-release
  ./scripts/upload-github-asset.sh --tag v0.1.0 --build --pack-dist
  ./scripts/upload-github-asset.sh --tag v0.1.0 --create-release --build --pack-dist
  ./scripts/upload-github-asset.sh --tag v0.1.0 --repo owner/wasm-rust ./artifacts/wasm-rust-v0.1.0.tgz

Notes:
  - Without --create-release, the target release must already exist.
  - Asset labels can use gh's `path#display-name` syntax.
EOF
}

require_command() {
    local name="$1"
    if ! command -v "$name" >/dev/null 2>&1; then
        echo "$name is required but not installed." >&2
        exit 1
    fi
}

normalize_repo() {
    local raw="$1"
    raw="${raw%.git}"
    raw="${raw%/}"

    if [[ "$raw" =~ ^git@github\.com:(.+/.+)$ ]]; then
        printf '%s\n' "${BASH_REMATCH[1]}"
        return 0
    fi

    if [[ "$raw" =~ ^ssh://git@github\.com/(.+/.+)$ ]]; then
        printf '%s\n' "${BASH_REMATCH[1]}"
        return 0
    fi

    if [[ "$raw" =~ ^https://github\.com/(.+/.+)$ ]]; then
        printf '%s\n' "${BASH_REMATCH[1]}"
        return 0
    fi

    return 1
}

require_command gh
require_command git
require_command tar

tag=""
repo="${GH_REPO:-}"
run_build=0
clobber=0
create_release=0
target_ref="HEAD"
pack_dist=""
declare -a assets=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        -t|--tag)
            if [[ $# -lt 2 ]]; then
                echo "$1 requires a value." >&2
                exit 1
            fi
            tag="$2"
            shift 2
            ;;
        -r|--repo)
            if [[ $# -lt 2 ]]; then
                echo "$1 requires a value." >&2
                exit 1
            fi
            repo="$2"
            shift 2
            ;;
        -C|--create-release)
            create_release=1
            shift
            ;;
        -T|--target)
            if [[ $# -lt 2 ]]; then
                echo "$1 requires a value." >&2
                exit 1
            fi
            target_ref="$2"
            shift 2
            ;;
        -b|--build)
            run_build=1
            shift
            ;;
        -p|--pack-dist)
            if [[ $# -gt 1 && "${2:-}" != "" && "${2:0:1}" != "-" ]]; then
                pack_dist="$2"
                shift 2
            else
                pack_dist="__AUTO__"
                shift
            fi
            ;;
        -c|--clobber)
            clobber=1
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        --)
            shift
            ;;
        -*)
            echo "Unknown option: $1" >&2
            usage >&2
            exit 1
            ;;
        *)
            assets+=("$1")
            shift
            ;;
    esac
done

if [[ -z "$tag" ]]; then
    echo "--tag is required." >&2
    usage >&2
    exit 1
fi

if [[ -z "$repo" ]]; then
    origin_url="$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null || true)"
    if [[ -n "$origin_url" ]]; then
        repo="$(normalize_repo "$origin_url" || true)"
    fi
fi

if [[ -z "$repo" ]]; then
    echo "Unable to determine GitHub repository. Use --repo <owner/name> or set GH_REPO." >&2
    exit 1
fi

if [[ "$pack_dist" == "__AUTO__" ]]; then
    pack_dist="$REPO_ROOT/artifacts/wasm-rust-${tag}.tgz"
fi

if [[ "$create_release" -eq 1 && "$target_ref" == "HEAD" ]]; then
    target_ref="$(git -C "$REPO_ROOT" rev-parse HEAD)"
fi

if [[ "$run_build" -eq 1 ]]; then
    require_command pnpm
    echo "Building wasm-rust..."
    (
        cd "$REPO_ROOT"
        pnpm build
    )
fi

if [[ -n "$pack_dist" ]]; then
    mkdir -p "$(dirname "$pack_dist")"

    if [[ ! -d "$REPO_ROOT/dist" ]]; then
        echo "dist/ does not exist. Run with --build first or build the project before packing." >&2
        exit 1
    fi

    echo "Packing dist/ -> $pack_dist"
    tar -C "$REPO_ROOT" -czf "$pack_dist" dist
    assets+=("$pack_dist")
fi

if [[ "$create_release" -eq 1 ]]; then
    if gh release view "$tag" --repo "$repo" >/dev/null 2>&1; then
        echo "Release $tag already exists on $repo; skipping create."
    else
        echo "Creating release $tag on $repo at target $target_ref"
        gh release create "$tag" --repo "$repo" --target "$target_ref" --title "$tag"
    fi
fi

if [[ "${#assets[@]}" -eq 0 && "$create_release" -eq 0 ]]; then
    echo "At least one asset path, --pack-dist, or --create-release is required." >&2
    usage >&2
    exit 1
fi

if [[ "${#assets[@]}" -eq 0 ]]; then
    echo "Release create step completed. No assets requested for upload."
    exit 0
fi

for asset in "${assets[@]}"; do
    asset_path="${asset%%#*}"
    if [[ ! -f "$asset_path" ]]; then
        echo "Asset file not found: $asset_path" >&2
        exit 1
    fi
done

declare -a upload_cmd=("gh" "release" "upload" "$tag" "--repo" "$repo")
if [[ "$clobber" -eq 1 ]]; then
    upload_cmd+=("--clobber")
fi
upload_cmd+=("${assets[@]}")

echo "Repository: $repo"
echo "Tag: $tag"
if [[ "$create_release" -eq 1 ]]; then
    echo "Create release target: $target_ref"
fi
printf 'Assets:\n'
for asset in "${assets[@]}"; do
    printf '  - %s\n' "$asset"
done

echo "Uploading release assets with gh..."
"${upload_cmd[@]}"
echo "Upload complete."
