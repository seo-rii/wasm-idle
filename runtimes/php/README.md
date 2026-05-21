# PHP Runtime Package

`@wasm-idle/runtime-php` wraps the browser `@php-wasm/web` distribution used by the WordPress
Playground PHP WebAssembly toolchain.

- browser package: `@php-wasm/web`
- supported version packages: PHP 8.5, 8.4, 8.3, 8.2, 8.1, 8.0, 7.4, and 5.2

The package exposes host/version package resolution, runtime manifests, asset URL helpers, and a
dynamic import helper for the browser PHP runtime.

```bash
pnpm --dir runtimes/php run build
pnpm --dir runtimes/php run check
```
