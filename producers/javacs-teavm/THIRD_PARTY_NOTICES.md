# Original javacs browser build

The language server is George Fraser's java-language-server 0.2.38, revision
7fffb6c5929fe02c52e1c823ae990bad2b540ad1, under the MIT license. Its original
license is included beside this notice. Source and changes:
https://github.com/georgewfraser/java-language-server/tree/7fffb6c5929fe02c52e1c823ae990bad2b540ad1

The compiler input and shipped platform class files are Debian OpenJDK
17.0.20.1+1-1~deb12u1. Their GPL version 2 with Classpath exception and additional
notices are included under openjdk/ for every input module. Source packages:
https://security.debian.org/debian-security/pool/updates/main/o/openjdk-17/
The upstream source repository is https://github.com/openjdk/jdk17u .

TeaVM 0.16.0, Copyright Alexey Andreev and contributors, is licensed under
Apache License 2.0. Its compiler runtime and Java class library produce the
WasmGC program. Compiler platform hooks are adapted from teavm-javac's
Patches.java, Copyright 2025 Alexey Andreev, under Apache License 2.0.
https://github.com/konsoletyper/teavm/tree/0.16.0
https://github.com/konsoletyper/teavm-javac

Gson 2.8.5, Copyright Google Inc., is licensed under Apache License 2.0.
Its JSON parser, writer and primitive codecs are used. Runtime reflective DTO
mapping is replaced with adapters generated from the original JVM classes.
https://github.com/google/gson/tree/gson-parent-2.8.5

Protocol Buffers Java 3.9.1, Copyright Google Inc., is licensed under the
BSD 3-Clause license. It is a compile input for upstream javacs's original
generated protocol classes; the plain Java browser profile excludes Bazel.
https://github.com/protocolbuffers/protobuf/tree/v3.9.1

JZlib 1.1.3, Copyright 2000-2011 ymnk, JCraft, Inc., supplies the Java ZIP
inflater used by TeaVM and is licensed under the BSD 3-Clause license. Its
original source license and zlib attribution are included separately.
https://www.jcraft.com/jzlib/

The build-only ZIP packager pins Debian zlib 1.2.13; its copyright and license
are included as build-zlib-copyright.txt. This native library remains a private
build tool and is not part of the browser assets.

OpenJDK 8 StringJoiner.java, Copyright Oracle and/or its affiliates, is included
with only a namespace/class rename to fill an absent TeaVM class library class.
Its GPL version 2 with Classpath exception header is preserved in the included
OpenJDK8-StringJoiner.java, with exact source URL and hash in inputs.lock.json.

The complete source platform diff is browser-platform.patch. Additional AOT
platform transformations and bridge source are in this repository under
producers/javacs-teavm/. They retain the original Java compiler parser,
resolver, type checker and language server feature handlers. This build profile
excludes native compiler plugins, annotation processors, external class paths
and source-archive access. Runtime annotation proxy requests fail explicitly.

Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0
Full license texts for bundled software are included in this directory.
