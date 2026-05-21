FROM ubuntu:25.04

ARG DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8 LANGUAGE=C.UTF-8 LC_ALL=C.UTF-8 TZ=Asia/Seoul

RUN apt-get update && apt-get install curl software-properties-common time unzip ca-certificates gnupg tzdata wget build-essential git -y
RUN adduser --gecos "" --disabled-password --no-create-home test
COPY include/ /include/
RUN chmod -R 755 /include/
RUN mkdir -p /opt/python \
    && cp -R /include/PYTHON/jungol_robot /opt/python/jungol_robot \
    && cp /include/PYTHON/robot.py /opt/python/robot.py \
    && cp /include/PYTHON/robot_judge.py /opt/python/robot_judge.py \
    && chmod -R 555 /opt/python/jungol_robot \
    && chmod 555 /opt/python/robot.py \
    && chmod 555 /opt/python/robot_judge.py \
    && chmod -R 555 /include/PYTHON/jungol_robot \
    && chmod 555 /include/PYTHON/robot.py \
    && chmod 555 /include/PYTHON/robot_judge.py
ENV PYTHONPATH=/opt/python:${PYTHONPATH}
COPY run.sh /run.sh
RUN chmod 755 /run.sh
RUN mkdir /test
RUN /run.sh echo 1

# Install node.js
RUN apt-get update \
    && apt-get install -y nodejs npm \
    && npm install -g pnpm@9.15.9 typescript@4.6.3 \
    && node --version \
    && npm --version \
    && pnpm --version

COPY test/js/ /test/
RUN /run.sh "node ./test.js"

COPY test/ts/ /test/
RUN /run.sh "tsc ./test.ts && node ./test.js"

# Install C/C++
RUN apt-get update \
    && apt-get install gcc-15 g++-15 -y \
    && gcc-15 --version \
    && g++-15 --version \
    && ln -sf /usr/bin/gcc-15 /usr/bin/gcc \
    && ln -sf /usr/bin/g++-15 /usr/bin/g++

COPY test/cpp/ /test/
RUN /run.sh "g++ -std=c++23 ./test.cpp -o ./test &&  ./test"

# Install Python3 & Pypy3
RUN apt-get install pypy3 python3.13 python3-pip python3-six -y \
    && python3.13 --version \
    && pypy3 --version \
    && python3.13 -m pip --version \
    && python3.13 -m pip install --break-system-packages --upgrade setuptools \
    && python3.13 -m pip install --break-system-packages --upgrade --ignore-installed --no-cache-dir \
        --target /usr/local/lib/python3.13/dist-packages \
        -r /include/PYTHON/requirements.txt

COPY test/python/ /test/
RUN /run.sh "python3.13 -m compileall -b . && python3.13 ./test.py"

COPY test/pypy/ /test/
RUN /run.sh "pypy3 -m compileall -b . && pypy3 ./test.py"

# Install Java
RUN apt-get install openjdk-21-jdk -y \
    && chmod -R 755 /usr/lib/jvm \
    && javac -version \
    && java -version

COPY test/java/ /test/
RUN /run.sh "javac --release 11 -J-Xms1024m -J-Xmx1920m -J-Xss512m -encoding UTF-8 ./test.java && java -XX:ReservedCodeCacheSize=64m -XX:-UseCompressedClassPointers -Xmx32m -Xss16m -Dfile.encoding=UTF-8 -XX:+UseSerialGC -DONLINE_JUDGE=1 test"

# Install Rust
ENV RUSTUP_HOME=/cargo CARGO_HOME=/cargo PATH=/cargo/bin:$PATH
RUN mkdir /cargo \
    && chmod -R 755 /cargo \
    && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
    && /cargo/bin/rustup toolchain install stable \
    && /cargo/bin/rustup default stable \
    && ln -s /cargo/bin/rustc /usr/bin/rustc \
    && ln -s /cargo/bin/rustup /usr/bin/rustup \
    && rustc --version \
    && chmod -R 755 /cargo/bin/ /cargo/env \
    && chmod 755 /cargo /usr/bin/rustc /usr/bin/rustup \
    && chmod 777 /cargo/settings.toml

COPY test/rust/ /test/
RUN /run.sh "rustup default stable && /usr/bin/rustc --edition 2018 -O -o test test.rs && ./test"

# Install Go
RUN apt-get install -y golang golang-src \
    && go version \
    && GOROOT_REAL="$(go env GOROOT)" \
    && GOROOT_SRC_REAL="$(readlink -f "$GOROOT_REAL/src")" \
    && ln -sfn "$GOROOT_REAL" /usr/lib/go \
    && chmod -R a+rX "$GOROOT_REAL" \
    && chmod -R a+rX "$GOROOT_SRC_REAL" \
    && mkdir -p /tmp/gocache \
    && chmod -R 777 /tmp/gocache \
    && go env -w GO111MODULE=auto
ENV GOCACHE=/tmp/gocache PATH=/go/bin:$PATH

COPY test/go/ /test/
RUN /run.sh "env -u GOROOT GOENV=off go build test.go && ./test" \
    && rm -rf /tmp/gocache/*

# Install OCaml
RUN apt-get install -y ocaml-nox \
    && ocamlopt -version \
    && ocamlc -version

COPY test/ocaml/ /test/
RUN /run.sh "ocamlopt -o test test.ml && printf '20\n22\n' | ./test"

# Install Haskell
RUN apt-get install -y ghc \
    && ghc --version

COPY test/haskell/ /test/
RUN /run.sh "ghc -O2 test.hs -o test && printf '20\n22\n' | ./test"

# Install Kotlin
ENV KONAN_USER_HOME=/tmp/.konan.home KONAN_DATA_DIR=/tmp/.konan

RUN wget https://github.com/JetBrains/kotlin/releases/download/v1.8.10/kotlin-native-linux-x86_64-1.8.10.tar.gz -O /tmp/kotlin.tar.gz \
    && wget https://github.com/JetBrains/kotlin/releases/download/v1.8.10/kotlin-compiler-1.8.10.zip -O /tmp/kotlin-compiler.zip \
    && mkdir /kotlin \
    && tar -xvzf /tmp/kotlin.tar.gz --directory /kotlin \
    && unzip /tmp/kotlin-compiler.zip -d /kotlin \
    && ln -s /kotlin/kotlin-native-linux-x86_64-1.8.10/bin/kotlinc-native /usr/bin/kotlinc-native \
    && ln -s /kotlin/kotlinc/bin/kotlinc /usr/bin/kotlinc \
    && ln -s /kotlin/kotlin-native-linux-x86_64-1.8.10/bin/run_konan /usr/bin/run_konan \
    && rm /tmp/kotlin.tar.gz \
    && rm /tmp/kotlin-compiler.zip \
    && kotlinc-native -version \
    && kotlinc -version \
    && chmod -R 755 /kotlin \
    && mkdir /tmp/.konan \
    && mkdir /tmp/.konan.home

COPY test/kotlin/ /test/
WORKDIR /test
RUN /usr/bin/kotlinc-native test.kt -o test && chmod -R 777 /tmp/.konan.home /tmp/.konan

RUN /run.sh "/usr/bin/kotlinc-native test.kt -o test && /usr/bin/kotlinc test.kt -include-runtime -d test.jar && java -XX:ReservedCodeCacheSize=64m -XX:-UseCompressedClassPointers -Xmx32m -Xss16m -Dfile.encoding=UTF-8 -XX:+UseSerialGC -DONLINE_JUDGE=1 -jar test.jar"

# Install Ruby
RUN apt-get install ruby-full -y \
    && ruby --version

# Install Elixir
RUN apt-get install elixir -y \
    && elixir --version

COPY test/elixir/ /test/
RUN /run.sh "elixir -e 'Code.string_to_quoted!(File.read!(hd(System.argv())), file: hd(System.argv()))' test.exs && printf '3\n1\n2\n3\n' | elixir ./test.exs"

# Install PHP
RUN apt-get install php -y \
    && php --version

# Install .NET
ENV DOTNET_ROOT=/opt/dotnet PATH=/opt/dotnet:${PATH}
RUN apt-get update \
    && apt-get install -y libicu76 \
    && mkdir -p /opt/dotnet \
    && chmod 755 /opt/dotnet \
    && curl --proto '=https' --tlsv1.2 -sSf -L https://dot.net/v1/dotnet-install.sh | bash -s -- -c Current --install-dir /opt/dotnet \
    && ln -sf /opt/dotnet/dotnet /usr/bin/dotnet \
    && chmod -R a+rX /opt/dotnet \
    && dotnet --version

COPY test/csharp/ /test/
RUN /run.sh "mkdir -p /tmp/csharp-home /tmp/csharp-packages && env HOME=/tmp/csharp-home DOTNET_CLI_HOME=/tmp/csharp-home NUGET_PACKAGES=/tmp/csharp-packages DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1 DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE=1 DOTNET_GENERATE_ASPNET_CERTIFICATE=false DOTNET_NOLOGO=1 MSBuildEnableWorkloadResolver=false dotnet new console --force --no-restore --verbosity quiet -n App -o app && rm -f app/Program.cs && cp test.cs app/test.cs && cp helper.cs app/helper.cs && env HOME=/tmp/csharp-home DOTNET_CLI_HOME=/tmp/csharp-home NUGET_PACKAGES=/tmp/csharp-packages DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1 DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE=1 DOTNET_GENERATE_ASPNET_CERTIFICATE=false DOTNET_NOLOGO=1 MSBuildEnableWorkloadResolver=false dotnet restore app --runtime linux-x64 --verbosity quiet && env HOME=/tmp/csharp-home DOTNET_CLI_HOME=/tmp/csharp-home NUGET_PACKAGES=/tmp/csharp-packages DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1 DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE=1 DOTNET_GENERATE_ASPNET_CERTIFICATE=false DOTNET_NOLOGO=1 MSBuildEnableWorkloadResolver=false dotnet publish app --no-restore --configuration Release --self-contained true --runtime linux-x64 --verbosity quiet -o publish && printf '20 22\n' | env DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1 ./publish/App"

# Install Lua
RUN apt-get install lua5.4 \
    && chmod 755 /usr/bin/lua5.4 /usr/bin/luac5.4 /usr/lib/x86_64-linux-gnu/libc.so.6 \
    && luac5.4 -v \
    && lua5.4 -v

# Install Perl
RUN apt-get install perl \
    && perl -v

# Preload Typescript
WORKDIR /include/TYPESCRIPT
RUN pnpm install

# Cleanup
RUN apt-get remove -y --purge curl unzip git wget software-properties-common \
    && apt-get autoremove -y \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /root/.cache/pnpm /root/.cache/npm /root/.cache/pip
