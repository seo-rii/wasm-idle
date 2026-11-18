;; WASIX 0.601.0 Tty: cols/rows are the first two u32 fields. Preserve all other
;; fields through tty_get/tty_set, then report the accepted dimensions on stdout.
(module
  (import "wasix_32v1" "tty_get" (func $get (param i32) (result i32)))
  (import "wasix_32v1" "tty_set" (func $set (param i32) (result i32)))
  (import "wasi_snapshot_preview1" "fd_write" (func $write (param i32 i32 i32 i32) (result i32)))
  (memory (export "memory") 1)
  (func (export "_start")
    (if (call $get (i32.const 64)) (then unreachable))
    (i32.store (i32.const 64) (i32.load (i32.const 32)))
    (i32.store (i32.const 68) (i32.load (i32.const 36)))
    (if (call $set (i32.const 64)) (then unreachable))
    (if (call $get (i32.const 64)) (then unreachable))
    (i32.store (i32.const 0) (i32.const 64))
    (i32.store (i32.const 4) (i32.const 8))
    (if (call $write (i32.const 1) (i32.const 0) (i32.const 1) (i32.const 8)) (then unreachable)))
  ;; This final data segment is replaced with two bounded little-endian u32s.
  (data (i32.const 32) "\00\00\00\00\00\00\00\00"))
