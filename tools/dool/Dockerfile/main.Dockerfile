FROM asia.gcr.io/hancomac/dool-base:dev
EXPOSE 80

RUN addgroup execute
WORKDIR /DOOL
COPY package.json pnpm-lock.yaml .versionrc tsconfig.json /DOOL/
RUN pnpm install
COPY res/ /DOOL/res/
COPY build/ /DOOL/build/
CMD npm run run
