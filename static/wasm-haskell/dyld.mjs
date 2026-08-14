#!/usr/bin/env -S node --disable-warning=ExperimentalWarning --max-old-space-size=65536 --wasm-lazy-validation
//#region \0rolldown/runtime.js
var __defProp = Object.defineProperty;
var __esmMin = (fn, res) => () => (fn && (res = fn(fn = 0)), res);
var __exportAll = (all, no_symbols) => {
	let target = {};
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
	if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
	return target;
};
//#endregion
//#region \0vite/preload-helper.js
var scriptRel = /* @__PURE__ */ (function detectScriptRel() {
	const relList = typeof document !== "undefined" && document.createElement("link").relList;
	return relList && relList.supports && relList.supports("modulepreload") ? "modulepreload" : "preload";
})();
var assetsURL = function(dep, importerUrl) {
	return new URL(dep, importerUrl).href;
};
var seen = {};
var __vitePreload = function preload(baseModule, deps, importerUrl) {
	let promise = Promise.resolve();
	if (deps && deps.length > 0) {
		const links = document.getElementsByTagName("link");
		const cspNonceMeta = document.querySelector("meta[property=csp-nonce]");
		const cspNonce = cspNonceMeta?.nonce || cspNonceMeta?.getAttribute("nonce");
		function allSettled(promises) {
			return Promise.all(promises.map((p) => Promise.resolve(p).then((value) => ({
				status: "fulfilled",
				value
			}), (reason) => ({
				status: "rejected",
				reason
			}))));
		}
		promise = allSettled(deps.map((dep) => {
			dep = assetsURL(dep, importerUrl);
			if (dep in seen) return;
			seen[dep] = true;
			const isCss = dep.endsWith(".css");
			const cssSelector = isCss ? "[rel=\"stylesheet\"]" : "";
			if (!!importerUrl) for (let i = links.length - 1; i >= 0; i--) {
				const link = links[i];
				if (link.href === dep && (!isCss || link.rel === "stylesheet")) return;
			}
			else if (document.querySelector(`link[href="${dep}"]${cssSelector}`)) return;
			const link = document.createElement("link");
			link.rel = isCss ? "stylesheet" : scriptRel;
			if (!isCss) link.as = "script";
			link.crossOrigin = "";
			link.href = dep;
			if (cspNonce) link.setAttribute("nonce", cspNonce);
			document.head.appendChild(link);
			if (isCss) return new Promise((res, rej) => {
				link.addEventListener("load", res);
				link.addEventListener("error", () => rej(/* @__PURE__ */ new Error(`Unable to preload CSS for ${dep}`)));
			});
		}));
	}
	function handlePreloadError(err) {
		const e = new Event("vite:preloadError", { cancelable: true });
		e.payload = err;
		window.dispatchEvent(e);
		if (!e.defaultPrevented) throw err;
	}
	return promise.then((res) => {
		for (const item of res || []) {
			if (item.status !== "rejected") continue;
			handlePreloadError(item.reason);
		}
		return baseModule().catch(handlePreloadError);
	});
};
//#endregion
//#region prelude.mjs
var JSValManager = class {
	#lastk = 0;
	#kv = /* @__PURE__ */ new Map();
	newJSVal(v) {
		const k = ++this.#lastk;
		this.#kv.set(k, v);
		return k;
	}
	getJSVal(k) {
		if (!this.#kv.has(k)) throw new WebAssembly.RuntimeError(`getJSVal(${k})`);
		return this.#kv.get(k);
	}
	freeJSVal(k) {
		if (!this.#kv.delete(k)) throw new WebAssembly.RuntimeError(`freeJSVal(${k})`);
	}
};
var setImmediate = await (async () => {
	if (globalThis.setImmediate) return globalThis.setImmediate;
	if (globalThis.Deno) try {
		return (await __vitePreload(async () => {
			const { setImmediate } = await import("node:timers");
			return { setImmediate };
		}, [], import.meta.url)).setImmediate;
	} catch {}
	if (globalThis.scheduler) return (cb, ...args) => scheduler.postTask(() => cb(...args));
	if (globalThis.MessageChannel) {
		class SetImmediate {
			#fs = [];
			#mc = new MessageChannel();
			constructor() {
				this.#mc.port1.addEventListener("message", () => {
					this.#fs.pop()();
				});
				this.#mc.port1.start();
			}
			setImmediate(cb, ...args) {
				this.#fs.push(() => cb(...args));
				this.#mc.port2.postMessage(void 0);
			}
		}
		const sm = new SetImmediate();
		return (cb, ...args) => sm.setImmediate(cb, ...args);
	}
	return (cb, ...args) => setTimeout(cb, 0, ...args);
})();
//#endregion
//#region post-link.mjs
function parseRecord([name, binder, body]) {
	for (const src of [`${binder} => (${body})`, `${binder} => {${body}}`]) try {
		new Function(`return ${src};`);
		return src;
	} catch (_) {}
	throw new Error(`parseRecord ${name} ${binder} ${body}`);
}
function parseSections(mod) {
	const recs = [];
	const dec = new TextDecoder("utf-8", { fatal: true });
	const importNames = new Set(WebAssembly.Module.imports(mod).filter((i) => i.module === "ghc_wasm_jsffi").map((i) => i.name));
	for (const buf of WebAssembly.Module.customSections(mod, "ghc_wasm_jsffi")) {
		const ba = new Uint8Array(buf);
		let strs = [];
		for (let l = 0, r; l < ba.length; l = r + 1) {
			r = ba.indexOf(0, l);
			strs.push(dec.decode(ba.subarray(l, r)));
			if (strs.length === 3) {
				if (importNames.has(strs[0])) recs.push(strs);
				strs = [];
			}
		}
	}
	return recs;
}
async function postLink(mod) {
	const fs = (await __vitePreload(async () => {
		const { default: __vite_default__ } = await import("node:fs/promises");
		return { default: __vite_default__ };
	}, [], import.meta.url)).default;
	const path = (await __vitePreload(async () => {
		const { default: __vite_default__ } = await import("node:path");
		return { default: __vite_default__ };
	}, [], import.meta.url)).default;
	let src = (await fs.readFile(path.join(import.meta.dirname, "prelude.mjs"), { encoding: "utf-8" })).replaceAll("export ", "");
	src = `${src}\nexport default (__exports) => {`;
	src = `${src}\nconst __ghc_wasm_jsffi_jsval_manager = new JSValManager();`;
	src = `${src}\nconst __ghc_wasm_jsffi_finalization_registry = globalThis.FinalizationRegistry ? new FinalizationRegistry(sp => __exports.rts_freeStablePtr(sp)) : { register: () => {}, unregister: () => true };`;
	src = `${src}\nreturn {`;
	src = `${src}\nnewJSVal: (v) => __ghc_wasm_jsffi_jsval_manager.newJSVal(v),`;
	src = `${src}\ngetJSVal: (k) => __ghc_wasm_jsffi_jsval_manager.getJSVal(k),`;
	src = `${src}\nfreeJSVal: (k) => __ghc_wasm_jsffi_jsval_manager.freeJSVal(k),`;
	src = `${src}\nscheduleWork: () => setImmediate(__exports.rts_schedulerLoop),`;
	for (const rec of parseSections(mod)) src = `${src}\n${rec[0]}: ${parseRecord(rec)},`;
	return `${src}\n};\n};\n`;
}
function isMain() {
	if (!globalThis?.process?.versions?.node) return false;
	return "dyld.mjs" === process.argv[1];
}
async function main$1() {
	const fs = (await __vitePreload(async () => {
		const { default: __vite_default__ } = await import("node:fs/promises");
		return { default: __vite_default__ };
	}, [], import.meta.url)).default;
	const { input, output } = (await __vitePreload(async () => {
		const { default: __vite_default__ } = await import("node:util");
		return { default: __vite_default__ };
	}, [], import.meta.url)).default.parseArgs({ options: {
		input: {
			type: "string",
			short: "i"
		},
		output: {
			type: "string",
			short: "o"
		}
	} }).values;
	await fs.writeFile(output, await postLink(await WebAssembly.compile(await fs.readFile(input))));
}
if (isMain()) await main$1();
//#endregion
//#region browser_wasi_shim/wasi_defs.js
var wasi_defs_exports = /* @__PURE__ */ __exportAll({
	ADVICE_DONTNEED: () => 4,
	ADVICE_NOREUSE: () => 5,
	ADVICE_NORMAL: () => 0,
	ADVICE_RANDOM: () => 2,
	ADVICE_SEQUENTIAL: () => 1,
	ADVICE_WILLNEED: () => 3,
	CLOCKID_MONOTONIC: () => 1,
	CLOCKID_PROCESS_CPUTIME_ID: () => 2,
	CLOCKID_REALTIME: () => 0,
	CLOCKID_THREAD_CPUTIME_ID: () => 3,
	Ciovec: () => Ciovec,
	Dirent: () => Dirent,
	ERRNO_2BIG: () => 1,
	ERRNO_ACCES: () => 2,
	ERRNO_ADDRINUSE: () => 3,
	ERRNO_ADDRNOTAVAIL: () => 4,
	ERRNO_AFNOSUPPORT: () => 5,
	ERRNO_AGAIN: () => 6,
	ERRNO_ALREADY: () => 7,
	ERRNO_BADF: () => 8,
	ERRNO_BADMSG: () => 9,
	ERRNO_BUSY: () => 10,
	ERRNO_CANCELED: () => 11,
	ERRNO_CHILD: () => 12,
	ERRNO_CONNABORTED: () => 13,
	ERRNO_CONNREFUSED: () => 14,
	ERRNO_CONNRESET: () => 15,
	ERRNO_DEADLK: () => 16,
	ERRNO_DESTADDRREQ: () => 17,
	ERRNO_DOM: () => 18,
	ERRNO_DQUOT: () => 19,
	ERRNO_EXIST: () => 20,
	ERRNO_FAULT: () => 21,
	ERRNO_FBIG: () => 22,
	ERRNO_HOSTUNREACH: () => 23,
	ERRNO_IDRM: () => 24,
	ERRNO_ILSEQ: () => 25,
	ERRNO_INPROGRESS: () => 26,
	ERRNO_INTR: () => 27,
	ERRNO_INVAL: () => 28,
	ERRNO_IO: () => 29,
	ERRNO_ISCONN: () => 30,
	ERRNO_ISDIR: () => 31,
	ERRNO_LOOP: () => 32,
	ERRNO_MFILE: () => 33,
	ERRNO_MLINK: () => 34,
	ERRNO_MSGSIZE: () => 35,
	ERRNO_MULTIHOP: () => 36,
	ERRNO_NAMETOOLONG: () => 37,
	ERRNO_NETDOWN: () => 38,
	ERRNO_NETRESET: () => 39,
	ERRNO_NETUNREACH: () => 40,
	ERRNO_NFILE: () => 41,
	ERRNO_NOBUFS: () => 42,
	ERRNO_NODEV: () => 43,
	ERRNO_NOENT: () => 44,
	ERRNO_NOEXEC: () => 45,
	ERRNO_NOLCK: () => 46,
	ERRNO_NOLINK: () => 47,
	ERRNO_NOMEM: () => 48,
	ERRNO_NOMSG: () => 49,
	ERRNO_NOPROTOOPT: () => 50,
	ERRNO_NOSPC: () => 51,
	ERRNO_NOSYS: () => 52,
	ERRNO_NOTCAPABLE: () => 76,
	ERRNO_NOTCONN: () => 53,
	ERRNO_NOTDIR: () => 54,
	ERRNO_NOTEMPTY: () => 55,
	ERRNO_NOTRECOVERABLE: () => 56,
	ERRNO_NOTSOCK: () => 57,
	ERRNO_NOTSUP: () => 58,
	ERRNO_NOTTY: () => 59,
	ERRNO_NXIO: () => 60,
	ERRNO_OVERFLOW: () => 61,
	ERRNO_OWNERDEAD: () => 62,
	ERRNO_PERM: () => 63,
	ERRNO_PIPE: () => 64,
	ERRNO_PROTO: () => 65,
	ERRNO_PROTONOSUPPORT: () => 66,
	ERRNO_PROTOTYPE: () => 67,
	ERRNO_RANGE: () => 68,
	ERRNO_ROFS: () => 69,
	ERRNO_SPIPE: () => 70,
	ERRNO_SRCH: () => 71,
	ERRNO_STALE: () => 72,
	ERRNO_SUCCESS: () => 0,
	ERRNO_TIMEDOUT: () => 73,
	ERRNO_TXTBSY: () => 74,
	ERRNO_XDEV: () => 75,
	EVENTRWFLAGS_FD_READWRITE_HANGUP: () => 1,
	EVENTTYPE_CLOCK: () => 0,
	EVENTTYPE_FD_READ: () => 1,
	EVENTTYPE_FD_WRITE: () => 2,
	Event: () => Event$1,
	FDFLAGS_APPEND: () => 1,
	FDFLAGS_DSYNC: () => 2,
	FDFLAGS_NONBLOCK: () => 4,
	FDFLAGS_RSYNC: () => 8,
	FDFLAGS_SYNC: () => 16,
	FD_STDERR: () => 2,
	FD_STDIN: () => 0,
	FD_STDOUT: () => 1,
	FILETYPE_BLOCK_DEVICE: () => 1,
	FILETYPE_CHARACTER_DEVICE: () => 2,
	FILETYPE_DIRECTORY: () => 3,
	FILETYPE_REGULAR_FILE: () => 4,
	FILETYPE_SOCKET_DGRAM: () => 5,
	FILETYPE_SOCKET_STREAM: () => 6,
	FILETYPE_SYMBOLIC_LINK: () => 7,
	FILETYPE_UNKNOWN: () => 0,
	FSTFLAGS_ATIM: () => 1,
	FSTFLAGS_ATIM_NOW: () => 2,
	FSTFLAGS_MTIM: () => 4,
	FSTFLAGS_MTIM_NOW: () => 8,
	Fdstat: () => Fdstat,
	Filestat: () => Filestat,
	Iovec: () => Iovec,
	OFLAGS_CREAT: () => 1,
	OFLAGS_DIRECTORY: () => 2,
	OFLAGS_EXCL: () => 4,
	OFLAGS_TRUNC: () => 8,
	PREOPENTYPE_DIR: () => 0,
	Prestat: () => Prestat,
	PrestatDir: () => PrestatDir,
	RIFLAGS_RECV_PEEK: () => 1,
	RIFLAGS_RECV_WAITALL: () => 2,
	RIGHTS_FD_ADVISE: () => 128,
	RIGHTS_FD_ALLOCATE: () => 256,
	RIGHTS_FD_DATASYNC: () => 1,
	RIGHTS_FD_FDSTAT_SET_FLAGS: () => 8,
	RIGHTS_FD_FILESTAT_GET: () => RIGHTS_FD_FILESTAT_GET,
	RIGHTS_FD_FILESTAT_SET_SIZE: () => RIGHTS_FD_FILESTAT_SET_SIZE,
	RIGHTS_FD_FILESTAT_SET_TIMES: () => RIGHTS_FD_FILESTAT_SET_TIMES,
	RIGHTS_FD_READ: () => 2,
	RIGHTS_FD_READDIR: () => RIGHTS_FD_READDIR,
	RIGHTS_FD_SEEK: () => 4,
	RIGHTS_FD_SYNC: () => 16,
	RIGHTS_FD_TELL: () => 32,
	RIGHTS_FD_WRITE: () => 64,
	RIGHTS_PATH_CREATE_DIRECTORY: () => 512,
	RIGHTS_PATH_CREATE_FILE: () => RIGHTS_PATH_CREATE_FILE,
	RIGHTS_PATH_FILESTAT_GET: () => RIGHTS_PATH_FILESTAT_GET,
	RIGHTS_PATH_FILESTAT_SET_SIZE: () => RIGHTS_PATH_FILESTAT_SET_SIZE,
	RIGHTS_PATH_FILESTAT_SET_TIMES: () => RIGHTS_PATH_FILESTAT_SET_TIMES,
	RIGHTS_PATH_LINK_SOURCE: () => RIGHTS_PATH_LINK_SOURCE,
	RIGHTS_PATH_LINK_TARGET: () => RIGHTS_PATH_LINK_TARGET,
	RIGHTS_PATH_OPEN: () => RIGHTS_PATH_OPEN,
	RIGHTS_PATH_READLINK: () => RIGHTS_PATH_READLINK,
	RIGHTS_PATH_REMOVE_DIRECTORY: () => RIGHTS_PATH_REMOVE_DIRECTORY,
	RIGHTS_PATH_RENAME_SOURCE: () => RIGHTS_PATH_RENAME_SOURCE,
	RIGHTS_PATH_RENAME_TARGET: () => RIGHTS_PATH_RENAME_TARGET,
	RIGHTS_PATH_SYMLINK: () => RIGHTS_PATH_SYMLINK,
	RIGHTS_PATH_UNLINK_FILE: () => RIGHTS_PATH_UNLINK_FILE,
	RIGHTS_POLL_FD_READWRITE: () => RIGHTS_POLL_FD_READWRITE,
	RIGHTS_SOCK_SHUTDOWN: () => RIGHTS_SOCK_SHUTDOWN,
	ROFLAGS_RECV_DATA_TRUNCATED: () => 1,
	SDFLAGS_RD: () => 1,
	SDFLAGS_WR: () => 2,
	SIGNAL_ABRT: () => 6,
	SIGNAL_ALRM: () => 14,
	SIGNAL_BUS: () => 7,
	SIGNAL_CHLD: () => 16,
	SIGNAL_CONT: () => 17,
	SIGNAL_FPE: () => 8,
	SIGNAL_HUP: () => 1,
	SIGNAL_ILL: () => 4,
	SIGNAL_INT: () => 2,
	SIGNAL_KILL: () => 9,
	SIGNAL_NONE: () => 0,
	SIGNAL_PIPE: () => 13,
	SIGNAL_POLL: () => 28,
	SIGNAL_PROF: () => 26,
	SIGNAL_PWR: () => 29,
	SIGNAL_QUIT: () => 3,
	SIGNAL_SEGV: () => 11,
	SIGNAL_STOP: () => 18,
	SIGNAL_SYS: () => 30,
	SIGNAL_TERM: () => 15,
	SIGNAL_TRAP: () => 5,
	SIGNAL_TSTP: () => 19,
	SIGNAL_TTIN: () => 20,
	SIGNAL_TTOU: () => 21,
	SIGNAL_URG: () => 22,
	SIGNAL_USR1: () => 10,
	SIGNAL_USR2: () => 12,
	SIGNAL_VTALRM: () => 25,
	SIGNAL_WINCH: () => 27,
	SIGNAL_XCPU: () => 23,
	SIGNAL_XFSZ: () => 24,
	SUBCLOCKFLAGS_SUBSCRIPTION_CLOCK_ABSTIME: () => 1,
	Subscription: () => Subscription,
	WHENCE_CUR: () => 1,
	WHENCE_END: () => 2,
	WHENCE_SET: () => 0
}), RIGHTS_PATH_CREATE_FILE, RIGHTS_PATH_LINK_SOURCE, RIGHTS_PATH_LINK_TARGET, RIGHTS_PATH_OPEN, RIGHTS_FD_READDIR, RIGHTS_PATH_READLINK, RIGHTS_PATH_RENAME_SOURCE, RIGHTS_PATH_RENAME_TARGET, RIGHTS_PATH_FILESTAT_GET, RIGHTS_PATH_FILESTAT_SET_SIZE, RIGHTS_PATH_FILESTAT_SET_TIMES, RIGHTS_FD_FILESTAT_GET, RIGHTS_FD_FILESTAT_SET_SIZE, RIGHTS_FD_FILESTAT_SET_TIMES, RIGHTS_PATH_SYMLINK, RIGHTS_PATH_REMOVE_DIRECTORY, RIGHTS_PATH_UNLINK_FILE, RIGHTS_POLL_FD_READWRITE, RIGHTS_SOCK_SHUTDOWN, Iovec, Ciovec, Dirent, Fdstat, Filestat, Subscription, Event$1, PrestatDir, Prestat;
var init_wasi_defs = __esmMin((() => {
	RIGHTS_PATH_CREATE_FILE = 1024;
	RIGHTS_PATH_LINK_SOURCE = 2048;
	RIGHTS_PATH_LINK_TARGET = 4096;
	RIGHTS_PATH_OPEN = 8192;
	RIGHTS_FD_READDIR = 16384;
	RIGHTS_PATH_READLINK = 32768;
	RIGHTS_PATH_RENAME_SOURCE = 65536;
	RIGHTS_PATH_RENAME_TARGET = 1 << 17;
	RIGHTS_PATH_FILESTAT_GET = 1 << 18;
	RIGHTS_PATH_FILESTAT_SET_SIZE = 1 << 19;
	RIGHTS_PATH_FILESTAT_SET_TIMES = 1 << 20;
	RIGHTS_FD_FILESTAT_GET = 1 << 21;
	RIGHTS_FD_FILESTAT_SET_SIZE = 1 << 22;
	RIGHTS_FD_FILESTAT_SET_TIMES = 1 << 23;
	RIGHTS_PATH_SYMLINK = 1 << 24;
	RIGHTS_PATH_REMOVE_DIRECTORY = 1 << 25;
	RIGHTS_PATH_UNLINK_FILE = 1 << 26;
	RIGHTS_POLL_FD_READWRITE = 1 << 27;
	RIGHTS_SOCK_SHUTDOWN = 1 << 28;
	Iovec = class Iovec {
		static read_bytes(view, ptr) {
			const iovec = new Iovec();
			iovec.buf = view.getUint32(ptr, true);
			iovec.buf_len = view.getUint32(ptr + 4, true);
			return iovec;
		}
		static read_bytes_array(view, ptr, len) {
			const iovecs = [];
			for (let i = 0; i < len; i++) iovecs.push(Iovec.read_bytes(view, ptr + 8 * i));
			return iovecs;
		}
	};
	Ciovec = class Ciovec {
		static read_bytes(view, ptr) {
			const iovec = new Ciovec();
			iovec.buf = view.getUint32(ptr, true);
			iovec.buf_len = view.getUint32(ptr + 4, true);
			return iovec;
		}
		static read_bytes_array(view, ptr, len) {
			const iovecs = [];
			for (let i = 0; i < len; i++) iovecs.push(Ciovec.read_bytes(view, ptr + 8 * i));
			return iovecs;
		}
	};
	Dirent = class {
		head_length() {
			return 24;
		}
		name_length() {
			return this.dir_name.byteLength;
		}
		write_head_bytes(view, ptr) {
			view.setBigUint64(ptr, this.d_next, true);
			view.setBigUint64(ptr + 8, this.d_ino, true);
			view.setUint32(ptr + 16, this.dir_name.length, true);
			view.setUint8(ptr + 20, this.d_type);
		}
		write_name_bytes(view8, ptr, buf_len) {
			view8.set(this.dir_name.slice(0, Math.min(this.dir_name.byteLength, buf_len)), ptr);
		}
		constructor(next_cookie, d_ino, name, type) {
			const encoded_name = new TextEncoder().encode(name);
			this.d_next = next_cookie;
			this.d_ino = d_ino;
			this.d_namlen = encoded_name.byteLength;
			this.d_type = type;
			this.dir_name = encoded_name;
		}
	};
	Fdstat = class {
		write_bytes(view, ptr) {
			view.setUint8(ptr, this.fs_filetype);
			view.setUint16(ptr + 2, this.fs_flags, true);
			view.setBigUint64(ptr + 8, this.fs_rights_base, true);
			view.setBigUint64(ptr + 16, this.fs_rights_inherited, true);
		}
		constructor(filetype, flags) {
			this.fs_rights_base = 0n;
			this.fs_rights_inherited = 0n;
			this.fs_filetype = filetype;
			this.fs_flags = flags;
		}
	};
	Filestat = class {
		write_bytes(view, ptr) {
			view.setBigUint64(ptr, this.dev, true);
			view.setBigUint64(ptr + 8, this.ino, true);
			view.setUint8(ptr + 16, this.filetype);
			view.setBigUint64(ptr + 24, this.nlink, true);
			view.setBigUint64(ptr + 32, this.size, true);
			view.setBigUint64(ptr + 38, this.atim, true);
			view.setBigUint64(ptr + 46, this.mtim, true);
			view.setBigUint64(ptr + 52, this.ctim, true);
		}
		constructor(ino, filetype, size) {
			this.dev = 0n;
			this.nlink = 0n;
			this.atim = 0n;
			this.mtim = 0n;
			this.ctim = 0n;
			this.ino = ino;
			this.filetype = filetype;
			this.size = size;
		}
	};
	Subscription = class Subscription {
		static read_bytes(view, ptr) {
			return new Subscription(view.getBigUint64(ptr, true), view.getUint8(ptr + 8), view.getUint32(ptr + 16, true), view.getBigUint64(ptr + 24, true), view.getUint16(ptr + 36, true));
		}
		constructor(userdata, eventtype, clockid, timeout, flags) {
			this.userdata = userdata;
			this.eventtype = eventtype;
			this.clockid = clockid;
			this.timeout = timeout;
			this.flags = flags;
		}
	};
	Event$1 = class {
		write_bytes(view, ptr) {
			view.setBigUint64(ptr, this.userdata, true);
			view.setUint16(ptr + 8, this.error, true);
			view.setUint8(ptr + 10, this.eventtype);
		}
		constructor(userdata, error, eventtype) {
			this.userdata = userdata;
			this.error = error;
			this.eventtype = eventtype;
		}
	};
	PrestatDir = class {
		write_bytes(view, ptr) {
			view.setUint32(ptr, this.pr_name.byteLength, true);
		}
		constructor(name) {
			this.pr_name = new TextEncoder().encode(name);
		}
	};
	Prestat = class Prestat {
		static dir(name) {
			const prestat = new Prestat();
			prestat.tag = 0;
			prestat.inner = new PrestatDir(name);
			return prestat;
		}
		write_bytes(view, ptr) {
			view.setUint32(ptr, this.tag, true);
			this.inner.write_bytes(view, ptr + 4);
		}
	};
}));
//#endregion
//#region browser_wasi_shim/debug.js
function createLogger(enabled, prefix) {
	if (enabled) return console.log.bind(console, "%c%s", "color: #265BA0", prefix);
	else return () => {};
}
var Debug, debug;
var init_debug = __esmMin((() => {
	Debug = class Debug {
		enable(enabled) {
			this.log = createLogger(enabled === void 0 ? true : enabled, this.prefix);
		}
		get enabled() {
			return this.isEnabled;
		}
		constructor(isEnabled) {
			this.isEnabled = isEnabled;
			this.prefix = "wasi:";
			this.enable(isEnabled);
		}
	};
	debug = new Debug(false);
}));
//#endregion
//#region browser_wasi_shim/wasi.js
var WASIProcExit, WASI;
var init_wasi = __esmMin((() => {
	init_wasi_defs();
	init_debug();
	WASIProcExit = class extends Error {
		constructor(code) {
			super("exit with exit code " + code);
			this.code = code;
		}
	};
	WASI = class WASI {
		start(instance) {
			this.inst = instance;
			try {
				instance.exports._start();
				return 0;
			} catch (e) {
				if (e instanceof WASIProcExit) return e.code;
				else throw e;
			}
		}
		initialize(instance) {
			this.inst = instance;
			if (instance.exports._initialize) instance.exports._initialize();
		}
		constructor(args, env, fds, options = {}) {
			this.args = [];
			this.env = [];
			this.fds = [];
			debug.enable(options.debug);
			this.args = args;
			this.env = env;
			this.fds = fds;
			const self = this;
			this.wasiImport = {
				args_sizes_get(argc, argv_buf_size) {
					const buffer = new DataView(self.inst.exports.memory.buffer);
					buffer.setUint32(argc, self.args.length, true);
					let buf_size = 0;
					for (const arg of self.args) buf_size += arg.length + 1;
					buffer.setUint32(argv_buf_size, buf_size, true);
					debug.log(buffer.getUint32(argc, true), buffer.getUint32(argv_buf_size, true));
					return 0;
				},
				args_get(argv, argv_buf) {
					const buffer = new DataView(self.inst.exports.memory.buffer);
					const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
					const orig_argv_buf = argv_buf;
					for (let i = 0; i < self.args.length; i++) {
						buffer.setUint32(argv, argv_buf, true);
						argv += 4;
						const arg = new TextEncoder().encode(self.args[i]);
						buffer8.set(arg, argv_buf);
						buffer.setUint8(argv_buf + arg.length, 0);
						argv_buf += arg.length + 1;
					}
					if (debug.enabled) debug.log(new TextDecoder("utf-8").decode(buffer8.slice(orig_argv_buf, argv_buf)));
					return 0;
				},
				environ_sizes_get(environ_count, environ_size) {
					const buffer = new DataView(self.inst.exports.memory.buffer);
					buffer.setUint32(environ_count, self.env.length, true);
					let buf_size = 0;
					for (const environ of self.env) buf_size += new TextEncoder().encode(environ).length + 1;
					buffer.setUint32(environ_size, buf_size, true);
					debug.log(buffer.getUint32(environ_count, true), buffer.getUint32(environ_size, true));
					return 0;
				},
				environ_get(environ, environ_buf) {
					const buffer = new DataView(self.inst.exports.memory.buffer);
					const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
					const orig_environ_buf = environ_buf;
					for (let i = 0; i < self.env.length; i++) {
						buffer.setUint32(environ, environ_buf, true);
						environ += 4;
						const e = new TextEncoder().encode(self.env[i]);
						buffer8.set(e, environ_buf);
						buffer.setUint8(environ_buf + e.length, 0);
						environ_buf += e.length + 1;
					}
					if (debug.enabled) debug.log(new TextDecoder("utf-8").decode(buffer8.slice(orig_environ_buf, environ_buf)));
					return 0;
				},
				clock_res_get(id, res_ptr) {
					let resolutionValue;
					switch (id) {
						case 1:
							resolutionValue = 5000n;
							break;
						case 0:
							resolutionValue = 1000000n;
							break;
						default: return 52;
					}
					new DataView(self.inst.exports.memory.buffer).setBigUint64(res_ptr, resolutionValue, true);
					return 0;
				},
				clock_time_get(id, precision, time) {
					const buffer = new DataView(self.inst.exports.memory.buffer);
					if (id === 0) buffer.setBigUint64(time, BigInt((/* @__PURE__ */ new Date()).getTime()) * 1000000n, true);
					else if (id == 1) {
						let monotonic_time;
						try {
							monotonic_time = BigInt(Math.round(performance.now() * 1e6));
						} catch (e) {
							monotonic_time = 0n;
						}
						buffer.setBigUint64(time, monotonic_time, true);
					} else buffer.setBigUint64(time, 0n, true);
					return 0;
				},
				fd_advise(fd, offset, len, advice) {
					if (self.fds[fd] != void 0) return 0;
					else return 8;
				},
				fd_allocate(fd, offset, len) {
					if (self.fds[fd] != void 0) return self.fds[fd].fd_allocate(offset, len);
					else return 8;
				},
				fd_close(fd) {
					if (self.fds[fd] != void 0) {
						const ret = self.fds[fd].fd_close();
						self.fds[fd] = void 0;
						return ret;
					} else return 8;
				},
				fd_datasync(fd) {
					if (self.fds[fd] != void 0) return self.fds[fd].fd_sync();
					else return 8;
				},
				fd_fdstat_get(fd, fdstat_ptr) {
					if (self.fds[fd] != void 0) {
						const { ret, fdstat } = self.fds[fd].fd_fdstat_get();
						if (fdstat != null) fdstat.write_bytes(new DataView(self.inst.exports.memory.buffer), fdstat_ptr);
						return ret;
					} else return 8;
				},
				fd_fdstat_set_flags(fd, flags) {
					if (self.fds[fd] != void 0) return self.fds[fd].fd_fdstat_set_flags(flags);
					else return 8;
				},
				fd_fdstat_set_rights(fd, fs_rights_base, fs_rights_inheriting) {
					if (self.fds[fd] != void 0) return self.fds[fd].fd_fdstat_set_rights(fs_rights_base, fs_rights_inheriting);
					else return 8;
				},
				fd_filestat_get(fd, filestat_ptr) {
					if (self.fds[fd] != void 0) {
						const { ret, filestat } = self.fds[fd].fd_filestat_get();
						if (filestat != null) filestat.write_bytes(new DataView(self.inst.exports.memory.buffer), filestat_ptr);
						return ret;
					} else return 8;
				},
				fd_filestat_set_size(fd, size) {
					if (self.fds[fd] != void 0) return self.fds[fd].fd_filestat_set_size(size);
					else return 8;
				},
				fd_filestat_set_times(fd, atim, mtim, fst_flags) {
					if (self.fds[fd] != void 0) return self.fds[fd].fd_filestat_set_times(atim, mtim, fst_flags);
					else return 8;
				},
				fd_pread(fd, iovs_ptr, iovs_len, offset, nread_ptr) {
					const buffer = new DataView(self.inst.exports.memory.buffer);
					const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
					if (self.fds[fd] != void 0) {
						const iovecs = Iovec.read_bytes_array(buffer, iovs_ptr, iovs_len);
						let nread = 0;
						for (const iovec of iovecs) {
							const { ret, data } = self.fds[fd].fd_pread(iovec.buf_len, offset);
							if (ret != 0) {
								buffer.setUint32(nread_ptr, nread, true);
								return ret;
							}
							buffer8.set(data, iovec.buf);
							nread += data.length;
							offset += BigInt(data.length);
							if (data.length != iovec.buf_len) break;
						}
						buffer.setUint32(nread_ptr, nread, true);
						return 0;
					} else return 8;
				},
				fd_prestat_get(fd, buf_ptr) {
					const buffer = new DataView(self.inst.exports.memory.buffer);
					if (self.fds[fd] != void 0) {
						const { ret, prestat } = self.fds[fd].fd_prestat_get();
						if (prestat != null) prestat.write_bytes(buffer, buf_ptr);
						return ret;
					} else return 8;
				},
				fd_prestat_dir_name(fd, path_ptr, path_len) {
					if (self.fds[fd] != void 0) {
						const { ret, prestat } = self.fds[fd].fd_prestat_get();
						if (prestat == null) return ret;
						const prestat_dir_name = prestat.inner.pr_name;
						new Uint8Array(self.inst.exports.memory.buffer).set(prestat_dir_name.slice(0, path_len), path_ptr);
						return prestat_dir_name.byteLength > path_len ? 37 : 0;
					} else return 8;
				},
				fd_pwrite(fd, iovs_ptr, iovs_len, offset, nwritten_ptr) {
					const buffer = new DataView(self.inst.exports.memory.buffer);
					const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
					if (self.fds[fd] != void 0) {
						const iovecs = Ciovec.read_bytes_array(buffer, iovs_ptr, iovs_len);
						let nwritten = 0;
						for (const iovec of iovecs) {
							const data = buffer8.slice(iovec.buf, iovec.buf + iovec.buf_len);
							const { ret, nwritten: nwritten_part } = self.fds[fd].fd_pwrite(data, offset);
							if (ret != 0) {
								buffer.setUint32(nwritten_ptr, nwritten, true);
								return ret;
							}
							nwritten += nwritten_part;
							offset += BigInt(nwritten_part);
							if (nwritten_part != data.byteLength) break;
						}
						buffer.setUint32(nwritten_ptr, nwritten, true);
						return 0;
					} else return 8;
				},
				fd_read(fd, iovs_ptr, iovs_len, nread_ptr) {
					const buffer = new DataView(self.inst.exports.memory.buffer);
					const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
					if (self.fds[fd] != void 0) {
						const iovecs = Iovec.read_bytes_array(buffer, iovs_ptr, iovs_len);
						let nread = 0;
						for (const iovec of iovecs) {
							const { ret, data } = self.fds[fd].fd_read(iovec.buf_len);
							if (ret != 0) {
								buffer.setUint32(nread_ptr, nread, true);
								return ret;
							}
							buffer8.set(data, iovec.buf);
							nread += data.length;
							if (data.length != iovec.buf_len) break;
						}
						buffer.setUint32(nread_ptr, nread, true);
						return 0;
					} else return 8;
				},
				fd_readdir(fd, buf, buf_len, cookie, bufused_ptr) {
					const buffer = new DataView(self.inst.exports.memory.buffer);
					const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
					if (self.fds[fd] != void 0) {
						let bufused = 0;
						while (true) {
							const { ret, dirent } = self.fds[fd].fd_readdir_single(cookie);
							if (ret != 0) {
								buffer.setUint32(bufused_ptr, bufused, true);
								return ret;
							}
							if (dirent == null) break;
							if (buf_len - bufused < dirent.head_length()) {
								bufused = buf_len;
								break;
							}
							const head_bytes = new ArrayBuffer(dirent.head_length());
							dirent.write_head_bytes(new DataView(head_bytes), 0);
							buffer8.set(new Uint8Array(head_bytes).slice(0, Math.min(head_bytes.byteLength, buf_len - bufused)), buf);
							buf += dirent.head_length();
							bufused += dirent.head_length();
							if (buf_len - bufused < dirent.name_length()) {
								bufused = buf_len;
								break;
							}
							dirent.write_name_bytes(buffer8, buf, buf_len - bufused);
							buf += dirent.name_length();
							bufused += dirent.name_length();
							cookie = dirent.d_next;
						}
						buffer.setUint32(bufused_ptr, bufused, true);
						return 0;
					} else return 8;
				},
				fd_renumber(fd, to) {
					if (self.fds[fd] != void 0 && self.fds[to] != void 0) {
						const ret = self.fds[to].fd_close();
						if (ret != 0) return ret;
						self.fds[to] = self.fds[fd];
						self.fds[fd] = void 0;
						return 0;
					} else return 8;
				},
				fd_seek(fd, offset, whence, offset_out_ptr) {
					const buffer = new DataView(self.inst.exports.memory.buffer);
					if (self.fds[fd] != void 0) {
						const { ret, offset: offset_out } = self.fds[fd].fd_seek(offset, whence);
						buffer.setBigInt64(offset_out_ptr, offset_out, true);
						return ret;
					} else return 8;
				},
				fd_sync(fd) {
					if (self.fds[fd] != void 0) return self.fds[fd].fd_sync();
					else return 8;
				},
				fd_tell(fd, offset_ptr) {
					const buffer = new DataView(self.inst.exports.memory.buffer);
					if (self.fds[fd] != void 0) {
						const { ret, offset } = self.fds[fd].fd_tell();
						buffer.setBigUint64(offset_ptr, offset, true);
						return ret;
					} else return 8;
				},
				fd_write(fd, iovs_ptr, iovs_len, nwritten_ptr) {
					const buffer = new DataView(self.inst.exports.memory.buffer);
					const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
					if (self.fds[fd] != void 0) {
						const iovecs = Ciovec.read_bytes_array(buffer, iovs_ptr, iovs_len);
						let nwritten = 0;
						for (const iovec of iovecs) {
							const data = buffer8.slice(iovec.buf, iovec.buf + iovec.buf_len);
							const { ret, nwritten: nwritten_part } = self.fds[fd].fd_write(data);
							if (ret != 0) {
								buffer.setUint32(nwritten_ptr, nwritten, true);
								return ret;
							}
							nwritten += nwritten_part;
							if (nwritten_part != data.byteLength) break;
						}
						buffer.setUint32(nwritten_ptr, nwritten, true);
						return 0;
					} else return 8;
				},
				path_create_directory(fd, path_ptr, path_len) {
					const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
					if (self.fds[fd] != void 0) {
						const path = new TextDecoder("utf-8").decode(buffer8.slice(path_ptr, path_ptr + path_len));
						return self.fds[fd].path_create_directory(path);
					} else return 8;
				},
				path_filestat_get(fd, flags, path_ptr, path_len, filestat_ptr) {
					const buffer = new DataView(self.inst.exports.memory.buffer);
					const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
					if (self.fds[fd] != void 0) {
						const path = new TextDecoder("utf-8").decode(buffer8.slice(path_ptr, path_ptr + path_len));
						const { ret, filestat } = self.fds[fd].path_filestat_get(flags, path);
						if (filestat != null) filestat.write_bytes(buffer, filestat_ptr);
						return ret;
					} else return 8;
				},
				path_filestat_set_times(fd, flags, path_ptr, path_len, atim, mtim, fst_flags) {
					const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
					if (self.fds[fd] != void 0) {
						const path = new TextDecoder("utf-8").decode(buffer8.slice(path_ptr, path_ptr + path_len));
						return self.fds[fd].path_filestat_set_times(flags, path, atim, mtim, fst_flags);
					} else return 8;
				},
				path_link(old_fd, old_flags, old_path_ptr, old_path_len, new_fd, new_path_ptr, new_path_len) {
					const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
					if (self.fds[old_fd] != void 0 && self.fds[new_fd] != void 0) {
						const old_path = new TextDecoder("utf-8").decode(buffer8.slice(old_path_ptr, old_path_ptr + old_path_len));
						const new_path = new TextDecoder("utf-8").decode(buffer8.slice(new_path_ptr, new_path_ptr + new_path_len));
						const { ret, inode_obj } = self.fds[old_fd].path_lookup(old_path, old_flags);
						if (inode_obj == null) return ret;
						return self.fds[new_fd].path_link(new_path, inode_obj, false);
					} else return 8;
				},
				path_open(fd, dirflags, path_ptr, path_len, oflags, fs_rights_base, fs_rights_inheriting, fd_flags, opened_fd_ptr) {
					const buffer = new DataView(self.inst.exports.memory.buffer);
					const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
					if (self.fds[fd] != void 0) {
						const path = new TextDecoder("utf-8").decode(buffer8.slice(path_ptr, path_ptr + path_len));
						debug.log(path);
						const { ret, fd_obj } = self.fds[fd].path_open(dirflags, path, oflags, fs_rights_base, fs_rights_inheriting, fd_flags);
						if (ret != 0) return ret;
						self.fds.push(fd_obj);
						const opened_fd = self.fds.length - 1;
						buffer.setUint32(opened_fd_ptr, opened_fd, true);
						return 0;
					} else return 8;
				},
				path_readlink(fd, path_ptr, path_len, buf_ptr, buf_len, nread_ptr) {
					const buffer = new DataView(self.inst.exports.memory.buffer);
					const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
					if (self.fds[fd] != void 0) {
						const path = new TextDecoder("utf-8").decode(buffer8.slice(path_ptr, path_ptr + path_len));
						debug.log(path);
						const { ret, data } = self.fds[fd].path_readlink(path);
						if (data != null) {
							const data_buf = new TextEncoder().encode(data);
							if (data_buf.length > buf_len) {
								buffer.setUint32(nread_ptr, 0, true);
								return 8;
							}
							buffer8.set(data_buf, buf_ptr);
							buffer.setUint32(nread_ptr, data_buf.length, true);
						}
						return ret;
					} else return 8;
				},
				path_remove_directory(fd, path_ptr, path_len) {
					const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
					if (self.fds[fd] != void 0) {
						const path = new TextDecoder("utf-8").decode(buffer8.slice(path_ptr, path_ptr + path_len));
						return self.fds[fd].path_remove_directory(path);
					} else return 8;
				},
				path_rename(fd, old_path_ptr, old_path_len, new_fd, new_path_ptr, new_path_len) {
					const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
					if (self.fds[fd] != void 0 && self.fds[new_fd] != void 0) {
						const old_path = new TextDecoder("utf-8").decode(buffer8.slice(old_path_ptr, old_path_ptr + old_path_len));
						const new_path = new TextDecoder("utf-8").decode(buffer8.slice(new_path_ptr, new_path_ptr + new_path_len));
						let { ret, inode_obj } = self.fds[fd].path_unlink(old_path);
						if (inode_obj == null) return ret;
						ret = self.fds[new_fd].path_link(new_path, inode_obj, true);
						if (ret != 0) {
							if (self.fds[fd].path_link(old_path, inode_obj, true) != 0) throw "path_link should always return success when relinking an inode back to the original place";
						}
						return ret;
					} else return 8;
				},
				path_symlink(old_path_ptr, old_path_len, fd, new_path_ptr, new_path_len) {
					const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
					if (self.fds[fd] != void 0) {
						new TextDecoder("utf-8").decode(buffer8.slice(old_path_ptr, old_path_ptr + old_path_len));
						new TextDecoder("utf-8").decode(buffer8.slice(new_path_ptr, new_path_ptr + new_path_len));
						return 58;
					} else return 8;
				},
				path_unlink_file(fd, path_ptr, path_len) {
					const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
					if (self.fds[fd] != void 0) {
						const path = new TextDecoder("utf-8").decode(buffer8.slice(path_ptr, path_ptr + path_len));
						return self.fds[fd].path_unlink_file(path);
					} else return 8;
				},
				poll_oneoff(in_ptr, out_ptr, nsubscriptions) {
					if (nsubscriptions === 0) return 28;
					if (nsubscriptions > 1) {
						debug.log("poll_oneoff: only a single subscription is supported");
						return 58;
					}
					const buffer = new DataView(self.inst.exports.memory.buffer);
					const s = Subscription.read_bytes(buffer, in_ptr);
					const eventtype = s.eventtype;
					const clockid = s.clockid;
					const timeout = s.timeout;
					if (eventtype !== 0) {
						debug.log("poll_oneoff: only clock subscriptions are supported");
						return 58;
					}
					let getNow = void 0;
					if (clockid === 1) getNow = () => BigInt(Math.round(performance.now() * 1e6));
					else if (clockid === 0) getNow = () => BigInt((/* @__PURE__ */ new Date()).getTime()) * 1000000n;
					else return 28;
					const endTime = (s.flags & 1) !== 0 ? timeout : getNow() + timeout;
					while (endTime > getNow());
					new Event$1(s.userdata, 0, eventtype).write_bytes(buffer, out_ptr);
					return 0;
				},
				proc_exit(exit_code) {
					throw new WASIProcExit(exit_code);
				},
				proc_raise(sig) {
					throw "raised signal " + sig;
				},
				sched_yield() {},
				random_get(buf, buf_len) {
					const buffer8 = new Uint8Array(self.inst.exports.memory.buffer).subarray(buf, buf + buf_len);
					if ("crypto" in globalThis && (typeof SharedArrayBuffer === "undefined" || !(self.inst.exports.memory.buffer instanceof SharedArrayBuffer))) for (let i = 0; i < buf_len; i += 65536) crypto.getRandomValues(buffer8.subarray(i, i + 65536));
					else for (let i = 0; i < buf_len; i++) buffer8[i] = Math.random() * 256 | 0;
				},
				sock_recv(fd, ri_data, ri_flags) {
					throw "sockets not supported";
				},
				sock_send(fd, si_data, si_flags) {
					throw "sockets not supported";
				},
				sock_shutdown(fd, how) {
					throw "sockets not supported";
				},
				sock_accept(fd, flags) {
					throw "sockets not supported";
				}
			};
		}
	};
}));
//#endregion
//#region browser_wasi_shim/fd.js
var Fd, Inode;
var init_fd = __esmMin((() => {
	init_wasi_defs();
	Fd = class {
		fd_allocate(offset, len) {
			return 58;
		}
		fd_close() {
			return 0;
		}
		fd_fdstat_get() {
			return {
				ret: 58,
				fdstat: null
			};
		}
		fd_fdstat_set_flags(flags) {
			return 58;
		}
		fd_fdstat_set_rights(fs_rights_base, fs_rights_inheriting) {
			return 58;
		}
		fd_filestat_get() {
			return {
				ret: 58,
				filestat: null
			};
		}
		fd_filestat_set_size(size) {
			return 58;
		}
		fd_filestat_set_times(atim, mtim, fst_flags) {
			return 58;
		}
		fd_pread(size, offset) {
			return {
				ret: 58,
				data: new Uint8Array()
			};
		}
		fd_prestat_get() {
			return {
				ret: 58,
				prestat: null
			};
		}
		fd_pwrite(data, offset) {
			return {
				ret: 58,
				nwritten: 0
			};
		}
		fd_read(size) {
			return {
				ret: 58,
				data: new Uint8Array()
			};
		}
		fd_readdir_single(cookie) {
			return {
				ret: 58,
				dirent: null
			};
		}
		fd_seek(offset, whence) {
			return {
				ret: 58,
				offset: 0n
			};
		}
		fd_sync() {
			return 0;
		}
		fd_tell() {
			return {
				ret: 58,
				offset: 0n
			};
		}
		fd_write(data) {
			return {
				ret: 58,
				nwritten: 0
			};
		}
		path_create_directory(path) {
			return 58;
		}
		path_filestat_get(flags, path) {
			return {
				ret: 58,
				filestat: null
			};
		}
		path_filestat_set_times(flags, path, atim, mtim, fst_flags) {
			return 58;
		}
		path_link(path, inode, allow_dir) {
			return 58;
		}
		path_unlink(path) {
			return {
				ret: 58,
				inode_obj: null
			};
		}
		path_lookup(path, dirflags) {
			return {
				ret: 58,
				inode_obj: null
			};
		}
		path_open(dirflags, path, oflags, fs_rights_base, fs_rights_inheriting, fd_flags) {
			return {
				ret: 54,
				fd_obj: null
			};
		}
		path_readlink(path) {
			return {
				ret: 58,
				data: null
			};
		}
		path_remove_directory(path) {
			return 58;
		}
		path_rename(old_path, new_fd, new_path) {
			return 58;
		}
		path_unlink_file(path) {
			return 58;
		}
	};
	Inode = class Inode {
		static issue_ino() {
			return Inode.next_ino++;
		}
		static root_ino() {
			return 0n;
		}
		constructor() {
			this.ino = Inode.issue_ino();
		}
	};
	Inode.next_ino = 1n;
}));
//#endregion
//#region browser_wasi_shim/fs_mem.js
var OpenFile, OpenDirectory, PreopenDirectory, File, Path, Directory, ConsoleStdout;
var init_fs_mem = __esmMin((() => {
	init_debug();
	init_wasi_defs();
	init_fd();
	OpenFile = class extends Fd {
		fd_allocate(offset, len) {
			if (this.file.size > offset + len) {} else {
				const new_data = new Uint8Array(Number(offset + len));
				new_data.set(this.file.data, 0);
				this.file.data = new_data;
			}
			return 0;
		}
		fd_fdstat_get() {
			return {
				ret: 0,
				fdstat: new Fdstat(4, 0)
			};
		}
		fd_filestat_set_size(size) {
			if (this.file.size > size) this.file.data = new Uint8Array(this.file.data.buffer.slice(0, Number(size)));
			else {
				const new_data = new Uint8Array(Number(size));
				new_data.set(this.file.data, 0);
				this.file.data = new_data;
			}
			return 0;
		}
		fd_read(size) {
			const slice = this.file.data.slice(Number(this.file_pos), Number(this.file_pos + BigInt(size)));
			this.file_pos += BigInt(slice.length);
			return {
				ret: 0,
				data: slice
			};
		}
		fd_pread(size, offset) {
			return {
				ret: 0,
				data: this.file.data.slice(Number(offset), Number(offset + BigInt(size)))
			};
		}
		fd_seek(offset, whence) {
			let calculated_offset;
			switch (whence) {
				case 0:
					calculated_offset = offset;
					break;
				case 1:
					calculated_offset = this.file_pos + offset;
					break;
				case 2:
					calculated_offset = BigInt(this.file.data.byteLength) + offset;
					break;
				default: return {
					ret: 28,
					offset: 0n
				};
			}
			if (calculated_offset < 0) return {
				ret: 28,
				offset: 0n
			};
			this.file_pos = calculated_offset;
			return {
				ret: 0,
				offset: this.file_pos
			};
		}
		fd_tell() {
			return {
				ret: 0,
				offset: this.file_pos
			};
		}
		fd_write(data) {
			if (this.file.readonly) return {
				ret: 8,
				nwritten: 0
			};
			if (this.file_pos + BigInt(data.byteLength) > this.file.size) {
				const old = this.file.data;
				this.file.data = new Uint8Array(Number(this.file_pos + BigInt(data.byteLength)));
				this.file.data.set(old);
			}
			this.file.data.set(data, Number(this.file_pos));
			this.file_pos += BigInt(data.byteLength);
			return {
				ret: 0,
				nwritten: data.byteLength
			};
		}
		fd_pwrite(data, offset) {
			if (this.file.readonly) return {
				ret: 8,
				nwritten: 0
			};
			if (offset + BigInt(data.byteLength) > this.file.size) {
				const old = this.file.data;
				this.file.data = new Uint8Array(Number(offset + BigInt(data.byteLength)));
				this.file.data.set(old);
			}
			this.file.data.set(data, Number(offset));
			return {
				ret: 0,
				nwritten: data.byteLength
			};
		}
		fd_filestat_get() {
			return {
				ret: 0,
				filestat: this.file.stat()
			};
		}
		constructor(file) {
			super();
			this.file_pos = 0n;
			this.file = file;
		}
	};
	OpenDirectory = class extends Fd {
		fd_seek(offset, whence) {
			return {
				ret: 8,
				offset: 0n
			};
		}
		fd_tell() {
			return {
				ret: 8,
				offset: 0n
			};
		}
		fd_allocate(offset, len) {
			return 8;
		}
		fd_fdstat_get() {
			return {
				ret: 0,
				fdstat: new Fdstat(3, 0)
			};
		}
		fd_readdir_single(cookie) {
			if (debug.enabled) {
				debug.log("readdir_single", cookie);
				debug.log(cookie, this.dir.contents.keys());
			}
			if (cookie == 0n) return {
				ret: 0,
				dirent: new Dirent(1n, this.dir.ino, ".", 3)
			};
			else if (cookie == 1n) return {
				ret: 0,
				dirent: new Dirent(2n, this.dir.parent_ino(), "..", 3)
			};
			if (cookie >= BigInt(this.dir.contents.size) + 2n) return {
				ret: 0,
				dirent: null
			};
			const [name, entry] = Array.from(this.dir.contents.entries())[Number(cookie - 2n)];
			return {
				ret: 0,
				dirent: new Dirent(cookie + 1n, entry.ino, name, entry.stat().filetype)
			};
		}
		path_filestat_get(flags, path_str) {
			const { ret: path_err, path } = Path.from(path_str);
			if (path == null) return {
				ret: path_err,
				filestat: null
			};
			const { ret, entry } = this.dir.get_entry_for_path(path);
			if (entry == null) return {
				ret,
				filestat: null
			};
			return {
				ret: 0,
				filestat: entry.stat()
			};
		}
		path_lookup(path_str, dirflags) {
			const { ret: path_ret, path } = Path.from(path_str);
			if (path == null) return {
				ret: path_ret,
				inode_obj: null
			};
			const { ret, entry } = this.dir.get_entry_for_path(path);
			if (entry == null) return {
				ret,
				inode_obj: null
			};
			return {
				ret: 0,
				inode_obj: entry
			};
		}
		path_open(dirflags, path_str, oflags, fs_rights_base, fs_rights_inheriting, fd_flags) {
			const { ret: path_ret, path } = Path.from(path_str);
			if (path == null) return {
				ret: path_ret,
				fd_obj: null
			};
			let { ret, entry } = this.dir.get_entry_for_path(path);
			if (entry == null) {
				if (ret != 44) return {
					ret,
					fd_obj: null
				};
				if ((oflags & 1) == 1) {
					const { ret, entry: new_entry } = this.dir.create_entry_for_path(path_str, (oflags & 2) == 2);
					if (new_entry == null) return {
						ret,
						fd_obj: null
					};
					entry = new_entry;
				} else return {
					ret: 44,
					fd_obj: null
				};
			} else if ((oflags & 4) == 4) return {
				ret: 20,
				fd_obj: null
			};
			if ((oflags & 2) == 2 && entry.stat().filetype !== 3) return {
				ret: 54,
				fd_obj: null
			};
			return entry.path_open(oflags, fs_rights_base, fd_flags);
		}
		path_create_directory(path) {
			return this.path_open(0, path, 3, 0n, 0n, 0).ret;
		}
		path_link(path_str, inode, allow_dir) {
			const { ret: path_ret, path } = Path.from(path_str);
			if (path == null) return path_ret;
			if (path.is_dir) return 44;
			const { ret: parent_ret, parent_entry, filename, entry } = this.dir.get_parent_dir_and_entry_for_path(path, true);
			if (parent_entry == null || filename == null) return parent_ret;
			if (entry != null) {
				const source_is_dir = inode.stat().filetype == 3;
				const target_is_dir = entry.stat().filetype == 3;
				if (source_is_dir && target_is_dir) if (allow_dir && entry instanceof Directory) if (entry.contents.size == 0) {} else return 55;
				else return 20;
				else if (source_is_dir && !target_is_dir) return 54;
				else if (!source_is_dir && target_is_dir) return 31;
				else if (inode.stat().filetype == 4 && entry.stat().filetype == 4) {} else return 20;
			}
			if (!allow_dir && inode.stat().filetype == 3) return 63;
			parent_entry.contents.set(filename, inode);
			return 0;
		}
		path_unlink(path_str) {
			const { ret: path_ret, path } = Path.from(path_str);
			if (path == null) return {
				ret: path_ret,
				inode_obj: null
			};
			const { ret: parent_ret, parent_entry, filename, entry } = this.dir.get_parent_dir_and_entry_for_path(path, true);
			if (parent_entry == null || filename == null) return {
				ret: parent_ret,
				inode_obj: null
			};
			if (entry == null) return {
				ret: 44,
				inode_obj: null
			};
			parent_entry.contents.delete(filename);
			return {
				ret: 0,
				inode_obj: entry
			};
		}
		path_unlink_file(path_str) {
			const { ret: path_ret, path } = Path.from(path_str);
			if (path == null) return path_ret;
			const { ret: parent_ret, parent_entry, filename, entry } = this.dir.get_parent_dir_and_entry_for_path(path, false);
			if (parent_entry == null || filename == null || entry == null) return parent_ret;
			if (entry.stat().filetype === 3) return 31;
			parent_entry.contents.delete(filename);
			return 0;
		}
		path_remove_directory(path_str) {
			const { ret: path_ret, path } = Path.from(path_str);
			if (path == null) return path_ret;
			const { ret: parent_ret, parent_entry, filename, entry } = this.dir.get_parent_dir_and_entry_for_path(path, false);
			if (parent_entry == null || filename == null || entry == null) return parent_ret;
			if (!(entry instanceof Directory) || entry.stat().filetype !== 3) return 54;
			if (entry.contents.size !== 0) return 55;
			if (!parent_entry.contents.delete(filename)) return 44;
			return 0;
		}
		fd_filestat_get() {
			return {
				ret: 0,
				filestat: this.dir.stat()
			};
		}
		fd_filestat_set_size(size) {
			return 8;
		}
		fd_read(size) {
			return {
				ret: 8,
				data: new Uint8Array()
			};
		}
		fd_pread(size, offset) {
			return {
				ret: 8,
				data: new Uint8Array()
			};
		}
		fd_write(data) {
			return {
				ret: 8,
				nwritten: 0
			};
		}
		fd_pwrite(data, offset) {
			return {
				ret: 8,
				nwritten: 0
			};
		}
		constructor(dir) {
			super();
			this.dir = dir;
		}
	};
	PreopenDirectory = class extends OpenDirectory {
		fd_prestat_get() {
			return {
				ret: 0,
				prestat: Prestat.dir(this.prestat_name)
			};
		}
		constructor(name, contents) {
			super(new Directory(contents));
			this.prestat_name = name;
		}
	};
	File = class extends Inode {
		path_open(oflags, fs_rights_base, fd_flags) {
			if (this.readonly && (fs_rights_base & BigInt(64)) == BigInt(64)) return {
				ret: 63,
				fd_obj: null
			};
			if ((oflags & 8) == 8) {
				if (this.readonly) return {
					ret: 63,
					fd_obj: null
				};
				this.data = new Uint8Array([]);
			}
			const file = new OpenFile(this);
			if (fd_flags & 1) file.fd_seek(0n, 2);
			return {
				ret: 0,
				fd_obj: file
			};
		}
		get size() {
			return BigInt(this.data.byteLength);
		}
		stat() {
			return new Filestat(this.ino, 4, this.size);
		}
		constructor(data, options) {
			super();
			this.data = new Uint8Array(data);
			this.readonly = !!options?.readonly;
		}
	};
	Path = class Path {
		static from(path) {
			const self = new Path();
			self.is_dir = path.endsWith("/");
			if (path.startsWith("/")) return {
				ret: 76,
				path: null
			};
			if (path.includes("\0")) return {
				ret: 28,
				path: null
			};
			for (const component of path.split("/")) {
				if (component === "" || component === ".") continue;
				if (component === "..") {
					if (self.parts.pop() == void 0) return {
						ret: 76,
						path: null
					};
					continue;
				}
				self.parts.push(component);
			}
			return {
				ret: 0,
				path: self
			};
		}
		to_path_string() {
			let s = this.parts.join("/");
			if (this.is_dir) s += "/";
			return s;
		}
		constructor() {
			this.parts = [];
			this.is_dir = false;
		}
	};
	Directory = class Directory extends Inode {
		parent_ino() {
			if (this.parent == null) return Inode.root_ino();
			return this.parent.ino;
		}
		path_open(oflags, fs_rights_base, fd_flags) {
			return {
				ret: 0,
				fd_obj: new OpenDirectory(this)
			};
		}
		stat() {
			return new Filestat(this.ino, 3, 0n);
		}
		get_entry_for_path(path) {
			let entry = this;
			for (const component of path.parts) {
				if (!(entry instanceof Directory)) return {
					ret: 54,
					entry: null
				};
				const child = entry.contents.get(component);
				if (child !== void 0) entry = child;
				else {
					debug.log(component);
					return {
						ret: 44,
						entry: null
					};
				}
			}
			if (path.is_dir) {
				if (entry.stat().filetype != 3) return {
					ret: 54,
					entry: null
				};
			}
			return {
				ret: 0,
				entry
			};
		}
		get_parent_dir_and_entry_for_path(path, allow_undefined) {
			const filename = path.parts.pop();
			if (filename === void 0) return {
				ret: 28,
				parent_entry: null,
				filename: null,
				entry: null
			};
			const { ret: entry_ret, entry: parent_entry } = this.get_entry_for_path(path);
			if (parent_entry == null) return {
				ret: entry_ret,
				parent_entry: null,
				filename: null,
				entry: null
			};
			if (!(parent_entry instanceof Directory)) return {
				ret: 54,
				parent_entry: null,
				filename: null,
				entry: null
			};
			const entry = parent_entry.contents.get(filename);
			if (entry === void 0) if (!allow_undefined) return {
				ret: 44,
				parent_entry: null,
				filename: null,
				entry: null
			};
			else return {
				ret: 0,
				parent_entry,
				filename,
				entry: null
			};
			if (path.is_dir) {
				if (entry.stat().filetype != 3) return {
					ret: 54,
					parent_entry: null,
					filename: null,
					entry: null
				};
			}
			return {
				ret: 0,
				parent_entry,
				filename,
				entry
			};
		}
		create_entry_for_path(path_str, is_dir) {
			const { ret: path_ret, path } = Path.from(path_str);
			if (path == null) return {
				ret: path_ret,
				entry: null
			};
			let { ret: parent_ret, parent_entry, filename, entry } = this.get_parent_dir_and_entry_for_path(path, true);
			if (parent_entry == null || filename == null) return {
				ret: parent_ret,
				entry: null
			};
			if (entry != null) return {
				ret: 20,
				entry: null
			};
			debug.log("create", path);
			let new_child;
			if (!is_dir) new_child = new File(/* @__PURE__ */ new ArrayBuffer(0));
			else new_child = new Directory(/* @__PURE__ */ new Map());
			parent_entry.contents.set(filename, new_child);
			entry = new_child;
			return {
				ret: 0,
				entry
			};
		}
		constructor(contents) {
			super();
			this.parent = null;
			if (contents instanceof Array) this.contents = new Map(contents);
			else this.contents = contents;
			for (const entry of this.contents.values()) if (entry instanceof Directory) entry.parent = this;
		}
	};
	ConsoleStdout = class ConsoleStdout extends Fd {
		fd_filestat_get() {
			return {
				ret: 0,
				filestat: new Filestat(this.ino, 2, BigInt(0))
			};
		}
		fd_fdstat_get() {
			const fdstat = new Fdstat(2, 0);
			fdstat.fs_rights_base = BigInt(64);
			return {
				ret: 0,
				fdstat
			};
		}
		fd_write(data) {
			this.write(data);
			return {
				ret: 0,
				nwritten: data.byteLength
			};
		}
		static lineBuffered(write) {
			const dec = new TextDecoder("utf-8", { fatal: false });
			let line_buf = "";
			return new ConsoleStdout((buffer) => {
				line_buf += dec.decode(buffer, { stream: true });
				const lines = line_buf.split("\n");
				for (const [i, line] of lines.entries()) if (i < lines.length - 1) write(line);
				else line_buf = line;
			});
		}
		constructor(write) {
			super();
			this.ino = Inode.issue_ino();
			this.write = write;
		}
	};
}));
//#endregion
//#region browser_wasi_shim/fs_opfs.js
var SyncOPFSFile, OpenSyncOPFSFile;
var init_fs_opfs = __esmMin((() => {
	init_wasi_defs();
	init_fd();
	SyncOPFSFile = class extends Inode {
		path_open(oflags, fs_rights_base, fd_flags) {
			if (this.readonly && (fs_rights_base & BigInt(64)) == BigInt(64)) return {
				ret: 63,
				fd_obj: null
			};
			if ((oflags & 8) == 8) {
				if (this.readonly) return {
					ret: 63,
					fd_obj: null
				};
				this.handle.truncate(0);
			}
			const file = new OpenSyncOPFSFile(this);
			if (fd_flags & 1) file.fd_seek(0n, 2);
			return {
				ret: 0,
				fd_obj: file
			};
		}
		get size() {
			return BigInt(this.handle.getSize());
		}
		stat() {
			return new Filestat(this.ino, 4, this.size);
		}
		constructor(handle, options) {
			super();
			this.handle = handle;
			this.readonly = !!options?.readonly;
		}
	};
	OpenSyncOPFSFile = class extends Fd {
		fd_allocate(offset, len) {
			if (BigInt(this.file.handle.getSize()) > offset + len) {} else this.file.handle.truncate(Number(offset + len));
			return 0;
		}
		fd_fdstat_get() {
			return {
				ret: 0,
				fdstat: new Fdstat(4, 0)
			};
		}
		fd_filestat_get() {
			return {
				ret: 0,
				filestat: new Filestat(this.ino, 4, BigInt(this.file.handle.getSize()))
			};
		}
		fd_filestat_set_size(size) {
			this.file.handle.truncate(Number(size));
			return 0;
		}
		fd_read(size) {
			const buf = new Uint8Array(size);
			const n = this.file.handle.read(buf, { at: Number(this.position) });
			this.position += BigInt(n);
			return {
				ret: 0,
				data: buf.slice(0, n)
			};
		}
		fd_seek(offset, whence) {
			let calculated_offset;
			switch (whence) {
				case 0:
					calculated_offset = BigInt(offset);
					break;
				case 1:
					calculated_offset = this.position + BigInt(offset);
					break;
				case 2:
					calculated_offset = BigInt(this.file.handle.getSize()) + BigInt(offset);
					break;
				default: return {
					ret: 28,
					offset: 0n
				};
			}
			if (calculated_offset < 0) return {
				ret: 28,
				offset: 0n
			};
			this.position = calculated_offset;
			return {
				ret: 0,
				offset: this.position
			};
		}
		fd_write(data) {
			if (this.file.readonly) return {
				ret: 8,
				nwritten: 0
			};
			const n = this.file.handle.write(data, { at: Number(this.position) });
			this.position += BigInt(n);
			return {
				ret: 0,
				nwritten: n
			};
		}
		fd_sync() {
			this.file.handle.flush();
			return 0;
		}
		constructor(file) {
			super();
			this.position = 0n;
			this.file = file;
			this.ino = Inode.issue_ino();
		}
	};
}));
//#endregion
//#region browser_wasi_shim/strace.js
function strace(imports, no_trace) {
	return new Proxy(imports, { get(target, prop, receiver) {
		const f = Reflect.get(target, prop, receiver);
		if (no_trace.includes(prop)) return f;
		return function(...args) {
			console.log(prop, "(", ...args, ")");
			const result = Reflect.apply(f, receiver, args);
			console.log(" =", result);
			return result;
		};
	} });
}
var init_strace = __esmMin((() => {}));
//#endregion
//#region browser_wasi_shim/index.js
var browser_wasi_shim_exports = /* @__PURE__ */ __exportAll({
	ConsoleStdout: () => ConsoleStdout,
	Directory: () => Directory,
	Fd: () => Fd,
	File: () => File,
	Inode: () => Inode,
	OpenDirectory: () => OpenDirectory,
	OpenFile: () => OpenFile,
	OpenSyncOPFSFile: () => OpenSyncOPFSFile,
	PreopenDirectory: () => PreopenDirectory,
	SyncOPFSFile: () => SyncOPFSFile,
	WASI: () => WASI,
	WASIProcExit: () => WASIProcExit,
	strace: () => strace,
	wasi: () => wasi_defs_exports
});
var init_browser_wasi_shim = __esmMin((() => {
	init_wasi();
	init_fd();
	init_fs_mem();
	init_fs_opfs();
	init_strace();
	init_wasi_defs();
}));
//#endregion
//#region dyld.mjs
function makeBufferConsumer(buf) {
	return (len) => {
		if (len > buf.length) throw new Error("not enough bytes");
		const r = buf.subarray(0, len);
		buf = buf.subarray(len);
		return r;
	};
}
function makeStreamConsumer(reader) {
	let buf = new Uint8Array();
	return async (len) => {
		while (buf.length < len) {
			const { done, value } = await reader.read();
			if (done) throw new Error("not enough bytes");
			if (buf.length === 0) {
				buf = value;
				continue;
			}
			const tmp = new Uint8Array(buf.length + value.length);
			tmp.set(buf, 0);
			tmp.set(value, buf.length);
			buf = tmp;
		}
		const r = buf.subarray(0, len);
		buf = buf.subarray(len);
		return r;
	};
}
var Parser = class {
	#cb;
	#consumed = 0;
	#limit;
	constructor(cb, limit) {
		this.#cb = cb;
		this.#limit = limit;
	}
	eof() {
		return this.#consumed >= this.#limit;
	}
	async skip(len) {
		await this.#cb(len);
		this.#consumed += len;
	}
	async readUInt8() {
		const r = (await this.#cb(1))[0];
		this.#consumed += 1;
		return r;
	}
	async readULEB128() {
		let acc = 0n, shift = 0n;
		while (true) {
			const byte = await this.readUInt8();
			acc |= BigInt(byte & 127) << shift;
			shift += 7n;
			if (byte >> 7 === 0) break;
		}
		return Number(acc);
	}
	async readBuffer() {
		const len = await this.readULEB128();
		const r = await this.#cb(len);
		this.#consumed += len;
		return r;
	}
	async readString() {
		return new TextDecoder("utf-8", { fatal: true }).decode(await this.readBuffer());
	}
};
async function parseDyLink0(reader) {
	const p0 = new Parser(makeStreamConsumer(reader));
	await p0.skip(8);
	console.assert(await p0.readUInt8() === 0);
	const p1_buf = await p0.readBuffer();
	const p1 = new Parser(makeBufferConsumer(p1_buf), p1_buf.length);
	console.assert(await p1.readString() === "dylink.0");
	const r = {
		neededSos: [],
		exportInfo: [],
		importInfo: []
	};
	while (!p1.eof()) {
		const subsection_type = await p1.readUInt8();
		const p2_buf = await p1.readBuffer();
		const p2 = new Parser(makeBufferConsumer(p2_buf), p2_buf.length);
		switch (subsection_type) {
			case 1:
				r.memSize = await p2.readULEB128();
				r.memP2Align = await p2.readULEB128();
				r.tableSize = await p2.readULEB128();
				r.tableP2Align = await p2.readULEB128();
				break;
			case 2: {
				const n = await p2.readULEB128();
				const acc = /* @__PURE__ */ new Set();
				for (let i = 0; i < n; ++i) acc.add(await p2.readString());
				r.neededSos = [...acc];
				break;
			}
			case 3: {
				const n = await p2.readULEB128();
				for (let i = 0; i < n; ++i) {
					const name = await p2.readString();
					const flags = await p2.readULEB128();
					r.exportInfo.push({
						name,
						flags
					});
				}
				break;
			}
			case 4: {
				const n = await p2.readULEB128();
				for (let i = 0; i < n; ++i) {
					const module = await p2.readString();
					const name = await p2.readString();
					const flags = await p2.readULEB128();
					r.importInfo.push({
						module,
						name,
						flags
					});
				}
				break;
			}
			default: throw new Error(`unknown subsection type ${subsection_type}`);
		}
	}
	return r;
}
function originFromServerAddress({ address, family, port }) {
	return `http://${family === "IPv6" ? `[${address}]` : address}:${port}`;
}
var isNode = Boolean(globalThis?.process?.versions?.node && !globalThis.Deno);
var fs, http, path, require$1, stream, wasi, ws;
if (isNode) {
	require$1 = (await __vitePreload(async () => {
		const { createRequire } = await import("node:module");
		return { createRequire };
	}, [], import.meta.url)).createRequire(import.meta.url);
	fs = require$1("fs");
	http = require$1("http");
	path = require$1("path");
	stream = require$1("stream");
	wasi = require$1("wasi");
	try {
		ws = require$1("ws");
	} catch {}
} else wasi = await __vitePreload(() => Promise.resolve().then(() => (init_browser_wasi_shim(), browser_wasi_shim_exports)), void 0, import.meta.url);
var DyLDHost = class {
	#rpaths = /* @__PURE__ */ new Set();
	constructor({ outFd, inFd }) {
		if (!(typeof outFd === "number" && typeof inFd === "number")) return;
		this.readStream = stream.Readable.toWeb(fs.createReadStream(void 0, { fd: inFd }));
		this.writeStream = stream.Writable.toWeb(fs.createWriteStream(void 0, { fd: outFd }));
	}
	close() {}
	installSignalHandlers(cb) {
		process.on("SIGINT", cb);
		process.on("SIGQUIT", cb);
	}
	async addLibrarySearchPath(p) {
		this.#rpaths.add(path.resolve(p));
		return null;
	}
	async findSystemLibrary(f) {
		if (path.isAbsolute(f)) {
			await fs.promises.access(f, fs.promises.constants.R_OK);
			return f;
		}
		const r = (await Promise.allSettled([...this.#rpaths].map(async (p) => {
			const r = path.resolve(p, f);
			await fs.promises.access(r, fs.promises.constants.R_OK);
			return r;
		}))).find(({ status }) => status === "fulfilled");
		console.assert(r, `findSystemLibrary(${f}): not found in ${[...this.#rpaths]}`);
		return r.value;
	}
	async fetchWasm(p) {
		return new Response(stream.Readable.toWeb(fs.createReadStream(p)), { headers: { "Content-Type": "application/wasm" } });
	}
};
var DyLDBrowserHost = class {
	#rpaths = /* @__PURE__ */ new Set();
	rootfs;
	stdout;
	stderr;
	stdin;
	#readFile(p) {
		const { ret, entry } = this.rootfs.dir.get_entry_for_path({
			parts: p.split("/").filter((tok) => tok !== ""),
			is_dir: false
		});
		return ret === 0 ? entry : null;
	}
	constructor({ rootfs, stdout, stderr, stdin }) {
		this.stdin = stdin;
		this.rootfs = rootfs ? rootfs : new wasi.PreopenDirectory("/", new Map([["tmp", new wasi.Directory(/* @__PURE__ */ new Map())]]));
		this.stdout = stdout ? stdout : (msg) => console.info(msg);
		this.stderr = stderr ? stderr : (msg) => console.warn(msg);
	}
	async addLibrarySearchPath(p) {
		this.#rpaths.add(p);
		return null;
	}
	async findSystemLibrary(f) {
		if (f.startsWith("/")) {
			if (this.#readFile(f)) return f;
			throw new Error(`findSystemLibrary(${f}): not found in /`);
		}
		for (const rpath of this.#rpaths) {
			const r = `${rpath}/${f}`;
			if (this.#readFile(r)) return r;
		}
		throw new Error(`findSystemLibrary(${f}): not found in ${[...this.#rpaths]}`);
	}
	async fetchWasm(p) {
		const entry = this.#readFile(p);
		const r = new Response(entry.data, { headers: { "Content-Type": "application/wasm" } });
		entry.data = new Uint8Array();
		return r;
	}
};
var DyLDRPC = class {
	#origin;
	#wsPipe;
	#wsSig;
	#redirectWasiConsole;
	#wsStdout;
	#wsStderr;
	constructor({ origin, redirectWasiConsole }) {
		this.#origin = origin;
		const ws_url = this.#origin.replace("http://", "ws://");
		this.#wsPipe = new WebSocket(ws_url, "pipe");
		this.#wsPipe.binaryType = "arraybuffer";
		this.readStream = new ReadableStream({ start: (controller) => {
			this.#wsPipe.addEventListener("message", (ev) => controller.enqueue(new Uint8Array(ev.data)));
			this.#wsPipe.addEventListener("error", (ev) => controller.error(ev));
			this.#wsPipe.addEventListener("close", () => controller.close());
		} });
		this.writeStream = new WritableStream({
			start: (controller) => {
				this.#wsPipe.addEventListener("error", (ev) => controller.error(ev));
			},
			write: (buf) => this.#wsPipe.send(buf)
		});
		this.#wsSig = new WebSocket(ws_url, "sig");
		this.#wsSig.binaryType = "arraybuffer";
		this.#redirectWasiConsole = redirectWasiConsole;
		if (redirectWasiConsole) {
			this.#wsStdout = new WebSocket(ws_url, "stdout");
			this.#wsStderr = new WebSocket(ws_url, "stderr");
		}
		this.opened = Promise.all((redirectWasiConsole ? [
			this.#wsPipe,
			this.#wsSig,
			this.#wsStdout,
			this.#wsStderr
		] : [this.#wsPipe, this.#wsSig]).map((ws) => new Promise((res, rej) => {
			ws.addEventListener("open", res);
			ws.addEventListener("error", rej);
		})));
	}
	close() {
		this.#wsPipe.close();
		this.#wsSig.close();
		if (this.#redirectWasiConsole) {
			this.#wsStdout.close();
			this.#wsStderr.close();
		}
	}
	async #rpc(endpoint, ...args) {
		const r = await fetch(`${this.#origin}/rpc/${endpoint}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(args)
		});
		if (!r.ok) throw new Error(await r.text());
		return r.json();
	}
	installSignalHandlers(cb) {
		this.#wsSig.addEventListener("message", cb);
	}
	async addLibrarySearchPath(p) {
		return this.#rpc("addLibrarySearchPath", p);
	}
	async findSystemLibrary(f) {
		return this.#rpc("findSystemLibrary", f);
	}
	async fetchWasm(p) {
		return fetch(`${this.#origin}/fs${p}`);
	}
	stdout(msg) {
		if (this.#redirectWasiConsole) this.#wsStdout.send(msg);
		else console.info(msg);
	}
	stderr(msg) {
		if (this.#redirectWasiConsole) this.#wsStderr.send(msg);
		else console.warn(msg);
	}
};
var DyLDRPCServer = class {
	#dyldHost;
	#server;
	#wss;
	constructor({ host, port, dyldPath, searchDirs, mainSoPath, outFd, inFd, args, redirectWasiConsole }) {
		this.#dyldHost = new DyLDHost({
			outFd,
			inFd
		});
		this.#server = http.createServer(async (req, res) => {
			const origin = originFromServerAddress(await this.listening);
			res.setHeader("Access-Control-Allow-Origin", "*");
			res.setHeader("Access-Control-Allow-Headers", "*");
			if (req.method === "OPTIONS") {
				res.writeHead(204);
				res.end();
				return;
			}
			if (req.url === "/main.html") {
				res.writeHead(200, { "Content-Type": "text/html" });
				res.end(`
<!DOCTYPE html>
<title>wasm ghci</title>
<script type="module" src="./main.js"><\/script>
`);
				return;
			}
			if (req.url === "/main.js") {
				res.writeHead(200, { "Content-Type": "application/javascript" });
				res.end(`
import { DyLDRPC, main } from "./fs${dyldPath}";
const args = ${JSON.stringify({
					searchDirs,
					mainSoPath,
					args,
					isIserv: true
				})};
args.rpc = new DyLDRPC({origin: "${origin}", redirectWasiConsole: ${redirectWasiConsole}});
args.rpc.opened.then(() => main(args));
`);
				return;
			}
			if (req.url.startsWith("/fs")) {
				const p = req.url.replace("/fs", "");
				res.setHeader("Content-Type", {
					".mjs": "application/javascript",
					".so": "application/wasm"
				}[path.extname(p)] || "application/octet-stream");
				res.writeHead(200);
				fs.createReadStream(p).pipe(res);
				return;
			}
			if (req.url.startsWith("/rpc")) {
				const endpoint = req.url.replace("/rpc/", "");
				let body = "";
				for await (const chunk of req) body += chunk;
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify(await this.#dyldHost[endpoint](...JSON.parse(body))));
				return;
			}
			res.writeHead(404, { "Content-Type": "text/plain" });
			res.end("not found");
		});
		this.closed = new Promise((res) => this.#server.on("close", res));
		this.#wss = new ws.WebSocketServer({ server: this.#server });
		this.#wss.on("connection", (ws) => {
			ws.addEventListener("error", () => {
				this.#wss.close();
				this.#server.close();
			});
			ws.addEventListener("close", () => {
				this.#wss.close();
				this.#server.close();
			});
			if (ws.protocol === "pipe") {
				(async () => {
					for await (const buf of this.#dyldHost.readStream) ws.send(buf);
				})();
				const writer = this.#dyldHost.writeStream.getWriter();
				ws.addEventListener("message", (ev) => writer.write(new Uint8Array(ev.data)));
				return;
			}
			if (ws.protocol === "sig") {
				this.#dyldHost.installSignalHandlers(() => ws.send(new Uint8Array(0)));
				return;
			}
			if (ws.protocol === "stdout") {
				ws.addEventListener("message", (ev) => console.info(ev.data));
				return;
			}
			if (ws.protocol === "stderr") {
				ws.addEventListener("message", (ev) => console.warn(ev.data));
				return;
			}
			throw new Error(`unknown protocol ${ws.protocol}`);
		});
		this.listening = new Promise((res) => this.#server.listen({
			host,
			port
		}, () => res(this.#server.address())));
	}
};
var DyLD = class DyLD {
	static #pageSize = 65536;
	static #poison = 4294967295 - DyLD.#pageSize | 0;
	static #ldGeneratedExportNames = new Set([
		"_initialize",
		"__wasm_apply_data_relocs",
		"__wasm_apply_global_relocs",
		"__wasm_call_ctors"
	]);
	#rpc;
	#wasi;
	#memory = new WebAssembly.Memory({ initial: 1 });
	#table = new WebAssembly.Table({
		element: "anyfunc",
		initial: 1
	});
	#tableFree = 1;
	#tableGrowInstance = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array([
		0,
		97,
		115,
		109,
		1,
		0,
		0,
		0,
		1,
		6,
		1,
		96,
		1,
		127,
		1,
		127,
		2,
		35,
		1,
		3,
		101,
		110,
		118,
		25,
		95,
		95,
		105,
		110,
		100,
		105,
		114,
		101,
		99,
		116,
		95,
		102,
		117,
		110,
		99,
		116,
		105,
		111,
		110,
		95,
		116,
		97,
		98,
		108,
		101,
		1,
		112,
		0,
		0,
		3,
		2,
		1,
		0,
		7,
		31,
		1,
		27,
		95,
		95,
		103,
		104,
		99,
		95,
		119,
		97,
		115,
		109,
		95,
		106,
		115,
		102,
		102,
		105,
		95,
		116,
		97,
		98,
		108,
		101,
		95,
		103,
		114,
		111,
		119,
		0,
		0,
		10,
		11,
		1,
		9,
		0,
		208,
		112,
		32,
		0,
		252,
		15,
		0,
		11
	])), { env: { __indirect_function_table: this.#table } });
	#sp = new WebAssembly.Global({
		value: "i32",
		mutable: true
	}, DyLD.#pageSize);
	#jsvalManager = new JSValManager();
	#loadedSos = /* @__PURE__ */ new Set();
	exportFuncs = { memory: this.#memory };
	#finalizationRegistry = new FinalizationRegistry((sp) => this.exportFuncs.rts_freeStablePtr(sp));
	#gotFunc = {};
	#gotMem = {};
	#regs = {};
	#tableGrow(n, v) {
		const prev_free = this.#tableFree;
		if (prev_free + n > this.#table.length) {
			const min_delta = prev_free + n - this.#table.length;
			const delta = Math.max(min_delta, this.#table.length);
			this.#tableGrowInstance.exports.__ghc_wasm_jsffi_table_grow(this.#table.length + delta <= 1e7 ? delta : min_delta);
		}
		if (v) this.#table.set(prev_free, v);
		this.#tableFree += n;
		return prev_free;
	}
	constructor({ args, rpc }) {
		this.#rpc = rpc;
		if (isNode) this.#wasi = new wasi.WASI({
			version: "preview1",
			args,
			env: {
				PATH: "",
				PWD: process.cwd()
			},
			preopens: { "/": "/" }
		});
		else this.#wasi = new wasi.WASI(args, [], [
			this.#rpc instanceof DyLDBrowserHost && this.#rpc.stdin ? this.#rpc.stdin : new wasi.OpenFile(new wasi.File(new Uint8Array(), { readonly: true })),
			wasi.ConsoleStdout.lineBuffered((msg) => this.#rpc.stdout(msg)),
			wasi.ConsoleStdout.lineBuffered((msg) => this.#rpc.stderr(msg)),
			this.#rpc instanceof DyLDBrowserHost ? this.#rpc.rootfs : new wasi.PreopenDirectory("/", new Map([["tmp", new wasi.Directory(/* @__PURE__ */ new Map())]]))
		], { debug: false });
		this.#wasi.initialize({ exports: { memory: this.#memory } });
		for (let i = 1; i <= 10; ++i) this.#regs[`__R${i}`] = new WebAssembly.Global({
			value: "i32",
			mutable: true
		});
		for (let i = 1; i <= 6; ++i) this.#regs[`__F${i}`] = new WebAssembly.Global({
			value: "f32",
			mutable: true
		});
		for (let i = 1; i <= 6; ++i) this.#regs[`__D${i}`] = new WebAssembly.Global({
			value: "f64",
			mutable: true
		});
		this.#regs.__L1 = new WebAssembly.Global({
			value: "i64",
			mutable: true
		});
		for (const k of [
			"__Sp",
			"__SpLim",
			"__Hp",
			"__HpLim"
		]) this.#regs[k] = new WebAssembly.Global({
			value: "i32",
			mutable: true
		});
	}
	async addLibrarySearchPath(p) {
		return this.#rpc.addLibrarySearchPath(p);
	}
	async findSystemLibrary(f) {
		return this.#rpc.findSystemLibrary(f);
	}
	async #downsweep(p) {
		const toks = p.split("/");
		const soname = toks[toks.length - 1];
		if (this.#loadedSos.has(soname)) return [];
		this.#loadedSos.add(soname);
		if (p.startsWith("/")) {
			toks.pop();
			await this.addLibrarySearchPath(toks.join("/"));
		} else p = await this.findSystemLibrary(p);
		const resp = await this.#rpc.fetchWasm(p);
		const resp2 = resp.clone();
		const modp = WebAssembly.compileStreaming(resp);
		const r = await parseDyLink0(resp2.body.getReader());
		r.modp = modp;
		r.soname = soname;
		let acc = [];
		for (const dep of r.neededSos) acc.push(...await this.#downsweep(dep));
		acc.push(r);
		return acc;
	}
	async loadDLLs(packed) {
		const paths = (typeof packed === "string" ? packed.length === 0 ? [] : packed.split("\0") : [packed]).filter((s) => s.length > 0).reverse();
		const plan = [];
		for (const p of paths) plan.push(...await this.#downsweep(p));
		for (const { memSize, memP2Align, tableSize, tableP2Align, modp, soname } of plan) {
			const import_obj = {
				wasi_snapshot_preview1: this.#wasi.wasiImport,
				env: {
					memory: this.#memory,
					__indirect_function_table: this.#table,
					__stack_pointer: this.#sp,
					...this.exportFuncs
				},
				regs: this.#regs,
				ghc_wasm_jsffi: {
					newJSVal: (v) => this.#jsvalManager.newJSVal(v),
					getJSVal: (k) => this.#jsvalManager.getJSVal(k),
					freeJSVal: (k) => this.#jsvalManager.freeJSVal(k),
					scheduleWork: () => setImmediate(this.exportFuncs.rts_schedulerLoop)
				},
				"GOT.mem": this.#gotMem,
				"GOT.func": this.#gotFunc
			};
			let memory_base;
			let table_base = this.#tableGrow(tableSize);
			console.assert(tableP2Align === 0);
			if (soname === "libc.so") {
				console.assert(memP2Align <= Math.log2(DyLD.#pageSize));
				memory_base = DyLD.#pageSize;
				const data_pages = Math.ceil(memSize / DyLD.#pageSize);
				this.#memory.grow(data_pages + 1);
				this.#gotMem.__heap_base = new WebAssembly.Global({
					value: "i32",
					mutable: true
				}, DyLD.#pageSize * (1 + data_pages));
				this.#gotMem.__heap_end = new WebAssembly.Global({
					value: "i32",
					mutable: true
				}, DyLD.#pageSize * (1 + data_pages + 1));
			} else memory_base = this.exportFuncs.aligned_alloc(1 << memP2Align, memSize);
			import_obj.env.__memory_base = new WebAssembly.Global({
				value: "i32",
				mutable: false
			}, memory_base);
			import_obj.env.__table_base = new WebAssembly.Global({
				value: "i32",
				mutable: false
			}, table_base);
			const mod = await modp;
			Object.assign(import_obj.ghc_wasm_jsffi, new Function("__exports", "__ghc_wasm_jsffi_dyld", "__ghc_wasm_jsffi_finalization_registry", "return {".concat(...parseSections(mod).map((rec) => `${rec[0]}: ${parseRecord(rec)}, `), "};"))(this.exportFuncs, this, this.#finalizationRegistry));
			for (const { module, name, kind } of WebAssembly.Module.imports(mod)) {
				if (import_obj[module] && import_obj[module][name]) continue;
				if (module === "env" && kind === "function") {
					import_obj.env[name] = (...args) => {
						if (!this.exportFuncs[name]) throw new WebAssembly.RuntimeError(`non-existent function ${name}`);
						return this.exportFuncs[name](...args);
					};
					continue;
				}
				if (module === "GOT.mem" && kind === "global") {
					this.#gotMem[name] = new WebAssembly.Global({
						value: "i32",
						mutable: true
					}, DyLD.#poison);
					continue;
				}
				if (module === "GOT.func" && kind === "global") {
					if (this.exportFuncs[name]) {
						this.#gotFunc[name] = new WebAssembly.Global({
							value: "i32",
							mutable: true
						}, this.#tableGrow(1, this.exportFuncs[name]));
						continue;
					}
					this.#gotFunc[name] = new WebAssembly.Global({
						value: "i32",
						mutable: true
					}, DyLD.#poison);
					continue;
				}
				throw new Error(`cannot handle import ${module}.${name} with kind ${kind}`);
			}
			const instance = await WebAssembly.instantiate(mod, import_obj);
			for (const k in instance.exports) {
				if (DyLD.#ldGeneratedExportNames.has(k)) continue;
				console.assert(!this.exportFuncs[k], `duplicate symbol ${k} when loading ${soname}`);
				const v = instance.exports[k];
				if (typeof v === "function") {
					this.exportFuncs[k] = v;
					if (this.#gotFunc[k]) {
						const got = this.#gotFunc[k];
						if (got.value === DyLD.#poison) got.value = this.#tableGrow(1, v);
						else this.#table.set(got.value, v);
					}
					continue;
				}
				if (v instanceof WebAssembly.Global) {
					const addr = v.value + memory_base;
					if (this.#gotMem[k]) {
						console.assert(this.#gotMem[k].value === DyLD.#poison);
						this.#gotMem[k].value = addr;
					} else this.#gotMem[k] = new WebAssembly.Global({
						value: "i32",
						mutable: true
					}, addr);
					continue;
				}
				throw new Error(`cannot handle export ${k} ${v}`);
			}
			if (instance.exports.__wasm_apply_data_relocs) instance.exports.__wasm_apply_data_relocs();
			instance.exports._initialize();
		}
	}
	lookupSymbol(sym) {
		if (this.#gotMem[sym] && this.#gotMem[sym].value !== DyLD.#poison) return this.#gotMem[sym].value;
		if (this.#gotFunc[sym] && this.#gotFunc[sym].value !== DyLD.#poison) return this.#gotFunc[sym].value;
		if (this.exportFuncs[sym]) {
			console.assert(!this.#gotFunc[sym]);
			const addr = this.#tableGrow(1, this.exportFuncs[sym]);
			this.#gotFunc[sym] = new WebAssembly.Global({
				value: "i32",
				mutable: true
			}, addr);
			return addr;
		}
		return 0;
	}
};
async function main({ rpc, searchDirs, mainSoPath, args, isIserv }) {
	try {
		const dyld = new DyLD({
			args,
			rpc
		});
		for (const libdir of searchDirs) await dyld.addLibrarySearchPath(libdir);
		await dyld.loadDLLs(mainSoPath);
		dyld.exportFuncs.__ghc_wasm_jsffi_init();
		if (!isIserv) return dyld;
		const reader = rpc.readStream.getReader();
		const writer = rpc.writeStream.getWriter();
		const cb_sig = (cb) => {
			rpc.installSignalHandlers(cb);
		};
		const cb_recv = async () => {
			const { done, value } = await reader.read();
			if (done) throw new Error("not enough bytes");
			return value;
		};
		const cb_send = (buf) => {
			writer.write(new Uint8Array(buf));
		};
		return await dyld.exportFuncs.defaultServer(cb_sig, cb_recv, cb_send);
	} finally {
		if (isIserv) rpc.close();
	}
}
async function nodeMain({ searchDirs, mainSoPath, outFd, inFd, args }) {
	if (!{}.GHCI_BROWSER) return await main({
		rpc: new DyLDHost({
			outFd,
			inFd
		}),
		searchDirs,
		mainSoPath,
		args,
		isIserv: true
	});
	if (!ws) throw new Error("Please install ws and ensure it's available via NODE_PATH");
	const server = new DyLDRPCServer({
		host: {}.GHCI_BROWSER_HOST || "127.0.0.1",
		port: {}.GHCI_BROWSER_PORT || 0,
		dyldPath: "dyld.mjs",
		searchDirs,
		mainSoPath,
		outFd,
		inFd,
		args,
		redirectWasiConsole: {}.GHCI_BROWSER_PUPPETEER_LAUNCH_OPTS || {}.GHCI_BROWSER_PLAYWRIGHT_BROWSER_TYPE ? false : Boolean({}.GHCI_BROWSER_REDIRECT_WASI_CONSOLE)
	});
	const origin = originFromServerAddress(await server.listening);
	const on_console_msg = (msg) => {
		switch (msg.type()) {
			case "error":
			case "warn":
			case "warning":
			case "trace":
			case "assert":
				console.error(msg.text());
				break;
			default:
				console.log(msg.text());
				break;
		}
	};
	if ({}.GHCI_BROWSER_PUPPETEER_LAUNCH_OPTS) {
		let puppeteer;
		try {
			puppeteer = require$1("puppeteer");
		} catch {
			puppeteer = require$1("puppeteer-core");
		}
		const browser = await puppeteer.launch(JSON.parse({}.GHCI_BROWSER_PUPPETEER_LAUNCH_OPTS));
		try {
			const page = await browser.newPage();
			page.on("console", on_console_msg);
			page.on("error", (err) => console.error(err));
			page.on("pageerror", (err) => console.error(err));
			await page.goto(`${origin}/main.html`);
			await server.closed;
			return;
		} finally {
			await browser.close();
		}
	}
	if ({}.GHCI_BROWSER_PLAYWRIGHT_BROWSER_TYPE) {
		let playwright;
		try {
			playwright = require$1("playwright");
		} catch {
			playwright = require$1("playwright-core");
		}
		const browser = await playwright[{}.GHCI_BROWSER_PLAYWRIGHT_BROWSER_TYPE].launch({}.GHCI_BROWSER_PLAYWRIGHT_LAUNCH_OPTS ? JSON.parse({}.GHCI_BROWSER_PLAYWRIGHT_LAUNCH_OPTS) : {});
		try {
			const page = await browser.newPage();
			page.on("console", on_console_msg);
			page.on("pageerror", (err) => console.error(err));
			await page.goto(`${origin}/main.html`);
			await server.closed;
			return;
		} finally {
			await browser.close();
		}
	}
	console.log(`Open ${origin}/main.html or import("${origin}/main.js") to boot ghci`);
}
if (isNode && "dyld.mjs" === process.argv[1]) {
	const clibdir = process.argv[2];
	const mainSoPath = process.argv[3];
	const outFd = Number.parseInt(process.argv[4]), inFd = Number.parseInt(process.argv[5]);
	const args = ["dyld.so", ...process.argv.slice(6)];
	await nodeMain({
		searchDirs: [clibdir],
		mainSoPath,
		outFd,
		inFd,
		args
	});
}
//#endregion
export { DyLDBrowserHost, DyLDHost, DyLDRPC, main };
