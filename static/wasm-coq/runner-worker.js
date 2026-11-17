"use strict";
(() => {
  // <define:__WASM_IDLE_COQ_PROFILE__>
  var define_WASM_IDLE_COQ_PROFILE_default = { profileId: "coq-8.17.1-jscoq-0.17.1-v1", assets: { "jscoq_worker.bc.js": { bytes: 6241668, sha256: "2f7c21f7bc7da5aa3133fa12dd72661a8f3d87e41c377679167641085521c126", url: "https://unpkg.com/jscoq@0.17.1/backend/jsoo/jscoq_worker.bc.js" }, "init.coq-pkg.bin": { bytes: 5015784, sha256: "004c0404ab88d3556ed2e83ef65233a3b016d67eb9710fcd2c8650ed9a202bcc", url: "https://unpkg.com/jscoq@0.17.1/coq-pkgs/init.coq-pkg" }, "coq-base.coq-pkg.bin": { bytes: 4031431, sha256: "5374b34f22f7002d617f9152702f95b113e396d30fdcbfd4a5b484c9dd511d29", url: "https://unpkg.com/jscoq@0.17.1/coq-pkgs/coq-base.coq-pkg" } }, archives: { "init.coq-pkg.bin": { entries: 52, uncompressedBytes: 11487619 }, "coq-base.coq-pkg.bin": { entries: 109, uncompressedBytes: 8511375 } } };

  // node_modules/fflate/esm/browser.js
  var u8 = Uint8Array;
  var u16 = Uint16Array;
  var i32 = Int32Array;
  var fleb = new u8([
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    1,
    1,
    1,
    1,
    2,
    2,
    2,
    2,
    3,
    3,
    3,
    3,
    4,
    4,
    4,
    4,
    5,
    5,
    5,
    5,
    0,
    /* unused */
    0,
    0,
    /* impossible */
    0
  ]);
  var fdeb = new u8([
    0,
    0,
    0,
    0,
    1,
    1,
    2,
    2,
    3,
    3,
    4,
    4,
    5,
    5,
    6,
    6,
    7,
    7,
    8,
    8,
    9,
    9,
    10,
    10,
    11,
    11,
    12,
    12,
    13,
    13,
    /* unused */
    0,
    0
  ]);
  var clim = new u8([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
  var freb = function(eb, start) {
    var b = new u16(31);
    for (var i2 = 0; i2 < 31; ++i2) {
      b[i2] = start += 1 << eb[i2 - 1];
    }
    var r = new i32(b[30]);
    for (var i2 = 1; i2 < 30; ++i2) {
      for (var j = b[i2]; j < b[i2 + 1]; ++j) {
        r[j] = j - b[i2] << 5 | i2;
      }
    }
    return { b, r };
  };
  var _a = freb(fleb, 2);
  var fl = _a.b;
  var revfl = _a.r;
  fl[28] = 258, revfl[258] = 28;
  var _b = freb(fdeb, 0);
  var fd = _b.b;
  var revfd = _b.r;
  var rev = new u16(32768);
  for (i = 0; i < 32768; ++i) {
    x = (i & 43690) >> 1 | (i & 21845) << 1;
    x = (x & 52428) >> 2 | (x & 13107) << 2;
    x = (x & 61680) >> 4 | (x & 3855) << 4;
    rev[i] = ((x & 65280) >> 8 | (x & 255) << 8) >> 1;
  }
  var x;
  var i;
  var hMap = (function(cd, mb, r) {
    var s = cd.length;
    var i2 = 0;
    var l = new u16(mb);
    for (; i2 < s; ++i2) {
      if (cd[i2])
        ++l[cd[i2] - 1];
    }
    var le = new u16(mb);
    for (i2 = 1; i2 < mb; ++i2) {
      le[i2] = le[i2 - 1] + l[i2 - 1] << 1;
    }
    var co;
    if (r) {
      co = new u16(1 << mb);
      var rvb = 15 - mb;
      for (i2 = 0; i2 < s; ++i2) {
        if (cd[i2]) {
          var sv = i2 << 4 | cd[i2];
          var r_1 = mb - cd[i2];
          var v = le[cd[i2] - 1]++ << r_1;
          for (var m = v | (1 << r_1) - 1; v <= m; ++v) {
            co[rev[v] >> rvb] = sv;
          }
        }
      }
    } else {
      co = new u16(s);
      for (i2 = 0; i2 < s; ++i2) {
        if (cd[i2]) {
          co[i2] = rev[le[cd[i2] - 1]++] >> 15 - cd[i2];
        }
      }
    }
    return co;
  });
  var flt = new u8(288);
  for (i = 0; i < 144; ++i)
    flt[i] = 8;
  var i;
  for (i = 144; i < 256; ++i)
    flt[i] = 9;
  var i;
  for (i = 256; i < 280; ++i)
    flt[i] = 7;
  var i;
  for (i = 280; i < 288; ++i)
    flt[i] = 8;
  var i;
  var fdt = new u8(32);
  for (i = 0; i < 32; ++i)
    fdt[i] = 5;
  var i;
  var flrm = /* @__PURE__ */ hMap(flt, 9, 1);
  var fdrm = /* @__PURE__ */ hMap(fdt, 5, 1);
  var max = function(a) {
    var m = a[0];
    for (var i2 = 1; i2 < a.length; ++i2) {
      if (a[i2] > m)
        m = a[i2];
    }
    return m;
  };
  var bits = function(d, p, m) {
    var o = p / 8 | 0;
    return (d[o] | d[o + 1] << 8) >> (p & 7) & m;
  };
  var bits16 = function(d, p) {
    var o = p / 8 | 0;
    return (d[o] | d[o + 1] << 8 | d[o + 2] << 16) >> (p & 7);
  };
  var shft = function(p) {
    return (p + 7) / 8 | 0;
  };
  var slc = function(v, s, e) {
    if (s == null || s < 0)
      s = 0;
    if (e == null || e > v.length)
      e = v.length;
    return new u8(v.subarray(s, e));
  };
  var ec = [
    "unexpected EOF",
    "invalid block type",
    "invalid length/literal",
    "invalid distance",
    "stream finished",
    "no stream handler",
    ,
    // determined by compression function
    "no callback",
    "invalid UTF-8 data",
    "extra field too long",
    "date not in range 1980-2099",
    "filename too long",
    "stream finishing",
    "invalid zip data"
    // determined by unknown compression method
  ];
  var err = function(ind, msg, nt) {
    var e = new Error(msg || ec[ind]);
    e.code = ind;
    if (Error.captureStackTrace)
      Error.captureStackTrace(e, err);
    if (!nt)
      throw e;
    return e;
  };
  var inflt = function(dat, st, buf, dict) {
    var sl = dat.length, dl = dict ? dict.length : 0;
    if (!sl || st.f && !st.l)
      return buf || new u8(0);
    var noBuf = !buf;
    var resize = noBuf || st.i != 2;
    var noSt = st.i;
    if (noBuf)
      buf = new u8(sl * 3);
    var cbuf = function(l2) {
      var bl = buf.length;
      if (l2 > bl) {
        var nbuf = new u8(Math.max(bl * 2, l2));
        nbuf.set(buf);
        buf = nbuf;
      }
    };
    var final = st.f || 0, pos = st.p || 0, bt = st.b || 0, lm = st.l, dm = st.d, lbt = st.m, dbt = st.n;
    var tbts = sl * 8;
    do {
      if (!lm) {
        final = bits(dat, pos, 1);
        var type = bits(dat, pos + 1, 3);
        pos += 3;
        if (!type) {
          var s = shft(pos) + 4, l = dat[s - 4] | dat[s - 3] << 8, t = s + l;
          if (t > sl) {
            if (noSt)
              err(0);
            break;
          }
          if (resize)
            cbuf(bt + l);
          buf.set(dat.subarray(s, t), bt);
          st.b = bt += l, st.p = pos = t * 8, st.f = final;
          continue;
        } else if (type == 1)
          lm = flrm, dm = fdrm, lbt = 9, dbt = 5;
        else if (type == 2) {
          var hLit = bits(dat, pos, 31) + 257, hcLen = bits(dat, pos + 10, 15) + 4;
          var tl = hLit + bits(dat, pos + 5, 31) + 1;
          pos += 14;
          var ldt = new u8(tl);
          var clt = new u8(19);
          for (var i2 = 0; i2 < hcLen; ++i2) {
            clt[clim[i2]] = bits(dat, pos + i2 * 3, 7);
          }
          pos += hcLen * 3;
          var clb = max(clt), clbmsk = (1 << clb) - 1;
          var clm = hMap(clt, clb, 1);
          for (var i2 = 0; i2 < tl; ) {
            var r = clm[bits(dat, pos, clbmsk)];
            pos += r & 15;
            var s = r >> 4;
            if (s < 16) {
              ldt[i2++] = s;
            } else {
              var c = 0, n = 0;
              if (s == 16)
                n = 3 + bits(dat, pos, 3), pos += 2, c = ldt[i2 - 1];
              else if (s == 17)
                n = 3 + bits(dat, pos, 7), pos += 3;
              else if (s == 18)
                n = 11 + bits(dat, pos, 127), pos += 7;
              while (n--)
                ldt[i2++] = c;
            }
          }
          var lt = ldt.subarray(0, hLit), dt = ldt.subarray(hLit);
          lbt = max(lt);
          dbt = max(dt);
          lm = hMap(lt, lbt, 1);
          dm = hMap(dt, dbt, 1);
        } else
          err(1);
        if (pos > tbts) {
          if (noSt)
            err(0);
          break;
        }
      }
      if (resize)
        cbuf(bt + 131072);
      var lms = (1 << lbt) - 1, dms = (1 << dbt) - 1;
      var lpos = pos;
      for (; ; lpos = pos) {
        var c = lm[bits16(dat, pos) & lms], sym = c >> 4;
        pos += c & 15;
        if (pos > tbts) {
          if (noSt)
            err(0);
          break;
        }
        if (!c)
          err(2);
        if (sym < 256)
          buf[bt++] = sym;
        else if (sym == 256) {
          lpos = pos, lm = null;
          break;
        } else {
          var add = sym - 254;
          if (sym > 264) {
            var i2 = sym - 257, b = fleb[i2];
            add = bits(dat, pos, (1 << b) - 1) + fl[i2];
            pos += b;
          }
          var d = dm[bits16(dat, pos) & dms], dsym = d >> 4;
          if (!d)
            err(3);
          pos += d & 15;
          var dt = fd[dsym];
          if (dsym > 3) {
            var b = fdeb[dsym];
            dt += bits16(dat, pos) & (1 << b) - 1, pos += b;
          }
          if (pos > tbts) {
            if (noSt)
              err(0);
            break;
          }
          if (resize)
            cbuf(bt + 131072);
          var end = bt + add;
          if (bt < dt) {
            var shift = dl - dt, dend = Math.min(dt, end);
            if (shift + bt < 0)
              err(3);
            for (; bt < dend; ++bt)
              buf[bt] = dict[shift + bt];
          }
          for (; bt < end; ++bt)
            buf[bt] = buf[bt - dt];
        }
      }
      st.l = lm, st.p = lpos, st.b = bt, st.f = final;
      if (lm)
        final = 1, st.m = lbt, st.d = dm, st.n = dbt;
    } while (!final);
    return bt != buf.length && noBuf ? slc(buf, 0, bt) : buf.subarray(0, bt);
  };
  var et = /* @__PURE__ */ new u8(0);
  var b2 = function(d, b) {
    return d[b] | d[b + 1] << 8;
  };
  var b4 = function(d, b) {
    return (d[b] | d[b + 1] << 8 | d[b + 2] << 16 | d[b + 3] << 24) >>> 0;
  };
  var b8 = function(d, b) {
    return b4(d, b) + b4(d, b + 4) * 4294967296;
  };
  function inflateSync(data, opts) {
    return inflt(data, { i: 2 }, opts && opts.out, opts && opts.dictionary);
  }
  var td = typeof TextDecoder != "undefined" && /* @__PURE__ */ new TextDecoder();
  var tds = 0;
  try {
    td.decode(et, { stream: true });
    tds = 1;
  } catch (e) {
  }
  var dutf8 = function(d) {
    for (var r = "", i2 = 0; ; ) {
      var c = d[i2++];
      var eb = (c > 127) + (c > 223) + (c > 239);
      if (i2 + eb > d.length)
        return { s: r, r: slc(d, i2 - 1) };
      if (!eb)
        r += String.fromCharCode(c);
      else if (eb == 3) {
        c = ((c & 15) << 18 | (d[i2++] & 63) << 12 | (d[i2++] & 63) << 6 | d[i2++] & 63) - 65536, r += String.fromCharCode(55296 | c >> 10, 56320 | c & 1023);
      } else if (eb & 1)
        r += String.fromCharCode((c & 31) << 6 | d[i2++] & 63);
      else
        r += String.fromCharCode((c & 15) << 12 | (d[i2++] & 63) << 6 | d[i2++] & 63);
    }
  };
  function strFromU8(dat, latin1) {
    if (latin1) {
      var r = "";
      for (var i2 = 0; i2 < dat.length; i2 += 16384)
        r += String.fromCharCode.apply(null, dat.subarray(i2, i2 + 16384));
      return r;
    } else if (td) {
      return td.decode(dat);
    } else {
      var _a2 = dutf8(dat), s = _a2.s, r = _a2.r;
      if (r.length)
        err(8);
      return s;
    }
  }
  var slzh = function(d, b) {
    return b + 30 + b2(d, b + 26) + b2(d, b + 28);
  };
  var zh = function(d, b, z) {
    var fnl = b2(d, b + 28), efl = b2(d, b + 30), fn = strFromU8(d.subarray(b + 46, b + 46 + fnl), !(b2(d, b + 8) & 2048)), es = b + 46 + fnl;
    var _a2 = z64hs(d, es, efl, z, b4(d, b + 20), b4(d, b + 24), b4(d, b + 42)), sc = _a2[0], su = _a2[1], off = _a2[2];
    return [b2(d, b + 10), sc, su, fn, es + efl + b2(d, b + 32), off];
  };
  var z64hs = function(d, b, l, z, sc, su, off) {
    var nsc = sc == 4294967295, nsu = su == 4294967295, noff = off == 4294967295, e = b + l;
    var nf = nsc + nsu + noff;
    if (z && nf) {
      for (; b + 4 < e; b += 4 + b2(d, b + 2)) {
        if (b2(d, b) == 1) {
          return [
            nsc ? b8(d, b + 4 + 8 * nsu) : sc,
            nsu ? b8(d, b + 4) : su,
            noff ? b8(d, b + 4 + 8 * (nsu + nsc)) : off,
            1
          ];
        }
      }
      if (z < 2)
        err(13);
    }
    return [sc, su, off, 0];
  };
  function unzipSync(data, opts) {
    var files = {};
    var e = data.length - 22;
    for (; b4(data, e) != 101010256; --e) {
      if (!e || data.length - e > 65558)
        err(13);
    }
    ;
    var c = b2(data, e + 8);
    if (!c)
      return {};
    var o = b4(data, e + 16);
    var z = b4(data, e - 20) == 117853008;
    if (z) {
      var ze = b4(data, e - 12);
      z = b4(data, ze) == 101075792;
      if (z) {
        c = b4(data, ze + 32);
        o = b4(data, ze + 48);
      }
    }
    var fltr = opts && opts.filter;
    for (var i2 = 0; i2 < c; ++i2) {
      var _a2 = zh(data, o, z), c_2 = _a2[0], sc = _a2[1], su = _a2[2], fn = _a2[3], no = _a2[4], off = _a2[5], b = slzh(data, off);
      o = no;
      if (!fltr || fltr({
        name: fn,
        size: sc,
        originalSize: su,
        compression: c_2
      })) {
        if (!c_2)
          files[fn] = slc(data, b, b + sc);
        else if (c_2 == 8)
          files[fn] = inflateSync(data.subarray(b, b + sc), { out: new u8(su) });
        else
          err(14, "unknown compression type " + c_2);
      }
    }
    return files;
  }

  // scripts/runtime-workers/coq-host.mjs
  function coqWorkspacePath(value) {
    if (typeof value !== "string" || !value || /[\\\0]/u.test(value) || value.startsWith("/") || value.split("/").some((part) => !part || part === "." || part === ".."))
      throw new Error("Invalid Coq workspace path");
    return "/lib/work/" + value + (value.toLowerCase().endsWith(".coq") ? ".v" : "");
  }
  function coqPpText(message, state = { vertical: false }) {
    if (!Array.isArray(message)) return typeof message === "string" ? message : "";
    switch (message[0]) {
      case "Pp_empty":
        return "";
      case "Pp_string":
        return message[1];
      case "Pp_glue":
        return message[1].map((part) => coqPpText(part, state)).join("");
      case "Pp_box":
        return coqPpText(message[2], { vertical: message[1][0] === "Pp_vbox" });
      case "Pp_tag":
        return coqPpText(message[2], state);
      case "Pp_force_newline":
        return "\n";
      case "Pp_print_break":
        return state.vertical ? "\n" : " ".repeat(Math.max(0, message[1]));
      case "Pp_comment":
        return message[1].join("\n");
      default:
        throw new Error("Unknown Coq pretty-print protocol element");
    }
  }
  function readCoqCommandInput(channel, maxBytes, notify) {
    if (!channel || channel.protocol !== "wasm-idle-static-stdin-ring" || channel.protocolVersion !== 2 || channel.controlBytes !== 16 || !Number.isSafeInteger(channel.capacity) || channel.capacity < 1 || channel.capacity > 2 ** 31 || typeof SharedArrayBuffer !== "function" || !(channel.buffer instanceof SharedArrayBuffer) || channel.buffer.byteLength !== 16 + channel.capacity)
      throw new Error("Invalid Coq stdin ring");
    const control = new Int32Array(channel.buffer, 0, 4);
    const range = Math.floor(2 ** 32 / channel.capacity) * channel.capacity;
    const bytes = new Uint8Array(channel.buffer, 16, channel.capacity);
    const chunks = [];
    let length = 0;
    for (; ; ) {
      if (Atomics.load(control, 3)) throw new Error("Coq stdin cancelled");
      const write = Atomics.load(control, 0) >>> 0;
      const read = Atomics.load(control, 1) >>> 0;
      const available = (write - read + range) % range;
      if (write >= range || read >= range || available > bytes.length)
        throw new Error("Invalid Coq stdin counters");
      if (available) {
        const count = Math.min(available, bytes.length - read % bytes.length);
        if (length + count > maxBytes)
          throw Object.assign(new Error("Coq stdin exceeds the remaining workspace limit"), {
            code: "resource-limit",
            actual: length + count,
            limit: maxBytes
          });
        chunks.push(bytes.slice(read % bytes.length, read % bytes.length + count));
        length += count;
        Atomics.store(control, 1, (read + count) % range);
        notify();
        continue;
      }
      if (Atomics.load(control, 2)) break;
      notify();
      Atomics.wait(control, 0, write, 100);
    }
    const input = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      input.set(chunk, offset);
      offset += chunk.length;
    }
    return input;
  }
  function guardCoqFilesystem(runtime, maxBytes) {
    const files = () => runtime.jsoo_mount_point.flatMap(
      ({ device }) => Object.values(device.content).filter((file) => file instanceof runtime.MlFakeFile)
    );
    const readOnly = new Set(files());
    const usage = () => files().reduce((total, file) => total + (readOnly.has(file) ? 0 : file.length()), 0);
    let violation;
    const check = (actual = usage()) => {
      if (actual > maxBytes)
        violation ||= Object.assign(new Error("Coq virtual files exceed the workspace limit"), {
          code: "resource-limit",
          actual,
          limit: maxBytes
        });
      if (violation) throw violation;
    };
    const failIO = (message) => {
      if (runtime.caml_raise_sys_error) runtime.caml_raise_sys_error(message);
      throw new Error(message);
    };
    const boundedWrite = (actual) => {
      try {
        check(actual);
      } catch (error) {
        failIO(error.message);
      }
    };
    const filePrototype = runtime.MlFakeFile.prototype;
    const write = filePrototype.write, truncate = filePrototype.truncate;
    filePrototype.write = function(offset, source, sourceOffset, length) {
      if (readOnly.has(this)) failIO("Coq bundled libraries are read-only");
      boundedWrite(usage() + Math.max(0, offset + length - this.length()));
      return write.call(this, offset, source, sourceOffset, length);
    };
    filePrototype.truncate = function(size = 0) {
      if (readOnly.has(this)) failIO("Coq bundled libraries are read-only");
      boundedWrite(usage() + Math.max(0, size - this.length()));
      return truncate.call(this, size);
    };
    const open = runtime.MlFakeDevice.prototype.open;
    runtime.MlFakeDevice.prototype.open = function(name, flags) {
      const file = open.call(this, name, flags);
      if (name.endsWith(".cma.js") && !readOnly.has(file))
        failIO("Only verified bundled Coq tactic plugins can be loaded");
      return file;
    };
    return { check, usage };
  }

  // scripts/runtime-workers/wasm-coq-runner-worker.js
  var profile = define_WASM_IDLE_COQ_PROFILE_default;
  var publish = self.postMessage.bind(self);
  var used = false;
  self.onmessage = async ({ data }) => {
    if (!data?.run) return;
    let phase = "startup", kernelUrl;
    try {
      if (used) throw new Error("Coq requires a fresh Worker per run");
      used = true;
      if (data.args?.length)
        throw new Error("Coq browser sessions do not accept program arguments");
      const payload = data.runtimePreflight;
      if (payload?.profileId !== profile.profileId)
        throw new Error("Coq runtime profile mismatch");
      for (const [name, expected] of Object.entries(profile.assets)) {
        const bytes = payload[name];
        if (!(bytes instanceof Uint8Array) || bytes.length !== expected.bytes)
          throw new Error(`Coq asset size mismatch: ${name}`);
        const digest = Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
          (b) => b.toString(16).padStart(2, "0")
        ).join("");
        if (digest !== expected.sha256) throw new Error(`Coq asset digest mismatch: ${name}`);
      }
      const limits = data.limits;
      let outputBytes = 0, diagnosticCount = 0, violation, kernelError;
      const locations = /* @__PURE__ */ new Map();
      const reportedErrors = /* @__PURE__ */ new Set();
      const text = (value, stream = "stdout") => {
        if (violation) throw violation;
        outputBytes += new TextEncoder().encode(value).length;
        if (outputBytes > limits.maxOutputBytes)
          throw violation = Object.assign(new Error("Coq output limit exceeded"), {
            code: "output-limit",
            actual: outputBytes,
            limit: limits.maxOutputBytes
          });
        if (value) publish({ output: value, stream });
      };
      const report = (level, pp, location) => {
        if (violation || level === "Debug") return;
        const message = coqPpText(pp);
        if (level === "Error") reportedErrors.add(message);
        text(message + "\n", level === "Error" || level === "Warning" ? "stderr" : "stdout");
        if (level === "Error" || level === "Warning") {
          if (++diagnosticCount > limits.maxDiagnostics)
            throw violation = Object.assign(new Error("Coq diagnostic limit exceeded"), {
              code: "output-limit",
              actual: diagnosticCount,
              limit: limits.maxDiagnostics
            });
          const source = location?.fname?.[0] === "InFile" ? location.fname[1] : void 0;
          const path = typeof source === "string" ? source : source?.file;
          const fileName = path && (locations.get(path) || locations.get("/lib/work/" + path.replace(/^\.\//u, "")) || path);
          publish({
            diagnostic: {
              severity: level === "Error" ? "error" : "warning",
              message,
              ...fileName ? { fileName } : {},
              ...location?.line_nb ? { lineNumber: location.line_nb } : {}
            }
          });
        }
      };
      let expectedFile;
      let loaded = false;
      self.postMessage = (message) => {
        if (!Array.isArray(message)) return publish(message);
        if (violation) return;
        if (message[0] === "Log") report(message[1][0], message[2]);
        if (message[0] === "Feedback") {
          const feedback = message[1], contents = feedback.contents;
          if (contents[0] === "Message") report(contents[1][0], contents[3], contents[2]);
        }
        if (message[0] === "Loaded" && message[1] === expectedFile) loaded = true;
        if (message[0] === "CoqExn") {
          const failure = message[1];
          const nativeMessage = coqPpText(failure.pp) || failure.msg;
          kernelError = new Error(nativeMessage);
          if (!reportedErrors.has(nativeMessage))
            report("Error", failure.pp || ["Pp_string", failure.msg], failure.loc);
        }
        if (message[0] === "JsonExn") kernelError = new Error(message[1]);
      };
      kernelUrl = URL.createObjectURL(
        new Blob([payload["jscoq_worker.bc.js"]], { type: "text/javascript" })
      );
      const onRun = self.onmessage;
      importScripts(kernelUrl);
      const kernel = self.onmessage;
      self.onmessage = onRun;
      self.XMLHttpRequest = class {
        open() {
          throw new Error("Coq profile has no unverified remote libraries");
        }
      };
      let fs;
      const send = (command) => {
        kernelError = void 0;
        reportedErrors.clear();
        kernel({ data: command });
        if (violation) throw violation;
        fs?.check();
        if (kernelError) throw kernelError;
      };
      const loadPaths = /* @__PURE__ */ new Map();
      for (const [name, archive] of Object.entries(profile.archives)) {
        const files = unzipSync(payload[name]);
        if (Object.keys(files).length !== archive.entries || Object.values(files).reduce((sum, bytes) => sum + bytes.length, 0) !== archive.uncompressedBytes)
          throw new Error("Coq standard-library archive layout changed");
        for (const [path, bytes] of Object.entries(files)) {
          if (path === "coq-pkg.json") continue;
          if (path.startsWith("/") || path.split("/").some((part) => !part || part === ".." || part === "."))
            throw new Error("Invalid Coq library path");
          send(["Put", "/lib/" + path, bytes]);
          const logical = path.split("/").slice(0, -1);
          loadPaths.set(logical.join("/"), [logical, ["/lib"]]);
        }
      }
      fs = guardCoqFilesystem(self.jsoo_runtime, limits.maxWorkspaceBytes);
      const workspace = new Map(
        (data.workspaceFiles || []).map((file) => [file.path, file.content])
      );
      const activePath = data.activePath || "main.v";
      workspace.set(activePath, data.code);
      let sourceBytes = 0;
      for (const [path, content] of workspace) {
        if (/\.cma(?:\.js)?$/u.test(path))
          throw new Error("Workspace Coq plugins are outside this profile");
        const bytes = new TextEncoder().encode(content), target = coqWorkspacePath(path);
        if (locations.has(target)) throw new Error("Coq workspace file aliases overlap");
        sourceBytes += bytes.length;
        fs.check(sourceBytes);
        locations.set(target, path);
        send(["Put", target, bytes]);
      }
      fs.check();
      send([
        "Init",
        { implicit_libs: true, lib_path: [...loadPaths.values(), [[], ["/lib/work"]]] }
      ]);
      send(["NewDoc", { top_name: "WasmIdle", lib_init: ["Coq.Init.Prelude"] }]);
      self.jsoo_runtime.caml_sys_chdir(self.jsoo_runtime.caml_string_of_jsstring("/lib/work"));
      const loadFile = (filename) => {
        expectedFile = filename;
        loaded = false;
        send(["Load", filename]);
        fs.check();
        if (!loaded) throw new Error("Coq did not finish loading the source file");
      };
      phase = "execute";
      publish({ type: "execution-ready" });
      loadFile(coqWorkspacePath(activePath));
      const input = data.stdinChannel ? readCoqCommandInput(
        data.stdinChannel,
        limits.maxWorkspaceBytes - fs.usage(),
        () => publish({ type: "stdin-request" })
      ) : new TextEncoder().encode(data.stdin || "");
      fs.check(fs.usage() + input.length);
      if (input.length) {
        const stdinPath = "/lib/wasm-idle-stdin.v";
        locations.set(stdinPath, "<stdin>");
        send(["Put", stdinPath, input]);
        loadFile(stdinPath);
      }
      publish({ results: true });
    } catch (error) {
      const message = String(error?.message || error);
      publish({
        error: message,
        failure: {
          name: error?.name || "Error",
          message,
          runtimeId: "COQ",
          code: error?.code || "runtime",
          phase,
          ...error?.code === "resource-limit" || error?.code === "output-limit" ? { actual: error.actual, limit: error.limit } : {}
        }
      });
    } finally {
      if (kernelUrl) URL.revokeObjectURL(kernelUrl);
    }
  };
})();
