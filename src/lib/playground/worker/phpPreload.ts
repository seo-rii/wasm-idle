// The pinned PHP runtime loads /internal/shared/preload/*.php before the entry
// script, preserving the original source bytes, namespace and line numbers.
export const PHP_PRELOAD_PATH = '/internal/shared/preload/wasm-idle.php';
export const PHP_PRELOAD = String.raw`<?php
$argv = json_decode($_SERVER['WASM_IDLE_ARGV'], true, flags: JSON_THROW_ON_ERROR);
unset($_SERVER['WASM_IDLE_ARGV']);
$argc = count($argv);
$_SERVER['argv'] = $argv;
$_SERVER['argc'] = $argc;
`;
