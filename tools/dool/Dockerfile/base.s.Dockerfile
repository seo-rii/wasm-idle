FROM ubuntu:25.04

ARG DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8 LANGUAGE=C.UTF-8 LC_ALL=C.UTF-8 TZ=Asia/Seoul

RUN apt-get update && apt-get install curl software-properties-common time unzip ca-certificates gnupg tzdata wget git -y
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

# Preload Typescript
WORKDIR /include/TYPESCRIPT
RUN pnpm install

# Cleanup
RUN apt-get remove -y --purge curl unzip git wget software-properties-common \
    && apt-get autoremove -y \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /root/.cache/pnpm /root/.cache/npm /root/.cache/pip
