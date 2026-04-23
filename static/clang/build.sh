#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
if [ ! -d sysroot ]; then
	echo "static/clang/sysroot is not checked in. Generate it locally before rebuilding sysroot.tar.zip." >&2
	exit 1
fi

tar --format=ustar -cf bin/sysroot.tar -C sysroot .
(cd bin && python3 -m zipfile -c sysroot.tar.zip sysroot.tar)
rm bin/sysroot.tar
