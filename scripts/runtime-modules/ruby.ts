import rubyStdlibWasmUrl from '@ruby/3.4-wasm-wasi/dist/ruby+stdlib.wasm?url';
import * as wasiShim from '@bjorn3/browser_wasi_shim';
import { RubyVM, consolePrinter } from '@ruby/wasm-wasi';

export { RubyVM, consolePrinter, rubyStdlibWasmUrl, wasiShim };
