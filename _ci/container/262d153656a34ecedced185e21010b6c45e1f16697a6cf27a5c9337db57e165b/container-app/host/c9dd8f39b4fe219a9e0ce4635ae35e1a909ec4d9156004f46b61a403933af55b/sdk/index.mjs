// pinned-sdk:bindgen/wasmer_js.js
var wasm;
var cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
  if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.buffer !== wasm.memory.buffer) {
    cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
  }
  return cachedUint8ArrayMemory0;
}
var cachedTextDecoder = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8", { ignoreBOM: true, fatal: true }) : { decode: () => {
  throw Error("TextDecoder not available");
} };
if (typeof TextDecoder !== "undefined") {
  cachedTextDecoder.decode();
}
var MAX_SAFARI_DECODE_BYTES = 2146435072;
var numBytesDecoded = 0;
function decodeText(ptr, len) {
  numBytesDecoded += len;
  if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
    cachedTextDecoder = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8", { ignoreBOM: true, fatal: true }) : { decode: () => {
      throw Error("TextDecoder not available");
    } };
    cachedTextDecoder.decode();
    numBytesDecoded = len;
  }
  return cachedTextDecoder.decode(getUint8ArrayMemory0().slice(ptr, ptr + len));
}
function getStringFromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  return decodeText(ptr, len);
}
var WASM_VECTOR_LEN = 0;
var cachedTextEncoder = typeof TextEncoder !== "undefined" ? new TextEncoder("utf-8") : { encode: () => {
  throw Error("TextEncoder not available");
} };
var encodeString = function(arg, view) {
  const buf = cachedTextEncoder.encode(arg);
  view.set(buf);
  return {
    read: arg.length,
    written: buf.length
  };
};
function passStringToWasm0(arg, malloc, realloc) {
  if (realloc === void 0) {
    const buf = cachedTextEncoder.encode(arg);
    const ptr2 = malloc(buf.length, 1) >>> 0;
    getUint8ArrayMemory0().subarray(ptr2, ptr2 + buf.length).set(buf);
    WASM_VECTOR_LEN = buf.length;
    return ptr2;
  }
  let len = arg.length;
  let ptr = malloc(len, 1) >>> 0;
  const mem = getUint8ArrayMemory0();
  let offset = 0;
  for (; offset < len; offset++) {
    const code = arg.charCodeAt(offset);
    if (code > 127) break;
    mem[ptr + offset] = code;
  }
  if (offset !== len) {
    if (offset !== 0) {
      arg = arg.slice(offset);
    }
    ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
    const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
    const ret = encodeString(arg, view);
    offset += ret.written;
    ptr = realloc(ptr, len, offset, 1) >>> 0;
  }
  WASM_VECTOR_LEN = offset;
  return ptr;
}
var cachedDataViewMemory0 = null;
function getDataViewMemory0() {
  if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer !== wasm.memory.buffer) {
    cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
  }
  return cachedDataViewMemory0;
}
function isLikeNone(x) {
  return x === void 0 || x === null;
}
function addToExternrefTable0(obj) {
  const idx = wasm.__externref_table_alloc();
  wasm.__wbindgen_export_5.set(idx, obj);
  return idx;
}
function handleError(f, args) {
  try {
    return f.apply(this, args);
  } catch (e) {
    const idx = addToExternrefTable0(e);
    wasm.__wbindgen_exn_store(idx);
  }
}
function getArrayU8FromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}
var CLOSURE_DTORS = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((state) => {
  wasm.__wbindgen_export_6.get(state.dtor)(state.a, state.b);
});
function makeMutClosure(arg0, arg1, dtor, f) {
  const state = { a: arg0, b: arg1, cnt: 1, dtor };
  const real = (...args) => {
    state.cnt++;
    const a = state.a;
    state.a = 0;
    try {
      return f(a, state.b, ...args);
    } finally {
      if (--state.cnt === 0) {
        wasm.__wbindgen_export_6.get(state.dtor)(a, state.b);
        CLOSURE_DTORS.unregister(state);
      } else {
        state.a = a;
      }
    }
  };
  real.original = state;
  CLOSURE_DTORS.register(real, state, state);
  return real;
}
function makeClosure(arg0, arg1, dtor, f) {
  const state = { a: arg0, b: arg1, cnt: 1, dtor };
  const real = (...args) => {
    state.cnt++;
    try {
      return f(state.a, state.b, ...args);
    } finally {
      if (--state.cnt === 0) {
        wasm.__wbindgen_export_6.get(state.dtor)(state.a, state.b);
        state.a = 0;
        CLOSURE_DTORS.unregister(state);
      }
    }
  };
  real.original = state;
  CLOSURE_DTORS.register(real, state, state);
  return real;
}
function debugString(val) {
  const type = typeof val;
  if (type == "number" || type == "boolean" || val == null) {
    return `${val}`;
  }
  if (type == "string") {
    return `"${val}"`;
  }
  if (type == "symbol") {
    const description = val.description;
    if (description == null) {
      return "Symbol";
    } else {
      return `Symbol(${description})`;
    }
  }
  if (type == "function") {
    const name = val.name;
    if (typeof name == "string" && name.length > 0) {
      return `Function(${name})`;
    } else {
      return "Function";
    }
  }
  if (Array.isArray(val)) {
    const length = val.length;
    let debug = "[";
    if (length > 0) {
      debug += debugString(val[0]);
    }
    for (let i = 1; i < length; i++) {
      debug += ", " + debugString(val[i]);
    }
    debug += "]";
    return debug;
  }
  const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
  let className;
  if (builtInMatches && builtInMatches.length > 1) {
    className = builtInMatches[1];
  } else {
    return toString.call(val);
  }
  if (className == "Object") {
    try {
      return "Object(" + JSON.stringify(val) + ")";
    } catch (_) {
      return "Object";
    }
  }
  if (val instanceof Error) {
    return `${val.name}: ${val.message}
${val.stack}`;
  }
  return className;
}
function takeFromExternrefTable0(idx) {
  const value = wasm.__wbindgen_export_5.get(idx);
  wasm.__externref_table_dealloc(idx);
  return value;
}
function initializeLogger(filter) {
  var ptr0 = isLikeNone(filter) ? 0 : passStringToWasm0(filter, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
  var len0 = WASM_VECTOR_LEN;
  const ret = wasm.initializeLogger(ptr0, len0);
  if (ret[1]) {
    throw takeFromExternrefTable0(ret[0]);
  }
}
function passArray8ToWasm0(arg, malloc) {
  const ptr = malloc(arg.length * 1, 1) >>> 0;
  getUint8ArrayMemory0().set(arg, ptr / 1);
  WASM_VECTOR_LEN = arg.length;
  return ptr;
}
function _assertClass(instance, klass) {
  if (!(instance instanceof klass)) {
    throw new Error(`expected instance of ${klass.name}`);
  }
}
function runWasix(wasm_module, config) {
  const ret = wasm.runWasix(wasm_module, config);
  return ret;
}
function wat2wasm(wat) {
  const ptr0 = passStringToWasm0(wat, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
  const len0 = WASM_VECTOR_LEN;
  const ret = wasm.wat2wasm(ptr0, len0);
  if (ret[2]) {
    throw takeFromExternrefTable0(ret[1]);
  }
  return takeFromExternrefTable0(ret[0]);
}
function on_start() {
  wasm.on_start();
}
function setSDKUrl(url) {
  wasm.setSDKUrl(url);
}
function setWorkerUrl(url) {
  wasm.setWorkerUrl(url);
}
function __wbg_adapter_72(arg0, arg1, arg2) {
  wasm.closure530_externref_shim(arg0, arg1, arg2);
}
function __wbg_adapter_77(arg0, arg1) {
  const ret = wasm.closure764_externref_shim(arg0, arg1);
  return ret;
}
function __wbg_adapter_82(arg0, arg1, arg2) {
  const ret = wasm.closure775_externref_shim(arg0, arg1, arg2);
  return ret;
}
function __wbg_adapter_87(arg0, arg1, arg2) {
  const ret = wasm.closure1268_externref_shim_multivalue_shim(arg0, arg1, arg2);
  if (ret[1]) {
    throw takeFromExternrefTable0(ret[0]);
  }
}
function __wbg_adapter_90(arg0, arg1, arg2) {
  const ret = wasm.closure1270_externref_shim_multivalue_shim(arg0, arg1, arg2);
  if (ret[2]) {
    throw takeFromExternrefTable0(ret[1]);
  }
  return takeFromExternrefTable0(ret[0]);
}
function __wbg_adapter_222(arg0, arg1, arg2, arg3) {
  wasm.closure179_externref_shim(arg0, arg1, arg2, arg3);
}
var __wbindgen_enum_BinaryType = ["blob", "arraybuffer"];
var __wbindgen_enum_RequestCredentials = ["omit", "same-origin", "include"];
var __wbindgen_enum_RequestMode = ["same-origin", "no-cors", "cors", "navigate"];
var __wbindgen_enum_WorkerType = ["classic", "module"];
var AtomFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_atom_free(ptr >>> 0, 1));
var Atom = class {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    AtomFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_atom_free(ptr, 0);
  }
};
var CommandFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_command_free(ptr >>> 0, 1));
var Command = class _Command {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_Command.prototype);
    obj.__wbg_ptr = ptr;
    CommandFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    CommandFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_command_free(ptr, 0);
  }
  /**
   * @returns {string}
   */
  get name() {
    const ret = wasm.__wbg_get_command_name(this.__wbg_ptr);
    return ret;
  }
  /**
   * @param {string} arg0
   */
  set name(arg0) {
    wasm.__wbg_set_command_name(this.__wbg_ptr, arg0);
  }
  /**
   * @param {SpawnOptions | null} [options]
   * @returns {Promise<Instance>}
   */
  run(options) {
    const ret = wasm.command_run(this.__wbg_ptr, isLikeNone(options) ? 0 : addToExternrefTable0(options));
    return ret;
  }
  /**
   * Read the binary that will be
   * @returns {Uint8Array}
   */
  binary() {
    const ret = wasm.command_binary(this.__wbg_ptr);
    return ret;
  }
};
var DeployedAppFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_deployedapp_free(ptr >>> 0, 1));
var DeployedApp = class _DeployedApp {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_DeployedApp.prototype);
    obj.__wbg_ptr = ptr;
    DeployedAppFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    DeployedAppFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_deployedapp_free(ptr, 0);
  }
  /**
   * @returns {string}
   */
  get id() {
    let deferred1_0;
    let deferred1_1;
    try {
      const ret = wasm.__wbg_get_deployedapp_id(this.__wbg_ptr);
      deferred1_0 = ret[0];
      deferred1_1 = ret[1];
      return getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.canonical_abi_free(deferred1_0, deferred1_1, 1);
    }
  }
  /**
   * @param {string} arg0
   */
  set id(arg0) {
    const ptr0 = passStringToWasm0(arg0, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.__wbg_set_deployedapp_id(this.__wbg_ptr, ptr0, len0);
  }
  /**
   * @returns {string}
   */
  get created_at() {
    let deferred1_0;
    let deferred1_1;
    try {
      const ret = wasm.__wbg_get_deployedapp_created_at(this.__wbg_ptr);
      deferred1_0 = ret[0];
      deferred1_1 = ret[1];
      return getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.canonical_abi_free(deferred1_0, deferred1_1, 1);
    }
  }
  /**
   * @param {string} arg0
   */
  set created_at(arg0) {
    const ptr0 = passStringToWasm0(arg0, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.__wbg_set_deployedapp_created_at(this.__wbg_ptr, ptr0, len0);
  }
  /**
   * @returns {string}
   */
  get version() {
    let deferred1_0;
    let deferred1_1;
    try {
      const ret = wasm.__wbg_get_deployedapp_version(this.__wbg_ptr);
      deferred1_0 = ret[0];
      deferred1_1 = ret[1];
      return getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.canonical_abi_free(deferred1_0, deferred1_1, 1);
    }
  }
  /**
   * @param {string} arg0
   */
  set version(arg0) {
    const ptr0 = passStringToWasm0(arg0, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.__wbg_set_deployedapp_version(this.__wbg_ptr, ptr0, len0);
  }
  /**
   * @returns {string | undefined}
   */
  get description() {
    const ret = wasm.__wbg_get_deployedapp_description(this.__wbg_ptr);
    let v1;
    if (ret[0] !== 0) {
      v1 = getStringFromWasm0(ret[0], ret[1]).slice();
      wasm.canonical_abi_free(ret[0], ret[1] * 1, 1);
    }
    return v1;
  }
  /**
   * @param {string | null} [arg0]
   */
  set description(arg0) {
    var ptr0 = isLikeNone(arg0) ? 0 : passStringToWasm0(arg0, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    wasm.__wbg_set_deployedapp_description(this.__wbg_ptr, ptr0, len0);
  }
  /**
   * @returns {string}
   */
  get yaml_config() {
    let deferred1_0;
    let deferred1_1;
    try {
      const ret = wasm.__wbg_get_deployedapp_yaml_config(this.__wbg_ptr);
      deferred1_0 = ret[0];
      deferred1_1 = ret[1];
      return getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.canonical_abi_free(deferred1_0, deferred1_1, 1);
    }
  }
  /**
   * @param {string} arg0
   */
  set yaml_config(arg0) {
    const ptr0 = passStringToWasm0(arg0, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.__wbg_set_deployedapp_yaml_config(this.__wbg_ptr, ptr0, len0);
  }
  /**
   * @returns {string}
   */
  get user_yaml_config() {
    let deferred1_0;
    let deferred1_1;
    try {
      const ret = wasm.__wbg_get_deployedapp_user_yaml_config(this.__wbg_ptr);
      deferred1_0 = ret[0];
      deferred1_1 = ret[1];
      return getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.canonical_abi_free(deferred1_0, deferred1_1, 1);
    }
  }
  /**
   * @param {string} arg0
   */
  set user_yaml_config(arg0) {
    const ptr0 = passStringToWasm0(arg0, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.__wbg_set_deployedapp_user_yaml_config(this.__wbg_ptr, ptr0, len0);
  }
  /**
   * @returns {string}
   */
  get config() {
    let deferred1_0;
    let deferred1_1;
    try {
      const ret = wasm.__wbg_get_deployedapp_config(this.__wbg_ptr);
      deferred1_0 = ret[0];
      deferred1_1 = ret[1];
      return getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.canonical_abi_free(deferred1_0, deferred1_1, 1);
    }
  }
  /**
   * @param {string} arg0
   */
  set config(arg0) {
    const ptr0 = passStringToWasm0(arg0, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.__wbg_set_deployedapp_config(this.__wbg_ptr, ptr0, len0);
  }
  /**
   * @returns {string}
   */
  get json_config() {
    let deferred1_0;
    let deferred1_1;
    try {
      const ret = wasm.__wbg_get_deployedapp_json_config(this.__wbg_ptr);
      deferred1_0 = ret[0];
      deferred1_1 = ret[1];
      return getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.canonical_abi_free(deferred1_0, deferred1_1, 1);
    }
  }
  /**
   * @param {string} arg0
   */
  set json_config(arg0) {
    const ptr0 = passStringToWasm0(arg0, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.__wbg_set_deployedapp_json_config(this.__wbg_ptr, ptr0, len0);
  }
  /**
   * @returns {string}
   */
  get url() {
    let deferred1_0;
    let deferred1_1;
    try {
      const ret = wasm.__wbg_get_deployedapp_url(this.__wbg_ptr);
      deferred1_0 = ret[0];
      deferred1_1 = ret[1];
      return getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.canonical_abi_free(deferred1_0, deferred1_1, 1);
    }
  }
  /**
   * @param {string} arg0
   */
  set url(arg0) {
    const ptr0 = passStringToWasm0(arg0, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.__wbg_set_deployedapp_url(this.__wbg_ptr, ptr0, len0);
  }
  /**
   * @returns {string | undefined}
   */
  get app_id() {
    const ret = wasm.__wbg_get_deployedapp_app_id(this.__wbg_ptr);
    let v1;
    if (ret[0] !== 0) {
      v1 = getStringFromWasm0(ret[0], ret[1]).slice();
      wasm.canonical_abi_free(ret[0], ret[1] * 1, 1);
    }
    return v1;
  }
  /**
   * @param {string | null} [arg0]
   */
  set app_id(arg0) {
    var ptr0 = isLikeNone(arg0) ? 0 : passStringToWasm0(arg0, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    wasm.__wbg_set_deployedapp_app_id(this.__wbg_ptr, ptr0, len0);
  }
};
var DirectoryFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_directory_free(ptr >>> 0, 1));
var Directory = class _Directory {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_Directory.prototype);
    obj.__wbg_ptr = ptr;
    DirectoryFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    DirectoryFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_directory_free(ptr, 0);
  }
  /**
   * @returns {string}
   */
  __getClassname() {
    let deferred1_0;
    let deferred1_1;
    try {
      const ret = wasm.directory___getClassname(this.__wbg_ptr);
      deferred1_0 = ret[0];
      deferred1_1 = ret[1];
      return getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.canonical_abi_free(deferred1_0, deferred1_1, 1);
    }
  }
  /**
   * Create a new {@link Directory}.
   * @param {DirectoryInit | null} [init]
   */
  constructor(init3) {
    const ret = wasm.directory_new(isLikeNone(init3) ? 0 : addToExternrefTable0(init3));
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1]);
    }
    this.__wbg_ptr = ret[0] >>> 0;
    DirectoryFinalization.register(this, this.__wbg_ptr, this);
    return this;
  }
  /**
   * Read the contents of a directory.
   * @param {string} path
   * @returns {Promise<DirEntry[]>}
   */
  readDir(path) {
    const ptr0 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.directory_readDir(this.__wbg_ptr, ptr0, len0);
    return ret;
  }
  /**
   * Write to a file.
   *
   * If a string is provided, it is encoded as UTF-8.
   * @param {string} path
   * @param {string | Uint8Array} contents
   * @returns {Promise<void>}
   */
  writeFile(path, contents) {
    const ptr0 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.directory_writeFile(this.__wbg_ptr, ptr0, len0, contents);
    return ret;
  }
  /**
   * Read the contents of a file from this directory.
   *
   * Note that the path is relative to the directory's root.
   * @param {string} path
   * @returns {Promise<Uint8Array>}
   */
  readFile(path) {
    const ptr0 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.directory_readFile(this.__wbg_ptr, ptr0, len0);
    return ret;
  }
  /**
   * Read the contents of a file from this directory as a UTF-8 string.
   *
   * Note that the path is relative to the directory's root.
   * @param {string} path
   * @returns {Promise<string>}
   */
  readTextFile(path) {
    const ptr0 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.directory_readTextFile(this.__wbg_ptr, ptr0, len0);
    return ret;
  }
  /**
   * Create a directory.
   * @param {string} path
   * @returns {Promise<void>}
   */
  createDir(path) {
    const ptr0 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.directory_createDir(this.__wbg_ptr, ptr0, len0);
    return ret;
  }
  /**
   * Remove a directory.
   * @param {string} path
   * @returns {Promise<void>}
   */
  removeDir(path) {
    const ptr0 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.directory_removeDir(this.__wbg_ptr, ptr0, len0);
    return ret;
  }
  /**
   * Remove a file.
   * @param {string} path
   * @returns {Promise<void>}
   */
  removeFile(path) {
    const ptr0 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.directory_removeFile(this.__wbg_ptr, ptr0, len0);
    return ret;
  }
  /**
   * Mount a trusted synchronous filesystem owned by this thread. Commands
   * using it must be started from this same thread. WASIX revalidates its
   * cached entries under such a mount on every lookup. The delegate is released
   * after the last directory, open file and queued operation has been dropped.
   * @param {HostFileSystemDelegate} delegate
   * @returns {Directory}
   */
  static fromHostFileSystem(delegate) {
    const ret = wasm.directory_fromHostFileSystem(delegate);
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1]);
    }
    return _Directory.__wrap(ret[0]);
  }
};
var HostCommandDescriptorFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_hostcommanddescriptor_free(ptr >>> 0, 1));
var HostCommandDescriptor = class _HostCommandDescriptor {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_HostCommandDescriptor.prototype);
    obj.__wbg_ptr = ptr;
    HostCommandDescriptorFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    HostCommandDescriptorFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_hostcommanddescriptor_free(ptr, 0);
  }
  /**
   * @returns {number}
   */
  get fd() {
    const ret = wasm.hostcommanddescriptor_fd(this.__wbg_ptr);
    return ret >>> 0;
  }
  /**
   * Resolve with 1 to `maxBytes` bytes (at most 65,536), or with an empty
   * array at end of file. `maxBytes` must be positive. Bytes beyond the
   * request are never consumed from the child's descriptor.
   * @param {number} max_bytes
   * @returns {Promise<any>}
   */
  read(max_bytes) {
    const ret = wasm.hostcommanddescriptor_read(this.__wbg_ptr, max_bytes);
    return ret;
  }
  /**
   * Copy at most 65,536 leading bytes now, write them to the child's
   * descriptor and resolve with the number accepted, which may be fewer.
   * @param {Uint8Array} bytes
   * @returns {Promise<any>}
   */
  write(bytes) {
    const ret = wasm.hostcommanddescriptor_write(this.__wbg_ptr, bytes);
    return ret;
  }
  /**
   * Close this descriptor and cancel its unfinished I/O. Accepted bytes
   * remain, but queued writes are rejected. Its outcome is not reported.
   */
  close() {
    wasm.hostcommanddescriptor_close(this.__wbg_ptr);
  }
};
var InstanceFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_instance_free(ptr >>> 0, 1));
var Instance = class _Instance {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_Instance.prototype);
    obj.__wbg_ptr = ptr;
    InstanceFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    InstanceFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_instance_free(ptr, 0);
  }
  /**
   * The standard input stream, if one wasn't provided when starting the
   * instance.
   * @returns {WritableStream | undefined}
   */
  get stdin() {
    const ret = wasm.__wbg_get_instance_stdin(this.__wbg_ptr);
    return ret;
  }
  /**
   * The WASI program's standard output.
   * @returns {ReadableStream}
   */
  get stdout() {
    const ret = wasm.__wbg_get_instance_stdout(this.__wbg_ptr);
    return ret;
  }
  /**
   * The WASI program's standard error.
   * @returns {ReadableStream}
   */
  get stderr() {
    const ret = wasm.__wbg_get_instance_stderr(this.__wbg_ptr);
    return ret;
  }
  /**
   * Wait for the process to exit.
   * @returns {Promise<Output>}
   */
  wait() {
    const ptr = this.__destroy_into_raw();
    const ret = wasm.instance_wait(ptr);
    return ret;
  }
  /**
   * Wait only for the process exit status, without closing stdin or reading
   * stdout/stderr. Like `wait`, this consumes the Instance. Retain its stream
   * properties first; the caller owns EOF, draining and stream cleanup.
   * Setup failures and runtime traps reject; guest exit codes resolve.
   * Cancellation and the Worker group's lifetime remain owner responsibilities.
   * @returns {Promise<ExitStatus>}
   */
  waitForExit() {
    const ptr = this.__destroy_into_raw();
    const ret = wasm.instance_waitForExit(ptr);
    return ret;
  }
};
var IntoUnderlyingByteSourceFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_intounderlyingbytesource_free(ptr >>> 0, 1));
var IntoUnderlyingByteSource = class {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    IntoUnderlyingByteSourceFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_intounderlyingbytesource_free(ptr, 0);
  }
  /**
   * @returns {string}
   */
  get type() {
    let deferred1_0;
    let deferred1_1;
    try {
      const ret = wasm.intounderlyingbytesource_type(this.__wbg_ptr);
      deferred1_0 = ret[0];
      deferred1_1 = ret[1];
      return getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.canonical_abi_free(deferred1_0, deferred1_1, 1);
    }
  }
  /**
   * @returns {number}
   */
  get autoAllocateChunkSize() {
    const ret = wasm.intounderlyingbytesource_autoAllocateChunkSize(this.__wbg_ptr);
    return ret >>> 0;
  }
  /**
   * @param {ReadableByteStreamController} controller
   */
  start(controller) {
    wasm.intounderlyingbytesource_start(this.__wbg_ptr, controller);
  }
  /**
   * @param {ReadableByteStreamController} controller
   * @returns {Promise<any>}
   */
  pull(controller) {
    const ret = wasm.intounderlyingbytesource_pull(this.__wbg_ptr, controller);
    return ret;
  }
  cancel() {
    const ptr = this.__destroy_into_raw();
    wasm.intounderlyingbytesource_cancel(ptr);
  }
};
var IntoUnderlyingSinkFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_intounderlyingsink_free(ptr >>> 0, 1));
var IntoUnderlyingSink = class {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    IntoUnderlyingSinkFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_intounderlyingsink_free(ptr, 0);
  }
  /**
   * @param {any} chunk
   * @returns {Promise<any>}
   */
  write(chunk) {
    const ret = wasm.intounderlyingsink_write(this.__wbg_ptr, chunk);
    return ret;
  }
  /**
   * @returns {Promise<any>}
   */
  close() {
    const ptr = this.__destroy_into_raw();
    const ret = wasm.intounderlyingsink_close(ptr);
    return ret;
  }
  /**
   * @param {any} reason
   * @returns {Promise<any>}
   */
  abort(reason) {
    const ptr = this.__destroy_into_raw();
    const ret = wasm.intounderlyingsink_abort(ptr, reason);
    return ret;
  }
};
var IntoUnderlyingSourceFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_intounderlyingsource_free(ptr >>> 0, 1));
var IntoUnderlyingSource = class {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    IntoUnderlyingSourceFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_intounderlyingsource_free(ptr, 0);
  }
  /**
   * @param {ReadableStreamDefaultController} controller
   * @returns {Promise<any>}
   */
  pull(controller) {
    const ret = wasm.intounderlyingsource_pull(this.__wbg_ptr, controller);
    return ret;
  }
  cancel() {
    const ptr = this.__destroy_into_raw();
    wasm.intounderlyingsource_cancel(ptr);
  }
};
var PublishPackageOutputFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_publishpackageoutput_free(ptr >>> 0, 1));
var PublishPackageOutput = class _PublishPackageOutput {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_PublishPackageOutput.prototype);
    obj.__wbg_ptr = ptr;
    PublishPackageOutputFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    PublishPackageOutputFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_publishpackageoutput_free(ptr, 0);
  }
  /**
   * @returns {any}
   */
  get manifest() {
    const ret = wasm.__wbg_get_publishpackageoutput_manifest(this.__wbg_ptr);
    return ret;
  }
  /**
   * @param {any} arg0
   */
  set manifest(arg0) {
    wasm.__wbg_set_publishpackageoutput_manifest(this.__wbg_ptr, arg0);
  }
  /**
   * @returns {string}
   */
  get hash() {
    let deferred1_0;
    let deferred1_1;
    try {
      const ret = wasm.__wbg_get_publishpackageoutput_hash(this.__wbg_ptr);
      deferred1_0 = ret[0];
      deferred1_1 = ret[1];
      return getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.canonical_abi_free(deferred1_0, deferred1_1, 1);
    }
  }
  /**
   * @param {string} arg0
   */
  set hash(arg0) {
    const ptr0 = passStringToWasm0(arg0, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.__wbg_set_deployedapp_id(this.__wbg_ptr, ptr0, len0);
  }
};
var ReadableStreamSourceFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_readablestreamsource_free(ptr >>> 0, 1));
var ReadableStreamSource = class _ReadableStreamSource {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_ReadableStreamSource.prototype);
    obj.__wbg_ptr = ptr;
    ReadableStreamSourceFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    ReadableStreamSourceFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_readablestreamsource_free(ptr, 0);
  }
  /**
   * This method, also defined by the developer, will be called repeatedly
   * when the stream's internal queue of chunks is not full, up until it
   * reaches its high water mark. If pull() returns a promise, then it won't
   * be called again until that promise fulfills; if the promise rejects, the
   * stream will become errored. The controller parameter passed to this
   * method is a ReadableStreamDefaultController or a
   * ReadableByteStreamController, depending on the value of the type
   * property. This can be used by the developer to control the stream as
   * more chunks are fetched. This function will not be called until start()
   * successfully completes. Additionally, it will only be called repeatedly
   * if it enqueues at least one chunk or fulfills a BYOB request; a no-op
   * pull() implementation will not be continually called.
   * @param {ReadableStreamDefaultController} controller
   * @returns {Promise<any>}
   */
  pull(controller) {
    const ret = wasm.readablestreamsource_pull(this.__wbg_ptr, controller);
    return ret;
  }
  /**
   * This method, also defined by the developer, will be called if the app
   * signals that the stream is to be cancelled (e.g. if
   * ReadableStream.cancel() is called). The contents should do whatever is
   * necessary to release access to the stream source. If this process is
   * asynchronous, it can return a promise to signal success or failure. The
   * reason parameter contains a string describing why the stream was
   * cancelled.
   */
  cancel() {
    wasm.readablestreamsource_cancel(this.__wbg_ptr);
  }
  /**
   * This property controls what type of readable stream is being dealt with.
   * If it is included with a value set to `"bytes"`, the passed controller
   * object will be a `ReadableByteStreamController`` capable of handling a
   * BYOB (bring your own buffer)/byte stream. If it is not included, the
   * passed controller will be a `ReadableStreamDefaultController`.
   * @returns {string | undefined}
   */
  get type() {
    const ret = wasm.readablestreamsource_type(this.__wbg_ptr);
    return ret;
  }
};
var RuntimeFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_runtime_free(ptr >>> 0, 1));
var Runtime = class _Runtime {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_Runtime.prototype);
    obj.__wbg_ptr = ptr;
    RuntimeFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    RuntimeFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_runtime_free(ptr, 0);
  }
  /**
   * Route a guest's exec or spawn of exactly `path` to `handler`. The
   * handler runs on this thread, which must also be the thread that starts
   * the command using this runtime. Guests must still resolve `path` in
   * their own filesystem before exec reaches this registry.
   * @param {string} path
   * @param {HostCommandHandler} handler
   */
  registerHostCommand(path, handler) {
    const ptr0 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.runtime_registerHostCommand(this.__wbg_ptr, ptr0, len0, handler);
    if (ret[1]) {
      throw takeFromExternrefTable0(ret[0]);
    }
  }
  /**
   * Remove a registration made on this thread. Commands already dispatched
   * keep running; later lookups fall back to the ordinary resolver.
   * @param {string} path
   * @returns {boolean}
   */
  unregisterHostCommand(path) {
    const ptr0 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.runtime_unregisterHostCommand(this.__wbg_ptr, ptr0, len0);
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
  }
  /**
   * Route a guest's exec or spawn of a WebAssembly module below
   * `directory` to `handler`, with the same thread rule as
   * `registerHostCommand`. Only a normalized absolute path strictly below
   * the directory whose first four bytes, read through the guest's own
   * filesystem, are the Wasm magic is routed. Other files, such as
   * scripts, and unnormalized paths use the ordinary resolver. An exact
   * registration and a longer registered directory take precedence.
   * @param {string} directory
   * @param {HostCommandHandler} handler
   */
  registerHostCommandDirectory(directory, handler) {
    const ptr0 = passStringToWasm0(directory, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.runtime_registerHostCommandDirectory(this.__wbg_ptr, ptr0, len0, handler);
    if (ret[1]) {
      throw takeFromExternrefTable0(ret[0]);
    }
  }
  /**
   * Remove a directory registration made on this thread.
   * @param {string} directory
   * @returns {boolean}
   */
  unregisterHostCommandDirectory(directory) {
    const ptr0 = passStringToWasm0(directory, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.runtime_unregisterHostCommandDirectory(this.__wbg_ptr, ptr0, len0);
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
  }
  /**
   * @returns {string}
   */
  __getClassname() {
    let deferred1_0;
    let deferred1_1;
    try {
      const ret = wasm.runtime___getClassname(this.__wbg_ptr);
      deferred1_0 = ret[0];
      deferred1_1 = ret[1];
      return getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.canonical_abi_free(deferred1_0, deferred1_1, 1);
    }
  }
  /**
   * @param {RuntimeOptions | null} [options]
   */
  constructor(options) {
    const ret = wasm.runtime_js_new(isLikeNone(options) ? 0 : addToExternrefTable0(options));
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1]);
    }
    this.__wbg_ptr = ret[0] >>> 0;
    RuntimeFinalization.register(this, this.__wbg_ptr, this);
    return this;
  }
  /**
   * Get a reference to the global runtime, optionally initializing it if
   * requested.
   * @param {boolean | null} [initialize]
   * @returns {Runtime | undefined}
   */
  static global(initialize) {
    const ret = wasm.runtime_global(isLikeNone(initialize) ? 16777215 : initialize ? 1 : 0);
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] === 0 ? void 0 : _Runtime.__wrap(ret[0]);
  }
};
var ThreadPoolWorkerFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_threadpoolworker_free(ptr >>> 0, 1));
var ThreadPoolWorker = class {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    ThreadPoolWorkerFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_threadpoolworker_free(ptr, 0);
  }
  /**
   * @param {number} id
   */
  constructor(id) {
    const ret = wasm.threadpoolworker_new(id);
    this.__wbg_ptr = ret >>> 0;
    ThreadPoolWorkerFinalization.register(this, this.__wbg_ptr, this);
    return this;
  }
  /**
   * @param {any} msg
   * @returns {Promise<void>}
   */
  handle(msg) {
    const ret = wasm.threadpoolworker_handle(this.__wbg_ptr, msg);
    return ret;
  }
};
var TrapFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_trap_free(ptr >>> 0, 1));
var Trap = class _Trap {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_Trap.prototype);
    obj.__wbg_ptr = ptr;
    TrapFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    TrapFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_trap_free(ptr, 0);
  }
  /**
   * A marker method to indicate that an object is an instance of the `Trap`
   * class.
   */
  static __wbg_wasmer_trap() {
    wasm.trap___wbg_wasmer_trap();
  }
};
var UserFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_user_free(ptr >>> 0, 1));
var User = class _User {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_User.prototype);
    obj.__wbg_ptr = ptr;
    UserFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    UserFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_user_free(ptr, 0);
  }
  /**
   * @returns {string}
   */
  get id() {
    let deferred1_0;
    let deferred1_1;
    try {
      const ret = wasm.__wbg_get_user_id(this.__wbg_ptr);
      deferred1_0 = ret[0];
      deferred1_1 = ret[1];
      return getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.canonical_abi_free(deferred1_0, deferred1_1, 1);
    }
  }
  /**
   * @param {string} arg0
   */
  set id(arg0) {
    const ptr0 = passStringToWasm0(arg0, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.__wbg_set_deployedapp_id(this.__wbg_ptr, ptr0, len0);
  }
  /**
   * @returns {string}
   */
  get username() {
    let deferred1_0;
    let deferred1_1;
    try {
      const ret = wasm.__wbg_get_user_username(this.__wbg_ptr);
      deferred1_0 = ret[0];
      deferred1_1 = ret[1];
      return getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.canonical_abi_free(deferred1_0, deferred1_1, 1);
    }
  }
  /**
   * @param {string} arg0
   */
  set username(arg0) {
    const ptr0 = passStringToWasm0(arg0, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.__wbg_set_deployedapp_created_at(this.__wbg_ptr, ptr0, len0);
  }
};
var UserPackageDefinitionFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_userpackagedefinition_free(ptr >>> 0, 1));
var UserPackageDefinition = class _UserPackageDefinition {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_UserPackageDefinition.prototype);
    obj.__wbg_ptr = ptr;
    UserPackageDefinitionFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  static __unwrap(jsValue) {
    if (!(jsValue instanceof _UserPackageDefinition)) {
      return 0;
    }
    return jsValue.__destroy_into_raw();
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    UserPackageDefinitionFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_userpackagedefinition_free(ptr, 0);
  }
  /**
   * @returns {string}
   */
  __getClassname() {
    let deferred1_0;
    let deferred1_1;
    try {
      const ret = wasm.userpackagedefinition___getClassname(this.__wbg_ptr);
      deferred1_0 = ret[0];
      deferred1_1 = ret[1];
      return getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.canonical_abi_free(deferred1_0, deferred1_1, 1);
    }
  }
  /**
   * @returns {string}
   */
  get hash() {
    let deferred1_0;
    let deferred1_1;
    try {
      const ret = wasm.__wbg_get_userpackagedefinition_hash(this.__wbg_ptr);
      deferred1_0 = ret[0];
      deferred1_1 = ret[1];
      return getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.canonical_abi_free(deferred1_0, deferred1_1, 1);
    }
  }
  /**
   * @param {string} arg0
   */
  set hash(arg0) {
    const ptr0 = passStringToWasm0(arg0, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.__wbg_set_userpackagedefinition_hash(this.__wbg_ptr, ptr0, len0);
  }
};
var VolumeFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_volume_free(ptr >>> 0, 1));
var Volume = class {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    VolumeFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_volume_free(ptr, 0);
  }
};
var WasmerFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_wasmer_free(ptr >>> 0, 1));
var Wasmer = class _Wasmer {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_Wasmer.prototype);
    obj.__wbg_ptr = ptr;
    WasmerFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    WasmerFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_wasmer_free(ptr, 0);
  }
  /**
   * Create a `WasmerPackage`.
   * @param {PackageManifest} manifest
   * @returns {Promise<Wasmer>}
   */
  static createPackage(manifest) {
    const ret = wasm.wasmer_createPackage(manifest);
    return ret;
  }
  /**
   * Publish a package to the registry.
   * @param {Wasmer} wasmerPackage
   * @returns {Promise<PublishPackageOutput>}
   */
  static publishPackage(wasmerPackage) {
    _assertClass(wasmerPackage, _Wasmer);
    const ret = wasm.wasmer_publishPackage(wasmerPackage.__wbg_ptr);
    return ret;
  }
  /**
   * @returns {string}
   */
  __getClassname() {
    let deferred1_0;
    let deferred1_1;
    try {
      const ret = wasm.wasmer___getClassname(this.__wbg_ptr);
      deferred1_0 = ret[0];
      deferred1_1 = ret[1];
      return getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.canonical_abi_free(deferred1_0, deferred1_1, 1);
    }
  }
  /**
   * The package's entrypoint.
   * @returns {Command | undefined}
   */
  get entrypoint() {
    const ret = wasm.__wbg_get_wasmer_entrypoint(this.__wbg_ptr);
    return ret === 0 ? void 0 : Command.__wrap(ret);
  }
  /**
   * The package's entrypoint.
   * @param {Command | null} [arg0]
   */
  set entrypoint(arg0) {
    let ptr0 = 0;
    if (!isLikeNone(arg0)) {
      _assertClass(arg0, Command);
      ptr0 = arg0.__destroy_into_raw();
    }
    wasm.__wbg_set_wasmer_entrypoint(this.__wbg_ptr, ptr0);
  }
  /**
   * A map containing all commands available to the package (including
   * dependencies).
   * @returns {Record<string, Command>}
   */
  get commands() {
    const ret = wasm.__wbg_get_wasmer_commands(this.__wbg_ptr);
    return ret;
  }
  /**
   * A map containing all commands available to the package (including
   * dependencies).
   * @param {Record<string, Command>} arg0
   */
  set commands(arg0) {
    wasm.__wbg_set_wasmer_commands(this.__wbg_ptr, arg0);
  }
  /**
   * @returns {UserPackageDefinition | undefined}
   */
  get pkg() {
    const ret = wasm.__wbg_get_wasmer_pkg(this.__wbg_ptr);
    return ret === 0 ? void 0 : UserPackageDefinition.__wrap(ret);
  }
  /**
   * @param {UserPackageDefinition | null} [arg0]
   */
  set pkg(arg0) {
    let ptr0 = 0;
    if (!isLikeNone(arg0)) {
      _assertClass(arg0, UserPackageDefinition);
      ptr0 = arg0.__destroy_into_raw();
    }
    wasm.__wbg_set_wasmer_pkg(this.__wbg_ptr, ptr0);
  }
  /**
   * Load a package from the Wasmer registry.
   * @param {string} specifier
   * @param {Runtime | null} [runtime]
   * @returns {Promise<Wasmer>}
   */
  static fromRegistry(specifier, runtime) {
    const ptr0 = passStringToWasm0(specifier, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.wasmer_fromRegistry(ptr0, len0, isLikeNone(runtime) ? 0 : addToExternrefTable0(runtime));
    return ret;
  }
  /**
   * Load a package from a package file.
   * @param {Uint8Array} binary
   * @param {Runtime | null} [runtime]
   * @returns {Promise<Wasmer>}
   */
  static fromFile(binary, runtime) {
    const ret = wasm.wasmer_fromFile(binary, isLikeNone(runtime) ? 0 : addToExternrefTable0(runtime));
    return ret;
  }
  /**
   * Load a package from a package file.
   * @param {Uint8Array} binary
   * @param {Runtime | null} [runtime]
   * @returns {Wasmer}
   */
  static fromWasm(binary, runtime) {
    const ret = wasm.wasmer_fromWasm(binary, isLikeNone(runtime) ? 0 : addToExternrefTable0(runtime));
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1]);
    }
    return _Wasmer.__wrap(ret[0]);
  }
  /**
   * Deploy an app to the registry.
   * @param {AppConfig} appConfig
   * @returns {Promise<DeployedApp>}
   */
  static deployApp(appConfig) {
    const ret = wasm.wasmer_deployApp(appConfig);
    return ret;
  }
  /**
   * Delete an app from the registry.
   * @param {DeployedIdApp} app
   * @returns {Promise<void>}
   */
  static deleteApp(app) {
    const ret = wasm.wasmer_deleteApp(app);
    return ret;
  }
  /**
   * Deploy an app to the registry.
   * @returns {Promise<User | undefined>}
   */
  static whoami() {
    const ret = wasm.wasmer_whoami();
    return ret;
  }
};
var WasmerPackageFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_wasmerpackage_free(ptr >>> 0, 1));
var WasmerPackage = class {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    WasmerPackageFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_wasmerpackage_free(ptr, 0);
  }
  /**
   * @returns {object}
   */
  get manifest() {
    const ret = wasm.__wbg_get_wasmerpackage_manifest(this.__wbg_ptr);
    return ret;
  }
  /**
   * @param {object} arg0
   */
  set manifest(arg0) {
    wasm.__wbg_set_wasmerpackage_manifest(this.__wbg_ptr, arg0);
  }
  /**
   * @returns {Uint8Array}
   */
  get data() {
    const ret = wasm.__wbg_get_wasmerpackage_data(this.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.canonical_abi_free(ret[0], ret[1] * 1, 1);
    return v1;
  }
  /**
   * @param {Uint8Array} arg0
   */
  set data(arg0) {
    const ptr0 = passArray8ToWasm0(arg0, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.__wbg_set_deployedapp_id(this.__wbg_ptr, ptr0, len0);
  }
};
var WritableStreamSinkFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_writablestreamsink_free(ptr >>> 0, 1));
var WritableStreamSink = class _WritableStreamSink {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_WritableStreamSink.prototype);
    obj.__wbg_ptr = ptr;
    WritableStreamSinkFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    WritableStreamSinkFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_writablestreamsink_free(ptr, 0);
  }
  /**
   * This method, also defined by the developer, will be called if the app
   * signals that it has finished writing chunks to the stream. The contents
   * should do whatever is necessary to finalize writes to the underlying
   * sink, and release access to it. If this process is asynchronous, it can
   * return a promise to signal success or failure. This method will be
   * called only after all queued-up writes have succeeded.
   * @returns {Promise<any>}
   */
  close() {
    const ret = wasm.writablestreamsink_close(this.__wbg_ptr);
    return ret;
  }
  /**
   * This method, also defined by the developer, will be called if the app
   * signals that it wishes to abruptly close the stream and put it in an
   * errored state. It can clean up any held resources, much like close(),
   * but abort() will be called even if writes are queued up — those chunks
   * will be thrown away. If this process is asynchronous, it can return a
   * promise to signal success or failure. The reason parameter contains a
   * string describing why the stream was aborted.
   * @param {string} reason
   */
  abort(reason) {
    wasm.writablestreamsink_abort(this.__wbg_ptr, reason);
  }
  /**
   * This method, also defined by the developer, will be called when a new
   * chunk of data (specified in the chunk parameter) is ready to be written
   * to the underlying sink. It can return a promise to signal success or
   * failure of the write operation. This method will be called only after
   * previous writes have succeeded, and never after the stream is closed or
   * aborted (see below).
   * @param {Uint8Array} chunk
   * @returns {Promise<any>}
   */
  write(chunk) {
    const ret = wasm.writablestreamsink_write(this.__wbg_ptr, chunk);
    return ret;
  }
};
var EXPECTED_RESPONSE_TYPES = /* @__PURE__ */ new Set(["basic", "cors", "default"]);
async function __wbg_load(module2, imports) {
  if (typeof Response === "function" && module2 instanceof Response) {
    if (typeof WebAssembly.instantiateStreaming === "function") {
      try {
        return await WebAssembly.instantiateStreaming(module2, imports);
      } catch (e) {
        const validResponse = module2.ok && EXPECTED_RESPONSE_TYPES.has(module2.type);
        if (validResponse && module2.headers.get("Content-Type") !== "application/wasm") {
          console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);
        } else {
          throw e;
        }
      }
    }
    const bytes = await module2.arrayBuffer();
    return await WebAssembly.instantiate(bytes, imports);
  } else {
    const instance = await WebAssembly.instantiate(module2, imports);
    if (instance instanceof WebAssembly.Instance) {
      return { instance, module: module2 };
    } else {
      return instance;
    }
  }
}
function __wbg_get_imports() {
  const imports = {};
  imports.wbg = {};
  imports.wbg.__wbg_BigInt_6e3a01c3311ee796 = function(arg0) {
    const ret = BigInt(arg0);
    return ret;
  };
  imports.wbg.__wbg_Error_0497d5bdba9362e5 = function(arg0, arg1) {
    const ret = Error(getStringFromWasm0(arg0, arg1));
    return ret;
  };
  imports.wbg.__wbg_String_8f0eb39a4a4c2f66 = function(arg0, arg1) {
    const ret = String(arg1);
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
  };
  imports.wbg.__wbg_abort_18ba44d46e13d7fe = function(arg0) {
    arg0.abort();
  };
  imports.wbg.__wbg_apiKey_136c64a1dd577ea4 = function(arg0, arg1) {
    const ret = arg1.apiKey;
    var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
  };
  imports.wbg.__wbg_append_0342728346e47425 = function() {
    return handleError(function(arg0, arg1, arg2, arg3, arg4) {
      arg0.append(getStringFromWasm0(arg1, arg2), getStringFromWasm0(arg3, arg4));
    }, arguments);
  };
  imports.wbg.__wbg_apply_8745fdcf855d21f5 = function() {
    return handleError(function(arg0, arg1, arg2) {
      const ret = arg0.apply(arg1, arg2);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_apply_d49e9c0472b015cc = function() {
    return handleError(function(arg0, arg1, arg2) {
      const ret = Reflect.apply(arg0, arg1, arg2);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_args_ce3906bca5fd2b6f = function(arg0) {
    const ret = arg0.args;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
  };
  imports.wbg.__wbg_arrayBuffer_d58b858456021d7f = function() {
    return handleError(function(arg0) {
      const ret = arg0.arrayBuffer();
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_assert_83d6354717cc805b = function(arg0, arg1) {
    console.assert(arg0 !== 0, arg1);
  };
  imports.wbg.__wbg_async_89f8ca583cefeb81 = function(arg0) {
    const ret = arg0.async;
    return ret;
  };
  imports.wbg.__wbg_bind_1e748fe02d440d48 = function(arg0, arg1, arg2) {
    const ret = arg0.bind(arg1, arg2);
    return ret;
  };
  imports.wbg.__wbg_bind_d075481af636a524 = function(arg0, arg1, arg2, arg3) {
    const ret = arg0.bind(arg1, arg2, arg3);
    return ret;
  };
  imports.wbg.__wbg_buffer_a1a27a0dfa70165d = function(arg0) {
    const ret = arg0.buffer;
    return ret;
  };
  imports.wbg.__wbg_buffer_e495ba54cee589cc = function(arg0) {
    const ret = arg0.buffer;
    return ret;
  };
  imports.wbg.__wbg_byobRequest_56aa768ee4dfed17 = function(arg0) {
    const ret = arg0.byobRequest;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
  };
  imports.wbg.__wbg_byteLength_937f8a52f9697148 = function(arg0) {
    const ret = arg0.byteLength;
    return ret;
  };
  imports.wbg.__wbg_byteLength_bf6d30ef92bae19b = function(arg0) {
    const ret = arg0.byteLength;
    return ret;
  };
  imports.wbg.__wbg_byteOffset_4d94b7170e641898 = function(arg0) {
    const ret = arg0.byteOffset;
    return ret;
  };
  imports.wbg.__wbg_call_f2db6205e5c51dc8 = function() {
    return handleError(function(arg0, arg1, arg2) {
      const ret = arg0.call(arg1, arg2);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_call_fbe8be8bf6436ce5 = function() {
    return handleError(function(arg0, arg1) {
      const ret = arg0.call(arg1);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_close_290fb040af98d3ac = function() {
    return handleError(function(arg0) {
      arg0.close();
    }, arguments);
  };
  imports.wbg.__wbg_close_b2641ef0870e518c = function() {
    return handleError(function(arg0) {
      arg0.close();
    }, arguments);
  };
  imports.wbg.__wbg_close_f203332f9561bf29 = function(arg0) {
    const ret = arg0.close();
    return ret;
  };
  imports.wbg.__wbg_colno_1fbc9165b6cd1b26 = function(arg0) {
    const ret = arg0.colno;
    return ret;
  };
  imports.wbg.__wbg_command_new = function(arg0) {
    const ret = Command.__wrap(arg0);
    return ret;
  };
  imports.wbg.__wbg_constructor_1a4f07ad72d5cac3 = function(arg0) {
    const ret = arg0.constructor;
    return ret;
  };
  imports.wbg.__wbg_createObjectURL_1acd82bf8749f5a9 = function() {
    return handleError(function(arg0, arg1) {
      const ret = URL.createObjectURL(arg1);
      const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
      const len1 = WASM_VECTOR_LEN;
      getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
      getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    }, arguments);
  };
  imports.wbg.__wbg_crypto_ed58b8e10a292839 = function(arg0) {
    const ret = arg0.crypto;
    return ret;
  };
  imports.wbg.__wbg_customSections_3a8a19674e217d36 = function(arg0, arg1, arg2) {
    const ret = WebAssembly.Module.customSections(arg0, getStringFromWasm0(arg1, arg2));
    return ret;
  };
  imports.wbg.__wbg_cwd_13b069cde8a90c68 = function(arg0, arg1) {
    const ret = arg1.cwd;
    var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
  };
  imports.wbg.__wbg_data_fffd43bf0ca75fff = function(arg0) {
    const ret = arg0.data;
    return ret;
  };
  imports.wbg.__wbg_defineProperty_6a428a581612fed4 = function(arg0, arg1, arg2) {
    const ret = Object.defineProperty(arg0, arg1, arg2);
    return ret;
  };
  imports.wbg.__wbg_deleteProperty_ec71c2c829351683 = function() {
    return handleError(function(arg0, arg1) {
      const ret = Reflect.deleteProperty(arg0, arg1);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_deployedapp_new = function(arg0) {
    const ret = DeployedApp.__wrap(arg0);
    return ret;
  };
  imports.wbg.__wbg_desiredSize_dd7689d8aa7da7dd = function(arg0, arg1) {
    const ret = arg1.desiredSize;
    getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
  };
  imports.wbg.__wbg_done_4d01f352bade43b7 = function(arg0) {
    const ret = arg0.done;
    return ret;
  };
  imports.wbg.__wbg_enqueue_a62faa171c4fd287 = function() {
    return handleError(function(arg0, arg1) {
      arg0.enqueue(arg1);
    }, arguments);
  };
  imports.wbg.__wbg_entries_41651c850143b957 = function(arg0) {
    const ret = Object.entries(arg0);
    return ret;
  };
  imports.wbg.__wbg_env_6b7462d491e7d2ae = function(arg0) {
    const ret = arg0.env;
    return ret;
  };
  imports.wbg.__wbg_error_1950bd19b566135e = function(arg0, arg1) {
    arg0.error(arg1);
  };
  imports.wbg.__wbg_error_7534b8e9a36f1ab4 = function(arg0, arg1) {
    let deferred0_0;
    let deferred0_1;
    try {
      deferred0_0 = arg0;
      deferred0_1 = arg1;
      console.error(getStringFromWasm0(arg0, arg1));
    } finally {
      wasm.canonical_abi_free(deferred0_0, deferred0_1, 1);
    }
  };
  imports.wbg.__wbg_exports_5cb55953fb23c405 = function(arg0) {
    const ret = arg0.exports;
    return ret;
  };
  imports.wbg.__wbg_exports_93f662ec1dd2b1e2 = function(arg0) {
    const ret = WebAssembly.Module.exports(arg0);
    return ret;
  };
  imports.wbg.__wbg_fetch_03b6c973bb6da9b8 = function(arg0) {
    const ret = fetch(arg0);
    return ret;
  };
  imports.wbg.__wbg_fetch_6e679fcfa9759479 = function(arg0, arg1) {
    const ret = arg0.fetch(arg1);
    return ret;
  };
  imports.wbg.__wbg_fetch_a8e43a4e138dfc93 = function(arg0, arg1) {
    const ret = arg0.fetch(arg1);
    return ret;
  };
  imports.wbg.__wbg_filename_5c8881452d91f4fd = function(arg0, arg1) {
    const ret = arg1.filename;
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
  };
  imports.wbg.__wbg_for_555902b1a859c603 = function(arg0, arg1) {
    const ret = Symbol.for(getStringFromWasm0(arg0, arg1));
    return ret;
  };
  imports.wbg.__wbg_freeze_fcbf80b070d9ed38 = function(arg0) {
    const ret = Object.freeze(arg0);
    return ret;
  };
  imports.wbg.__wbg_from_12ff8e47307bd4c7 = function(arg0) {
    const ret = Array.from(arg0);
    return ret;
  };
  imports.wbg.__wbg_getPrototypeOf_a1794d62c12daab4 = function() {
    return handleError(function(arg0) {
      const ret = Reflect.getPrototypeOf(arg0);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_getRandomValues_bcb4912f16000dc4 = function() {
    return handleError(function(arg0, arg1) {
      arg0.getRandomValues(arg1);
    }, arguments);
  };
  imports.wbg.__wbg_getTime_2afe67905d873e92 = function(arg0) {
    const ret = arg0.getTime();
    return ret;
  };
  imports.wbg.__wbg_getTimezoneOffset_31f33c0868da345e = function(arg0) {
    const ret = arg0.getTimezoneOffset();
    return ret;
  };
  imports.wbg.__wbg_get_92470be87867c2e5 = function() {
    return handleError(function(arg0, arg1) {
      const ret = Reflect.get(arg0, arg1);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_get_a131a44bd1eb6979 = function(arg0, arg1) {
    const ret = arg0[arg1 >>> 0];
    return ret;
  };
  imports.wbg.__wbg_get_be8d302ec5bf8863 = function() {
    return handleError(function(arg0, arg1) {
      const ret = arg0.get(arg1 >>> 0);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_getwithrefkey_1dc361bd10053bfe = function(arg0, arg1) {
    const ret = arg0[arg1];
    return ret;
  };
  imports.wbg.__wbg_grow_0a942972adfcde67 = function() {
    return handleError(function(arg0, arg1) {
      const ret = arg0.grow(arg1 >>> 0);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_grow_ae9c73e837b2d936 = function(arg0, arg1) {
    const ret = arg0.grow(arg1 >>> 0);
    return ret;
  };
  imports.wbg.__wbg_grow_d034989fce14cc8e = function() {
    return handleError(function(arg0, arg1) {
      const ret = arg0.grow(arg1 >>> 0);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_hardwareConcurrency_10d7194b406e56d2 = function(arg0) {
    const ret = arg0.hardwareConcurrency;
    return ret;
  };
  imports.wbg.__wbg_hardwareConcurrency_fd778a5fdf975150 = function(arg0) {
    const ret = arg0.hardwareConcurrency;
    return ret;
  };
  imports.wbg.__wbg_has_809e438ee9d787a7 = function() {
    return handleError(function(arg0, arg1) {
      const ret = Reflect.has(arg0, arg1);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_headers_0f0cbdc6290b6780 = function(arg0) {
    const ret = arg0.headers;
    return ret;
  };
  imports.wbg.__wbg_headers_67fbc7839fe933b3 = function(arg0) {
    const ret = arg0.headers;
    return ret;
  };
  imports.wbg.__wbg_hostcommanddescriptor_new = function(arg0) {
    const ret = HostCommandDescriptor.__wrap(arg0);
    return ret;
  };
  imports.wbg.__wbg_imports_1f5c972c2e57dfb5 = function(arg0) {
    const ret = WebAssembly.Module.imports(arg0);
    return ret;
  };
  imports.wbg.__wbg_instance_new = function(arg0) {
    const ret = Instance.__wrap(arg0);
    return ret;
  };
  imports.wbg.__wbg_instanceof_ArrayBuffer_a8b6f580b363f2bc = function(arg0) {
    let result;
    try {
      result = arg0 instanceof ArrayBuffer;
    } catch (_) {
      result = false;
    }
    const ret = result;
    return ret;
  };
  imports.wbg.__wbg_instanceof_Blob_2688511ca2a71508 = function(arg0) {
    let result;
    try {
      result = arg0 instanceof Blob;
    } catch (_) {
      result = false;
    }
    const ret = result;
    return ret;
  };
  imports.wbg.__wbg_instanceof_Date_ef7e3d6f544a9d16 = function(arg0) {
    let result;
    try {
      result = arg0 instanceof Date;
    } catch (_) {
      result = false;
    }
    const ret = result;
    return ret;
  };
  imports.wbg.__wbg_instanceof_Error_58a92d81483a4b16 = function(arg0) {
    let result;
    try {
      result = arg0 instanceof Error;
    } catch (_) {
      result = false;
    }
    const ret = result;
    return ret;
  };
  imports.wbg.__wbg_instanceof_Function_4de5a228b53c20c3 = function(arg0) {
    let result;
    try {
      result = arg0 instanceof Function;
    } catch (_) {
      result = false;
    }
    const ret = result;
    return ret;
  };
  imports.wbg.__wbg_instanceof_Global_d43eb3e1373e574d = function(arg0) {
    let result;
    try {
      result = arg0 instanceof WebAssembly.Global;
    } catch (_) {
      result = false;
    }
    const ret = result;
    return ret;
  };
  imports.wbg.__wbg_instanceof_Map_80cc65041c96417a = function(arg0) {
    let result;
    try {
      result = arg0 instanceof Map;
    } catch (_) {
      result = false;
    }
    const ret = result;
    return ret;
  };
  imports.wbg.__wbg_instanceof_Memory_613951003465ef5c = function(arg0) {
    let result;
    try {
      result = arg0 instanceof WebAssembly.Memory;
    } catch (_) {
      result = false;
    }
    const ret = result;
    return ret;
  };
  imports.wbg.__wbg_instanceof_Module_ac6579472cc013d8 = function(arg0) {
    let result;
    try {
      result = arg0 instanceof WebAssembly.Module;
    } catch (_) {
      result = false;
    }
    const ret = result;
    return ret;
  };
  imports.wbg.__wbg_instanceof_Object_9a05796038b7a8f6 = function(arg0) {
    let result;
    try {
      result = arg0 instanceof Object;
    } catch (_) {
      result = false;
    }
    const ret = result;
    return ret;
  };
  imports.wbg.__wbg_instanceof_Promise_66f94afc64d9039f = function(arg0) {
    let result;
    try {
      result = arg0 instanceof Promise;
    } catch (_) {
      result = false;
    }
    const ret = result;
    return ret;
  };
  imports.wbg.__wbg_instanceof_RangeError_67b19cb7651a2151 = function(arg0) {
    let result;
    try {
      result = arg0 instanceof RangeError;
    } catch (_) {
      result = false;
    }
    const ret = result;
    return ret;
  };
  imports.wbg.__wbg_instanceof_Response_e80ce8b7a2b968d2 = function(arg0) {
    let result;
    try {
      result = arg0 instanceof Response;
    } catch (_) {
      result = false;
    }
    const ret = result;
    return ret;
  };
  imports.wbg.__wbg_instanceof_Table_a5fae5b77c0e21e8 = function(arg0) {
    let result;
    try {
      result = arg0 instanceof WebAssembly.Table;
    } catch (_) {
      result = false;
    }
    const ret = result;
    return ret;
  };
  imports.wbg.__wbg_instanceof_Tag_ff306496211677da = function(arg0) {
    let result;
    try {
      result = arg0 instanceof WebAssembly.Tag;
    } catch (_) {
      result = false;
    }
    const ret = result;
    return ret;
  };
  imports.wbg.__wbg_instanceof_TypeError_16d245a01d4dd626 = function(arg0) {
    let result;
    try {
      result = arg0 instanceof TypeError;
    } catch (_) {
      result = false;
    }
    const ret = result;
    return ret;
  };
  imports.wbg.__wbg_instanceof_Uint8Array_ca460677bc155827 = function(arg0) {
    let result;
    try {
      result = arg0 instanceof Uint8Array;
    } catch (_) {
      result = false;
    }
    const ret = result;
    return ret;
  };
  imports.wbg.__wbg_instanceof_Window_68f3f67bad1729c1 = function(arg0) {
    let result;
    try {
      result = arg0 instanceof Window;
    } catch (_) {
      result = false;
    }
    const ret = result;
    return ret;
  };
  imports.wbg.__wbg_instanceof_WorkerGlobalScope_11f8a14c11024785 = function(arg0) {
    let result;
    try {
      result = arg0 instanceof WorkerGlobalScope;
    } catch (_) {
      result = false;
    }
    const ret = result;
    return ret;
  };
  imports.wbg.__wbg_isArray_2a07fd175d45c496 = function(arg0) {
    const ret = Array.isArray(arg0);
    return ret;
  };
  imports.wbg.__wbg_isArray_5f090bed72bd4f89 = function(arg0) {
    const ret = Array.isArray(arg0);
    return ret;
  };
  imports.wbg.__wbg_isSafeInteger_90d7c4674047d684 = function(arg0) {
    const ret = Number.isSafeInteger(arg0);
    return ret;
  };
  imports.wbg.__wbg_is_49ee71a294f7d2fe = function(arg0, arg1) {
    const ret = Object.is(arg0, arg1);
    return ret;
  };
  imports.wbg.__wbg_iterator_4068add5b2aef7a6 = function() {
    const ret = Symbol.iterator;
    return ret;
  };
  imports.wbg.__wbg_keys_42062809bf87339e = function(arg0) {
    const ret = Object.keys(arg0);
    return ret;
  };
  imports.wbg.__wbg_length_865e6e8de4a8c6cb = function(arg0) {
    const ret = arg0.length;
    return ret;
  };
  imports.wbg.__wbg_length_ab6d22b5ead75c72 = function(arg0) {
    const ret = arg0.length;
    return ret;
  };
  imports.wbg.__wbg_length_f00ec12454a5d9fd = function(arg0) {
    const ret = arg0.length;
    return ret;
  };
  imports.wbg.__wbg_lineno_9fe2a23a82cebd53 = function(arg0) {
    const ret = arg0.lineno;
    return ret;
  };
  imports.wbg.__wbg_locked_c5cc88823268db66 = function(arg0) {
    const ret = arg0.locked;
    return ret;
  };
  imports.wbg.__wbg_log_ea240990d83e374e = function(arg0) {
    console.log(arg0);
  };
  imports.wbg.__wbg_message_4159c15dac08c5e9 = function(arg0) {
    const ret = arg0.message;
    return ret;
  };
  imports.wbg.__wbg_message_44ef9b801b7d8bc3 = function(arg0, arg1) {
    const ret = arg1.message;
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
  };
  imports.wbg.__wbg_mount_dfb06836b0f9b20b = function(arg0) {
    const ret = arg0.mount;
    return ret;
  };
  imports.wbg.__wbg_msCrypto_0a36e2ec3a343d26 = function(arg0) {
    const ret = arg0.msCrypto;
    return ret;
  };
  imports.wbg.__wbg_navigator_6db993f5ffeb46be = function(arg0) {
    const ret = arg0.navigator;
    return ret;
  };
  imports.wbg.__wbg_navigator_fc64ba1417939b25 = function(arg0) {
    const ret = arg0.navigator;
    return ret;
  };
  imports.wbg.__wbg_networkGateway_79e326cb5c82e7fd = function(arg0, arg1) {
    const ret = arg1.networkGateway;
    var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
  };
  imports.wbg.__wbg_new0_97314565408dea38 = function() {
    const ret = /* @__PURE__ */ new Date();
    return ret;
  };
  imports.wbg.__wbg_new_07b483f72211fd66 = function() {
    const ret = new Object();
    return ret;
  };
  imports.wbg.__wbg_new_104a6fcd57ac32c0 = function() {
    return handleError(function() {
      const ret = new FileReader();
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_new_181343b7eb238d99 = function(arg0) {
    const ret = new Int32Array(arg0);
    return ret;
  };
  imports.wbg.__wbg_new_186abcfdff244e42 = function() {
    return handleError(function() {
      const ret = new AbortController();
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_new_2debb2b422bd07bd = function() {
    return handleError(function(arg0, arg1) {
      const ret = new WebAssembly.Global(arg0, arg1);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_new_39fae4e38868373c = function() {
    return handleError(function(arg0, arg1) {
      const ret = new Worker(getStringFromWasm0(arg0, arg1));
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_new_476169e6d59f23ae = function(arg0, arg1) {
    const ret = new Error(getStringFromWasm0(arg0, arg1));
    return ret;
  };
  imports.wbg.__wbg_new_4796e1cd2eb9ea6d = function() {
    return handleError(function() {
      const ret = new Headers();
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_new_58353953ad2097cc = function() {
    const ret = new Array();
    return ret;
  };
  imports.wbg.__wbg_new_5dd74caa1b362828 = function() {
    return handleError(function(arg0) {
      const ret = new WebAssembly.Module(arg0);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_new_7449da607adc249f = function() {
    return handleError(function(arg0, arg1) {
      const ret = new WebAssembly.Instance(arg0, arg1);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_new_75fba833e24e4ae9 = function() {
    return handleError(function(arg0) {
      const ret = new WebAssembly.Memory(arg0);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_new_8a6f238a6ece86ea = function() {
    const ret = new Error();
    return ret;
  };
  imports.wbg.__wbg_new_a2957aa5684de228 = function(arg0) {
    const ret = new Date(arg0);
    return ret;
  };
  imports.wbg.__wbg_new_a4e7a0370d48e1b4 = function() {
    return handleError(function(arg0) {
      const ret = new ReadableStreamDefaultReader(arg0);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_new_a979b4b45bd55c7f = function() {
    const ret = /* @__PURE__ */ new Map();
    return ret;
  };
  imports.wbg.__wbg_new_b60148568efca43b = function(arg0, arg1) {
    const ret = new TypeError(getStringFromWasm0(arg0, arg1));
    return ret;
  };
  imports.wbg.__wbg_new_e30c39c06edaabf2 = function(arg0, arg1) {
    try {
      var state0 = { a: arg0, b: arg1 };
      var cb0 = (arg02, arg12) => {
        const a = state0.a;
        state0.a = 0;
        try {
          return __wbg_adapter_222(a, state0.b, arg02, arg12);
        } finally {
          state0.a = a;
        }
      };
      const ret = new Promise(cb0);
      return ret;
    } finally {
      state0.a = state0.b = 0;
    }
  };
  imports.wbg.__wbg_new_e52b3efaaa774f96 = function(arg0) {
    const ret = new Uint8Array(arg0);
    return ret;
  };
  imports.wbg.__wbg_new_e769da3b652f0d9f = function() {
    return handleError(function(arg0) {
      const ret = new WebAssembly.Table(arg0);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_new_f42a001532528172 = function() {
    return handleError(function(arg0, arg1) {
      const ret = new WebSocket(getStringFromWasm0(arg0, arg1));
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_new_fd4b538754de98d6 = function() {
    return handleError(function(arg0) {
      const ret = new WebAssembly.Tag(arg0);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_newfromslice_7c05ab1297cb2d88 = function(arg0, arg1) {
    const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
    return ret;
  };
  imports.wbg.__wbg_newnoargs_ff528e72d35de39a = function(arg0, arg1) {
    const ret = new Function(getStringFromWasm0(arg0, arg1));
    return ret;
  };
  imports.wbg.__wbg_newwithargs_17a05078fc85d3aa = function(arg0, arg1, arg2, arg3) {
    const ret = new Function(getStringFromWasm0(arg0, arg1), getStringFromWasm0(arg2, arg3));
    return ret;
  };
  imports.wbg.__wbg_newwithbyteoffsetandlength_3b01ecda099177e8 = function(arg0, arg1, arg2) {
    const ret = new Uint8Array(arg0, arg1 >>> 0, arg2 >>> 0);
    return ret;
  };
  imports.wbg.__wbg_newwithlength_08f872dc1e3ada2e = function(arg0) {
    const ret = new Uint8Array(arg0 >>> 0);
    return ret;
  };
  imports.wbg.__wbg_newwithlength_6ee231411efd06b6 = function(arg0) {
    const ret = new Array(arg0 >>> 0);
    return ret;
  };
  imports.wbg.__wbg_newwithoptions_9931e161b714ebf9 = function() {
    return handleError(function(arg0, arg1, arg2) {
      const ret = new Worker(getStringFromWasm0(arg0, arg1), arg2);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_newwithstrandinit_f8a9dbe009d6be37 = function() {
    return handleError(function(arg0, arg1, arg2) {
      const ret = new Request(getStringFromWasm0(arg0, arg1), arg2);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_newwithu8arraysequenceandoptions_3b5b6ab7317ffd8f = function() {
    return handleError(function(arg0, arg1) {
      const ret = new Blob(arg0, arg1);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_newwithunderlyingsinkandstrategy_481c2b5a223a4560 = function() {
    return handleError(function(arg0, arg1) {
      const ret = new WritableStream(arg0, arg1);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_newwithunderlyingsourceandstrategy_594ea2be3e0723ff = function() {
    return handleError(function(arg0, arg1) {
      const ret = new ReadableStream(arg0, arg1);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_next_8bb824d217961b5d = function(arg0) {
    const ret = arg0.next;
    return ret;
  };
  imports.wbg.__wbg_next_e2da48d8fff7439a = function() {
    return handleError(function(arg0) {
      const ret = arg0.next();
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_node_02999533c4ea02e3 = function(arg0) {
    const ret = arg0.node;
    return ret;
  };
  imports.wbg.__wbg_now_eb0821f3bd9f6529 = function() {
    const ret = Date.now();
    return ret;
  };
  imports.wbg.__wbg_of_995ab9c48c3965f1 = function(arg0, arg1, arg2) {
    const ret = Array.of(arg0, arg1, arg2);
    return ret;
  };
  imports.wbg.__wbg_postMessage_54ce7f4b41ac732e = function() {
    return handleError(function(arg0, arg1) {
      arg0.postMessage(arg1);
    }, arguments);
  };
  imports.wbg.__wbg_postMessage_95ef4554c6b7ca0c = function() {
    return handleError(function(arg0, arg1) {
      arg0.postMessage(arg1);
    }, arguments);
  };
  imports.wbg.__wbg_process_5c1d670bc53614b8 = function(arg0) {
    const ret = arg0.process;
    return ret;
  };
  imports.wbg.__wbg_program_0ccd177127e926dc = function(arg0) {
    const ret = arg0.program;
    return ret;
  };
  imports.wbg.__wbg_publishpackageoutput_new = function(arg0) {
    const ret = PublishPackageOutput.__wrap(arg0);
    return ret;
  };
  imports.wbg.__wbg_push_73fd7b5550ebf707 = function(arg0, arg1) {
    const ret = arg0.push(arg1);
    return ret;
  };
  imports.wbg.__wbg_queueMicrotask_46c1df247678729f = function(arg0) {
    queueMicrotask(arg0);
  };
  imports.wbg.__wbg_queueMicrotask_8acf3ccb75ed8d11 = function(arg0) {
    const ret = arg0.queueMicrotask;
    return ret;
  };
  imports.wbg.__wbg_randomFillSync_ab2cfe79ebbf2740 = function() {
    return handleError(function(arg0, arg1) {
      arg0.randomFillSync(arg1);
    }, arguments);
  };
  imports.wbg.__wbg_random_210bb7fbfa33591d = function() {
    const ret = Math.random();
    return ret;
  };
  imports.wbg.__wbg_rawStdin_a8ac7e4ae5f9262e = function(arg0) {
    const ret = arg0.rawStdin;
    return isLikeNone(ret) ? 16777215 : ret ? 1 : 0;
  };
  imports.wbg.__wbg_readAsArrayBuffer_ec86f70be9ee80e9 = function() {
    return handleError(function(arg0, arg1) {
      arg0.readAsArrayBuffer(arg1);
    }, arguments);
  };
  imports.wbg.__wbg_read_f4b89f69cc51efc7 = function(arg0) {
    const ret = arg0.read();
    return ret;
  };
  imports.wbg.__wbg_readablestreamsource_new = function(arg0) {
    const ret = ReadableStreamSource.__wrap(arg0);
    return ret;
  };
  imports.wbg.__wbg_redirected_380499cd18bc27c0 = function(arg0) {
    const ret = arg0.redirected;
    return ret;
  };
  imports.wbg.__wbg_registry_0193688f92324c7c = function(arg0) {
    const ret = arg0.registry;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
  };
  imports.wbg.__wbg_releaseLock_c589dd51c0812aca = function(arg0) {
    arg0.releaseLock();
  };
  imports.wbg.__wbg_require_79b1e9274cde3c87 = function() {
    return handleError(function() {
      const ret = module.require;
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_resolve_0dac8c580ffd4678 = function(arg0) {
    const ret = Promise.resolve(arg0);
    return ret;
  };
  imports.wbg.__wbg_respond_b227f1c3be2bb879 = function() {
    return handleError(function(arg0, arg1) {
      arg0.respond(arg1 >>> 0);
    }, arguments);
  };
  imports.wbg.__wbg_result_142fc4d88cbccb26 = function() {
    return handleError(function(arg0) {
      const ret = arg0.result;
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_runtime_3a007260b7cad09f = function(arg0) {
    const ret = arg0.runtime;
    return ret;
  };
  imports.wbg.__wbg_send_05456d2bf190b017 = function() {
    return handleError(function(arg0, arg1) {
      arg0.send(arg1);
    }, arguments);
  };
  imports.wbg.__wbg_setTimeout_84a114fc6c4403f8 = function() {
    return handleError(function(arg0, arg1, arg2) {
      const ret = arg0.setTimeout(arg1, arg2);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_setTimeout_906fea9a7279f446 = function() {
    return handleError(function(arg0, arg1, arg2) {
      const ret = arg0.setTimeout(arg1, arg2);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_set_3f1d0b984ed272ed = function(arg0, arg1, arg2) {
    arg0[arg1] = arg2;
  };
  imports.wbg.__wbg_set_7422acbe992d64ab = function(arg0, arg1, arg2) {
    arg0[arg1 >>> 0] = arg2;
  };
  imports.wbg.__wbg_set_b042eef31c50834d = function() {
    return handleError(function(arg0, arg1, arg2, arg3, arg4) {
      arg0.set(getStringFromWasm0(arg1, arg2), getStringFromWasm0(arg3, arg4));
    }, arguments);
  };
  imports.wbg.__wbg_set_c43293f93a35998a = function() {
    return handleError(function(arg0, arg1, arg2) {
      const ret = Reflect.set(arg0, arg1, arg2);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_set_d6bdfd275fb8a4ce = function(arg0, arg1, arg2) {
    const ret = arg0.set(arg1, arg2);
    return ret;
  };
  imports.wbg.__wbg_set_eeace154fc5ce736 = function() {
    return handleError(function(arg0, arg1, arg2) {
      arg0.set(arg1 >>> 0, arg2);
    }, arguments);
  };
  imports.wbg.__wbg_set_fe4e79d1ed3b0e9b = function(arg0, arg1, arg2) {
    arg0.set(arg1, arg2 >>> 0);
  };
  imports.wbg.__wbg_setbinaryType_52787d6025601cc5 = function(arg0, arg1) {
    arg0.binaryType = __wbindgen_enum_BinaryType[arg1];
  };
  imports.wbg.__wbg_setbody_971ec015fc13d6b4 = function(arg0, arg1) {
    arg0.body = arg1;
  };
  imports.wbg.__wbg_setcredentials_920d91fb5984c94a = function(arg0, arg1) {
    arg0.credentials = __wbindgen_enum_RequestCredentials[arg1];
  };
  imports.wbg.__wbg_setheaders_65a4eb4c0443ae61 = function(arg0, arg1) {
    arg0.headers = arg1;
  };
  imports.wbg.__wbg_sethighwatermark_3017ad772d071dcb = function(arg0, arg1) {
    arg0.highWaterMark = arg1;
  };
  imports.wbg.__wbg_setmethod_8ce1be0b4d701b7c = function(arg0, arg1, arg2) {
    arg0.method = getStringFromWasm0(arg1, arg2);
  };
  imports.wbg.__wbg_setmode_bd35f026f55b6247 = function(arg0, arg1) {
    arg0.mode = __wbindgen_enum_RequestMode[arg1];
  };
  imports.wbg.__wbg_setname_9b01ac306adf8bfd = function(arg0, arg1, arg2) {
    arg0.name = getStringFromWasm0(arg1, arg2);
  };
  imports.wbg.__wbg_setonclose_c6db38f935250174 = function(arg0, arg1) {
    arg0.onclose = arg1;
  };
  imports.wbg.__wbg_setonerror_890bfd1ff86e9c78 = function(arg0, arg1) {
    arg0.onerror = arg1;
  };
  imports.wbg.__wbg_setonloadend_a6c211075855db45 = function(arg0, arg1) {
    arg0.onloadend = arg1;
  };
  imports.wbg.__wbg_setonmessage_49ca623a77cfb3e6 = function(arg0, arg1) {
    arg0.onmessage = arg1;
  };
  imports.wbg.__wbg_setonmessage_f6cf46183c427754 = function(arg0, arg1) {
    arg0.onmessage = arg1;
  };
  imports.wbg.__wbg_setonopen_1475cbeb761c101f = function(arg0, arg1) {
    arg0.onopen = arg1;
  };
  imports.wbg.__wbg_setsignal_8e72abfe7ee03c97 = function(arg0, arg1) {
    arg0.signal = arg1;
  };
  imports.wbg.__wbg_setsize_13f2192310db9b34 = function(arg0, arg1) {
    arg0.size = arg1;
  };
  imports.wbg.__wbg_settype_acc38e64fddb9e3f = function(arg0, arg1, arg2) {
    arg0.type = getStringFromWasm0(arg1, arg2);
  };
  imports.wbg.__wbg_settype_ca83ae32b7117898 = function(arg0, arg1) {
    arg0.type = __wbindgen_enum_WorkerType[arg1];
  };
  imports.wbg.__wbg_setvalue_bd9df7c968e4b416 = function(arg0, arg1) {
    arg0.value = arg1;
  };
  imports.wbg.__wbg_signal_b96223519a041faa = function(arg0) {
    const ret = arg0.signal;
    return ret;
  };
  imports.wbg.__wbg_stack_0ed75d68575b0f3c = function(arg0, arg1) {
    const ret = arg1.stack;
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
  };
  imports.wbg.__wbg_static_accessor_GLOBAL_487c52c58d65314d = function() {
    const ret = typeof global === "undefined" ? null : global;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
  };
  imports.wbg.__wbg_static_accessor_GLOBAL_THIS_ee9704f328b6b291 = function() {
    const ret = typeof globalThis === "undefined" ? null : globalThis;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
  };
  imports.wbg.__wbg_static_accessor_SELF_78c9e3071b912620 = function() {
    const ret = typeof self === "undefined" ? null : self;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
  };
  imports.wbg.__wbg_static_accessor_WINDOW_a093d21393777366 = function() {
    const ret = typeof window === "undefined" ? null : window;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
  };
  imports.wbg.__wbg_status_a54682bbe52f9058 = function(arg0) {
    const ret = arg0.status;
    return ret;
  };
  imports.wbg.__wbg_stdin_4d05ba90fc2c39de = function(arg0) {
    const ret = arg0.stdin;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
  };
  imports.wbg.__wbg_stringify_c242842b97f054cc = function() {
    return handleError(function(arg0) {
      const ret = JSON.stringify(arg0);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_subarray_dd4ade7d53bd8e26 = function(arg0, arg1, arg2) {
    const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
    return ret;
  };
  imports.wbg.__wbg_terminate_af36b01db24a1745 = function(arg0) {
    arg0.terminate();
  };
  imports.wbg.__wbg_text_ec0e22f60e30dd2f = function() {
    return handleError(function(arg0) {
      const ret = arg0.text();
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_then_82ab9fb4080f1707 = function(arg0, arg1, arg2) {
    const ret = arg0.then(arg1, arg2);
    return ret;
  };
  imports.wbg.__wbg_then_db882932c0c714c6 = function(arg0, arg1) {
    const ret = arg0.then(arg1);
    return ret;
  };
  imports.wbg.__wbg_toString_2a748bb7135f7e4d = function(arg0, arg1, arg2) {
    const ret = arg1.toString(arg2);
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
  };
  imports.wbg.__wbg_toString_bc7a05a172b5cf14 = function(arg0) {
    const ret = arg0.toString();
    return ret;
  };
  imports.wbg.__wbg_trap_new = function(arg0) {
    const ret = Trap.__wrap(arg0);
    return ret;
  };
  imports.wbg.__wbg_url_e6ed869ea05b7a71 = function(arg0, arg1) {
    const ret = arg1.url;
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
  };
  imports.wbg.__wbg_userAgent_470abfd84e4eedcb = function() {
    return handleError(function(arg0, arg1) {
      const ret = arg1.userAgent;
      const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
      const len1 = WASM_VECTOR_LEN;
      getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
      getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    }, arguments);
  };
  imports.wbg.__wbg_userAgent_a24a493cd80cbd00 = function() {
    return handleError(function(arg0, arg1) {
      const ret = arg1.userAgent;
      const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
      const len1 = WASM_VECTOR_LEN;
      getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
      getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    }, arguments);
  };
  imports.wbg.__wbg_user_new = function(arg0) {
    const ret = User.__wrap(arg0);
    return ret;
  };
  imports.wbg.__wbg_userpackagedefinition_unwrap = function(arg0) {
    const ret = UserPackageDefinition.__unwrap(arg0);
    return ret;
  };
  imports.wbg.__wbg_uses_7494620cc35a86ad = function(arg0) {
    const ret = arg0.uses;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
  };
  imports.wbg.__wbg_value_17b896954e14f896 = function(arg0) {
    const ret = arg0.value;
    return ret;
  };
  imports.wbg.__wbg_value_c22dc41e42f5d813 = function(arg0) {
    const ret = arg0.value;
    return ret;
  };
  imports.wbg.__wbg_value_f8fe3ce05407a213 = function(arg0) {
    const ret = arg0.value;
    return ret;
  };
  imports.wbg.__wbg_versions_c71aa1626a93e0a1 = function(arg0) {
    const ret = arg0.versions;
    return ret;
  };
  imports.wbg.__wbg_view_a9ad80dcbad7cf1c = function(arg0) {
    const ret = arg0.view;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
  };
  imports.wbg.__wbg_waitAsync_c3398694eaa5aeab = function(arg0, arg1, arg2) {
    const ret = Atomics.waitAsync(arg0, arg1 >>> 0, arg2);
    return ret;
  };
  imports.wbg.__wbg_waitAsync_e36f18e2e26c3b7d = function() {
    const ret = Atomics.waitAsync;
    return ret;
  };
  imports.wbg.__wbg_wasmer_new = function(arg0) {
    const ret = Wasmer.__wrap(arg0);
    return ret;
  };
  imports.wbg.__wbg_writablestreamsink_new = function(arg0) {
    const ret = WritableStreamSink.__wrap(arg0);
    return ret;
  };
  imports.wbg.__wbindgen_array_new = function() {
    const ret = [];
    return ret;
  };
  imports.wbg.__wbindgen_array_push = function(arg0, arg1) {
    arg0.push(arg1);
  };
  imports.wbg.__wbindgen_as_number = function(arg0) {
    const ret = +arg0;
    return ret;
  };
  imports.wbg.__wbindgen_bigint_from_i64 = function(arg0) {
    const ret = arg0;
    return ret;
  };
  imports.wbg.__wbindgen_bigint_from_u128 = function(arg0, arg1) {
    const ret = BigInt.asUintN(64, arg0) << BigInt(64) | BigInt.asUintN(64, arg1);
    return ret;
  };
  imports.wbg.__wbindgen_bigint_from_u64 = function(arg0) {
    const ret = BigInt.asUintN(64, arg0);
    return ret;
  };
  imports.wbg.__wbindgen_bigint_get_as_i64 = function(arg0, arg1) {
    const v = arg1;
    const ret = typeof v === "bigint" ? v : void 0;
    getDataViewMemory0().setBigInt64(arg0 + 8 * 1, isLikeNone(ret) ? BigInt(0) : ret, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
  };
  imports.wbg.__wbindgen_boolean_get = function(arg0) {
    const v = arg0;
    const ret = typeof v === "boolean" ? v ? 1 : 0 : 2;
    return ret;
  };
  imports.wbg.__wbindgen_cb_drop = function(arg0) {
    const obj = arg0.original;
    if (obj.cnt-- == 1) {
      obj.a = 0;
      return true;
    }
    const ret = false;
    return ret;
  };
  imports.wbg.__wbindgen_closure_wrapper12867 = function(arg0, arg1, arg2) {
    const ret = makeMutClosure(arg0, arg1, 1267, __wbg_adapter_87);
    return ret;
  };
  imports.wbg.__wbindgen_closure_wrapper12871 = function(arg0, arg1, arg2) {
    const ret = makeMutClosure(arg0, arg1, 1267, __wbg_adapter_90);
    return ret;
  };
  imports.wbg.__wbindgen_closure_wrapper12875 = function(arg0, arg1, arg2) {
    const ret = makeMutClosure(arg0, arg1, 1267, __wbg_adapter_90);
    return ret;
  };
  imports.wbg.__wbindgen_closure_wrapper6539 = function(arg0, arg1, arg2) {
    const ret = makeMutClosure(arg0, arg1, 529, __wbg_adapter_72);
    return ret;
  };
  imports.wbg.__wbindgen_closure_wrapper6547 = function(arg0, arg1, arg2) {
    const ret = makeMutClosure(arg0, arg1, 529, __wbg_adapter_72);
    return ret;
  };
  imports.wbg.__wbindgen_closure_wrapper8796 = function(arg0, arg1, arg2) {
    const ret = makeClosure(arg0, arg1, 763, __wbg_adapter_77);
    return ret;
  };
  imports.wbg.__wbindgen_closure_wrapper8803 = function(arg0, arg1, arg2) {
    const ret = makeMutClosure(arg0, arg1, 763, __wbg_adapter_72);
    return ret;
  };
  imports.wbg.__wbindgen_closure_wrapper8840 = function(arg0, arg1, arg2) {
    const ret = makeClosure(arg0, arg1, 763, __wbg_adapter_82);
    return ret;
  };
  imports.wbg.__wbindgen_closure_wrapper8848 = function(arg0, arg1, arg2) {
    const ret = makeMutClosure(arg0, arg1, 763, __wbg_adapter_72);
    return ret;
  };
  imports.wbg.__wbindgen_debug_string = function(arg0, arg1) {
    const ret = debugString(arg1);
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
  };
  imports.wbg.__wbindgen_function_table = function() {
    const ret = wasm.__wbindgen_export_6;
    return ret;
  };
  imports.wbg.__wbindgen_in = function(arg0, arg1) {
    const ret = arg0 in arg1;
    return ret;
  };
  imports.wbg.__wbindgen_init_externref_table = function() {
    const table = wasm.__wbindgen_export_5;
    const offset = table.grow(4);
    table.set(0, void 0);
    table.set(offset + 0, void 0);
    table.set(offset + 1, null);
    table.set(offset + 2, true);
    table.set(offset + 3, false);
    ;
  };
  imports.wbg.__wbindgen_is_bigint = function(arg0) {
    const ret = typeof arg0 === "bigint";
    return ret;
  };
  imports.wbg.__wbindgen_is_falsy = function(arg0) {
    const ret = !arg0;
    return ret;
  };
  imports.wbg.__wbindgen_is_function = function(arg0) {
    const ret = typeof arg0 === "function";
    return ret;
  };
  imports.wbg.__wbindgen_is_null = function(arg0) {
    const ret = arg0 === null;
    return ret;
  };
  imports.wbg.__wbindgen_is_object = function(arg0) {
    const val = arg0;
    const ret = typeof val === "object" && val !== null;
    return ret;
  };
  imports.wbg.__wbindgen_is_string = function(arg0) {
    const ret = typeof arg0 === "string";
    return ret;
  };
  imports.wbg.__wbindgen_is_undefined = function(arg0) {
    const ret = arg0 === void 0;
    return ret;
  };
  imports.wbg.__wbindgen_jsval_eq = function(arg0, arg1) {
    const ret = arg0 === arg1;
    return ret;
  };
  imports.wbg.__wbindgen_jsval_loose_eq = function(arg0, arg1) {
    const ret = arg0 == arg1;
    return ret;
  };
  imports.wbg.__wbindgen_link_db87ac8434ca3f93 = function(arg0) {
    const val = `onmessage = function (ev) {
            let [ia, index, value] = ev.data;
            ia = new Int32Array(ia.buffer);
            let result = Atomics.wait(ia, index, value);
            postMessage(result);
        };
        `;
    const ret = typeof URL.createObjectURL === "undefined" ? "data:application/javascript," + encodeURIComponent(val) : URL.createObjectURL(new Blob([val], { type: "text/javascript" }));
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
  };
  imports.wbg.__wbindgen_lt = function(arg0, arg1) {
    const ret = arg0 < arg1;
    return ret;
  };
  imports.wbg.__wbindgen_memory = function() {
    const ret = wasm.memory;
    return ret;
  };
  imports.wbg.__wbindgen_module = function() {
    const ret = __wbg_init.__wbindgen_wasm_module;
    return ret;
  };
  imports.wbg.__wbindgen_neg = function(arg0) {
    const ret = -arg0;
    return ret;
  };
  imports.wbg.__wbindgen_number_get = function(arg0, arg1) {
    const obj = arg1;
    const ret = typeof obj === "number" ? obj : void 0;
    getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
  };
  imports.wbg.__wbindgen_number_new = function(arg0) {
    const ret = arg0;
    return ret;
  };
  imports.wbg.__wbindgen_rethrow = function(arg0) {
    throw arg0;
  };
  imports.wbg.__wbindgen_shr = function(arg0, arg1) {
    const ret = arg0 >> arg1;
    return ret;
  };
  imports.wbg.__wbindgen_string_get = function(arg0, arg1) {
    const obj = arg1;
    const ret = typeof obj === "string" ? obj : void 0;
    var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
  };
  imports.wbg.__wbindgen_string_new = function(arg0, arg1) {
    const ret = getStringFromWasm0(arg0, arg1);
    return ret;
  };
  imports.wbg.__wbindgen_throw = function(arg0, arg1) {
    throw new Error(getStringFromWasm0(arg0, arg1));
  };
  return imports;
}
function __wbg_init_memory(imports, memory) {
  imports.wbg.memory = memory || new WebAssembly.Memory({ initial: 35, maximum: 16384, shared: true });
}
function __wbg_finalize_init(instance, module2, thread_stack_size) {
  wasm = instance.exports;
  __wbg_init.__wbindgen_wasm_module = module2;
  cachedDataViewMemory0 = null;
  cachedUint8ArrayMemory0 = null;
  if (typeof thread_stack_size !== "undefined" && (typeof thread_stack_size !== "number" || thread_stack_size === 0 || thread_stack_size % 65536 !== 0)) {
    throw "invalid stack size";
  }
  wasm.__wbindgen_start(thread_stack_size);
  return wasm;
}
function initSync(module2, memory) {
  if (wasm !== void 0) return wasm;
  let thread_stack_size;
  if (typeof module2 !== "undefined") {
    if (Object.getPrototypeOf(module2) === Object.prototype) {
      ({ module: module2, memory, thread_stack_size } = module2);
    } else {
      console.warn("using deprecated parameters for `initSync()`; pass a single object instead");
    }
  }
  const imports = __wbg_get_imports();
  __wbg_init_memory(imports, memory);
  if (!(module2 instanceof WebAssembly.Module)) {
    module2 = new WebAssembly.Module(module2);
  }
  const instance = new WebAssembly.Instance(module2, imports);
  return __wbg_finalize_init(instance, module2, thread_stack_size);
}
async function __wbg_init(module_or_path, memory) {
  if (wasm !== void 0) return wasm;
  let thread_stack_size;
  if (typeof module_or_path !== "undefined") {
    if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
      ({ module_or_path, memory, thread_stack_size } = module_or_path);
    } else {
      console.warn("using deprecated parameters for the initialization function; pass a single object instead");
    }
  }
  if (typeof module_or_path === "undefined") {
    module_or_path = new URL("wasmer_js_bg.wasm", import.meta.url);
  }
  const imports = __wbg_get_imports();
  if (typeof module_or_path === "string" || typeof Request === "function" && module_or_path instanceof Request || typeof URL === "function" && module_or_path instanceof URL) {
    module_or_path = fetch(module_or_path);
  }
  __wbg_init_memory(imports, memory);
  const { instance, module: module2 } = await __wbg_load(await module_or_path, imports);
  return __wbg_finalize_init(instance, module2, thread_stack_size);
}
var wasmer_js_default = __wbg_init;

// pinned-sdk:sdk/src-js/index.ts
var init = async (initValue, memory) => {
  if (!initValue) {
    initValue = {};
  } else if (initValue instanceof WebAssembly.Module || initValue instanceof URL || initValue instanceof WebAssembly.Module) {
    if (memory) {
      console.info(
        "Passing the module and memory as first arguments to the init function is deprecated, please use: `init({module: WASM_MODULE, memory: WASM_MEMORY})`"
      );
      initValue = {
        module: initValue,
        memory
      };
    } else {
      console.info(
        "Passing the module as first argument to the init function is deprecated, please use: `init({module: WASM_MODULE})`"
      );
      initValue = {
        module: initValue
      };
    }
  }
  setRegistry(initValue);
  let output = await wasmer_js_default(initValue.module, initValue.memory);
  if (initValue.log) {
    initializeLogger(initValue.log);
  }
  if (initValue.workerUrl) {
    setWorkerUrl(initValue.workerUrl.toString());
  }
  if (initValue.sdkUrl) {
    setSDKUrl(initValue.sdkUrl.toString());
  } else {
    setSDKUrl(new URL("index.mjs", import.meta.url).toString());
  }
  return output;
};
var setRegistry = (initValue) => {
  globalThis["__WASMER_REGISTRY__"] = {
    registryUrl: initValue.registryUrl,
    token: initValue.token
  };
};

// pinned-sdk:entry/index.js
var requiredMemory = { "shared": true, "minimumPages": 35, "maximumPages": 16384 };
var sdkUrl = new URL("./index.mjs", import.meta.url).href;
var workerUrl = new URL("./worker.mjs", import.meta.url).href;
function validate(value) {
  if (!value || !(value.module instanceof WebAssembly.Module)) throw new TypeError("SDK_PACKAGE_VERIFIED_MODULE_REQUIRED");
  if (!(value.memory instanceof WebAssembly.Memory) || typeof SharedArrayBuffer !== "function" || !(value.memory.buffer instanceof SharedArrayBuffer)) throw new TypeError("SDK_PACKAGE_SHARED_MEMORY_REQUIRED");
  const pages = value.memory.buffer.byteLength / 65536;
  if (pages < requiredMemory.minimumPages || pages > requiredMemory.maximumPages) throw new RangeError("SDK_PACKAGE_MEMORY_PROFILE");
  if (value.sdkUrl !== void 0 && String(value.sdkUrl) !== sdkUrl) throw new TypeError("SDK_PACKAGE_FIXED_MODULE_URL");
  if (value.workerUrl !== void 0 && String(value.workerUrl) !== workerUrl) throw new TypeError("SDK_PACKAGE_FIXED_WORKER_URL");
}
var binding;
function init2(value) {
  validate(value);
  if (binding && (binding.module !== value.module || binding.memory !== value.memory)) throw new TypeError("SDK_PACKAGE_BINDING_CHANGED");
  binding ??= { module: value.module, memory: value.memory };
  return init({ ...value, module: binding.module, memory: binding.memory, sdkUrl, workerUrl });
}
export {
  Atom,
  Command,
  DeployedApp,
  Directory,
  HostCommandDescriptor,
  Instance,
  IntoUnderlyingByteSource,
  IntoUnderlyingSink,
  IntoUnderlyingSource,
  PublishPackageOutput,
  ReadableStreamSource,
  Runtime,
  ThreadPoolWorker,
  Trap,
  User,
  UserPackageDefinition,
  Volume,
  Wasmer,
  WasmerPackage,
  WritableStreamSink,
  init2 as init,
  initSync,
  initializeLogger,
  on_start,
  runWasix,
  setRegistry,
  setSDKUrl,
  setWorkerUrl,
  wat2wasm
};
