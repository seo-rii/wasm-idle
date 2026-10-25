package.preload["fennel-ls.cli"] = package.preload["fennel-ls.cli"] or function(...)
  require("fennel")
  local dispatch = require("fennel-ls.dispatch")
  local json_rpc = require("fennel-ls.json-rpc")
  local lint = require("fennel-ls.lint")
  local utils = require("fennel-ls.utils")
  local files = require("fennel-ls.files")
  local config = require("fennel-ls.config")
  local _local_1259_ = require("fennel-ls.message")
  local severity__3estring = _local_1259_["severity->string"]
  local message = _local_1259_
  local function print_diagnostic(filename, _1260_)
    local msg = _1260_.message
    local range = _1260_.range
    local severity = _1260_.severity
    local _1261_
    if (range == message["unknown-range"]) then
      _1261_ = "?"
    else
      _1261_ = (range.start.line + 1)
    end
    local _1263_
    if (range == message["unknown-range"]) then
      _1263_ = "?"
    else
      _1263_ = range.start.character
    end
    return print(("%s:%s:%s: %s: %s"):format(filename, _1261_, _1263_, (severity__3estring[severity] or "?"), msg))
  end
  local function initialize(server)
    local params = {capabilities = {general = {positionEncodings = {"utf-8"}}}, clientInfo = {name = "fennel-ls"}, rootUri = "file://."}
    config.initialize(server, params)
    for _, _1265_ in ipairs(server.queue) do
      local _each_1266_ = _1265_.params
      local message0 = _each_1266_.message
      print("WARN:", message0)
    end
    return nil
  end
  local function lint_files(server, filenames)
    if (nil == filenames) then
      _G.error("Missing argument filenames on /fennel-ls/src/fennel-ls/cli.fnl:28", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/cli.fnl:28", 2)
    else
    end
    initialize(server)
    local should_err_3f = false
    for _, filename in ipairs(filenames) do
      local uri
      if (filename == "-") then
        uri = "stdin"
      else
        local _0 = filename
        uri = ("file://" .. filename)
      end
      local file = files["get-by-uri"](server, uri)
      lint["add-lint-diagnostics"](server, file)
      for _0, diagnostic in ipairs(file.diagnostics) do
        should_err_3f = true
        print_diagnostic(filename, diagnostic)
      end
    end
    if should_err_3f then
      return os.exit(1)
    else
      return nil
    end
  end
  local function apply_changes(server, filename, changes)
    if (nil == changes) then
      _G.error("Missing argument changes on /fennel-ls/src/fennel-ls/cli.fnl:45", 2)
    else
    end
    if (nil == filename) then
      _G.error("Missing argument filename on /fennel-ls/src/fennel-ls/cli.fnl:45", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/cli.fnl:45", 2)
    else
    end
    local contents
    do
      local f = io.open(filename)
      local function close_handlers_13_(ok_14_, ...)
        f:close()
        if ok_14_ then
          return ...
        else
          return error(..., 0)
        end
      end
      local function _1275_()
        return f:read("*a")
      end
      local _1277_
      do
        local t_1276_ = _G
        if (nil ~= t_1276_) then
          t_1276_ = t_1276_.package
        else
        end
        if (nil ~= t_1276_) then
          t_1276_ = t_1276_.loaded
        else
        end
        if (nil ~= t_1276_) then
          t_1276_ = t_1276_.fennel
        else
        end
        _1277_ = t_1276_
      end
      local or_1281_ = _1277_ or _G.debug
      if not or_1281_ then
        local function _1282_()
          return ""
        end
        or_1281_ = {traceback = _1282_}
      end
      contents = close_handlers_13_(_G.xpcall(_1275_, or_1281_.traceback))
    end
    local new = utils["apply-edits"](contents, changes, server["position-encoding"])
    local f = io.open(filename, "w")
    local function close_handlers_13_(ok_14_, ...)
      f:close()
      if ok_14_ then
        return ...
      else
        return error(..., 0)
      end
    end
    local function _1284_()
      return f:write(new)
    end
    local _1286_
    do
      local t_1285_ = _G
      if (nil ~= t_1285_) then
        t_1285_ = t_1285_.package
      else
      end
      if (nil ~= t_1285_) then
        t_1285_ = t_1285_.loaded
      else
      end
      if (nil ~= t_1285_) then
        t_1285_ = t_1285_.fennel
      else
      end
      _1286_ = t_1285_
    end
    local or_1290_ = _1286_ or _G.debug
    if not or_1290_ then
      local function _1291_()
        return ""
      end
      or_1290_ = {traceback = _1291_}
    end
    return close_handlers_13_(_G.xpcall(_1284_, or_1290_.traceback))
  end
  local function confirm(msg)
    if (nil == msg) then
      _G.error("Missing argument msg on /fennel-ls/src/fennel-ls/cli.fnl:51", 2)
    else
    end
    io.write(msg)
    local case_1293_ = io.read()
    if ((case_1293_ == "") or (case_1293_ == "y") or (case_1293_ == "Y") or (case_1293_ == "yes")) then
      return true
    else
      return nil
    end
  end
  local function fix_files(server, filenames, __yes)
    if (nil == __yes) then
      _G.error("Missing argument --yes on /fennel-ls/src/fennel-ls/cli.fnl:55", 2)
    else
    end
    if (nil == filenames) then
      _G.error("Missing argument filenames on /fennel-ls/src/fennel-ls/cli.fnl:55", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/cli.fnl:55", 2)
    else
    end
    initialize(server)
    for _, filename in ipairs(filenames) do
      local uri
      if (filename == "-") then
        uri = "stdin"
      else
        local _0 = filename
        uri = ("file://" .. filename)
      end
      local file = files["get-by-uri"](server, uri)
      lint["add-lint-diagnostics"](server, file)
      local case_1299_, case_1300_ = next(file.diagnostics)
      if (true and ((_G.type(case_1300_) == "table") and (nil ~= case_1300_.fix))) then
        local _0 = case_1299_
        local fix = case_1300_.fix
        local diagnostic = case_1300_
        local _let_1301_ = fix()
        local title = _let_1301_.title
        local changes = _let_1301_.changes
        local query = ("Apply fix? [Y/n] %s "):format(title)
        print_diagnostic(filename, diagnostic)
        if (__yes or confirm(query)) then
          apply_changes(server, filename, changes)
          fix_files(server, {filename}, __yes)
        else
        end
      else
      end
    end
    return nil
  end
  local function main_loop(server, _in, out)
    if (nil == out) then
      _G.error("Missing argument out on /fennel-ls/src/fennel-ls/cli.fnl:72", 2)
    else
    end
    if (nil == _in) then
      _G.error("Missing argument in on /fennel-ls/src/fennel-ls/cli.fnl:72", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/cli.fnl:72", 2)
    else
    end
    local send
    local function _1307_(...)
      return json_rpc.write(out, ...)
    end
    send = _1307_
    while true do
      local msg = json_rpc.read(_in)
      dispatch.handle(server, send, msg)
      while next(server["files-pending-lint"]) do
        local msg0 = json_rpc["try-read"](_in)
        if msg0 then
          dispatch.handle(server, send, msg0)
        else
          local uri = next(server["files-pending-lint"])
          local file = files["get-by-uri"](server, uri)
          lint["add-lint-diagnostics"](server, file)
          send(message.diagnostics(file))
          server["files-pending-lint"][uri] = nil
        end
      end
    end
    return nil
  end
  local function handle_one_message(server, msg)
    if (nil == msg) then
      _G.error("Missing argument msg on /fennel-ls/src/fennel-ls/cli.fnl:87", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/cli.fnl:87", 2)
    else
    end
    local out = {}
    local function _1311_(...)
      return table.insert(out, ...)
    end
    dispatch.handle(server, _1311_, msg)
    for uri in pairs(server["files-pending-lint"]) do
      local file = files["get-by-uri"](server, uri)
      lint["add-lint-diagnostics"](server, file)
      table.insert(out, message.diagnostics(file))
      server["files-pending-lint"][uri] = nil
    end
    return out
  end
  local _local_1312_ = require("fennel-ls.utils")
  local version = _local_1312_.version
  local help = "Usage: fennel-ls [FLAG] [FILES]\n\nRun fennel-ls, the Fennel language server and linter.\n\n  --lint FILES     : Run the linter on the provided files\n                     a single dash (-) can be used to read from stdin\n  --fix [-y] FILES : Run suggested fixes from linters on files\n  --server         : Start the language server (stdio mode only)\n                     optional, this is the default with no arguments\n\n  --config PATH    : Read configuration from alternate file\n  --help           : Display this text\n  --version        : Show version"
  local function pop_flag(server, flag_name, args, i)
    table.remove(args, i)
    server[flag_name] = table.remove(args, i)
    return nil
  end
  local function parse_args(args)
    if (nil == args) then
      _G.error("Missing argument args on /fennel-ls/src/fennel-ls/cli.fnl:118", 2)
    else
    end
    local server = {}
    for i = #args, 1, -1 do
      local case_1314_ = args[i]
      if (case_1314_ == "--config") then
        pop_flag(server, "config-path", args, i)
        server = server
      else
        local _ = case_1314_
        server = server
      end
    end
    return server
  end
  local function main(arg)
    if (nil == arg) then
      _G.error("Missing argument arg on /fennel-ls/src/fennel-ls/cli.fnl:124", 2)
    else
    end
    local server = parse_args(arg)
    if (((_G.type(arg) == "table") and (arg[1] == "-h")) or ((_G.type(arg) == "table") and (arg[1] == "--help"))) then
      return print(help)
    elseif (((_G.type(arg) == "table") and (arg[1] == "-v")) or ((_G.type(arg) == "table") and (arg[1] == "--version"))) then
      return print(version)
    else
      local matched_3f_1317_, filenames_1318_
      if ((_G.type(arg) == "table") and (arg[1] == "-l")) then
        local filenames = {select(2, (table.unpack or _G.unpack)(arg))}
        matched_3f_1317_, filenames_1318_ = true, filenames
      elseif ((_G.type(arg) == "table") and (arg[1] == "--lint")) then
        local filenames = {select(2, (table.unpack or _G.unpack)(arg))}
        matched_3f_1317_, filenames_1318_ = true, filenames
      else
        matched_3f_1317_, filenames_1318_ = nil
      end
      if matched_3f_1317_ then
        local filenames = filenames_1318_
        return lint_files(server, filenames)
      elseif (((_G.type(arg) == "table") and (arg[1] == "--server")) or ((_G.type(arg) == "table") and (arg[1] == nil))) then
        return main_loop(server, io.input(), io.output())
      elseif ((_G.type(arg) == "table") and (arg[1] == "--fix") and (arg[2] == "-y")) then
        local filenames = {select(3, (table.unpack or _G.unpack)(arg))}
        return fix_files(server, filenames, true)
      elseif ((_G.type(arg) == "table") and (arg[1] == "--fix") and (arg[2] == "--yes")) then
        local filenames = {select(3, (table.unpack or _G.unpack)(arg))}
        return fix_files(server, filenames, true)
      elseif ((_G.type(arg) == "table") and (arg[1] == "--fix")) then
        local filenames = {select(2, (table.unpack or _G.unpack)(arg))}
        return fix_files(server, filenames, false)
      else
        local _args = arg
        io.stderr:write(help)
        io.stderr:write("\n")
        return os.exit(1)
      end
    end
  end
  return {main = main, ["handle-one-message"] = handle_one_message}
end
package.preload["fennel"] = package.preload["fennel"] or function(...)
  -- SPDX-License-Identifier: MIT
  -- SPDX-FileCopyrightText: Calvin Rose and contributors
  package.preload["fennel.repl"] = package.preload["fennel.repl"] or function(...)
    local _760_ = require("fennel.utils")
    local utils = _760_
    local copy = _760_["copy"]
    local parser = require("fennel.parser")
    local compiler = require("fennel.compiler")
    local specials = require("fennel.specials")
    local view = require("fennel.view")
    local depth = 0
    local function prompt_for(top_3f)
      if top_3f then
        return (string.rep(">", (depth + 1)) .. " ")
      else
        return (string.rep(".", (depth + 1)) .. " ")
      end
    end
    local function default_read_chunk(parser_state)
      io.write(prompt_for((0 == parser_state["stack-size"])))
      io.flush()
      local _762_0 = io.read()
      if (nil ~= _762_0) then
        local input = _762_0
        return (input .. "\n")
      end
    end
    local function default_on_values(xs)
      io.write(table.concat(xs, "\9"))
      return io.write("\n")
    end
    local function default_on_error(errtype, err)
      local function _765_()
        local _764_0 = errtype
        if (_764_0 == "Runtime") then
          return (compiler.traceback(tostring(err), 4) .. "\n")
        else
          local _ = _764_0
          return ("%s error: %s\n"):format(errtype, tostring(err))
        end
      end
      return io.write(_765_())
    end
    local function splice_save_locals(env, lua_source, scope)
      local saves = nil
      do
        local tbl_17_ = {}
        local i_18_ = #tbl_17_
        for name in pairs(env.___replLocals___) do
          local val_19_ = ("local %s = ___replLocals___[%q]"):format((scope.manglings[name] or name), name)
          if (nil ~= val_19_) then
            i_18_ = (i_18_ + 1)
            tbl_17_[i_18_] = val_19_
          end
        end
        saves = tbl_17_
      end
      local binds = nil
      do
        local tbl_17_ = {}
        local i_18_ = #tbl_17_
        for raw, name in pairs(scope.manglings) do
          local val_19_ = nil
          if (scope.symmeta[raw] and not scope.gensyms[name]) then
            val_19_ = ("___replLocals___[%q] = %s"):format(raw, name)
          else
          val_19_ = nil
          end
          if (nil ~= val_19_) then
            i_18_ = (i_18_ + 1)
            tbl_17_[i_18_] = val_19_
          end
        end
        binds = tbl_17_
      end
      local gap = nil
      if lua_source:find("\n") then
        gap = "\n"
      else
        gap = " "
      end
      local function _771_()
        if next(saves) then
          return (table.concat(saves, " ") .. gap)
        else
          return ""
        end
      end
      local function _774_()
        local _772_0, _773_0 = lua_source:match("^(.*)[\n ](return .*)$")
        if ((nil ~= _772_0) and (nil ~= _773_0)) then
          local body = _772_0
          local _return = _773_0
          return (body .. gap .. table.concat(binds, " ") .. gap .. _return)
        else
          local _ = _772_0
          return lua_source
        end
      end
      return (_771_() .. _774_())
    end
    local commands = {}
    local function completer(env, scope, text, _3ffulltext, _from, _to)
      local max_items = 2000
      local seen = {}
      local matches = {}
      local input_fragment = text:gsub(".*[%s)(]+", "")
      local stop_looking_3f = false
      local function add_partials(input, tbl, prefix)
        local scope_first_3f = ((tbl == env) or (tbl == env.___replLocals___))
        local tbl_17_ = matches
        local i_18_ = #tbl_17_
        local function _776_()
          if scope_first_3f then
            return scope.manglings
          else
            return tbl
          end
        end
        for k, is_mangled in utils.allpairs(_776_()) do
          if (max_items <= #matches) then break end
          local val_19_ = nil
          do
            local lookup_k = nil
            if scope_first_3f then
              lookup_k = is_mangled
            else
              lookup_k = k
            end
            if ((type(k) == "string") and (input == k:sub(0, #input)) and not seen[k] and ((":" ~= prefix:sub(-1)) or ("function" == type(tbl[lookup_k])))) then
              seen[k] = true
              val_19_ = (prefix .. k)
            else
            val_19_ = nil
            end
          end
          if (nil ~= val_19_) then
            i_18_ = (i_18_ + 1)
            tbl_17_[i_18_] = val_19_
          end
        end
        return tbl_17_
      end
      local function descend(input, tbl, prefix, add_matches, method_3f)
        local splitter = nil
        if method_3f then
          splitter = "^([^:]+):(.*)"
        else
          splitter = "^([^.]+)%.(.*)"
        end
        local head, tail = input:match(splitter)
        local raw_head = (scope.manglings[head] or head)
        if (type(tbl[raw_head]) == "table") then
          stop_looking_3f = true
          if method_3f then
            return add_partials(tail, tbl[raw_head], (prefix .. head .. ":"))
          else
            return add_matches(tail, tbl[raw_head], (prefix .. head))
          end
        end
      end
      local function add_matches(input, tbl, _3fprefix)
        local prefix = nil
        if _3fprefix then
          prefix = (_3fprefix .. ".")
        else
          prefix = ""
        end
        if (not input:find("%.") and input:find(":")) then
          return descend(input, tbl, prefix, add_matches, true)
        elseif not input:find("%.") then
          return add_partials(input, tbl, prefix)
        else
          return descend(input, tbl, prefix, add_matches, false)
        end
      end
      do
        local _785_0 = tostring((_3ffulltext or text)):match("^%s*,([^%s()[%]]*)$")
        if (nil ~= _785_0) then
          local cmd_fragment = _785_0
          add_partials(cmd_fragment, commands, ",")
        else
          local _ = _785_0
          for _0, source in ipairs({scope.specials, scope.macros, (env.___replLocals___ or {}), env, env._G}) do
            if stop_looking_3f then break end
            add_matches(input_fragment, source)
          end
        end
      end
      return matches
    end
    local function command_3f(input)
      return input:match("^%s*,")
    end
    local function command_docs()
      local _787_
      do
        local tbl_17_ = {}
        local i_18_ = #tbl_17_
        for name, f in utils.stablepairs(commands) do
          local val_19_ = ("  ,%s - %s"):format(name, ((compiler.metadata):get(f, "fnl/docstring") or "undocumented"))
          if (nil ~= val_19_) then
            i_18_ = (i_18_ + 1)
            tbl_17_[i_18_] = val_19_
          end
        end
        _787_ = tbl_17_
      end
      return table.concat(_787_, "\n")
    end
    commands.help = function(_, _0, on_values)
      return on_values({("Welcome to Fennel.\nThis is the REPL where you can enter code to be evaluated.\nYou can also run these repl commands:\n\n" .. command_docs() .. "\n  ,return FORM - Evaluate FORM and return its value to the REPL's caller.\n  ,exit - Leave the repl.\n\nUse ,doc something to see descriptions for individual macros and special forms.\nValues from previous inputs are kept in *1, *2, and *3.\n\nFor more information about the language, see https://fennel-lang.org/reference")})
    end
    do end (compiler.metadata):set(commands.help, "fnl/docstring", "Show this message.")
    local function reload(module_name, env, on_values, on_error)
      local _789_0, _790_0 = pcall(specials["load-code"]("return require(...)", env), module_name)
      if ((_789_0 == true) and (nil ~= _790_0)) then
        local old = _790_0
        local old_macro_module = specials["macro-loaded"][module_name]
        local _ = nil
        specials["macro-loaded"][module_name] = nil
        _ = nil
        local _0 = nil
        package.loaded[module_name] = nil
        _0 = nil
        local new = nil
        do
          local _791_0, _792_0 = pcall(require, module_name)
          if ((_791_0 == true) and (nil ~= _792_0)) then
            local new0 = _792_0
            new = new0
          elseif (true and (nil ~= _792_0)) then
            local _1 = _791_0
            local msg = _792_0
            on_error("Repl", msg)
            specials["macro-loaded"][module_name] = old_macro_module
            new = old
          else
          new = nil
          end
        end
        if ((type(old) == "table") and (type(new) == "table")) then
          for k, v in pairs(new) do
            old[k] = v
          end
          for k in pairs(old) do
            if (nil == new[k]) then
              old[k] = nil
            end
          end
          package.loaded[module_name] = old
        end
        return on_values({"ok"})
      elseif ((_789_0 == false) and (nil ~= _790_0)) then
        local msg = _790_0
        if msg:match("loop or previous error loading module") then
          package.loaded[module_name] = nil
          return reload(module_name, env, on_values, on_error)
        elseif specials["macro-loaded"][module_name] then
          specials["macro-loaded"][module_name] = nil
          return nil
        else
          local function _797_()
            local _796_0 = msg:gsub("\n.*", "")
            return _796_0
          end
          return on_error("Runtime", _797_())
        end
      end
    end
    local function run_command(read, on_error, f)
      local _800_0, _801_0, _802_0 = pcall(read)
      if ((_800_0 == true) and (_801_0 == true) and (nil ~= _802_0)) then
        local val = _802_0
        local _803_0, _804_0 = pcall(f, val)
        if ((_803_0 == false) and (nil ~= _804_0)) then
          local msg = _804_0
          return on_error("Runtime", msg)
        end
      elseif (_800_0 == false) then
        return on_error("Parse", "Couldn't parse input.")
      end
    end
    commands.reload = function(env, read, on_values, on_error)
      local function _807_(_241)
        return reload(tostring(_241), env, on_values, on_error)
      end
      return run_command(read, on_error, _807_)
    end
    do end (compiler.metadata):set(commands.reload, "fnl/docstring", "Reload the specified module.")
    commands.reset = function(env, _, on_values)
      env.___replLocals___ = {}
      return on_values({"ok"})
    end
    do end (compiler.metadata):set(commands.reset, "fnl/docstring", "Erase all repl-local scope.")
    commands.complete = function(env, read, on_values, on_error, scope, chars)
      local function _808_()
        return on_values(completer(env, scope, table.concat(chars):gsub("^%s*,complete%s+", ""):sub(1, -2)))
      end
      return run_command(read, on_error, _808_)
    end
    do end (compiler.metadata):set(commands.complete, "fnl/docstring", "Print all possible completions for a given input symbol.")
    local function apropos_2a(pattern, tbl, prefix, seen, names)
      for name, subtbl in pairs(tbl) do
        if (("string" == type(name)) and (package ~= subtbl)) then
          local _809_0 = type(subtbl)
          if (_809_0 == "function") then
            if ((prefix .. name)):match(pattern) then
              table.insert(names, (prefix .. name))
            end
          elseif (_809_0 == "table") then
            if not seen[subtbl] then
              local _811_
              do
                seen[subtbl] = true
                _811_ = seen
              end
              apropos_2a(pattern, subtbl, (prefix .. name:gsub("%.", "/") .. "."), _811_, names)
            end
          end
        end
      end
      return names
    end
    local function apropos(pattern)
      return apropos_2a(pattern:gsub("^_G%.", ""), package.loaded, "", {}, {})
    end
    commands.apropos = function(_env, read, on_values, on_error, _scope)
      local function _815_(_241)
        return on_values(apropos(tostring(_241)))
      end
      return run_command(read, on_error, _815_)
    end
    do end (compiler.metadata):set(commands.apropos, "fnl/docstring", "Print all functions matching a pattern in all loaded modules.")
    local function apropos_follow_path(path)
      local paths = nil
      do
        local tbl_17_ = {}
        local i_18_ = #tbl_17_
        for p in path:gmatch("[^%.]+") do
          local val_19_ = p
          if (nil ~= val_19_) then
            i_18_ = (i_18_ + 1)
            tbl_17_[i_18_] = val_19_
          end
        end
        paths = tbl_17_
      end
      local tgt = package.loaded
      for _, path0 in ipairs(paths) do
        if (nil == tgt) then break end
        local _818_
        do
          local _817_0 = path0:gsub("%/", ".")
          _818_ = _817_0
        end
        tgt = tgt[_818_]
      end
      return tgt
    end
    local function apropos_doc(pattern)
      local tbl_17_ = {}
      local i_18_ = #tbl_17_
      for _, path in ipairs(apropos(".*")) do
        local val_19_ = nil
        do
          local tgt = apropos_follow_path(path)
          if ("function" == type(tgt)) then
            local _819_0 = (compiler.metadata):get(tgt, "fnl/docstring")
            if (nil ~= _819_0) then
              local docstr = _819_0
              val_19_ = (docstr:match(pattern) and path)
            else
            val_19_ = nil
            end
          else
          val_19_ = nil
          end
        end
        if (nil ~= val_19_) then
          i_18_ = (i_18_ + 1)
          tbl_17_[i_18_] = val_19_
        end
      end
      return tbl_17_
    end
    commands["apropos-doc"] = function(_env, read, on_values, on_error, _scope)
      local function _823_(_241)
        return on_values(apropos_doc(tostring(_241)))
      end
      return run_command(read, on_error, _823_)
    end
    do end (compiler.metadata):set(commands["apropos-doc"], "fnl/docstring", "Print all functions that match the pattern in their docs")
    local function apropos_show_docs(on_values, pattern)
      for _, path in ipairs(apropos(pattern)) do
        local tgt = apropos_follow_path(path)
        if (("function" == type(tgt)) and (compiler.metadata):get(tgt, "fnl/docstring")) then
          on_values({specials.doc(tgt, path)})
          on_values({})
        end
      end
      return nil
    end
    commands["apropos-show-docs"] = function(_env, read, on_values, on_error)
      local function _825_(_241)
        return apropos_show_docs(on_values, tostring(_241))
      end
      return run_command(read, on_error, _825_)
    end
    do end (compiler.metadata):set(commands["apropos-show-docs"], "fnl/docstring", "Print all documentations matching a pattern in function name")
    local function resolve(identifier, _826_0, scope)
      local _827_ = _826_0
      local env = _827_
      local ___replLocals___ = _827_["___replLocals___"]
      local e = nil
      local function _828_(_241, _242)
        return (___replLocals___[scope.unmanglings[_242]] or env[_242])
      end
      e = setmetatable({}, {__index = _828_})
      local function _829_(...)
        local _830_0, _831_0 = ...
        if ((_830_0 == true) and (nil ~= _831_0)) then
          local code = _831_0
          local function _832_(...)
            local _833_0, _834_0 = ...
            if ((_833_0 == true) and (nil ~= _834_0)) then
              local val = _834_0
              return val
            else
              local _ = _833_0
              return nil
            end
          end
          return _832_(pcall(specials["load-code"](code, e)))
        else
          local _ = _830_0
          return nil
        end
      end
      return _829_(pcall(compiler["compile-string"], tostring(identifier), {scope = scope}))
    end
    commands.find = function(env, read, on_values, on_error, scope)
      local function _837_(_241)
        local _838_0 = nil
        do
          local _839_0 = utils["sym?"](_241)
          if (nil ~= _839_0) then
            local _840_0 = resolve(_839_0, env, scope)
            if (nil ~= _840_0) then
              _838_0 = debug.getinfo(_840_0)
            else
              _838_0 = _840_0
            end
          else
            _838_0 = _839_0
          end
        end
        local function _843_()
          local line = _838_0.linedefined
          local source = _838_0.source
          return (("string" == type(source)) and ("@" == source:sub(1, 1)))
        end
        if (((_G.type(_838_0) == "table") and (nil ~= _838_0.linedefined) and (nil ~= _838_0.source) and (_838_0.what == "Lua")) and _843_()) then
          local line = _838_0.linedefined
          local source = _838_0.source
          local fnlsrc = nil
          do
            local _844_0 = compiler.sourcemap
            if (nil ~= _844_0) then
              _844_0 = _844_0[source]
            end
            if (nil ~= _844_0) then
              _844_0 = _844_0[line]
            end
            if (nil ~= _844_0) then
              _844_0 = _844_0[2]
            end
            fnlsrc = _844_0
          end
          return on_values({string.format("%s:%s", source:sub(2), (fnlsrc or line))})
        elseif (_838_0 == nil) then
          return on_error("Repl", "Unknown value")
        else
          local _ = _838_0
          return on_error("Repl", "No source info")
        end
      end
      return run_command(read, on_error, _837_)
    end
    do end (compiler.metadata):set(commands.find, "fnl/docstring", "Print the filename and line number for a given function")
    commands.doc = function(env, read, on_values, on_error, scope)
      local function _849_(_241)
        local name = tostring(_241)
        local path = (utils["multi-sym?"](name) or {name})
        local ok_3f, target = nil, nil
        local function _850_()
          return (scope.specials[name] or utils["get-in"](scope.macros, path) or resolve(name, env, scope))
        end
        ok_3f, target = pcall(_850_)
        if ok_3f then
          return on_values({specials.doc(target, name)})
        else
          return on_error("Repl", ("Could not find " .. name .. " for docs."))
        end
      end
      return run_command(read, on_error, _849_)
    end
    do end (compiler.metadata):set(commands.doc, "fnl/docstring", "Print the docstring and arglist for a function, macro, or special form.")
    commands.compile = function(_, read, on_values, on_error, _0, _1, opts)
      local function _852_(_241)
        local _853_0, _854_0 = pcall(compiler.compile, _241, opts)
        if ((_853_0 == true) and (nil ~= _854_0)) then
          local result = _854_0
          return on_values({result})
        elseif (true and (nil ~= _854_0)) then
          local _2 = _853_0
          local msg = _854_0
          return on_error("Repl", ("Error compiling expression: " .. msg))
        end
      end
      return run_command(read, on_error, _852_)
    end
    do end (compiler.metadata):set(commands.compile, "fnl/docstring", "compiles the expression into lua and prints the result.")
    local function load_plugin_commands(plugins)
      for i = #(plugins or {}), 1, -1 do
        for name, f in pairs(plugins[i]) do
          local _856_0 = name:match("^repl%-command%-(.*)")
          if (nil ~= _856_0) then
            local cmd_name = _856_0
            commands[cmd_name] = f
          end
        end
      end
      return nil
    end
    local function run_command_loop(input, read, loop, env, on_values, on_error, scope, chars, opts)
      local command_name = input:match(",([^%s/]+)")
      do
        local _858_0 = commands[command_name]
        if (nil ~= _858_0) then
          local command = _858_0
          command(env, read, on_values, on_error, scope, chars, opts)
        else
          local _ = _858_0
          if ((command_name ~= "exit") and (command_name ~= "return")) then
            on_values({"Unknown command", command_name})
          end
        end
      end
      if ("exit" ~= command_name) then
        return loop((command_name == "return"))
      end
    end
    local function try_readline_21(opts, ok, readline)
      if ok then
        if readline.set_readline_name then
          readline.set_readline_name("fennel")
        end
        readline.set_options({histfile = "", keeplines = 1000})
        opts.readChunk = function(parser_state)
          local _863_0 = readline.readline(prompt_for((0 == parser_state["stack-size"])))
          if (nil ~= _863_0) then
            local input = _863_0
            return (input .. "\n")
          end
        end
        local completer0 = nil
        opts.registerCompleter = function(repl_completer)
          completer0 = repl_completer
          return nil
        end
        local function repl_completer(text, from, to)
          if completer0 then
            readline.set_completion_append_character("")
            return completer0(text:sub(from, to), text, from, to)
          else
            return {}
          end
        end
        readline.set_complete_function(repl_completer)
        return readline
      end
    end
    local function should_use_readline_3f(opts)
      return (("dumb" ~= os.getenv("TERM")) and not opts.readChunk and not opts.registerCompleter)
    end
    local function repl(_3foptions)
      local old_root_options = utils.root.options
      local _867_ = copy(_3foptions)
      local opts = _867_
      local _3ffennelrc = _867_["fennelrc"]
      local _ = nil
      opts.fennelrc = nil
      _ = nil
      local readline = (should_use_readline_3f(opts) and try_readline_21(opts, pcall(require, "readline")))
      local _0 = nil
      if _3ffennelrc then
        _0 = _3ffennelrc()
      else
      _0 = nil
      end
      local env = specials["wrap-env"]((opts.env or rawget(_G, "_ENV") or _G))
      local callbacks = {["view-opts"] = (opts["view-opts"] or {depth = 4}), env = env, onError = (opts.onError or default_on_error), onValues = (opts.onValues or default_on_values), pp = (opts.pp or view), readChunk = (opts.readChunk or default_read_chunk)}
      local save_locals_3f = (opts.saveLocals ~= false)
      local byte_stream, clear_stream = nil, nil
      local function _869_(_241)
        return callbacks.readChunk(_241)
      end
      byte_stream, clear_stream = parser.granulate(_869_)
      local chars = {}
      local read, reset = nil, nil
      local function _870_(parser_state)
        local b = byte_stream(parser_state)
        if b then
          table.insert(chars, string.char(b))
        end
        return b
      end
      read, reset = parser.parser(_870_)
      depth = (depth + 1)
      if opts.message then
        callbacks.onValues({opts.message})
      end
      env.___repl___ = callbacks
      opts.env, opts.scope = env, compiler["make-scope"]()
      opts.useMetadata = (opts.useMetadata ~= false)
      if (opts.allowedGlobals == nil) then
        opts.allowedGlobals = specials["current-global-names"](env)
      end
      if opts.init then
        opts.init(opts, depth)
      end
      if opts.registerCompleter then
        local function _876_()
          local _875_0 = opts.scope
          local function _877_(...)
            return completer(env, _875_0, ...)
          end
          return _877_
        end
        opts.registerCompleter(_876_())
      end
      load_plugin_commands(opts.plugins)
      if save_locals_3f then
        local function newindex(t, k, v)
          if opts.scope.manglings[k] then
            return rawset(t, k, v)
          end
        end
        env.___replLocals___ = setmetatable({}, {__newindex = newindex})
      end
      local function print_values(...)
        local vals = {...}
        local out = {}
        local pp = callbacks.pp
        env._, env.__ = vals[1], vals
        for i = 1, select("#", ...) do
          table.insert(out, pp(vals[i], callbacks["view-opts"]))
        end
        return callbacks.onValues(out)
      end
      local function save_value(...)
        env.___replLocals___["*3"] = env.___replLocals___["*2"]
        env.___replLocals___["*2"] = env.___replLocals___["*1"]
        env.___replLocals___["*1"] = ...
        return ...
      end
      opts.scope.manglings["*1"], opts.scope.unmanglings._1 = "_1", "*1"
      opts.scope.manglings["*2"], opts.scope.unmanglings._2 = "_2", "*2"
      opts.scope.manglings["*3"], opts.scope.unmanglings._3 = "_3", "*3"
      local function loop(_3fexit_next_3f)
        for k in pairs(chars) do
          chars[k] = nil
        end
        reset()
        local ok, parser_not_eof_3f, form = pcall(read)
        local src_string = table.concat(chars)
        local readline_not_eof_3f = (not readline or (src_string ~= "(null)"))
        local not_eof_3f = (readline_not_eof_3f and parser_not_eof_3f)
        if not ok then
          callbacks.onError("Parse", not_eof_3f)
          clear_stream()
          return loop()
        elseif command_3f(src_string) then
          return run_command_loop(src_string, read, loop, env, callbacks.onValues, callbacks.onError, opts.scope, chars, opts)
        else
          if not_eof_3f then
            local function _881_(...)
              local _882_0, _883_0 = ...
              if ((_882_0 == true) and (nil ~= _883_0)) then
                local src = _883_0
                local function _884_(...)
                  local _885_0, _886_0 = ...
                  if ((_885_0 == true) and (nil ~= _886_0)) then
                    local chunk = _886_0
                    local function _887_()
                      return print_values(save_value(chunk()))
                    end
                    local function _888_(...)
                      return callbacks.onError("Runtime", ...)
                    end
                    return xpcall(_887_, _888_)
                  elseif ((_885_0 == false) and (nil ~= _886_0)) then
                    local msg = _886_0
                    clear_stream()
                    return callbacks.onError("Compile", msg)
                  end
                end
                local function _891_(...)
                  local src0 = nil
                  if save_locals_3f then
                    src0 = splice_save_locals(env, src, opts.scope)
                  else
                    src0 = src
                  end
                  return pcall(specials["load-code"], src0, env)
                end
                return _884_(_891_(...))
              elseif ((_882_0 == false) and (nil ~= _883_0)) then
                local msg = _883_0
                clear_stream()
                return callbacks.onError("Compile", msg)
              end
            end
            local function _893_()
              opts["source"] = src_string
              return opts
            end
            _881_(pcall(compiler.compile, form, _893_()))
            utils.root.options = old_root_options
            if _3fexit_next_3f then
              return env.___replLocals___["*1"]
            else
              return loop()
            end
          end
        end
      end
      local value = loop()
      depth = (depth - 1)
      if readline then
        readline.save_history()
      end
      if opts.exit then
        opts.exit(opts, depth)
      end
      return value
    end
    local repl_mt = {__index = {repl = repl}}
    repl_mt.__call = function(_899_0, _3fopts)
      local _900_ = _899_0
      local overrides = _900_
      local view_opts = _900_["view-opts"]
      local opts = copy(_3fopts, copy(overrides))
      local _902_
      do
        local _901_0 = _3fopts
        if (nil ~= _901_0) then
          _901_0 = _901_0["view-opts"]
        end
        _902_ = _901_0
      end
      opts["view-opts"] = copy(_902_, copy(view_opts))
      return repl(opts)
    end
    return setmetatable({["view-opts"] = {}}, repl_mt)
  end
  package.preload["fennel.specials"] = package.preload["fennel.specials"] or function(...)
    local _530_ = require("fennel.utils")
    local utils = _530_
    local pack = _530_["pack"]
    local unpack = _530_["unpack"]
    local view = require("fennel.view")
    local parser = require("fennel.parser")
    local compiler = require("fennel.compiler")
    local SPECIALS = compiler.scopes.global.specials
    local function str1(x)
      return tostring(x[1])
    end
    local function wrap_env(env)
      local function _531_(_, key)
        if utils["string?"](key) then
          return env[compiler["global-unmangling"](key)]
        else
          return env[key]
        end
      end
      local function _533_(_, key, value)
        if utils["string?"](key) then
          env[compiler["global-unmangling"](key)] = value
          return nil
        else
          env[key] = value
          return nil
        end
      end
      local function _535_()
        local _536_
        do
          local tbl_14_ = {}
          for k, v in utils.stablepairs(env) do
            local k_15_, v_16_ = nil, nil
            local _537_
            if utils["string?"](k) then
              _537_ = compiler["global-unmangling"](k)
            else
              _537_ = k
            end
            k_15_, v_16_ = _537_, v
            if ((k_15_ ~= nil) and (v_16_ ~= nil)) then
              tbl_14_[k_15_] = v_16_
            end
          end
          _536_ = tbl_14_
        end
        return next, _536_, nil
      end
      return setmetatable({}, {__index = _531_, __newindex = _533_, __pairs = _535_})
    end
    local function fennel_module_name()
      return (utils.root.options.moduleName or "fennel")
    end
    local function current_global_names(_3fenv)
      local mt = nil
      do
        local _540_0 = getmetatable(_3fenv)
        if ((_G.type(_540_0) == "table") and (nil ~= _540_0.__pairs)) then
          local mtpairs = _540_0.__pairs
          local tbl_14_ = {}
          for k, v in mtpairs(_3fenv) do
            local k_15_, v_16_ = k, v
            if ((k_15_ ~= nil) and (v_16_ ~= nil)) then
              tbl_14_[k_15_] = v_16_
            end
          end
          mt = tbl_14_
        elseif (_540_0 == nil) then
          mt = (_3fenv or _G)
        else
        mt = nil
        end
      end
      local function _543_()
        local tbl_17_ = {}
        local i_18_ = #tbl_17_
        for k in utils.stablepairs(mt) do
          local val_19_ = compiler["global-unmangling"](k)
          if (nil ~= val_19_) then
            i_18_ = (i_18_ + 1)
            tbl_17_[i_18_] = val_19_
          end
        end
        return tbl_17_
      end
      return (mt and _543_())
    end
    local function load_code(code, _3fenv, _3ffilename)
      local env = (_3fenv or rawget(_G, "_ENV") or _G)
      local _545_0, _546_0 = rawget(_G, "setfenv"), rawget(_G, "loadstring")
      if ((nil ~= _545_0) and (nil ~= _546_0)) then
        local setfenv = _545_0
        local loadstring = _546_0
        local f = assert(loadstring(code, _3ffilename, "t"))
        setfenv(f, env)
        return f
      else
        local _ = _545_0
        return assert(load(code, _3ffilename, "t", env))
      end
    end
    local function v__3edocstring(tgt)
      return (((compiler.metadata):get(tgt, "fnl/docstring") or "#<undocumented>")):gsub("\n$", ""):gsub("\n", "\n  ")
    end
    local function doc_2a(tgt, name)
      assert(("string" == type(name)), "name must be a string")
      if not tgt then
        return (name .. " not found")
      else
        local function _549_()
          local _548_0 = getmetatable(tgt)
          if ((_G.type(_548_0) == "table") and true) then
            local __call = _548_0.__call
            return ("function" == type(__call))
          end
        end
        if ((type(tgt) == "function") or _549_()) then
          local arglist = ((compiler.metadata):get(tgt, "fnl/arglist") or {"#<unknown-arguments>"})
          local elts = nil
          local function _551_()
            local tbl_17_ = {}
            local i_18_ = #tbl_17_
            for _, a in ipairs(arglist) do
              local val_19_ = tostring(a)
              if (nil ~= val_19_) then
                i_18_ = (i_18_ + 1)
                tbl_17_[i_18_] = val_19_
              end
            end
            return tbl_17_
          end
          elts = {name, unpack(_551_())}
          return string.format("(%s)\n  %s", table.concat(elts, " "), v__3edocstring(tgt))
        else
          return string.format("%s\n  %s", name, v__3edocstring(tgt))
        end
      end
    end
    local function doc_special(name, arglist, docstring, _3fbody_form_3f)
      for i, a in ipairs(arglist) do
        if ("table" == type(a)) then
          arglist[i] = ("[" .. table.concat(a, " ") .. "]")
        end
      end
      compiler.metadata[SPECIALS[name]] = {["fnl/arglist"] = arglist, ["fnl/body-form?"] = _3fbody_form_3f, ["fnl/docstring"] = docstring}
      return nil
    end
    local function compile_do(ast, scope, parent, _3fstart)
      local start = (_3fstart or 2)
      local len = #ast
      local sub_scope = compiler["make-scope"](scope)
      for i = start, len do
        compiler.compile1(ast[i], sub_scope, parent, {nval = 0})
      end
      return nil
    end
    SPECIALS["do"] = function(ast, scope, parent, opts, _3fstart, _3fchunk, _3fsub_scope, _3fpre_syms)
      local start = (_3fstart or 2)
      local sub_scope = (_3fsub_scope or compiler["make-scope"](scope))
      local chunk = (_3fchunk or {})
      local len = #ast
      local retexprs = {returned = true}
      utils.hook("pre-do", ast, sub_scope)
      local function compile_body(outer_target, outer_tail, _3fouter_retexprs)
        for i = start, len do
          local subopts = {nval = (((i ~= len) and 0) or opts.nval), tail = (((i == len) and outer_tail) or nil), target = (((i == len) and outer_target) or nil)}
          local _ = utils["propagate-options"](opts, subopts)
          local subexprs = compiler.compile1(ast[i], sub_scope, chunk, subopts)
          if (i ~= len) then
            compiler["keep-side-effects"](subexprs, parent, nil, ast[i])
          end
        end
        compiler.emit(parent, chunk, ast)
        compiler.emit(parent, "end", ast)
        utils.hook("do", ast, sub_scope)
        return (_3fouter_retexprs or retexprs)
      end
      if (opts.target or (opts.nval == 0) or opts.tail) then
        compiler.emit(parent, "do", ast)
        return compile_body(opts.target, opts.tail)
      elseif opts.nval then
        local syms = {}
        for i = 1, opts.nval do
          local s = ((_3fpre_syms and _3fpre_syms[i]) or compiler.gensym(scope))
          syms[i] = s
          retexprs[i] = utils.expr(s, "sym")
        end
        local outer_target = table.concat(syms, ", ")
        compiler.emit(parent, string.format("local %s", outer_target), ast)
        compiler.emit(parent, "do", ast)
        return compile_body(outer_target, opts.tail)
      else
        local fname = compiler.gensym(scope)
        local fargs = nil
        if scope.vararg then
          fargs = "..."
        else
          fargs = ""
        end
        compiler.emit(parent, string.format("local function %s(%s)", fname, fargs), ast)
        return compile_body(nil, true, utils.expr((fname .. "(" .. fargs .. ")"), "statement"))
      end
    end
    doc_special("do", {"..."}, "Evaluate multiple forms; return last value.", true)
    local function iter_args(ast)
      local ast0, len, i = ast, #ast, 1
      local function _558_()
        i = (1 + i)
        while ((i == len) and utils["call-of?"](ast0[i], "values")) do
          ast0 = ast0[i]
          len = #ast0
          i = 2
        end
        return ast0[i], (nil == ast0[(i + 1)])
      end
      return _558_
    end
    SPECIALS.values = function(ast, scope, parent)
      local exprs = {}
      for subast, last_3f in iter_args(ast) do
        local subexprs = compiler.compile1(subast, scope, parent, {nval = (not last_3f and 1)})
        table.insert(exprs, subexprs[1])
        if last_3f then
          for j = 2, #subexprs do
            table.insert(exprs, subexprs[j])
          end
        end
      end
      return exprs
    end
    doc_special("values", {"..."}, "Return multiple values from a function. Must be in tail position.")
    local function __3estack(stack, tbl)
      for k, v in pairs(tbl) do
        table.insert(stack, k)
        table.insert(stack, v)
      end
      return stack
    end
    local function literal_3f(val)
      local res = true
      if utils["list?"](val) then
        res = false
      elseif utils["table?"](val) then
        local stack = __3estack({}, val)
        for _, elt in ipairs(stack) do
          if not res then break end
          if utils["list?"](elt) then
            res = false
          elseif utils["table?"](elt) then
            __3estack(stack, elt)
          end
        end
      end
      return res
    end
    local function compile_value(v)
      local opts = {nval = 1, tail = false}
      local scope = compiler["make-scope"]()
      local chunk = {}
      local _562_ = compiler.compile1(v, scope, chunk, opts)
      local _563_ = _562_[1]
      local v0 = _563_[1]
      return v0
    end
    local function insert_meta(meta, k, v)
      local view_opts = {["escape-newlines?"] = true, ["line-length"] = math.huge, ["one-line?"] = true}
      compiler.assert((type(k) == "string"), ("expected string keys in metadata table, got: %s"):format(view(k, view_opts)))
      compiler.assert(literal_3f(v), ("expected literal value in metadata table, got: %s %s"):format(view(k, view_opts), view(v, view_opts)))
      table.insert(meta, view(k))
      local function _564_()
        if ("string" == type(v)) then
          return view(v, view_opts)
        else
          return compile_value(v)
        end
      end
      table.insert(meta, _564_())
      return meta
    end
    local function insert_arglist(meta, arg_list)
      local opts = {["escape-newlines?"] = true, ["line-length"] = math.huge, ["one-line?"] = true}
      local view_args = nil
      do
        local tbl_17_ = {}
        local i_18_ = #tbl_17_
        for _, arg in ipairs(arg_list) do
          local val_19_ = view(view(arg, opts))
          if (nil ~= val_19_) then
            i_18_ = (i_18_ + 1)
            tbl_17_[i_18_] = val_19_
          end
        end
        view_args = tbl_17_
      end
      table.insert(meta, "\"fnl/arglist\"")
      table.insert(meta, ("{" .. table.concat(view_args, ", ") .. "}"))
      return meta
    end
    local function set_fn_metadata(f_metadata, parent, fn_name)
      if utils.root.options.useMetadata then
        local meta_fields = {}
        for k, v in utils.stablepairs(f_metadata) do
          if (k == "fnl/arglist") then
            insert_arglist(meta_fields, v)
          else
            insert_meta(meta_fields, k, v)
          end
        end
        if (type(utils.root.options.useMetadata) == "string") then
          return compiler.emit(parent, ("%s:setall(%s, %s)"):format(utils.root.options.useMetadata, fn_name, table.concat(meta_fields, ", ")))
        else
          local meta_str = ("require(\"%s\").metadata"):format(fennel_module_name())
          return compiler.emit(parent, ("pcall(function() %s:setall(%s, %s) end)"):format(meta_str, fn_name, table.concat(meta_fields, ", ")))
        end
      end
    end
    local function get_fn_name(ast, scope, fn_name, _3fmulti)
      if (fn_name and (fn_name[1] ~= "nil")) then
        local _569_
        if not _3fmulti then
          _569_ = compiler["declare-local"](fn_name, scope, ast)
        else
          _569_ = compiler["symbol-to-expression"](fn_name, scope)[1]
        end
        return _569_, not _3fmulti, 3
      else
        return nil, true, 2
      end
    end
    local function compile_named_fn(ast, f_scope, f_chunk, parent, index, fn_name, local_3f, arg_name_list, f_metadata)
      utils.hook("pre-fn", ast, f_scope, parent)
      for i = (index + 1), #ast do
        compiler.compile1(ast[i], f_scope, f_chunk, {nval = (((i ~= #ast) and 0) or nil), tail = (i == #ast)})
      end
      local _572_
      if local_3f then
        _572_ = "local function %s(%s)"
      else
        _572_ = "%s = function(%s)"
      end
      compiler.emit(parent, string.format(_572_, fn_name, table.concat(arg_name_list, ", ")), ast)
      compiler.emit(parent, f_chunk, ast)
      compiler.emit(parent, "end", ast)
      set_fn_metadata(f_metadata, parent, fn_name)
      utils.hook("fn", ast, f_scope, parent)
      return utils.expr(fn_name, "sym")
    end
    local function compile_anonymous_fn(ast, f_scope, f_chunk, parent, index, arg_name_list, f_metadata, scope)
      local fn_name = compiler.gensym(scope)
      return compile_named_fn(ast, f_scope, f_chunk, parent, index, fn_name, true, arg_name_list, f_metadata)
    end
    local function maybe_metadata(ast, pred, handler, mt, index)
      local index_2a = (index + 1)
      local index_2a_before_ast_end_3f = (index_2a < #ast)
      local expr = ast[index_2a]
      if (index_2a_before_ast_end_3f and pred(expr)) then
        return handler(mt, expr), index_2a
      else
        return mt, index
      end
    end
    local function get_function_metadata(ast, arg_list, index)
      local function _575_(_241, _242)
        local tbl_14_ = _241
        for k, v in pairs(_242) do
          local k_15_, v_16_ = k, v
          if ((k_15_ ~= nil) and (v_16_ ~= nil)) then
            tbl_14_[k_15_] = v_16_
          end
        end
        return tbl_14_
      end
      local function _577_(_241, _242)
        _241["fnl/docstring"] = _242
        return _241
      end
      return maybe_metadata(ast, utils["kv-table?"], _575_, maybe_metadata(ast, utils["string?"], _577_, {["fnl/arglist"] = arg_list}, index))
    end
    SPECIALS.fn = function(ast, scope, parent)
      local f_scope = nil
      do
        local _578_0 = compiler["make-scope"](scope)
        _578_0["vararg"] = false
        f_scope = _578_0
      end
      local f_chunk = {}
      local fn_sym = utils["sym?"](ast[2])
      local multi = (fn_sym and utils["multi-sym?"](fn_sym[1]))
      local fn_name, local_3f, index = get_fn_name(ast, scope, fn_sym, multi)
      local arg_list = compiler.assert(utils["table?"](ast[index]), "expected parameters table", ast)
      compiler.assert((not multi or not multi["multi-sym-method-call"]), ("unexpected multi symbol " .. tostring(fn_name)), fn_sym)
      if (multi and not scope.symmeta[multi[1]] and not compiler["global-allowed?"](multi[1])) then
        compiler.assert(nil, ("expected local table " .. multi[1]), ast[2])
      end
      local function destructure_arg(arg)
        local raw = utils.sym(compiler.gensym(scope))
        local declared = compiler["declare-local"](raw, f_scope, ast)
        compiler.destructure(arg, raw, ast, f_scope, f_chunk, {declaration = true, nomulti = true, symtype = "arg"})
        return declared
      end
      local function destructure_amp(i)
        compiler.assert((i == (#arg_list - 1)), "expected rest argument before last parameter", arg_list[(i + 1)], arg_list)
        f_scope.vararg = true
        compiler.destructure(arg_list[#arg_list], {utils.varg()}, ast, f_scope, f_chunk, {declaration = true, nomulti = true, symtype = "arg"})
        return "..."
      end
      local function get_arg_name(arg, i)
        if f_scope.vararg then
          return nil
        elseif utils["varg?"](arg) then
          compiler.assert((arg == arg_list[#arg_list]), "expected vararg as last parameter", ast)
          f_scope.vararg = true
          return "..."
        elseif utils["sym?"](arg, "&") then
          return destructure_amp(i)
        elseif (utils["sym?"](arg) and (tostring(arg) ~= "nil") and not utils["multi-sym?"](tostring(arg))) then
          return compiler["declare-local"](arg, f_scope, ast)
        elseif utils["table?"](arg) then
          return destructure_arg(arg)
        else
          return compiler.assert(false, ("expected symbol for function parameter: %s"):format(tostring(arg)), ast[index])
        end
      end
      local arg_name_list = nil
      do
        local tbl_17_ = {}
        local i_18_ = #tbl_17_
        for i, a in ipairs(arg_list) do
          local val_19_ = get_arg_name(a, i)
          if (nil ~= val_19_) then
            i_18_ = (i_18_ + 1)
            tbl_17_[i_18_] = val_19_
          end
        end
        arg_name_list = tbl_17_
      end
      local f_metadata, index0 = get_function_metadata(ast, arg_list, index)
      if fn_name then
        return compile_named_fn(ast, f_scope, f_chunk, parent, index0, fn_name, local_3f, arg_name_list, f_metadata)
      else
        return compile_anonymous_fn(ast, f_scope, f_chunk, parent, index0, arg_name_list, f_metadata, scope)
      end
    end
    doc_special("fn", {"?name", "args", "?docstring", "..."}, "Function syntax. May optionally include a name and docstring or a metadata table.\nIf a name is provided, the function will be bound in the current scope.\nWhen called with the wrong number of args, excess args will be discarded\nand lacking args will be nil, use lambda for functions with nil checks.", true)
    SPECIALS.lua = function(ast, _, parent)
      compiler.assert(((#ast == 2) or (#ast == 3)), "expected 1 or 2 arguments", ast)
      local _584_
      do
        local _583_0 = utils["sym?"](ast[2])
        if (nil ~= _583_0) then
          _584_ = tostring(_583_0)
        else
          _584_ = _583_0
        end
      end
      if ("nil" ~= _584_) then
        table.insert(parent, {ast = ast, leaf = tostring(ast[2])})
      end
      local _588_
      do
        local _587_0 = utils["sym?"](ast[3])
        if (nil ~= _587_0) then
          _588_ = tostring(_587_0)
        else
          _588_ = _587_0
        end
      end
      if ("nil" ~= _588_) then
        return tostring(ast[3])
      end
    end
    local function dot(ast, scope, parent)
      compiler.assert((1 < #ast), "expected table argument", ast)
      local len = #ast
      local lhs_node = compiler.macroexpand(ast[2], scope)
      local _591_ = compiler.compile1(lhs_node, scope, parent, {nval = 1})
      local lhs = _591_[1]
      if (len == 2) then
        return tostring(lhs)
      else
        local indices = {}
        for i = 3, len do
          local index = ast[i]
          if (utils["string?"](index) and utils["valid-lua-identifier?"](index)) then
            table.insert(indices, ("." .. index))
          else
            local _592_ = compiler.compile1(index, scope, parent, {nval = 1})
            local index0 = _592_[1]
            table.insert(indices, ("[" .. tostring(index0) .. "]"))
          end
        end
        if (not (utils["sym?"](lhs_node) or utils["list?"](lhs_node)) or ("nil" == tostring(lhs_node))) then
          return ("(" .. tostring(lhs) .. ")" .. table.concat(indices))
        else
          return (tostring(lhs) .. table.concat(indices))
        end
      end
    end
    SPECIALS["."] = dot
    doc_special(".", {"tbl", "key1", "..."}, "Look up key1 in tbl table. If more args are provided, do a nested lookup.")
    SPECIALS.global = function(ast, scope, parent)
      compiler.assert((#ast == 3), "expected name and value", ast)
      compiler.destructure(ast[2], ast[3], ast, scope, parent, {forceglobal = true, nomulti = true, symtype = "global"})
      return nil
    end
    doc_special("global", {"name", "val"}, "Set name as a global with val. Deprecated.")
    SPECIALS.set = function(ast, scope, parent)
      compiler.assert((#ast == 3), "expected name and value", ast)
      compiler.destructure(ast[2], ast[3], ast, scope, parent, {noundef = true, symtype = "set"})
      return nil
    end
    doc_special("set", {"name", "val"}, "Set a local variable to a new value. Only works on locals using var.")
    local function set_forcibly_21_2a(ast, scope, parent)
      compiler.assert((#ast == 3), "expected name and value", ast)
      compiler.destructure(ast[2], ast[3], ast, scope, parent, {forceset = true, symtype = "set"})
      return nil
    end
    SPECIALS["set-forcibly!"] = set_forcibly_21_2a
    local function local_2a(ast, scope, parent, opts)
      compiler.assert(((0 == opts.nval) or opts.tail), "can't introduce local here", ast)
      compiler.assert((#ast == 3), "expected name and value", ast)
      compiler.destructure(ast[2], ast[3], ast, scope, parent, {declaration = true, nomulti = true, symtype = "local"})
      return nil
    end
    SPECIALS["local"] = local_2a
    doc_special("local", {"name", "val"}, "Introduce new top-level immutable local.")
    SPECIALS.var = function(ast, scope, parent, opts)
      compiler.assert(((0 == opts.nval) or opts.tail), "can't introduce var here", ast)
      compiler.assert((#ast == 3), "expected name and value", ast)
      compiler.destructure(ast[2], ast[3], ast, scope, parent, {declaration = true, isvar = true, nomulti = true, symtype = "var"})
      return nil
    end
    doc_special("var", {"name", "val"}, "Introduce new mutable local.")
    local function kv_3f(t)
      local _596_
      do
        local tbl_17_ = {}
        local i_18_ = #tbl_17_
        for k in pairs(t) do
          local val_19_ = nil
          if ("number" ~= type(k)) then
            val_19_ = k
          else
          val_19_ = nil
          end
          if (nil ~= val_19_) then
            i_18_ = (i_18_ + 1)
            tbl_17_[i_18_] = val_19_
          end
        end
        _596_ = tbl_17_
      end
      return _596_[1]
    end
    SPECIALS.let = function(_599_0, scope, parent, opts)
      local _600_ = _599_0
      local _ = _600_[1]
      local bindings = _600_[2]
      local ast = _600_
      compiler.assert((utils["table?"](bindings) and not kv_3f(bindings)), "expected binding sequence", (bindings or ast[1]))
      compiler.assert(((#bindings % 2) == 0), "expected even number of name/value bindings", bindings)
      compiler.assert((3 <= #ast), "expected body expression", ast[1])
      local pre_syms = nil
      do
        local tbl_17_ = {}
        local i_18_ = #tbl_17_
        for _0 = 1, (opts.nval or 0) do
          local val_19_ = compiler.gensym(scope)
          if (nil ~= val_19_) then
            i_18_ = (i_18_ + 1)
            tbl_17_[i_18_] = val_19_
          end
        end
        pre_syms = tbl_17_
      end
      local sub_scope = compiler["make-scope"](scope)
      local sub_chunk = {}
      for i = 1, #bindings, 2 do
        compiler.destructure(bindings[i], bindings[(i + 1)], ast, sub_scope, sub_chunk, {declaration = true, nomulti = true, symtype = "let"})
      end
      return SPECIALS["do"](ast, scope, parent, opts, 3, sub_chunk, sub_scope, pre_syms)
    end
    doc_special("let", {{"name1", "val1", "...", "nameN", "valN"}, "..."}, "Introduces a new scope in which a given set of local bindings are used.", true)
    local function get_prev_line(parent)
      if ("table" == type(parent)) then
        return get_prev_line((parent.leaf or parent[#parent]))
      else
        return parent
      end
    end
    local function needs_separator_3f(root, prev_line)
      return (root:match("^%(") and prev_line and not prev_line:find(" end$"))
    end
    SPECIALS.tset = function(ast, scope, parent)
      compiler.assert((3 < #ast), "expected table, key, and value arguments", ast)
      compiler.assert(((type(ast[2]) ~= "boolean") and (type(ast[2]) ~= "number")), "cannot set field of literal value", ast)
      local root = str1(compiler.compile1(ast[2], scope, parent, {nval = 1}))
      local root0 = nil
      if root:match("^[.{\"]") then
        root0 = string.format("(%s)", root)
      else
        root0 = root
      end
      local keys = nil
      do
        local tbl_17_ = {}
        local i_18_ = #tbl_17_
        for i = 3, (#ast - 1) do
          local val_19_ = str1(compiler.compile1(ast[i], scope, parent, {nval = 1}))
          if (nil ~= val_19_) then
            i_18_ = (i_18_ + 1)
            tbl_17_[i_18_] = val_19_
          end
        end
        keys = tbl_17_
      end
      local value = str1(compiler.compile1(ast[#ast], scope, parent, {nval = 1}))
      local fmtstr = nil
      if needs_separator_3f(root0, get_prev_line(parent)) then
        fmtstr = "; %s[%s] = %s"
      else
        fmtstr = "%s[%s] = %s"
      end
      return compiler.emit(parent, fmtstr:format(root0, table.concat(keys, "]["), value), ast)
    end
    doc_special("tset", {"tbl", "key1", "...", "keyN", "val"}, "Set the value of a table field. Deprecated in favor of set.")
    local function calculate_if_target(scope, opts)
      if not (opts.tail or opts.target or opts.nval) then
        return "iife", true, nil
      elseif (opts.nval and (opts.nval ~= 0) and not opts.target) then
        local accum = {}
        local target_exprs = {}
        for i = 1, opts.nval do
          local s = compiler.gensym(scope)
          accum[i] = s
          target_exprs[i] = utils.expr(s, "sym")
        end
        return "target", opts.tail, table.concat(accum, ", "), target_exprs
      else
        return "none", opts.tail, opts.target
      end
    end
    local function if_2a(ast, scope, parent, opts)
      compiler.assert((2 < #ast), "expected condition and body", ast)
      if ((1 == (#ast % 2)) and (ast[(#ast - 1)] == true)) then
        table.remove(ast, (#ast - 1))
      end
      if (1 == (#ast % 2)) then
        table.insert(ast, utils.sym("nil"))
      end
      if (#ast == 2) then
        return SPECIALS["do"](utils.list(utils.sym("do"), ast[2]), scope, parent, opts)
      else
        local do_scope = compiler["make-scope"](scope)
        local branches = {}
        local wrapper, inner_tail, inner_target, target_exprs = calculate_if_target(scope, opts)
        local body_opts = {nval = opts.nval, tail = inner_tail, target = inner_target}
        local function compile_body(i)
          local chunk = {}
          local cscope = compiler["make-scope"](do_scope)
          compiler["keep-side-effects"](compiler.compile1(ast[i], cscope, chunk, body_opts), chunk, nil, ast[i])
          return {chunk = chunk, scope = cscope}
        end
        for i = 2, (#ast - 1), 2 do
          local condchunk = {}
          local _609_ = compiler.compile1(ast[i], do_scope, condchunk, {nval = 1})
          local cond = _609_[1]
          local branch = compile_body((i + 1))
          branch.cond = cond
          branch.condchunk = condchunk
          branch.nested = ((i ~= 2) and (next(condchunk, nil) == nil))
          table.insert(branches, branch)
        end
        local else_branch = compile_body(#ast)
        local s = compiler.gensym(scope)
        local buffer = {}
        local last_buffer = buffer
        for i = 1, #branches do
          local branch = branches[i]
          local fstr = nil
          if not branch.nested then
            fstr = "if %s then"
          else
            fstr = "elseif %s then"
          end
          local cond = tostring(branch.cond)
          local cond_line = fstr:format(cond)
          if branch.nested then
            compiler.emit(last_buffer, branch.condchunk, ast)
          else
            for _, v in ipairs(branch.condchunk) do
              compiler.emit(last_buffer, v, ast)
            end
          end
          compiler.emit(last_buffer, cond_line, ast)
          compiler.emit(last_buffer, branch.chunk, ast)
          if (i == #branches) then
            compiler.emit(last_buffer, "else", ast)
            compiler.emit(last_buffer, else_branch.chunk, ast)
            compiler.emit(last_buffer, "end", ast)
          elseif not branches[(i + 1)].nested then
            local next_buffer = {}
            compiler.emit(last_buffer, "else", ast)
            compiler.emit(last_buffer, next_buffer, ast)
            compiler.emit(last_buffer, "end", ast)
            last_buffer = next_buffer
          end
        end
        if (wrapper == "iife") then
          local iifeargs = ((scope.vararg and "...") or "")
          compiler.emit(parent, ("local function %s(%s)"):format(tostring(s), iifeargs), ast)
          compiler.emit(parent, buffer, ast)
          compiler.emit(parent, "end", ast)
          return utils.expr(("%s(%s)"):format(tostring(s), iifeargs), "statement")
        elseif (wrapper == "none") then
          for i = 1, #buffer do
            compiler.emit(parent, buffer[i], ast)
          end
          return {returned = true}
        else
          compiler.emit(parent, ("local %s"):format(inner_target), ast)
          for i = 1, #buffer do
            compiler.emit(parent, buffer[i], ast)
          end
          return target_exprs
        end
      end
    end
    SPECIALS["if"] = if_2a
    doc_special("if", {"cond1", "body1", "...", "condN", "bodyN"}, "Conditional form.\nTakes any number of condition/body pairs and evaluates the first body where\nthe condition evaluates to truthy. Similar to cond in other lisps.")
    local function clause_3f(v)
      return (utils["string?"](v) or (utils["sym?"](v) and not utils["multi-sym?"](v) and tostring(v):match("^&(.+)")))
    end
    local function remove_until_condition(bindings, ast)
      local _until = nil
      for i = (#bindings - 1), 3, -1 do
        local _615_0 = clause_3f(bindings[i])
        if ((_615_0 == false) or (_615_0 == nil)) then
        elseif (nil ~= _615_0) then
          local clause = _615_0
          compiler.assert(((clause == "until") and not _until), ("unexpected iterator clause: " .. clause), ast)
          table.remove(bindings, i)
          _until = table.remove(bindings, i)
        end
      end
      return _until
    end
    local function compile_until(_3fcondition, scope, chunk)
      if _3fcondition then
        local _617_ = compiler.compile1(_3fcondition, scope, chunk, {nval = 1})
        local condition_lua = _617_[1]
        return compiler.emit(chunk, ("if %s then break end"):format(tostring(condition_lua)), utils.expr(_3fcondition, "expression"))
      end
    end
    local function iterator_bindings(ast)
      local bindings = utils.copy(ast)
      local _3funtil = remove_until_condition(bindings, ast)
      local iter = table.remove(bindings)
      local bindings0 = nil
      if (1 == #bindings) then
        bindings0 = (utils["list?"](bindings[1]) or bindings)
      else
        for _, b in ipairs(bindings) do
          if utils["list?"](b) then
            utils.warn("unexpected parens in iterator", b)
          end
        end
        bindings0 = bindings
      end
      return bindings0, iter, _3funtil
    end
    SPECIALS.each = function(ast, scope, parent)
      compiler.assert((3 <= #ast), "expected body expression", ast[1])
      compiler.assert(utils["table?"](ast[2]), "expected binding table", ast)
      local sub_scope = compiler["make-scope"](scope)
      local binding, iter, _3funtil_condition = iterator_bindings(ast[2])
      local destructures = {}
      local deferred_scope_changes = {manglings = {}, symmeta = {}}
      utils.hook("pre-each", ast, sub_scope, binding, iter, _3funtil_condition)
      local function destructure_binding(v)
        if utils["sym?"](v) then
          return compiler["declare-local"](v, sub_scope, ast, nil, deferred_scope_changes)
        else
          local raw = utils.sym(compiler.gensym(sub_scope))
          destructures[raw] = v
          return compiler["declare-local"](raw, sub_scope, ast)
        end
      end
      local bind_vars = nil
      do
        local tbl_17_ = {}
        local i_18_ = #tbl_17_
        for _, b in ipairs(binding) do
          local val_19_ = destructure_binding(b)
          if (nil ~= val_19_) then
            i_18_ = (i_18_ + 1)
            tbl_17_[i_18_] = val_19_
          end
        end
        bind_vars = tbl_17_
      end
      local vals = compiler.compile1(iter, scope, parent)
      local val_names = nil
      do
        local tbl_17_ = {}
        local i_18_ = #tbl_17_
        for _, v in ipairs(vals) do
          local val_19_ = tostring(v)
          if (nil ~= val_19_) then
            i_18_ = (i_18_ + 1)
            tbl_17_[i_18_] = val_19_
          end
        end
        val_names = tbl_17_
      end
      local chunk = {}
      compiler.assert(bind_vars[1], "expected binding and iterator", ast)
      compiler.emit(parent, ("for %s in %s do"):format(table.concat(bind_vars, ", "), table.concat(val_names, ", ")), ast)
      for raw, args in utils.stablepairs(destructures) do
        compiler.destructure(args, raw, ast, sub_scope, chunk, {declaration = true, nomulti = true, symtype = "each"})
      end
      compiler["apply-deferred-scope-changes"](sub_scope, deferred_scope_changes, ast)
      compile_until(_3funtil_condition, sub_scope, chunk)
      compile_do(ast, sub_scope, chunk, 3)
      compiler.emit(parent, chunk, ast)
      return compiler.emit(parent, "end", ast)
    end
    doc_special("each", {{"vals...", "iterator"}, "..."}, "Runs the body once for each set of values provided by the given iterator.\nMost commonly used with ipairs for sequential tables or pairs for undefined\norder, but can be used with any iterator with any number of values.", true)
    local function while_2a(ast, scope, parent)
      local len1 = #parent
      local condition = compiler.compile1(ast[2], scope, parent, {nval = 1})[1]
      local len2 = #parent
      local sub_chunk = {}
      if (len1 ~= len2) then
        for i = (len1 + 1), len2 do
          table.insert(sub_chunk, parent[i])
          parent[i] = nil
        end
        compiler.emit(parent, "while true do", ast)
        compiler.emit(sub_chunk, ("if not %s then break end"):format(condition[1]), ast)
      else
        compiler.emit(parent, ("while " .. tostring(condition) .. " do"), ast)
      end
      compile_do(ast, compiler["make-scope"](scope), sub_chunk, 3)
      compiler.emit(parent, sub_chunk, ast)
      return compiler.emit(parent, "end", ast)
    end
    SPECIALS["while"] = while_2a
    doc_special("while", {"condition", "..."}, "The classic while loop. Evaluates body until a condition is non-truthy.", true)
    local function for_2a(ast, scope, parent)
      compiler.assert(utils["table?"](ast[2]), "expected binding table", ast)
      local ranges = setmetatable(utils.copy(ast[2]), getmetatable(ast[2]))
      local until_condition = remove_until_condition(ranges, ast)
      local binding_sym = table.remove(ranges, 1)
      local sub_scope = compiler["make-scope"](scope)
      local range_args = {}
      local chunk = {}
      compiler.assert(utils["sym?"](binding_sym), ("unable to bind %s %s"):format(type(binding_sym), tostring(binding_sym)), ast[2])
      compiler.assert((3 <= #ast), "expected body expression", ast[1])
      compiler.assert((#ranges <= 3), "unexpected arguments", ranges)
      compiler.assert((1 < #ranges), "expected range to include start and stop", ranges)
      utils.hook("pre-for", ast, sub_scope, binding_sym)
      for i = 1, math.min(#ranges, 3) do
        range_args[i] = str1(compiler.compile1(ranges[i], scope, parent, {nval = 1}))
      end
      compiler.emit(parent, ("for %s = %s do"):format(compiler["declare-local"](binding_sym, sub_scope, ast), table.concat(range_args, ", ")), ast)
      compile_until(until_condition, sub_scope, chunk)
      compile_do(ast, sub_scope, chunk, 3)
      compiler.emit(parent, chunk, ast)
      return compiler.emit(parent, "end", ast)
    end
    SPECIALS["for"] = for_2a
    doc_special("for", {{"index", "start", "stop", "?step"}, "..."}, "Numeric loop construct.\nEvaluates body once for each value between start and stop (inclusive).", true)
    local function method_special_type(ast)
      if (utils["string?"](ast[3]) and utils["valid-lua-identifier?"](ast[3])) then
        return "native"
      elseif utils["sym?"](ast[2]) then
        return "nonnative"
      else
        return "binding"
      end
    end
    local function native_method_call(ast, _scope, _parent, target, args)
      local _626_ = ast
      local _ = _626_[1]
      local _0 = _626_[2]
      local method_string = _626_[3]
      local call_string = nil
      if ((target.type == "literal") or (target.type == "varg") or ((target.type == "expression") and not (target[1]):match("[%)%]]$") and not (target[1]):match("%.[%a_][%w_]*$"))) then
        call_string = "(%s):%s(%s)"
      else
        call_string = "%s:%s(%s)"
      end
      return utils.expr(string.format(call_string, tostring(target), method_string, table.concat(args, ", ")), "statement")
    end
    local function nonnative_method_call(ast, scope, parent, target, args)
      local method_string = str1(compiler.compile1(ast[3], scope, parent, {nval = 1}))
      local args0 = {tostring(target), unpack(args)}
      return utils.expr(string.format("%s[%s](%s)", tostring(target), method_string, table.concat(args0, ", ")), "statement")
    end
    local function binding_method_call(ast, scope, parent, target, args)
      local method_string = str1(compiler.compile1(ast[3], scope, parent, {nval = 1}))
      local target_local = compiler.gensym(scope, "tgt")
      local args0 = {target_local, unpack(args)}
      compiler.emit(parent, string.format("local %s = %s", target_local, tostring(target)))
      return utils.expr(string.format("(%s)[%s](%s)", target_local, method_string, table.concat(args0, ", ")), "statement")
    end
    local function method_call(ast, scope, parent)
      compiler.assert((2 < #ast), "expected at least 2 arguments", ast)
      local _628_ = compiler.compile1(ast[2], scope, parent, {nval = 1})
      local target = _628_[1]
      local args = {}
      for i = 4, #ast do
        local subexprs = nil
        local _629_
        if (i ~= #ast) then
          _629_ = 1
        else
        _629_ = nil
        end
        subexprs = compiler.compile1(ast[i], scope, parent, {nval = _629_})
        local tbl_17_ = args
        local i_18_ = #tbl_17_
        for _, subexpr in ipairs(subexprs) do
          local val_19_ = tostring(subexpr)
          if (nil ~= val_19_) then
            i_18_ = (i_18_ + 1)
            tbl_17_[i_18_] = val_19_
          end
        end
      end
      local _632_0 = method_special_type(ast)
      if (_632_0 == "native") then
        return native_method_call(ast, scope, parent, target, args)
      elseif (_632_0 == "nonnative") then
        return nonnative_method_call(ast, scope, parent, target, args)
      elseif (_632_0 == "binding") then
        return binding_method_call(ast, scope, parent, target, args)
      end
    end
    SPECIALS[":"] = method_call
    doc_special(":", {"tbl", "method-name", "..."}, "Call the named method on tbl with the provided args.\nMethod name doesn't have to be known at compile-time; if it is, use\n(tbl:method-name ...) instead.")
    SPECIALS.comment = function(ast, _, parent)
      local c = nil
      local _634_
      do
        local tbl_17_ = {}
        local i_18_ = #tbl_17_
        for i, elt in ipairs(ast) do
          local val_19_ = nil
          if (i ~= 1) then
            val_19_ = view(elt, {["one-line?"] = true})
          else
          val_19_ = nil
          end
          if (nil ~= val_19_) then
            i_18_ = (i_18_ + 1)
            tbl_17_[i_18_] = val_19_
          end
        end
        _634_ = tbl_17_
      end
      c = table.concat(_634_, " "):gsub("%]%]", "]\\]")
      return compiler.emit(parent, ("--[[ " .. c .. " ]]"), ast)
    end
    doc_special("comment", {"..."}, "Comment which will be emitted in Lua output.", true)
    local function hashfn_max_used(f_scope, i, max)
      local max0 = nil
      if f_scope.symmeta[("$" .. i)].used then
        max0 = i
      else
        max0 = max
      end
      if (i < 9) then
        return hashfn_max_used(f_scope, (i + 1), max0)
      else
        return max0
      end
    end
    SPECIALS.hashfn = function(ast, scope, parent)
      compiler.assert((#ast == 2), "expected one argument", ast)
      local f_scope = nil
      do
        local _639_0 = compiler["make-scope"](scope)
        _639_0["vararg"] = false
        _639_0["hashfn"] = true
        f_scope = _639_0
      end
      local f_chunk = {}
      local name = compiler.gensym(scope)
      local symbol = utils.sym(name)
      local args = {}
      compiler["declare-local"](symbol, scope, ast)
      for i = 1, 9 do
        args[i] = compiler["declare-local"](utils.sym(("$" .. i)), f_scope, ast)
      end
      local function walker(idx, node, _3fparent_node)
        if utils["sym?"](node, "$...") then
          f_scope.vararg = true
          if _3fparent_node then
            _3fparent_node[idx] = utils.varg()
            return nil
          else
            return utils.varg()
          end
        else
          return ((utils["list?"](node) and (not _3fparent_node or not utils["sym?"](node[1], "hashfn"))) or utils["table?"](node))
        end
      end
      utils["walk-tree"](ast, walker)
      compiler.compile1(ast[2], f_scope, f_chunk, {tail = true})
      local max_used = hashfn_max_used(f_scope, 1, 0)
      if f_scope.vararg then
        compiler.assert((max_used == 0), "$ and $... in hashfn are mutually exclusive", ast)
      end
      local arg_str = nil
      if f_scope.vararg then
        arg_str = tostring(utils.varg())
      else
        arg_str = table.concat(args, ", ", 1, max_used)
      end
      compiler.emit(parent, string.format("local function %s(%s)", name, arg_str), ast)
      compiler.emit(parent, f_chunk, ast)
      compiler.emit(parent, "end", ast)
      return utils.expr(name, "sym")
    end
    doc_special("hashfn", {"..."}, "Function literal shorthand; args are either $... OR $1, $2, etc.")
    local function comparator_special_type(ast)
      if (3 == #ast) then
        return "native"
      elseif utils["every?"]({unpack(ast, 3, (#ast - 1))}, utils["idempotent-expr?"]) then
        return "idempotent"
      else
        return "binding"
      end
    end
    local function short_circuit_safe_3f(x, scope)
      if (("table" ~= type(x)) or utils["sym?"](x) or utils["varg?"](x)) then
        return true
      elseif utils["table?"](x) then
        local ok = true
        for k, v in pairs(x) do
          if not ok then break end
          ok = (short_circuit_safe_3f(v, scope) and short_circuit_safe_3f(k, scope))
        end
        return ok
      elseif utils["list?"](x) then
        if utils["sym?"](x[1]) then
          local _645_0 = str1(x)
          if ((_645_0 == "fn") or (_645_0 == "hashfn") or (_645_0 == "let") or (_645_0 == "local") or (_645_0 == "var") or (_645_0 == "set") or (_645_0 == "tset") or (_645_0 == "if") or (_645_0 == "each") or (_645_0 == "for") or (_645_0 == "while") or (_645_0 == "do") or (_645_0 == "lua") or (_645_0 == "global")) then
            return false
          elseif (((_645_0 == "<") or (_645_0 == ">") or (_645_0 == "<=") or (_645_0 == ">=") or (_645_0 == "=") or (_645_0 == "not=") or (_645_0 == "~=")) and (comparator_special_type(x) == "binding")) then
            return false
          else
            local function _646_()
              return (1 ~= x[2])
            end
            if ((_645_0 == "pick-values") and _646_()) then
              return false
            else
              local function _647_()
                local call = _645_0
                return scope.macros[call]
              end
              if ((nil ~= _645_0) and _647_()) then
                local call = _645_0
                return false
              else
                local function _648_()
                  return (method_special_type(x) == "binding")
                end
                if ((_645_0 == ":") and _648_()) then
                  return false
                else
                  local _ = _645_0
                  local ok = true
                  for i = 2, #x do
                    if not ok then break end
                    ok = short_circuit_safe_3f(x[i], scope)
                  end
                  return ok
                end
              end
            end
          end
        else
          local ok = true
          for _, v in ipairs(x) do
            if not ok then break end
            ok = short_circuit_safe_3f(v, scope)
          end
          return ok
        end
      end
    end
    local function operator_special_result(ast, zero_arity, unary_prefix, padded_op, operands)
      local _652_0 = #operands
      if (_652_0 == 0) then
        if zero_arity then
          return utils.expr(zero_arity, "literal")
        else
          return compiler.assert(false, "Expected more than 0 arguments", ast)
        end
      elseif (_652_0 == 1) then
        if unary_prefix then
          return ("(" .. unary_prefix .. padded_op .. operands[1] .. ")")
        else
          return operands[1]
        end
      else
        local _ = _652_0
        return ("(" .. table.concat(operands, padded_op) .. ")")
      end
    end
    local function emit_short_circuit_if(ast, scope, parent, name, subast, accumulator, expr_string, setter)
      if (accumulator ~= expr_string) then
        compiler.emit(parent, string.format(setter, accumulator, expr_string), ast)
      end
      local function _657_()
        if (name == "and") then
          return accumulator
        else
          return ("not " .. accumulator)
        end
      end
      compiler.emit(parent, ("if %s then"):format(_657_()), subast)
      do
        local chunk = {}
        compiler.compile1(subast, scope, chunk, {nval = 1, target = accumulator})
        compiler.emit(parent, chunk)
      end
      return compiler.emit(parent, "end")
    end
    local function operator_special(name, zero_arity, unary_prefix, ast, scope, parent)
      compiler.assert(not ((#ast == 2) and utils["varg?"](ast[2])), "tried to use vararg with operator", ast)
      local padded_op = (" " .. name .. " ")
      local operands, accumulator = {}
      if utils["call-of?"](ast[#ast], "values") then
        utils.warn("multiple values in operators are deprecated", ast)
      end
      for subast in iter_args(ast) do
        if ((nil ~= next(operands)) and ((name == "or") or (name == "and")) and not short_circuit_safe_3f(subast, scope)) then
          local expr_string = table.concat(operands, padded_op)
          local setter = nil
          if accumulator then
            setter = "%s = %s"
          else
            setter = "local %s = %s"
          end
          if not accumulator then
            accumulator = compiler.gensym(scope, name)
          end
          emit_short_circuit_if(ast, scope, parent, name, subast, accumulator, expr_string, setter)
          operands = {accumulator}
        else
          table.insert(operands, str1(compiler.compile1(subast, scope, parent, {nval = 1})))
        end
      end
      return operator_special_result(ast, zero_arity, unary_prefix, padded_op, operands)
    end
    local function define_arithmetic_special(name, _3fzero_arity, _3funary_prefix, _3flua_name)
      local _663_
      do
        local _662_0 = (_3flua_name or name)
        local function _664_(...)
          return operator_special(_662_0, _3fzero_arity, _3funary_prefix, ...)
        end
        _663_ = _664_
      end
      SPECIALS[name] = _663_
      return doc_special(name, {"a", "b", "..."}, "Arithmetic operator; works the same as Lua but accepts more arguments.")
    end
    define_arithmetic_special("+", "0", "0")
    define_arithmetic_special("..", "''")
    define_arithmetic_special("^")
    define_arithmetic_special("-", nil, "")
    define_arithmetic_special("*", "1", "1")
    define_arithmetic_special("%")
    define_arithmetic_special("/", nil, "1")
    define_arithmetic_special("//", nil, "1")
    SPECIALS["or"] = function(ast, scope, parent)
      return operator_special("or", "false", nil, ast, scope, parent)
    end
    SPECIALS["and"] = function(ast, scope, parent)
      return operator_special("and", "true", nil, ast, scope, parent)
    end
    doc_special("and", {"a", "b", "..."}, "Boolean operator; works the same as Lua but accepts more arguments.")
    doc_special("or", {"a", "b", "..."}, "Boolean operator; works the same as Lua but accepts more arguments.")
    local function bitop_special(native_name, lib_name, zero_arity, unary_prefix, ast, scope, parent)
      if (#ast == 1) then
        return compiler.assert(zero_arity, "Expected more than 0 arguments.", ast)
      else
        local len = #ast
        local operands = {}
        local padded_native_name = (" " .. native_name .. " ")
        local prefixed_lib_name = ("bit." .. lib_name)
        for i = 2, len do
          local subexprs = nil
          local _665_
          if (i ~= len) then
            _665_ = 1
          else
          _665_ = nil
          end
          subexprs = compiler.compile1(ast[i], scope, parent, {nval = _665_})
          local tbl_17_ = operands
          local i_18_ = #tbl_17_
          for _, s in ipairs(subexprs) do
            local val_19_ = tostring(s)
            if (nil ~= val_19_) then
              i_18_ = (i_18_ + 1)
              tbl_17_[i_18_] = val_19_
            end
          end
        end
        if (#operands == 1) then
          if utils.root.options.useBitLib then
            return (prefixed_lib_name .. "(" .. unary_prefix .. ", " .. operands[1] .. ")")
          else
            return ("(" .. unary_prefix .. padded_native_name .. operands[1] .. ")")
          end
        else
          if utils.root.options.useBitLib then
            return (prefixed_lib_name .. "(" .. table.concat(operands, ", ") .. ")")
          else
            return ("(" .. table.concat(operands, padded_native_name) .. ")")
          end
        end
      end
    end
    local function define_bitop_special(name, zero_arity, unary_prefix, native)
      local function _672_(...)
        return bitop_special(native, name, zero_arity, unary_prefix, ...)
      end
      SPECIALS[name] = _672_
      return nil
    end
    define_bitop_special("lshift", nil, "1", "<<")
    define_bitop_special("rshift", nil, "1", ">>")
    define_bitop_special("band", "-1", "-1", "&")
    define_bitop_special("bor", "0", "0", "|")
    define_bitop_special("bxor", "0", "0", "~")
    doc_special("lshift", {"x", "n"}, "Bitwise logical left shift of x by n bits.\nOnly works in Lua 5.3+ or LuaJIT with the --use-bit-lib flag.")
    doc_special("rshift", {"x", "n"}, "Bitwise logical right shift of x by n bits.\nOnly works in Lua 5.3+ or LuaJIT with the --use-bit-lib flag.")
    doc_special("band", {"x1", "x2", "..."}, "Bitwise AND of any number of arguments.\nOnly works in Lua 5.3+ or LuaJIT with the --use-bit-lib flag.")
    doc_special("bor", {"x1", "x2", "..."}, "Bitwise OR of any number of arguments.\nOnly works in Lua 5.3+ or LuaJIT with the --use-bit-lib flag.")
    doc_special("bxor", {"x1", "x2", "..."}, "Bitwise XOR of any number of arguments.\nOnly works in Lua 5.3+ or LuaJIT with the --use-bit-lib flag.")
    SPECIALS.bnot = function(ast, scope, parent)
      compiler.assert((#ast == 2), "expected one argument", ast)
      local _673_ = compiler.compile1(ast[2], scope, parent, {nval = 1})
      local value = _673_[1]
      if utils.root.options.useBitLib then
        return ("bit.bnot(" .. tostring(value) .. ")")
      else
        return ("~(" .. tostring(value) .. ")")
      end
    end
    doc_special("bnot", {"x"}, "Bitwise negation; only works in Lua 5.3+ or LuaJIT with the --use-bit-lib flag.")
    doc_special("..", {"a", "b", "..."}, "String concatenation operator; works the same as Lua but accepts more arguments.")
    local function native_comparator(op, _675_0, scope, parent)
      local _676_ = _675_0
      local _ = _676_[1]
      local lhs_ast = _676_[2]
      local rhs_ast = _676_[3]
      local _677_ = compiler.compile1(lhs_ast, scope, parent, {nval = 1})
      local lhs = _677_[1]
      local _678_ = compiler.compile1(rhs_ast, scope, parent, {nval = 1})
      local rhs = _678_[1]
      return string.format("(%s %s %s)", tostring(lhs), op, tostring(rhs))
    end
    local function idempotent_comparator(op, chain_op, ast, scope, parent)
      local vals = nil
      do
        local tbl_17_ = {}
        local i_18_ = #tbl_17_
        for i = 2, #ast do
          local val_19_ = str1(compiler.compile1(ast[i], scope, parent, {nval = 1}))
          if (nil ~= val_19_) then
            i_18_ = (i_18_ + 1)
            tbl_17_[i_18_] = val_19_
          end
        end
        vals = tbl_17_
      end
      local comparisons = nil
      do
        local tbl_17_ = {}
        local i_18_ = #tbl_17_
        for i = 1, (#vals - 1) do
          local val_19_ = string.format("(%s %s %s)", vals[i], op, vals[(i + 1)])
          if (nil ~= val_19_) then
            i_18_ = (i_18_ + 1)
            tbl_17_[i_18_] = val_19_
          end
        end
        comparisons = tbl_17_
      end
      local chain = string.format(" %s ", (chain_op or "and"))
      return ("(" .. table.concat(comparisons, chain) .. ")")
    end
    local function binding_comparator(op, chain_op, ast, scope, parent)
      local binding_left = {}
      local binding_right = {}
      local vals = {}
      local chain = string.format(" %s ", (chain_op or "and"))
      for i = 2, #ast do
        local compiled = str1(compiler.compile1(ast[i], scope, parent, {nval = 1}))
        if (utils["idempotent-expr?"](ast[i]) or (i == 2) or (i == #ast)) then
          table.insert(vals, compiled)
        else
          local my_sym = compiler.gensym(scope)
          table.insert(binding_left, my_sym)
          table.insert(binding_right, compiled)
          table.insert(vals, my_sym)
        end
      end
      compiler.emit(parent, string.format("local %s = %s", table.concat(binding_left, ", "), table.concat(binding_right, ", "), ast))
      local _682_
      do
        local tbl_17_ = {}
        local i_18_ = #tbl_17_
        for i = 1, (#vals - 1) do
          local val_19_ = string.format("(%s %s %s)", vals[i], op, vals[(i + 1)])
          if (nil ~= val_19_) then
            i_18_ = (i_18_ + 1)
            tbl_17_[i_18_] = val_19_
          end
        end
        _682_ = tbl_17_
      end
      return ("(" .. table.concat(_682_, chain) .. ")")
    end
    local function define_comparator_special(name, _3flua_op, _3fchain_op)
      do
        local op = (_3flua_op or name)
        local function opfn(ast, scope, parent)
          compiler.assert((2 < #ast), "expected at least two arguments", ast)
          local _684_0 = comparator_special_type(ast)
          if (_684_0 == "native") then
            return native_comparator(op, ast, scope, parent)
          elseif (_684_0 == "idempotent") then
            return idempotent_comparator(op, _3fchain_op, ast, scope, parent)
          elseif (_684_0 == "binding") then
            return binding_comparator(op, _3fchain_op, ast, scope, parent)
          else
            local _ = _684_0
            return error("internal compiler error. please report this to the fennel devs.")
          end
        end
        SPECIALS[name] = opfn
      end
      return doc_special(name, {"a", "b", "..."}, "Comparison operator; works the same as Lua but accepts more arguments.")
    end
    define_comparator_special(">")
    define_comparator_special("<")
    define_comparator_special(">=")
    define_comparator_special("<=")
    define_comparator_special("=", "==")
    define_comparator_special("not=", "~=", "or")
    local function define_unary_special(op, _3frealop)
      local function opfn(ast, scope, parent)
        compiler.assert((#ast == 2), "expected one argument", ast)
        local tail = compiler.compile1(ast[2], scope, parent, {nval = 1})
        return ((_3frealop or op) .. str1(tail))
      end
      SPECIALS[op] = opfn
      return nil
    end
    define_unary_special("not", "not ")
    doc_special("not", {"x"}, "Logical operator; works the same as Lua.")
    define_unary_special("length", "#")
    doc_special("length", {"x"}, "Returns the length of a table or string.")
    SPECIALS["~="] = SPECIALS["not="]
    SPECIALS["#"] = SPECIALS.length
    local function compile_time_3f(scope)
      return ((scope == compiler.scopes.compiler) or (scope.parent and compile_time_3f(scope.parent)))
    end
    SPECIALS.quote = function(ast, scope, parent)
      compiler.assert((#ast == 2), "expected one argument", ast)
      return compiler["do-quote"](ast[2], scope, parent, not compile_time_3f(scope))
    end
    doc_special("quote", {"x"}, "Quasiquote the following form. Only works in macro/compiler scope.")
    local macro_loaded = {}
    local function safe_getmetatable(tbl)
      local mt = getmetatable(tbl)
      assert((mt ~= getmetatable("")), "Illegal metatable access!")
      return mt
    end
    local function safe_open(filename, _3fmode)
      assert(((nil == _3fmode) or _3fmode:find("^r")), ("unsafe file mode: " .. tostring(_3fmode)))
      assert(not (filename:find("^/") or filename:find("%.%.")), ("unsafe file name: " .. filename))
      return io.open(filename, _3fmode)
    end
    local safe_require = nil
    local function safe_compiler_env()
      local _687_
      do
        local _686_0 = rawget(_G, "utf8")
        if (nil ~= _686_0) then
          _687_ = utils.copy(_686_0)
        else
          _687_ = _686_0
        end
      end
      return {_VERSION = _VERSION, assert = assert, bit = rawget(_G, "bit"), error = error, getmetatable = safe_getmetatable, io = {open = safe_open}, ipairs = ipairs, math = utils.copy(math), next = next, pairs = utils.stablepairs, pcall = pcall, print = print, rawequal = rawequal, rawget = rawget, rawlen = rawget(_G, "rawlen"), rawset = rawset, require = safe_require, select = select, setmetatable = setmetatable, string = utils.copy(string), table = utils.copy(table), tonumber = tonumber, tostring = tostring, type = type, utf8 = _687_, xpcall = xpcall}
    end
    local function combined_mt_pairs(env)
      local combined = {}
      local _689_ = getmetatable(env)
      local __index = _689_["__index"]
      if ("table" == type(__index)) then
        for k, v in pairs(__index) do
          combined[k] = v
        end
      end
      for k, v in next, env, nil do
        combined[k] = v
      end
      return next, combined, nil
    end
    local function make_compiler_env(_3fast, _3fscope, _3fparent, _3fopts)
      local provided = nil
      do
        local _691_0 = (_3fopts or utils.root.options)
        if ((_G.type(_691_0) == "table") and (_691_0["compiler-env"] == "strict")) then
          provided = safe_compiler_env()
        elseif ((_G.type(_691_0) == "table") and (nil ~= _691_0.compilerEnv)) then
          local compilerEnv = _691_0.compilerEnv
          provided = compilerEnv
        elseif ((_G.type(_691_0) == "table") and (nil ~= _691_0["compiler-env"])) then
          local compiler_env = _691_0["compiler-env"]
          provided = compiler_env
        elseif ((_G.type(_691_0) == "table") and (nil ~= _691_0["extra-compiler-env"])) then
          local extra_compiler_env = _691_0["extra-compiler-env"]
          local tbl_14_ = safe_compiler_env()
          for k, v in pairs(extra_compiler_env) do
            local k_15_, v_16_ = k, v
            if ((k_15_ ~= nil) and (v_16_ ~= nil)) then
              tbl_14_[k_15_] = v_16_
            end
          end
          provided = tbl_14_
        else
          local _ = _691_0
          provided = safe_compiler_env()
        end
      end
      local env = nil
      local function _694_()
        return compiler.scopes.macro
      end
      local function _695_(symbol)
        compiler.assert(compiler.scopes.macro, "must call from macro", _3fast)
        return compiler.scopes.macro.manglings[tostring(symbol)]
      end
      local function _696_(base)
        return utils.sym(compiler.gensym((compiler.scopes.macro or _3fscope), base))
      end
      local function _697_(form)
        compiler.assert(compiler.scopes.macro, "must call from macro", _3fast)
        return compiler.macroexpand(form, compiler.scopes.macro)
      end
      env = {["assert-compile"] = compiler.assert, ["ast-source"] = utils["ast-source"], ["comment?"] = utils["comment?"], ["fennel-module-name"] = fennel_module_name, ["get-scope"] = _694_, ["in-scope?"] = _695_, ["list?"] = utils["list?"], ["macro-loaded"] = macro_loaded, ["multi-sym?"] = utils["multi-sym?"], ["sequence?"] = utils["sequence?"], ["sym?"] = utils["sym?"], ["table?"] = utils["table?"], ["varg?"] = utils["varg?"], _AST = _3fast, _CHUNK = _3fparent, _IS_COMPILER = true, _SCOPE = _3fscope, _SPECIALS = compiler.scopes.global.specials, _VARARG = utils.varg(), comment = utils.comment, gensym = _696_, list = utils.list, macroexpand = _697_, pack = pack, sequence = utils.sequence, sym = utils.sym, unpack = unpack, version = utils.version, view = view}
      env._G = env
      return setmetatable(env, {__index = provided, __newindex = provided, __pairs = combined_mt_pairs})
    end
    local function _698_(...)
      local tbl_17_ = {}
      local i_18_ = #tbl_17_
      for c in string.gmatch((package.config or ""), "([^\n]+)") do
        local val_19_ = c
        if (nil ~= val_19_) then
          i_18_ = (i_18_ + 1)
          tbl_17_[i_18_] = val_19_
        end
      end
      return tbl_17_
    end
    local _700_ = _698_(...)
    local dirsep = _700_[1]
    local pathsep = _700_[2]
    local pathmark = _700_[3]
    local pkg_config = {dirsep = (dirsep or "/"), pathmark = (pathmark or "?"), pathsep = (pathsep or ";")}
    local function escapepat(str)
      return string.gsub(str, "[^%w]", "%%%1")
    end
    local function search_module(modulename, _3fpathstring)
      local pathsepesc = escapepat(pkg_config.pathsep)
      local pattern = ("([^%s]*)%s"):format(pathsepesc, pathsepesc)
      local no_dot_module = modulename:gsub("%.", pkg_config.dirsep)
      local fullpath = ((_3fpathstring or utils["fennel-module"].path) .. pkg_config.pathsep)
      local function try_path(path)
        local filename = path:gsub(escapepat(pkg_config.pathmark), no_dot_module)
        local _701_0 = io.open(filename)
        if (nil ~= _701_0) then
          local file = _701_0
          file:close()
          return filename
        else
          local _ = _701_0
          return nil, ("no file '" .. filename .. "'")
        end
      end
      local function find_in_path(start, _3ftried_paths)
        local _703_0 = fullpath:match(pattern, start)
        if (nil ~= _703_0) then
          local path = _703_0
          local _704_0, _705_0 = try_path(path)
          if (nil ~= _704_0) then
            local filename = _704_0
            return filename
          elseif ((_704_0 == nil) and (nil ~= _705_0)) then
            local error = _705_0
            local function _707_()
              local _706_0 = (_3ftried_paths or {})
              table.insert(_706_0, error)
              return _706_0
            end
            return find_in_path((start + #path + 1), _707_())
          end
        else
          local _ = _703_0
          local function _709_()
            local tried_paths = table.concat((_3ftried_paths or {}), "\n\9")
            if (_VERSION < "Lua 5.4") then
              return ("\n\9" .. tried_paths)
            else
              return tried_paths
            end
          end
          return nil, _709_()
        end
      end
      return find_in_path(1)
    end
    local function make_searcher(_3foptions)
      local function _712_(module_name)
        local opts = utils.copy(utils.root.options)
        for k, v in pairs((_3foptions or {})) do
          opts[k] = v
        end
        opts["module-name"] = module_name
        local _713_0, _714_0 = search_module(module_name, (_3foptions and _3foptions.path))
        if (nil ~= _713_0) then
          local filename = _713_0
          local function _715_(...)
            return utils["fennel-module"].dofile(filename, opts, ...)
          end
          return _715_, filename
        elseif ((_713_0 == nil) and (nil ~= _714_0)) then
          local error = _714_0
          return error
        end
      end
      return _712_
    end
    local function dofile_with_searcher(fennel_macro_searcher, filename, opts, ...)
      local searchers = (package.loaders or package.searchers or {})
      local _ = table.insert(searchers, 1, fennel_macro_searcher)
      local m = utils["fennel-module"].dofile(filename, opts, ...)
      table.remove(searchers, 1)
      return m
    end
    local function fennel_macro_searcher(module_name)
      local opts = nil
      do
        local _717_0 = utils.copy(utils.root.options)
        _717_0["module-name"] = module_name
        _717_0["env"] = "_COMPILER"
        _717_0["requireAsInclude"] = false
        _717_0["allowedGlobals"] = nil
        opts = _717_0
      end
      local _718_0 = search_module(module_name, utils["fennel-module"]["macro-path"])
      if (nil ~= _718_0) then
        local filename = _718_0
        local _719_
        if (opts["compiler-env"] == _G) then
          local function _720_(...)
            return dofile_with_searcher(fennel_macro_searcher, filename, opts, ...)
          end
          _719_ = _720_
        else
          local function _721_(...)
            return utils["fennel-module"].dofile(filename, opts, ...)
          end
          _719_ = _721_
        end
        return _719_, filename
      end
    end
    local function lua_macro_searcher(module_name)
      local _724_0 = search_module(module_name, package.path)
      if (nil ~= _724_0) then
        local filename = _724_0
        local code = nil
        do
          local f = io.open(filename)
          local function close_handlers_10_(ok_11_, ...)
            f:close()
            if ok_11_ then
              return ...
            else
              return error(..., 0)
            end
          end
          local function _726_()
            return assert(f:read("*a"))
          end
          code = close_handlers_10_(_G.xpcall(_726_, (package.loaded.fennel or debug).traceback))
        end
        local chunk = load_code(code, make_compiler_env(), filename)
        return chunk, filename
      end
    end
    local macro_searchers = {fennel_macro_searcher, lua_macro_searcher}
    local function search_macro_module(modname, n)
      local _728_0 = macro_searchers[n]
      if (nil ~= _728_0) then
        local f = _728_0
        local _729_0, _730_0 = f(modname)
        if ((nil ~= _729_0) and true) then
          local loader = _729_0
          local _3ffilename = _730_0
          return loader, _3ffilename
        else
          local _ = _729_0
          return search_macro_module(modname, (n + 1))
        end
      end
    end
    local function sandbox_fennel_module(modname)
      if ((modname == "fennel.macros") or (package and package.loaded and ("table" == type(package.loaded[modname])) and (package.loaded[modname].metadata == compiler.metadata))) then
        local function _733_(_, ...)
          return (compiler.metadata):setall(...)
        end
        return {metadata = {setall = _733_}, view = view}
      end
    end
    local function _735_(modname)
      local function _736_()
        local loader, filename = search_macro_module(modname, 1)
        compiler.assert(loader, (modname .. " module not found."))
        macro_loaded[modname] = loader(modname, filename)
        return macro_loaded[modname]
      end
      return (macro_loaded[modname] or sandbox_fennel_module(modname) or _736_())
    end
    safe_require = _735_
    local function add_macros(macros_2a, ast, scope)
      compiler.assert(utils["table?"](macros_2a), "expected macros to be table", ast)
      for k, v in pairs(macros_2a) do
        compiler.assert((type(v) == "function"), "expected each macro to be function", ast)
        compiler["check-binding-valid"](utils.sym(k), scope, ast, {["macro?"] = true})
        scope.macros[k] = v
      end
      return nil
    end
    local function resolve_module_name(_737_0, _scope, _parent, opts)
      local _738_ = _737_0
      local second = _738_[2]
      local filename = _738_["filename"]
      local filename0 = (filename or (utils["table?"](second) and second.filename))
      local module_name = utils.root.options["module-name"]
      local modexpr = compiler.compile(second, opts)
      local modname_chunk = load_code(modexpr)
      return modname_chunk(module_name, filename0)
    end
    SPECIALS["require-macros"] = function(ast, scope, parent, _3freal_ast)
      compiler.assert((#ast == 2), "Expected one module name argument", (_3freal_ast or ast))
      local modname = resolve_module_name(ast, scope, parent, {})
      compiler.assert(utils["string?"](modname), "module name must compile to string", (_3freal_ast or ast))
      if not macro_loaded[modname] then
        local loader, filename = search_macro_module(modname, 1)
        compiler.assert(loader, (modname .. " module not found."), ast)
        macro_loaded[modname] = compiler.assert(utils["table?"](loader(modname, filename)), "expected macros to be table", (_3freal_ast or ast))
      end
      if ("import-macros" == str1(ast)) then
        return macro_loaded[modname]
      else
        return add_macros(macro_loaded[modname], ast, scope)
      end
    end
    doc_special("require-macros", {"macro-module-name"}, "Load given module and use its contents as macro definitions in current scope.\nDeprecated.")
    local function emit_included_fennel(src, path, opts, sub_chunk)
      local subscope = compiler["make-scope"](utils.root.scope.parent)
      local forms = {}
      if utils.root.options.requireAsInclude then
        subscope.specials.require = compiler["require-include"]
      end
      for _, val in parser.parser(parser["string-stream"](src), path) do
        table.insert(forms, val)
      end
      for i = 1, #forms do
        local subopts = nil
        if (i == #forms) then
          subopts = {tail = true}
        else
          subopts = {nval = 0}
        end
        utils["propagate-options"](opts, subopts)
        compiler.compile1(forms[i], subscope, sub_chunk, subopts)
      end
      return nil
    end
    local function include_path(ast, opts, path, mod, fennel_3f)
      utils.root.scope.includes[mod] = "fnl/loading"
      local src = nil
      do
        local f = assert(io.open(path))
        local function close_handlers_10_(ok_11_, ...)
          f:close()
          if ok_11_ then
            return ...
          else
            return error(..., 0)
          end
        end
        local function _744_()
          return assert(f:read("*all")):gsub("[\13\n]*$", "")
        end
        src = close_handlers_10_(_G.xpcall(_744_, (package.loaded.fennel or debug).traceback))
      end
      local ret = utils.expr(("require(\"" .. mod .. "\")"), "statement")
      local target = ("package.preload[%q]"):format(mod)
      local preload_str = (target .. " = " .. target .. " or function(...)")
      local temp_chunk, sub_chunk = {}, {}
      compiler.emit(temp_chunk, preload_str, ast)
      compiler.emit(temp_chunk, sub_chunk)
      compiler.emit(temp_chunk, "end", ast)
      for _, v in ipairs(temp_chunk) do
        table.insert(utils.root.chunk, v)
      end
      if fennel_3f then
        emit_included_fennel(src, path, opts, sub_chunk)
      else
        compiler.emit(sub_chunk, src, ast)
      end
      utils.root.scope.includes[mod] = ret
      return ret
    end
    local function include_circular_fallback(mod, modexpr, fallback, ast)
      if (utils.root.scope.includes[mod] == "fnl/loading") then
        compiler.assert(fallback, "circular include detected", ast)
        return fallback(modexpr)
      end
    end
    SPECIALS.include = function(ast, scope, parent, opts)
      compiler.assert((#ast == 2), "expected one argument", ast)
      local modexpr = nil
      do
        local _747_0, _748_0 = pcall(resolve_module_name, ast, scope, parent, opts)
        if ((_747_0 == true) and (nil ~= _748_0)) then
          local modname = _748_0
          modexpr = utils.expr(string.format("%q", modname), "literal")
        else
          local _ = _747_0
          modexpr = compiler.compile1(ast[2], scope, parent, {nval = 1})[1]
        end
      end
      if ((modexpr.type ~= "literal") or ((modexpr[1]):byte() ~= 34)) then
        if opts.fallback then
          return opts.fallback(modexpr, true)
        else
          return compiler.assert(false, "module name must be string literal", ast)
        end
      else
        local mod = load_code(("return " .. modexpr[1]))()
        local oldmod = utils.root.options["module-name"]
        local _ = nil
        utils.root.options["module-name"] = mod
        _ = nil
        local res = nil
        local function _752_()
          local _751_0 = search_module(mod)
          if (nil ~= _751_0) then
            local fennel_path = _751_0
            return include_path(ast, opts, fennel_path, mod, true)
          else
            local _0 = _751_0
            local lua_path = search_module(mod, package.path)
            if lua_path then
              return include_path(ast, opts, lua_path, mod, false)
            elseif opts.fallback then
              return opts.fallback(modexpr)
            else
              return compiler.assert(false, ("module not found " .. mod), ast)
            end
          end
        end
        res = ((utils["member?"](mod, (utils.root.options.skipInclude or {})) and opts.fallback(modexpr, true)) or include_circular_fallback(mod, modexpr, opts.fallback, ast) or utils.root.scope.includes[mod] or _752_())
        utils.root.options["module-name"] = oldmod
        return res
      end
    end
    doc_special("include", {"module-name-literal"}, "Like require but load the target module during compilation and embed it in the\nLua output. The module must be a string literal and resolvable at compile time.")
    local function eval_compiler_2a(ast, scope, parent)
      local env = make_compiler_env(ast, scope, parent)
      local opts = utils.copy(utils.root.options)
      opts.scope = compiler["make-scope"](compiler.scopes.compiler)
      opts.allowedGlobals = current_global_names(env)
      return assert(load_code(compiler.compile(ast, opts), wrap_env(env)))(opts["module-name"], ast.filename)
    end
    SPECIALS.macros = function(ast, scope, parent)
      compiler.assert((#ast == 2), "Expected one table argument", ast)
      local macro_tbl = eval_compiler_2a(ast[2], scope, parent)
      compiler.assert(utils["table?"](macro_tbl), "Expected one table argument", ast)
      return add_macros(macro_tbl, ast, scope)
    end
    doc_special("macros", {"{:macro-name-1 (fn [...] ...) ... :macro-name-N macro-body-N}"}, "Define all functions in the given table as macros local to the current scope.")
    SPECIALS["tail!"] = function(ast, scope, parent, opts)
      compiler.assert((#ast == 2), "Expected one argument", ast)
      local call = utils["list?"](compiler.macroexpand(ast[2], scope))
      local callee = tostring((call and utils["sym?"](call[1])))
      compiler.assert((call and not scope.specials[callee]), "Expected a function call as argument", ast)
      compiler.assert(opts.tail, "Must be in tail position", ast)
      return compiler.compile1(call, scope, parent, opts)
    end
    doc_special("tail!", {"body"}, "Assert that the body being called is in tail position.")
    SPECIALS["pick-values"] = function(ast, scope, parent)
      local n = ast[2]
      local vals = utils.list(utils.sym("values"), unpack(ast, 3))
      compiler.assert((("number" == type(n)) and (0 <= n) and (n == math.floor(n))), ("Expected n to be an integer >= 0, got " .. tostring(n)))
      if (1 == n) then
        local _756_ = compiler.compile1(vals, scope, parent, {nval = 1})
        local _757_ = _756_[1]
        local expr = _757_[1]
        return {("(" .. expr .. ")")}
      elseif (0 == n) then
        for i = 3, #ast do
          compiler["keep-side-effects"](compiler.compile1(ast[i], scope, parent, {nval = 0}), parent, nil, ast[i])
        end
        return {}
      else
        local syms = nil
        do
          local tbl_17_ = utils.list()
          local i_18_ = #tbl_17_
          for _ = 1, n do
            local val_19_ = utils.sym(compiler.gensym(scope, "pv"))
            if (nil ~= val_19_) then
              i_18_ = (i_18_ + 1)
              tbl_17_[i_18_] = val_19_
            end
          end
          syms = tbl_17_
        end
        compiler.destructure(syms, vals, ast, scope, parent, {declaration = true, nomulti = true, noundef = true, symtype = "pv"})
        return syms
      end
    end
    doc_special("pick-values", {"n", "..."}, "Evaluate to exactly n values.\n\nFor example,\n  (pick-values 2 ...)\nexpands to\n  (let [(_0_ _1_) ...]\n    (values _0_ _1_))")
    SPECIALS["eval-compiler"] = function(ast, scope, parent)
      local old_first = ast[1]
      ast[1] = utils.sym("do")
      local val = eval_compiler_2a(ast, scope, parent)
      ast[1] = old_first
      return val
    end
    doc_special("eval-compiler", {"..."}, "Evaluate the body at compile-time. Use the macro system instead if possible.", true)
    SPECIALS.unquote = function(ast)
      return compiler.assert(false, "tried to use unquote outside quote", ast)
    end
    doc_special("unquote", {"..."}, "Evaluate the argument even if it's in a quoted form.")
    return {["current-global-names"] = current_global_names, ["get-function-metadata"] = get_function_metadata, ["load-code"] = load_code, ["macro-loaded"] = macro_loaded, ["macro-searchers"] = macro_searchers, ["make-compiler-env"] = make_compiler_env, ["make-searcher"] = make_searcher, ["search-module"] = search_module, ["wrap-env"] = wrap_env, doc = doc_2a}
  end
  package.preload["fennel.compiler"] = package.preload["fennel.compiler"] or function(...)
    local _300_ = require("fennel.utils")
    local utils = _300_
    local unpack = _300_["unpack"]
    local parser = require("fennel.parser")
    local friend = require("fennel.friend")
    local view = require("fennel.view")
    local scopes = {compiler = nil, global = nil, macro = nil}
    local function make_scope(_3fparent)
      local parent = (_3fparent or scopes.global)
      local _301_
      if parent then
        _301_ = ((parent.depth or 0) + 1)
      else
        _301_ = 0
      end
      return {["gensym-base"] = setmetatable({}, {__index = (parent and parent["gensym-base"])}), autogensyms = setmetatable({}, {__index = (parent and parent.autogensyms)}), depth = _301_, gensyms = setmetatable({}, {__index = (parent and parent.gensyms)}), hashfn = (parent and parent.hashfn), includes = setmetatable({}, {__index = (parent and parent.includes)}), macros = setmetatable({}, {__index = (parent and parent.macros)}), manglings = setmetatable({}, {__index = (parent and parent.manglings)}), parent = parent, refedglobals = {}, specials = setmetatable({}, {__index = (parent and parent.specials)}), symmeta = setmetatable({}, {__index = (parent and parent.symmeta)}), unmanglings = setmetatable({}, {__index = (parent and parent.unmanglings)}), vararg = (parent and parent.vararg)}
    end
    local function assert_msg(ast, msg)
      local ast_tbl = nil
      if ("table" == type(ast)) then
        ast_tbl = ast
      else
        ast_tbl = {}
      end
      local m = getmetatable(ast)
      local filename = ((m and m.filename) or ast_tbl.filename or "unknown")
      local line = ((m and m.line) or ast_tbl.line or "?")
      local col = ((m and m.col) or ast_tbl.col or "?")
      local target = tostring((utils["sym?"](ast_tbl[1]) or ast_tbl[1] or "()"))
      return string.format("%s:%s:%s: Compile error in '%s': %s", filename, line, col, target, msg)
    end
    local function assert_compile(condition, msg, _3fast, _3ffallback_ast)
      if not condition then
        local _304_ = (utils.root.options or {})
        local error_pinpoint = _304_["error-pinpoint"]
        local source = _304_["source"]
        local unfriendly = _304_["unfriendly"]
        local ast = nil
        if next(utils["ast-source"](_3fast)) then
          ast = _3fast
        else
          ast = (_3ffallback_ast or {})
        end
        if (nil == utils.hook("assert-compile", condition, msg, ast, utils.root.reset)) then
          utils.root.reset()
          if unfriendly then
            error(assert_msg(ast, msg), 0)
          else
            friend["assert-compile"](condition, msg, ast, source, {["error-pinpoint"] = error_pinpoint})
          end
        end
      end
      return condition
    end
    scopes.global = make_scope()
    scopes.global.vararg = true
    scopes.compiler = make_scope(scopes.global)
    scopes.macro = scopes.global
    local serialize_string = nil
    do
      local subst_digits = {["\\10"] = "\\n", ["\\11"] = "\\v", ["\\12"] = "\\f", ["\\13"] = "\\r", ["\\7"] = "\\a", ["\\8"] = "\\b", ["\\9"] = "\\t"}
      local function _309_(str)
        local function _310_(_241, _242)
          if (0 == (_241:len() % 2)) then
            local _311_0 = subst_digits[_242]
            if (_311_0 ~= nil) then
              return (_241 .. _311_0)
            else
              return _311_0
            end
          end
        end
        local function _314_(_241)
          return ("\\" .. _241:byte())
        end
        return string.format("%q", str):gsub("\\\n", "\\n"):gsub("(\\*)(\\%d%d?%d?)", _310_):gsub("[\127-\255]", _314_)
      end
      serialize_string = _309_
    end
    local function global_mangling(str)
      if utils["valid-lua-identifier?"](str) then
        return str
      else
        local _316_
        do
          local _315_0 = utils.root.options
          if (nil ~= _315_0) then
            _315_0 = _315_0["global-mangle"]
          end
          _316_ = _315_0
        end
        if (_316_ == false) then
          return ("_G[%q]"):format(str)
        else
          local function _318_(_241)
            return string.format("_%02x", _241:byte())
          end
          return ("__fnl_global__" .. str:gsub("[^%w]", _318_))
        end
      end
    end
    local function global_unmangling(identifier)
      local _320_0 = string.match(identifier, "^__fnl_global__(.*)$")
      if (nil ~= _320_0) then
        local rest = _320_0
        local _321_0 = nil
        local function _322_(_241)
          return string.char(tonumber(_241:sub(2), 16))
        end
        _321_0 = rest:gsub("_[%da-f][%da-f]", _322_)
        return _321_0
      else
        local _ = _320_0
        return identifier
      end
    end
    local function global_allowed_3f(name)
      local allowed = nil
      do
        local _324_0 = utils.root.options
        if (nil ~= _324_0) then
          _324_0 = _324_0.allowedGlobals
        end
        allowed = _324_0
      end
      return (not allowed or utils["member?"](name, allowed))
    end
    local function unique_mangling(original, mangling, scope, append)
      if scope.unmanglings[mangling] then
        return unique_mangling(original, (original .. append), scope, (append + 1))
      else
        return mangling
      end
    end
    local function apply_deferred_scope_changes(scope, deferred_scope_changes, ast)
      for raw, mangled in pairs(deferred_scope_changes.manglings) do
        assert_compile(not scope.refedglobals[mangled], ("use of global " .. raw .. " is aliased by a local"), ast)
        scope.manglings[raw] = mangled
      end
      for raw, symmeta in pairs(deferred_scope_changes.symmeta) do
        scope.symmeta[raw] = symmeta
      end
      return nil
    end
    local function combine_parts(parts, scope)
      local ret = (scope.manglings[parts[1]] or global_mangling(parts[1]))
      for i = 2, #parts do
        if utils["valid-lua-identifier?"](parts[i]) then
          if (parts["multi-sym-method-call"] and (i == #parts)) then
            ret = (ret .. ":" .. parts[i])
          else
            ret = (ret .. "." .. parts[i])
          end
        else
          ret = (ret .. "[" .. serialize_string(parts[i]) .. "]")
        end
      end
      return ret
    end
    local function root_scope(scope)
      return ((utils.root and utils.root.scope) or (scope.parent and root_scope(scope.parent)) or scope)
    end
    local function next_append(root_scope_2a)
      root_scope_2a["gensym-append"] = ((root_scope_2a["gensym-append"] or 0) + 1)
      return ("_" .. root_scope_2a["gensym-append"] .. "_")
    end
    local function gensym(scope, _3fbase, _3fsuffix)
      local root_scope_2a = root_scope(scope)
      local mangling = ((_3fbase or "") .. next_append(root_scope_2a) .. (_3fsuffix or ""))
      while scope.unmanglings[mangling] do
        mangling = ((_3fbase or "") .. next_append(root_scope_2a) .. (_3fsuffix or ""))
      end
      if (_3fbase and (0 < #_3fbase)) then
        scope["gensym-base"][mangling] = _3fbase
      end
      scope.gensyms[mangling] = true
      return mangling
    end
    local function combine_auto_gensym(parts, first)
      parts[1] = first
      local last = table.remove(parts)
      local last2 = table.remove(parts)
      local last_joiner = ((parts["multi-sym-method-call"] and ":") or ".")
      table.insert(parts, (last2 .. last_joiner .. last))
      return table.concat(parts, ".")
    end
    local function autogensym(base, scope)
      local _330_0 = utils["multi-sym?"](base)
      if (nil ~= _330_0) then
        local parts = _330_0
        return combine_auto_gensym(parts, autogensym(parts[1], scope))
      else
        local _ = _330_0
        local function _331_()
          local mangling = gensym(scope, base:sub(1, -2), "auto")
          scope.autogensyms[base] = mangling
          return mangling
        end
        return (scope.autogensyms[base] or _331_())
      end
    end
    local function check_binding_valid(symbol, scope, ast, _3fopts)
      local name = tostring(symbol)
      local part1 = nil
      do
        local _333_0 = utils["multi-sym?"](symbol)
        if ((_G.type(_333_0) == "table") and (nil ~= _333_0[1])) then
          local p = _333_0[1]
          part1 = p
        else
        part1 = nil
        end
      end
      local macro_3f = nil
      do
        local _335_0 = _3fopts
        if (nil ~= _335_0) then
          _335_0 = _335_0["macro?"]
        end
        macro_3f = _335_0
      end
      assert_compile(("&" ~= name:match("[&.:]")), "invalid character: &", symbol)
      assert_compile(not name:find("^%."), "invalid character: .", symbol)
      assert_compile(not (scope.specials[(part1 or name)] or (not macro_3f and scope.macros[(part1 or name)])), ("local %s was overshadowed by a special form or macro"):format(name), ast)
      assert_compile((not macro_3f or not part1 or not scope.macros[part1]), "tried to set multisym macro on existing macro", ast)
      return assert_compile(not utils["quoted?"](symbol), string.format("macro tried to bind %s without gensym", name), symbol)
    end
    local function declare_local(symbol, scope, ast, _3fvar_3f, _3fdeferred_scope_changes)
      check_binding_valid(symbol, scope, ast)
      assert_compile(not utils["multi-sym?"](symbol), ("unexpected multi symbol " .. tostring(symbol)), ast)
      local str = tostring(symbol)
      local raw = nil
      if (utils["lua-keyword?"](str) or str:match("^%d")) then
        raw = ("_" .. str)
      else
        raw = str
      end
      local mangling = nil
      local function _338_(_241)
        return string.format("_%02x", _241:byte())
      end
      mangling = string.gsub(string.gsub(raw, "-", "_"), "[^%w_]", _338_)
      local unique = unique_mangling(mangling, mangling, scope, 0)
      scope.unmanglings[unique] = (scope["gensym-base"][str] or str)
      do
        local target = (_3fdeferred_scope_changes or scope)
        target.manglings[str] = unique
        target.symmeta[str] = {symbol = symbol, var = _3fvar_3f}
      end
      return unique
    end
    local function hashfn_arg_name(name, multi_sym_parts, scope)
      if not scope.hashfn then
        return nil
      elseif (name == "$") then
        return "$1"
      elseif multi_sym_parts then
        if (multi_sym_parts and (multi_sym_parts[1] == "$")) then
          multi_sym_parts[1] = "$1"
        end
        return table.concat(multi_sym_parts, ".")
      end
    end
    local function symbol_to_expression(symbol, scope, _3freference_3f)
      utils.hook("symbol-to-expression", symbol, scope, _3freference_3f)
      local name = symbol[1]
      local multi_sym_parts = utils["multi-sym?"](name)
      local name0 = (hashfn_arg_name(name, multi_sym_parts, scope) or name)
      local parts = (multi_sym_parts or {name0})
      local etype = (((1 < #parts) and "expression") or "sym")
      local local_3f = scope.manglings[parts[1]]
      if (local_3f and scope.symmeta[parts[1]]) then
        scope.symmeta[parts[1]]["used"] = true
        symbol.referent = scope.symmeta[parts[1]].symbol
      end
      assert_compile(not scope.macros[parts[1]], "tried to reference a macro without calling it", symbol)
      assert_compile((not scope.specials[parts[1]] or ("require" == parts[1])), "tried to reference a special form without calling it", symbol)
      assert_compile((not _3freference_3f or local_3f or ("_ENV" == parts[1]) or global_allowed_3f(parts[1])), ("unknown identifier: " .. tostring(parts[1])), symbol)
      local function _343_()
        local _342_0 = utils.root.options
        if (nil ~= _342_0) then
          _342_0 = _342_0.allowedGlobals
        end
        return _342_0
      end
      if (_343_() and not local_3f and scope.parent) then
        scope.parent.refedglobals[parts[1]] = true
      end
      return utils.expr(combine_parts(parts, scope), etype)
    end
    local function emit(chunk, out, _3fast)
      if (type(out) == "table") then
        return table.insert(chunk, out)
      else
        return table.insert(chunk, {ast = _3fast, leaf = out})
      end
    end
    local function peephole(chunk)
      if chunk.leaf then
        return chunk
      elseif ((3 <= #chunk) and (chunk[(#chunk - 2)].leaf == "do") and not chunk[(#chunk - 1)].leaf and (chunk[#chunk].leaf == "end")) then
        local kid = peephole(chunk[(#chunk - 1)])
        local new_chunk = {ast = chunk.ast}
        for i = 1, (#chunk - 3) do
          table.insert(new_chunk, peephole(chunk[i]))
        end
        for i = 1, #kid do
          table.insert(new_chunk, kid[i])
        end
        return new_chunk
      else
        local tbl_17_ = {}
        local i_18_ = #tbl_17_
        for _, x in ipairs(chunk) do
          local val_19_ = peephole(x)
          if (nil ~= val_19_) then
            i_18_ = (i_18_ + 1)
            tbl_17_[i_18_] = val_19_
          end
        end
        return tbl_17_
      end
    end
    local function flatten_chunk_correlated(main_chunk, options)
      local function flatten(chunk, out, last_line, file)
        local last_line0 = last_line
        if chunk.leaf then
          out[last_line0] = ((out[last_line0] or "") .. " " .. chunk.leaf)
        else
          for _, subchunk in ipairs(chunk) do
            if (subchunk.leaf or next(subchunk)) then
              local source = utils["ast-source"](subchunk.ast)
              if (file == source.filename) then
                last_line0 = math.max(last_line0, (source.line or 0))
              end
              last_line0 = flatten(subchunk, out, last_line0, file)
            end
          end
        end
        return last_line0
      end
      local out = {}
      local last = flatten(main_chunk, out, 1, options.filename)
      for i = 1, last do
        if (out[i] == nil) then
          out[i] = ""
        end
      end
      return table.concat(out, "\n")
    end
    local function flatten_chunk(file_sourcemap, chunk, tab, depth)
      if chunk.leaf then
        local _353_ = utils["ast-source"](chunk.ast)
        local endline = _353_["endline"]
        local filename = _353_["filename"]
        local line = _353_["line"]
        if ("end" == chunk.leaf) then
          table.insert(file_sourcemap, {filename, (endline or line)})
        else
          table.insert(file_sourcemap, {filename, line})
        end
        return chunk.leaf
      else
        local tab0 = nil
        do
          local _355_0 = tab
          if (_355_0 == true) then
            tab0 = "  "
          elseif (_355_0 == false) then
            tab0 = ""
          elseif (nil ~= _355_0) then
            local tab1 = _355_0
            tab0 = tab1
          elseif (_355_0 == nil) then
            tab0 = ""
          else
          tab0 = nil
          end
        end
        local _357_
        do
          local tbl_17_ = {}
          local i_18_ = #tbl_17_
          for _, c in ipairs(chunk) do
            local val_19_ = nil
            if (c.leaf or next(c)) then
              local sub = flatten_chunk(file_sourcemap, c, tab0, (depth + 1))
              if (0 < depth) then
                val_19_ = (tab0 .. sub:gsub("\n", ("\n" .. tab0)))
              else
                val_19_ = sub
              end
            else
            val_19_ = nil
            end
            if (nil ~= val_19_) then
              i_18_ = (i_18_ + 1)
              tbl_17_[i_18_] = val_19_
            end
          end
          _357_ = tbl_17_
        end
        return table.concat(_357_, "\n")
      end
    end
    local sourcemap = {}
    local function make_short_src(source)
      local source0 = source:gsub("\n", " ")
      if (#source0 <= 49) then
        return ("[fennel \"" .. source0 .. "\"]")
      else
        return ("[fennel \"" .. source0:sub(1, 46) .. "...\"]")
      end
    end
    local function flatten(chunk, options)
      local chunk0 = peephole(chunk)
      local indent = (options.indent or "  ")
      if options.correlate then
        return flatten_chunk_correlated(chunk0, options), {}
      else
        local file_sourcemap = {}
        local src = flatten_chunk(file_sourcemap, chunk0, indent, 0)
        file_sourcemap.short_src = (options.filename or make_short_src((options.source or src)))
        if options.filename then
          file_sourcemap.key = ("@" .. options.filename)
        else
          file_sourcemap.key = src
        end
        sourcemap[file_sourcemap.key] = file_sourcemap
        return src, file_sourcemap
      end
    end
    local function make_metadata()
      local function _365_(self, tgt, _3fkey)
        if self[tgt] then
          if (nil ~= _3fkey) then
            return self[tgt][_3fkey]
          else
            return self[tgt]
          end
        end
      end
      local function _368_(self, tgt, key, value)
        self[tgt] = (self[tgt] or {})
        self[tgt][key] = value
        return tgt
      end
      local function _369_(self, tgt, ...)
        local kv_len = select("#", ...)
        local kvs = {...}
        if ((kv_len % 2) ~= 0) then
          error("metadata:setall() expected even number of k/v pairs")
        end
        self[tgt] = (self[tgt] or {})
        for i = 1, kv_len, 2 do
          self[tgt][kvs[i]] = kvs[(i + 1)]
        end
        return tgt
      end
      return setmetatable({}, {__index = {get = _365_, set = _368_, setall = _369_}, __mode = "k"})
    end
    local function exprs1(exprs)
      local _371_
      do
        local tbl_17_ = {}
        local i_18_ = #tbl_17_
        for _, e in ipairs(exprs) do
          local val_19_ = tostring(e)
          if (nil ~= val_19_) then
            i_18_ = (i_18_ + 1)
            tbl_17_[i_18_] = val_19_
          end
        end
        _371_ = tbl_17_
      end
      return table.concat(_371_, ", ")
    end
    local function keep_side_effects(exprs, chunk, _3fstart, ast)
      for j = (_3fstart or 1), #exprs do
        local subexp = exprs[j]
        if ((subexp.type == "expression") and (subexp[1] ~= "nil")) then
          emit(chunk, ("do local _ = %s end"):format(tostring(subexp)), ast)
        elseif (subexp.type == "statement") then
          local code = tostring(subexp)
          local disambiguated = nil
          if (code:byte() == 40) then
            disambiguated = ("do end " .. code)
          else
            disambiguated = code
          end
          emit(chunk, disambiguated, ast)
        end
      end
      return nil
    end
    local function handle_compile_opts(exprs, parent, opts, _3fast)
      if opts.nval then
        local n = opts.nval
        local len = #exprs
        if (n ~= len) then
          if (n < len) then
            keep_side_effects(exprs, parent, (n + 1), _3fast)
            for i = (n + 1), len do
              exprs[i] = nil
            end
          else
            for i = (#exprs + 1), n do
              exprs[i] = utils.expr("nil", "literal")
            end
          end
        end
      end
      if opts.tail then
        emit(parent, string.format("return %s", exprs1(exprs)), _3fast)
      end
      if opts.target then
        local result = exprs1(exprs)
        local function _379_()
          if (result == "") then
            return "nil"
          else
            return result
          end
        end
        emit(parent, string.format("%s = %s", opts.target, _379_()), _3fast)
      end
      if (opts.tail or opts.target) then
        return {returned = true}
      else
        exprs["returned"] = true
        return exprs
      end
    end
    local function find_macro(ast, scope)
      local macro_2a = nil
      do
        local _382_0 = utils["sym?"](ast[1])
        if (_382_0 ~= nil) then
          local _383_0 = tostring(_382_0)
          if (_383_0 ~= nil) then
            macro_2a = scope.macros[_383_0]
          else
            macro_2a = _383_0
          end
        else
          macro_2a = _382_0
        end
      end
      local multi_sym_parts = utils["multi-sym?"](ast[1])
      if (not macro_2a and multi_sym_parts) then
        local nested_macro = utils["get-in"](scope.macros, multi_sym_parts)
        assert_compile((not scope.macros[multi_sym_parts[1]] or (type(nested_macro) == "function")), "macro not found in imported macro module", ast)
        return nested_macro
      else
        return macro_2a
      end
    end
    local function propagate_trace_info(_387_0, _index, node)
      local _388_ = _387_0
      local byteend = _388_["byteend"]
      local bytestart = _388_["bytestart"]
      local col = _388_["col"]
      local filename = _388_["filename"]
      local line = _388_["line"]
      if ("table" == type(node)) then
        local src = nil
        if getmetatable(node) then
          src = utils["ast-source"](node)
        else
          local _389_0 = {}
          setmetatable(node, _389_0)
          src = _389_0
        end
        if (filename ~= src.filename) then
          src.filename, src.line, src.col, src["from-macro?"] = filename, line, col, true
          src.bytestart, src.byteend = bytestart, byteend
        end
      end
      return ("table" == type(node))
    end
    local function quote_literal_nils(index, node, parent)
      if (parent and utils["list?"](parent)) then
        for i = 1, utils.maxn(parent) do
          if (nil == parent[i]) then
            parent[i] = utils.sym("nil")
          end
        end
      end
      return index, node, parent
    end
    local function built_in_3f(m)
      local found_3f = false
      for _, f in pairs(scopes.global.macros) do
        if found_3f then break end
        found_3f = (f == m)
      end
      return found_3f
    end
    local function macro_traceback(msg)
      if utils["debug-on?"]() then
        return debug.traceback(msg, 2)
      else
        local _396_
        do
          local _395_0 = nil
          do
            local tbl_17_ = {}
            local i_18_ = #tbl_17_
            for l in debug.traceback(msg, 2):gmatch("([^\n]+)") do
              if l:find("function 'fennel.compiler.macroexpand'$") then break end
              local val_19_ = l
              if (nil ~= val_19_) then
                i_18_ = (i_18_ + 1)
                tbl_17_[i_18_] = val_19_
              end
            end
            _395_0 = tbl_17_
          end
          table.remove(_395_0)
          _396_ = _395_0
        end
        return table.concat(_396_, "\n")
      end
    end
    local function macroexpand_2a(ast, scope, _3fonce)
      local _399_0 = nil
      if utils["list?"](ast) then
        _399_0 = find_macro(ast, scope)
      else
      _399_0 = nil
      end
      if (_399_0 == false) then
        return ast
      elseif (nil ~= _399_0) then
        local macro_2a = _399_0
        local old_scope = scopes.macro
        local _ = nil
        scopes.macro = scope
        _ = nil
        local ok, transformed = nil, nil
        local function _401_()
          return macro_2a(unpack(ast, 2))
        end
        local function _402_()
          if built_in_3f(macro_2a) then
            return tostring
          else
            return macro_traceback
          end
        end
        ok, transformed = xpcall(_401_, _402_())
        local function _403_(...)
          return propagate_trace_info(ast, quote_literal_nils(...))
        end
        utils["walk-tree"](transformed, _403_)
        scopes.macro = old_scope
        assert_compile(ok, transformed, ast)
        utils.hook("macroexpand", ast, transformed, scope)
        if (_3fonce or not transformed) then
          return transformed
        else
          return macroexpand_2a(transformed, scope)
        end
      else
        local _ = _399_0
        return ast
      end
    end
    local function compile_special(ast, scope, parent, opts, special)
      local exprs = (special(ast, scope, parent, opts) or utils.expr("nil", "literal"))
      local exprs0 = nil
      if ("table" ~= type(exprs)) then
        exprs0 = utils.expr(exprs, "expression")
      else
        exprs0 = exprs
      end
      local exprs2 = nil
      if utils["expr?"](exprs0) then
        exprs2 = {exprs0}
      else
        exprs2 = exprs0
      end
      if not exprs2.returned then
        return handle_compile_opts(exprs2, parent, opts, ast)
      elseif (opts.tail or opts.target) then
        return {returned = true}
      else
        return exprs2
      end
    end
    local function callable_3f(_409_0, ctype, callee)
      local _410_ = _409_0
      local call_ast = _410_[1]
      if ("literal" == ctype) then
        return ("\"" == string.sub(callee, 1, 1))
      else
        return (utils["sym?"](call_ast) or utils["list?"](call_ast))
      end
    end
    local function compile_function_call(ast, scope, parent, opts, compile1, len)
      local _412_ = compile1(ast[1], scope, parent, {nval = 1})[1]
      local callee = _412_[1]
      local ctype = _412_["type"]
      local fargs = {}
      assert_compile(callable_3f(ast, ctype, callee), ("cannot call literal value " .. tostring(ast[1])), ast)
      for i = 2, len do
        local subexprs = nil
        local _413_
        if (i ~= len) then
          _413_ = 1
        else
        _413_ = nil
        end
        subexprs = compile1(ast[i], scope, parent, {nval = _413_})
        table.insert(fargs, subexprs[1])
        if (i == len) then
          for j = 2, #subexprs do
            table.insert(fargs, subexprs[j])
          end
        else
          keep_side_effects(subexprs, parent, 2, ast[i])
        end
      end
      local pat = nil
      if ("literal" == ctype) then
        pat = "(%s)(%s)"
      else
        pat = "%s(%s)"
      end
      local call = string.format(pat, tostring(callee), exprs1(fargs))
      return handle_compile_opts({utils.expr(call, "statement")}, parent, opts, ast)
    end
    local function compile_call(ast, scope, parent, opts, compile1)
      utils.hook("call", ast, scope)
      local len = #ast
      local first = ast[1]
      local multi_sym_parts = utils["multi-sym?"](first)
      local special = (utils["sym?"](first) and scope.specials[tostring(first)])
      assert_compile((0 < len), "expected a function, macro, or special to call", ast)
      if special then
        return compile_special(ast, scope, parent, opts, special)
      elseif (multi_sym_parts and multi_sym_parts["multi-sym-method-call"]) then
        local table_with_method = table.concat({unpack(multi_sym_parts, 1, (#multi_sym_parts - 1))}, ".")
        local method_to_call = multi_sym_parts[#multi_sym_parts]
        local new_ast = utils.list(utils.sym(":", ast), utils.sym(table_with_method, ast), method_to_call, select(2, unpack(ast)))
        return compile1(new_ast, scope, parent, opts)
      else
        return compile_function_call(ast, scope, parent, opts, compile1, len)
      end
    end
    local function compile_varg(ast, scope, parent, opts)
      local _418_
      if scope.hashfn then
        _418_ = "use $... in hashfn"
      else
        _418_ = "unexpected vararg"
      end
      assert_compile(scope.vararg, _418_, ast)
      return handle_compile_opts({utils.expr("...", "varg")}, parent, opts, ast)
    end
    local function compile_sym(ast, scope, parent, opts)
      local multi_sym_parts = utils["multi-sym?"](ast)
      assert_compile(not (multi_sym_parts and multi_sym_parts["multi-sym-method-call"]), "multisym method calls may only be in call position", ast)
      local e = nil
      if (ast[1] == "nil") then
        e = utils.expr("nil", "literal")
      else
        e = symbol_to_expression(ast, scope, true)
      end
      return handle_compile_opts({e}, parent, opts, ast)
    end
    local view_opts = nil
    do
      local nan = tostring((0 / 0))
      local _421_
      if (45 == nan:byte()) then
        _421_ = "(0/0)"
      else
        _421_ = "(- (0/0))"
      end
      local _423_
      if (45 == nan:byte()) then
        _423_ = "(- (0/0))"
      else
        _423_ = "(0/0)"
      end
      view_opts = {["negative-infinity"] = "(-1/0)", ["negative-nan"] = _421_, infinity = "(1/0)", nan = _423_}
    end
    local function serialize_scalar(ast)
      local _425_0 = type(ast)
      if (_425_0 == "nil") then
        return "nil"
      elseif (_425_0 == "boolean") then
        return tostring(ast)
      elseif (_425_0 == "string") then
        return serialize_string(ast)
      elseif (_425_0 == "number") then
        return view(ast, view_opts)
      end
    end
    local function compile_scalar(ast, _scope, parent, opts)
      return handle_compile_opts({utils.expr(serialize_scalar(ast), "literal")}, parent, opts)
    end
    local function compile_table(ast, scope, parent, opts, compile1)
      local function escape_key(k)
        if ((type(k) == "string") and utils["valid-lua-identifier?"](k)) then
          return k
        else
          local _427_ = compile1(k, scope, parent, {nval = 1})
          local compiled = _427_[1]
          return ("[" .. tostring(compiled) .. "]")
        end
      end
      local keys = {}
      local buffer = nil
      do
        local tbl_17_ = {}
        local i_18_ = #tbl_17_
        for i, elem in ipairs(ast) do
          local val_19_ = nil
          do
            local nval = ((nil ~= ast[(i + 1)]) and 1)
            keys[i] = true
            val_19_ = exprs1(compile1(elem, scope, parent, {nval = nval}))
          end
          if (nil ~= val_19_) then
            i_18_ = (i_18_ + 1)
            tbl_17_[i_18_] = val_19_
          end
        end
        buffer = tbl_17_
      end
      do
        local tbl_17_ = buffer
        local i_18_ = #tbl_17_
        for k in utils.stablepairs(ast) do
          local val_19_ = nil
          if not keys[k] then
            local _430_ = compile1(ast[k], scope, parent, {nval = 1})
            local v = _430_[1]
            val_19_ = string.format("%s = %s", escape_key(k), tostring(v))
          else
          val_19_ = nil
          end
          if (nil ~= val_19_) then
            i_18_ = (i_18_ + 1)
            tbl_17_[i_18_] = val_19_
          end
        end
      end
      return handle_compile_opts({utils.expr(("{" .. table.concat(buffer, ", ") .. "}"), "expression")}, parent, opts, ast)
    end
    local function compile1(ast, scope, parent, _3fopts)
      local opts = (_3fopts or {})
      local ast0 = macroexpand_2a(ast, scope)
      if utils["list?"](ast0) then
        return compile_call(ast0, scope, parent, opts, compile1)
      elseif utils["varg?"](ast0) then
        return compile_varg(ast0, scope, parent, opts)
      elseif utils["sym?"](ast0) then
        return compile_sym(ast0, scope, parent, opts)
      elseif (type(ast0) == "table") then
        return compile_table(ast0, scope, parent, opts, compile1)
      elseif ((type(ast0) == "nil") or (type(ast0) == "boolean") or (type(ast0) == "number") or (type(ast0) == "string")) then
        return compile_scalar(ast0, scope, parent, opts)
      else
        return assert_compile(false, ("could not compile value of type " .. type(ast0)), ast0)
      end
    end
    local function destructure(to, from, ast, scope, parent, opts)
      local opts0 = (opts or {})
      local _434_ = opts0
      local declaration = _434_["declaration"]
      local forceglobal = _434_["forceglobal"]
      local forceset = _434_["forceset"]
      local isvar = _434_["isvar"]
      local symtype = _434_["symtype"]
      local symtype0 = ("_" .. (symtype or "dst"))
      local setter = nil
      if declaration then
        setter = "local %s = %s"
      else
        setter = "%s = %s"
      end
      local deferred_scope_changes = {manglings = {}, symmeta = {}}
      local function getname(symbol, ast0)
        local raw = symbol[1]
        assert_compile(not (opts0.nomulti and utils["multi-sym?"](raw)), ("unexpected multi symbol " .. raw), ast0)
        if declaration then
          return declare_local(symbol, scope, symbol, isvar, deferred_scope_changes)
        else
          local parts = (utils["multi-sym?"](raw) or {raw})
          local _436_ = parts
          local first = _436_[1]
          local meta = scope.symmeta[first]
          assert_compile(not raw:find(":"), "cannot set method sym", symbol)
          if ((#parts == 1) and not forceset) then
            assert_compile(not (forceglobal and meta), string.format("global %s conflicts with local", tostring(symbol)), symbol)
            assert_compile(not (meta and not meta.var), ("expected var " .. raw), symbol)
          end
          assert_compile((meta or not opts0.noundef or (scope.hashfn and ("$" == first)) or global_allowed_3f(first)), ("expected local " .. first), symbol)
          if forceglobal then
            assert_compile(not scope.symmeta[scope.unmanglings[raw]], ("global " .. raw .. " conflicts with local"), symbol)
            scope.manglings[raw] = global_mangling(raw)
            scope.unmanglings[global_mangling(raw)] = raw
            local _439_
            do
              local _438_0 = utils.root.options
              if (nil ~= _438_0) then
                _438_0 = _438_0.allowedGlobals
              end
              _439_ = _438_0
            end
            if _439_ then
              local _442_
              do
                local _441_0 = utils.root.options
                if (nil ~= _441_0) then
                  _441_0 = _441_0.allowedGlobals
                end
                _442_ = _441_0
              end
              table.insert(_442_, raw)
            end
          end
          return symbol_to_expression(symbol, scope)[1]
        end
      end
      local function compile_top_target(targets)
        local plen = #parent
        local target = table.concat(targets, ", ")
        local plast = parent[#parent]
        local ret = compile1(from, scope, parent, {target = target})
        if declaration then
          for pi = plen, #parent do
            if (parent[pi] == plast) then
              plen = pi
            end
          end
          if ((#parent == (plen + 1)) and parent[#parent].leaf) then
            parent[#parent]["leaf"] = ("local " .. parent[#parent].leaf)
          else
            table.insert(parent, (plen + 1), {ast = ast, leaf = ("local " .. target)})
          end
        end
        return ret
      end
      local function destructure_sym(left, rightexprs, up1, _3ftop_3f)
        local lname = getname(left, up1)
        check_binding_valid(left, scope, left)
        if _3ftop_3f then
          return compile_top_target({lname})
        else
          return emit(parent, setter:format(lname, exprs1(rightexprs)), left)
        end
      end
      local function destructure_close(left, up1)
        local target = string.format("local %s <close>", getname(left, up1))
        return compile1(from, scope, parent, {target = target})
      end
      local function dynamic_set_target(_451_0)
        local _452_ = _451_0
        local _ = _452_[1]
        local target = _452_[2]
        local keys = {(table.unpack or unpack)(_452_, 3)}
        assert_compile(utils["sym?"](target), "dynamic set needs symbol target", ast)
        assert_compile(next(keys), "dynamic set needs at least one key", ast)
        local keys0 = nil
        do
          local tbl_17_ = {}
          local i_18_ = #tbl_17_
          for _0, k in ipairs(keys) do
            local val_19_ = tostring(compile1(k, scope, parent, {nval = 1})[1])
            if (nil ~= val_19_) then
              i_18_ = (i_18_ + 1)
              tbl_17_[i_18_] = val_19_
            end
          end
          keys0 = tbl_17_
        end
        return string.format("%s[%s]", tostring(symbol_to_expression(target, scope, true)), table.concat(keys0, "]["))
      end
      local function destructure_values(left, rightexprs, up1, destructure1, _3ftop_3f)
        local left_names, tables = {}, {}
        for i, name in ipairs(left) do
          if utils["sym?"](name) then
            table.insert(left_names, getname(name, up1))
          elseif utils["call-of?"](name, ".") then
            table.insert(left_names, dynamic_set_target(name))
          else
            local symname = gensym(scope, symtype0)
            table.insert(left_names, symname)
            tables[i] = {name, utils.expr(symname, "sym")}
          end
        end
        assert_compile(left[1], "must provide at least one value", left)
        if _3ftop_3f then
          compile_top_target(left_names)
        elseif utils["expr?"](rightexprs) then
          emit(parent, setter:format(table.concat(left_names, ","), exprs1(rightexprs)), left)
        else
          local names = table.concat(left_names, ",")
          local target = nil
          if declaration then
            target = ("local " .. names)
          else
            target = names
          end
          emit(parent, compile1(rightexprs, scope, parent, {target = target}), left)
        end
        for _, pair in utils.stablepairs(tables) do
          destructure1(pair[1], {pair[2]}, left)
        end
        return nil
      end
      local unpack_fn = "function (t, k)\n                        return ((getmetatable(t) or {}).__fennelrest\n                                or function (t, k) return {(table.unpack or unpack)(t, k)} end)(t, k)\n                      end"
      local unpack_ks = "function (t, e)\n                        local rest = {}\n                        for k, v in pairs(t) do\n                          if not e[k] then rest[k] = v end\n                        end\n                        return rest\n                      end"
      local function destructure_kv_rest(s, v, left, excluded_keys, destructure1)
        local exclude_str = nil
        local _457_
        do
          local tbl_17_ = {}
          local i_18_ = #tbl_17_
          for _, k in ipairs(excluded_keys) do
            local val_19_ = string.format("[%s] = true", serialize_string(k))
            if (nil ~= val_19_) then
              i_18_ = (i_18_ + 1)
              tbl_17_[i_18_] = val_19_
            end
          end
          _457_ = tbl_17_
        end
        exclude_str = table.concat(_457_, ", ")
        local subexpr = utils.expr(string.format(string.gsub(("(" .. unpack_ks .. ")(%s, {%s})"), "\n%s*", " "), s, exclude_str), "expression")
        return destructure1(v, {subexpr}, left)
      end
      local function destructure_rest(s, k, left, destructure1)
        local unpack_str = ("(" .. unpack_fn .. ")(%s, %s)")
        local formatted = string.format(string.gsub(unpack_str, "\n%s*", " "), s, k)
        local subexpr = utils.expr(formatted, "expression")
        local function _459_()
          local next_symbol = left[(k + 2)]
          return ((nil == next_symbol) or utils["sym?"](next_symbol, "&as"))
        end
        assert_compile((utils["sequence?"](left) and _459_()), "expected rest argument before last parameter", left)
        return destructure1(left[(k + 1)], {subexpr}, left)
      end
      local function optimize_table_destructure_3f(left, right)
        local function _460_()
          local all = next(left)
          for _, d in ipairs(left) do
            if not all then break end
            all = ((utils["sym?"](d) and not tostring(d):find("^&")) or (utils["list?"](d) and utils["sym?"](d[1], ".")))
          end
          return all
        end
        return (utils["sequence?"](left) and utils["sequence?"](right) and _460_())
      end
      local function destructure_table(left, rightexprs, top_3f, destructure1, up1)
        assert_compile((("table" == type(rightexprs)) and not utils["sym?"](rightexprs, "nil")), "could not destructure literal", left)
        if optimize_table_destructure_3f(left, rightexprs) then
          return destructure_values(utils.list(unpack(left)), utils.list(utils.sym("values"), unpack(rightexprs)), up1, destructure1)
        else
          local right = nil
          do
            local _461_0 = nil
            if top_3f then
              _461_0 = exprs1(compile1(from, scope, parent))
            else
              _461_0 = exprs1(rightexprs)
            end
            if (_461_0 == "") then
              right = "nil"
            elseif (nil ~= _461_0) then
              local right0 = _461_0
              right = right0
            else
            right = nil
            end
          end
          local s = nil
          if utils["sym?"](rightexprs) then
            s = right
          else
            s = gensym(scope, symtype0)
          end
          local excluded_keys = {}
          if not utils["sym?"](rightexprs) then
            emit(parent, string.format("local %s = %s", s, right), left)
          end
          for k, v in utils.stablepairs(left) do
            if not (("number" == type(k)) and tostring(left[(k - 1)]):find("^&")) then
              if utils["sym?"](k, "&") then
                destructure_kv_rest(s, v, left, excluded_keys, destructure1)
              elseif utils["sym?"](v, "&") then
                destructure_rest(s, k, left, destructure1)
              elseif utils["sym?"](k, "&as") then
                destructure_sym(v, {utils.expr(tostring(s))}, left)
              elseif (utils["sequence?"](left) and utils["sym?"](v, "&as")) then
                local _, next_sym, trailing = select(k, unpack(left))
                assert_compile((nil == trailing), "expected &as argument before last parameter", left)
                destructure_sym(next_sym, {utils.expr(tostring(s))}, left)
              else
                local subexpr = nil
                if ((type(k) == "string") and utils["valid-lua-identifier?"](k)) then
                  subexpr = ("%s.%s"):format(s, k)
                else
                  local key = serialize_scalar(k)
                  assert_compile(key, "expected key to be a literal", key)
                  subexpr = ("%s[%s]"):format(s, key)
                end
                if (type(k) == "string") then
                  table.insert(excluded_keys, k)
                end
                destructure1(v, utils.expr(subexpr, "expression"), left)
              end
            end
          end
          return nil
        end
      end
      local function destructure1(left, rightexprs, up1, top_3f)
        if (utils["sym?"](left) and left["to-be-closed"]) then
          destructure_close(left, up1)
        elseif (utils["sym?"](left) and (left[1] ~= "nil")) then
          destructure_sym(left, rightexprs, up1, top_3f)
        elseif utils["table?"](left) then
          destructure_table(left, rightexprs, top_3f, destructure1, up1)
        elseif utils["call-of?"](left, ".") then
          destructure_values({left}, rightexprs, up1, destructure1)
        elseif utils["list?"](left) then
          assert_compile(top_3f, "can't nest multi-value destructuring", left)
          destructure_values(left, rightexprs, up1, destructure1, true)
        else
          assert_compile(false, ("unable to bind %s %s"):format(type(left), tostring(left)), up1[2], up1)
        end
        return (top_3f and {returned = true})
      end
      local ret = destructure1(to, from, ast, true)
      utils.hook("destructure", from, to, scope, opts0)
      apply_deferred_scope_changes(scope, deferred_scope_changes, ast)
      return ret
    end
    local function require_include(ast, scope, parent, opts)
      opts.fallback = function(e, no_warn)
        if not no_warn then
          utils.warn(("include module not found, falling back to require: %s"):format(tostring(e)), ast)
        end
        return utils.expr(string.format("require(%s)", tostring(e)), "statement")
      end
      return scopes.global.specials.include(ast, scope, parent, opts)
    end
    local function with_open_2a(_473_0, scope, parent, opts)
      local _474_ = _473_0
      local _ = _474_[1]
      local bindings = _474_[2]
      local ast = _474_
      assert_compile(utils["sequence?"](bindings), (bindings or ast[1]))
      for i = 1, #bindings, 2 do
        assert_compile(utils["sym?"](bindings[i]), "with-open only allows symbols in bindings")
        bindings[i]["to-be-closed"] = true
      end
      return scope.specials.let(ast, scope, parent, opts)
    end
    local function compile_asts(asts, options)
      local opts = utils.copy(options)
      local scope = nil
      if ("_COMPILER" == opts.scope) then
        scope = scopes.compiler
      elseif opts.scope then
        scope = opts.scope
      else
        scope = make_scope(scopes.global)
      end
      local chunk = {}
      if opts.requireAsInclude then
        scope.specials.require = require_include
      end
      if opts.toBeClosed then
        scope.macros["with-open"] = false
        scope.specials["with-open"] = with_open_2a
      end
      if opts.assertAsRepl then
        scope.macros.assert = scope.macros["assert-repl"]
      end
      if opts.lambdaAsFn then
        scope.macros.lambda = false
        scope.macros["\206\187"] = false
        scope.specials.lambda = scope.specials.fn
        scope.specials["\206\187"] = scope.specials.fn
      end
      local _480_ = utils.root
      _480_["set-reset"](_480_)
      utils.root.chunk, utils.root.scope, utils.root.options = chunk, scope, opts
      for i = 1, #asts do
        local exprs = compile1(asts[i], scope, chunk, {nval = (((i < #asts) and 0) or nil), tail = (i == #asts)})
        keep_side_effects(exprs, chunk, nil, asts[i])
        if (i == #asts) then
          utils.hook("chunk", asts[i], scope)
        end
      end
      utils.root.reset()
      return flatten(chunk, opts)
    end
    local function compile_stream(stream, _3fopts)
      local opts = (_3fopts or {})
      local asts = nil
      do
        local tbl_17_ = {}
        local i_18_ = #tbl_17_
        for _, ast in parser.parser(stream, opts.filename, opts) do
          local val_19_ = ast
          if (nil ~= val_19_) then
            i_18_ = (i_18_ + 1)
            tbl_17_[i_18_] = val_19_
          end
        end
        asts = tbl_17_
      end
      return compile_asts(asts, opts)
    end
    local function compile_string(str, _3fopts)
      return compile_stream(parser["string-stream"](str, _3fopts), _3fopts)
    end
    local function compile(from, _3fopts)
      local _483_0 = type(from)
      if (_483_0 == "userdata") then
        local function _484_()
          local _485_0 = from:read(1)
          if (nil ~= _485_0) then
            return _485_0:byte()
          else
            return _485_0
          end
        end
        return compile_stream(_484_, _3fopts)
      elseif (_483_0 == "function") then
        return compile_stream(from, _3fopts)
      else
        local _ = _483_0
        return compile_asts({from}, _3fopts)
      end
    end
    local function traceback_frame(info)
      if ((info.what == "C") and info.name) then
        return string.format("\9[C]: in function '%s'", info.name)
      elseif (info.what == "C") then
        return "\9[C]: in ?"
      else
        local remap = sourcemap[info.source]
        if (remap and remap[info.currentline]) then
          if ((remap[info.currentline][1] or "unknown") ~= "unknown") then
            info.short_src = sourcemap[("@" .. remap[info.currentline][1])].short_src
          else
            info.short_src = remap.short_src
          end
          info.currentline = (remap[info.currentline][2] or -1)
        end
        if (info.what == "Lua") then
          local function _490_()
            if info.name then
              return ("'" .. info.name .. "'")
            else
              return "?"
            end
          end
          return string.format("\9%s:%d: in function %s", info.short_src, info.currentline, _490_())
        elseif (info.short_src == "(tail call)") then
          return "  (tail call)"
        else
          return string.format("\9%s:%d: in main chunk", info.short_src, info.currentline)
        end
      end
    end
    local function trace_adjust_msg(msg)
      local function _493_(...)
        local _494_0, _495_0, _496_0 = ...
        if ((nil ~= _494_0) and (nil ~= _495_0) and (nil ~= _496_0)) then
          local file = _494_0
          local line = _495_0
          local rest = _496_0
          local function _497_(...)
            local _498_0 = ...
            if ((_G.type(_498_0) == "table") and true and (nil ~= _498_0[2])) then
              local _ = _498_0[1]
              local newline = _498_0[2]
              return string.format("%s:%s:%s", file, newline, rest)
            else
              local _ = _498_0
              return msg
            end
          end
          local function _501_(...)
            local _500_0 = sourcemap
            if (nil ~= _500_0) then
              _500_0 = _500_0[("@" .. file)]
            end
            if (nil ~= _500_0) then
              _500_0 = _500_0[tonumber(line)]
            end
            return _500_0
          end
          return _497_(_501_(...))
        else
          local _ = _494_0
          return msg
        end
      end
      return _493_(msg:match("^([^:]*):(%d+):(.*)"))
    end
    local lua_getinfo = (_G.debug and _G.debug.getinfo)
    local function traceback(_3fmsg, _3fstart)
      local _505_0 = type(_3fmsg)
      if ((_505_0 == "nil") or (_505_0 == "string")) then
        local msg = (_3fmsg or "")
        if ((msg:find("^%g+:%d+:%d+: Compile error:.*") or msg:find("^%g+:%d+:%d+: Parse error:.*")) and not utils["debug-on?"]("trace")) then
          return msg
        else
          local lines = {trace_adjust_msg(msg), "stack traceback:"}
          for level = (_3fstart or 2), 999 do
            if lines["done?"] then break end
            local _506_0 = (lua_getinfo and lua_getinfo(level, "Sln"))
            if (_506_0 == nil) then
              lines["done?"] = true
            elseif (nil ~= _506_0) then
              local info = _506_0
              table.insert(lines, traceback_frame(info))
            end
          end
          return table.concat(lines, "\n")
        end
      else
        local _ = _505_0
        return _3fmsg
      end
    end
    local function getinfo(thread_or_level, ...)
      local thread_or_level0 = nil
      if ("number" == type(thread_or_level)) then
        thread_or_level0 = (1 + thread_or_level)
      else
        thread_or_level0 = thread_or_level
      end
      local info = (lua_getinfo and lua_getinfo(thread_or_level0, ...))
      local mapped = (info and sourcemap[info.source])
      if mapped then
        for _, key in ipairs({"currentline", "linedefined", "lastlinedefined"}) do
          local mapped_value = nil
          do
            local _511_0 = mapped
            if (nil ~= _511_0) then
              _511_0 = _511_0[info[key]]
            end
            if (nil ~= _511_0) then
              _511_0 = _511_0[2]
            end
            mapped_value = _511_0
          end
          if (info[key] and mapped_value) then
            info[key] = mapped_value
          end
        end
        if info.activelines then
          local tbl_14_ = {}
          for line in pairs(info.activelines) do
            local k_15_, v_16_ = mapped[line][2], true
            if ((k_15_ ~= nil) and (v_16_ ~= nil)) then
              tbl_14_[k_15_] = v_16_
            end
          end
          info.activelines = tbl_14_
        end
        if (info.what == "Lua") then
          info.what = "Fennel"
        end
      end
      return info
    end
    local function mixed_concat(t, joiner)
      local seen = {}
      local ret, s = "", ""
      for k, v in ipairs(t) do
        table.insert(seen, k)
        ret = (ret .. s .. v)
        s = joiner
      end
      for k, v in utils.stablepairs(t) do
        if not seen[k] then
          ret = (ret .. s .. "[" .. k .. "]" .. "=" .. v)
          s = joiner
        end
      end
      return ret
    end
    local function do_quote(form, scope, parent, runtime_3f)
      local function quote_all(form0, _3fdiscard_non_numbers)
        local tbl_14_ = {}
        for k, v in utils.stablepairs(form0) do
          local k_15_, v_16_ = nil, nil
          if (type(k) == "number") then
            k_15_, v_16_ = k, do_quote(v, scope, parent, runtime_3f)
          elseif not _3fdiscard_non_numbers then
            k_15_, v_16_ = do_quote(k, scope, parent, runtime_3f), do_quote(v, scope, parent, runtime_3f)
          else
          k_15_, v_16_ = nil
          end
          if ((k_15_ ~= nil) and (v_16_ ~= nil)) then
            tbl_14_[k_15_] = v_16_
          end
        end
        return tbl_14_
      end
      if utils["varg?"](form) then
        assert_compile(not runtime_3f, "quoted ... may only be used at compile time", form)
        return "_VARARG"
      elseif utils["sym?"](form) then
        local filename = nil
        if form.filename then
          filename = string.format("%q", form.filename)
        else
          filename = "nil"
        end
        local symstr = tostring(form)
        assert_compile(not runtime_3f, "symbols may only be used at compile time", form)
        if (symstr:find("#$") or symstr:find("#[:.]")) then
          return string.format("_G.sym('%s', {filename=%s, line=%s})", autogensym(symstr, scope), filename, (form.line or "nil"))
        else
          return string.format("_G.sym('%s', {quoted=true, filename=%s, line=%s})", symstr, filename, (form.line or "nil"))
        end
      elseif utils["call-of?"](form, "unquote") then
        local res = unpack(compile1(form[2], scope, parent))
        return res[1]
      elseif utils["list?"](form) then
        local mapped = quote_all(form, true)
        local filename = nil
        if form.filename then
          filename = string.format("%q", form.filename)
        else
          filename = "nil"
        end
        assert_compile(not runtime_3f, "lists may only be used at compile time", form)
        return string.format(("setmetatable({filename=%s, line=%s, bytestart=%s, %s}" .. ", getmetatable(_G.list()))"), filename, (form.line or "nil"), (form.bytestart or "nil"), mixed_concat(mapped, ", "))
      elseif utils["sequence?"](form) then
        local mapped_str = mixed_concat(quote_all(form), ", ")
        local source = getmetatable(form)
        local filename = nil
        if source.filename then
          filename = ("%q"):format(source.filename)
        else
          filename = "nil"
        end
        if runtime_3f then
          return string.format("{%s}", mapped_str)
        else
          return string.format("setmetatable({%s}, {filename=%s, line=%s, sequence=%s})", mapped_str, filename, (source.line or "nil"), "(getmetatable(_G.sequence()))['sequence']")
        end
      elseif (type(form) == "table") then
        local source = getmetatable(form)
        local filename = nil
        if source.filename then
          filename = string.format("%q", source.filename)
        else
          filename = "nil"
        end
        local function _528_()
          if source then
            return source.line
          else
            return "nil"
          end
        end
        return string.format("setmetatable({%s}, {filename=%s, line=%s})", mixed_concat(quote_all(form), ", "), filename, _528_())
      elseif (type(form) == "string") then
        return serialize_string(form)
      else
        return tostring(form)
      end
    end
    return {["apply-deferred-scope-changes"] = apply_deferred_scope_changes, ["check-binding-valid"] = check_binding_valid, ["compile-stream"] = compile_stream, ["compile-string"] = compile_string, ["declare-local"] = declare_local, ["do-quote"] = do_quote, ["global-allowed?"] = global_allowed_3f, ["global-mangling"] = global_mangling, ["global-unmangling"] = global_unmangling, ["keep-side-effects"] = keep_side_effects, ["make-scope"] = make_scope, ["require-include"] = require_include, ["symbol-to-expression"] = symbol_to_expression, assert = assert_compile, autogensym = autogensym, compile = compile, compile1 = compile1, destructure = destructure, emit = emit, gensym = gensym, getinfo = getinfo, macroexpand = macroexpand_2a, metadata = make_metadata(), scopes = scopes, sourcemap = sourcemap, traceback = traceback}
  end
  package.preload["fennel.friend"] = package.preload["fennel.friend"] or function(...)
    local _195_ = require("fennel.utils")
    local utils = _195_
    local unpack = _195_["unpack"]
    local utf8_ok_3f, utf8 = pcall(require, "utf8")
    local suggestions = {}
    local function pal(k, v)
      suggestions[k] = v
      return nil
    end
    pal("$ and $... in hashfn are mutually exclusive", {"modifying the hashfn so it only contains $... or $, $1, $2, $3, etc"})
    pal("can't introduce (.*) here", {"declaring the local at the top-level"})
    pal("can't start multisym segment with a digit", {"removing the digit", "adding a non-digit before the digit"})
    pal("cannot call literal value", {"checking for typos", "checking for a missing function name", "making sure to use prefix operators, not infix"})
    pal("could not compile value of type ", {"debugging the macro you're calling to return a list or table"})
    pal("could not read number (.*)", {"removing the non-digit character", "beginning the identifier with a non-digit if it is not meant to be a number"})
    pal("expected a function.* to call", {"removing the empty parentheses", "using square brackets if you want an empty table"})
    pal("expected at least one pattern/body pair", {"adding a pattern and a body to execute when the pattern matches"})
    pal("expected binding and iterator", {"making sure you haven't omitted a local name or iterator"})
    pal("expected binding sequence", {"placing a table here in square brackets containing identifiers to bind"})
    pal("expected body expression", {"putting some code in the body of this form after the bindings"})
    pal("expected each macro to be function", {"ensuring that the value for each key in your macros table contains a function", "avoid defining nested macro tables"})
    pal("expected even number of name/value bindings", {"finding where the identifier or value is missing"})
    pal("expected even number of pattern/body pairs", {"checking that every pattern has a body to go with it", "adding _ before the final body"})
    pal("expected even number of values in table literal", {"removing a key", "adding a value"})
    pal("expected key to be a literal", {"using . instead of destructuring", "checking for typos"})
    pal("expected local", {"looking for a typo", "looking for a local which is used out of its scope"})
    pal("expected macros to be table", {"ensuring your macro definitions return a table"})
    pal("expected parameters", {"adding function parameters as a list of identifiers in brackets"})
    pal("expected range to include start and stop", {"adding missing arguments"})
    pal("expected rest argument before last parameter", {"moving & to right before the final identifier when destructuring"})
    pal("expected symbol for function parameter: (.*)", {"changing %s to an identifier instead of a literal value"})
    pal("expected var (.*)", {"declaring %s using var instead of let/local", "introducing a new local instead of changing the value of %s"})
    pal("expected vararg as last parameter", {"moving the \"...\" to the end of the parameter list"})
    pal("expected whitespace before opening delimiter", {"adding whitespace"})
    pal("global (.*) conflicts with local", {"renaming local %s"})
    pal("invalid character: (.)", {"deleting or replacing %s", "avoiding reserved characters like \", \\, ', ~, ;, @, `, and comma"})
    pal("local (.*) was overshadowed by a special form or macro", {"renaming local %s"})
    pal("macro not found in macro module", {"checking the keys of the imported macro module's returned table"})
    pal("macro tried to bind (.*) without gensym", {"changing to %s# when introducing identifiers inside macros"})
    pal("malformed multisym", {"ensuring each period or colon is not followed by another period or colon"})
    pal("may only be used at compile time", {"moving this to inside a macro if you need to manipulate symbols/lists", "using square brackets instead of parens to construct a table"})
    pal("method must be last component", {"using a period instead of a colon for field access", "removing segments after the colon", "making the method call, then looking up the field on the result"})
    pal("mismatched closing delimiter (.), expected (.)", {"replacing %s with %s", "deleting %s", "adding matching opening delimiter earlier"})
    pal("missing subject", {"adding an item to operate on"})
    pal("multisym method calls may only be in call position", {"using a period instead of a colon to reference a table's fields", "putting parens around this"})
    pal("tried to reference a macro without calling it", {"renaming the macro so as not to conflict with locals"})
    pal("tried to reference a special form without calling it", {"making sure to use prefix operators, not infix", "wrapping the special in a function if you need it to be first class"})
    pal("tried to use unquote outside quote", {"moving the form to inside a quoted form", "removing the comma"})
    pal("tried to use vararg with operator", {"accumulating over the operands"})
    pal("unable to bind (.*)", {"replacing the %s with an identifier"})
    pal("unexpected arguments", {"removing an argument", "checking for typos"})
    pal("unexpected closing delimiter (.)", {"deleting %s", "adding matching opening delimiter earlier"})
    pal("unexpected iterator clause", {"removing an argument", "checking for typos"})
    pal("unexpected multi symbol (.*)", {"removing periods or colons from %s"})
    pal("unexpected vararg", {"putting \"...\" at the end of the fn parameters if the vararg was intended"})
    pal("unknown identifier: (.*)", {"looking to see if there's a typo", "using the _G table instead, eg. _G.%s if you really want a global", "moving this code to somewhere that %s is in scope", "binding %s as a local in the scope of this code"})
    pal("unused local (.*)", {"renaming the local to _%s if it is meant to be unused", "fixing a typo so %s is used", "disabling the linter which checks for unused locals"})
    pal("use of global (.*) is aliased by a local", {"renaming local %s", "refer to the global using _G.%s instead of directly"})
    local function suggest(msg)
      local s = nil
      for pat, sug in pairs(suggestions) do
        if s then break end
        local matches = {msg:match(pat)}
        if next(matches) then
          local tbl_17_ = {}
          local i_18_ = #tbl_17_
          for _, s0 in ipairs(sug) do
            local val_19_ = s0:format(unpack(matches))
            if (nil ~= val_19_) then
              i_18_ = (i_18_ + 1)
              tbl_17_[i_18_] = val_19_
            end
          end
          s = tbl_17_
        else
        s = nil
        end
      end
      return s
    end
    local function read_line(filename, line, _3fsource)
      if _3fsource then
        local matcher = string.gmatch((_3fsource .. "\n"), "(.-)(\13?\n)")
        for _ = 2, line do
          matcher()
        end
        return matcher()
      else
        local f = assert(_G.io.open(filename))
        local function close_handlers_10_(ok_11_, ...)
          f:close()
          if ok_11_ then
            return ...
          else
            return error(..., 0)
          end
        end
        local function _199_()
          for _ = 2, line do
            f:read()
          end
          return f:read()
        end
        return close_handlers_10_(_G.xpcall(_199_, (package.loaded.fennel or debug).traceback))
      end
    end
    local function sub(str, start, _end)
      if ((_end < start) or (#str < start)) then
        return ""
      elseif utf8_ok_3f then
        return string.sub(str, utf8.offset(str, start), ((utf8.offset(str, (_end + 1)) or (utf8.len(str) + 1)) - 1))
      else
        return string.sub(str, start, math.min(_end, str:len()))
      end
    end
    local function highlight_line(codeline, col, _3fendcol, _202_0)
      local _203_ = _202_0
      local error_pinpoint = _203_["error-pinpoint"]
      if ((false == error_pinpoint) or (os and os.getenv and os.getenv("NO_COLOR"))) then
        return codeline
      else
        local endcol = (_3fendcol or col)
        local eol = nil
        if utf8_ok_3f then
          eol = utf8.len(codeline)
        else
          eol = string.len(codeline)
        end
        local _205_ = (error_pinpoint or {"\27[7m", "\27[0m"})
        local open = _205_[1]
        local close = _205_[2]
        return (sub(codeline, 1, col) .. open .. sub(codeline, (col + 1), (endcol + 1)) .. close .. sub(codeline, (endcol + 2), eol))
      end
    end
    local function friendly_msg(msg, _207_0, _3fsource, _3fopts)
      local _208_ = _207_0
      local col = _208_["col"]
      local endcol = _208_["endcol"]
      local endline = _208_["endline"]
      local filename = _208_["filename"]
      local line = _208_["line"]
      local ok, codeline = pcall(read_line, filename, line, _3fsource)
      local endcol0 = nil
      if (ok and codeline and (line ~= endline)) then
        endcol0 = #codeline
      else
        endcol0 = endcol
      end
      local out = {msg, ""}
      if (ok and codeline) then
        if col then
          table.insert(out, highlight_line(codeline, col, endcol0, (_3fopts or {})))
        else
          table.insert(out, codeline)
        end
      end
      for _, suggestion in ipairs((suggest(msg) or {})) do
        table.insert(out, ("* Try %s."):format(suggestion))
      end
      return table.concat(out, "\n")
    end
    local function assert_compile(condition, msg, ast, _3fsource, _3fopts)
      if not condition then
        local _212_ = utils["ast-source"](ast)
        local col = _212_["col"]
        local filename = _212_["filename"]
        local line = _212_["line"]
        error(friendly_msg(("%s:%s:%s: Compile error: %s"):format((filename or "unknown"), (line or "?"), (col or "?"), msg), utils["ast-source"](ast), _3fsource, _3fopts), 0)
      end
      return condition
    end
    local function parse_error(msg, filename, line, col, endcol, source, opts)
      return error(friendly_msg(("%s:%s:%s: Parse error: %s"):format(filename, line, col, msg), {col = col, endcol = endcol, endline = line, filename = filename, line = line}, source, opts), 0)
    end
    return {["assert-compile"] = assert_compile, ["parse-error"] = parse_error}
  end
  package.preload["fennel.parser"] = package.preload["fennel.parser"] or function(...)
    local _194_ = require("fennel.utils")
    local utils = _194_
    local unpack = _194_["unpack"]
    local friend = require("fennel.friend")
    local function granulate(getchunk)
      local c, index, done_3f = "", 1, false
      local function _214_(parser_state)
        if not done_3f then
          if (index <= #c) then
            local b = c:byte(index)
            index = (index + 1)
            return b
          else
            local _215_0 = getchunk(parser_state)
            if (nil ~= _215_0) then
              local input = _215_0
              c, index = input, 2
              return c:byte()
            else
              local _ = _215_0
              done_3f = true
              return nil
            end
          end
        end
      end
      local function _219_()
        c = ""
        return nil
      end
      return _214_, _219_
    end
    local function string_stream(str, _3foptions)
      local str0 = str:gsub("^#!", ";;")
      if _3foptions then
        _3foptions.source = str0
      end
      local index = 1
      local function _221_()
        local r = str0:byte(index)
        index = (index + 1)
        return r
      end
      return _221_
    end
    local delims = {[123] = 125, [125] = true, [40] = 41, [41] = true, [91] = 93, [93] = true}
    local function sym_char_3f(b)
      local b0 = nil
      if ("number" == type(b)) then
        b0 = b
      else
        b0 = string.byte(b)
      end
      return ((32 < b0) and not delims[b0] and (b0 ~= 127) and (b0 ~= 34) and (b0 ~= 39) and (b0 ~= 126) and (b0 ~= 59) and (b0 ~= 44) and (b0 ~= 64) and (b0 ~= 96))
    end
    local prefixes = {[35] = "hashfn", [39] = "quote", [44] = "unquote", [96] = "quote"}
    local nan, negative_nan = nil, nil
    if (45 == string.byte(tostring((0 / 0)))) then
      nan, negative_nan = ( - (0 / 0)), (0 / 0)
    else
      nan, negative_nan = (0 / 0), ( - (0 / 0))
    end
    local function char_starter_3f(b)
      return (((1 < b) and (b < 127)) or ((192 < b) and (b < 247)))
    end
    local escapes = {["'"] = "'", ["\""] = "\"", ["\\"] = "\\", ["\n"] = "\n", a = "\7", b = "\8", f = "\12", n = "\n", r = "\13", t = "\9", v = "\11"}
    local function parser_fn(getbyte, filename, _224_0)
      local _225_ = _224_0
      local options = _225_
      local comments = _225_["comments"]
      local source = _225_["source"]
      local unfriendly = _225_["unfriendly"]
      local stack = {}
      local line, byteindex, col, prev_col, lastb = 1, 0, 0, 0, nil
      local function ungetb(ub)
        if char_starter_3f(ub) then
          col = (col - 1)
        end
        if (ub == 10) then
          line, col = (line - 1), prev_col
        end
        byteindex = (byteindex - 1)
        lastb = ub
        return nil
      end
      local function getb()
        local r = nil
        if lastb then
          r, lastb = lastb, nil
        else
          r = getbyte({["stack-size"] = #stack})
        end
        if r then
          byteindex = (byteindex + 1)
        end
        if (r and char_starter_3f(r)) then
          col = (col + 1)
        end
        if (r == 10) then
          line, col, prev_col = (line + 1), 0, col
        end
        return r
      end
      local function warn(...)
        return (options.warn or utils.warn)(...)
      end
      local function whitespace_3f(b)
        local function _233_()
          local _232_0 = options.whitespace
          if (nil ~= _232_0) then
            _232_0 = _232_0[b]
          end
          return _232_0
        end
        return ((b == 32) or ((9 <= b) and (b <= 13)) or _233_())
      end
      local function parse_error(msg, _3fcol_adjust)
        local endcol = (_3fcol_adjust and col)
        local col0 = (col + (_3fcol_adjust or -1))
        if (nil == utils["hook-opts"]("parse-error", options, msg, filename, (line or "?"), col0, source, utils.root.reset)) then
          utils.root.reset()
          if unfriendly then
            return error(string.format("%s:%s:%s: Parse error: %s", filename, (line or "?"), col0, msg), 0)
          else
            return friend["parse-error"](msg, filename, (line or "?"), col0, endcol, source, options)
          end
        end
      end
      local function parse_stream()
        local whitespace_since_dispatch, done_3f, retval = true
        local function set_source_fields(source0)
          source0.byteend, source0.endcol, source0.endline = byteindex, (col - 1), line
          return nil
        end
        local function dispatch(v, _3fsource, _3fraw)
          whitespace_since_dispatch = false
          local v0 = nil
          do
            local _237_0 = utils["hook-opts"]("parse-form", options, v, _3fsource, _3fraw, stack)
            if (nil ~= _237_0) then
              local hookv = _237_0
              v0 = hookv
            else
              local _ = _237_0
              v0 = v
            end
          end
          local _239_0 = stack[#stack]
          if (_239_0 == nil) then
            retval, done_3f = v0, true
            return nil
          elseif ((_G.type(_239_0) == "table") and (nil ~= _239_0.prefix)) then
            local prefix = _239_0.prefix
            local source0 = nil
            do
              local _240_0 = table.remove(stack)
              set_source_fields(_240_0)
              source0 = _240_0
            end
            local list = utils.list(utils.sym(prefix, source0), v0)
            return dispatch(utils.copy(source0, list))
          elseif (nil ~= _239_0) then
            local top = _239_0
            return table.insert(top, v0)
          end
        end
        local function badend()
          local closers = nil
          do
            local tbl_17_ = {}
            local i_18_ = #tbl_17_
            for _, _242_0 in ipairs(stack) do
              local _243_ = _242_0
              local closer = _243_["closer"]
              local val_19_ = closer
              if (nil ~= val_19_) then
                i_18_ = (i_18_ + 1)
                tbl_17_[i_18_] = val_19_
              end
            end
            closers = tbl_17_
          end
          local _245_
          if (#stack == 1) then
            _245_ = ""
          else
            _245_ = "s"
          end
          return parse_error(string.format("expected closing delimiter%s %s", _245_, string.char(unpack(closers))), 0)
        end
        local function skip_whitespace(b, close_table)
          if (b and whitespace_3f(b)) then
            whitespace_since_dispatch = true
            return skip_whitespace(getb(), close_table)
          elseif (not b and next(stack)) then
            badend()
            for i = #stack, 2, -1 do
              close_table(stack[i].closer)
            end
            return stack[1].closer
          else
            return b
          end
        end
        local function parse_comment(b, contents)
          if (b and (10 ~= b)) then
            local function _248_()
              table.insert(contents, string.char(b))
              return contents
            end
            return parse_comment(getb(), _248_())
          elseif comments then
            ungetb(10)
            return dispatch(utils.comment(table.concat(contents), {filename = filename, line = line}))
          end
        end
        local function open_table(b)
          if not whitespace_since_dispatch then
            parse_error(("expected whitespace before opening delimiter " .. string.char(b)))
          end
          return table.insert(stack, {bytestart = byteindex, closer = delims[b], col = (col - 1), filename = filename, line = line})
        end
        local function close_list(list)
          return dispatch(setmetatable(list, getmetatable(utils.list())))
        end
        local function close_sequence(tbl)
          local mt = getmetatable(utils.sequence())
          for k, v in pairs(tbl) do
            if ("number" ~= type(k)) then
              mt[k] = v
              tbl[k] = nil
            end
          end
          return dispatch(setmetatable(tbl, mt))
        end
        local function add_comment_at(comments0, index, node)
          local _252_0 = comments0[index]
          if (nil ~= _252_0) then
            local existing = _252_0
            return table.insert(existing, node)
          else
            local _ = _252_0
            comments0[index] = {node}
            return nil
          end
        end
        local function next_noncomment(tbl, i)
          if utils["comment?"](tbl[i]) then
            return next_noncomment(tbl, (i + 1))
          elseif utils["sym?"](tbl[i], ":") then
            return tostring(tbl[(i + 1)])
          else
            return tbl[i]
          end
        end
        local function extract_comments(tbl)
          local comments0 = {keys = {}, last = {}, values = {}}
          while utils["comment?"](tbl[#tbl]) do
            table.insert(comments0.last, 1, table.remove(tbl))
          end
          local last_key_3f = false
          for i, node in ipairs(tbl) do
            if not utils["comment?"](node) then
              last_key_3f = not last_key_3f
            elseif last_key_3f then
              add_comment_at(comments0.values, next_noncomment(tbl, i), node)
            else
              add_comment_at(comments0.keys, next_noncomment(tbl, i), node)
            end
          end
          for i = #tbl, 1, -1 do
            if utils["comment?"](tbl[i]) then
              table.remove(tbl, i)
            end
          end
          return comments0
        end
        local function close_curly_table(tbl)
          local comments0 = extract_comments(tbl)
          local keys = {}
          local val = {}
          if ((#tbl % 2) ~= 0) then
            byteindex = (byteindex - 1)
            parse_error("expected even number of values in table literal")
          end
          setmetatable(val, tbl)
          for i = 1, #tbl, 2 do
            if (utils["sym?"](tbl[(i + 1)]) and utils["sym?"](tbl[i], ":")) then
              tbl[i] = tostring(tbl[(i + 1)])
            end
            val[tbl[i]] = tbl[(i + 1)]
            table.insert(keys, tbl[i])
          end
          tbl.comments = comments0
          tbl.keys = keys
          return dispatch(val)
        end
        local function close_table(b)
          local top = table.remove(stack)
          if (top == nil) then
            parse_error(("unexpected closing delimiter " .. string.char(b)))
          end
          if (top.closer and (top.closer ~= b)) then
            parse_error(("mismatched closing delimiter " .. string.char(b) .. ", expected " .. string.char(top.closer)))
          end
          set_source_fields(top)
          if (b == 41) then
            return close_list(top)
          elseif (b == 93) then
            return close_sequence(top)
          else
            return close_curly_table(top)
          end
        end
        local function bitrange(codepoint, low, high)
          return (math.floor((codepoint / (2 ^ low))) % math.floor((2 ^ (high - low))))
        end
        local function encode_utf8(codepoint_str)
          local _262_0 = tonumber(codepoint_str:sub(4, -2), 16)
          if (nil ~= _262_0) then
            local codepoint = _262_0
            if _G.utf8 then
              return _G.utf8.char(codepoint)
            elseif ((0 <= codepoint) and (codepoint <= 127)) then
              return string.char(codepoint)
            elseif ((128 <= codepoint) and (codepoint <= 2047)) then
              return string.char((192 + bitrange(codepoint, 6, 11)), (128 + bitrange(codepoint, 0, 6)))
            elseif ((2048 <= codepoint) and (codepoint <= 65535)) then
              return string.char((224 + bitrange(codepoint, 12, 16)), (128 + bitrange(codepoint, 6, 12)), (128 + bitrange(codepoint, 0, 6)))
            elseif ((65536 <= codepoint) and (codepoint <= 2097151)) then
              return string.char((240 + bitrange(codepoint, 18, 21)), (128 + bitrange(codepoint, 12, 18)), (128 + bitrange(codepoint, 6, 12)), (128 + bitrange(codepoint, 0, 6)))
            elseif ((131072 <= codepoint) and (codepoint <= 67108863)) then
              return string.char((248 + bitrange(codepoint, 24, 26)), (128 + bitrange(codepoint, 18, 24)), (128 + bitrange(codepoint, 12, 18)), (128 + bitrange(codepoint, 6, 12)), (128 + bitrange(codepoint, 0, 6)))
            elseif ((4194304 <= codepoint) and (codepoint <= 2147483647)) then
              return string.char((252 + bitrange(codepoint, 30, 31)), (128 + bitrange(codepoint, 24, 30)), (128 + bitrange(codepoint, 18, 24)), (128 + bitrange(codepoint, 12, 18)), (128 + bitrange(codepoint, 6, 12)), (128 + bitrange(codepoint, 0, 6)))
            else
              return parse_error(("utf8 value too large: " .. codepoint_str))
            end
          else
            local _ = _262_0
            return parse_error(("Illegal string: " .. codepoint_str))
          end
        end
        local function parse_string_loop(chars, b, state)
          if b then
            table.insert(chars, string.char(b))
          end
          local state0 = nil
          do
            local _266_0 = {state, b}
            if ((_G.type(_266_0) == "table") and (_266_0[1] == "base") and (_266_0[2] == 92)) then
              state0 = "backslash"
            elseif ((_G.type(_266_0) == "table") and (_266_0[1] == "base") and (_266_0[2] == 34)) then
              state0 = "done"
            else
              local _ = _266_0
              state0 = "base"
            end
          end
          if (b and (state0 ~= "done")) then
            return parse_string_loop(chars, getb(), state0)
          else
            return b
          end
        end
        local function expand_str(str)
          local result = {}
          local i = 1
          while (i <= #str) do
            local add_to_i, add_to_result = nil, nil
            do
              local _269_0 = str:match("^[^\\]+", i)
              if (nil ~= _269_0) then
                local text = _269_0
                add_to_i, add_to_result = #text, text
              else
                local _ = _269_0
                local _270_0 = escapes[str:match("^\\(.?)", i)]
                if (nil ~= _270_0) then
                  local escape = _270_0
                  add_to_i, add_to_result = 2, escape
                else
                  local _0 = _270_0
                  if ("\\\13\n" == str:sub(i, (i + 2))) then
                    add_to_i, add_to_result = 3, "\13\n"
                  else
                    local _271_0 = str:match("^\\x(%x%x)", i)
                    if (nil ~= _271_0) then
                      local hex_code = _271_0
                      add_to_i, add_to_result = 4, string.char(tonumber(hex_code, 16))
                    else
                      local _1 = _271_0
                      local _272_0 = str:match("^\\u{%x+}", i)
                      if (nil ~= _272_0) then
                        local unicode_escape = _272_0
                        add_to_i, add_to_result = #unicode_escape, encode_utf8(unicode_escape)
                      else
                        local _2 = _272_0
                        local _273_0, _274_0 = str:find("^\\z%s*", i)
                        if (true and (nil ~= _274_0)) then
                          local _3 = _273_0
                          local j = _274_0
                          add_to_i, add_to_result = ((j - i) + 1), ""
                        else
                          local _3 = _273_0
                          local _275_0 = str:match("^\\(%d%d?%d?)", i)
                          if (nil ~= _275_0) then
                            local digits = _275_0
                            local byte = tonumber(digits, 10)
                            if (255 < byte) then
                              parse_error("invalid decimal escape")
                            end
                            add_to_i, add_to_result = (#digits + 1), string.char(byte)
                          else
                            local _4 = _275_0
                            add_to_i, add_to_result = parse_error("invalid escape sequence")
                          end
                        end
                      end
                    end
                  end
                end
              end
            end
            table.insert(result, add_to_result)
            i = (i + add_to_i)
          end
          return table.concat(result)
        end
        local function parse_string(source0)
          if not whitespace_since_dispatch then
            warn("expected whitespace before string", nil, filename, line, (col - 1))
          end
          table.insert(stack, {closer = 34})
          local chars = {"\""}
          if not parse_string_loop(chars, getb(), "base") then
            badend()
          end
          table.remove(stack)
          local raw = table.concat(chars)
          local expanded = expand_str(raw:sub(2, -2))
          return dispatch(expanded, source0, raw)
        end
        local function parse_prefix(b)
          table.insert(stack, {bytestart = byteindex, col = (col - 1), filename = filename, line = line, prefix = prefixes[b]})
          local nextb = getb()
          local trailing_whitespace_3f = (whitespace_3f(nextb) or (true == delims[nextb]))
          if (trailing_whitespace_3f and (b ~= 35)) then
            parse_error("invalid whitespace after quoting prefix")
          end
          ungetb(nextb)
          if (trailing_whitespace_3f and (b == 35)) then
            local source0 = table.remove(stack)
            set_source_fields(source0)
            return dispatch(utils.sym("#", source0))
          end
        end
        local function parse_sym_loop(chars, b)
          if (b and sym_char_3f(b)) then
            table.insert(chars, string.char(b))
            return parse_sym_loop(chars, getb())
          else
            if b then
              ungetb(b)
            end
            return chars
          end
        end
        local function parse_number(rawstr, source0)
          local trimmed = (not rawstr:find("^_") and rawstr:gsub("_", ""))
          if ((trimmed == "nan") or (trimmed == "-nan")) then
            return false
          elseif rawstr:match("^%d") then
            dispatch((tonumber(trimmed) or parse_error(("could not read number \"" .. rawstr .. "\""), ( - #rawstr))), source0, rawstr)
            return true
          else
            local _290_0 = tonumber(trimmed)
            if (nil ~= _290_0) then
              local x = _290_0
              dispatch(x, source0, rawstr)
              return true
            else
              local _ = _290_0
              return false
            end
          end
        end
        local function check_malformed_sym(rawstr)
          local function col_adjust(pat)
            return (rawstr:find(pat) - utils.len(rawstr) - 1)
          end
          if (rawstr:match("^~") and (rawstr ~= "~=")) then
            parse_error("invalid character: ~")
          elseif (rawstr:match("[%.:][%.:]") and (rawstr ~= "..") and (rawstr ~= "$...")) then
            parse_error(("malformed multisym: " .. rawstr), col_adjust("[%.:][%.:]"))
          elseif ((rawstr ~= ":") and rawstr:match(":$")) then
            parse_error(("malformed multisym: " .. rawstr), col_adjust(":$"))
          elseif rawstr:match(":.+[%.:]") then
            parse_error(("method must be last component of multisym: " .. rawstr), col_adjust(":.+[%.:]"))
          end
          return rawstr
        end
        local function parse_sym(b)
          local source0 = {bytestart = byteindex, col = (col - 1), filename = filename, line = line}
          local rawstr = table.concat(parse_sym_loop({string.char(b)}, getb()))
          set_source_fields(source0)
          if not whitespace_since_dispatch then
            warn("expected whitespace before token", nil, filename, line, (col - utils.len(rawstr)))
          end
          if (rawstr == "true") then
            return dispatch(true, source0)
          elseif (rawstr == "false") then
            return dispatch(false, source0)
          elseif (rawstr == "...") then
            return dispatch(utils.varg(source0))
          elseif ((rawstr == ".inf") or (rawstr == "+.inf")) then
            return dispatch((1 / 0), source0, rawstr)
          elseif (rawstr == "-.inf") then
            return dispatch((-1 / 0), source0, rawstr)
          elseif ((rawstr == ".nan") or (rawstr == "+.nan")) then
            return dispatch(nan, source0, rawstr)
          elseif (rawstr == "-.nan") then
            return dispatch(negative_nan, source0, rawstr)
          elseif rawstr:match("^:.+$") then
            return dispatch(rawstr:sub(2), source0, rawstr)
          elseif not parse_number(rawstr, source0) then
            return dispatch(utils.sym(check_malformed_sym(rawstr), source0))
          end
        end
        local function parse_loop(b)
          if not b then
          elseif (b == 59) then
            parse_comment(getb(), {";"})
          elseif (type(delims[b]) == "number") then
            open_table(b)
          elseif delims[b] then
            close_table(b)
          elseif (b == 34) then
            parse_string({bytestart = byteindex, col = col, filename = filename, line = line})
          elseif prefixes[b] then
            parse_prefix(b)
          elseif (sym_char_3f(b) or (b == string.byte("~"))) then
            parse_sym(b)
          elseif not utils["hook-opts"]("illegal-char", options, b, getb, ungetb, dispatch) then
            parse_error(("invalid character: " .. string.char(b)))
          end
          if not b then
            return nil
          elseif done_3f then
            return true, retval
          else
            return parse_loop(skip_whitespace(getb(), close_table))
          end
        end
        return parse_loop(skip_whitespace(getb(), close_table))
      end
      local function _298_()
        stack, line, byteindex, col, lastb = {}, 1, 0, 0, ((lastb ~= 10) and lastb)
        return nil
      end
      return parse_stream, _298_
    end
    local function parser(stream_or_string, _3ffilename, _3foptions)
      local filename = (_3ffilename or "unknown")
      local options = (_3foptions or utils.root.options or {})
      assert(("string" == type(filename)), "expected filename as second argument to parser")
      if ("string" == type(stream_or_string)) then
        return parser_fn(string_stream(stream_or_string, options), filename, options)
      else
        return parser_fn(stream_or_string, filename, options)
      end
    end
    return {["string-stream"] = string_stream, ["sym-char?"] = sym_char_3f, granulate = granulate, parser = parser}
  end
  local utils = nil
  package.preload["fennel.view"] = package.preload["fennel.view"] or function(...)
    local type_order = {["function"] = 5, boolean = 2, number = 1, string = 3, table = 4, thread = 7, userdata = 6}
    local default_opts = {["detect-cycles?"] = true, ["empty-as-sequence?"] = false, ["escape-newlines?"] = false, ["line-length"] = 80, ["max-sparse-gap"] = 1, ["metamethod?"] = true, ["one-line?"] = false, ["prefer-colon?"] = false, ["utf8?"] = true, depth = 128}
    local lua_pairs = pairs
    local lua_ipairs = ipairs
    local function pairs(t)
      local _1_0 = getmetatable(t)
      if ((_G.type(_1_0) == "table") and (nil ~= _1_0.__pairs)) then
        local p = _1_0.__pairs
        return p(t)
      else
        local _ = _1_0
        return lua_pairs(t)
      end
    end
    local function ipairs(t)
      local _3_0 = getmetatable(t)
      if ((_G.type(_3_0) == "table") and (nil ~= _3_0.__ipairs)) then
        local i = _3_0.__ipairs
        return i(t)
      else
        local _ = _3_0
        return lua_ipairs(t)
      end
    end
    local function length_2a(t)
      local _5_0 = getmetatable(t)
      if ((_G.type(_5_0) == "table") and (nil ~= _5_0.__len)) then
        local l = _5_0.__len
        return l(t)
      else
        local _ = _5_0
        return #t
      end
    end
    local function get_default(key)
      local _7_0 = default_opts[key]
      if (_7_0 == nil) then
        return error(("option '%s' doesn't have a default value, use the :after key to set it"):format(tostring(key)))
      elseif (nil ~= _7_0) then
        local v = _7_0
        return v
      end
    end
    local function getopt(options, key)
      local _9_0 = options[key]
      if ((_G.type(_9_0) == "table") and (nil ~= _9_0.once)) then
        local val_2a = _9_0.once
        return val_2a
      else
        local _3fval = _9_0
        return _3fval
      end
    end
    local function normalize_opts(options)
      local tbl_14_ = {}
      for k, v in pairs(options) do
        local k_15_, v_16_ = nil, nil
        local function _12_()
          local _11_0 = v
          if ((_G.type(_11_0) == "table") and (nil ~= _11_0.after)) then
            local val = _11_0.after
            return val
          else
            local function _13_()
              return v.once
            end
            if ((_G.type(_11_0) == "table") and _13_()) then
              return get_default(k)
            else
              local _ = _11_0
              return v
            end
          end
        end
        k_15_, v_16_ = k, _12_()
        if ((k_15_ ~= nil) and (v_16_ ~= nil)) then
          tbl_14_[k_15_] = v_16_
        end
      end
      return tbl_14_
    end
    local function sort_keys(_16_0, _18_0)
      local _17_ = _16_0
      local a = _17_[1]
      local _19_ = _18_0
      local b = _19_[1]
      local ta = type(a)
      local tb = type(b)
      if ((ta == tb) and ((ta == "string") or (ta == "number"))) then
        return (a < b)
      else
        local dta = type_order[ta]
        local dtb = type_order[tb]
        if (dta and dtb) then
          return (dta < dtb)
        elseif dta then
          return true
        elseif dtb then
          return false
        else
          return (ta < tb)
        end
      end
    end
    local function max_index_gap(kv)
      local gap = 0
      if (0 < length_2a(kv)) then
        local i = 0
        for _, _22_0 in ipairs(kv) do
          local _23_ = _22_0
          local k = _23_[1]
          if (gap < (k - i)) then
            gap = (k - i)
          end
          i = k
        end
      end
      return gap
    end
    local function fill_gaps(kv)
      local missing_indexes = {}
      local i = 0
      for _, _26_0 in ipairs(kv) do
        local _27_ = _26_0
        local j = _27_[1]
        i = (i + 1)
        while (i < j) do
          table.insert(missing_indexes, i)
          i = (i + 1)
        end
      end
      for _, k in ipairs(missing_indexes) do
        table.insert(kv, k, {k})
      end
      return nil
    end
    local function table_kv_pairs(t, options)
      if (("number" ~= type(options["max-sparse-gap"])) or (options["max-sparse-gap"] ~= math.floor(options["max-sparse-gap"]))) then
        error(("max-sparse-gap must be an integer: got '%s'"):format(tostring(options["max-sparse-gap"])))
      end
      local assoc_3f = false
      local kv = {}
      local insert = table.insert
      for k, v in pairs(t) do
        if (("number" ~= type(k)) or (k < 1) or (k ~= math.floor(k))) then
          assoc_3f = true
        end
        insert(kv, {k, v})
      end
      table.sort(kv, sort_keys)
      if not assoc_3f then
        if (options["max-sparse-gap"] < max_index_gap(kv)) then
          assoc_3f = true
        else
          fill_gaps(kv)
        end
      end
      if (length_2a(kv) == 0) then
        return kv, "empty"
      else
        local function _32_()
          if assoc_3f then
            return "table"
          else
            return "seq"
          end
        end
        return kv, _32_()
      end
    end
    local function count_table_appearances(t, appearances)
      if (type(t) == "table") then
        if not appearances[t] then
          appearances[t] = 1
          for k, v in pairs(t) do
            count_table_appearances(k, appearances)
            count_table_appearances(v, appearances)
          end
        else
          appearances[t] = ((appearances[t] or 0) + 1)
        end
      end
      return appearances
    end
    local function save_table(t, seen)
      local seen0 = (seen or {len = 0})
      local id = (seen0.len + 1)
      if not seen0[t] then
        seen0[t] = id
        seen0.len = id
      end
      return seen0
    end
    local function detect_cycle(t, seen)
      if ("table" == type(t)) then
        seen[t] = true
        local res = nil
        for k, v in pairs(t) do
          if res then break end
          res = (seen[k] or detect_cycle(k, seen) or seen[v] or detect_cycle(v, seen))
        end
        return res
      end
    end
    local function visible_cycle_3f(t, options)
      return (getopt(options, "detect-cycles?") and detect_cycle(t, {}) and save_table(t, options.seen) and (1 < (options.appearances[t] or 0)))
    end
    local function table_indent(indent, id)
      local opener_length = nil
      if id then
        opener_length = (length_2a(tostring(id)) + 2)
      else
        opener_length = 1
      end
      return (indent + opener_length)
    end
    local pp = nil
    local function concat_table_lines(elements, options, multiline_3f, indent, table_type, prefix, last_comment_3f)
      local indent_str = ("\n" .. string.rep(" ", indent))
      local open = nil
      local function _39_()
        if ("seq" == table_type) then
          return "["
        else
          return "{"
        end
      end
      open = ((prefix or "") .. _39_())
      local close = nil
      if ("seq" == table_type) then
        close = "]"
      else
        close = "}"
      end
      local oneline = (open .. table.concat(elements, " ") .. close)
      if (not getopt(options, "one-line?") and (multiline_3f or (options["line-length"] < (indent + length_2a(oneline))) or last_comment_3f)) then
        local function _41_()
          if last_comment_3f then
            return indent_str
          else
            return ""
          end
        end
        return (open .. table.concat(elements, indent_str) .. _41_() .. close)
      else
        return oneline
      end
    end
    local function comment_3f(x)
      if ("table" == type(x)) then
        local fst = x[1]
        return (("string" == type(fst)) and (nil ~= fst:find("^;")))
      else
        return false
      end
    end
    local function pp_associative(t, kv, options, indent)
      local multiline_3f = false
      local id = options.seen[t]
      if (options.depth <= options.level) then
        return "{...}"
      elseif (id and getopt(options, "detect-cycles?")) then
        return ("@" .. id .. "{...}")
      else
        local visible_cycle_3f0 = visible_cycle_3f(t, options)
        local id0 = (visible_cycle_3f0 and options.seen[t])
        local indent0 = table_indent(indent, id0)
        local prefix = nil
        if visible_cycle_3f0 then
          prefix = ("@" .. id0)
        else
          prefix = ""
        end
        local items = nil
        do
          local options0 = normalize_opts(options)
          local tbl_17_ = {}
          local i_18_ = #tbl_17_
          for _, _45_0 in ipairs(kv) do
            local _46_ = _45_0
            local k = _46_[1]
            local v = _46_[2]
            local val_19_ = nil
            do
              local k0 = pp(k, options0, (indent0 + 1), true)
              local v0 = pp(v, options0, indent0)
              multiline_3f = (multiline_3f or k0:find("\n") or v0:find("\n") or (options0["line-length"] < length_2a((k0 .. " " .. v0))))
              val_19_ = {k0, v0}
            end
            if (nil ~= val_19_) then
              i_18_ = (i_18_ + 1)
              tbl_17_[i_18_] = val_19_
            end
          end
          items = tbl_17_
        end
        local lines = nil
        do
          local lines0 = {}
          for _, _48_0 in ipairs(items) do
            local _49_ = _48_0
            local k = _49_[1]
            local v = _49_[2]
            if multiline_3f then
              table.insert(lines0, k)
              table.insert(lines0, v)
              lines0 = lines0
            else
              table.insert(lines0, (k .. " " .. v))
              lines0 = lines0
            end
          end
          lines = lines0
        end
        return concat_table_lines(lines, options, multiline_3f, indent0, "table", prefix, false)
      end
    end
    local function pp_sequence(t, kv, options, indent)
      local multiline_3f = false
      local id = options.seen[t]
      if (options.depth <= options.level) then
        return "[...]"
      elseif (id and getopt(options, "detect-cycles?")) then
        return ("@" .. id .. "[...]")
      else
        local visible_cycle_3f0 = visible_cycle_3f(t, options)
        local id0 = (visible_cycle_3f0 and options.seen[t])
        local indent0 = table_indent(indent, id0)
        local prefix = nil
        if visible_cycle_3f0 then
          prefix = ("@" .. id0)
        else
          prefix = ""
        end
        local last_comment_3f = comment_3f(t[#t])
        local items = nil
        do
          local options0 = normalize_opts(options)
          local tbl_17_ = {}
          local i_18_ = #tbl_17_
          for _, _53_0 in ipairs(kv) do
            local _54_ = _53_0
            local _0 = _54_[1]
            local v = _54_[2]
            local val_19_ = nil
            do
              local v0 = pp(v, options0, indent0)
              multiline_3f = (multiline_3f or v0:find("\n") or v0:find("^;"))
              val_19_ = v0
            end
            if (nil ~= val_19_) then
              i_18_ = (i_18_ + 1)
              tbl_17_[i_18_] = val_19_
            end
          end
          items = tbl_17_
        end
        return concat_table_lines(items, options, multiline_3f, indent0, "seq", prefix, last_comment_3f)
      end
    end
    local function concat_lines(lines, options, indent, force_multi_line_3f)
      if (length_2a(lines) == 0) then
        if getopt(options, "empty-as-sequence?") then
          return "[]"
        else
          return "{}"
        end
      else
        local oneline = nil
        local _58_
        do
          local tbl_17_ = {}
          local i_18_ = #tbl_17_
          for _, line in ipairs(lines) do
            local val_19_ = line:gsub("^%s+", "")
            if (nil ~= val_19_) then
              i_18_ = (i_18_ + 1)
              tbl_17_[i_18_] = val_19_
            end
          end
          _58_ = tbl_17_
        end
        oneline = table.concat(_58_, " ")
        if (not getopt(options, "one-line?") and (force_multi_line_3f or oneline:find("\n") or (options["line-length"] < (indent + length_2a(oneline))))) then
          return table.concat(lines, ("\n" .. string.rep(" ", indent)))
        else
          return oneline
        end
      end
    end
    local function pp_metamethod(t, metamethod, options, indent)
      if (options.depth <= options.level) then
        if getopt(options, "empty-as-sequence?") then
          return "[...]"
        else
          return "{...}"
        end
      else
        local _ = nil
        local function _63_(_241)
          return visible_cycle_3f(_241, options)
        end
        options["visible-cycle?"] = _63_
        _ = nil
        local lines, force_multi_line_3f = nil, nil
        do
          local options0 = normalize_opts(options)
          lines, force_multi_line_3f = metamethod(t, pp, options0, indent)
        end
        options["visible-cycle?"] = nil
        local _64_0 = type(lines)
        if (_64_0 == "string") then
          return lines
        elseif (_64_0 == "table") then
          return concat_lines(lines, options, indent, force_multi_line_3f)
        else
          local _0 = _64_0
          return error("__fennelview metamethod must return a table of lines")
        end
      end
    end
    local function pp_table(x, options, indent)
      options.level = (options.level + 1)
      local x0 = nil
      do
        local _67_0 = nil
        if getopt(options, "metamethod?") then
          local _68_0 = x
          if (nil ~= _68_0) then
            local _69_0 = getmetatable(_68_0)
            if (nil ~= _69_0) then
              _67_0 = _69_0.__fennelview
            else
              _67_0 = _69_0
            end
          else
            _67_0 = _68_0
          end
        else
        _67_0 = nil
        end
        if (nil ~= _67_0) then
          local metamethod = _67_0
          x0 = pp_metamethod(x, metamethod, options, indent)
        else
          local _ = _67_0
          local _73_0, _74_0 = table_kv_pairs(x, options)
          if (true and (_74_0 == "empty")) then
            local _0 = _73_0
            if getopt(options, "empty-as-sequence?") then
              x0 = "[]"
            else
              x0 = "{}"
            end
          elseif ((nil ~= _73_0) and (_74_0 == "table")) then
            local kv = _73_0
            x0 = pp_associative(x, kv, options, indent)
          elseif ((nil ~= _73_0) and (_74_0 == "seq")) then
            local kv = _73_0
            x0 = pp_sequence(x, kv, options, indent)
          else
          x0 = nil
          end
        end
      end
      options.level = (options.level - 1)
      return x0
    end
    local function exponential_notation(n, fallback)
      local s = nil
      for i = 0, 99 do
        if s then break end
        local s0 = string.format(("%." .. i .. "e"), n)
        if (n == tonumber(s0)) then
          local exp = s0:match("e%+?(%d+)$")
          if (exp and (14 < tonumber(exp))) then
            s = s0
          else
            s = fallback
          end
        else
        s = nil
        end
      end
      return s
    end
    local inf_str = tostring((1 / 0))
    local neg_inf_str = tostring((-1 / 0))
    local math_type = math.type
    local function integer__3estring(n, options)
      local s1 = tostring(n)
      if (math_type and ("integer" == math_type(n))) then
        return s1
      elseif (s1 == inf_str) then
        return (options.infinity or ".inf")
      elseif (s1 == neg_inf_str) then
        return (options["negative-infinity"] or "-.inf")
      elseif (s1 == string.format("%.0f", n)) then
        return s1
      else
        return (exponential_notation(n, s1) or s1)
      end
    end
    local function number__3estring(n, options)
      local val = nil
      if (n ~= n) then
        if (45 == string.byte(tostring(n))) then
          val = (options["negative-nan"] or "-.nan")
        else
          val = (options.nan or ".nan")
        end
      elseif (math.floor(n) == n) then
        val = integer__3estring(n, options)
      else
        val = tostring(n)
      end
      local _83_0 = string.gsub(val, ",", ".")
      return _83_0
    end
    local function colon_string_3f(s)
      return s:find("^[-%w?^_!$%&*+./|<=>]+$")
    end
    local utf8_inits = {{["max-byte"] = 127, ["max-code"] = 127, ["min-byte"] = 0, ["min-code"] = 0, len = 1}, {["max-byte"] = 223, ["max-code"] = 2047, ["min-byte"] = 192, ["min-code"] = 128, len = 2}, {["max-byte"] = 239, ["max-code"] = 65535, ["min-byte"] = 224, ["min-code"] = 2048, len = 3}, {["max-byte"] = 247, ["max-code"] = 1114111, ["min-byte"] = 240, ["min-code"] = 65536, len = 4}}
    local function default_byte_escape(byte, _options)
      return ("\\%03d"):format(byte)
    end
    local function utf8_escape(str, options)
      local function validate_utf8(str0, index)
        local inits = utf8_inits
        local byte = string.byte(str0, index)
        local init = nil
        do
          local ret = nil
          for _, init0 in ipairs(inits) do
            if ret then break end
            ret = (byte and (function(_84_,_85_,_86_) return (_84_ <= _85_) and (_85_ <= _86_) end)(init0["min-byte"],byte,init0["max-byte"]) and init0)
          end
          init = ret
        end
        local code = nil
        local function _87_()
          local code0 = nil
          if init then
            code0 = (byte - init["min-byte"])
          else
            code0 = nil
          end
          for i = (index + 1), (index + init.len + -1) do
            local byte0 = string.byte(str0, i)
            code0 = (byte0 and code0 and ((128 <= byte0) and (byte0 <= 191)) and ((code0 * 64) + (byte0 - 128)))
          end
          return code0
        end
        code = (init and _87_())
        if (code and (function(_89_,_90_,_91_) return (_89_ <= _90_) and (_90_ <= _91_) end)(init["min-code"],code,init["max-code"]) and not ((55296 <= code) and (code <= 57343))) then
          return init.len
        end
      end
      local index = 1
      local output = {}
      local byte_escape = (getopt(options, "byte-escape") or default_byte_escape)
      while (index <= #str) do
        local nexti = (string.find(str, "[\128-\255]", index) or (#str + 1))
        local len = validate_utf8(str, nexti)
        table.insert(output, string.sub(str, index, (nexti + (len or 0) + -1)))
        if (not len and (nexti <= #str)) then
          table.insert(output, byte_escape(str:byte(nexti), options))
        end
        if len then
          index = (nexti + len)
        else
          index = (nexti + 1)
        end
      end
      return table.concat(output)
    end
    local function pp_string(str, options, indent)
      local len = length_2a(str)
      local esc_newline_3f = ((len < 2) or (getopt(options, "escape-newlines?") and (len < (options["line-length"] - indent))))
      local byte_escape = (getopt(options, "byte-escape") or default_byte_escape)
      local escs = nil
      local _95_
      if esc_newline_3f then
        _95_ = "\\n"
      else
        _95_ = "\n"
      end
      local function _97_(_241, _242)
        return byte_escape(_242:byte(), options)
      end
      escs = setmetatable({["\""] = "\\\"", ["\11"] = "\\v", ["\12"] = "\\f", ["\13"] = "\\r", ["\7"] = "\\a", ["\8"] = "\\b", ["\9"] = "\\t", ["\\"] = "\\\\", ["\n"] = _95_}, {__index = _97_})
      local str0 = ("\"" .. str:gsub("[%c\\\"]", escs) .. "\"")
      if getopt(options, "utf8?") then
        return utf8_escape(str0, options)
      else
        return str0
      end
    end
    local function make_options(t, _3foptions)
      local defaults = nil
      do
        local tbl_14_ = {}
        for k, v in pairs(default_opts) do
          local k_15_, v_16_ = k, v
          if ((k_15_ ~= nil) and (v_16_ ~= nil)) then
            tbl_14_[k_15_] = v_16_
          end
        end
        defaults = tbl_14_
      end
      local overrides = {appearances = count_table_appearances(t, {}), level = 0, seen = {len = 0}}
      for k, v in pairs((_3foptions or {})) do
        defaults[k] = v
      end
      for k, v in pairs(overrides) do
        defaults[k] = v
      end
      return defaults
    end
    local function _100_(x, options, indent, colon_3f)
      local indent0 = (indent or 0)
      local options0 = (options or make_options(x))
      local x0 = nil
      if options0.preprocess then
        x0 = options0.preprocess(x, options0)
      else
        x0 = x
      end
      local tv = type(x0)
      local function _103_()
        local _102_0 = getmetatable(x0)
        if ((_G.type(_102_0) == "table") and true) then
          local __fennelview = _102_0.__fennelview
          return __fennelview
        end
      end
      if ((tv == "table") or ((tv == "userdata") and _103_())) then
        return pp_table(x0, options0, indent0)
      elseif (tv == "number") then
        return number__3estring(x0, options0)
      else
        local function _105_()
          if (colon_3f ~= nil) then
            return colon_3f
          elseif ("function" == type(options0["prefer-colon?"])) then
            return options0["prefer-colon?"](x0)
          else
            return getopt(options0, "prefer-colon?")
          end
        end
        if ((tv == "string") and colon_string_3f(x0) and _105_()) then
          return (":" .. x0)
        elseif (tv == "string") then
          return pp_string(x0, options0, indent0)
        elseif ((tv == "boolean") or (tv == "nil")) then
          return tostring(x0)
        else
          return ("#<" .. tostring(x0) .. ">")
        end
      end
    end
    pp = _100_
    local function _view(x, _3foptions)
      return pp(x, make_options(x, _3foptions), 0)
    end
    return _view
  end
  package.preload["fennel.utils"] = package.preload["fennel.utils"] or function(...)
    local view = require("fennel.view")
    local version = "1.6.1"
    local unpack = (table.unpack or _G.unpack)
    local pack = nil
    local function _107_(...)
      local _108_0 = {...}
      _108_0["n"] = select("#", ...)
      return _108_0
    end
    pack = (table.pack or _107_)
    local maxn = nil
    local function _109_(_241)
      local max = 0
      for k in pairs(_241) do
        if (("number" == type(k)) and (max < k)) then
          max = k
        else
          max = max
        end
      end
      return max
    end
    maxn = (table.maxn or _109_)
    local function luajit_vm_3f()
      return ((nil ~= _G.jit) and (type(_G.jit) == "table") and (nil ~= _G.jit.on) and (nil ~= _G.jit.off) and (type(_G.jit.version_num) == "number"))
    end
    local function luajit_vm_version()
      local jit_os = nil
      if (_G.jit.os == "OSX") then
        jit_os = "macOS"
      else
        jit_os = _G.jit.os
      end
      return (_G.jit.version .. " " .. jit_os .. "/" .. _G.jit.arch)
    end
    local function fengari_vm_3f()
      return ((nil ~= _G.fengari) and (type(_G.fengari) == "table") and (nil ~= _G.fengari.VERSION) and (type(_G.fengari.VERSION_NUM) == "number"))
    end
    local function fengari_vm_version()
      return (_G.fengari.RELEASE .. " (" .. _VERSION .. ")")
    end
    local function lua_vm_version()
      if luajit_vm_3f() then
        return luajit_vm_version()
      elseif fengari_vm_3f() then
        return fengari_vm_version()
      else
        return ("PUC " .. _VERSION)
      end
    end
    local function runtime_version(_3fas_table)
      if _3fas_table then
        return {fennel = version, lua = lua_vm_version()}
      else
        return ("Fennel " .. version .. " on " .. lua_vm_version())
      end
    end
    local len = nil
    do
      local _114_0, _115_0 = pcall(require, "utf8")
      if ((_114_0 == true) and (nil ~= _115_0)) then
        local utf8 = _115_0
        len = utf8.len
      else
        local _ = _114_0
        len = string.len
      end
    end
    local kv_order = {boolean = 2, number = 1, string = 3, table = 4}
    local function kv_compare(a, b)
      local _117_0, _118_0 = type(a), type(b)
      if (((_117_0 == "number") and (_118_0 == "number")) or ((_117_0 == "string") and (_118_0 == "string"))) then
        return (a < b)
      else
        local function _119_()
          local a_t = _117_0
          local b_t = _118_0
          return (a_t ~= b_t)
        end
        if (((nil ~= _117_0) and (nil ~= _118_0)) and _119_()) then
          local a_t = _117_0
          local b_t = _118_0
          return ((kv_order[a_t] or 5) < (kv_order[b_t] or 5))
        else
          local _ = _117_0
          return (tostring(a) < tostring(b))
        end
      end
    end
    local function add_stable_keys(succ, prev_key, src, _3fpred)
      local first = prev_key
      local last = nil
      do
        local prev = prev_key
        for _, k in ipairs(src) do
          if ((prev == k) or (succ[k] ~= nil) or (_3fpred and not _3fpred(k))) then
            prev = prev
          else
            if (first == nil) then
              first = k
              prev = k
            elseif (prev ~= nil) then
              succ[prev] = k
              prev = k
            else
              prev = k
            end
          end
        end
        last = prev
      end
      return succ, last, first
    end
    local function stablepairs(t)
      local mt_keys = nil
      do
        local _123_0 = getmetatable(t)
        if (nil ~= _123_0) then
          _123_0 = _123_0.keys
        end
        mt_keys = _123_0
      end
      local succ, prev, first_mt = nil, nil, nil
      local function _125_(_241)
        return t[_241]
      end
      succ, prev, first_mt = add_stable_keys({}, nil, (mt_keys or {}), _125_)
      local pairs_keys = nil
      do
        local _126_0 = nil
        do
          local tbl_17_ = {}
          local i_18_ = #tbl_17_
          for k in pairs(t) do
            local val_19_ = k
            if (nil ~= val_19_) then
              i_18_ = (i_18_ + 1)
              tbl_17_[i_18_] = val_19_
            end
          end
          _126_0 = tbl_17_
        end
        table.sort(_126_0, kv_compare)
        pairs_keys = _126_0
      end
      local succ0, _, first_after_mt = add_stable_keys(succ, prev, pairs_keys)
      local first = nil
      if (first_mt == nil) then
        first = first_after_mt
      else
        first = first_mt
      end
      local function stablenext(tbl, key)
        local _129_0 = nil
        if (key == nil) then
          _129_0 = first
        else
          _129_0 = succ0[key]
        end
        if (nil ~= _129_0) then
          local next_key = _129_0
          local _131_0 = tbl[next_key]
          if (_131_0 ~= nil) then
            return next_key, _131_0
          else
            return _131_0
          end
        end
      end
      return stablenext, t, nil
    end
    local function get_in(tbl, path)
      if (nil ~= path[1]) then
        local t = tbl
        for _, k in ipairs(path) do
          if (nil == t) then break end
          if (type(t) == "table") then
            t = t[k]
          else
          t = nil
          end
        end
        return t
      end
    end
    local function copy(_3ffrom, _3fto)
      local tbl_14_ = (_3fto or {})
      for k, v in pairs((_3ffrom or {})) do
        local k_15_, v_16_ = k, v
        if ((k_15_ ~= nil) and (v_16_ ~= nil)) then
          tbl_14_[k_15_] = v_16_
        end
      end
      return tbl_14_
    end
    local function member_3f(x, tbl, _3fn)
      local _137_0 = tbl[(_3fn or 1)]
      if (_137_0 == x) then
        return true
      elseif (_137_0 == nil) then
        return nil
      else
        local _ = _137_0
        return member_3f(x, tbl, ((_3fn or 1) + 1))
      end
    end
    local function every_3f(t, predicate)
      local result = true
      for _, item in ipairs(t) do
        if not result then break end
        result = predicate(item)
      end
      return result
    end
    local function allpairs(tbl)
      assert((type(tbl) == "table"), "allpairs expects a table")
      local t = tbl
      local seen = {}
      local function allpairs_next(_, _3fstate)
        local next_state, value = next(t, _3fstate)
        if seen[next_state] then
          return allpairs_next(nil, next_state)
        elseif next_state then
          seen[next_state] = true
          return next_state, value
        else
          local _139_0 = getmetatable(t)
          if ((_G.type(_139_0) == "table") and true) then
            local __index = _139_0.__index
            if ("table" == type(__index)) then
              t = __index
              return allpairs_next(t)
            end
          end
        end
      end
      return allpairs_next
    end
    local function deref(self)
      return self[1]
    end
    local function list__3estring(self, _3fview, _3foptions, _3findent)
      local viewed = nil
      do
        local tbl_17_ = {}
        local i_18_ = #tbl_17_
        for i = 1, maxn(self) do
          local val_19_ = nil
          if _3fview then
            val_19_ = _3fview(self[i], _3foptions, _3findent)
          else
            val_19_ = view(self[i])
          end
          if (nil ~= val_19_) then
            i_18_ = (i_18_ + 1)
            tbl_17_[i_18_] = val_19_
          end
        end
        viewed = tbl_17_
      end
      return ("(" .. table.concat(viewed, " ") .. ")")
    end
    local function sym_3d(a, b)
      return ((deref(a) == deref(b)) and (getmetatable(a) == getmetatable(b)))
    end
    local function sym_3c(a, b)
      return (a[1] < tostring(b))
    end
    local symbol_mt = {"SYMBOL", __eq = sym_3d, __fennelview = deref, __lt = sym_3c, __tostring = deref}
    local expr_mt = nil
    local function _145_(x)
      return tostring(deref(x))
    end
    expr_mt = {"EXPR", __tostring = _145_}
    local list_mt = {"LIST", __fennelview = list__3estring, __tostring = list__3estring}
    local comment_mt = nil
    local function _146_(_241)
      return _241
    end
    comment_mt = {"COMMENT", __eq = sym_3d, __fennelview = _146_, __lt = sym_3c, __tostring = deref}
    local sequence_marker = {"SEQUENCE"}
    local varg_mt = {"VARARG", __fennelview = deref, __tostring = deref}
    local getenv = nil
    local function _147_()
      return nil
    end
    getenv = ((os and os.getenv) or _147_)
    local function debug_on_3f(_3fflag)
      local dbg = getenv("FENNEL_DEBUG")
      if (_3fflag == nil) then
        return (nil ~= dbg)
      else
        return (dbg and dbg:find(_3fflag))
      end
    end
    local function list(...)
      return setmetatable({...}, list_mt)
    end
    local function sym(str, _3fsource)
      assert((type(str) == "string"), ("sym expects a string as the first argument, received " .. type(str)))
      local _149_
      do
        local tbl_14_ = {str}
        for k, v in pairs((_3fsource or {})) do
          local k_15_, v_16_ = nil, nil
          if (type(k) == "string") then
            k_15_, v_16_ = k, v
          else
          k_15_, v_16_ = nil
          end
          if ((k_15_ ~= nil) and (v_16_ ~= nil)) then
            tbl_14_[k_15_] = v_16_
          end
        end
        _149_ = tbl_14_
      end
      return setmetatable(_149_, symbol_mt)
    end
    local function sequence(...)
      local function _152_(seq, view0, inspector, indent)
        local opts = nil
        do
          inspector["empty-as-sequence?"] = {after = inspector["empty-as-sequence?"], once = true}
          inspector["metamethod?"] = {after = inspector["metamethod?"], once = false}
          opts = inspector
        end
        return view0(seq, opts, indent)
      end
      return setmetatable({...}, {__fennelview = _152_, sequence = sequence_marker})
    end
    local function expr(strcode, etype)
      return setmetatable({strcode, type = etype}, expr_mt)
    end
    local function comment_2a(contents, _3fsource)
      local _153_ = (_3fsource or {})
      local filename = _153_["filename"]
      local line = _153_["line"]
      return setmetatable({contents, filename = filename, line = line}, comment_mt)
    end
    local function varg(_3fsource)
      local _154_
      do
        local tbl_14_ = {"..."}
        for k, v in pairs((_3fsource or {})) do
          local k_15_, v_16_ = nil, nil
          if (type(k) == "string") then
            k_15_, v_16_ = k, v
          else
          k_15_, v_16_ = nil
          end
          if ((k_15_ ~= nil) and (v_16_ ~= nil)) then
            tbl_14_[k_15_] = v_16_
          end
        end
        _154_ = tbl_14_
      end
      return setmetatable(_154_, varg_mt)
    end
    local function expr_3f(x)
      return ((type(x) == "table") and (getmetatable(x) == expr_mt) and x)
    end
    local function varg_3f(x)
      return ((type(x) == "table") and (getmetatable(x) == varg_mt) and x)
    end
    local function list_3f(x)
      return ((type(x) == "table") and (getmetatable(x) == list_mt) and x)
    end
    local function sym_3f(x, _3fname)
      return ((type(x) == "table") and (getmetatable(x) == symbol_mt) and ((nil == _3fname) or (x[1] == _3fname)) and x)
    end
    local function sequence_3f(x)
      local mt = ((type(x) == "table") and getmetatable(x))
      return (mt and (mt.sequence == sequence_marker) and x)
    end
    local function comment_3f(x)
      return ((type(x) == "table") and (getmetatable(x) == comment_mt) and x)
    end
    local function table_3f(x)
      return ((type(x) == "table") and not varg_3f(x) and (getmetatable(x) ~= list_mt) and (getmetatable(x) ~= symbol_mt) and not comment_3f(x) and x)
    end
    local function kv_table_3f(t)
      if table_3f(t) then
        local nxt, t0, k = pairs(t)
        local len0 = #t0
        local next_state = nil
        if (0 == len0) then
          next_state = k
        else
          next_state = len0
        end
        return ((nil ~= nxt(t0, next_state)) and t0)
      end
    end
    local function string_3f(x)
      if (type(x) == "string") then
        return x
      else
        return false
      end
    end
    local function multi_sym_3f(str)
      if sym_3f(str) then
        return multi_sym_3f(tostring(str))
      elseif (type(str) ~= "string") then
        return false
      else
        local function _160_()
          local parts = {}
          for part in str:gmatch("[^%.%:]+[%.%:]?") do
            local last_char = part:sub(-1)
            if (last_char == ":") then
              parts["multi-sym-method-call"] = true
            end
            if ((last_char == ":") or (last_char == ".")) then
              parts[(#parts + 1)] = part:sub(1, -2)
            else
              parts[(#parts + 1)] = part
            end
          end
          return (next(parts) and parts)
        end
        return ((str:match("%.") or str:match(":")) and not str:match("%.%.") and (str:byte() ~= string.byte(".")) and (str:byte() ~= string.byte(":")) and (str:byte(-1) ~= string.byte(".")) and (str:byte(-1) ~= string.byte(":")) and _160_())
      end
    end
    local function call_of_3f(ast, callee)
      return (list_3f(ast) and sym_3f(ast[1], callee))
    end
    local function quoted_3f(symbol)
      return symbol.quoted
    end
    local function idempotent_expr_3f(x)
      local t = type(x)
      return ((t == "string") or (t == "number") or (t == "boolean") or (sym_3f(x) and not multi_sym_3f(x)))
    end
    local function walk_tree(root, f, _3fcustom_iterator)
      local function walk(iterfn, parent, idx, node)
        if (f(idx, node, parent) and not sym_3f(node)) then
          for k, v in iterfn(node) do
            walk(iterfn, node, k, v)
          end
          return nil
        end
      end
      walk((_3fcustom_iterator or pairs), nil, nil, root)
      return root
    end
    local root = nil
    local function _165_()
    end
    root = {chunk = nil, options = nil, reset = _165_, scope = nil}
    root["set-reset"] = function(_166_0)
      local _167_ = _166_0
      local chunk = _167_["chunk"]
      local options = _167_["options"]
      local reset = _167_["reset"]
      local scope = _167_["scope"]
      root.reset = function()
        root.chunk, root.scope, root.options, root.reset = chunk, scope, options, reset
        return nil
      end
      return root.reset
    end
    local lua_keywords = {["and"] = true, ["break"] = true, ["do"] = true, ["else"] = true, ["elseif"] = true, ["end"] = true, ["false"] = true, ["for"] = true, ["function"] = true, ["goto"] = true, ["if"] = true, ["in"] = true, ["local"] = true, ["nil"] = true, ["not"] = true, ["or"] = true, ["repeat"] = true, ["return"] = true, ["then"] = true, ["true"] = true, ["until"] = true, ["while"] = true}
    local function lua_keyword_3f(str)
      local function _169_()
        local _168_0 = root.options
        if (nil ~= _168_0) then
          _168_0 = _168_0.keywords
        end
        if (nil ~= _168_0) then
          _168_0 = _168_0[str]
        end
        return _168_0
      end
      return (lua_keywords[str] or _169_())
    end
    local function valid_lua_identifier_3f(str)
      return (str:match("^[%a_][%w_]*$") and not lua_keyword_3f(str))
    end
    local propagated_options = {"allowedGlobals", "indent", "correlate", "useMetadata", "env", "compiler-env", "compilerEnv"}
    local function propagate_options(options, subopts)
      local tbl_14_ = subopts
      for _, name in ipairs(propagated_options) do
        local k_15_, v_16_ = name, options[name]
        if ((k_15_ ~= nil) and (v_16_ ~= nil)) then
          tbl_14_[k_15_] = v_16_
        end
      end
      return tbl_14_
    end
    local function ast_source(ast)
      if (table_3f(ast) or sequence_3f(ast)) then
        return (getmetatable(ast) or {})
      elseif ("table" == type(ast)) then
        return ast
      else
        return {}
      end
    end
    local function warn(msg, _3fast, _3ffilename, _3fline, _3fcol)
      local _174_0 = nil
      do
        local _175_0 = root.options
        if (nil ~= _175_0) then
          _175_0 = _175_0.warn
        end
        _174_0 = _175_0
      end
      if (nil ~= _174_0) then
        local opt_warn = _174_0
        return opt_warn(msg, _3fast, _3ffilename, _3fline, _3fcol)
      else
        local _ = _174_0
        if (_G.io and _G.io.stderr) then
          local loc = nil
          do
            local _177_0 = ast_source(_3fast)
            if ((_G.type(_177_0) == "table") and (nil ~= _177_0.col) and (nil ~= _177_0.filename) and (nil ~= _177_0.line)) then
              local col = _177_0.col
              local filename = _177_0.filename
              local line = _177_0.line
              loc = (filename .. ":" .. line .. ":" .. col .. ": ")
            else
              local _0 = _177_0
              if (_3ffilename and _3fline and _3fcol) then
                loc = (_3ffilename .. ":" .. _3fline .. ":" .. _3fcol .. ": ")
              else
                loc = ""
              end
            end
          end
          return (_G.io.stderr):write(("--WARNING: %s%s\n"):format(loc, msg))
        end
      end
    end
    local warned = {}
    local function check_plugin_version(_182_0)
      local _183_ = _182_0
      local plugin = _183_
      local name = _183_["name"]
      local versions = _183_["versions"]
      if (not member_3f(version:gsub("-dev", ""), (versions or {})) and not (string_3f(versions) and version:find(versions)) and not warned[plugin]) then
        warned[plugin] = true
        return warn(string.format("plugin %s does not support Fennel version %s", (name or "unknown"), version))
      end
    end
    local function hook_opts(event, _3foptions, ...)
      local plugins = nil
      local function _186_(...)
        local _185_0 = _3foptions
        if (nil ~= _185_0) then
          _185_0 = _185_0.plugins
        end
        return _185_0
      end
      local function _189_(...)
        local _188_0 = root.options
        if (nil ~= _188_0) then
          _188_0 = _188_0.plugins
        end
        return _188_0
      end
      plugins = (_186_(...) or _189_(...))
      if plugins then
        local result = nil
        for _, plugin in ipairs(plugins) do
          if (nil ~= result) then break end
          check_plugin_version(plugin)
          local _191_0 = plugin[event]
          if (nil ~= _191_0) then
            local f = _191_0
            result = f(...)
          else
          result = nil
          end
        end
        return result
      end
    end
    local function hook(event, ...)
      return hook_opts(event, root.options, ...)
    end
    return {["ast-source"] = ast_source, ["call-of?"] = call_of_3f, ["comment?"] = comment_3f, ["debug-on?"] = debug_on_3f, ["every?"] = every_3f, ["expr?"] = expr_3f, ["fennel-module"] = nil, ["get-in"] = get_in, ["hook-opts"] = hook_opts, ["idempotent-expr?"] = idempotent_expr_3f, ["kv-table?"] = kv_table_3f, ["list?"] = list_3f, ["lua-keyword?"] = lua_keyword_3f, ["macro-path"] = table.concat({"./?.fnlm", "./?/init.fnlm", "./?.fnl", "./?/init-macros.fnl", "./?/init.fnl", getenv("FENNEL_MACRO_PATH")}, ";"), ["member?"] = member_3f, ["multi-sym?"] = multi_sym_3f, ["propagate-options"] = propagate_options, ["quoted?"] = quoted_3f, ["runtime-version"] = runtime_version, ["sequence?"] = sequence_3f, ["string?"] = string_3f, ["sym?"] = sym_3f, ["table?"] = table_3f, ["valid-lua-identifier?"] = valid_lua_identifier_3f, ["varg?"] = varg_3f, ["walk-tree"] = walk_tree, allpairs = allpairs, comment = comment_2a, copy = copy, expr = expr, hook = hook, len = len, list = list, maxn = maxn, pack = pack, path = table.concat({"./?.fnl", "./?/init.fnl", getenv("FENNEL_PATH")}, ";"), root = root, sequence = sequence, stablepairs = stablepairs, sym = sym, unpack = unpack, varg = varg, version = version, warn = warn}
  end
  utils = require("fennel.utils")
  local parser = require("fennel.parser")
  local compiler = require("fennel.compiler")
  local specials = require("fennel.specials")
  local repl = require("fennel.repl")
  local view = require("fennel.view")
  local function eval_env(env, opts)
    if (env == "_COMPILER") then
      local env0 = specials["make-compiler-env"](nil, compiler.scopes.compiler, {}, opts)
      do
        local tbl_14_ = env0
        for k, v in pairs((opts["extra-env"] or {})) do
          local k_15_, v_16_ = k, v
          if ((k_15_ ~= nil) and (v_16_ ~= nil)) then
            tbl_14_[k_15_] = v_16_
          end
        end
      end
      if (opts.allowedGlobals == nil) then
        opts.allowedGlobals = specials["current-global-names"](env0)
      end
      return specials["wrap-env"](env0)
    else
      return (env and specials["wrap-env"](env))
    end
  end
  local function eval_opts(options, str)
    local opts = utils.copy(options)
    if (opts.allowedGlobals == nil) then
      opts.allowedGlobals = specials["current-global-names"](opts.env)
    end
    if (not opts.filename and not opts.source) then
      opts.source = str
    end
    if (opts.env == "_COMPILER") then
      opts.scope = compiler["make-scope"](compiler.scopes.compiler)
    end
    return opts
  end
  local function eval(str, _3foptions, ...)
    local opts = eval_opts(_3foptions, str)
    local env = eval_env(opts.env, opts)
    local lua_source = compiler["compile-string"](str, opts)
    local loader = nil
    local function _910_(...)
      if opts.filename then
        return ("@" .. opts.filename)
      else
        return str
      end
    end
    loader = specials["load-code"](lua_source, env, _910_(...))
    opts.filename = nil
    return loader(...)
  end
  local function dofile_2a(filename, _3foptions, ...)
    local opts = utils.copy(_3foptions)
    local f = assert(io.open(filename, "rb"))
    local source = assert(f:read("*all"), ("Could not read " .. filename))
    f:close()
    opts.filename = filename
    return eval(source, opts, ...)
  end
  local function syntax()
    local body_3f = {"when", "with-open", "collect", "icollect", "fcollect", "lambda", "\206\187", "macro", "match", "match-try", "case", "case-try", "accumulate", "faccumulate", "doto"}
    local binding_3f = {"collect", "icollect", "fcollect", "each", "for", "let", "with-open", "accumulate", "faccumulate"}
    local define_3f = {"fn", "lambda", "\206\187", "var", "local", "macro", "macros", "global"}
    local deprecated = {"~=", "#", "global", "require-macros", "pick-args"}
    local out = {}
    for k, v in pairs(compiler.scopes.global.specials) do
      local metadata = (compiler.metadata[v] or {})
      out[k] = {["binding-form?"] = utils["member?"](k, binding_3f), ["body-form?"] = metadata["fnl/body-form?"], ["define?"] = utils["member?"](k, define_3f), ["deprecated?"] = utils["member?"](k, deprecated), ["special?"] = true}
    end
    for k in pairs(compiler.scopes.global.macros) do
      out[k] = {["binding-form?"] = utils["member?"](k, binding_3f), ["body-form?"] = utils["member?"](k, body_3f), ["define?"] = utils["member?"](k, define_3f), ["macro?"] = true}
    end
    for k, v in pairs(_G) do
      local _911_0 = type(v)
      if (_911_0 == "function") then
        out[k] = {["function?"] = true, ["global?"] = true}
      elseif (_911_0 == "table") then
        if not k:find("^_") then
          for k2, v2 in pairs(v) do
            if ("function" == type(v2)) then
              out[(k .. "." .. k2)] = {["function?"] = true, ["global?"] = true}
            end
          end
          out[k] = {["global?"] = true}
        end
      end
    end
    return out
  end
  local mod = {["ast-source"] = utils["ast-source"], ["comment?"] = utils["comment?"], ["compile-stream"] = compiler["compile-stream"], ["compile-string"] = compiler["compile-string"], ["list?"] = utils["list?"], ["load-code"] = specials["load-code"], ["macro-loaded"] = specials["macro-loaded"], ["macro-path"] = utils["macro-path"], ["macro-searchers"] = specials["macro-searchers"], ["make-searcher"] = specials["make-searcher"], ["multi-sym?"] = utils["multi-sym?"], ["runtime-version"] = utils["runtime-version"], ["search-module"] = specials["search-module"], ["sequence?"] = utils["sequence?"], ["string-stream"] = parser["string-stream"], ["sym-char?"] = parser["sym-char?"], ["sym?"] = utils["sym?"], ["table?"] = utils["table?"], ["varg?"] = utils["varg?"], comment = utils.comment, compile = compiler.compile, compile1 = compiler.compile1, compileStream = compiler["compile-stream"], compileString = compiler["compile-string"], doc = specials.doc, dofile = dofile_2a, eval = eval, gensym = compiler.gensym, getinfo = compiler.getinfo, granulate = parser.granulate, list = utils.list, loadCode = specials["load-code"], macroLoaded = specials["macro-loaded"], macroPath = utils["macro-path"], macroSearchers = specials["macro-searchers"], makeSearcher = specials["make-searcher"], make_searcher = specials["make-searcher"], mangle = compiler["global-mangling"], metadata = compiler.metadata, parser = parser.parser, path = utils.path, repl = repl, runtimeVersion = utils["runtime-version"], scope = compiler["make-scope"], searchModule = specials["search-module"], searcher = specials["make-searcher"](), sequence = utils.sequence, stringStream = parser["string-stream"], sym = utils.sym, syntax = syntax, traceback = compiler.traceback, unmangle = compiler["global-unmangling"], varg = utils.varg, version = utils.version, view = view}
  mod.install = function(_3fopts)
    table.insert((package.searchers or package.loaders), specials["make-searcher"](_3fopts))
    return mod
  end
  utils["fennel-module"] = mod
  local function load_macros(src, env)
    local chunk = assert(specials["load-code"](src, env))
    for k, v in pairs(chunk(utils, specials["get-function-metadata"])) do
      compiler.scopes.global.macros[k] = v
    end
    return nil
  end
  do
    local env = specials["make-compiler-env"](nil, compiler.scopes.compiler, {})
    load_macros([===[local utils, get_function_metadata = ...
    local function copy(t)
      local out = {}
      for _, v in ipairs(t) do
        table.insert(out, v)
      end
      return setmetatable(out, getmetatable(t))
    end
    utils['fennel-module'].metadata:setall(copy, "fnl/arglist", {"t"})
    local function __3e_2a(val, ...)
      local x = val
      for _, e in ipairs({...}) do
        local elt = nil
        if _G["list?"](e) then
          elt = copy(e)
        else
          elt = list(e)
        end
        table.insert(elt, 2, x)
        x = elt
      end
      return x
    end
    utils['fennel-module'].metadata:setall(__3e_2a, "fnl/arglist", {"val", "..."}, "fnl/docstring", "Thread-first macro.\nTake the first value and splice it into the second form as its first argument.\nThe value of the second form is spliced into the first arg of the third, etc.")
    local function __3e_3e_2a(val, ...)
      local x = val
      for _, e in ipairs({...}) do
        local elt = nil
        if _G["list?"](e) then
          elt = copy(e)
        else
          elt = list(e)
        end
        table.insert(elt, x)
        x = elt
      end
      return x
    end
    utils['fennel-module'].metadata:setall(__3e_3e_2a, "fnl/arglist", {"val", "..."}, "fnl/docstring", "Thread-last macro.\nSame as ->, except splices the value into the last position of each form\nrather than the first.")
    local function __3f_3e_2a(val, _3fe, ...)
      if (nil == _3fe) then
        return val
      elseif not utils["idempotent-expr?"](val) then
        return setmetatable({filename="src/fennel/macros.fnl", line=43, bytestart=1272, sym('let', nil, {quoted=true, filename="src/fennel/macros.fnl", line=43}), setmetatable({sym('tmp_3_', nil, {filename="src/fennel/macros.fnl", line=43}), val}, {filename="src/fennel/macros.fnl", line=43}), setmetatable({filename="src/fennel/macros.fnl", line=44, bytestart=1297, sym('-?>', nil, {quoted=true, filename="src/fennel/macros.fnl", line=44}), sym('tmp_3_', nil, {filename="src/fennel/macros.fnl", line=44}), _3fe, ...}, getmetatable(list()))}, getmetatable(list()))
      else
        local call = nil
        if _G["list?"](_3fe) then
          call = copy(_3fe)
        else
          call = list(_3fe)
        end
        table.insert(call, 2, val)
        return setmetatable({filename="src/fennel/macros.fnl", line=47, bytestart=1415, sym('if', nil, {quoted=true, filename="src/fennel/macros.fnl", line=47}), setmetatable({filename="src/fennel/macros.fnl", line=47, bytestart=1419, sym('not=', nil, {quoted=true, filename="src/fennel/macros.fnl", line=47}), sym('nil', nil, {quoted=true, filename="src/fennel/macros.fnl", line=47}), val}, getmetatable(list())), __3f_3e_2a(call, ...)}, getmetatable(list()))
      end
    end
    utils['fennel-module'].metadata:setall(__3f_3e_2a, "fnl/arglist", {"val", "?e", "..."}, "fnl/docstring", "Nil-safe thread-first macro.\nSame as -> except will short-circuit with nil when it encounters a nil value.")
    local function __3f_3e_3e_2a(val, _3fe, ...)
      if (nil == _3fe) then
        return val
      elseif not utils["idempotent-expr?"](val) then
        return setmetatable({filename="src/fennel/macros.fnl", line=57, bytestart=1725, sym('let', nil, {quoted=true, filename="src/fennel/macros.fnl", line=57}), setmetatable({sym('tmp_6_', nil, {filename="src/fennel/macros.fnl", line=57}), val}, {filename="src/fennel/macros.fnl", line=57}), setmetatable({filename="src/fennel/macros.fnl", line=58, bytestart=1750, sym('-?>>', nil, {quoted=true, filename="src/fennel/macros.fnl", line=58}), sym('tmp_6_', nil, {filename="src/fennel/macros.fnl", line=58}), _3fe, ...}, getmetatable(list()))}, getmetatable(list()))
      else
        local call = nil
        if _G["list?"](_3fe) then
          call = copy(_3fe)
        else
          call = list(_3fe)
        end
        table.insert(call, val)
        return setmetatable({filename="src/fennel/macros.fnl", line=61, bytestart=1867, sym('if', nil, {quoted=true, filename="src/fennel/macros.fnl", line=61}), setmetatable({filename="src/fennel/macros.fnl", line=61, bytestart=1871, sym('not=', nil, {quoted=true, filename="src/fennel/macros.fnl", line=61}), val, sym('nil', nil, {quoted=true, filename="src/fennel/macros.fnl", line=61})}, getmetatable(list())), __3f_3e_3e_2a(call, ...)}, getmetatable(list()))
      end
    end
    utils['fennel-module'].metadata:setall(__3f_3e_3e_2a, "fnl/arglist", {"val", "?e", "..."}, "fnl/docstring", "Nil-safe thread-last macro.\nSame as ->> except will short-circuit with nil when it encounters a nil value.")
    local function _3fdot(tbl, ...)
      local head = gensym("t")
      local lookups = setmetatable({filename="src/fennel/macros.fnl", line=69, bytestart=2122, sym('do', nil, {quoted=true, filename="src/fennel/macros.fnl", line=69}), setmetatable({filename="src/fennel/macros.fnl", line=70, bytestart=2145, sym('var', nil, {quoted=true, filename="src/fennel/macros.fnl", line=70}), head, tbl}, getmetatable(list())), head}, getmetatable(list()))
      for i, k in ipairs({...}) do
        table.insert(lookups, (i + 2), setmetatable({filename="src/fennel/macros.fnl", line=76, bytestart=2433, sym('if', nil, {quoted=true, filename="src/fennel/macros.fnl", line=76}), setmetatable({filename="src/fennel/macros.fnl", line=76, bytestart=2437, sym('not=', nil, {quoted=true, filename="src/fennel/macros.fnl", line=76}), sym('nil', nil, {quoted=true, filename="src/fennel/macros.fnl", line=76}), head}, getmetatable(list())), setmetatable({filename="src/fennel/macros.fnl", line=76, bytestart=2454, sym('set', nil, {quoted=true, filename="src/fennel/macros.fnl", line=76}), head, setmetatable({filename="src/fennel/macros.fnl", line=76, bytestart=2465, sym('.', nil, {quoted=true, filename="src/fennel/macros.fnl", line=76}), head, k}, getmetatable(list()))}, getmetatable(list()))}, getmetatable(list())))
      end
      return lookups
    end
    utils['fennel-module'].metadata:setall(_3fdot, "fnl/arglist", {"tbl", "..."}, "fnl/docstring", "Nil-safe table look up.\nSame as . (dot), except will short-circuit with nil when it encounters\na nil value in any of subsequent keys.")
    local function doto_2a(val, ...)
      assert((val ~= nil), "missing subject")
      if not utils["idempotent-expr?"](val) then
        return setmetatable({filename="src/fennel/macros.fnl", line=83, bytestart=2683, sym('let', nil, {quoted=true, filename="src/fennel/macros.fnl", line=83}), setmetatable({sym('tmp_9_', nil, {filename="src/fennel/macros.fnl", line=83}), val}, {filename="src/fennel/macros.fnl", line=83}), setmetatable({filename="src/fennel/macros.fnl", line=84, bytestart=2707, sym('doto', nil, {quoted=true, filename="src/fennel/macros.fnl", line=84}), sym('tmp_9_', nil, {filename="src/fennel/macros.fnl", line=84}), ...}, getmetatable(list()))}, getmetatable(list()))
      else
        local form = setmetatable({filename="src/fennel/macros.fnl", line=85, bytestart=2741, sym('do', nil, {quoted=true, filename="src/fennel/macros.fnl", line=85})}, getmetatable(list()))
        for _, elt in ipairs({...}) do
          local elt0 = nil
          if _G["list?"](elt) then
            elt0 = copy(elt)
          else
            elt0 = list(elt)
          end
          table.insert(elt0, 2, val)
          table.insert(form, elt0)
        end
        table.insert(form, val)
        return form
      end
    end
    utils['fennel-module'].metadata:setall(doto_2a, "fnl/arglist", {"val", "..."}, "fnl/docstring", "Evaluate val and splice it into the first argument of subsequent forms.")
    local function when_2a(condition, body1, ...)
      assert(body1, "expected body")
      return setmetatable({filename="src/fennel/macros.fnl", line=96, bytestart=3090, sym('if', nil, {quoted=true, filename="src/fennel/macros.fnl", line=96}), condition, setmetatable({filename="src/fennel/macros.fnl", line=97, bytestart=3112, sym('do', nil, {quoted=true, filename="src/fennel/macros.fnl", line=97}), body1, ...}, getmetatable(list()))}, getmetatable(list()))
    end
    utils['fennel-module'].metadata:setall(when_2a, "fnl/arglist", {"condition", "body1", "..."}, "fnl/docstring", "Evaluate body for side-effects only when condition is truthy.")
    local function with_open_2a(closable_bindings, ...)
      local vararg_3f = _G["get-scope"]().vararg
      local bodyfn = nil
      if vararg_3f then
        bodyfn = setmetatable({filename="src/fennel/macros.fnl", line=107, bytestart=3481, sym('fn', nil, {quoted=true, filename="src/fennel/macros.fnl", line=107}), setmetatable({_VARARG}, {filename="src/fennel/macros.fnl", line=107}), ...}, getmetatable(list()))
      else
        bodyfn = setmetatable({filename="src/fennel/macros.fnl", line=108, bytestart=3517, sym('fn', nil, {quoted=true, filename="src/fennel/macros.fnl", line=108}), setmetatable({}, {filename="src/fennel/macros.fnl", line=108}), ...}, getmetatable(list()))
      end
      local closer = setmetatable({filename="src/fennel/macros.fnl", line=109, bytestart=3547, sym('fn', nil, {quoted=true, filename="src/fennel/macros.fnl", line=109}), sym('close-handlers_13_', nil, {filename="src/fennel/macros.fnl", line=109}), setmetatable({sym('ok_14_', nil, {filename="src/fennel/macros.fnl", line=109}), _VARARG}, {filename="src/fennel/macros.fnl", line=109}), setmetatable({filename="src/fennel/macros.fnl", line=110, bytestart=3595, sym('if', nil, {quoted=true, filename="src/fennel/macros.fnl", line=110}), sym('ok_14_', nil, {filename="src/fennel/macros.fnl", line=110}), _VARARG, setmetatable({filename="src/fennel/macros.fnl", line=110, bytestart=3607, sym('error', nil, {quoted=true, filename="src/fennel/macros.fnl", line=110}), _VARARG, 0}, getmetatable(list()))}, getmetatable(list()))}, getmetatable(list()))
      local traceback = setmetatable({filename="src/fennel/macros.fnl", line=111, bytestart=3642, sym('.', nil, {quoted=true, filename="src/fennel/macros.fnl", line=111}), setmetatable({filename="src/fennel/macros.fnl", line=111, bytestart=3645, sym('or', nil, {quoted=true, filename="src/fennel/macros.fnl", line=111}), setmetatable({filename="src/fennel/macros.fnl", line=111, bytestart=3649, sym('?.', nil, {quoted=true, filename="src/fennel/macros.fnl", line=111}), sym('_G', nil, {quoted=true, filename="src/fennel/macros.fnl", line=111}), "package", "loaded", _G["fennel-module-name"]()}, getmetatable(list())), sym('_G.debug', nil, {quoted=true, filename="src/fennel/macros.fnl", line=112}), setmetatable({["traceback"]=setmetatable({filename=nil, line=nil, bytestart=nil, sym('hashfn', nil, {quoted=true, filename=nil, line=nil}), ""}, getmetatable(list()))}, {filename="src/fennel/macros.fnl", line=112})}, getmetatable(list())), "traceback"}, getmetatable(list()))
      for i = 1, #closable_bindings, 2 do
        assert(_G["sym?"](closable_bindings[i]), "with-open only allows symbols in bindings")
        table.insert(closer, 4, setmetatable({filename="src/fennel/macros.fnl", line=116, bytestart=3940, sym(':', nil, {quoted=true, filename="src/fennel/macros.fnl", line=116}), closable_bindings[i], "close"}, getmetatable(list())))
      end
      local function _18_(...)
        if vararg_3f then
          return setmetatable({filename="src/fennel/macros.fnl", line=122, bytestart=4147, sym('let', nil, {quoted=true, filename="src/fennel/macros.fnl", line=122}), setmetatable({sym('args_15_', nil, {filename="src/fennel/macros.fnl", line=122}), setmetatable({_VARARG}, {filename="src/fennel/macros.fnl", line=122}), sym('n_16_', nil, {filename="src/fennel/macros.fnl", line=123}), setmetatable({filename="src/fennel/macros.fnl", line=123, bytestart=4188, sym('select', nil, {quoted=true, filename="src/fennel/macros.fnl", line=123}), "#", _VARARG}, getmetatable(list())), sym('unpack_17_', nil, {filename="src/fennel/macros.fnl", line=124}), setmetatable({filename="src/fennel/macros.fnl", line=124, bytestart=4232, sym('or', nil, {quoted=true, filename="src/fennel/macros.fnl", line=124}), sym('_G.unpack', nil, {quoted=true, filename="src/fennel/macros.fnl", line=124}), sym('_G.table.unpack', nil, {quoted=true, filename="src/fennel/macros.fnl", line=124})}, getmetatable(list()))}, {filename="src/fennel/macros.fnl", line=122}), setmetatable({filename="src/fennel/macros.fnl", line=125, bytestart=4280, sym('_G.xpcall', nil, {quoted=true, filename="src/fennel/macros.fnl", line=125}), setmetatable({filename=nil, line=nil, bytestart=nil, sym('hashfn', nil, {quoted=true, filename=nil, line=nil}), setmetatable({filename="src/fennel/macros.fnl", line=125, bytestart=4292, bodyfn, setmetatable({filename="src/fennel/macros.fnl", line=125, bytestart=4301, sym('unpack_17_', nil, {filename="src/fennel/macros.fnl", line=125}), sym('args_15_', nil, {filename="src/fennel/macros.fnl", line=125}), 1, sym('n_16_', nil, {filename="src/fennel/macros.fnl", line=125})}, getmetatable(list()))}, getmetatable(list()))}, getmetatable(list())), traceback}, getmetatable(list()))}, getmetatable(list()))
        else
          return setmetatable({filename="src/fennel/macros.fnl", line=126, bytestart=4350, sym('_G.xpcall', nil, {quoted=true, filename="src/fennel/macros.fnl", line=126}), bodyfn, traceback}, getmetatable(list()))
        end
      end
      return setmetatable({filename="src/fennel/macros.fnl", line=117, bytestart=3983, sym('let', nil, {quoted=true, filename="src/fennel/macros.fnl", line=117}), closable_bindings, closer, setmetatable({filename="src/fennel/macros.fnl", line=119, bytestart=4029, sym('close-handlers_13_', nil, {filename="src/fennel/macros.fnl", line=119}), _18_(...)}, getmetatable(list()))}, getmetatable(list()))
    end
    utils['fennel-module'].metadata:setall(with_open_2a, "fnl/arglist", {"closable-bindings", "..."}, "fnl/docstring", "Like `let`, but invokes (v:close) on each binding after evaluating the body.\nThe body is evaluated inside `xpcall` so that bound values will be closed upon\nencountering an error before propagating it.")
    local function extract_into(iter_tbl, iter_out)
      local into, found_3f = {}
      for i = #iter_tbl, 2, -1 do
        local item = iter_tbl[i]
        if (_G["sym?"](item, "&into") or ("into" == item)) then
          assert(not found_3f, "expected only one &into clause")
          found_3f = true
          into = iter_tbl[(i + 1)]
          table.remove(iter_out, i)
          table.remove(iter_out, i)
        end
      end
      assert((not found_3f or _G["sym?"](into) or _G["table?"](into) or _G["list?"](into)), "expected table, function call, or symbol in &into clause")
      return (found_3f and into), iter_out
    end
    utils['fennel-module'].metadata:setall(extract_into, "fnl/arglist", {"iter-tbl", "iter-out"})
    local function collect_2a(iter_tbl, key_expr, value_expr, ...)
      do local _ = {["fnl/arglist"] = {{key, value, _G["*iterator-values"]}, _G["values-tuple"]}} end
      assert((_G["sequence?"](iter_tbl) and (2 <= #iter_tbl)), "expected iterator binding table")
      assert((nil ~= key_expr), "expected key and value expression")
      assert((nil == ...), "expected 1 or 2 body expressions; wrap multiple expressions with do")
      assert((value_expr or _G["list?"](key_expr)), "need key and value")
      local kv_expr = nil
      if (nil == value_expr) then
        kv_expr = key_expr
      else
        kv_expr = setmetatable({filename="src/fennel/macros.fnl", line=174, bytestart=6326, sym('values', nil, {quoted=true, filename="src/fennel/macros.fnl", line=174}), key_expr, value_expr}, getmetatable(list()))
      end
      local into, intoless_iter = extract_into(iter_tbl, copy(iter_tbl))
      return setmetatable({filename="src/fennel/macros.fnl", line=176, bytestart=6433, sym('let', nil, {quoted=true, filename="src/fennel/macros.fnl", line=176}), setmetatable({sym('tbl_21_', nil, {filename="src/fennel/macros.fnl", line=176}), (into or {})}, {filename="src/fennel/macros.fnl", line=176}), setmetatable({filename="src/fennel/macros.fnl", line=177, bytestart=6466, sym('each', nil, {quoted=true, filename="src/fennel/macros.fnl", line=177}), intoless_iter, setmetatable({filename="src/fennel/macros.fnl", line=178, bytestart=6496, sym('let', nil, {quoted=true, filename="src/fennel/macros.fnl", line=178}), setmetatable({setmetatable({filename="src/fennel/macros.fnl", line=178, bytestart=6502, sym('k_22_', nil, {filename="src/fennel/macros.fnl", line=178}), sym('v_23_', nil, {filename="src/fennel/macros.fnl", line=178})}, getmetatable(list())), kv_expr}, {filename="src/fennel/macros.fnl", line=178}), setmetatable({filename="src/fennel/macros.fnl", line=179, bytestart=6531, sym('if', nil, {quoted=true, filename="src/fennel/macros.fnl", line=179}), setmetatable({filename="src/fennel/macros.fnl", line=179, bytestart=6535, sym('and', nil, {quoted=true, filename="src/fennel/macros.fnl", line=179}), setmetatable({filename="src/fennel/macros.fnl", line=179, bytestart=6540, sym('not=', nil, {quoted=true, filename="src/fennel/macros.fnl", line=179}), sym('k_22_', nil, {filename="src/fennel/macros.fnl", line=179}), sym('nil', nil, {quoted=true, filename="src/fennel/macros.fnl", line=179})}, getmetatable(list())), setmetatable({filename="src/fennel/macros.fnl", line=179, bytestart=6554, sym('not=', nil, {quoted=true, filename="src/fennel/macros.fnl", line=179}), sym('v_23_', nil, {filename="src/fennel/macros.fnl", line=179}), sym('nil', nil, {quoted=true, filename="src/fennel/macros.fnl", line=179})}, getmetatable(list()))}, getmetatable(list())), setmetatable({filename="src/fennel/macros.fnl", line=180, bytestart=6582, sym('tset', nil, {quoted=true, filename="src/fennel/macros.fnl", line=180}), sym('tbl_21_', nil, {filename="src/fennel/macros.fnl", line=180}), sym('k_22_', nil, {filename="src/fennel/macros.fnl", line=180}), sym('v_23_', nil, {filename="src/fennel/macros.fnl", line=180})}, getmetatable(list()))}, getmetatable(list()))}, getmetatable(list()))}, getmetatable(list())), sym('tbl_21_', nil, {filename="src/fennel/macros.fnl", line=181})}, getmetatable(list()))
    end
    utils['fennel-module'].metadata:setall(collect_2a, "fnl/arglist", {"iter-tbl", "key-expr", "value-expr", "..."}, "fnl/docstring", "Return a table made by running an iterator and evaluating an expression that\nreturns key-value pairs to be inserted sequentially into the table.  This can\nbe thought of as a table comprehension. The body should provide two expressions\n(used as key and value) or nil, which causes it to be omitted.\n\nFor example,\n  (collect [k v (pairs {:apple \"red\" :orange \"orange\"})]\n    (values v k))\nreturns\n  {:red \"apple\" :orange \"orange\"}\n\nSupports an &into clause after the iterator to put results in an existing table.\nSupports early termination with an &until clause.\n\nSupports two separate body forms instead of one to bind the key and value\nseparately.\n\nFor example,\n  (collect [k v (pairs {:apple \"red\" :orange \"orange\"})]\n    (.. v \" fruit\")\n    (.. k \"-color\"))\nreturns\n  {:red-color \"apple fruit\" :orange-color \"orange fruit\"}")
    local function seq_collect(how, iter_tbl, value_expr, ...)
      assert((nil ~= value_expr), "expected table value expression")
      assert((nil == ...), "expected exactly one body expression. Wrap multiple expressions in do")
      local into, intoless_iter = extract_into(iter_tbl, copy(iter_tbl))
      if into then
        return setmetatable({filename="src/fennel/macros.fnl", line=193, bytestart=7116, sym('let', nil, {quoted=true, filename="src/fennel/macros.fnl", line=193}), setmetatable({sym('tbl_24_', nil, {filename="src/fennel/macros.fnl", line=193}), into}, {filename="src/fennel/macros.fnl", line=193}), setmetatable({filename="src/fennel/macros.fnl", line=194, bytestart=7145, how, intoless_iter, setmetatable({filename="src/fennel/macros.fnl", line=194, bytestart=7166, sym('let', nil, {quoted=true, filename="src/fennel/macros.fnl", line=194}), setmetatable({sym('val_25_', nil, {filename="src/fennel/macros.fnl", line=194}), value_expr}, {filename="src/fennel/macros.fnl", line=194}), setmetatable({filename="src/fennel/macros.fnl", line=195, bytestart=7224, sym('table.insert', nil, {quoted=true, filename="src/fennel/macros.fnl", line=195}), sym('tbl_24_', nil, {filename="src/fennel/macros.fnl", line=195}), sym('val_25_', nil, {filename="src/fennel/macros.fnl", line=195})}, getmetatable(list()))}, getmetatable(list()))}, getmetatable(list())), sym('tbl_24_', nil, {filename="src/fennel/macros.fnl", line=196})}, getmetatable(list()))
      else
        return setmetatable({filename="src/fennel/macros.fnl", line=200, bytestart=7500, sym('let', nil, {quoted=true, filename="src/fennel/macros.fnl", line=200}), setmetatable({sym('tbl_26_', nil, {filename="src/fennel/macros.fnl", line=200}), setmetatable({}, {filename="src/fennel/macros.fnl", line=200})}, {filename="src/fennel/macros.fnl", line=200}), setmetatable({filename="src/fennel/macros.fnl", line=201, bytestart=7526, sym('var', nil, {quoted=true, filename="src/fennel/macros.fnl", line=201}), sym('i_27_', nil, {filename="src/fennel/macros.fnl", line=201}), 0}, getmetatable(list())), setmetatable({filename="src/fennel/macros.fnl", line=202, bytestart=7548, how, iter_tbl, setmetatable({filename="src/fennel/macros.fnl", line=203, bytestart=7581, sym('let', nil, {quoted=true, filename="src/fennel/macros.fnl", line=203}), setmetatable({sym('val_28_', nil, {filename="src/fennel/macros.fnl", line=203}), value_expr}, {filename="src/fennel/macros.fnl", line=203}), setmetatable({filename="src/fennel/macros.fnl", line=204, bytestart=7624, sym('when', nil, {quoted=true, filename="src/fennel/macros.fnl", line=204}), setmetatable({filename="src/fennel/macros.fnl", line=204, bytestart=7630, sym('not=', nil, {quoted=true, filename="src/fennel/macros.fnl", line=204}), sym('nil', nil, {quoted=true, filename="src/fennel/macros.fnl", line=204}), sym('val_28_', nil, {filename="src/fennel/macros.fnl", line=204})}, getmetatable(list())), setmetatable({filename="src/fennel/macros.fnl", line=205, bytestart=7667, sym('set', nil, {quoted=true, filename="src/fennel/macros.fnl", line=205}), sym('i_27_', nil, {filename="src/fennel/macros.fnl", line=205}), setmetatable({filename="src/fennel/macros.fnl", line=205, bytestart=7675, sym('+', nil, {quoted=true, filename="src/fennel/macros.fnl", line=205}), sym('i_27_', nil, {filename="src/fennel/macros.fnl", line=205}), 1}, getmetatable(list()))}, getmetatable(list())), setmetatable({filename="src/fennel/macros.fnl", line=206, bytestart=7706, sym('tset', nil, {quoted=true, filename="src/fennel/macros.fnl", line=206}), sym('tbl_26_', nil, {filename="src/fennel/macros.fnl", line=206}), sym('i_27_', nil, {filename="src/fennel/macros.fnl", line=206}), sym('val_28_', nil, {filename="src/fennel/macros.fnl", line=206})}, getmetatable(list()))}, getmetatable(list()))}, getmetatable(list()))}, getmetatable(list())), sym('tbl_26_', nil, {filename="src/fennel/macros.fnl", line=207})}, getmetatable(list()))
      end
    end
    utils['fennel-module'].metadata:setall(seq_collect, "fnl/arglist", {"how", "iter-tbl", "value-expr", "..."}, "fnl/docstring", "Common part between icollect and fcollect for producing sequential tables.\n\nIteration code only differs in using the for or each keyword, the rest\nof the generated code is identical.")
    local function icollect_2a(iter_tbl, value_expr, ...)
      do local _ = {["fnl/arglist"] = {{index, value, _G["*iterator-values"]}, value_expr}} end
      assert((_G["sequence?"](iter_tbl) and (2 <= #iter_tbl)), "expected iterator binding table")
      return seq_collect(sym('each', nil, {quoted=true, filename="src/fennel/macros.fnl", line=227}), iter_tbl, value_expr, ...)
    end
    utils['fennel-module'].metadata:setall(icollect_2a, "fnl/arglist", {"iter-tbl", "value-expr", "..."}, "fnl/docstring", "Return a sequential table made by running an iterator and evaluating an\nexpression that returns values to be inserted sequentially into the table.\nThis can be thought of as a table comprehension. If the body evaluates to nil\nthat element is omitted.\n\nFor example,\n  (icollect [_ v (ipairs [1 2 3 4 5])]\n    (when (not= v 3)\n      (* v v)))\nreturns\n  [1 4 16 25]\n\nSupports an &into clause after the iterator to put results in an existing table.\nSupports early termination with an &until clause.")
    local function fcollect_2a(iter_tbl, value_expr, ...)
      do local _ = {["fnl/arglist"] = {{index, start, stop, _G["?step"]}, value_expr}} end
      assert((_G["sequence?"](iter_tbl) and (2 < #iter_tbl)), "expected range binding table")
      return seq_collect(sym('for', nil, {quoted=true, filename="src/fennel/macros.fnl", line=247}), iter_tbl, value_expr, ...)
    end
    utils['fennel-module'].metadata:setall(fcollect_2a, "fnl/arglist", {"iter-tbl", "value-expr", "..."}, "fnl/docstring", "Return a sequential table made by advancing a range as specified by\nfor, and evaluating an expression that returns values to be inserted\nsequentially into the table.  This can be thought of as a range\ncomprehension. If the body evaluates to nil that element is omitted.\n\nFor example,\n  (fcollect [i 1 10 2]\n    (when (not= i 3)\n      (* i i)))\nreturns\n  [1 25 49 81]\n\nSupports an &into clause after the range to put results in an existing table.\nSupports early termination with an &until clause.")
    local function accumulate_impl(for_3f, iter_tbl, body, ...)
      assert((_G["sequence?"](iter_tbl) and (4 <= #iter_tbl)), "expected initial value and iterator binding table")
      assert((nil ~= body), "expected body expression")
      assert((nil == ...), "expected exactly one body expression. Wrap multiple expressions with do")
      local _30_ = iter_tbl
      local accum_var = _30_[1]
      local accum_init = _30_[2]
      local iter = nil
      local function _31_(...)
        if for_3f then
          return "for"
        else
          return "each"
        end
      end
      iter = sym(_31_(...))
      local function _32_(...)
        if _G["list?"](accum_var) then
          return list(sym("values"), unpack(accum_var))
        else
          return accum_var
        end
      end
      return setmetatable({filename="src/fennel/macros.fnl", line=257, bytestart=9697, sym('do', nil, {quoted=true, filename="src/fennel/macros.fnl", line=257}), setmetatable({filename="src/fennel/macros.fnl", line=258, bytestart=9708, sym('var', nil, {quoted=true, filename="src/fennel/macros.fnl", line=258}), accum_var, accum_init}, getmetatable(list())), setmetatable({filename="src/fennel/macros.fnl", line=259, bytestart=9744, iter, {unpack(iter_tbl, 3)}, setmetatable({filename="src/fennel/macros.fnl", line=260, bytestart=9788, sym('set', nil, {quoted=true, filename="src/fennel/macros.fnl", line=260}), accum_var, body}, getmetatable(list()))}, getmetatable(list())), _32_(...)}, getmetatable(list()))
    end
    utils['fennel-module'].metadata:setall(accumulate_impl, "fnl/arglist", {"for?", "iter-tbl", "body", "..."})
    local function accumulate_2a(iter_tbl, body, ...)
      do local _ = {["fnl/arglist"] = {{accumulator, _G["initial-value"], key, value, _G["*iterator-values"]}, _G["value-expr"]}} end
      return accumulate_impl(false, iter_tbl, body, ...)
    end
    utils['fennel-module'].metadata:setall(accumulate_2a, "fnl/arglist", {"iter-tbl", "body", "..."}, "fnl/docstring", "Accumulation macro.\n\nIt takes a binding table and an expression as its arguments.  In the binding\ntable, the first form starts out bound to the second value, which is an initial\naccumulator. The rest are an iterator binding table in the format `each` takes.\n\nIt runs through the iterator in each step of which the given expression is\nevaluated, and the accumulator is set to the value of the expression. It\neventually returns the final value of the accumulator.\n\nFor example,\n  (accumulate [total 0\n               _ n (pairs {:apple 2 :orange 3})]\n    (+ total n))\nreturns 5")
    local function faccumulate_2a(iter_tbl, body, ...)
      do local _ = {["fnl/arglist"] = {{accumulator, _G["initial-value"], index, start, stop, _G["?step"]}, _G["value-expr"]}} end
      return accumulate_impl(true, iter_tbl, body, ...)
    end
    utils['fennel-module'].metadata:setall(faccumulate_2a, "fnl/arglist", {"iter-tbl", "body", "..."}, "fnl/docstring", "Identical to accumulate, but after the accumulator the binding table is the\nsame as `for` instead of `each`. Like collect to fcollect, will iterate over a\nnumerical range like `for` rather than an iterator.")
    local function partial_2a(f, ...)
      assert(f, "expected a function to partially apply")
      local bindings = {}
      local args = {}
      for _, arg in ipairs({...}) do
        if utils["idempotent-expr?"](arg) then
          table.insert(args, arg)
        else
          local name = gensym("partial")
          table.insert(bindings, name)
          table.insert(bindings, arg)
          table.insert(args, name)
        end
      end
      local body = list(f, unpack(args))
      table.insert(body, _VARARG)
      if (nil == bindings[1]) then
        return setmetatable({filename="src/fennel/macros.fnl", line=307, bytestart=11654, sym('fn', nil, {quoted=true, filename="src/fennel/macros.fnl", line=307}), setmetatable({_VARARG}, {filename="src/fennel/macros.fnl", line=307}), body}, getmetatable(list()))
      else
        return setmetatable({filename="src/fennel/macros.fnl", line=308, bytestart=11687, sym('let', nil, {quoted=true, filename="src/fennel/macros.fnl", line=308}), bindings, setmetatable({filename="src/fennel/macros.fnl", line=309, bytestart=11715, sym('fn', nil, {quoted=true, filename="src/fennel/macros.fnl", line=309}), setmetatable({_VARARG}, {filename="src/fennel/macros.fnl", line=309}), body}, getmetatable(list()))}, getmetatable(list()))
      end
    end
    utils['fennel-module'].metadata:setall(partial_2a, "fnl/arglist", {"f", "..."}, "fnl/docstring", "Return a function with all arguments partially applied to f.")
    local function pick_args_2a(n, f)
      if (_G.io and _G.io.stderr) then
        do end (_G.io.stderr):write("-- WARNING: pick-args is deprecated and will be removed in the future.\n")
      end
      local bindings = {}
      for i = 1, n do
        bindings[i] = gensym("pick")
      end
      return setmetatable({filename="src/fennel/macros.fnl", line=318, bytestart=12060, sym('fn', nil, {quoted=true, filename="src/fennel/macros.fnl", line=318}), bindings, setmetatable({filename="src/fennel/macros.fnl", line=318, bytestart=12074, f, unpack(bindings)}, getmetatable(list()))}, getmetatable(list()))
    end
    utils['fennel-module'].metadata:setall(pick_args_2a, "fnl/arglist", {"n", "f"}, "fnl/docstring", "Create a function of arity n that applies its arguments to f. Deprecated.")
    local function lambda_2a(...)
      local args = {...}
      local args_len = #args
      local has_internal_name_3f = _G["sym?"](args[1])
      local arglist = nil
      if has_internal_name_3f then
        arglist = args[2]
      else
        arglist = args[1]
      end
      local metadata_position = nil
      if has_internal_name_3f then
        metadata_position = 3
      else
        metadata_position = 2
      end
      local _, check_position = get_function_metadata({"lambda", ...}, arglist, metadata_position)
      local empty_body_3f = (args_len < check_position)
      local function check_21(a)
        if _G["table?"](a) then
          for _0, a0 in pairs(a) do
            check_21(a0)
          end
          return nil
        else
          local _38_
          do
            local as = tostring(a)
            local as1 = as:sub(1, 1)
            _38_ = not (("_" == as1) or ("?" == as1) or ("&" == as) or ("..." == as) or ("&as" == as))
          end
          if _38_ then
            return table.insert(args, check_position, setmetatable({filename="src/fennel/macros.fnl", line=339, bytestart=13009, sym('when', nil, {quoted=true, filename="src/fennel/macros.fnl", line=339}), setmetatable({filename="src/fennel/macros.fnl", line=339, bytestart=13015, sym('=', nil, {quoted=true, filename="src/fennel/macros.fnl", line=339}), sym('nil', nil, {quoted=true, filename="src/fennel/macros.fnl", line=339}), a}, getmetatable(list())), setmetatable({filename="src/fennel/macros.fnl", line=340, bytestart=13053, sym('_G.error', nil, {quoted=true, filename="src/fennel/macros.fnl", line=340}), ("Missing argument %s on %s:%s"):format(tostring(a), (a.filename or "unknown"), (a.line or "?")), 2}, getmetatable(list()))}, getmetatable(list())))
          end
        end
      end
      utils['fennel-module'].metadata:setall(check_21, "fnl/arglist", {"a"})
      assert(("table" == type(arglist)), "expected arg list")
      for _0, a in ipairs(arglist) do
        check_21(a)
      end
      if empty_body_3f then
        table.insert(args, sym("nil"))
      end
      return setmetatable({filename="src/fennel/macros.fnl", line=348, bytestart=13453, sym('fn', nil, {quoted=true, filename="src/fennel/macros.fnl", line=348}), unpack(args)}, getmetatable(list()))
    end
    utils['fennel-module'].metadata:setall(lambda_2a, "fnl/arglist", {"..."}, "fnl/docstring", "Function literal with nil-checked arguments.\nLike `fn`, but will throw an exception if a declared argument is passed in as\nnil, unless that argument's name begins with a question mark.")
    local function macro_2a(name, ...)
      assert(_G["sym?"](name), "expected symbol for macro name")
      local args = {...}
      return setmetatable({filename="src/fennel/macros.fnl", line=354, bytestart=13605, sym('macros', nil, {quoted=true, filename="src/fennel/macros.fnl", line=354}), setmetatable({[tostring(name)]=setmetatable({filename="src/fennel/macros.fnl", line=354, bytestart=13631, sym('fn', nil, {quoted=true, filename="src/fennel/macros.fnl", line=354}), unpack(args)}, getmetatable(list()))}, {filename="src/fennel/macros.fnl", line=354})}, getmetatable(list()))
    end
    utils['fennel-module'].metadata:setall(macro_2a, "fnl/arglist", {"name", "..."}, "fnl/docstring", "Define a single macro.")
    local function macrodebug_2a(form, return_3f)
      local handle = nil
      if return_3f then
        handle = sym('do', nil, {quoted=true, filename="src/fennel/macros.fnl", line=359})
      else
        handle = sym('print', nil, {quoted=true, filename="src/fennel/macros.fnl", line=359})
      end
      return setmetatable({filename="src/fennel/macros.fnl", line=362, bytestart=14027, handle, view(macroexpand(form), {["detect-cycles?"] = false})}, getmetatable(list()))
    end
    utils['fennel-module'].metadata:setall(macrodebug_2a, "fnl/arglist", {"form", "return?"}, "fnl/docstring", "Print the resulting form after performing macroexpansion.\nWith a second argument, returns expanded form as a string instead of printing.")
    local function import_macros_2a(binding1, module_name1, ...)
      assert((binding1 and module_name1 and (0 == (select("#", ...) % 2))), "expected even number of binding/modulename pairs")
      for i = 1, select("#", binding1, module_name1, ...), 2 do
        local binding, modname = select(i, binding1, module_name1, ...)
        local scope = _G["get-scope"]()
        local expr = setmetatable({filename="src/fennel/macros.fnl", line=381, bytestart=15181, sym('import-macros', nil, {quoted=true, filename="src/fennel/macros.fnl", line=381}), modname}, getmetatable(list()))
        local filename = nil
        if _G["list?"](modname) then
          filename = modname[1].filename
        else
          filename = "unknown"
        end
        local _ = nil
        expr.filename = filename
        _ = nil
        local macros_2a = _SPECIALS["require-macros"](expr, scope, {}, binding)
        if _G["sym?"](binding) then
          scope.macros[binding[1]] = macros_2a
        elseif _G["table?"](binding) then
          for macro_name, _43_0 in pairs(binding) do
            local _44_ = _43_0
            local import_key = _44_[1]
            assert(("function" == type(macros_2a[macro_name])), ("macro " .. macro_name .. " not found in module " .. tostring(modname)))
            scope.macros[import_key] = macros_2a[macro_name]
          end
        end
      end
      return nil
    end
    utils['fennel-module'].metadata:setall(import_macros_2a, "fnl/arglist", {"binding1", "module-name1", "..."}, "fnl/docstring", "Bind a table of macros from each macro module according to a binding form.\nEach binding form can be either a symbol or a k/v destructuring table.\nExample:\n  (import-macros mymacros                 :my-macros    ; bind to symbol\n                 {:macro1 alias : macro2} :proj.macros) ; import by name")
    local function assert_repl_2a(condition, ...)
      do local _ = {["fnl/arglist"] = {condition, _G["?message"], ...}} end
      local function add_locals(_46_0, locals)
        local _47_ = _46_0
        local parent = _47_["parent"]
        local symmeta = _47_["symmeta"]
        for name in pairs(symmeta) do
          locals[name] = sym(name)
        end
        if parent then
          return add_locals(parent, locals)
        else
          return locals
        end
      end
      utils['fennel-module'].metadata:setall(add_locals, "fnl/arglist", {"#<table>", "locals"})
      return setmetatable({filename="src/fennel/macros.fnl", line=406, bytestart=16400, sym('let', nil, {quoted=true, filename="src/fennel/macros.fnl", line=406}), setmetatable({sym('unpack_49_', nil, {filename="src/fennel/macros.fnl", line=406}), setmetatable({filename="src/fennel/macros.fnl", line=406, bytestart=16414, sym('or', nil, {quoted=true, filename="src/fennel/macros.fnl", line=406}), sym('table.unpack', nil, {quoted=true, filename="src/fennel/macros.fnl", line=406}), sym('_G.unpack', nil, {quoted=true, filename="src/fennel/macros.fnl", line=406})}, getmetatable(list())), sym('pack_51_', nil, {filename="src/fennel/macros.fnl", line=407}), setmetatable({filename="src/fennel/macros.fnl", line=407, bytestart=16457, sym('or', nil, {quoted=true, filename="src/fennel/macros.fnl", line=407}), sym('table.pack', nil, {quoted=true, filename="src/fennel/macros.fnl", line=407}), setmetatable({filename=nil, line=nil, bytestart=nil, sym('hashfn', nil, {quoted=true, filename=nil, line=nil}), setmetatable({filename="src/fennel/macros.fnl", line=407, bytestart=16473, sym('doto', nil, {quoted=true, filename="src/fennel/macros.fnl", line=407}), setmetatable({sym('$...', nil, {quoted=true, filename="src/fennel/macros.fnl", line=407})}, {filename="src/fennel/macros.fnl", line=407}), setmetatable({filename="src/fennel/macros.fnl", line=407, bytestart=16486, sym('tset', nil, {quoted=true, filename="src/fennel/macros.fnl", line=407}), "n", setmetatable({filename="src/fennel/macros.fnl", line=407, bytestart=16495, sym('select', nil, {quoted=true, filename="src/fennel/macros.fnl", line=407}), "#", sym('$...', nil, {quoted=true, filename="src/fennel/macros.fnl", line=407})}, getmetatable(list()))}, getmetatable(list()))}, getmetatable(list()))}, getmetatable(list()))}, getmetatable(list())), sym('vals_50_', nil, {filename="src/fennel/macros.fnl", line=410}), setmetatable({filename="src/fennel/macros.fnl", line=410, bytestart=16668, sym('pack_51_', nil, {filename="src/fennel/macros.fnl", line=410}), condition, ...}, getmetatable(list())), sym('condition_52_', nil, {filename="src/fennel/macros.fnl", line=411}), setmetatable({filename="src/fennel/macros.fnl", line=411, bytestart=16712, sym('.', nil, {quoted=true, filename="src/fennel/macros.fnl", line=411}), sym('vals_50_', nil, {filename="src/fennel/macros.fnl", line=411}), 1}, getmetatable(list())), sym('message_53_', nil, {filename="src/fennel/macros.fnl", line=412}), setmetatable({filename="src/fennel/macros.fnl", line=412, bytestart=16742, sym('or', nil, {quoted=true, filename="src/fennel/macros.fnl", line=412}), setmetatable({filename="src/fennel/macros.fnl", line=412, bytestart=16746, sym('.', nil, {quoted=true, filename="src/fennel/macros.fnl", line=412}), sym('vals_50_', nil, {filename="src/fennel/macros.fnl", line=412}), 2}, getmetatable(list())), "assertion failed, entering repl."}, getmetatable(list()))}, {filename="src/fennel/macros.fnl", line=406}), setmetatable({filename="src/fennel/macros.fnl", line=413, bytestart=16800, sym('if', nil, {quoted=true, filename="src/fennel/macros.fnl", line=413}), setmetatable({filename="src/fennel/macros.fnl", line=413, bytestart=16804, sym('not', nil, {quoted=true, filename="src/fennel/macros.fnl", line=413}), sym('condition_52_', nil, {filename="src/fennel/macros.fnl", line=413})}, getmetatable(list())), setmetatable({filename="src/fennel/macros.fnl", line=414, bytestart=16830, sym('let', nil, {quoted=true, filename="src/fennel/macros.fnl", line=414}), setmetatable({sym('opts_54_', nil, {filename="src/fennel/macros.fnl", line=414}), setmetatable({["assert-repl?"]=true}, {filename="src/fennel/macros.fnl", line=414}), sym('fennel_55_', nil, {filename="src/fennel/macros.fnl", line=415}), setmetatable({filename="src/fennel/macros.fnl", line=415, bytestart=16886, sym('require', nil, {quoted=true, filename="src/fennel/macros.fnl", line=415}), _G["fennel-module-name"]()}, getmetatable(list())), sym('locals_56_', nil, {filename="src/fennel/macros.fnl", line=416}), add_locals(_G["get-scope"](), {})}, {filename="src/fennel/macros.fnl", line=414}), setmetatable({filename="src/fennel/macros.fnl", line=417, bytestart=16982, sym('set', nil, {quoted=true, filename="src/fennel/macros.fnl", line=417}), sym('opts_54_.message', nil, {filename="src/fennel/macros.fnl", line=417}), setmetatable({filename="src/fennel/macros.fnl", line=417, bytestart=17001, sym('fennel_55_.traceback', nil, {filename="src/fennel/macros.fnl", line=417}), sym('message_53_', nil, {filename="src/fennel/macros.fnl", line=417})}, getmetatable(list()))}, getmetatable(list())), setmetatable({filename="src/fennel/macros.fnl", line=418, bytestart=17042, sym('each', nil, {quoted=true, filename="src/fennel/macros.fnl", line=418}), setmetatable({sym('k_57_', nil, {filename="src/fennel/macros.fnl", line=418}), sym('v_58_', nil, {filename="src/fennel/macros.fnl", line=418}), setmetatable({filename="src/fennel/macros.fnl", line=418, bytestart=17055, sym('pairs', nil, {quoted=true, filename="src/fennel/macros.fnl", line=418}), sym('_G', nil, {quoted=true, filename="src/fennel/macros.fnl", line=418})}, getmetatable(list()))}, {filename="src/fennel/macros.fnl", line=418}), setmetatable({filename="src/fennel/macros.fnl", line=419, bytestart=17080, sym('when', nil, {quoted=true, filename="src/fennel/macros.fnl", line=419}), setmetatable({filename="src/fennel/macros.fnl", line=419, bytestart=17086, sym('=', nil, {quoted=true, filename="src/fennel/macros.fnl", line=419}), sym('nil', nil, {quoted=true, filename="src/fennel/macros.fnl", line=419}), setmetatable({filename="src/fennel/macros.fnl", line=419, bytestart=17093, sym('.', nil, {quoted=true, filename="src/fennel/macros.fnl", line=419}), sym('locals_56_', nil, {filename="src/fennel/macros.fnl", line=419}), sym('k_57_', nil, {filename="src/fennel/macros.fnl", line=419})}, getmetatable(list()))}, getmetatable(list())), setmetatable({filename="src/fennel/macros.fnl", line=419, bytestart=17109, sym('tset', nil, {quoted=true, filename="src/fennel/macros.fnl", line=419}), sym('locals_56_', nil, {filename="src/fennel/macros.fnl", line=419}), sym('k_57_', nil, {filename="src/fennel/macros.fnl", line=419}), sym('v_58_', nil, {filename="src/fennel/macros.fnl", line=419})}, getmetatable(list()))}, getmetatable(list()))}, getmetatable(list())), setmetatable({filename="src/fennel/macros.fnl", line=420, bytestart=17143, sym('set', nil, {quoted=true, filename="src/fennel/macros.fnl", line=420}), sym('opts_54_.env', nil, {filename="src/fennel/macros.fnl", line=420}), sym('locals_56_', nil, {filename="src/fennel/macros.fnl", line=420})}, getmetatable(list())), setmetatable({filename="src/fennel/macros.fnl", line=421, bytestart=17178, sym('_G.assert', nil, {quoted=true, filename="src/fennel/macros.fnl", line=421}), setmetatable({filename="src/fennel/macros.fnl", line=421, bytestart=17189, sym('fennel_55_.repl', nil, {filename="src/fennel/macros.fnl", line=421}), sym('opts_54_', nil, {filename="src/fennel/macros.fnl", line=421})}, getmetatable(list()))}, getmetatable(list()))}, getmetatable(list())), setmetatable({filename="src/fennel/macros.fnl", line=422, bytestart=17221, sym('values', nil, {quoted=true, filename="src/fennel/macros.fnl", line=422}), setmetatable({filename="src/fennel/macros.fnl", line=422, bytestart=17229, sym('unpack_49_', nil, {filename="src/fennel/macros.fnl", line=422}), sym('vals_50_', nil, {filename="src/fennel/macros.fnl", line=422}), 1, sym('vals_50_.n', nil, {filename="src/fennel/macros.fnl", line=422})}, getmetatable(list()))}, getmetatable(list()))}, getmetatable(list()))}, getmetatable(list()))
    end
    utils['fennel-module'].metadata:setall(assert_repl_2a, "fnl/arglist", {"condition", "..."}, "fnl/docstring", "Enter into a debug REPL  and print the message when condition is false/nil.\nWorks as a drop-in replacement for Lua's `assert`.\nREPL `,return` command returns values to assert in place to continue execution.")
    return {["->"] = __3e_2a, ["->>"] = __3e_3e_2a, ["-?>"] = __3f_3e_2a, ["-?>>"] = __3f_3e_3e_2a, ["?."] = _3fdot, ["\206\187"] = lambda_2a, ["assert-repl"] = assert_repl_2a, ["import-macros"] = import_macros_2a, ["pick-args"] = pick_args_2a, ["with-open"] = with_open_2a, accumulate = accumulate_2a, collect = collect_2a, doto = doto_2a, faccumulate = faccumulate_2a, fcollect = fcollect_2a, icollect = icollect_2a, lambda = lambda_2a, macro = macro_2a, macrodebug = macrodebug_2a, partial = partial_2a, when = when_2a}
    ]===], env)
    load_macros([===[local utils = ...
    local function with(opts, k)
      local _1_0 = utils.copy(opts)
      _1_0[k] = true
      return _1_0
    end
    utils['fennel-module'].metadata:setall(with, "fnl/arglist", {"opts", "k"})
    local function without(opts, k)
      local _2_0 = utils.copy(opts)
      _2_0[k] = nil
      return _2_0
    end
    utils['fennel-module'].metadata:setall(without, "fnl/arglist", {"opts", "k"})
    local function case_values(vals, pattern, pins, case_pattern, opts)
      local condition = setmetatable({filename="src/fennel/match.fnl", line=16, bytestart=372, sym('and', nil, {quoted=true, filename="src/fennel/match.fnl", line=16})}, getmetatable(list()))
      local bindings = {}
      for i, pat in ipairs(pattern) do
        local subcondition, subbindings = case_pattern({vals[i]}, pat, pins, without(opts, "multival?"))
        table.insert(condition, subcondition)
        local tbl_17_ = bindings
        local i_18_ = #tbl_17_
        for _, b in ipairs(subbindings) do
          local val_19_ = b
          if (nil ~= val_19_) then
            i_18_ = (i_18_ + 1)
            tbl_17_[i_18_] = val_19_
          end
        end
      end
      return condition, bindings
    end
    utils['fennel-module'].metadata:setall(case_values, "fnl/arglist", {"vals", "pattern", "pins", "case-pattern", "opts"})
    local function case_table(val, pattern, pins, case_pattern, opts, _3ftop)
      local condition = nil
      if ("table" == _3ftop) then
        condition = setmetatable({filename="src/fennel/match.fnl", line=26, bytestart=833, sym('and', nil, {quoted=true, filename="src/fennel/match.fnl", line=26})}, getmetatable(list()))
      else
        condition = setmetatable({filename="src/fennel/match.fnl", line=26, bytestart=840, sym('and', nil, {quoted=true, filename="src/fennel/match.fnl", line=26}), setmetatable({filename="src/fennel/match.fnl", line=26, bytestart=845, sym('=', nil, {quoted=true, filename="src/fennel/match.fnl", line=26}), setmetatable({filename="src/fennel/match.fnl", line=26, bytestart=848, sym('_G.type', nil, {quoted=true, filename="src/fennel/match.fnl", line=26}), val}, getmetatable(list())), "table"}, getmetatable(list()))}, getmetatable(list()))
      end
      local bindings = {}
      for k, pat in pairs(pattern) do
        if _G["sym?"](pat, "&") then
          local rest_pat = pattern[(k + 1)]
          local rest_val = setmetatable({filename="src/fennel/match.fnl", line=31, bytestart=1023, sym('select', nil, {quoted=true, filename="src/fennel/match.fnl", line=31}), k, setmetatable({filename="src/fennel/match.fnl", line=31, bytestart=1034, setmetatable({filename="src/fennel/match.fnl", line=31, bytestart=1035, sym('or', nil, {quoted=true, filename="src/fennel/match.fnl", line=31}), sym('table.unpack', nil, {quoted=true, filename="src/fennel/match.fnl", line=31}), sym('_G.unpack', nil, {quoted=true, filename="src/fennel/match.fnl", line=31})}, getmetatable(list())), val}, getmetatable(list()))}, getmetatable(list()))
          local subcondition = case_table(setmetatable({filename="src/fennel/match.fnl", line=32, bytestart=1112, sym('pick-values', nil, {quoted=true, filename="src/fennel/match.fnl", line=32}), 1, rest_val}, getmetatable(list())), rest_pat, pins, case_pattern, without(opts, "multival?"))
          if not _G["sym?"](rest_pat) then
            table.insert(condition, subcondition)
          end
          assert((nil == pattern[(k + 2)]), "expected & rest argument before last parameter")
          table.insert(bindings, rest_pat)
          table.insert(bindings, {rest_val})
        elseif _G["sym?"](k, "&as") then
          table.insert(bindings, pat)
          table.insert(bindings, val)
        elseif (("number" == type(k)) and _G["sym?"](pat, "&as")) then
          assert((nil == pattern[(k + 2)]), "expected &as argument before last parameter")
          table.insert(bindings, pattern[(k + 1)])
          table.insert(bindings, val)
        elseif (("number" ~= type(k)) or (not _G["sym?"](pattern[(k - 1)], "&as") and not _G["sym?"](pattern[(k - 1)], "&"))) then
          local subval = setmetatable({filename="src/fennel/match.fnl", line=54, bytestart=2238, sym('.', nil, {quoted=true, filename="src/fennel/match.fnl", line=54}), val, k}, getmetatable(list()))
          local subcondition, subbindings = case_pattern({subval}, pat, pins, without(opts, "multival?"))
          table.insert(condition, subcondition)
          local tbl_17_ = bindings
          local i_18_ = #tbl_17_
          for _, b in ipairs(subbindings) do
            local val_19_ = b
            if (nil ~= val_19_) then
              i_18_ = (i_18_ + 1)
              tbl_17_[i_18_] = val_19_
            end
          end
        end
      end
      return condition, bindings
    end
    utils['fennel-module'].metadata:setall(case_table, "fnl/arglist", {"val", "pattern", "pins", "case-pattern", "opts", "?top"})
    local function case_guard(vals, condition, guards, pins, case_pattern, opts)
      if guards[1] then
        local pcondition, bindings = case_pattern(vals, condition, pins, opts)
        local condition0 = setmetatable({filename="src/fennel/match.fnl", line=65, bytestart=2798, sym('and', nil, {quoted=true, filename="src/fennel/match.fnl", line=65}), unpack(guards)}, getmetatable(list()))
        return setmetatable({filename="src/fennel/match.fnl", line=66, bytestart=2838, sym('and', nil, {quoted=true, filename="src/fennel/match.fnl", line=66}), pcondition, setmetatable({filename="src/fennel/match.fnl", line=67, bytestart=2876, sym('let', nil, {quoted=true, filename="src/fennel/match.fnl", line=67}), bindings, condition0}, getmetatable(list()))}, getmetatable(list())), bindings
      else
        return case_pattern(vals, condition, pins, opts)
      end
    end
    utils['fennel-module'].metadata:setall(case_guard, "fnl/arglist", {"vals", "condition", "guards", "pins", "case-pattern", "opts"})
    local function bound_symbols_in_pattern(pattern)
      if _G["list?"](pattern) then
        if (_G["sym?"](pattern[1], "where") or _G["sym?"](pattern[1], "=")) then
          return bound_symbols_in_pattern(pattern[2])
        elseif _G["sym?"](pattern[2], "?") then
          return bound_symbols_in_pattern(pattern[1])
        else
          local result = {}
          for _, child_pattern in ipairs(pattern) do
            local tbl_14_ = result
            for name, symbol in pairs(bound_symbols_in_pattern(child_pattern)) do
              local k_15_, v_16_ = name, symbol
              if ((k_15_ ~= nil) and (v_16_ ~= nil)) then
                tbl_14_[k_15_] = v_16_
              end
            end
          end
          return result
        end
      elseif _G["sym?"](pattern) then
        local symname = tostring(pattern)
        if ((symname ~= "or") and (symname ~= "nil") and not symname:find("^&")) then
          return {[symname] = pattern}
        else
          return {}
        end
      elseif (type(pattern) == "table") then
        local result = {}
        for key_pattern, value_pattern in pairs(pattern) do
          do
            local tbl_14_ = result
            for name, symbol in pairs(bound_symbols_in_pattern(key_pattern)) do
              local k_15_, v_16_ = name, symbol
              if ((k_15_ ~= nil) and (v_16_ ~= nil)) then
                tbl_14_[k_15_] = v_16_
              end
            end
          end
          local tbl_14_ = result
          for name, symbol in pairs(bound_symbols_in_pattern(value_pattern)) do
            local k_15_, v_16_ = name, symbol
            if ((k_15_ ~= nil) and (v_16_ ~= nil)) then
              tbl_14_[k_15_] = v_16_
            end
          end
        end
        return result
      else
        return {}
      end
    end
    utils['fennel-module'].metadata:setall(bound_symbols_in_pattern, "fnl/arglist", {"pattern"}, "fnl/docstring", "gives the set of symbols pattern will bind")
    local function bound_symbols_in_every_pattern(pattern_list, infer_pin_3f)
      local _3fsymbols = nil
      do
        local _3fsymbols0 = nil
        for _, pattern in ipairs(pattern_list) do
          local in_pattern = bound_symbols_in_pattern(pattern)
          if _3fsymbols0 then
            for name in pairs(_3fsymbols0) do
              if not in_pattern[name] then
                _3fsymbols0[name] = nil
              end
            end
            _3fsymbols0 = _3fsymbols0
          else
            _3fsymbols0 = in_pattern
          end
        end
        _3fsymbols = _3fsymbols0
      end
      local tbl_17_ = {}
      local i_18_ = #tbl_17_
      for _, symbol in pairs((_3fsymbols or {})) do
        local val_19_ = nil
        if not (infer_pin_3f and _G["in-scope?"](symbol)) then
          val_19_ = symbol
        else
        val_19_ = nil
        end
        if (nil ~= val_19_) then
          i_18_ = (i_18_ + 1)
          tbl_17_[i_18_] = val_19_
        end
      end
      return tbl_17_
    end
    utils['fennel-module'].metadata:setall(bound_symbols_in_every_pattern, "fnl/arglist", {"pattern-list", "infer-pin?"}, "fnl/docstring", "gives a list of symbols that are bound by every pattern in the list")
    local function case_or(vals, pattern, guards, pins, case_pattern, opts)
      local pattern0 = {unpack(pattern, 2)}
      local bindings = bound_symbols_in_every_pattern(pattern0, opts["infer-pin?"])
      if (nil == bindings[1]) then
        local condition = nil
        do
          local tbl_17_ = setmetatable({filename="src/fennel/match.fnl", line=122, bytestart=5212, sym('or', nil, {quoted=true, filename="src/fennel/match.fnl", line=122})}, getmetatable(list()))
          local i_18_ = #tbl_17_
          for _, subpattern in ipairs(pattern0) do
            local val_19_ = case_pattern(vals, subpattern, pins, opts)
            if (nil ~= val_19_) then
              i_18_ = (i_18_ + 1)
              tbl_17_[i_18_] = val_19_
            end
          end
          condition = tbl_17_
        end
        local _20_
        if guards[1] then
          _20_ = setmetatable({filename="src/fennel/match.fnl", line=125, bytestart=5345, sym('and', nil, {quoted=true, filename="src/fennel/match.fnl", line=125}), condition, unpack(guards)}, getmetatable(list()))
        else
          _20_ = condition
        end
        return _20_, {}
      else
        local matched_3f = gensym("matched?")
        local bindings_mangled = nil
        do
          local tbl_17_ = {}
          local i_18_ = #tbl_17_
          for _, binding in ipairs(bindings) do
            local val_19_ = gensym(tostring(binding))
            if (nil ~= val_19_) then
              i_18_ = (i_18_ + 1)
              tbl_17_[i_18_] = val_19_
            end
          end
          bindings_mangled = tbl_17_
        end
        local pre_bindings = setmetatable({filename="src/fennel/match.fnl", line=132, bytestart=5720, sym('if', nil, {quoted=true, filename="src/fennel/match.fnl", line=132})}, getmetatable(list()))
        for _, subpattern in ipairs(pattern0) do
          local subcondition, subbindings = case_guard(vals, subpattern, guards, {}, case_pattern, opts)
          table.insert(pre_bindings, subcondition)
          table.insert(pre_bindings, setmetatable({filename="src/fennel/match.fnl", line=136, bytestart=5966, sym('let', nil, {quoted=true, filename="src/fennel/match.fnl", line=136}), subbindings, setmetatable({filename="src/fennel/match.fnl", line=137, bytestart=6026, sym('values', nil, {quoted=true, filename="src/fennel/match.fnl", line=137}), true, unpack(bindings)}, getmetatable(list()))}, getmetatable(list())))
        end
        return matched_3f, {setmetatable({filename="src/fennel/match.fnl", line=139, bytestart=6106, unpack(bindings)}, getmetatable(list())), setmetatable({filename="src/fennel/match.fnl", line=139, bytestart=6128, sym('values', nil, {quoted=true, filename="src/fennel/match.fnl", line=139}), unpack(bindings_mangled)}, getmetatable(list()))}, {setmetatable({filename="src/fennel/match.fnl", line=140, bytestart=6183, matched_3f, unpack(bindings_mangled)}, getmetatable(list())), pre_bindings}
      end
    end
    utils['fennel-module'].metadata:setall(case_or, "fnl/arglist", {"vals", "pattern", "guards", "pins", "case-pattern", "opts"})
    local function case_pattern(vals, pattern, pins, opts, _3ftop)
      local _24_ = vals
      local val = _24_[1]
      if (_G["sym?"](pattern) and (_G["sym?"](pattern, "nil") or (opts["infer-pin?"] and _G["in-scope?"](pattern) and not _G["sym?"](pattern, "_")) or (opts["infer-pin?"] and _G["multi-sym?"](pattern) and _G["in-scope?"](_G["multi-sym?"](pattern)[1])))) then
        return setmetatable({filename="src/fennel/match.fnl", line=174, bytestart=8070, sym('=', nil, {quoted=true, filename="src/fennel/match.fnl", line=174}), val, pattern}, getmetatable(list())), {}
      elseif (_G["sym?"](pattern) and pins[tostring(pattern)]) then
        return setmetatable({filename="src/fennel/match.fnl", line=177, bytestart=8208, sym('=', nil, {quoted=true, filename="src/fennel/match.fnl", line=177}), pins[tostring(pattern)], val}, getmetatable(list())), {}
      elseif _G["sym?"](pattern) then
        local wildcard_3f = tostring(pattern):find("^_")
        if not wildcard_3f then
          pins[tostring(pattern)] = val
        end
        local _26_
        if (wildcard_3f or string.find(tostring(pattern), "^?")) then
          _26_ = true
        else
          _26_ = setmetatable({filename="src/fennel/match.fnl", line=183, bytestart=8531, sym('not=', nil, {quoted=true, filename="src/fennel/match.fnl", line=183}), sym("nil"), val}, getmetatable(list()))
        end
        return _26_, {pattern, val}
      elseif (_G["list?"](pattern) and _G["sym?"](pattern[1], "=") and _G["sym?"](pattern[2])) then
        local bind = pattern[2]
        _G["assert-compile"]((2 == #pattern), "(=) should take only one argument", pattern)
        _G["assert-compile"](not opts["infer-pin?"], "(=) cannot be used inside of match", pattern)
        _G["assert-compile"](opts["in-where?"], "(=) must be used in (where) patterns", pattern)
        _G["assert-compile"]((_G["sym?"](bind) and not _G["sym?"](bind, "nil")), "= has to bind to a symbol", bind)
        return setmetatable({filename="src/fennel/match.fnl", line=194, bytestart=9165, sym('=', nil, {quoted=true, filename="src/fennel/match.fnl", line=194}), val, bind}, getmetatable(list())), {}
      elseif (_G["list?"](pattern) and _G["sym?"](pattern[1], "where") and _G["list?"](pattern[2]) and _G["sym?"](pattern[2][1], "or")) then
        _G["assert-compile"](_3ftop, "can't nest (where) pattern", pattern)
        return case_or(vals, pattern[2], {unpack(pattern, 3)}, pins, case_pattern, with(opts, "in-where?"))
      elseif (_G["list?"](pattern) and _G["sym?"](pattern[1], "where")) then
        _G["assert-compile"](_3ftop, "can't nest (where) pattern", pattern)
        return case_guard(vals, pattern[2], {unpack(pattern, 3)}, pins, case_pattern, with(opts, "in-where?"))
      elseif (_G["list?"](pattern) and _G["sym?"](pattern[1], "or")) then
        _G["assert-compile"](_3ftop, "can't nest (or) pattern", pattern)
        _G["assert-compile"](false, "(or) must be used in (where) patterns", pattern)
        return case_or(vals, pattern, {}, pins, case_pattern, opts)
      elseif (_G["list?"](pattern) and _G["sym?"](pattern[2], "?")) then
        _G["assert-compile"](opts["legacy-guard-allowed?"], "legacy guard clause not supported in case", pattern)
        return case_guard(vals, pattern[1], {unpack(pattern, 3)}, pins, case_pattern, opts)
      elseif _G["list?"](pattern) then
        _G["assert-compile"](opts["multival?"], "can't nest multi-value destructuring", pattern)
        return case_values(vals, pattern, pins, case_pattern, opts)
      elseif (type(pattern) == "table") then
        return case_table(val, pattern, pins, case_pattern, opts, _3ftop)
      else
        return setmetatable({filename="src/fennel/match.fnl", line=226, bytestart=10854, sym('=', nil, {quoted=true, filename="src/fennel/match.fnl", line=226}), val, pattern}, getmetatable(list())), {}
      end
    end
    utils['fennel-module'].metadata:setall(case_pattern, "fnl/arglist", {"vals", "pattern", "pins", "opts", "?top"}, "fnl/docstring", "Take the AST of values and a single pattern and returns a condition\nto determine if it matches as well as a list of bindings to\nintroduce for the duration of the body if it does match.")
    local function add_pre_bindings(out, pre_bindings)
      if pre_bindings then
        local tail = setmetatable({filename="src/fennel/match.fnl", line=235, bytestart=11252, sym('if', nil, {quoted=true, filename="src/fennel/match.fnl", line=235})}, getmetatable(list()))
        table.insert(out, true)
        table.insert(out, setmetatable({filename="src/fennel/match.fnl", line=237, bytestart=11317, sym('let', nil, {quoted=true, filename="src/fennel/match.fnl", line=237}), pre_bindings, tail}, getmetatable(list())))
        return tail
      else
        return out
      end
    end
    utils['fennel-module'].metadata:setall(add_pre_bindings, "fnl/arglist", {"out", "pre-bindings"}, "fnl/docstring", "Decide when to switch from the current `if` AST to a new one")
    local function case_condition(vals, clauses, match_3f, top_table_3f)
      local root = setmetatable({filename="src/fennel/match.fnl", line=246, bytestart=11658, sym('if', nil, {quoted=true, filename="src/fennel/match.fnl", line=246})}, getmetatable(list()))
      do
        local out = root
        for i = 1, #clauses, 2 do
          local pattern = clauses[i]
          local body = clauses[(i + 1)]
          local condition, bindings, pre_bindings = nil, nil, nil
          local function _30_()
            if top_table_3f then
              return "table"
            else
              return true
            end
          end
          condition, bindings, pre_bindings = case_pattern(vals, pattern, {}, {["infer-pin?"] = match_3f, ["legacy-guard-allowed?"] = match_3f, ["multival?"] = true}, _30_())
          local out0 = add_pre_bindings(out, pre_bindings)
          table.insert(out0, condition)
          table.insert(out0, setmetatable({filename="src/fennel/match.fnl", line=259, bytestart=12387, sym('let', nil, {quoted=true, filename="src/fennel/match.fnl", line=259}), bindings, body}, getmetatable(list())))
          out = out0
        end
      end
      return root
    end
    utils['fennel-module'].metadata:setall(case_condition, "fnl/arglist", {"vals", "clauses", "match?", "top-table?"}, "fnl/docstring", "Construct the actual `if` AST for the given match values and clauses.")
    local function count_case_multival(pattern)
      if (_G["list?"](pattern) and _G["sym?"](pattern[2], "?")) then
        return count_case_multival(pattern[1])
      elseif (_G["list?"](pattern) and _G["sym?"](pattern[1], "where")) then
        return count_case_multival(pattern[2])
      elseif (_G["list?"](pattern) and _G["sym?"](pattern[1], "or")) then
        local longest = 0
        for _, child_pattern in ipairs(pattern) do
          longest = math.max(longest, count_case_multival(child_pattern))
        end
        return longest
      elseif _G["list?"](pattern) then
        return #pattern
      else
        return 1
      end
    end
    utils['fennel-module'].metadata:setall(count_case_multival, "fnl/arglist", {"pattern"}, "fnl/docstring", "Identify the amount of multival values that a pattern requires.")
    local function case_count_syms(clauses)
      local patterns = nil
      do
        local tbl_17_ = {}
        local i_18_ = #tbl_17_
        for i = 1, #clauses, 2 do
          local val_19_ = clauses[i]
          if (nil ~= val_19_) then
            i_18_ = (i_18_ + 1)
            tbl_17_[i_18_] = val_19_
          end
        end
        patterns = tbl_17_
      end
      local longest = 0
      for _, pattern in ipairs(patterns) do
        longest = math.max(longest, count_case_multival(pattern))
      end
      return longest
    end
    utils['fennel-module'].metadata:setall(case_count_syms, "fnl/arglist", {"clauses"}, "fnl/docstring", "Find the length of the largest multi-valued clause")
    local function maybe_optimize_table(val, clauses)
      local _33_
      do
        local all = _G["sequence?"](val)
        for i = 1, #clauses, 2 do
          if not all then break end
          local function _34_()
            local all2 = next(clauses[i])
            for _, d in ipairs(clauses[i]) do
              if not all2 then break end
              all2 = (all2 and (not _G["sym?"](d) or not tostring(d):find("^&")))
            end
            return all2
          end
          all = (_G["sequence?"](clauses[i]) and _34_())
        end
        _33_ = all
      end
      if _33_ then
        local function _35_()
          local tbl_17_ = {}
          local i_18_ = #tbl_17_
          for i = 1, #clauses do
            local val_19_ = nil
            if (1 == (i % 2)) then
              val_19_ = list(unpack(clauses[i]))
            else
              val_19_ = clauses[i]
            end
            if (nil ~= val_19_) then
              i_18_ = (i_18_ + 1)
              tbl_17_[i_18_] = val_19_
            end
          end
          return tbl_17_
        end
        return setmetatable({filename="src/fennel/match.fnl", line=291, bytestart=13670, sym('values', nil, {quoted=true, filename="src/fennel/match.fnl", line=291}), unpack(val)}, getmetatable(list())), _35_()
      else
        return val, clauses
      end
    end
    utils['fennel-module'].metadata:setall(maybe_optimize_table, "fnl/arglist", {"val", "clauses"})
    local function case_impl(match_3f, init_val, ...)
      assert((init_val ~= nil), "missing subject")
      assert((0 == math.fmod(select("#", ...), 2)), "expected even number of pattern/body pairs")
      assert((0 ~= select("#", ...)), "expected at least one pattern/body pair")
      local val, clauses = maybe_optimize_table(init_val, {...})
      local vals_count = case_count_syms(clauses)
      if ((vals_count == 1) and not _G["varg?"](val) and utils["idempotent-expr?"](val)) then
        return case_condition(list(val), clauses, match_3f, _G["table?"](init_val))
      else
        local vals = nil
        do
          local tbl_17_ = list()
          local i_18_ = #tbl_17_
          for _ = 1, vals_count do
            local val_19_ = gensym("case")
            if (nil ~= val_19_) then
              i_18_ = (i_18_ + 1)
              tbl_17_[i_18_] = val_19_
            end
          end
          vals = tbl_17_
        end
        return list(sym('let', nil, {quoted=true, filename="src/fennel/match.fnl", line=312}), {vals, val}, case_condition(vals, clauses, match_3f, _G["table?"](init_val)))
      end
    end
    utils['fennel-module'].metadata:setall(case_impl, "fnl/arglist", {"match?", "init-val", "..."}, "fnl/docstring", "The shared implementation of case and match.")
    local function case_2a(val, ...)
      return case_impl(false, val, ...)
    end
    utils['fennel-module'].metadata:setall(case_2a, "fnl/arglist", {"val", "..."}, "fnl/docstring", "Perform pattern matching on val. See reference for details.\n\nSyntax:\n\n(case data-expression\n  pattern body\n  (where pattern guards*) body\n  (where (or pattern patterns*) guards*) body)")
    local function match_2a(val, ...)
      return case_impl(true, val, ...)
    end
    utils['fennel-module'].metadata:setall(match_2a, "fnl/arglist", {"val", "..."}, "fnl/docstring", "Perform pattern matching on val, automatically pinning variables in scope.\n\nSyntax:\n\n(match expression\n  pattern body\n  (where pattern guards*) body\n  (where (or pattern patterns*) guards*) body)")
    local function case_try_step(how, expr, _else, pattern, body, ...)
      if ((nil == pattern) and (pattern == body)) then
        return expr
      else
        return setmetatable({filename="src/fennel/match.fnl", line=343, bytestart=15577, setmetatable({filename="src/fennel/match.fnl", line=343, bytestart=15578, sym('fn', nil, {quoted=true, filename="src/fennel/match.fnl", line=343}), setmetatable({_VARARG}, {filename="src/fennel/match.fnl", line=343}), setmetatable({filename="src/fennel/match.fnl", line=344, bytestart=15598, how, _VARARG, pattern, case_try_step(how, body, _else, ...), unpack(_else)}, getmetatable(list()))}, getmetatable(list())), expr}, getmetatable(list()))
      end
    end
    utils['fennel-module'].metadata:setall(case_try_step, "fnl/arglist", {"how", "expr", "else", "pattern", "body", "..."})
    local function case_try_impl(how, expr, pattern, body, ...)
      local clauses = {pattern, body, ...}
      local last = clauses[#clauses]
      local catch = nil
      if (_G["list?"](last) and _G["sym?"](last[1], "catch")) then
        local _42_ = table.remove(clauses)
        local _ = _42_[1]
        local e = {(table.unpack or unpack)(_42_, 2)}
        catch = e
      else
        catch = {sym('__43_', nil, {filename="src/fennel/match.fnl", line=354}), _VARARG}
      end
      assert((0 == math.fmod(#clauses, 2)), "expected every pattern to have a body")
      assert((0 == math.fmod(#catch, 2)), "expected every catch pattern to have a body")
      return case_try_step(how, expr, catch, unpack(clauses))
    end
    utils['fennel-module'].metadata:setall(case_try_impl, "fnl/arglist", {"how", "expr", "pattern", "body", "..."})
    local function case_try_2a(expr, pattern, body, ...)
      return case_try_impl(sym('case', nil, {quoted=true, filename="src/fennel/match.fnl", line=372}), expr, pattern, body, ...)
    end
    utils['fennel-module'].metadata:setall(case_try_2a, "fnl/arglist", {"expr", "pattern", "body", "..."}, "fnl/docstring", "Perform chained pattern matching for a sequence of steps which might fail.\n\nThe values from the initial expression are matched against the first pattern.\nIf they match, the first body is evaluated and its values are matched against\nthe second pattern, etc.\n\nIf there is a (catch pat1 body1 pat2 body2 ...) form at the end, any mismatch\nfrom the steps will be tried against these patterns in sequence as a fallback\njust like a normal match. If there is no catch, the mismatched values will be\nreturned as the value of the entire expression.")
    local function match_try_2a(expr, pattern, body, ...)
      return case_try_impl(sym('match', nil, {quoted=true, filename="src/fennel/match.fnl", line=385}), expr, pattern, body, ...)
    end
    utils['fennel-module'].metadata:setall(match_try_2a, "fnl/arglist", {"expr", "pattern", "body", "..."}, "fnl/docstring", "Perform chained pattern matching for a sequence of steps which might fail.\n\nThe values from the initial expression are matched against the first pattern.\nIf they match, the first body is evaluated and its values are matched against\nthe second pattern, etc.\n\nIf there is a (catch pat1 body1 pat2 body2 ...) form at the end, any mismatch\nfrom the steps will be tried against these patterns in sequence as a fallback\njust like a normal match. If there is no catch, the mismatched values will be\nreturned as the value of the entire expression.")
    return {["case-try"] = case_try_2a, ["match-try"] = match_try_2a, case = case_2a, match = match_2a}
    ]===], env)
  end
  return mod
end
package.preload["fennel-ls.dispatch"] = package.preload["fennel-ls.dispatch"] or function(...)
  local handlers = require("fennel-ls.handlers")
  local message = require("fennel-ls.message")
  local function handle_request(server, send, id, method, _3fparams)
    if (nil == method) then
      _G.error("Missing argument method on /fennel-ls/src/fennel-ls/dispatch.fnl:12", 2)
    else
    end
    if (nil == id) then
      _G.error("Missing argument id on /fennel-ls/src/fennel-ls/dispatch.fnl:12", 2)
    else
    end
    if (nil == send) then
      _G.error("Missing argument send on /fennel-ls/src/fennel-ls/dispatch.fnl:12", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/dispatch.fnl:12", 2)
    else
    end
    local case_1204_ = handlers.requests[method]
    if (nil ~= case_1204_) then
      local callback = case_1204_
      local case_1205_, case_1206_ = callback(server, send, _3fparams)
      if ((case_1205_ == nil) and (nil ~= case_1206_)) then
        local err = case_1206_
        return send(message["create-error"]("InternalError", err, id))
      else
        local _3fresponse = case_1205_
        return send(message["create-response"](id, _3fresponse))
      end
    elseif (case_1204_ == nil) then
      return send(message["create-error"]("MethodNotFound", ("\"" .. method .. "\" is not in the request-handlers table"), id))
    else
      return nil
    end
  end
  local function handle_response(_server, _send, _id, _result)
    return nil
  end
  local function handle_bad_response(_server, _send, _id, err)
    if (nil == err) then
      _G.error("Missing argument err on /fennel-ls/src/fennel-ls/dispatch.fnl:31", 2)
    else
    end
    return error(("Client sent fennel-ls an error: " .. err.code))
  end
  local function handle_notification(server, send, method, _3fparams)
    if (nil == method) then
      _G.error("Missing argument method on /fennel-ls/src/fennel-ls/dispatch.fnl:35", 2)
    else
    end
    if (nil == send) then
      _G.error("Missing argument send on /fennel-ls/src/fennel-ls/dispatch.fnl:35", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/dispatch.fnl:35", 2)
    else
    end
    local case_1213_ = handlers.notifications[method]
    if (nil ~= case_1213_) then
      local callback = case_1213_
      return callback(server, send, _3fparams)
    else
      return nil
    end
  end
  local function handle(server, send, msg)
    if (nil == msg) then
      _G.error("Missing argument msg on /fennel-ls/src/fennel-ls/dispatch.fnl:41", 2)
    else
    end
    if (nil == send) then
      _G.error("Missing argument send on /fennel-ls/src/fennel-ls/dispatch.fnl:41", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/dispatch.fnl:41", 2)
    else
    end
    do
      local case_1218_, case_1219_ = msg, type(msg)
      if ((_G.type(case_1218_) == "table") and (case_1218_.jsonrpc == "2.0") and (nil ~= case_1218_.id) and (nil ~= case_1218_.method) and true) then
        local id = case_1218_.id
        local method = case_1218_.method
        local _3fparams = case_1218_.params
        handle_request(server, send, id, method, _3fparams)
      elseif ((_G.type(case_1218_) == "table") and (case_1218_.jsonrpc == "2.0") and (nil ~= case_1218_.method) and true) then
        local method = case_1218_.method
        local _3fparams = case_1218_.params
        handle_notification(server, send, method, _3fparams)
      elseif ((_G.type(case_1218_) == "table") and (case_1218_.jsonrpc == "2.0") and (nil ~= case_1218_.id) and (nil ~= case_1218_.result)) then
        local id = case_1218_.id
        local result = case_1218_.result
        handle_response(server, send, id, result)
      elseif ((_G.type(case_1218_) == "table") and (case_1218_.jsonrpc == "2.0") and (nil ~= case_1218_.id) and (nil ~= case_1218_.error)) then
        local id = case_1218_.id
        local err = case_1218_.error
        handle_bad_response(server, send, id, err)
      elseif ((nil ~= case_1218_) and (case_1219_ == "string")) then
        local str = case_1218_
        send(message["create-error"]("ParseError", str))
      else
        local _ = case_1218_
        send(message["create-error"]("BadMessage", nil, msg.id))
      end
    end
    while next(server.queue) do
      send(table.remove(server.queue, 1))
    end
    return nil
  end
  return {handle = handle}
end
package.preload["fennel-ls.handlers"] = package.preload["fennel-ls.handlers"] or function(...)
  local lint = require("fennel-ls.lint")
  local message = require("fennel-ls.message")
  local files = require("fennel-ls.files")
  local config = require("fennel-ls.config")
  local analyzer = require("fennel-ls.analyzer")
  local formatter = require("fennel-ls.formatter")
  local utils = require("fennel-ls.utils")
  local fennel = require("fennel")
  local requests = {}
  local notifications = {}
  requests.initialize = function(server, _send, params)
    if (nil == params) then
      _G.error("Missing argument params on /fennel-ls/src/fennel-ls/handlers.fnl:20", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/handlers.fnl:20", 2)
    else
    end
    config.initialize(server, params)
    local capabilities = {positionEncoding = server["position-encoding"], textDocumentSync = {openClose = true, change = 2, save = true}, completionProvider = {resolveProvider = server["client-capable-of-good-completions?"], triggerCharacters = {"(", "[", "{", ".", ":", "!", "^", "$", "%", "&", "*", "+", "/", "<", "=", ">", "?"}, completionItem = {labelDetailsSupport = false}, workDoneProgress = false}, hoverProvider = {workDoneProgress = false}, signatureHelpProvider = {triggerCharacters = {" "}, retriggerCharacters = {" "}, workDoneProgress = false}, definitionProvider = {workDoneProgress = false}, referencesProvider = {workDoneProgress = false}, documentHighlightProvider = {workDoneProgress = false}, documentSymbolProvider = {workDoneProgress = false}, codeActionProvider = {workDoneProgress = false}, renameProvider = {prepareProvider = true, workDoneProgress = false}, diagnosticProvider = {interFileDependencies = true, workDoneProgress = false, workspaceDiagnostics = false}}
    return {capabilities = capabilities, serverInfo = {name = "fennel-ls", version = utils.version}}
  end
  requests["textDocument/definition"] = function(server, _send, _1002_)
    local position = _1002_.position
    local _arg_1003_ = _1002_.textDocument
    local uri = _arg_1003_.uri
    if (nil == uri) then
      _G.error("Missing argument uri on /fennel-ls/src/fennel-ls/handlers.fnl:81", 2)
    else
    end
    if (nil == position) then
      _G.error("Missing argument position on /fennel-ls/src/fennel-ls/handlers.fnl:81", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/handlers.fnl:81", 2)
    else
    end
    local file = files["get-by-uri"](server, uri)
    local byte = utils["position->byte"](file.text, position, server["position-encoding"])
    local function _1007_(...)
      local case_1008_, case_1009_ = ...
      if ((nil ~= case_1008_) and ((_G.type(case_1009_) == "table") and (nil ~= case_1009_[1]))) then
        local symbol = case_1008_
        local parent = case_1009_[1]
        local function _1010_(...)
          local case_1011_ = ...
          if (nil ~= case_1011_) then
            local result = case_1011_
            if result.file then
              return message["range-and-uri"](server, result.file, (result.binding or result.definition))
            else
              return nil
            end
          else
            local _ = case_1011_
            return nil
          end
        end
        local function _1015_(...)
          local search_target
          if file["require-calls"][parent] then
            search_target = parent
          else
            search_target = symbol
          end
          return analyzer.search(server, file, search_target, {["stop-early?"] = true}, {byte = byte})
        end
        return _1010_(_1015_(...))
      else
        local _ = case_1008_
        return nil
      end
    end
    return _1007_(analyzer["find-symbol"](server, file, byte))
  end
  local documentHighlightKind = {Text = 1, Read = 2, Write = 3}
  requests["textDocument/documentHighlight"] = function(server, _send, _1017_)
    local position = _1017_.position
    local _arg_1018_ = _1017_.textDocument
    local uri = _arg_1018_.uri
    if (nil == uri) then
      _G.error("Missing argument uri on /fennel-ls/src/fennel-ls/handlers.fnl:97", 2)
    else
    end
    if (nil == position) then
      _G.error("Missing argument position on /fennel-ls/src/fennel-ls/handlers.fnl:96", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/handlers.fnl:96", 2)
    else
    end
    local this_file = files["get-by-uri"](server, uri)
    local byte = utils["position->byte"](this_file.text, position, server["position-encoding"])
    local function _1022_(...)
      local case_1023_ = ...
      if (nil ~= case_1023_) then
        local symbol = case_1023_
        local function _1024_(...)
          local case_1025_ = ...
          if ((_G.type(case_1025_) == "table") and (nil ~= case_1025_["referenced-by"]) and ((_G.type(case_1025_.file) == "table") and (case_1025_.file.uri == this_file.uri)) and (nil ~= case_1025_.binding)) then
            local referenced_by = case_1025_["referenced-by"]
            local file = case_1025_.file
            local binding = case_1025_.binding
            local result
            do
              local tbl_26_ = {}
              local i_27_ = 0
              for _, _1026_ in ipairs(referenced_by) do
                local reference = _1026_.symbol
                local val_28_ = {range = message["ast->range"](server, file, reference), kind = documentHighlightKind.Read}
                if (nil ~= val_28_) then
                  i_27_ = (i_27_ + 1)
                  tbl_26_[i_27_] = val_28_
                else
                end
              end
              result = tbl_26_
            end
            table.insert(result, {range = message["ast->range"](server, file, binding), kind = documentHighlightKind.Write})
            return result
          else
            local _ = case_1025_
            return nil
          end
        end
        return _1024_(analyzer["find-nearest-definition"](server, this_file, symbol, byte))
      else
        local _ = case_1023_
        return nil
      end
    end
    return _1022_(analyzer["find-symbol"](server, this_file, byte))
  end
  requests["textDocument/references"] = function(server, _send, _1030_)
    local position = _1030_.position
    local _arg_1031_ = _1030_.textDocument
    local uri = _arg_1031_.uri
    local _arg_1032_ = _1030_.context
    local include_declaration_3f = _arg_1032_.includeDeclaration
    if (nil == include_declaration_3f) then
      _G.error("Missing argument include-declaration? on /fennel-ls/src/fennel-ls/handlers.fnl:115", 2)
    else
    end
    if (nil == uri) then
      _G.error("Missing argument uri on /fennel-ls/src/fennel-ls/handlers.fnl:113", 2)
    else
    end
    if (nil == position) then
      _G.error("Missing argument position on /fennel-ls/src/fennel-ls/handlers.fnl:112", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/handlers.fnl:112", 2)
    else
    end
    local file = files["get-by-uri"](server, uri)
    local byte = utils["position->byte"](file.text, position, server["position-encoding"])
    local function _1037_(...)
      local case_1038_ = ...
      if (nil ~= case_1038_) then
        local symbol = case_1038_
        local function _1039_(...)
          local case_1040_ = ...
          if ((_G.type(case_1040_) == "table") and (nil ~= case_1040_["referenced-by"]) and (nil ~= case_1040_.file) and (nil ~= case_1040_.binding)) then
            local referenced_by = case_1040_["referenced-by"]
            local file0 = case_1040_.file
            local binding = case_1040_.binding
            local result
            do
              local tbl_26_ = {}
              local i_27_ = 0
              for _, _1041_ in ipairs(referenced_by) do
                local symbol0 = _1041_.symbol
                local val_28_ = message["range-and-uri"](server, file0, symbol0)
                if (nil ~= val_28_) then
                  i_27_ = (i_27_ + 1)
                  tbl_26_[i_27_] = val_28_
                else
                end
              end
              result = tbl_26_
            end
            if include_declaration_3f then
              table.insert(result, message["range-and-uri"](server, file0, binding))
            else
            end
            return result
          else
            local _ = case_1040_
            return nil
          end
        end
        return _1039_(analyzer["find-nearest-definition"](server, file, symbol, byte))
      else
        local _ = case_1038_
        return nil
      end
    end
    return _1037_(analyzer["find-symbol"](server, file, byte))
  end
  requests["textDocument/signatureHelp"] = function(server, _send, _1046_)
    local _arg_1047_ = _1046_.textDocument
    local uri = _arg_1047_.uri
    local position = _1046_.position
    if (nil == position) then
      _G.error("Missing argument position on /fennel-ls/src/fennel-ls/handlers.fnl:133", 2)
    else
    end
    if (nil == uri) then
      _G.error("Missing argument uri on /fennel-ls/src/fennel-ls/handlers.fnl:133", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/handlers.fnl:131", 2)
    else
    end
    local file = files["get-by-uri"](server, uri)
    local byte = utils["position->byte"](file.text, position, server["position-encoding"])
    local function _1051_(...)
      local case_1052_, case_1053_ = ...
      if ((nil ~= case_1052_) and (nil ~= case_1053_)) then
        local call = case_1052_
        local active_parameter = case_1053_
        local function _1054_(...)
          local case_1055_ = ...
          if ((_G.type(case_1055_) == "table") and (case_1055_.indeterminate == nil)) then
            local definition = case_1055_
            local function _1056_(...)
              local case_1057_ = ...
              if (nil ~= case_1057_) then
                local signature = case_1057_
                return message["call->signature-help"](server, file, call, signature, active_parameter)
              else
                local _ = case_1057_
                return nil
              end
            end
            return _1056_(formatter["signature-help-format"](definition))
          else
            local _ = case_1055_
            return nil
          end
        end
        return _1054_(analyzer["find-definition"](server, file, call))
      else
        local _ = case_1052_
        return nil
      end
    end
    return _1051_(analyzer["find-nearest-call"](server, file, byte))
  end
  requests["textDocument/hover"] = function(server, _send, _1061_)
    local position = _1061_.position
    local _arg_1062_ = _1061_.textDocument
    local uri = _arg_1062_.uri
    if (nil == uri) then
      _G.error("Missing argument uri on /fennel-ls/src/fennel-ls/handlers.fnl:147", 2)
    else
    end
    if (nil == position) then
      _G.error("Missing argument position on /fennel-ls/src/fennel-ls/handlers.fnl:147", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/handlers.fnl:147", 2)
    else
    end
    local file = files["get-by-uri"](server, uri)
    local byte = utils["position->byte"](file.text, position, server["position-encoding"])
    local function _1066_(...)
      local case_1067_, case_1068_ = ...
      if ((nil ~= case_1067_) and (nil ~= case_1068_)) then
        local symbol = case_1067_
        local parents = case_1068_
        local function _1069_(...)
          local case_1070_ = ...
          if ((_G.type(case_1070_) == "table") and (case_1070_.indeterminate == nil)) then
            local result = case_1070_
            local opts
            local function _1071_(...)
              local case_1072_ = ...
              if ((_G.type(case_1072_) == "table") and ((_G.type(case_1072_[1]) == "table") and (case_1072_[1][1] == symbol))) then
                local parent = case_1072_[1]
                local function _1073_(...)
                  local case_1074_ = ...
                  if ((_G.type(case_1074_) == "table") and (nil ~= case_1074_[parent])) then
                    local expansion = case_1074_[parent]
                    return fennel.view(expansion)
                  else
                    local _ = case_1074_
                    return nil
                  end
                end
                return _1073_(file["macro-calls"])
              else
                local _ = case_1072_
                return nil
              end
            end
            opts = {macroexpansion = _1071_(parents)}
            return {contents = formatter["hover-format"](server, tostring(symbol), result, opts), range = message["ast->range"](server, file, symbol)}
          else
            local _ = case_1070_
            return nil
          end
        end
        return _1069_(analyzer.search(server, file, symbol, {}, {byte = byte}))
      else
        local _ = case_1067_
        return nil
      end
    end
    return _1066_(analyzer["find-symbol"](server, file, byte))
  end
  requests["textDocument/documentSymbol"] = function(server, _send, _1079_)
    local _arg_1080_ = _1079_.textDocument
    local uri = _arg_1080_.uri
    if (nil == uri) then
      _G.error("Missing argument uri on /fennel-ls/src/fennel-ls/handlers.fnl:163", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/handlers.fnl:163", 2)
    else
    end
    local file = files["get-by-uri"](server, uri)
    local symbols = analyzer["find-document-symbols"](server, file)
    return message["document-symbol-format"](server, file, symbols)
  end
  local _set_1133_ = require("fennel-ls.completion")
  requests["textDocument/completion"] = _set_1133_["textDocument/completion"]
  requests["completionItem/resolve"] = _set_1133_["completionItem/resolve"]
  requests["textDocument/rename"] = function(server, _send, _1134_)
    local position = _1134_.position
    local _arg_1135_ = _1134_.textDocument
    local uri = _arg_1135_.uri
    local new_name = _1134_.newName
    if (nil == new_name) then
      _G.error("Missing argument new-name on /fennel-ls/src/fennel-ls/handlers.fnl:172", 2)
    else
    end
    if (nil == uri) then
      _G.error("Missing argument uri on /fennel-ls/src/fennel-ls/handlers.fnl:172", 2)
    else
    end
    if (nil == position) then
      _G.error("Missing argument position on /fennel-ls/src/fennel-ls/handlers.fnl:172", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/handlers.fnl:172", 2)
    else
    end
    local file = files["get-by-uri"](server, uri)
    local byte = utils["position->byte"](file.text, position, server["position-encoding"])
    local function _1140_(...)
      local case_1141_ = ...
      if (nil ~= case_1141_) then
        local symbol = case_1141_
        local function _1142_(...)
          local case_1143_ = ...
          if ((_G.type(case_1143_) == "table") and (nil ~= case_1143_["referenced-by"]) and (nil ~= case_1143_.file) and (nil ~= case_1143_.binding)) then
            local referenced_by = case_1143_["referenced-by"]
            local file0 = case_1143_.file
            local binding = case_1143_.binding
            local usages
            do
              local tbl_24_ = {{range = message["multisym->range"](server, file0, binding, 1), newText = new_name}}
              for _, _1144_ in ipairs(referenced_by) do
                local symbol0 = _1144_.symbol
                local val_25_
                if (file0.lexical[symbol0] and not rawequal(symbol0, binding)) then
                  val_25_ = {newText = new_name, range = message["multisym->range"](server, file0, symbol0, 1)}
                else
                  val_25_ = nil
                end
                table.insert(tbl_24_, val_25_)
              end
              usages = tbl_24_
            end
            local function _1146_(_241, _242)
              return (utils["position->byte"](file0.text, _241.range.start, "utf-8") > utils["position->byte"](file0.text, _242.range.start, "utf-8"))
            end
            table.sort(usages, _1146_)
            local prev = {}
            local usages_dedup
            do
              local tbl_26_ = {}
              local i_27_ = 0
              for _, edit in ipairs(usages) do
                local val_28_
                if ((edit.range.start.line ~= prev.line) or (edit.range.start.character ~= prev.character)) then
                  prev = edit.range.start
                  val_28_ = edit
                else
                  val_28_ = nil
                end
                if (nil ~= val_28_) then
                  i_27_ = (i_27_ + 1)
                  tbl_26_[i_27_] = val_28_
                else
                end
              end
              usages_dedup = tbl_26_
            end
            return {changes = {[file0.uri] = usages_dedup}}
          else
            local _ = case_1143_
            return nil
          end
        end
        return _1142_(analyzer["find-nearest-definition"](server, file, symbol, symbol.bytestart))
      else
        local _ = case_1141_
        return nil
      end
    end
    return _1140_(analyzer["find-symbol"](server, file, byte))
  end
  requests["textDocument/prepareRename"] = function(server, send_, _1151_)
    local position = _1151_.position
    local _arg_1152_ = _1151_.textDocument
    local uri = _arg_1152_.uri
    if (nil == uri) then
      _G.error("Missing argument uri on /fennel-ls/src/fennel-ls/handlers.fnl:202", 2)
    else
    end
    if (nil == position) then
      _G.error("Missing argument position on /fennel-ls/src/fennel-ls/handlers.fnl:202", 2)
    else
    end
    if (nil == send_) then
      _G.error("Missing argument send_ on /fennel-ls/src/fennel-ls/handlers.fnl:202", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/handlers.fnl:202", 2)
    else
    end
    local file = files["get-by-uri"](server, uri)
    local byte = utils["position->byte"](file.text, position, server["position-encoding"])
    local function _1157_(...)
      local case_1158_ = ...
      if (nil ~= case_1158_) then
        local symbol = case_1158_
        local function _1159_(...)
          local case_1160_ = ...
          if ((_G.type(case_1160_) == "table") and (nil ~= case_1160_["referenced-by"]) and (nil ~= case_1160_.file) and (nil ~= case_1160_.binding)) then
            local x1_ = case_1160_["referenced-by"]
            local file0 = case_1160_.file
            local x2_ = case_1160_.binding
            return message["multisym->range"](server, file0, symbol, 1)
          else
            local _ = case_1160_
            return nil
          end
        end
        return _1159_(analyzer["find-nearest-definition"](server, file, symbol, symbol.bytestart))
      else
        local _ = case_1158_
        return nil
      end
    end
    return _1157_(analyzer["find-symbol"](server, file, byte))
  end
  local function pos_3c_3d(pos_1, pos_2)
    return ((pos_1.line < pos_2.line) or ((pos_1.line == pos_2.line) and (pos_1.character <= pos_2.character)))
  end
  local function overlap_3f(range_1, range_2)
    return (pos_3c_3d(range_1.start, range_2["end"]) and pos_3c_3d(range_2.start, range_1["end"]))
  end
  requests["textDocument/codeAction"] = function(server, _send, _1163_)
    local range = _1163_.range
    local _arg_1164_ = _1163_.textDocument
    local uri = _arg_1164_.uri
    if (nil == uri) then
      _G.error("Missing argument uri on /fennel-ls/src/fennel-ls/handlers.fnl:222", 2)
    else
    end
    if (nil == range) then
      _G.error("Missing argument range on /fennel-ls/src/fennel-ls/handlers.fnl:222", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/handlers.fnl:222", 2)
    else
    end
    local file = files["get-by-uri"](server, uri)
    local byte = utils["position->byte"](file.text, range.start, server["position-encoding"])
    local results = {}
    lint["add-lint-diagnostics"](server, file)
    local function _1168_(...)
      local case_1169_, case_1170_ = ...
      if ((nil ~= case_1169_) and ((_G.type(case_1170_) == "table") and ((_G.type(case_1170_[1]) == "table") and (case_1169_ == case_1170_[1][1])))) then
        local symbol_ = case_1169_
        local parent = case_1170_[1]
        local function _1171_(...)
          local case_1172_ = ...
          if ((_G.type(case_1172_) == "table") and (nil ~= case_1172_[parent])) then
            local expansion = case_1172_[parent]
            return table.insert(results, {title = "Expand macro", edit = {changes = {[uri] = {{range = message["ast->range"](server, file, parent), newText = fennel.view(expansion)}}}}})
          else
            local __43_ = case_1172_
            return ...
          end
        end
        return _1171_(file["macro-calls"])
      else
        local __43_ = case_1169_
        return ...
      end
    end
    _1168_(analyzer["find-symbol"](server, file, byte))
    local tbl_24_ = results
    for _, diagnostic in ipairs(file.diagnostics) do
      local val_25_
      if overlap_3f(diagnostic.range, range) then
        val_25_ = message["diagnostic->code-action"](server, file, diagnostic, "quickfix")
      else
        val_25_ = nil
      end
      table.insert(tbl_24_, val_25_)
    end
    return tbl_24_
  end
  requests["textDocument/diagnostic"] = function(server, _send, _1176_)
    local _arg_1177_ = _1176_.textDocument
    local uri = _arg_1177_.uri
    if (nil == uri) then
      _G.error("Missing argument uri on /fennel-ls/src/fennel-ls/handlers.fnl:237", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/handlers.fnl:237", 2)
    else
    end
    local file = files["get-by-uri"](server, uri)
    lint["add-lint-diagnostics"](server, file)
    return {kind = "full", items = file.diagnostics}
  end
  local function push_diagnostics(server, file)
    if not server["client-capable-of-pull-diagnostics?"] then
      server["files-pending-lint"][file.uri] = true
      return nil
    else
      return nil
    end
  end
  notifications["textDocument/didChange"] = function(server, _send, _1181_)
    local contentChanges = _1181_.contentChanges
    local _arg_1182_ = _1181_.textDocument
    local uri = _arg_1182_.uri
    if (nil == uri) then
      _G.error("Missing argument uri on /fennel-ls/src/fennel-ls/handlers.fnl:247", 2)
    else
    end
    if (nil == contentChanges) then
      _G.error("Missing argument contentChanges on /fennel-ls/src/fennel-ls/handlers.fnl:247", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/handlers.fnl:247", 2)
    else
    end
    local file = files["get-by-uri"](server, uri)
    local file0 = files["set-uri-contents"](server, uri, utils["apply-changes"](file.text, contentChanges, server["position-encoding"]))
    return push_diagnostics(server, file0)
  end
  notifications["textDocument/didOpen"] = function(server, _send, _1186_)
    local _arg_1187_ = _1186_.textDocument
    local text = _arg_1187_.text
    local uri = _arg_1187_.uri
    if (nil == uri) then
      _G.error("Missing argument uri on /fennel-ls/src/fennel-ls/handlers.fnl:252", 2)
    else
    end
    if (nil == text) then
      _G.error("Missing argument text on /fennel-ls/src/fennel-ls/handlers.fnl:252", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/handlers.fnl:252", 2)
    else
    end
    local file = files["set-uri-contents"](server, uri, text)
    push_diagnostics(server, file)
    file["open?"] = true
    return nil
  end
  notifications["textDocument/didSave"] = function(server, _send, _1191_)
    local _arg_1192_ = _1191_.textDocument
    local uri = _arg_1192_.uri
    if (nil == uri) then
      _G.error("Missing argument uri on /fennel-ls/src/fennel-ls/handlers.fnl:257", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/handlers.fnl:257", 2)
    else
    end
    if utils.endswith(uri, "flsproject.fnl") then
      config.reload(server)
    else
    end
    for k in pairs(fennel["macro-loaded"]) do
      fennel["macro-loaded"][k] = nil
    end
    return nil
  end
  notifications["textDocument/didClose"] = function(server, _send, _1196_)
    local _arg_1197_ = _1196_.textDocument
    local uri = _arg_1197_.uri
    if (nil == uri) then
      _G.error("Missing argument uri on /fennel-ls/src/fennel-ls/handlers.fnl:263", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/handlers.fnl:263", 2)
    else
    end
    local file = files["get-by-uri"](server, uri)
    file["open?"] = false
    for k in pairs(fennel["macro-loaded"]) do
      fennel["macro-loaded"][k] = nil
    end
    files["flush-uri"](server, uri)
    server["files-pending-lint"][uri] = nil
    return nil
  end
  requests.shutdown = function(_server, _send)
    return nil
  end
  notifications.exit = function(_server)
    return os.exit(0)
  end
  return {requests = requests, notifications = notifications}
end
package.preload["fennel-ls.lint"] = package.preload["fennel-ls.lint"] or function(...)
  local _local_1_ = require("fennel")
  local sym_3f = _local_1_["sym?"]
  local list_3f = _local_1_["list?"]
  local table_3f = _local_1_["table?"]
  local varg_3f = _local_1_["varg?"]
  local view = _local_1_.view
  local sym = _local_1_.sym
  local list = _local_1_.list
  local fennel = _local_1_
  local _local_2_ = require("fennel.compiler")
  local _local_3_ = _local_2_.scopes
  local _local_4_ = _local_3_.global
  local SPECIALS = _local_4_.specials
  local analyzer = require("fennel-ls.analyzer")
  local message = require("fennel-ls.message")
  local utils = require("fennel-ls.utils")
  local navigate = require("fennel-ls.navigate")
  local docs = require("fennel-ls.docs")
  local dkjson = require("dkjson")
  local compiler = require("fennel-ls.compiler")
  local function special_3f(item)
    return (sym_3f(item) and SPECIALS[tostring(item)] and item)
  end
  local ops = {["+"] = 1, ["-"] = 1, ["*"] = 1, ["/"] = 1, ["//"] = 1, ["%"] = 1, ["^"] = 1, [">"] = 1, ["<"] = 1, [">="] = 1, ["<="] = 1, ["="] = 1, ["not="] = 1, [".."] = 1, ["."] = 1, ["and"] = 1, ["or"] = 1, band = 1, bor = 1, bxor = 1, bnot = 1, lshift = 1, rshift = 1}
  local function op_3f(item)
    return (sym_3f(item) and ops[tostring(item)] and item)
  end
  local op_identity_value = {["+"] = 0, ["*"] = 1, ["and"] = true, band = -1, bor = 0, [".."] = "", ["or"] = false}
  local associative_ops = {["+"] = true, ["*"] = true, ["and"] = true, ["or"] = true, band = true, bor = true, [".."] = true}
  local redundant_wrappers = {["+"] = true, ["*"] = true, ["and"] = true, ["or"] = true, band = true, bor = true, [".."] = true, ["do"] = true, values = true}
  local implicit_do_forms
  do
    local tbl_21_ = {}
    for form, _621_ in pairs(fennel.syntax()) do
      local body_form_3f = _621_["body-form?"]
      local k_22_, v_23_ = form, body_form_3f
      if ((k_22_ ~= nil) and (v_23_ ~= nil)) then
        tbl_21_[k_22_] = v_23_
      else
      end
    end
    implicit_do_forms = tbl_21_
  end
  local function call_of_3f(ast, callee)
    return (list_3f(ast) and sym_3f(ast[1], callee))
  end
  local lints = {definition = {}, reference = {}, ["macro-call"] = {}, ["function-call"] = {}, ["special-call"] = {}, other = {}}
  local all_lints = {}
  local function add_lint(name, lint, ...)
    if (nil == lint.type) then
      local function _623_(...)
        local tbl_26_ = {}
        local i_27_ = 0
        for k in pairs(lints) do
          local val_28_ = k
          if (nil ~= val_28_) then
            i_27_ = (i_27_ + 1)
            tbl_26_[i_27_] = val_28_
          else
          end
        end
        return tbl_26_
      end
      error((name .. " needs a type. available types: " .. view(_623_(...))))
    else
    end
    table.insert(all_lints, lint)
    for i = 1, select("#", lint, ...) do
      local lint0 = select(i, lint, ...)
      lint0.name = name
      if (type(lint0.type) == "table") then
        for _, t in ipairs(lint0.type) do
          table.insert(assert(lints[t], ("unknown lint type " .. t)), lint0)
        end
      else
        table.insert(assert(lints[lint0.type], ("unknown lint type " .. lint0.type)), lint0)
      end
    end
    return nil
  end
  local function _627_(server, file, symbol, definition)
    local symname = tostring(symbol)
    local or_628_ = (("_" == symname:sub(1, 1)) and ("__" ~= symname:sub(1, 2))) or ("_" == symname:sub(-1, -1))
    if not or_628_ then
      local reference = false
      for _, ref in ipairs(definition["referenced-by"]) do
        if reference then break end
        reference = ((ref["ref-type"] == "read") or (ref["ref-type"] == "mutate"))
      end
      or_628_ = reference
    end
    if not or_628_ then
      local function _629_()
        return {title = ("Replace " .. symname .. " with _" .. symname), changes = {{range = message["ast->range"](server, file, symbol), newText = ("_" .. symname)}}}
      end
      return {ast = symbol, message = ("unused definition: " .. symname), fix = _629_}
    else
      return nil
    end
  end
  add_lint("unused-definition", {["what-it-does"] = "Marks bindings that aren't read. Completely overwriting a value doesn't count\n    as reading it. A variable that starts or ends with an `_` will not trigger this\n    lint. Use this to suppress the lint.", ["why-care?"] = "Unused definitions can lead to bugs and make code harder to understand. Either\n    remove the binding, or add an `_` to the variable name.", example = "```fnl\n    (var value 100)\n    (set value 10)\n    ```\n    Instead, use the value, remove it, or add `_` to the variable name.\n    ```fnl\n    (var value 100)\n    (set value 10)\n    ;; use the value\n    (print value)\n    ```", limitations = "Fennel's pattern matching macros also check for leading `_` in symbols.\n    This means that adding `_` can change the semantics of the code. In this\n    situation, the user needs to add the `_` to the **end** of the symbol\n    to disable only the lint, without changing the pattern's meaning.\n    Only use a trailing underscore when it's required to prevent code from\n    changing meaning.\n    ```fnl\n    ;; Original. Works, but `b` is flagged by the lint\n    (match [10 nil]\n      [a b] (print a \"unintended\")\n      _ (print \"we want this one\")) ;; Prints this one!\n\n    ;; Suppressing lint normally causes problems\n    (match [10 nil]\n      [a _b] (print a \"unintended\") ;; Uh oh, we're printing \"unintended\" now!\n      _ (print \"we want this one\"))\n\n    ;; Solution! Underscore at the end\n    (match [10 nil]\n      [a b_] (print a \"unintended\")\n      _ (print \"we want this one\")) ;; Prints the right one\n    ```\n\n    Think of the trailing underscore as the fourth possible sigil:\n    `?identifier` - must be used, and can be `nil`\n    `identifier` - must be used, and should be non-`nil`\n    `_identifier` - may be unused, and can be `nil`\n    `identifer_` - may be unused, but should be non-`nil`", since = "0.1.0", type = "definition", impl = _627_})
  local function in_or_3f(calls, symbol)
    local in_3f = false
    for call in pairs(calls) do
      if in_3f then break end
      in_3f = (sym_3f(call[1], "or") and utils.find(call, symbol))
    end
    return in_3f
  end
  local function unknown_module_field_helper(server, file, symbol, split)
    local item = analyzer.search(server, file, symbol, {}, {split = split})
    if (item and item.indeterminate and item["module-field"] and not in_or_3f(file.calls, symbol)) then
      return {ast = symbol, message = ("unknown field: " .. table.concat(split, "."))}
    elseif (nil ~= split[2]) then
      table.remove(split)
      return unknown_module_field_helper(server, file, symbol, split)
    else
      return nil
    end
  end
  local function unknown_module_field(server, file, symbol)
    local split = utils["multi-sym-split"](symbol)
    return unknown_module_field_helper(server, file, symbol, split)
  end
  local function _632_(server, file, symbol)
    if utils["multi-sym-split"](symbol)[2] then
      return unknown_module_field(server, file, symbol)
    else
      return nil
    end
  end
  local function _634_(server, file, symbol, definition)
    if definition.keys then
      return unknown_module_field(server, file, symbol)
    else
      return nil
    end
  end
  add_lint("unknown-module-field", {["what-it-does"] = "Looks for module fields that can't be statically determined to exist. This only\n    triggers if the module is found, but there's no definition of the field inside\n    of the module.", ["why-care?"] = "This is probably a typo, or a missing function in the module.", example = "```fnl\n    ;;; in `a.fnl`\n    {: print}\n\n    ;;; in `b.fnl`\n    (local a (require :a))\n    (a.printtt 100)\n    ```\n    Instead, use:\n    ```fnl\n    ;;; in `b.fnl`\n    (local a (require :a))\n    (a.print 100) ; typo fixed\n    ```", limitations = "Fennel-ls doesn't have a full type system, so we're not able to check every\n    multisym statically, but as a heuristic, usually modules are able to be\n    evaluated statically. If you have a module that can't be figured out, please\n    let us know on the bug tracker.", since = "0.1.0", type = "reference", impl = _632_}, {type = "definition", impl = _634_})
  local function _636_(_server, _file, ast)
    local object = ast[2]
    local method = ast[3]
    if (sym_3f(ast[1], ":") and sym_3f(object) and utils["valid-sym-field?"](method)) then
      return {ast = ast, message = ("unnecessary : call: use (" .. tostring(object) .. ":" .. method .. ")")}
    else
      return nil
    end
  end
  add_lint("unnecessary-method", {["what-it-does"] = "Checks for unnecessary uses of the `:` method call syntax when a simple multisym\n    would work.", ["why-care?"] = "Using the method call syntax unnecessarily adds complexity and can make code\n    harder to understand.", example = "```fnl\n    (: alien :shoot-laser {:x 10 :y 20})\n    ```\n\n    Instead, use:\n    ```fnl\n    (alien:shoot-laser {:x 10 :y 20})\n    ```", since = "0.1.0", type = "special-call", impl = _636_})
  local function _638_(server, file, ast)
    local all_rewritable_3f
    do
      local syms = true
      for i = 3, (#ast - 1) do
        if not syms then break end
        syms = utils["valid-sym-field?"](ast[i])
      end
      all_rewritable_3f = syms
    end
    if (sym_3f(ast[1], "tset") and sym_3f(ast[2]) and all_rewritable_3f) then
      local function _639_()
        return {title = "Replace tset with set", changes = {{range = message["ast->range"](server, file, ast), newText = string.format("(set %s.%s %s)", tostring(ast[2]), table.concat(ast, ".", 3, (#ast - 1)), view(ast[#ast]))}}}
      end
      return {ast = ast, message = "unnecessary tset", fix = _639_}
    else
      return nil
    end
  end
  add_lint("unnecessary-tset", {["what-it-does"] = "Identifies unnecessary uses of `tset` when a `set` with a multisym would be clearer.", ["why-care?"] = "Using `tset` makes the code more verbose and harder to read when a simpler\n    alternative exists.", example = "```fnl\n    (tset alien :health 1337)\n    ```\n\n    Instead, use:\n    ```fnl\n    (set alien.health 1337)\n    ```", since = "0.2.0", type = "special-call", impl = _638_})
  local function _641_(server, file, ast)
    if (sym_3f(ast[1]) and redundant_wrappers[tostring(ast[1])] and (#ast == 2)) then
      local function _642_()
        return {title = "Unwrap the expression", changes = {{range = message["ast->range"](server, file, ast), newText = view(ast[2])}}}
      end
      return {ast = ast, message = ("unnecessary unary " .. tostring(ast[1])), fix = _642_}
    else
      return nil
    end
  end
  add_lint("unnecessary-unary", {["what-it-does"] = "Warns about unnecessary `do` or `values` forms that only contain a single expression.", ["why-care?"] = "Extra forms that don't do anything add syntactic noise.", example = "```fnl\n    (do (print \"hello\"))\n\n    (values (+ 1 2))\n    ```\n\n    Instead, use:\n    ```fnl\n    (print \"hello\")\n\n    (+ 1 2)\n    ```", since = "0.2.0", type = "special-call", impl = _641_})
  local function _644_(server, file, ast)
    local and_645_ = ((_G.type(ast) == "table") and (nil ~= ast[1]))
    if and_645_ then
      local do_2a = ast[1]
      local body = {select(2, (table.unpack or _G.unpack)(ast))}
      and_645_ = (sym_3f(do_2a, "do") and not next(body))
    end
    if and_645_ then
      local do_2a = ast[1]
      local body = {select(2, (table.unpack or _G.unpack)(ast))}
      local function _647_()
        return {title = "Remove (do)", changes = {{range = message["ast->range"](server, file, ast), newText = ""}}}
      end
      return {ast = ast, message = "remove do with no body", fix = _647_}
    else
      return nil
    end
  end
  add_lint("empty-do", {["what-it-does"] = "Warns about `do` with no body.", ["why-care?"] = "Using `do` with no body has no effect.", example = "```fnl\n    (do)\n    ```\n\n    Instead, use:\n    ```fnl\n    ;; nothing\n    ```", since = "0.2.2", type = "special-call", impl = _644_})
  local function _649_(server, file, ast)
    local last_body = ast[#ast]
    if (implicit_do_forms[tostring(ast[1])] and list_3f(last_body) and sym_3f(last_body[1], "do")) then
      local function _650_()
        local _651_
        do
          local tbl_26_ = {}
          local i_27_ = 0
          for i = 2, #last_body do
            local val_28_ = view(last_body[i])
            if (nil ~= val_28_) then
              i_27_ = (i_27_ + 1)
              tbl_26_[i_27_] = val_28_
            else
            end
          end
          _651_ = tbl_26_
        end
        return {title = "Unwrap the expression", changes = {{range = message["ast->range"](server, file, last_body), newText = table.concat(_651_, " ")}}}
      end
      return {ast = last_body, message = "redundant do", fix = _650_}
    else
      return nil
    end
  end
  add_lint("redundant-do", {["what-it-does"] = "Identifies redundant `do` blocks within implicit do forms like `fn`, `let`, etc.", ["why-care?"] = "Redundant `do` blocks add unnecessary nesting and make code harder to read.", example = "```fnl\n    (fn [] (do\n      (print \"first\")\n      (print \"second\")))\n    ```\n\n    Instead, use:\n    ```fnl\n    (fn []\n      (print \"first\")\n      (print \"second\"))\n    ```", since = "0.2.0", type = "special-call", impl = _649_})
  local function _654_(server, file, call)
    local op = call[1]
    local last = call[#call]
    if (op_3f(op) and list_3f(last) and (sym_3f(last[1], "unpack") or sym_3f(last[1], "_G.unpack") or sym_3f(last[1], "table.unpack"))) then
      local _655_
      if sym_3f(op, "..") then
        local unpackme = view(last[2])
        _655_ = (" Use (table.concat " .. unpackme .. ") instead of (.. (unpack " .. unpackme .. "))")
      else
        _655_ = (" Use a loop when you have a dynamic number of " .. "arguments to (" .. tostring(op) .. ")")
      end
      local _658_
      if ((#last == 2) and sym_3f(op, "..")) then
        local function _659_()
          local function _660_()
            if (2 == #call) then
              return call
            else
              return last
            end
          end
          return {title = "Replace with a call to table.concat", changes = {{range = message["ast->range"](server, file, _660_()), newText = ("(table.concat " .. view(last[2]) .. ")")}}}
        end
        _658_ = _659_
      else
        _658_ = nil
      end
      return {ast = last, message = ("faulty unpack call: " .. tostring(op) .. " isn't variadic at runtime." .. _655_), fix = _658_}
    else
      return nil
    end
  end
  add_lint("bad-unpack", {["what-it-does"] = "Warns when `unpack` or `table.unpack` is used with operators that aren't\n    variadic at runtime.", ["why-care?"] = "Fennel operators like `+`, `*`, etc. look like they should work with `unpack`,\n    but they don't actually accept a variable number of arguments at runtime.", example = "```fnl\n    (+ 1 (unpack [2 3 4]))  ; Only adds 1 and 2\n    (.. (unpack [\"a\" \"b\" \"c\"]))  ; Only concatenates \"a\"\n    ```\n\n    Instead, use:\n    ```fnl\n    ;; For concatenation:\n    (table.concat [\"a\" \"b\" \"c\"])\n\n    ;; For other operators, use a loop:\n    (accumulate [sum 0 _ n (ipairs [1 2 3 4])]\n      (+ sum n))\n    ```", since = "0.1.0", type = "special-call", impl = _654_})
  local function _663_(_server, _file, symbol, definition)
    if (definition["var?"] and not definition["var-set"]) then
      return {ast = symbol, message = ("var is never set: " .. tostring(symbol) .. " Consider using (local) instead of (var)")}
    else
      return nil
    end
  end
  add_lint("var-never-set", {["what-it-does"] = "Identifies variables declared with `var` that are never modified with `set`.", ["why-care?"] = "If a `var` is never modified, it should be declared with `local` or `let` instead\n    for clarity.", example = "```fnl\n    (var x 10)\n    (print x)\n    ```\n\n    Instead, use:\n    ```fnl\n    (let [x 10]\n      (print x))\n    ```", since = "0.1.0", type = "definition", impl = _663_})
  local function _665_(server, file, ast)
    local op = ast[1]
    local identity = op_identity_value[tostring(op)]
    if (op_3f(op) and (1 == #ast) and (nil ~= identity)) then
      local function _666_()
        return {title = ("Replace (" .. tostring(op) .. ") with " .. view(identity)), changes = {{range = message["ast->range"](server, file, ast), newText = view(identity)}}}
      end
      return {ast = ast, message = ("write " .. view(identity) .. " instead of (" .. tostring(op) .. ")"), fix = _666_}
    else
      return nil
    end
  end
  add_lint("op-with-no-arguments", {["what-it-does"] = "Warns when an operator is called with no arguments, which can be replaced with\n    an identity value.", ["why-care?"] = "Calling operators with no arguments is less clear than using the identity value\n    directly.", example = "```fnl\n    (+)  ; Returns 0\n    (*)  ; Returns 1\n    (..)  ; Returns \"\"\n    ```\n\n    Instead, use:\n    ```fnl\n    0\n    1\n    \"\"\n    ```", limitations = "This lint isn't actually very useful.", since = "0.1.1", type = "special-call", impl = _665_})
  local function _668_(server, file, ast)
    local op = ast[1]
    if (sym_3f(op, ">") or sym_3f(op, ">=")) then
      local function _669_()
        local _670_
        do
          local new
          if sym_3f(op, ">=") then
            new = sym("<=")
          else
            new = sym("<")
          end
          local reversed
          do
            local tbl_24_ = list(new)
            for i = #ast, 2, -1 do
              local val_25_ = ast[i]
              table.insert(tbl_24_, val_25_)
            end
            reversed = tbl_24_
          end
          _670_ = view(reversed)
        end
        return {title = "Reverse the comparison", changes = {{range = message["ast->range"](server, file, ast), newText = _670_}}}
      end
      return {ast = ast, message = "Use increasing operator instead of decreasing", fix = _669_}
    else
      return nil
    end
  end
  add_lint("no-decreasing-comparison", {["what-it-does"] = "Suggests using increasing comparison operators (`<`, `<=`) instead of decreasing ones (`>`, `>=`).", ["why-care?"] = "Consistency in comparison direction makes code more readable and maintainable,\n    especially in languages with lisp syntax. You can think of `<` as a function that\n    tests if the arguments are in sorted order.", example = "```fnl\n    (> a b)\n    (>= x y z)\n    ```\n\n    Instead, use:\n    ```fnl\n    (< b a)\n    (<= z y x)\n    ```", since = "0.2.0", type = "special-call", disabled = true, impl = _668_})
  local function match_reference_3f(ast, references)
    if (nil == references) then
      _G.error("Missing argument references on /fennel-ls/src/fennel-ls/lint.fnl:501", 2)
    else
    end
    if (nil == ast) then
      _G.error("Missing argument ast on /fennel-ls/src/fennel-ls/lint.fnl:501", 2)
    else
    end
    if sym_3f(ast) then
      local t_675_ = references
      if (nil ~= t_675_) then
        t_675_ = t_675_[ast]
      else
      end
      if (nil ~= t_675_) then
        t_675_ = t_675_.target
      else
      end
      return t_675_
    elseif (table_3f(ast) or list_3f(ast)) then
      local ref = false
      for _, subast in pairs(ast) do
        if ref then break end
        ref = match_reference_3f(subast, references)
      end
      return ref
    else
      return nil
    end
  end
  local function _680_(server, _679_, ast)
    local references = _679_.references
    local file = _679_
    local and_681_ = list_3f(ast) and sym_3f(ast[1], "match")
    if and_681_ then
      local _682_
      do
        local ref = false
        for i = 3, #ast, 2 do
          if ref then break end
          ref = match_reference_3f(ast[i], references)
        end
        _682_ = ref
      end
      and_681_ = not _682_
    end
    if and_681_ then
      local function _683_()
        return {title = "Replace match with case", changes = {{range = message["ast->range"](server, file, ast[1]), newText = "case"}}}
      end
      return {ast = ast[1], message = "no pinned patterns; use case instead of match", fix = _683_}
    else
      return nil
    end
  end
  add_lint("match-should-case", {["what-it-does"] = "Suggests using `case` instead of `match` when the meaning would not be altered.", ["why-care?"] = "The `match` macro's meaning depends on the local variables in scope. When a\n    `match` call doesn't use the local variables, it can be replaced with the\n    `case` form.", example = "```fnl\n    (match value\n      10 \"ten\"\n      20 \"twenty\"\n      _ \"other\")\n    ```\n\n    Instead, use:\n    ```fnl\n    (case value\n      10 \"ten\"\n      20 \"twenty\"\n      _ \"other\")\n    ```", since = "0.2.0", type = "macro-call", impl = _680_})
  local function _685_(_server, _file, ast)
    local f = nil
    for index = 2, #ast do
      if f then break end
      local arg = ast[index]
      if ((op_3f(ast[1]) or not special_3f(ast[1])) and (index ~= #ast) and list_3f(arg) and (sym_3f(arg[1], "values") or sym_3f(arg[1], "unpack") or sym_3f(arg[1], "_G.unpack") or sym_3f(arg[1], "table.unpack"))) then
        f = {ast = arg, message = ("bad " .. tostring(arg[1]) .. " call: only the first value of the multival will be used")}
      else
        f = nil
      end
    end
    return f
  end
  add_lint("inline-unpack", {["what-it-does"] = "Warns when multiple values from `values` or `unpack` are used in a non-final\n    position of a function call, where only the first value will be used.", ["why-care?"] = "In Fennel (and Lua), multiple values are only preserved when they appear in the\n    final position of a function call. Using them elsewhere results in only the\n    first value being used. This is likely not what was intended, since the use of\n    `values` or `unpack` seems to imply that the code is interested in handling\n    multivals instead of discarding them.", example = "```fnl\n    (print (values 1 2 3) 4)  ; confusingly prints \"1   4\"\n    ```\n\n    Instead, use:\n    ```fnl\n    ;; Try putting the multival at the end:\n    (print 4 (values 1 2 3))\n\n    ;; Try writing the logic out manually instead of using multival\n    (let [(a b c) (values 1 2 3)]\n      (print a b c 4)\n    ```", limitations = "It doesn't make sense to flag *all* places where a multival is discarded, because\n    discarding extra values is common in Lua. For example, in the standard library\n    of Lua, `string.gsub` and `require` actually return two results, even though\n    most of the time, only the first one is what's wanted.\n\n    This lint specifically flags discarding multivals from `values` and `unpack`,\n    instead of flagging all discards, because these forms indicate that the user\n    *intends* for something to happen with multivals.\n\n    You find more information about Lua's multivals in [Benaiah's excellent post explaining Lua's multivals](https://benaiah.me/posts/everything-you-didnt-want-to-know-about-lua-multivals),\n    or by searching the word \"adjust\" in the [Lua Manual](https://www.lua.org/manual/5.4/manual.html#3.4.12).", since = "0.1.2", type = {"function-call", "special-call"}, impl = _685_})
  local function _687_(_server, _file, ast)
    local last = ast[#ast]
    if (ops[tostring(ast[1])] and (varg_3f(last) or call_of_3f(last, "values"))) then
      return {ast = last, message = "multiple values calling operator; only first will be used"}
    else
      return nil
    end
  end
  add_lint("operator-values", {["what-it-does"] = "Check for use of multivalues in operators that don't support them.", ["why-care?"] = "Operators in Fennel support a fixed number of operands that must\n               be known at compile-time. Passing `...` or `values` to an operator\n               will cause everything but the first to be ignored.", example = "```fnl\n    (fn extract-values [...]\n      (print (. mytbl ...)))\n    ```\n\n    Instead, use a function or loop when the number of operands is unknown.", since = "0.2.5", type = "special-call", impl = _687_})
  local function _689_(server, file, ast)
    local and_690_ = ((_G.type(ast) == "table") and (nil ~= ast[1]) and (nil ~= ast[2]))
    if and_690_ then
      local let_2a = ast[1]
      local binding = ast[2]
      and_690_ = (sym_3f(let_2a, "let") and fennel["sequence?"](binding) and (0 == #binding))
    end
    if and_690_ then
      local let_2a = ast[1]
      local binding = ast[2]
      local function _692_()
        local function _695_()
          local _let_693_ = message["ast->range"](server, file, let_2a)
          local start = _let_693_.start
          local _let_694_ = message["ast->range"](server, file, binding)
          local _end = _let_694_["end"]
          return {range = {start = start, ["end"] = _end}, newText = "do"}
        end
        return {title = "Replace (let [] ...) with (do ...)", changes = {_695_()}}
      end
      return {ast = binding, message = "use do instead of let with no bindings", fix = _692_}
    else
      return nil
    end
  end
  add_lint("empty-let", {["what-it-does"] = "Warns about `(let [] ...)` that should be `(do ...)`.", ["why-care?"] = "Using `let` with no bindings is unnecessarily verbose when `do` serves the same purpose more clearly.", example = "```fnl\n    (let []\n      (print \"hello\")\n      (print \"world\"))\n    ```\n\n    Instead, use:\n    ```fnl\n    (do\n      (print \"hello\")\n      (print \"world\"))\n    ```", since = "0.2.2", type = "special-call", impl = _689_})
  local function possibly_multival_3f(ast)
    return ((list_3f(ast) and not op_3f(ast[1]) and not sym_3f(ast[1], "not")) or varg_3f(ast))
  end
  local function _697_(server, file, ast)
    local case_698_ = analyzer.search(server, file, ast[1], {}, {})
    if ((_G.type(case_698_) == "table") and (case_698_.indeterminate == nil)) then
      local result = case_698_
      local case_699_
      do
        local t_700_ = navigate.getmetadata(server, result)
        if (nil ~= t_700_) then
          t_700_ = t_700_["fnl/arglist"]
        else
        end
        case_699_ = t_700_
      end
      if (nil ~= case_699_) then
        local signature = case_699_
        local number_of_args = (#ast - 1)
        local passes_extra_args = ((1 ~= #ast) and not special_3f(ast[1]) and not file["macro-calls"][ast] and possibly_multival_3f(ast[#ast]))
        local min_params
        if (result == docs["get-builtin"](server, "-")) then
          min_params = 1
        elseif (result == docs["get-builtin"](server, "/")) then
          min_params = 1
        elseif (result == docs["get-builtin"](server, "fn")) then
          if table_3f(ast[2]) then
            min_params = 1
          else
            min_params = 2
          end
        elseif (result == docs["get-builtin"](server, "collect")) then
          min_params = 2
        else
          local _703_
          do
            local last_required_param = nil
            for i, arg in ipairs(signature) do
              local _704_
              do
                local s = tostring(arg)
                _704_ = ((s == "...") or (s == "&"))
              end
              if _704_ then break end
              local first_char = string.sub(tostring(arg), 1, 1)
              if ((first_char ~= "?") and (first_char ~= "_")) then
                last_required_param = i
              else
                last_required_param = last_required_param
              end
            end
            _703_ = last_required_param
          end
          min_params = (_703_ or 0)
        end
        local method_call_3f = (sym_3f(ast[1]) and string.find(tostring(ast[1]), ".:"))
        local min_params0
        local _707_
        if method_call_3f then
          _707_ = 1
        else
          _707_ = 0
        end
        min_params0 = (min_params - _707_)
        if ((number_of_args < min_params0) and not passes_extra_args) then
          return {ast = ast, message = (view(ast[1]) .. " expects at least " .. min_params0 .. " argument(s); found " .. number_of_args)}
        else
          return nil
        end
      else
        return nil
      end
    else
      return nil
    end
  end
  add_lint("not-enough-arguments", {["what-it-does"] = "Checks if function calls have enough number of arguments based on the function's signature.", ["why-care?"] = "Calling functions without all the arguments fills in the extra arguments with `nil` which\n    can cause unexpected behavior. This lint helps catch these issues early.", example = "```fnl\n    (string.sub \"hello\")  ; missing required arguments\n    ```\n\n    Instead, use:\n    ```fnl\n    (string.sub \"hello\" 1)  ; provide all required arguments\n    ```", limitations = "This lint is disabled by default because it can produce false positives.\n    It assumes that all optional arguments are reliably annotated with a ? sigil,\n    and any other arguments can be assumed to be required. This is reasonably\n    accurate if the code follows Fennel conventions. Also this lint is very new and\n    may have issues, so I'd like to let people try it on their own terms before\n    enabling it by default.", since = "0.2.2", type = {"function-call", "special-call", "macro-call"}, disabled = true, impl = _697_})
  local function _712_(server, file, ast)
    local case_713_ = analyzer.search(server, file, ast[1], {}, {})
    if ((_G.type(case_713_) == "table") and (case_713_.indeterminate == nil)) then
      local result = case_713_
      local case_714_
      do
        local t_715_ = navigate.getmetadata(server, result)
        if (nil ~= t_715_) then
          t_715_ = t_715_["fnl/arglist"]
        else
        end
        case_714_ = t_715_
      end
      if (nil ~= case_714_) then
        local signature = case_714_
        local number_of_args = (#ast - 1)
        local infinite_params_3f
        local or_717_ = (result == docs["get-global"](server, nil, "assert"))
        if not or_717_ then
          local vararg = nil
          for _, arg in ipairs(signature) do
            if vararg then break end
            local s = tostring(arg)
            vararg = ((s == "...") or (s == "&"))
          end
          or_717_ = vararg
        end
        infinite_params_3f = or_717_
        local max_params
        if (result == docs["get-global"](server, nil, "table").fields.insert) then
          max_params = 3
        else
          max_params = #signature
        end
        local method_call_3f = (sym_3f(ast[1]) and string.find(tostring(ast[1]), ".:"))
        local max_params0
        local _719_
        if method_call_3f then
          _719_ = 1
        else
          _719_ = 0
        end
        max_params0 = (max_params - _719_)
        if ((max_params0 < number_of_args) and not infinite_params_3f) then
          local range_of_call = message["ast->range"](server, file, ast)
          local first_bad_argument = ast[(2 + max_params0)]
          local _3frange_of_first_bad_argument = message["ast->range"](server, file, first_bad_argument)
          local range
          local _722_
          do
            local t_721_ = _3frange_of_first_bad_argument
            if (nil ~= t_721_) then
              t_721_ = t_721_.start
            else
            end
            _722_ = t_721_
          end
          range = {start = (_722_ or range_of_call.start), ["end"] = range_of_call["end"]}
          local _724_
          if (max_params0 == -1) then
            _724_ = (view(ast[1]):gsub(":", ".") .. " expects 0 arguments; found 1")
          else
            _724_ = (view(ast[1]) .. " expects at most " .. max_params0 .. " argument(s); found " .. number_of_args)
          end
          return {range = range, message = _724_}
        else
          return nil
        end
      else
        return nil
      end
    else
      return nil
    end
  end
  add_lint("too-many-arguments", {["what-it-does"] = "Checks if function calls have the correct number of arguments based on the function's signature.", ["why-care?"] = "Calling functions with the wrong number of arguments can lead to runtime errors\n    or unexpected behavior. This lint helps catch these issues early.", example = "```fnl\n    (string.sub \"hello\" 1 2 3) ; too many arguments\n\n    (assert (< x y)\n            (.. \"x=\"\n                (tostring x)) ; mismatched parens can cause too many arguments to a function\n                \" is less than y=\"\n                (tostring y))\n    ```\n\n    Instead, use:\n    ```fnl\n    (string.sub \"hello\" 1 2) ; remove extra arguments\n\n    (assert (< x y)\n            (.. \"x=\"\n                (tostring x)\n                \" is less than y=\"\n                (tostring y))) ; fixed parens\n    ```", since = "0.2.2", type = {"function-call", "special-call", "macro-call"}, impl = _712_})
  local function _729_(_server, file, emit_lint)
    local seen = {}
    for ast in pairs(file.lexical) do
      if table_3f(ast) then
        local case_730_ = getmetatable(ast)
        if ((_G.type(case_730_) == "table") and (nil ~= case_730_.keys)) then
          local keys = case_730_.keys
          local dkey
          do
            local _ = 1
            for i, v in ipairs(keys) do
              if seen[v] then break end
              seen[v] = i
              _ = (i + 1)
            end
            dkey = _
          end
          if keys[dkey] then
            emit_lint({ast = ast, message = ("key " .. tostring(keys[dkey]) .. " appears more than once")})
          else
          end
          for k in pairs(seen) do
            seen[k] = nil
          end
        else
        end
      else
      end
    end
    return nil
  end
  add_lint("duplicate-table-keys", {["what-it-does"] = "Detects when the same key appears multiple times in a table literal.", ["why-care?"] = "Duplicate keys in a table are usually a mistake and the later value will\n    overwrite the earlier one, which can lead to bugs.", example = "```fnl\n    {:name \"Alice\"\n     :age 25\n     :name \"Bob\"}  ; \"Alice\" gets overwritten by \"Bob\"\n    ```\n\n    Instead, use:\n    ```fnl\n    {:name \"Bob\"\n     :age 25}\n    ```", since = "0.2.2", type = "other", impl = _729_})
  local function _735_(_server, _file, _734_)
    local callee = _734_[1]
    local tbl = _734_[2]
    local key = _734_[3]
    local ast = _734_
    if (sym_3f(callee, ".") and (0 == key) and not sym_3f(tbl, "arg")) then
      return {message = "indexing a table with 0; did you forget that Lua is 1-indexed?", ast = ast}
    else
      return nil
    end
  end
  add_lint("zero-indexed", {["what-it-does"] = "Checks for accidentally treating tables as zero-indexed.", ["why-care?"] = "For new Fennel learners, this is a common mistake.", example = "```fnl\n    (print (. inputs 0))\n    ```", since = "0.2.2", type = "special-call", disabled = true, impl = _735_})
  local function _737_(server, file, emit_lint)
    for _, _738_ in ipairs(file["multi-binds"]) do
      local left = _738_.left
      local right = _738_.right
      if (list_3f(left) and file.lexical[left]) then
        local function _739_()
          return {title = "Replace legacy multival destructure with table.", changes = {{range = message["ast->range"](server, file, left), newText = tostring(left):gsub("^%(", "["):gsub("%)$", "]")}, {range = message["ast->range"](server, file, right), newText = ("[" .. tostring(right) .. "]")}}}
        end
        emit_lint({message = "Legacy multival destructure can be replaced with table destructure.", ast = left, fix = _739_})
      else
      end
    end
    return nil
  end
  add_lint("legacy-multival", {["what-it-does"] = "Detects usage of legacy (paren) multival destructuring.", ["why-care?"] = "It's more consistent to use table destructuring.", type = "other", example = "```fnl\n(let [input \"whatever\"\n      (v1 v2) (input:match \"([aeiou]).*([aeiou])\")]\n  (print :vowels v1 v2))\n```\n\nInstead, use:\n```fnl\n(let [input \"whatever\"\n      [v1 v2] [(input:match \"([aeiou]).*([aeiou])\")]]\n  (print :vowels v1 v2))\n```", since = "0.2.2", disabled = true, impl = _737_})
  local function match_call_3f(_741_)
    local callee = _741_[1]
    local ast = _741_
    local and_742_ = list_3f(ast)
    if and_742_ then
      local case_743_ = tostring(callee)
      if (case_743_ == "case") then
        and_742_ = true
      elseif (case_743_ == "match") then
        and_742_ = true
      elseif (case_743_ == "case-try") then
        and_742_ = true
      elseif (case_743_ == "match-try") then
        and_742_ = true
      else
        and_742_ = nil
      end
    end
    return and_742_
  end
  local function _750_(_server, _file, ast)
    if match_call_3f(ast) then
      local r = nil
      for i = 3, #ast, 2 do
        if r then break end
        if (list_3f(ast[i]) and not sym_3f(ast[i][1], "catch") and not sym_3f(ast[i][1], "where")) then
          r = {message = "Legacy multival destructure can be replaced with table destructure.", ast = ast[i]}
        else
          r = nil
        end
      end
      return r
    else
      return nil
    end
  end
  add_lint("legacy-multival-case", {["what-it-does"] = "Detects usage of legacy (paren) multival destructuring in pattern match.", ["why-care?"] = "It's more consistent to use table destructuring.", type = "macro-call", since = "0.2.2", disabled = true, example = "```fnl\n(case (input:match \"([aeiou]).*([aeiou])\")\n  (v1 v2) (print \"Two vowels:\" v1 v2)\n  _ (print \"Less than two\"))\n```\n\nInstead, use:\n(case [(input:match \"([aeiou]).*([aeiou])\")]\n  [v1 v2] (print \"Two vowels:\" v1 v2)\n  _ (print \"Less than two\"))\n", impl = _750_})
  local function _753_(server, file, emit_lint)
    do
      local config_module = "fennel-ls.config"
      local config = require(config_module)
      if ((file.uri == config["flsproject-path"](server)) and not file.diagnostics[1]) then
        local function _754_(_241, _242, _243)
          return emit_lint({range = (message["ast->range"](server, file, _242) or message["ast->range"](server, file, _243) or message["unknown-range"]), message = _241})
        end
        config["make-configuration"](file.ast[1], _754_)
      else
      end
    end
    return nil
  end
  add_lint("invalid-flsproject-settings", {["what-it-does"] = "Checks if the flsproject file's settings are valid.", ["why-care?"] = "Invalid settings in flsproject.fnl won't configuree fennel-ls.", example = "```fnl\n    {:fennel-macro-path \"macros/?.mfnl\"}\n    ```\n    Instead, use:\n    ```fnl\n    {:macro-path \"macros/?.mfnl\"}\n    ```", since = "0.2.2", type = "other", impl = _753_})
  local function _756_(server, file, ast)
    local op = ast[1]
    if (sym_3f(op) and associative_ops[tostring(op)]) then
      local diagnostic = nil
      for i = 2, #ast do
        if diagnostic then break end
        local arg = ast[i]
        local op_str = tostring(op)
        if (list_3f(arg) and (op == arg[1])) then
          local function _757_()
            local new_form = list(ast[1])
            for j = 2, #ast do
              local item = ast[j]
              if (list_3f(item) and sym_3f(item[1], op_str)) then
                local tbl_24_ = new_form
                for k = 2, #item do
                  local val_25_ = item[k]
                  table.insert(tbl_24_, val_25_)
                end
              else
                table.insert(new_form, item)
              end
            end
            return {title = ("Collapse all nested " .. op_str), changes = {{range = message["ast->range"](server, file, ast), newText = view(new_form)}}}
          end
          diagnostic = {range = message["ast->range"](server, file, arg), message = ("nested " .. op_str .. " can be collapsed"), fix = _757_}
        else
          diagnostic = nil
        end
      end
      return diagnostic
    else
      return nil
    end
  end
  add_lint("nested-associative-operator", {["what-it-does"] = "Identifies forms that could be written in a flatter way, like `(and foo (and bar baz))`.", ["why-care?"] = "Collapsing nested forms reduces unnecessary nesting and makes code more readable and idiomatic.", example = "```fnl\n    (and foo bar (and baz buzz) xyz)\n    (+ a (+ b c) d)\n    (or x (or y z))\n    ```\n\n    Instead, use:\n    ```fnl\n    ;; Flattened forms:\n    (and foo bar baz buzz xyz)\n    (+ a b c d)\n    (or x y z)\n    ```", since = "0.2.2", type = "special-call", impl = _756_})
  local lint_mt
  local function _762_(_761_, state)
    local self = _761_.self
    return dkjson.encode(self, state)
  end
  local function _763_(_241, _242)
    return _241.self[_242]
  end
  lint_mt = {__tojson = _762_, __index = _763_}
  local function normalize(_764_, _3flint, server, file)
    local fix = _764_.fix
    local diagnostic = _764_
    diagnostic.fix = nil
    if _3flint then
      diagnostic.code = _3flint.name
    else
    end
    if (diagnostic.severity == nil) then
      diagnostic.severity = message.severity.WARN
    else
    end
    if ((nil == diagnostic.range) and diagnostic.ast) then
      diagnostic.range = message["ast->range"](server, file, diagnostic.ast)
      diagnostic.ast = nil
    else
    end
    return setmetatable({self = diagnostic, fix = fix}, lint_mt)
  end
  local function add_lint_diagnostics(server, file)
    if (nil == file) then
      _G.error("Missing argument file on /fennel-ls/src/fennel-ls/lint.fnl:992", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/lint.fnl:992", 2)
    else
    end
    if not file.diagnostics then
      compiler.compile(server, file)
      file.diagnostics = file["compile-errors"]
      local current_lint = nil
      local function run(lint_group, ...)
        for _, lint in ipairs(lint_group) do
          if server.configuration.lints[lint.name] then
            current_lint = lint
            local case_770_ = lint.impl(...)
            if (nil ~= case_770_) then
              local diagnostic = case_770_
              table.insert(file.diagnostics, normalize(diagnostic, lint, server, file))
            else
            end
          else
          end
        end
        return nil
      end
      local function _773_(_241)
        return table.insert(file.diagnostics, normalize(_241, current_lint, server, file))
      end
      run(lints.other, server, file, _773_)
      for symbol, definition in pairs(file.definitions) do
        if file.lexical[symbol] then
          run(lints.definition, server, file, symbol, definition)
        else
        end
      end
      for symbol in pairs(file.references) do
        if file.lexical[symbol] then
          run(lints.reference, server, file, symbol)
        else
        end
      end
      for _776_ in pairs(file.calls) do
        local head = _776_[1]
        local ast = _776_
        if (file.lexical[ast] and (nil ~= head)) then
          local _777_
          if special_3f(head) then
            _777_ = lints["special-call"]
          else
            _777_ = lints["function-call"]
          end
          run(_777_, server, file, ast)
        else
        end
      end
      for ast, macroexpanded in pairs(file["macro-calls"]) do
        if file.lexical[ast] then
          run(lints["macro-call"], server, file, ast, macroexpanded)
        else
        end
      end
      return nil
    else
      return nil
    end
  end
  return {["add-lint-diagnostics"] = add_lint_diagnostics, list = all_lints, ["add-lint"] = add_lint}
end
package.preload["fennel-ls.analyzer"] = package.preload["fennel-ls.analyzer"] or function(...)
  local _local_5_ = require("fennel")
  local sym_3f = _local_5_["sym?"]
  local multi_sym_3f = _local_5_["multi-sym?"]
  local list_3f = _local_5_["list?"]
  local sequence_3f = _local_5_["sequence?"]
  local varg_3f = _local_5_["varg?"]
  local _local_75_ = require("fennel-ls.utils")
  local get_ast_info = _local_75_["get-ast-info"]
  local utils = _local_75_
  local files = require("fennel-ls.files")
  local docs = require("fennel-ls.docs")
  local compiler = require("fennel-ls.compiler")
  local search_multival = nil
  local function stack_add_keys_21(stack, _3fkeys)
    if (nil == stack) then
      _G.error("Missing argument stack on /fennel-ls/src/fennel-ls/analyzer.fnl:49", 2)
    else
    end
    if _3fkeys then
      local tbl_24_ = stack
      for i = #_3fkeys, 1, -1 do
        local val_25_ = _3fkeys[i]
        table.insert(tbl_24_, val_25_)
      end
    else
    end
    return stack
  end
  local function stack_add_split_21(stack, split)
    if (nil == split) then
      _G.error("Missing argument split on /fennel-ls/src/fennel-ls/analyzer.fnl:56", 2)
    else
    end
    if (nil == stack) then
      _G.error("Missing argument stack on /fennel-ls/src/fennel-ls/analyzer.fnl:56", 2)
    else
    end
    do
      local tbl_24_ = stack
      for i = #split, 2, -1 do
        local val_25_ = split[i]
        table.insert(tbl_24_, val_25_)
      end
    end
    return stack
  end
  local function stack_add_multisym_21(stack, symbol)
    if (nil == symbol) then
      _G.error("Missing argument symbol on /fennel-ls/src/fennel-ls/analyzer.fnl:62", 2)
    else
    end
    if (nil == stack) then
      _G.error("Missing argument stack on /fennel-ls/src/fennel-ls/analyzer.fnl:62", 2)
    else
    end
    return stack_add_split_21(stack, utils["multi-sym-split"](symbol))
  end
  local function search_document(server, document, stack, opts)
    if (nil == opts) then
      _G.error("Missing argument opts on /fennel-ls/src/fennel-ls/analyzer.fnl:66", 2)
    else
    end
    if (nil == stack) then
      _G.error("Missing argument stack on /fennel-ls/src/fennel-ls/analyzer.fnl:66", 2)
    else
    end
    if (nil == document) then
      _G.error("Missing argument document on /fennel-ls/src/fennel-ls/analyzer.fnl:66", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/analyzer.fnl:66", 2)
    else
    end
    if (0 == #stack) then
      return document
    elseif (document.fields and document.fields[stack[#stack]]) then
      return search_document(server, document.fields[table.remove(stack)], stack, opts)
    else
      local and_429_ = document.fields
      if and_429_ then
        local _431_
        do
          local t_430_ = document
          if (nil ~= t_430_) then
            t_430_ = t_430_.binding
          else
          end
          _431_ = t_430_
        end
        and_429_ = (_431_ ~= "_G")
      end
      return {indeterminate = true, ["module-field"] = (and_429_ and (1 == #stack))}
    end
  end
  local function search_val(server, file, _3fast, stack, opts)
    if (nil == opts) then
      _G.error("Missing argument opts on /fennel-ls/src/fennel-ls/analyzer.fnl:76", 2)
    else
    end
    if (nil == stack) then
      _G.error("Missing argument stack on /fennel-ls/src/fennel-ls/analyzer.fnl:76", 2)
    else
    end
    if (nil == file) then
      _G.error("Missing argument file on /fennel-ls/src/fennel-ls/analyzer.fnl:76", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/analyzer.fnl:76", 2)
    else
    end
    return search_multival(server, file, _3fast, stack, 1, opts)
  end
  local function search_definition(server, file, definition, stack, opts)
    if (nil == opts) then
      _G.error("Missing argument opts on /fennel-ls/src/fennel-ls/analyzer.fnl:80", 2)
    else
    end
    if (nil == stack) then
      _G.error("Missing argument stack on /fennel-ls/src/fennel-ls/analyzer.fnl:80", 2)
    else
    end
    if (nil == definition) then
      _G.error("Missing argument definition on /fennel-ls/src/fennel-ls/analyzer.fnl:80", 2)
    else
    end
    if (nil == file) then
      _G.error("Missing argument file on /fennel-ls/src/fennel-ls/analyzer.fnl:80", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/analyzer.fnl:80", 2)
    else
    end
    local _ = definition.binding
    local _3fdefinition = definition.definition
    local _3fkeys = definition.keys
    local _3fmultival = definition.multival
    local _3ffields = definition.fields
    if ((0 == #stack) and opts["stop-early?"]) then
      return definition
    else
      local and_443_ = (0 ~= #stack)
      if and_443_ then
        local t_444_ = _3ffields
        if (nil ~= t_444_) then
          t_444_ = t_444_[stack[#stack]]
        else
        end
        and_443_ = t_444_
      end
      if and_443_ then
        return search_definition(server, file, _3ffields[table.remove(stack)], stack, opts)
      else
        local and_446_ = not list_3f(_3fdefinition) and not varg_3f(_3fdefinition) and (1 == (1 or _3fmultival)) and not sym_3f(_3fdefinition) and (0 == #stack)
        if and_446_ then
          local _448_
          do
            local t_447_ = _3fkeys
            if (nil ~= t_447_) then
              t_447_ = t_447_[1]
            else
            end
            _448_ = t_447_
          end
          and_446_ = (nil == _448_)
        end
        if and_446_ then
          return definition
        else
          return search_multival(server, file, _3fdefinition, stack_add_keys_21(stack, _3fkeys), (_3fmultival or 1), opts)
        end
      end
    end
  end
  local function search_reference(server, file, ref, stack, opts)
    if (nil == opts) then
      _G.error("Missing argument opts on /fennel-ls/src/fennel-ls/analyzer.fnl:109", 2)
    else
    end
    if (nil == stack) then
      _G.error("Missing argument stack on /fennel-ls/src/fennel-ls/analyzer.fnl:109", 2)
    else
    end
    if (nil == ref) then
      _G.error("Missing argument ref on /fennel-ls/src/fennel-ls/analyzer.fnl:109", 2)
    else
    end
    if (nil == file) then
      _G.error("Missing argument file on /fennel-ls/src/fennel-ls/analyzer.fnl:109", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/analyzer.fnl:109", 2)
    else
    end
    if ref.target.metadata then
      return search_document(server, ref.target, stack, opts)
    elseif ref.target.binding then
      return search_definition(server, file, ref.target, stack, opts)
    else
      return nil
    end
  end
  local function search_symbol(server, file, symbol, stack, opts)
    if (nil == opts) then
      _G.error("Missing argument opts on /fennel-ls/src/fennel-ls/analyzer.fnl:115", 2)
    else
    end
    if (nil == stack) then
      _G.error("Missing argument stack on /fennel-ls/src/fennel-ls/analyzer.fnl:115", 2)
    else
    end
    if (nil == symbol) then
      _G.error("Missing argument symbol on /fennel-ls/src/fennel-ls/analyzer.fnl:115", 2)
    else
    end
    if (nil == file) then
      _G.error("Missing argument file on /fennel-ls/src/fennel-ls/analyzer.fnl:115", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/analyzer.fnl:115", 2)
    else
    end
    if (tostring(symbol) == "nil") then
      if (0 == #stack) then
        return {definition = symbol, file = file}
      else
        return nil
      end
    elseif file.references[symbol] then
      return search_reference(server, file, file.references[symbol], stack_add_multisym_21(stack, symbol), opts)
    else
      return nil
    end
  end
  local function search_table(server, file, tbl, stack, opts)
    if (nil == opts) then
      _G.error("Missing argument opts on /fennel-ls/src/fennel-ls/analyzer.fnl:123", 2)
    else
    end
    if (nil == stack) then
      _G.error("Missing argument stack on /fennel-ls/src/fennel-ls/analyzer.fnl:123", 2)
    else
    end
    if (nil == tbl) then
      _G.error("Missing argument tbl on /fennel-ls/src/fennel-ls/analyzer.fnl:123", 2)
    else
    end
    if (nil == file) then
      _G.error("Missing argument file on /fennel-ls/src/fennel-ls/analyzer.fnl:123", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/analyzer.fnl:123", 2)
    else
    end
    local key = table.remove(stack)
    local case_469_ = tbl[key]
    if (nil ~= case_469_) then
      local ast = case_469_
      return search_val(server, file, ast, stack, opts)
    elseif (case_469_ == nil) then
      return {indeterminate = true, ["module-field"] = ((#stack == 0) and (tbl == file.module))}
    else
      return nil
    end
  end
  local function search_list(server, file, call, stack, multival, opts)
    if (nil == opts) then
      _G.error("Missing argument opts on /fennel-ls/src/fennel-ls/analyzer.fnl:131", 2)
    else
    end
    if (nil == multival) then
      _G.error("Missing argument multival on /fennel-ls/src/fennel-ls/analyzer.fnl:131", 2)
    else
    end
    if (nil == stack) then
      _G.error("Missing argument stack on /fennel-ls/src/fennel-ls/analyzer.fnl:131", 2)
    else
    end
    if (nil == call) then
      _G.error("Missing argument call on /fennel-ls/src/fennel-ls/analyzer.fnl:131", 2)
    else
    end
    if (nil == file) then
      _G.error("Missing argument file on /fennel-ls/src/fennel-ls/analyzer.fnl:131", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/analyzer.fnl:131", 2)
    else
    end
    local head = call[1]
    if sym_3f(head) then
      local case_477_ = tostring(head)
      if ((case_477_ == "do") or (case_477_ == "let")) then
        return search_multival(server, file, call[#call], stack, multival, opts)
      elseif (case_477_ == "values") then
        local len = (#call - 1)
        if (multival < len) then
          return search_val(server, file, call[(1 + multival)], stack, opts)
        else
          return search_multival(server, file, call[(len + 1)], stack, (multival + ( - len) + 1), opts)
        end
      elseif ((case_477_ == "require") or (case_477_ == "include")) then
        local mod = call[2]
        if ((multival == 1) and ("string" == type(mod))) then
          local case_479_ = files["get-by-module"](server, mod, file["macro-file?"])
          if (nil ~= case_479_) then
            local newfile = case_479_
            compiler.compile(server, newfile)
            local newitem = newfile.ast[#newfile.ast]
            return search_val(server, newfile, newitem, stack, opts)
          else
            local _ = case_479_
            return {indeterminate = true}
          end
        else
          return nil
        end
      elseif (case_477_ == ".") then
        if (multival == 1) then
          local _ = call[1]
          local rest = (function (t, k) return ((getmetatable(t) or {}).__fennelrest or function (t, k) return {(table.unpack or unpack)(t, k)} end)(t, k) end)(call, 2)
          return search_val(server, file, call[2], stack_add_split_21(stack, rest), opts)
        else
          return nil
        end
      elseif (case_477_ == "setmetatable") then
        return search_val(server, file, call[2], stack, opts)
      elseif ((case_477_ == "fn") or (case_477_ == "lambda") or (case_477_ == "\206\187") or (case_477_ == "hashfn")) then
        if ((multival == 1) and (0 == #stack)) then
          return {definition = call, file = file}
        else
          return nil
        end
      else
        local _ = case_477_
        local case_484_ = file["macro-calls"][call]
        if (nil ~= case_484_) then
          local macroexpanded = case_484_
          return search_multival(server, file, macroexpanded, stack, multival, opts)
        else
          local _0 = case_484_
          local case_485_ = search_val(server, file, call[1], {}, {})
          local and_486_ = ((_G.type(case_485_) == "table") and (nil ~= case_485_.definition) and (nil ~= case_485_.file))
          if and_486_ then
            local definition = case_485_.definition
            local file0 = case_485_.file
            local and_488_ = list_3f(definition)
            if and_488_ then
              local head0 = definition[1]
              and_488_ = (sym_3f(head0, "fn") or sym_3f(head0, "lambda") or sym_3f(head0, "\206\187") or sym_3f(head0, "hashfn"))
            end
            and_486_ = and_488_
          end
          if and_486_ then
            local definition = case_485_.definition
            local file0 = case_485_.file
            return search_multival(server, file0, definition[#definition], stack, multival, opts)
          elseif (nil ~= case_485_) then
            local result_ = case_485_
            return {indeterminate = true}
          else
            local _1 = case_485_
            local case_490_ = docs["get-builtin"](server, tostring(call[1]))
            if ((_G.type(case_490_) == "table") and (nil ~= case_490_.metadata)) then
              local metadata_ = case_490_.metadata
              return {indeterminate = true}
            else
              return nil
            end
          end
        end
      end
    else
      return nil
    end
  end
  local function _496_(server, file, _3fast, stack, multival, opts)
    if (nil == opts) then
      _G.error("Missing argument opts on /fennel-ls/src/fennel-ls/analyzer.fnl:183", 2)
    else
    end
    if (nil == multival) then
      _G.error("Missing argument multival on /fennel-ls/src/fennel-ls/analyzer.fnl:183", 2)
    else
    end
    if (nil == stack) then
      _G.error("Missing argument stack on /fennel-ls/src/fennel-ls/analyzer.fnl:183", 2)
    else
    end
    if (nil == file) then
      _G.error("Missing argument file on /fennel-ls/src/fennel-ls/analyzer.fnl:183", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/analyzer.fnl:183", 2)
    else
    end
    local ast = _3fast
    if list_3f(ast) then
      return search_list(server, file, ast, stack, multival, opts)
    elseif varg_3f(ast) then
      return nil
    elseif (1 == multival) then
      if sym_3f(ast) then
        return search_symbol(server, file, ast, stack, opts)
      elseif (0 == #stack) then
        return {definition = ast, file = file}
      elseif ("table" == type(ast)) then
        return search_table(server, file, ast, stack, opts)
      elseif ("string" == type(ast)) then
        return search_document(server, docs["get-global"](server, nil, "string"), stack, opts)
      else
        return nil
      end
    else
      return nil
    end
  end
  search_multival = _496_
  local _local_504_ = require("fennel.compiler")
  local METADATA = _local_504_.metadata
  local function search(server, file, ast, opts, initialization_opts)
    if (nil == initialization_opts) then
      _G.error("Missing argument initialization-opts on /fennel-ls/src/fennel-ls/analyzer.fnl:197", 2)
    else
    end
    if (nil == opts) then
      _G.error("Missing argument opts on /fennel-ls/src/fennel-ls/analyzer.fnl:197", 2)
    else
    end
    if (nil == ast) then
      _G.error("Missing argument ast on /fennel-ls/src/fennel-ls/analyzer.fnl:197", 2)
    else
    end
    if (nil == file) then
      _G.error("Missing argument file on /fennel-ls/src/fennel-ls/analyzer.fnl:197", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/analyzer.fnl:197", 2)
    else
    end
    assert((type(initialization_opts) == "table"))
    if sym_3f(ast) then
      local stack
      do
        local _3fbyte = initialization_opts.byte
        local split
        local or_510_ = initialization_opts.split
        if not or_510_ then
          local function _511_()
            if _3fbyte then
              return (_3fbyte - ast.bytestart)
            else
              return nil
            end
          end
          or_510_ = utils["multi-sym-split"](ast, _511_())
        end
        split = or_510_
        stack = stack_add_split_21((initialization_opts.stack or {}), split)
      end
      local case_512_ = docs["get-builtin"](server, utils["multi-sym-base"](ast))
      if (nil ~= case_512_) then
        local document = case_512_
        return search_document(server, document, stack, opts)
      else
        local _ = case_512_
        local case_513_ = file["macro-refs"][ast]
        if (nil ~= case_513_) then
          local ref = case_513_
          return {binding = ast, metadata = METADATA[ref]}
        else
          local _0 = case_513_
          local case_514_ = file.references[ast]
          if (nil ~= case_514_) then
            local ref = case_514_
            return search_reference(server, file, ref, stack, opts)
          else
            local _1 = case_514_
            local case_515_ = file.definitions[ast]
            if (nil ~= case_515_) then
              local def = case_515_
              return search_multival(server, file, def.definition, stack_add_keys_21(stack, def.keys), (def.multival or 1), opts)
            else
              return nil
            end
          end
        end
      end
    else
      return search_val(server, file, ast, (initialization_opts.stack or {}), opts)
    end
  end
  local function find_local_definition(file, name, _3fscope)
    if (nil == name) then
      _G.error("Missing argument name on /fennel-ls/src/fennel-ls/analyzer.fnl:228", 2)
    else
    end
    if (nil == file) then
      _G.error("Missing argument file on /fennel-ls/src/fennel-ls/analyzer.fnl:228", 2)
    else
    end
    if _3fscope then
      local case_523_ = file["definitions-by-scope"][_3fscope][name]
      if (nil ~= case_523_) then
        local definition = case_523_
        return definition
      else
        local _ = case_523_
        return find_local_definition(file, name, _3fscope.parent)
      end
    else
      return nil
    end
  end
  local function search_name_and_scope(server, file, name, scope, _3fopts)
    if (nil == scope) then
      _G.error("Missing argument scope on /fennel-ls/src/fennel-ls/analyzer.fnl:234", 2)
    else
    end
    if (nil == name) then
      _G.error("Missing argument name on /fennel-ls/src/fennel-ls/analyzer.fnl:234", 2)
    else
    end
    if (nil == file) then
      _G.error("Missing argument file on /fennel-ls/src/fennel-ls/analyzer.fnl:234", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/analyzer.fnl:234", 2)
    else
    end
    assert((type(name) == "string"), "search-name-and-scope needs a string")
    local split = utils["multi-sym-split"](name)
    local stack = stack_add_split_21({}, split)
    local base_name = split[1]
    local opts = (_3fopts or {})
    local case_530_ = docs["get-builtin"](server, base_name)
    if (nil ~= case_530_) then
      local metadata = case_530_
      return search_document(server, metadata, stack, opts)
    else
      local _ = case_530_
      local case_531_ = find_local_definition(file, base_name, scope)
      if (nil ~= case_531_) then
        local def = case_531_
        return search_definition(server, file, def, stack, opts)
      else
        local _0 = case_531_
        local case_532_ = docs["get-global"](server, scope, base_name)
        if (nil ~= case_532_) then
          local metadata = case_532_
          return search_document(server, metadata, stack, opts)
        else
          return nil
        end
      end
    end
  end
  local function past_3f(_3fast, byte)
    if (nil == byte) then
      _G.error("Missing argument byte on /fennel-ls/src/fennel-ls/analyzer.fnl:248", 2)
    else
    end
    return ((type(_3fast) == "table") and get_ast_info(_3fast, "byteend") and (get_ast_info(_3fast, "byteend") < byte))
  end
  local function contains_3f(_3fast, byte)
    if (nil == byte) then
      _G.error("Missing argument byte on /fennel-ls/src/fennel-ls/analyzer.fnl:254", 2)
    else
    end
    return ((type(_3fast) == "table") and get_ast_info(_3fast, "bytestart") and get_ast_info(_3fast, "byteend") and ((get_ast_info(_3fast, "bytestart") <= byte) and (byte <= (1 + utils["get-ast-info"](_3fast, "byteend")))))
  end
  local function _does_not_contain_3f(_3fast, byte)
    if (nil == byte) then
      _G.error("Missing argument byte on /fennel-ls/src/fennel-ls/analyzer.fnl:263", 2)
    else
    end
    return ((type(_3fast) == "table") and get_ast_info(_3fast, "bytestart") and get_ast_info(_3fast, "byteend") and not ((get_ast_info(_3fast, "bytestart") <= byte) and (byte <= (1 + get_ast_info(_3fast, "byteend")))))
  end
  local function find_symbol(server, file, byte)
    if (nil == byte) then
      _G.error("Missing argument byte on /fennel-ls/src/fennel-ls/analyzer.fnl:273", 2)
    else
    end
    if (nil == file) then
      _G.error("Missing argument file on /fennel-ls/src/fennel-ls/analyzer.fnl:273", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/analyzer.fnl:273", 2)
    else
    end
    compiler.compile(server, file)
    local parents = {file.ast}
    local function recurse(ast)
      if (nil == ast) then
        _G.error("Missing argument ast on /fennel-ls/src/fennel-ls/analyzer.fnl:277", 2)
      else
      end
      if sym_3f(ast) then
        return ast, parents
      else
        table.insert(parents, ast)
        if (sequence_3f(ast) or list_3f(ast)) then
          local result, _parent = nil
          for _, child in ipairs(ast) do
            if result then break end
            if contains_3f(child, byte) then
              result, _parent = recurse(child)
            else
              result, _parent = nil
            end
          end
          return result, _parent
        elseif (not sym_3f(ast) and not varg_3f(ast)) then
          local result, _parent = nil
          for key, value in pairs(ast) do
            if result then break end
            if contains_3f(key, byte) then
              result, _parent = recurse(key)
            elseif contains_3f(value, byte) then
              result, _parent = recurse(value)
            else
              result, _parent = nil
            end
          end
          return result, _parent
        else
          return nil
        end
      end
    end
    local _547_
    do
      local result = nil
      for _, top_level_form in ipairs(file.ast) do
        if result then break end
        if contains_3f(top_level_form, byte) then
          result = recurse(top_level_form)
        else
          result = nil
        end
      end
      _547_ = result
    end
    local function _549_()
      local tbl_26_ = {}
      local i_27_ = 0
      for i = 1, #parents do
        local val_28_ = parents[(#parents - i - -1)]
        if (nil ~= val_28_) then
          i_27_ = (i_27_ + 1)
          tbl_26_[i_27_] = val_28_
        else
        end
      end
      return tbl_26_
    end
    return _547_, _549_()
  end
  local function find_document_symbols(server, file)
    if (nil == file) then
      _G.error("Missing argument file on /fennel-ls/src/fennel-ls/analyzer.fnl:305", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/analyzer.fnl:305", 2)
    else
    end
    compiler.compile(server, file)
    local symbols = {}
    for symbol, definition in pairs(file.definitions) do
      if ((sym_3f(symbol) or multi_sym_3f(symbol)) and definition.binding and file.lexical[symbol] and not (tostring(symbol) == "_")) then
        table.insert(symbols, {symbol = symbol, definition = definition})
      else
      end
      if definition.fields then
        for _field_name, field_definition in pairs(definition.fields) do
          if (field_definition.binding and (sym_3f(field_definition.binding) or multi_sym_3f(field_definition.binding))) then
            table.insert(symbols, {symbol = field_definition.binding, definition = field_definition})
          else
          end
        end
      else
      end
    end
    return symbols
  end
  local function find_nearest_call(server, file, byte)
    if (nil == byte) then
      _G.error("Missing argument byte on /fennel-ls/src/fennel-ls/analyzer.fnl:328", 2)
    else
    end
    if (nil == file) then
      _G.error("Missing argument file on /fennel-ls/src/fennel-ls/analyzer.fnl:328", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/analyzer.fnl:328", 2)
    else
    end
    local function _559_(...)
      local case_560_, case_561_ = ...
      if (true and (nil ~= case_561_)) then
        local _symbol = case_560_
        local parents = case_561_
        local function _562_(...)
          local case_563_ = ...
          if ((_G.type(case_563_) == "table") and (nil ~= case_563_[1])) then
            local callee = case_563_[1]
            local call = case_563_
            local function _564_(...)
              local index = nil
              for i = #call, 1, -1 do
                if index then break end
                if contains_3f(call[i], byte) then
                  index = (i - 2)
                elseif past_3f(call[i], byte) then
                  index = (i - 1)
                else
                  index = nil
                end
              end
              return index
            end
            return callee, _564_(...)
          else
            local _ = case_563_
            return nil
          end
        end
        local function _567_(...)
          local result = nil
          for _, v in ipairs(parents) do
            if result then break end
            if file.calls[v] then
              result = v
            else
              result = nil
            end
          end
          return result
        end
        return _562_(_567_(...))
      else
        local _ = case_560_
        return nil
      end
    end
    return _559_(find_symbol(server, file, byte))
  end
  local function find_definition(server, file, symbol, _3fbyte)
    if (nil == symbol) then
      _G.error("Missing argument symbol on /fennel-ls/src/fennel-ls/analyzer.fnl:352", 2)
    else
    end
    if (nil == file) then
      _G.error("Missing argument file on /fennel-ls/src/fennel-ls/analyzer.fnl:352", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/analyzer.fnl:352", 2)
    else
    end
    return (file.definitions[symbol] or search(server, file, symbol, {["stop-early?"] = false}, {byte = _3fbyte}))
  end
  local function find_nearest_definition(server, file, symbol, _3fbyte)
    if (nil == symbol) then
      _G.error("Missing argument symbol on /fennel-ls/src/fennel-ls/analyzer.fnl:356", 2)
    else
    end
    if (nil == file) then
      _G.error("Missing argument file on /fennel-ls/src/fennel-ls/analyzer.fnl:356", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/analyzer.fnl:356", 2)
    else
    end
    return (file.definitions[symbol] or search(server, file, symbol, {["stop-early?"] = true}, {byte = _3fbyte}))
  end
  return {["find-symbol"] = find_symbol, ["find-document-symbols"] = find_document_symbols, ["find-nearest-call"] = find_nearest_call, ["find-nearest-definition"] = find_nearest_definition, ["find-definition"] = find_definition, search = search, ["search-name-and-scope"] = search_name_and_scope}
end
package.preload["fennel-ls.utils"] = package.preload["fennel-ls.utils"] or function(...)
  local version = "0.2.5-dev"
  local function next_line(str, _3ffrom)
    if (nil == str) then
      _G.error("Missing argument str on /fennel-ls/src/fennel-ls/utils.fnl:8", 2)
    else
    end
    local from = (_3ffrom or 1)
    local case_7_ = str:find("[\r\n]", from)
    if (nil ~= case_7_) then
      local i = case_7_
      return (i + #str:match("\r?\n?", i))
    elseif (case_7_ == nil) then
      return nil
    else
      return nil
    end
  end
  local function next_lines(str, nlines, _3ffrom)
    if (nil == nlines) then
      _G.error("Missing argument nlines on /fennel-ls/src/fennel-ls/utils.fnl:15", 2)
    else
    end
    if (nil == str) then
      _G.error("Missing argument str on /fennel-ls/src/fennel-ls/utils.fnl:15", 2)
    else
    end
    local from = (_3ffrom or 1)
    for _ = 1, nlines do
      from = next_line(str, from)
    end
    return from
  end
  local function utf(byte)
    if ((0 <= byte) and (byte <= 128)) then
      return 1, 1
    elseif ((192 <= byte) and (byte <= 223)) then
      return 2, 1
    elseif ((224 <= byte) and (byte <= 239)) then
      return 3, 1
    elseif ((240 <= byte) and (byte <= 247)) then
      return 4, 2
    else
      return error("utf8-error")
    end
  end
  local function byte__3eunit16(str, byte)
    local unit8 = byte
    local o8 = 0
    local o16 = 0
    while (o8 < unit8) do
      local a8, a16 = utf(str:byte((1 + o8)))
      o8 = (o8 + a8)
      o16 = (o16 + a16)
    end
    if (o8 == unit8) then
      return o16
    else
      return error("utf8-error")
    end
  end
  local function unit16__3ebyte(str, unit16)
    local o8 = 0
    local o16 = 0
    while (o16 < unit16) do
      local a8, a16 = utf(str:byte((1 + o8)))
      o8 = (o8 + a8)
      o16 = (o16 + a16)
    end
    if (o16 == unit16) then
      return o8
    else
      return error("utf8-error")
    end
  end
  local function pos__3eposition(str, line, character, encoding)
    if (nil == encoding) then
      _G.error("Missing argument encoding on /fennel-ls/src/fennel-ls/utils.fnl:60", 2)
    else
    end
    if (nil == character) then
      _G.error("Missing argument character on /fennel-ls/src/fennel-ls/utils.fnl:60", 2)
    else
    end
    if (nil == line) then
      _G.error("Missing argument line on /fennel-ls/src/fennel-ls/utils.fnl:60", 2)
    else
    end
    if (nil == str) then
      _G.error("Missing argument str on /fennel-ls/src/fennel-ls/utils.fnl:60", 2)
    else
    end
    if (encoding == "utf-8") then
      return {line = line, character = character}
    elseif (encoding == "utf-16") then
      local pos = next_lines(str, line)
      return {line = line, character = byte__3eunit16(str:sub(pos), character)}
    else
      local _ = encoding
      return error(("unknown encoding: " .. encoding))
    end
  end
  local function byte__3eposition(str, byte, encoding)
    if (nil == encoding) then
      _G.error("Missing argument encoding on /fennel-ls/src/fennel-ls/utils.fnl:68", 2)
    else
    end
    if (nil == byte) then
      _G.error("Missing argument byte on /fennel-ls/src/fennel-ls/utils.fnl:68", 2)
    else
    end
    if (nil == str) then
      _G.error("Missing argument str on /fennel-ls/src/fennel-ls/utils.fnl:68", 2)
    else
    end
    local line = 0
    local pos = 1
    while true do
      local _22_
      do
        local npos = next_line(str, pos)
        if (npos and (npos <= byte)) then
          pos = npos
          line = (line + 1)
          _22_ = true
        else
          _22_ = nil
        end
      end
      if not _22_ then break end
    end
    if (encoding == "utf-8") then
      return {line = line, character = (byte - pos)}
    elseif (encoding == "utf-16") then
      return {line = line, character = byte__3eunit16(str:sub(pos), (byte - pos))}
    else
      local _ = encoding
      return error(("unknown encoding: " .. encoding))
    end
  end
  local function byte__3echaracter(str, byte, encoding)
    if (nil == encoding) then
      _G.error("Missing argument encoding on /fennel-ls/src/fennel-ls/utils.fnl:82", 2)
    else
    end
    if (nil == byte) then
      _G.error("Missing argument byte on /fennel-ls/src/fennel-ls/utils.fnl:82", 2)
    else
    end
    if (nil == str) then
      _G.error("Missing argument str on /fennel-ls/src/fennel-ls/utils.fnl:82", 2)
    else
    end
    if (encoding == "utf-8") then
      return byte
    elseif (encoding == "utf-16") then
      return byte__3eunit16(str, byte)
    else
      local _ = encoding
      return error(("unknown encoding: " .. encoding))
    end
  end
  local function position__3ebyte(str, _29_, encoding)
    local line = _29_.line
    local character = _29_.character
    if (nil == encoding) then
      _G.error("Missing argument encoding on /fennel-ls/src/fennel-ls/utils.fnl:88", 2)
    else
    end
    if (nil == character) then
      _G.error("Missing argument character on /fennel-ls/src/fennel-ls/utils.fnl:88", 2)
    else
    end
    if (nil == line) then
      _G.error("Missing argument line on /fennel-ls/src/fennel-ls/utils.fnl:88", 2)
    else
    end
    if (nil == str) then
      _G.error("Missing argument str on /fennel-ls/src/fennel-ls/utils.fnl:88", 2)
    else
    end
    local pos = next_lines(str, line)
    assert(pos, "bad-pos")
    if (encoding == "utf-8") then
      return (pos + character)
    elseif (encoding == "utf-16") then
      return (pos + unit16__3ebyte(str:sub(pos), character))
    else
      local _ = encoding
      return error(("unknown encoding: " .. encoding))
    end
  end
  local function endswith(str, post)
    if (nil == post) then
      _G.error("Missing argument post on /fennel-ls/src/fennel-ls/utils.fnl:97", 2)
    else
    end
    if (nil == str) then
      _G.error("Missing argument str on /fennel-ls/src/fennel-ls/utils.fnl:97", 2)
    else
    end
    local len = #post
    return ((post == "") or (post == str:sub(( - len))))
  end
  local function replace(text, start_position, end_position, replacement, encoding)
    if (nil == encoding) then
      _G.error("Missing argument encoding on /fennel-ls/src/fennel-ls/utils.fnl:102", 2)
    else
    end
    if (nil == replacement) then
      _G.error("Missing argument replacement on /fennel-ls/src/fennel-ls/utils.fnl:102", 2)
    else
    end
    if (nil == end_position) then
      _G.error("Missing argument end-position on /fennel-ls/src/fennel-ls/utils.fnl:102", 2)
    else
    end
    if (nil == start_position) then
      _G.error("Missing argument start-position on /fennel-ls/src/fennel-ls/utils.fnl:102", 2)
    else
    end
    if (nil == text) then
      _G.error("Missing argument text on /fennel-ls/src/fennel-ls/utils.fnl:102", 2)
    else
    end
    local start = position__3ebyte(text, start_position, encoding)
    local _end = position__3ebyte(text, end_position, encoding)
    return (text:sub(1, (start - 1)) .. replacement .. text:sub(_end))
  end
  local function apply_changes(initial_text, changes, encoding)
    if (nil == encoding) then
      _G.error("Missing argument encoding on /fennel-ls/src/fennel-ls/utils.fnl:111", 2)
    else
    end
    if (nil == changes) then
      _G.error("Missing argument changes on /fennel-ls/src/fennel-ls/utils.fnl:111", 2)
    else
    end
    if (nil == initial_text) then
      _G.error("Missing argument initial-text on /fennel-ls/src/fennel-ls/utils.fnl:111", 2)
    else
    end
    local contents = initial_text
    for _, change in ipairs(changes) do
      if ((_G.type(change) == "table") and ((_G.type(change.range) == "table") and (nil ~= change.range.start) and (nil ~= change.range["end"])) and (nil ~= change.text)) then
        local start = change.range.start
        local _end = change.range["end"]
        local text = change.text
        contents = replace(contents, start, _end, text, encoding)
      elseif ((_G.type(change) == "table") and (nil ~= change.text)) then
        local text = change.text
        contents = text
      else
        contents = nil
      end
    end
    return contents
  end
  local function apply_edits(initial_text, edits, encoding)
    if (nil == encoding) then
      _G.error("Missing argument encoding on /fennel-ls/src/fennel-ls/utils.fnl:124", 2)
    else
    end
    if (nil == edits) then
      _G.error("Missing argument edits on /fennel-ls/src/fennel-ls/utils.fnl:124", 2)
    else
    end
    if (nil == initial_text) then
      _G.error("Missing argument initial-text on /fennel-ls/src/fennel-ls/utils.fnl:124", 2)
    else
    end
    local contents = initial_text
    for _, edit in ipairs(edits) do
      if ((_G.type(edit) == "table") and ((_G.type(edit.range) == "table") and (nil ~= edit.range.start) and (nil ~= edit.range["end"])) and (nil ~= edit.newText)) then
        local start = edit.range.start
        local _end = edit.range["end"]
        local newText = edit.newText
        contents = replace(contents, start, _end, newText, encoding)
      else
        contents = nil
      end
    end
    return contents
  end
  local function get_ast_info(ast, info)
    if (nil == info) then
      _G.error("Missing argument info on /fennel-ls/src/fennel-ls/utils.fnl:134", 2)
    else
    end
    if (nil == ast) then
      _G.error("Missing argument ast on /fennel-ls/src/fennel-ls/utils.fnl:134", 2)
    else
    end
    if ("number" == type(ast)) then
      return nil
    else
      local _53_
      do
        local t_52_ = getmetatable(ast)
        if (nil ~= t_52_) then
          t_52_ = t_52_[info]
        else
        end
        _53_ = t_52_
      end
      local or_55_ = _53_
      if not or_55_ then
        local t_56_ = ast
        if (nil ~= t_56_) then
          t_56_ = t_56_[info]
        else
        end
        or_55_ = t_56_
      end
      return or_55_
    end
  end
  local function multi_sym_split(symbol, _3foffset)
    local symbol0 = tostring(symbol)
    if (symbol0:find("^%.") or (symbol0 == ":") or (symbol0 == "?.")) then
      return {symbol0}
    else
      local offset = (_3foffset or #symbol0)
      local next_separator = (symbol0:find(".[.:]", offset) or #symbol0)
      local symbol1 = symbol0:sub(1, next_separator)
      local parts
      do
        local tbl_26_ = {}
        local i_27_ = 0
        for word in symbol1:gmatch("[^.:]+") do
          local val_28_ = word
          if (nil ~= val_28_) then
            i_27_ = (i_27_ + 1)
            tbl_26_[i_27_] = val_28_
          else
          end
        end
        parts = tbl_26_
      end
      if symbol1:match("[.:]+$") then
        parts[#parts] = (parts[#parts] .. symbol1:match("[.:]+$"))
      else
      end
      return parts
    end
  end
  local function multi_sym_base(symbol)
    local symbol0 = tostring(symbol)
    if ((symbol0 == ".") or (symbol0 == "..") or (symbol0 == "...") or (symbol0 == ":") or (symbol0 == "?.")) then
      return symbol0
    else
      return (symbol0:match("[^.:]*"))
    end
  end
  local function uniq_by(list, key_fn)
    if (nil == key_fn) then
      _G.error("Missing argument key-fn on /fennel-ls/src/fennel-ls/utils.fnl:169", 2)
    else
    end
    if (nil == list) then
      _G.error("Missing argument list on /fennel-ls/src/fennel-ls/utils.fnl:169", 2)
    else
    end
    local seen = {}
    local tbl_26_ = {}
    local i_27_ = 0
    for _, new_item in ipairs(list) do
      local val_28_
      do
        local key = key_fn(new_item)
        if not seen[key] then
          seen[key] = true
          val_28_ = new_item
        else
          val_28_ = nil
        end
      end
      if (nil ~= val_28_) then
        i_27_ = (i_27_ + 1)
        tbl_26_[i_27_] = val_28_
      else
      end
    end
    return tbl_26_
  end
  local path_sep = package.config:sub(1, 1)
  local function absolute_path_3f(path)
    if (nil == path) then
      _G.error("Missing argument path on /fennel-ls/src/fennel-ls/utils.fnl:179", 2)
    else
    end
    return (path:sub(2, 3):match(":\\") or (path:sub(1, 1) == "/"))
  end
  local function path_join(path, suffix)
    if (nil == suffix) then
      _G.error("Missing argument suffix on /fennel-ls/src/fennel-ls/utils.fnl:188", 2)
    else
    end
    if (nil == path) then
      _G.error("Missing argument path on /fennel-ls/src/fennel-ls/utils.fnl:188", 2)
    else
    end
    if absolute_path_3f(suffix) then
      return suffix
    elseif (path == "") then
      return suffix
    else
      local clean_path = path:gsub("[\\/]?$", path_sep, 1)
      local clean_suffix
      if ((suffix:sub(1, 2) == "./") or (suffix:sub(1, 2) == ".\\")) then
        clean_suffix = suffix:sub(3)
      else
        clean_suffix = suffix
      end
      return (clean_path .. clean_suffix)
    end
  end
  local function valid_sym_field_3f(str)
    return (("string" == type(str)) and not str:find("[^!#$%&*+/0-9<=>?A-Z\\^_a-z|\128-\255-]"))
  end
  local function find(t, x, _3fk)
    local case_72_, case_73_ = next(t, _3fk)
    if ((nil ~= case_72_) and (case_73_ == x)) then
      local k = case_72_
      return k
    elseif ((nil ~= case_72_) and (nil ~= case_73_)) then
      local k = case_72_
      local y_ = case_73_
      return find(t, x, k)
    else
      return nil
    end
  end
  return {version = version, ["pos->position"] = pos__3eposition, ["byte->position"] = byte__3eposition, ["byte->character"] = byte__3echaracter, ["position->byte"] = position__3ebyte, ["apply-changes"] = apply_changes, ["apply-edits"] = apply_edits, ["multi-sym-split"] = multi_sym_split, ["multi-sym-base"] = multi_sym_base, ["get-ast-info"] = get_ast_info, ["uniq-by"] = uniq_by, ["absolute-path?"] = absolute_path_3f, ["path-join"] = path_join, ["path-sep"] = path_sep, endswith = endswith, find = find, ["valid-sym-field?"] = valid_sym_field_3f}
end
package.preload["fennel-ls.files"] = package.preload["fennel-ls.files"] or function(...)
  local searcher = require("fennel-ls.searcher")
  local _local_113_ = require("fennel-ls.uri")
  local uri__3epath = _local_113_["uri->path"]
  local file_mt
  local function _114_()
    return "#<file>"
  end
  file_mt = {__fennelview = _114_}
  local function read_file(server, uri)
    if (nil == uri) then
      _G.error("Missing argument uri on /fennel-ls/src/fennel-ls/files.fnl:9", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/files.fnl:9", 2)
    else
    end
    local case_117_
    do
      local t_118_ = server.preload
      if (nil ~= t_118_) then
        t_118_ = t_118_[uri]
      else
      end
      case_117_ = t_118_
    end
    if (nil ~= case_117_) then
      local preload = case_117_
      return setmetatable({uri = uri, text = preload}, file_mt)
    else
      local _ = case_117_
      if (uri == "stdin") then
        local text = io.read("*a")
        return setmetatable({uri = uri, text = text}, file_mt)
      else
        local _0 = uri
        local case_120_ = io.open(uri__3epath(uri), "r")
        if (nil ~= case_120_) then
          local file = case_120_
          local text = file:read("*a")
          if not text then
            error(("could not read file:" .. uri__3epath(uri)))
          else
          end
          file:close()
          return setmetatable({uri = uri, text = text}, file_mt)
        else
          return nil
        end
      end
    end
  end
  local function get_by_uri(server, uri)
    if (nil == uri) then
      _G.error("Missing argument uri on /fennel-ls/src/fennel-ls/files.fnl:23", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/files.fnl:23", 2)
    else
    end
    local or_127_ = server.files[uri]
    if not or_127_ then
      local case_128_ = read_file(server, uri)
      if (nil ~= case_128_) then
        local file = case_128_
        server.files[uri] = file
        or_127_ = file
      else
        or_127_ = nil
      end
    end
    return or_127_
  end
  local function get_by_module(server, module, macro_3f)
    if (nil == macro_3f) then
      _G.error("Missing argument macro? on /fennel-ls/src/fennel-ls/files.fnl:30", 2)
    else
    end
    if (nil == module) then
      _G.error("Missing argument module on /fennel-ls/src/fennel-ls/files.fnl:30", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/files.fnl:30", 2)
    else
    end
    local modules
    if macro_3f then
      modules = server["macro-modules"]
    else
      modules = server.modules
    end
    local case_136_ = modules[module]
    if (nil ~= case_136_) then
      local uri = case_136_
      local or_137_ = get_by_uri(server, uri)
      if not or_137_ then
        modules[module] = nil
        or_137_ = get_by_module(server, module, macro_3f)
      end
      return or_137_
    elseif (case_136_ == nil) then
      local case_138_ = searcher.lookup(server, module, macro_3f)
      if (nil ~= case_138_) then
        local uri = case_138_
        modules[module] = uri
        return get_by_uri(server, uri)
      else
        return nil
      end
    else
      return nil
    end
  end
  local function set_uri_contents(server, uri, text)
    if (nil == text) then
      _G.error("Missing argument text on /fennel-ls/src/fennel-ls/files.fnl:46", 2)
    else
    end
    if (nil == uri) then
      _G.error("Missing argument uri on /fennel-ls/src/fennel-ls/files.fnl:46", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/files.fnl:46", 2)
    else
    end
    local file = {uri = uri, text = text}
    server.files[uri] = file
    return file
  end
  local function flush_uri(server, uri)
    if (nil == uri) then
      _G.error("Missing argument uri on /fennel-ls/src/fennel-ls/files.fnl:51", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/files.fnl:51", 2)
    else
    end
    server.files[uri] = nil
    return nil
  end
  return {["flush-uri"] = flush_uri, ["get-by-module"] = get_by_module, ["get-by-uri"] = get_by_uri, ["set-uri-contents"] = set_uri_contents, ["read-file"] = read_file}
end
package.preload["fennel-ls.searcher"] = package.preload["fennel-ls.searcher"] or function(...)
  local _local_76_ = require("fennel-ls.utils")
  local absolute_path_3f = _local_76_["absolute-path?"]
  local path_sep = _local_76_["path-sep"]
  local path_join = _local_76_["path-join"]
  local _local_90_ = require("fennel-ls.uri")
  local uri__3epath = _local_90_["uri->path"]
  local path__3euri = _local_90_["path->uri"]
  local function add_workspaces_to_path(path, _3fworkspaces)
    if (nil == path) then
      _G.error("Missing argument path on /fennel-ls/src/fennel-ls/searcher.fnl:11", 2)
    else
    end
    local result = {}
    for path0 in path:gmatch("[^;]+") do
      if absolute_path_3f(path0) then
        table.insert(result, path0)
      else
        local tbl_24_ = result
        for _, workspace in ipairs((_3fworkspaces or {})) do
          local val_25_ = path_join(uri__3epath(workspace), path0)
          table.insert(tbl_24_, val_25_)
        end
      end
    end
    return table.concat(result, ";")
  end
  local function file_exists_3f(server, uri)
    local _94_
    do
      local t_93_ = server.preload
      if (nil ~= t_93_) then
        t_93_ = t_93_[uri]
      else
      end
      _94_ = t_93_
    end
    local or_96_ = _94_
    if not or_96_ then
      local case_97_ = io.open(uri__3epath(uri))
      if (nil ~= case_97_) then
        local f = case_97_
        f:close()
        or_96_ = true
      else
        or_96_ = nil
      end
    end
    return or_96_
  end
  local function lookup(_101_, mod, macro_3f)
    local _arg_102_ = _101_.configuration
    local fennel_path = _arg_102_["fennel-path"]
    local macro_path = _arg_102_["macro-path"]
    local _3froot_uri = _101_["root-uri"]
    local server = _101_
    if (nil == macro_3f) then
      _G.error("Missing argument macro? on /fennel-ls/src/fennel-ls/searcher.fnl:26", 2)
    else
    end
    if (nil == mod) then
      _G.error("Missing argument mod on /fennel-ls/src/fennel-ls/searcher.fnl:26", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/searcher.fnl:26", 2)
    else
    end
    if (nil == macro_path) then
      _G.error("Missing argument macro-path on /fennel-ls/src/fennel-ls/searcher.fnl:26", 2)
    else
    end
    if (nil == fennel_path) then
      _G.error("Missing argument fennel-path on /fennel-ls/src/fennel-ls/searcher.fnl:26", 2)
    else
    end
    if _3froot_uri then
      local mod0 = mod:gsub("%.", path_sep)
      local root_path = uri__3epath(_3froot_uri)
      local uri = nil
      local _108_
      if macro_3f then
        _108_ = macro_path
      else
        _108_ = fennel_path
      end
      for segment in _108_:gmatch("[^;]+") do
        if uri then break end
        local segment0 = segment:gsub("%?", mod0)
        local segment1
        if absolute_path_3f(segment0) then
          segment1 = segment0
        else
          segment1 = path_join(root_path, segment0)
        end
        local segment2 = path__3euri(segment1)
        if file_exists_3f(server, segment2) then
          uri = segment2
        else
          uri = nil
        end
      end
      return uri
    else
      return nil
    end
  end
  return {lookup = lookup, ["add-workspaces-to-path"] = add_workspaces_to_path}
end
package.preload["fennel-ls.uri"] = package.preload["fennel-ls.uri"] or function(...)
  local _local_77_ = require("fennel")
  local view = _local_77_.view
  local windows = ("\\" == package.config:sub(1, 1))
  local function is_windows_3f(_3fopts)
    local case_78_
    do
      local t_79_ = _3fopts
      if (nil ~= t_79_) then
        t_79_ = t_79_.windows
      else
      end
      case_78_ = t_79_
    end
    if (nil ~= case_78_) then
      local override = case_78_
      return override
    else
      local _ = case_78_
      return windows
    end
  end
  local encode1
  local function _82_(_241)
    return string.format("%%%02X", string.byte(_241))
  end
  encode1 = _82_
  local function percent_encode(str)
    return (str:gsub("[^0-9a-zA-Z/._~-]", encode1))
  end
  local decode1
  local function _83_(_241)
    return string.char(tonumber(_241, 16))
  end
  decode1 = _83_
  local function percent_decode(str)
    return (str:gsub("%%(%x%x)", decode1))
  end
  local function path__3euri(path, _3fopts)
    if is_windows_3f(_3fopts) then
      return ("file:///" .. percent_encode(path:gsub("\\", "/")))
    else
      return ("file://" .. percent_encode(path))
    end
  end
  local function uri__3epath(uri, _3fopts)
    if is_windows_3f(_3fopts) then
      local case_85_ = uri:match("^file:///(.*)$")
      if (nil ~= case_85_) then
        local p = case_85_
        return (percent_decode(p):gsub("/", "\\"))
      else
        local _ = case_85_
        return error(("encountered non-file URI: " .. view(uri)))
      end
    else
      local case_87_ = uri:match("^file://(.*)$")
      if (nil ~= case_87_) then
        local p = case_87_
        return percent_decode(p)
      else
        local _ = case_87_
        return error(("encountered non-file URI: " .. view(uri)))
      end
    end
  end
  return {["path->uri"] = path__3euri, ["uri->path"] = uri__3epath}
end
package.preload["fennel-ls.docs"] = package.preload["fennel-ls.docs"] or function(...)
  local _local_146_ = require("fennel-ls.utils")
  local path_join = _local_146_["path-join"]
  local fennel = require("fennel")
  local _local_147_ = require("fennel.compiler")
  local METADATA = _local_147_.metadata
  local _local_148_ = _local_147_.scopes
  local _local_149_ = _local_148_.global
  local SPECIALS = _local_149_.specials
  local MACROS = _local_149_.macros
  local compiler_scope = _local_148_.compiler
  local docset_ext = ".lua"
  local data_dir = path_join((os.getenv("XDG_DATA_HOME") or path_join((os.getenv("HOME") or ""), ".local/share")), "fennel-ls/docsets/")
  local specials
  do
    local tbl_21_ = {}
    for name, value in pairs(SPECIALS) do
      local k_22_, v_23_ = name, {binding = name, metadata = METADATA[value]}
      if ((k_22_ ~= nil) and (v_23_ ~= nil)) then
        tbl_21_[k_22_] = v_23_
      else
      end
    end
    specials = tbl_21_
  end
  local macros_2a
  do
    local tbl_21_ = {}
    for name, value in pairs(MACROS) do
      local k_22_, v_23_ = name, {binding = name, metadata = METADATA[value]}
      if ((k_22_ ~= nil) and (v_23_ ~= nil)) then
        tbl_21_[k_22_] = v_23_
      else
      end
    end
    macros_2a = tbl_21_
  end
  local lua_versions = {["lua5.1"] = require("fennel-ls.docs.generated.lua51"), ["lua5.2"] = require("fennel-ls.docs.generated.lua52"), ["lua5.3"] = require("fennel-ls.docs.generated.lua53"), ["lua5.4"] = require("fennel-ls.docs.generated.lua54"), ["lua5.5"] = require("fennel-ls.docs.generated.lua55"), union = {}}
  lua_versions.lua51 = lua_versions["lua5.1"]
  lua_versions.lua52 = lua_versions["lua5.2"]
  lua_versions.lua53 = lua_versions["lua5.3"]
  lua_versions.lua54 = lua_versions["lua5.4"]
  lua_versions.lua55 = lua_versions["lua5.5"]
  local function get_lua_version(version)
    return (lua_versions[version] or lua_versions.lua55)
  end
  lua_versions.lua51.package.fields.config = lua_versions.lua52.package.fields.config
  for _, f in ipairs({"atan2", "cosh", "sinh", "tanh", "pow", "frexp", "ldexp"}) do
    lua_versions.lua53.math.fields[f] = lua_versions.lua52.math.fields[f]
  end
  lua_versions.lua53.bit32 = lua_versions.lua52.bit32
  for _, version in pairs(lua_versions) do
    for k, v in pairs(version) do
      lua_versions.union[k] = v
    end
  end
  do
    local tbl_21_ = {}
    for k, v in pairs(lua_versions.lua51) do
      local k_22_, v_23_
      if lua_versions.lua55[k] then
        k_22_, v_23_ = k, v
      else
        k_22_, v_23_ = nil
      end
      if ((k_22_ ~= nil) and (v_23_ ~= nil)) then
        tbl_21_[k_22_] = v_23_
      else
      end
    end
    lua_versions.intersection = tbl_21_
  end
  local libraries = {}
  local function load_library(name)
    if (nil == name) then
      _G.error("Missing argument name on /fennel-ls/src/fennel-ls/docs.fnl:67", 2)
    else
    end
    local path = (data_dir .. name .. docset_ext)
    local case_155_ = io.open(path)
    if (nil ~= case_155_) then
      local f = case_155_
      local docs = fennel["load-code"](f:read("*all"), {})
      f:close()
      return docs()
    else
      local _ = case_155_
      return {status = "not-found", msg = string.format("Could not find docset for library %s at %s\nSee %s", name, path, "https://dev.fennel-lang.org/wiki/LanguageServer")}
    end
  end
  local function get_library(name)
    if (nil == name) then
      _G.error("Missing argument name on /fennel-ls/src/fennel-ls/docs.fnl:78", 2)
    else
    end
    if not libraries[name] then
      local docs = load_library(name)
      libraries[name] = docs
    else
    end
    return libraries[name]
  end
  local function get_all_globals(server)
    local result = {}
    for library, enabled_3f in pairs(server.configuration.libraries) do
      if enabled_3f then
        local tbl_24_ = result
        for name in pairs(get_library(library)) do
          local val_25_ = name
          table.insert(tbl_24_, val_25_)
        end
      else
      end
    end
    local tbl_24_ = result
    for name in pairs(get_lua_version(server.configuration["lua-version"])) do
      local val_25_ = name
      table.insert(tbl_24_, val_25_)
    end
    return tbl_24_
  end
  local function get_library_global(server, global_name)
    local g = nil
    for library_name, enabled_3f in pairs(server.configuration.libraries) do
      if g then break end
      g = (enabled_3f and get_library(library_name)[global_name])
    end
    return g
  end
  local function get_global(server, _3fscope, global_name)
    local or_160_ = get_library_global(server, global_name) or get_lua_version(server.configuration["lua-version"])[global_name]
    if not or_160_ then
      local _161_
      do
        local x = _3fscope
        while (x and (x ~= compiler_scope)) do
          x = x.parent
        end
        _161_ = (x == compiler_scope)
      end
      if _161_ then
        or_160_ = require("fennel-ls.docs.generated.compiler-env")[global_name]
      else
        or_160_ = nil
      end
    end
    return or_160_
  end
  local literals = {["nil"] = {definition = fennel.sym("nil"), metadata = {["fnl/docstring"] = "Represents the absence of a useful value.", ["fls/itemKind"] = "Keyword"}}, ["true"] = {definition = true, metadata = {["fnl/docstring"] = "A boolean value representing truth.", ["fls/itemKind"] = "Keyword"}}, ["false"] = {metadata = {["fnl/docstring"] = "A boolean value representing falsehood.", ["fls/itemKind"] = "Keyword"}, definition = false}, [".nan"] = {definition = (- (0/0)), metadata = {["fnl/docstring"] = "NaN", ["fls/itemKind"] = "Constant"}}, [".inf"] = {definition = (1/0), metadata = {["fnl/docstring"] = "inf", ["fls/itemKind"] = "Constant"}}}
  local function get_builtin(_server, builtin_name)
    return (specials[builtin_name] or macros_2a[builtin_name] or literals[builtin_name])
  end
  local function validate_lua_version(lua_version, invalid)
    if (nil == invalid) then
      _G.error("Missing argument invalid on /fennel-ls/src/fennel-ls/docs.fnl:130", 2)
    else
    end
    if (nil == lua_version) then
      _G.error("Missing argument lua-version on /fennel-ls/src/fennel-ls/docs.fnl:130", 2)
    else
    end
    local case_165_ = lua_versions[lua_version]
    if (nil ~= case_165_) then
      local version_ = case_165_
      return lua_version
    else
      local _ = case_165_
      local function _167_()
        local tmp_9_
        do
          local tbl_26_ = {}
          local i_27_ = 0
          for k in pairs(lua_versions) do
            local val_28_ = k
            if (nil ~= val_28_) then
              i_27_ = (i_27_ + 1)
              tbl_26_[i_27_] = val_28_
            else
            end
          end
          tmp_9_ = tbl_26_
        end
        table.sort(tmp_9_)
        return tmp_9_
      end
      return invalid(("fennel-ls doesn't know about lua version " .. lua_version .. "\nThe known versions are: " .. fennel.view(_167_())))
    end
  end
  local function validate_libraries(libraries0, invalid)
    if (nil == invalid) then
      _G.error("Missing argument invalid on /fennel-ls/src/fennel-ls/docs.fnl:139", 2)
    else
    end
    if (nil == libraries0) then
      _G.error("Missing argument libraries on /fennel-ls/src/fennel-ls/docs.fnl:139", 2)
    else
    end
    local tbl_21_ = {}
    for library_name in pairs(libraries0) do
      local k_22_, v_23_
      do
        local case_171_ = get_library(library_name)
        if ((_G.type(case_171_) == "table") and (case_171_.status == "not-found") and (nil ~= case_171_.msg)) then
          local msg = case_171_.msg
          k_22_, v_23_ = invalid(msg)
        else
          local _ = case_171_
          k_22_, v_23_ = library_name, true
        end
      end
      if ((k_22_ ~= nil) and (v_23_ ~= nil)) then
        tbl_21_[k_22_] = v_23_
      else
      end
    end
    return tbl_21_
  end
  return {["get-global"] = get_global, ["get-builtin"] = get_builtin, ["get-all-globals"] = get_all_globals, ["validate-lua-version"] = validate_lua_version, ["validate-libraries"] = validate_libraries, literals = literals}
end
package.preload["fennel-ls.docs.generated.lua51"] = package.preload["fennel-ls.docs.generated.lua51"] or function(...)
  local docs = {_G = {binding = "_G", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "A global variable (not a function) that\nholds the global environment (that is, `_G._G = _G`).\nLua itself does not use this variable;\nchanging its value does not affect any environment,\nnor vice-versa.\n(Use `setfenv` to change environments.)"}}, _VERSION = {binding = "_VERSION", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "A global variable (not a function) that\nholds a string containing the current interpreter version.\nThe current contents of this variable is `\"Lua 5.1\"`."}}, arg = {binding = "arg", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "Before starting to run the script,\n`lua` collects all arguments in the command line\nin a global table called `arg`.\nThe script name is stored at index 0,\nthe first argument after the script name goes to index 1,\nand so on.\nAny arguments before the script name\n(that is, the interpreter name plus the options)\ngo to negative indices.\nFor instance, in the call\n\n```lua\n     $ lua -la b.lua t1 t2\n```\nthe interpreter first runs the file `a.lua`,\nthen creates a table\n\n```lua\n     arg = { [-2] = \"lua\", [-1] = \"-la\",\n             [0] = \"b.lua\",\n             [1] = \"t1\", [2] = \"t2\" }\n```\nand finally runs the file `b.lua`.\nThe script is called with `arg[1]`, `arg[2]`, ...\nas arguments;\nit can also access these arguments with the vararg expression `\"...\"`."}}, assert = {binding = "assert", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"v", "?message"}, ["fnl/docstring"] = "Issues an  error when\nthe value of its argument `v` is false (i.e., **nil** or **false**);\notherwise, returns all its arguments.\n`?message` is an error message;\nwhen absent, it defaults to \"assertion failed!\""}}, collectgarbage = {binding = "collectgarbage", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?opt", "?arg"}, ["fnl/docstring"] = "This function is a generic interface to the garbage collector.\nIt performs different functions according to its first argument, `?opt`:\n\n* **\"collect\":**\n  performs a full garbage-collection cycle.\n  This is the default option.\n\n* **\"stop\":**\n  stops the garbage collector.\n\n* **\"restart\":**\n  restarts the garbage collector.\n\n* **\"count\":**\n  returns the total memory in use by Lua (in Kbytes).\n\n* **\"step\":**\n  performs a garbage-collection step.\n  The step \"size\" is controlled by `?arg`\n  (larger values mean more steps) in a non-specified way.\n  If you want to control the step size\n  you must experimentally tune the value of `?arg`.\n  Returns **true** if the step finished a collection cycle.\n\n* **\"setpause\":**\n  sets `?arg` as the new value for the *pause* of\n  the collector\n  Returns the previous value for *pause*.\n\n* **\"setstepmul\":**\n  sets `?arg` as the new value for the *step multiplier* of\n  the collector\n  Returns the previous value for *step*."}}, coroutine = {binding = "coroutine", fields = {create = {binding = "coroutine.create", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f"}, ["fnl/docstring"] = "Creates a new coroutine, with body `f`.\n`f` must be a Lua function.\nReturns this new coroutine,\nan object with type `\"thread\"`."}}, resume = {binding = "coroutine.resume", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"co", "?val1", "..."}, ["fnl/docstring"] = "Starts or continues the execution of coroutine `co`.\nThe first time you resume a coroutine,\nit starts running its body.\nThe values `?val1`, ... are passed\nas the arguments to the body function.\nIf the coroutine has yielded,\n`resume` restarts it;\nthe values `?val1`, ... are passed\nas the results from the yield.\n\nIf the coroutine runs without any errors,\n`resume` returns **true** plus any values passed to `yield`\n(if the coroutine yields) or any values returned by the body function\n(if the coroutine terminates).\nIf there is any error,\n`resume` returns **false** plus the error message."}}, running = {binding = "coroutine.running", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {}, ["fnl/docstring"] = "Returns the running coroutine,\nor **nil** when called by the main thread."}}, status = {binding = "coroutine.status", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"co"}, ["fnl/docstring"] = "Returns the status of coroutine `co`, as a string:\n`\"running\"`,\nif the coroutine is running (that is, it called `status`);\n`\"suspended\"`, if the coroutine is suspended in a call to `yield`,\nor if it has not started running yet;\n`\"normal\"` if the coroutine is active but not running\n(that is, it has resumed another coroutine);\nand `\"dead\"` if the coroutine has finished its body function,\nor if it has stopped with an error."}}, wrap = {binding = "coroutine.wrap", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f"}, ["fnl/docstring"] = "Creates a new coroutine, with body `f`.\n`f` must be a Lua function.\nReturns a function that resumes the coroutine each time it is called.\nAny arguments passed to the function behave as the\nextra arguments to `resume`.\nReturns the same values returned by `resume`,\nexcept the first boolean.\nIn case of error, propagates the error."}}, yield = {binding = "coroutine.yield", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"..."}, ["fnl/docstring"] = "Suspends the execution of the calling coroutine.\nThe coroutine cannot be running a C function,\na metamethod, or an iterator.\nAny arguments to `yield` are passed as extra results to `resume`."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "The operations related to coroutines comprise a sub-library of\nthe basic library and come inside the table `coroutine`."}}, debug = {binding = "debug", fields = {debug = {binding = "debug.debug", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {}, ["fnl/docstring"] = "Enters an interactive mode with the user,\nrunning each string that the user enters.\nUsing simple commands and other debug facilities,\nthe user can inspect global and local variables,\nchange their values, evaluate expressions, and so on.\nA line containing only the word `cont` finishes this function,\nso that the caller continues its execution.\n\nNote that commands for `debug.debug` are not lexically nested\nwithin any function, and so have no direct access to local variables."}}, getfenv = {binding = "debug.getfenv", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"o"}, ["fnl/docstring"] = "Returns the environment of object `o`."}}, gethook = {binding = "debug.gethook", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?thread"}, ["fnl/docstring"] = "Returns the current hook settings of the thread, as three values:\nthe current hook function, the current hook mask,\nand the current hook count\n(as set by the `debug.sethook` function)."}}, getinfo = {binding = "debug.getinfo", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"function", "?what"}, ["fnl/docstring"] = "Returns a table with information about a function.\nYou can give the function directly,\nor you can give a number as the value of `function`,\nwhich means the function running at level `function` of the call stack\nof the given thread:\nlevel 0 is the current function (`getinfo` itself);\nlevel 1 is the function that called `getinfo`;\nand so on.\nIf `function` is a number larger than the number of active functions,\nthen `getinfo` returns **nil**.\n\nThe returned table can contain all the fields returned by `lua_getinfo`,\nwith the string `?what` describing which fields to fill in.\nThe default for `?what` is to get all information available,\nexcept the table of valid lines.\nIf present,\nthe option `\"f\"`\nadds a field named `func` with the function itself.\nIf present,\nthe option `\"L\"`\nadds a field named `activelines` with the table of\nvalid lines.\n\nFor instance, the expression `debug.getinfo(1,\"n\").name` returns\na table with a name for the current function,\nif a reasonable name can be found,\nand the expression `debug.getinfo(print)`\nreturns a table with all available information\nabout the `print` function."}}, getlocal = {binding = "debug.getlocal", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"level", "local"}, ["fnl/docstring"] = "This function returns the name and the value of the local variable\nwith index `local` of the function at level `level` of the stack.\n(The first parameter or local variable has index 1, and so on,\nuntil the last active local variable.)\nThe function returns **nil** if there is no local\nvariable with the given index,\nand raises an error when called with a `level` out of range.\n(You can call `debug.getinfo` to check whether the level is valid.)\n\nVariable names starting with `\"(\"` (open parentheses)\nrepresent internal variables\n(loop control variables, temporaries, and C function locals)."}}, getmetatable = {binding = "debug.getmetatable", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"object"}, ["fnl/docstring"] = "Returns the metatable of the given `object`\nor **nil** if it does not have a metatable."}}, getregistry = {binding = "debug.getregistry", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {}, ["fnl/docstring"] = "Returns the registry table"}}, getupvalue = {binding = "debug.getupvalue", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"func", "up"}, ["fnl/docstring"] = "This function returns the name and the value of the upvalue\nwith index `up` of the function `func`.\nThe function returns **nil** if there is no upvalue with the given index."}}, setfenv = {binding = "debug.setfenv", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"object", "table"}, ["fnl/docstring"] = "Sets the environment of the given `object` to the given `table`.\nReturns `object`."}}, sethook = {binding = "debug.sethook", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"hook", "mask", "?count"}, ["fnl/docstring"] = "Sets the given function as a hook.\nThe string `mask` and the number `?count` describe\nwhen the hook will be called.\nThe string mask may have the following characters,\nwith the given meaning:\n\n* **`\"c\"`:** the hook is called every time Lua calls a function;\n* **`\"r\"`:** the hook is called every time Lua returns from a function;\n* **`\"l\"`:** the hook is called every time Lua enters a new line of code.\n\nWith a `?count` different from zero,\nthe hook is called after every `?count` instructions.\n\nWhen called without arguments,\n`debug.sethook` turns off the hook.\n\nWhen the hook is called, its first parameter is a string\ndescribing the event that has triggered its call:\n`\"call\"`, `\"return\"` (or `\"tail return\"`,\nwhen simulating a return from a tail call),\n`\"line\"`, and `\"count\"`.\nFor line events,\nthe hook also gets the new line number as its second parameter.\nInside a hook,\nyou can call `getinfo` with level 2 to get more information about\nthe running function\n(level 0 is the `getinfo` function,\nand level 1 is the hook function),\nunless the event is `\"tail return\"`.\nIn this case, Lua is only simulating the return,\nand a call to `getinfo` will return invalid data."}}, setlocal = {binding = "debug.setlocal", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"level", "local", "value"}, ["fnl/docstring"] = "This function assigns the value `value` to the local variable\nwith index `local` of the function at level `level` of the stack.\nThe function returns **nil** if there is no local\nvariable with the given index,\nand raises an error when called with a `level` out of range.\n(You can call `getinfo` to check whether the level is valid.)\nOtherwise, it returns the name of the local variable."}}, setmetatable = {binding = "debug.setmetatable", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"object", "table"}, ["fnl/docstring"] = "Sets the metatable for the given `object` to the given `table`\n(which can be **nil**)."}}, setupvalue = {binding = "debug.setupvalue", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"func", "up", "value"}, ["fnl/docstring"] = "This function assigns the value `value` to the upvalue\nwith index `up` of the function `func`.\nThe function returns **nil** if there is no upvalue\nwith the given index.\nOtherwise, it returns the name of the upvalue."}}, traceback = {binding = "debug.traceback", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?message", "?level"}, ["fnl/docstring"] = "Returns a string with a traceback of the call stack.\nAn optional `?message` string is appended\nat the beginning of the traceback.\nAn optional `?level` number tells at which level\nto start the traceback\n(default is 1, the function calling `traceback`)."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "This library provides\nthe functionality of the debug interface to Lua programs.\nYou should exert care when using this library.\nThe functions provided here should be used exclusively for debugging\nand similar tasks, such as profiling.\nPlease resist the temptation to use them as a\nusual programming tool:\nthey can be very slow.\nMoreover, several of these functions\nviolate some assumptions about Lua code\n(e.g., that variables local to a function\ncannot be accessed from outside or\nthat userdata metatables cannot be changed by Lua code)\nand therefore can compromise otherwise secure code.\n\nAll functions in this library are provided\ninside the `debug` table.\nAll functions that operate over a thread\nhave an optional first argument which is the\nthread to operate over.\nThe default is always the current thread."}}, dofile = {binding = "dofile", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?filename"}, ["fnl/docstring"] = "Opens the named file and executes its contents as a Lua chunk.\nWhen called without arguments,\n`dofile` executes the contents of the standard input (`stdin`).\nReturns all values returned by the chunk.\nIn case of errors, `dofile` propagates the error\nto its caller (that is, `dofile` does not run in protected mode)."}}, error = {binding = "error", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"message", "?level"}, ["fnl/docstring"] = "Terminates the last protected function called\nand returns `message` as the error message.\nFunction `error` never returns.\n\nUsually, `error` adds some information about the error position\nat the beginning of the message.\nThe `?level` argument specifies how to get the error position.\nWith level 1 (the default), the error position is where the\n`error` function was called.\nLevel 2 points the error to where the function\nthat called `error` was called; and so on.\nPassing a level 0 avoids the addition of error position information\nto the message."}}, getfenv = {binding = "getfenv", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?f"}, ["fnl/docstring"] = "Returns the current environment in use by the function.\n`?f` can be a Lua function or a number\nthat specifies the function at that stack level:\nLevel 1 is the function calling `getfenv`.\nIf the given function is not a Lua function,\nor if `?f` is 0,\n`getfenv` returns the global environment.\nThe default for `?f` is 1."}}, getmetatable = {binding = "getmetatable", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"object"}, ["fnl/docstring"] = "If `object` does not have a metatable, returns **nil**.\nOtherwise,\nif the object's metatable has a `\"__metatable\"` field,\nreturns the associated value.\nOtherwise, returns the metatable of the given object."}}, io = {binding = "io", fields = {close = {binding = "io.close", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?file"}, ["fnl/docstring"] = "Equivalent to `file:close()`.\nWithout a `?file`, closes the default output file."}}, flush = {binding = "io.flush", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {}, ["fnl/docstring"] = "Equivalent to `file:flush` over the default output file."}}, input = {binding = "io.input", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?file"}, ["fnl/docstring"] = "When called with a file name, it opens the named file (in text mode),\nand sets its handle as the default input file.\nWhen called with a file handle,\nit simply sets this file handle as the default input file.\nWhen called without parameters,\nit returns the current default input file.\n\nIn case of errors this function raises the error,\ninstead of returning an error code."}}, lines = {binding = "io.lines", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?filename"}, ["fnl/docstring"] = "Opens the given file name in read mode\nand returns an iterator function that,\neach time it is called,\nreturns a new line from the file.\nTherefore, the construction\n\n```lua\n     for line in io.lines(filename) do *body* end\n```\nwill iterate over all lines of the file.\nWhen the iterator function detects the end of file,\nit returns **nil** (to finish the loop) and automatically closes the file.\n\nThe call `io.lines()` (with no file name) is equivalent\nto `io.input():lines()`;\nthat is, it iterates over the lines of the default input file.\nIn this case it does not close the file when the loop ends."}}, open = {binding = "io.open", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"filename", "?mode"}, ["fnl/docstring"] = "This function opens a file,\nin the mode specified in the string `?mode`.\nIt returns a new file handle,\nor, in case of errors, **nil** plus an error message.\n\nThe `?mode` string can be any of the following:\n\n* **\"r\":** read mode (the default);\n* **\"w\":** write mode;\n* **\"a\":** append mode;\n* **\"r+\":** update mode, all previous data is preserved;\n* **\"w+\":** update mode, all previous data is erased;\n* **\"a+\":** append update mode, previous data is preserved,\n    writing is only allowed at the end of file.\n\nThe `?mode` string can also have a `\"b\"` at the end,\nwhich is needed in some systems to open the file in binary mode.\nThis string is exactly what is used in the\nstandard C function `fopen`."}}, output = {binding = "io.output", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?file"}, ["fnl/docstring"] = "Similar to `io.input`, but operates over the default output file."}}, popen = {binding = "io.popen", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"prog", "?mode"}, ["fnl/docstring"] = "Starts program `prog` in a separated process and returns\na file handle that you can use to read data from this program\n(if `?mode` is `\"r\"`, the default)\nor to write data to this program\n(if `?mode` is `\"w\"`).\n\nThis function is system dependent and is not available\non all platforms."}}, read = {binding = "io.read", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"..."}, ["fnl/docstring"] = "Equivalent to `io.input():read`."}}, stderr = {binding = "io.stderr", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "stderr file"}}, stdin = {binding = "io.stdin", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "stdin file"}}, stdout = {binding = "io.stdout", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "stdout file"}}, tmpfile = {binding = "io.tmpfile", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {}, ["fnl/docstring"] = "Returns a handle for a temporary file.\nThis file is opened in update mode\nand it is automatically removed when the program ends."}}, type = {binding = "io.type", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"obj"}, ["fnl/docstring"] = "Checks whether `obj` is a valid file handle.\nReturns the string `\"file\"` if `obj` is an open file handle,\n`\"closed file\"` if `obj` is a closed file handle,\nor **nil** if `obj` is not a file handle."}}, write = {binding = "io.write", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"..."}, ["fnl/docstring"] = "Equivalent to `io.output():write`."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "The I/O library provides two different styles for file manipulation.\nThe first one uses implicit file descriptors;\nthat is, there are operations to set a default input file and a\ndefault output file,\nand all input/output operations are over these default files.\nThe second style uses explicit file descriptors.\n\nWhen using implicit file descriptors,\nall operations are supplied by table `io`.\nWhen using explicit file descriptors,\nthe operation `io.open` returns a file descriptor\nand then all operations are supplied as methods of the file descriptor.\n\nThe table `io` also provides\nthree predefined file descriptors with their usual meanings from C:\n`io.stdin`, `io.stdout`, and `io.stderr`.\nThe I/O library never closes these files.\n\nUnless otherwise stated,\nall I/O functions return **nil** on failure\n(plus an error message as a second result and\na system-dependent error code as a third result)\nand some value different from **nil** on success."}}, ipairs = {binding = "ipairs", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"t"}, ["fnl/docstring"] = "Returns three values: an iterator function, the table `t`, and 0,\nso that the construction\n\n```lua\n     for i,v in ipairs(t) do *body* end\n```\nwill iterate over the pairs (`1,t[1]`), (`2,t[2]`), ...,\nup to the first integer key absent from the table."}}, load = {binding = "load", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"func", "?chunkname"}, ["fnl/docstring"] = "Loads a chunk using function `func` to get its pieces.\nEach call to `func` must return a string that concatenates\nwith previous results.\nA return of an empty string, **nil**, or no value signals the end of the chunk.\n\nIf there are no errors, \nreturns the compiled chunk as a function;\notherwise, returns **nil** plus the error message.\nThe environment of the returned function is the global environment.\n\n`?chunkname` is used as the chunk name for error messages\nand debug information.\nWhen absent,\nit defaults to `\"=(load)\"`."}}, loadfile = {binding = "loadfile", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?filename"}, ["fnl/docstring"] = "Similar to `load`,\nbut gets the chunk from file `?filename`\nor from the standard input,\nif no file name is given."}}, loadstring = {binding = "loadstring", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"string", "?chunkname"}, ["fnl/docstring"] = "Similar to `load`,\nbut gets the chunk from the given string.\n\nTo load and run a given string, use the idiom\n\n```lua\n     assert(loadstring(s))()\n```\n\nWhen absent,\n`?chunkname` defaults to the given string."}}, math = {binding = "math", fields = {abs = {binding = "math.abs", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the absolute value of `x`."}}, acos = {binding = "math.acos", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the arc cosine of `x` (in radians)."}}, asin = {binding = "math.asin", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the arc sine of `x` (in radians)."}}, atan = {binding = "math.atan", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the arc tangent of `x` (in radians)."}}, atan2 = {binding = "math.atan2", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"y", "x"}, ["fnl/docstring"] = "Returns the arc tangent of `y/x` (in radians),\nbut uses the signs of both parameters to find the\nquadrant of the result.\n(It also handles correctly the case of `x` being zero.)"}}, ceil = {binding = "math.ceil", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the smallest integer larger than or equal to `x`."}}, cos = {binding = "math.cos", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the cosine of `x` (assumed to be in radians)."}}, cosh = {binding = "math.cosh", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the hyperbolic cosine of `x`."}}, deg = {binding = "math.deg", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the angle `x` (given in radians) in degrees."}}, exp = {binding = "math.exp", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the value *e\203\163*."}}, floor = {binding = "math.floor", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the largest integer smaller than or equal to `x`."}}, fmod = {binding = "math.fmod", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x", "y"}, ["fnl/docstring"] = "Returns the remainder of the division of `x` by `y`\nthat rounds the quotient towards zero."}}, frexp = {binding = "math.frexp", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns `m` and `e` such that *x = m2\225\181\137*,\n`e` is an integer and the absolute value of `m` is\nin the range *[0.5, 1)*\n(or zero when `x` is zero)."}}, huge = {binding = "math.huge", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "The value `HUGE_VAL`,\na value larger than or equal to any other numerical value."}}, ldexp = {binding = "math.ldexp", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"m", "e"}, ["fnl/docstring"] = "Returns *m2\225\181\137* (`e` should be an integer)."}}, log = {binding = "math.log", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the natural logarithm of `x`."}}, log10 = {binding = "math.log10", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the base-10 logarithm of `x`."}}, max = {binding = "math.max", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x", "..."}, ["fnl/docstring"] = "Returns the maximum value among its arguments."}}, min = {binding = "math.min", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x", "..."}, ["fnl/docstring"] = "Returns the minimum value among its arguments."}}, modf = {binding = "math.modf", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns two numbers,\nthe integral part of `x` and the fractional part of `x`."}}, pi = {binding = "math.pi", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "The value of *pi*."}}, pow = {binding = "math.pow", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x", "y"}, ["fnl/docstring"] = "Returns *x\202\184*.\n(You can also use the expression `x^y` to compute this value.)"}}, rad = {binding = "math.rad", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the angle `x` (given in degrees) in radians."}}, random = {binding = "math.random", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?m", "?n"}, ["fnl/docstring"] = "This function is an interface to the simple\npseudo-random generator function `rand` provided by ANSI C.\n(No guarantees can be given for its statistical properties.)\n\nWhen called without arguments,\nreturns a uniform pseudo-random real number\nin the range *[0,1)*.  \nWhen called with an integer number `?m`,\n`math.random` returns\na uniform pseudo-random integer in the range *[1, m]*.\nWhen called with two integer numbers `?m` and `?n`,\n`math.random` returns a uniform pseudo-random\ninteger in the range *[m, n]*."}}, randomseed = {binding = "math.randomseed", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Sets `x` as the \"seed\"\nfor the pseudo-random generator:\nequal seeds produce equal sequences of numbers."}}, sin = {binding = "math.sin", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the sine of `x` (assumed to be in radians)."}}, sinh = {binding = "math.sinh", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the hyperbolic sine of `x`."}}, sqrt = {binding = "math.sqrt", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the square root of `x`.\n(You can also use the expression `x^0.5` to compute this value.)"}}, tan = {binding = "math.tan", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the tangent of `x` (assumed to be in radians)."}}, tanh = {binding = "math.tanh", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the hyperbolic tangent of `x`."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "This library is an interface to the standard C math library.\nIt provides all its functions inside the table `math`."}}, module = {binding = "module", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"name", "?..."}, ["fnl/docstring"] = "Creates a module.\nIf there is a table in `package.loaded[name]`,\nthis table is the module.\nOtherwise, if there is a global table `t` with the given name,\nthis table is the module.\nOtherwise creates a new table `t` and\nsets it as the value of the global `name` and\nthe value of `package.loaded[name]`.\nThis function also initializes `t._NAME` with the given name,\n`t._M` with the module (`t` itself),\nand `t._PACKAGE` with the package name\n(the full module name minus last component; see below).\nFinally, `module` sets `t` as the new environment\nof the current function and the new value of `package.loaded[name]`,\nso that `require` returns `t`.\n\nIf `name` is a compound name\n(that is, one with components separated by dots),\n`module` creates (or reuses, if they already exist)\ntables for each component.\nFor instance, if `name` is `a.b.c`,\nthen `module` stores the module table in field `c` of\nfield `b` of global `a`.\n\nThis function can receive optional *options* after\nthe module name,\nwhere each option is a function to be applied over the module."}}, next = {binding = "next", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"table", "?index"}, ["fnl/docstring"] = "Allows a program to traverse all fields of a table.\nIts first argument is a table and its second argument\nis an index in this table.\n`next` returns the next index of the table\nand its associated value.\nWhen called with **nil** as its second argument,\n`next` returns an initial index\nand its associated value.\nWhen called with the last index,\nor with **nil** in an empty table,\n`next` returns **nil**.\nIf the second argument is absent, then it is interpreted as **nil**.\nIn particular,\nyou can use `next(t)` to check whether a table is empty.\n\nThe order in which the indices are enumerated is not specified,\n*even for numeric indices*.\n(To traverse a table in numeric order,\nuse a numerical **for** or the `ipairs` function.)\n\nThe behavior of `next` is *undefined* if,\nduring the traversal,\nyou assign any value to a non-existent field in the table.\nYou may however modify existing fields.\nIn particular, you may clear existing fields."}}, os = {binding = "os", fields = {clock = {binding = "os.clock", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {}, ["fnl/docstring"] = "Returns an approximation of the amount in seconds of CPU time\nused by the program."}}, date = {binding = "os.date", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?format", "?time"}, ["fnl/docstring"] = "Returns a string or a table containing date and time,\nformatted according to the given string `?format`.\n\nIf the `?time` argument is present,\nthis is the time to be formatted\n(see the `os.time` function for a description of this value).\nOtherwise, `date` formats the current time.\n\nIf `?format` starts with `\"!\"`,\nthen the date is formatted in Coordinated Universal Time.\nAfter this optional character,\nif `?format` is the string `\"*t\"`,\nthen `date` returns a table with the following fields:\n`year` (four digits), `month` (1--12), `day` (1--31),\n`hour` (0--23), `min` (0--59), `sec` (0--61),\n`wday` (weekday, Sunday is 1),\n`yday` (day of the year),\nand `isdst` (daylight saving flag, a boolean).\n\nIf `?format` is not `\"*t\"`,\nthen `date` returns the date as a string,\nformatted according to the same rules as the C function `strftime`.\n\nWhen called without arguments,\n`date` returns a reasonable date and time representation that depends on\nthe host system and on the current locale\n(that is, `os.date()` is equivalent to `os.date(\"%c\")`)."}}, difftime = {binding = "os.difftime", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"t2", "t1"}, ["fnl/docstring"] = "Returns the number of seconds from time `t1` to time `t2`.\nIn POSIX, Windows, and some other systems,\nthis value is exactly `t2`*-*`t1`."}}, execute = {binding = "os.execute", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?command"}, ["fnl/docstring"] = "This function is equivalent to the C function `system`.\nIt passes `?command` to be executed by an operating system shell.\nIt returns a status code, which is system-dependent.\nIf `?command` is absent, then it returns nonzero if a shell is available\nand zero otherwise."}}, exit = {binding = "os.exit", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?code"}, ["fnl/docstring"] = "Calls the C function `exit`,\nwith an optional `?code`,\nto terminate the host program.\nThe default value for `?code` is the success code."}}, getenv = {binding = "os.getenv", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"varname"}, ["fnl/docstring"] = "Returns the value of the process environment variable `varname`,\nor **nil** if the variable is not defined."}}, remove = {binding = "os.remove", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"filename"}, ["fnl/docstring"] = "Deletes the file or directory with the given name.\nDirectories must be empty to be removed.\nIf this function fails, it returns **nil**,\nplus a string describing the error."}}, rename = {binding = "os.rename", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"oldname", "newname"}, ["fnl/docstring"] = "Renames file or directory named `oldname` to `newname`.\nIf this function fails, it returns **nil**,\nplus a string describing the error."}}, setlocale = {binding = "os.setlocale", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"locale", "?category"}, ["fnl/docstring"] = "Sets the current locale of the program.\n`locale` is a string specifying a locale;\n`?category` is an optional string describing which category to change:\n`\"all\"`, `\"collate\"`, `\"ctype\"`,\n`\"monetary\"`, `\"numeric\"`, or `\"time\"`;\nthe default category is `\"all\"`.\nThe function returns the name of the new locale,\nor **nil** if the request cannot be honored.\n\nIf `locale` is the empty string,\nthe current locale is set to an implementation-defined native locale.\nIf `locale` is the string `\"C\"`,\nthe current locale is set to the standard C locale.\n\nWhen called with **nil** as the first argument,\nthis function only returns the name of the current locale\nfor the given category."}}, time = {binding = "os.time", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?table"}, ["fnl/docstring"] = "Returns the current time when called without arguments,\nor a time representing the date and time specified by the given table.\nThis table must have fields `year`, `month`, and `day`,\nand may have fields `hour`, `min`, `sec`, and `isdst`\n(for a description of these fields, see the `os.date` function).\n\nThe returned value is a number, whose meaning depends on your system.\nIn POSIX, Windows, and some other systems, this number counts the number\nof seconds since some given start time (the \"epoch\").\nIn other systems, the meaning is not specified,\nand the number returned by `time` can be used only as an argument to\n`date` and `difftime`."}}, tmpname = {binding = "os.tmpname", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {}, ["fnl/docstring"] = "Returns a string with a file name that can\nbe used for a temporary file.\nThe file must be explicitly opened before its use\nand explicitly removed when no longer needed.\n\nOn some systems (POSIX),\nthis function also creates a file with that name,\nto avoid security risks.\n(Someone else might create the file with wrong permissions\nin the time between getting the name and creating the file.)\nYou still have to open the file to use it\nand to remove it (even if you do not use it).\n\nWhen possible,\nyou may prefer to use `io.tmpfile`,\nwhich automatically removes the file when the program ends."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "This library is implemented through table `os`."}}, package = {binding = "package", fields = {cpath = {binding = "package.cpath", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "The path used by `require` to search for a C loader.\n\nLua initializes the C path `package.cpath` in the same way\nit initializes the Lua path `package.path`,\nusing the environment variable `LUA_CPATH`\nor a default path defined in `luaconf.h`."}}, loaded = {binding = "package.loaded", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "A table used by `require` to control which\nmodules are already loaded.\nWhen you require a module `modname` and\n`package.loaded[modname]` is not false,\n`require` simply returns the value stored there."}}, loaders = {binding = "package.loaders", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "A table used by `require` to control how to load modules.\n\nEach entry in this table is a *searcher function*.\nWhen looking for a module,\n`require` calls each of these searchers in ascending order,\nwith the module name (the argument given to `require`) as its\nsole parameter.\nThe function can return another function (the module *loader*)\nor a string explaining why it did not find that module\n(or **nil** if it has nothing to say).\nLua initializes this table with four functions.\n\nThe first searcher simply looks for a loader in the\n`package.preload` table.\n\nThe second searcher looks for a loader as a Lua library,\nusing the path stored at `package.path`.\nA path is a sequence of *templates* separated by semicolons.\nFor each template,\nthe searcher will change each interrogation\nmark in the template by `filename`,\nwhich is the module name with each dot replaced by a\n\"directory separator\" (such as `\"/\"` in Unix);\nthen it will try to open the resulting file name.\nSo, for instance, if the Lua path is the string\n\n```lua\n     \"./?.lua;./?.lc;/usr/local/?/init.lua\"\n```\nthe search for a Lua file for module `foo`\nwill try to open the files\n`./foo.lua`, `./foo.lc`, and\n`/usr/local/foo/init.lua`, in that order.\n\nThe third searcher looks for a loader as a C library,\nusing the path given by the variable `package.cpath`.\nFor instance,\nif the C path is the string\n\n```lua\n     \"./?.so;./?.dll;/usr/local/?/init.so\"\n```\nthe searcher for module `foo`\nwill try to open the files `./foo.so`, `./foo.dll`,\nand `/usr/local/foo/init.so`, in that order.\nOnce it finds a C library,\nthis searcher first uses a dynamic link facility to link the\napplication with the library.\nThen it tries to find a C function inside the library to\nbe used as the loader.\nThe name of this C function is the string `\"luaopen_\"`\nconcatenated with a copy of the module name where each dot\nis replaced by an underscore.\nMoreover, if the module name has a hyphen,\nits prefix up to (and including) the first hyphen is removed.\nFor instance, if the module name is `a.v1-b.c`,\nthe function name will be `luaopen_b_c`.\n\nThe fourth searcher tries an *all-in-one loader*.\nIt searches the C path for a library for\nthe root name of the given module.\nFor instance, when requiring `a.b.c`,\nit will search for a C library for `a`.\nIf found, it looks into it for an open function for\nthe submodule;\nin our example, that would be `luaopen_a_b_c`.\nWith this facility, a package can pack several C submodules\ninto one single library,\nwith each submodule keeping its original open function."}}, loadlib = {binding = "package.loadlib", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"libname", "funcname"}, ["fnl/docstring"] = "Dynamically links the host program with the C library `libname`.\nInside this library, looks for a function `funcname`\nand returns this function as a C function.\n(So, `funcname` must follow the protocol (see `lua_CFunction`)).\n\nThis is a low-level function.\nIt completely bypasses the package and module system.\nUnlike `require`,\nit does not perform any path searching and\ndoes not automatically adds extensions.\n`libname` must be the complete file name of the C library,\nincluding if necessary a path and extension.\n`funcname` must be the exact name exported by the C library\n(which may depend on the C compiler and linker used).\n\nThis function is not supported by ANSI C.\nAs such, it is only available on some platforms\n(Windows, Linux, Mac OS X, Solaris, BSD,\nplus other Unix systems that support the `dlfcn` standard)."}}, path = {binding = "package.path", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "The path used by `require` to search for a Lua loader.\n\nAt start-up, Lua initializes this variable with\nthe value of the environment variable `LUA_PATH` or\nwith a default path defined in `luaconf.h`,\nif the environment variable is not defined.\nAny `\";;\"` in the value of the environment variable\nis replaced by the default path."}}, preload = {binding = "package.preload", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "A table to store loaders for specific modules\n(see `require`)."}}, seeall = {binding = "package.seeall", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"module"}, ["fnl/docstring"] = "Sets a metatable for `module` with\nits `__index` field referring to the global environment,\nso that this module inherits values\nfrom the global environment.\nTo be used as an option to function `module`."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "The package library provides basic\nfacilities for loading and building modules in Lua.\nIt exports two of its functions directly in the global environment:\n`require` and `module`.\nEverything else is exported in a table `package`."}}, pairs = {binding = "pairs", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"t"}, ["fnl/docstring"] = "Returns three values: the `next` function, the table `t`, and **nil**,\nso that the construction\n\n```lua\n     for k,v in pairs(t) do *body* end\n```\nwill iterate over all key\226\128\147value pairs of table `t`.\n\nSee function `next` for the caveats of modifying\nthe table during its traversal."}}, pcall = {binding = "pcall", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f", "?arg1", "..."}, ["fnl/docstring"] = "Calls function `f` with\nthe given arguments in *protected mode*.\nThis means that any error inside `f` is not propagated;\ninstead, `pcall` catches the error\nand returns a status code.\nIts first result is the status code (a boolean),\nwhich is true if the call succeeds without errors.\nIn such case, `pcall` also returns all results from the call,\nafter this first result.\nIn case of any error, `pcall` returns **false** plus the error message."}}, print = {binding = "print", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"..."}, ["fnl/docstring"] = "Receives any number of arguments,\nand prints their values to `stdout`,\nusing the `tostring` function to convert them to strings.\n`print` is not intended for formatted output,\nbut only as a quick way to show a value,\ntypically for debugging.\nFor formatted output, use `string.format`."}}, rawequal = {binding = "rawequal", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"v1", "v2"}, ["fnl/docstring"] = "Checks whether `v1` is equal to `v2`,\nwithout invoking any metamethod.\nReturns a boolean."}}, rawget = {binding = "rawget", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"table", "index"}, ["fnl/docstring"] = "Gets the real value of `table[index]`,\nwithout invoking any metamethod.\n`table` must be a table;\n`index` may be any value."}}, rawset = {binding = "rawset", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"table", "index", "value"}, ["fnl/docstring"] = "Sets the real value of `table[index]` to `value`,\nwithout invoking any metamethod.\n`table` must be a table,\n`index` any value different from **nil**,\nand `value` any Lua value.\n\nThis function returns `table`."}}, require = {binding = "require", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"modname"}, ["fnl/docstring"] = "Loads the given module.\nThe function starts by looking into the `package.loaded` table\nto determine whether `modname` is already loaded.\nIf it is, then `require` returns the value stored\nat `package.loaded[modname]`.\nOtherwise, it tries to find a *loader* for the module.\n\nTo find a loader,\n`require` is guided by the `package.loaders` array.\nBy changing this array,\nwe can change how `require` looks for a module.\nThe following explanation is based on the default configuration\nfor `package.loaders`.\n\nFirst `require` queries `package.preload[modname]`.\nIf it has a value,\nthis value (which should be a function) is the loader.\nOtherwise `require` searches for a Lua loader using the\npath stored in `package.path`.\nIf that also fails, it searches for a C loader using the\npath stored in `package.cpath`.\nIf that also fails,\nit tries an *all-in-one* loader (see `package.loaders`).\n\nOnce a loader is found,\n`require` calls the loader with a single argument, `modname`.\nIf the loader returns any value,\n`require` assigns the returned value to `package.loaded[modname]`.\nIf the loader returns no value and\nhas not assigned any value to `package.loaded[modname]`,\nthen `require` assigns **true** to this entry.\nIn any case, `require` returns the\nfinal value of `package.loaded[modname]`.\n\nIf there is any error loading or running the module,\nor if it cannot find any loader for the module,\nthen `require` signals an error."}}, select = {binding = "select", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"index", "..."}, ["fnl/docstring"] = "If `index` is a number,\nreturns all arguments after argument number `index`.\nOtherwise, `index` must be the string `\"#\"`,\nand `select` returns the total number of extra arguments it received."}}, setfenv = {binding = "setfenv", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f", "table"}, ["fnl/docstring"] = "Sets the environment to be used by the given function.\n`f` can be a Lua function or a number\nthat specifies the function at that stack level:\nLevel 1 is the function calling `setfenv`.\n`setfenv` returns the given function.\n\nAs a special case, when `f` is 0 `setfenv` changes\nthe environment of the running thread.\nIn this case, `setfenv` returns no values."}}, setmetatable = {binding = "setmetatable", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"table", "metatable"}, ["fnl/docstring"] = "Sets the metatable for the given table.\n(You cannot change the metatable of other types from Lua, only from C.)\nIf `metatable` is **nil**,\nremoves the metatable of the given table.\nIf the original metatable has a `\"__metatable\"` field,\nraises an error.\n\nThis function returns `table`."}}, string = {binding = "string", fields = {byte = {binding = "string.byte", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "?i", "?j"}, ["fnl/docstring"] = "Returns the internal numerical codes of the characters `s[i]`,\n`s[i+1]`, ..., `s[j]`.\nThe default value for `?i` is 1;\nthe default value for `?j` is `?i`.\n\nNote that numerical codes are not necessarily portable across platforms."}}, char = {binding = "string.char", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"..."}, ["fnl/docstring"] = "Receives zero or more integers.\nReturns a string with length equal to the number of arguments,\nin which each character has the internal numerical code equal\nto its corresponding argument.\n\nNote that numerical codes are not necessarily portable across platforms."}}, dump = {binding = "string.dump", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"function"}, ["fnl/docstring"] = "Returns a string containing a binary representation of the given function,\nso that a later `loadstring` on this string returns\na copy of the function.\n`function` must be a Lua function without upvalues."}}, find = {binding = "string.find", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "pattern", "?init", "?plain"}, ["fnl/docstring"] = "Looks for the first match of\n`pattern` in the string `s`.\nIf it finds a match, then `find` returns the indices of `s`\nwhere this occurrence starts and ends;\notherwise, it returns **nil**.\nA third, optional numerical argument `?init` specifies\nwhere to start the search;\nits default value is 1 and can be negative.\nA value of **true** as a fourth, optional argument `?plain`\nturns off the pattern matching facilities,\nso the function does a plain \"find substring\" operation,\nwith no characters in `pattern` being considered \"magic\".\nNote that if `?plain` is given, then `?init` must be given as well.\n\nIf the pattern has captures,\nthen in a successful match\nthe captured values are also returned,\nafter the two indices."}}, format = {binding = "string.format", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"formatstring", "..."}, ["fnl/docstring"] = "Returns a formatted version of its variable number of arguments\nfollowing the description given in its first argument (which must be a string).\nThe format string follows the same rules as the `printf` family of\nstandard C functions.\nThe only differences are that the options/modifiers\n`*`, `l`, `L`, `n`, `p`,\nand `h` are not supported\nand that there is an extra option, `q`.\nThe `q` option formats a string in a form suitable to be safely read\nback by the Lua interpreter:\nthe string is written between double quotes,\nand all double quotes, newlines, embedded zeros,\nand backslashes in the string\nare correctly escaped when written.\nFor instance, the call\n\n```lua\n     string.format('%q', 'a string with \"quotes\" and \\n new line')\n```\nwill produce the string:\n\n```lua\n     \"a string with \\\"quotes\\\" and \\\n      new line\"\n```\n\nThe options `c`, `d`, `E`, `e`, `f`,\n`g`, `G`, `i`, `o`, `u`, `X`, and `x` all\nexpect a number as argument,\nwhereas `q` and `s` expect a string.\n\nThis function does not accept string values\ncontaining embedded zeros,\nexcept as arguments to the `q` option."}}, gmatch = {binding = "string.gmatch", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "pattern"}, ["fnl/docstring"] = "Returns an iterator function that,\neach time it is called,\nreturns the next captures from `pattern` over string `s`.\nIf `pattern` specifies no captures,\nthen the whole match is produced in each call.\n\nAs an example, the following loop\n\n```lua\n     s = \"hello world from Lua\"\n     for w in string.gmatch(s, \"%a+\") do\n       print(w)\n     end\n```\nwill iterate over all the words from string `s`,\nprinting one per line.\nThe next example collects all pairs `key=value` from the\ngiven string into a table:\n\n```lua\n     t = {}\n     s = \"from=world, to=Lua\"\n     for k, v in string.gmatch(s, \"(%w+)=(%w+)\") do\n       t[k] = v\n     end\n```\n\nFor this function, a `\"^\"` at the start of a pattern does not\nwork as an anchor, as this would prevent the iteration."}}, gsub = {binding = "string.gsub", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "pattern", "repl", "?n"}, ["fnl/docstring"] = "Returns a copy of `s`\nin which all (or the first `?n`, if given)\noccurrences of the `pattern` have been\nreplaced by a replacement string specified by `repl`,\nwhich can be a string, a table, or a function.\n`gsub` also returns, as its second value,\nthe total number of matches that occurred.\n\nIf `repl` is a string, then its value is used for replacement.\nThe character `%` works as an escape character:\nany sequence in `repl` of the form `%*n*`,\nwith *n* between 1 and 9,\nstands for the value of the *n*-th captured substring (see below).\nThe sequence `%0` stands for the whole match.\nThe sequence `%%` stands for a single `%`.\n\nIf `repl` is a table, then the table is queried for every match,\nusing the first capture as the key;\nif the pattern specifies no captures,\nthen the whole match is used as the key.\n\nIf `repl` is a function, then this function is called every time a\nmatch occurs, with all captured substrings passed as arguments,\nin order;\nif the pattern specifies no captures,\nthen the whole match is passed as a sole argument.\n\nIf the value returned by the table query or by the function call\nis a string or a number,\nthen it is used as the replacement string;\notherwise, if it is **false** or **nil**,\nthen there is no replacement\n(that is, the original match is kept in the string).\n\nHere are some examples:\n\n```lua\n     x = string.gsub(\"hello world\", \"(%w+)\", \"%1 %1\")\n     --> x=\"hello hello world world\"\n     \n     x = string.gsub(\"hello world\", \"%w+\", \"%0 %0\", 1)\n     --> x=\"hello hello world\"\n     \n     x = string.gsub(\"hello world from Lua\", \"(%w+)%s*(%w+)\", \"%2 %1\")\n     --> x=\"world hello Lua from\"\n     \n     x = string.gsub(\"home = $HOME, user = $USER\", \"%$(%w+)\", os.getenv)\n     --> x=\"home = /home/roberto, user = roberto\"\n     \n     x = string.gsub(\"4+5 = $return 4+5$\", \"%$(.-)%$\", function (s)\n           return loadstring(s)()\n         end)\n     --> x=\"4+5 = 9\"\n     \n     local t = {name=\"lua\", version=\"5.1\"}\n     x = string.gsub(\"$name-$version.tar.gz\", \"%$(%w+)\", t)\n     --> x=\"lua-5.1.tar.gz\"\n```"}}, len = {binding = "string.len", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s"}, ["fnl/docstring"] = "Receives a string and returns its length.\nThe empty string `\"\"` has length 0.\nEmbedded zeros are counted,\nso `\"a\\000bc\\000\"` has length 5."}}, lower = {binding = "string.lower", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s"}, ["fnl/docstring"] = "Receives a string and returns a copy of this string with all\nuppercase letters changed to lowercase.\nAll other characters are left unchanged.\nThe definition of what an uppercase letter is depends on the current locale."}}, match = {binding = "string.match", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "pattern", "?init"}, ["fnl/docstring"] = "Looks for the first *match* of\n`pattern` in the string `s`.\nIf it finds one, then `match` returns\nthe captures from the pattern;\notherwise it returns **nil**.\nIf `pattern` specifies no captures,\nthen the whole match is returned.\nA third, optional numerical argument `?init` specifies\nwhere to start the search;\nits default value is 1 and can be negative."}}, rep = {binding = "string.rep", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "n"}, ["fnl/docstring"] = "Returns a string that is the concatenation of `n` copies of\nthe string `s`."}}, reverse = {binding = "string.reverse", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s"}, ["fnl/docstring"] = "Returns a string that is the string `s` reversed."}}, sub = {binding = "string.sub", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "i", "?j"}, ["fnl/docstring"] = "Returns the substring of `s` that\nstarts at `i`  and continues until `?j`;\n`i` and `?j` can be negative.\nIf `?j` is absent, then it is assumed to be equal to -1\n(which is the same as the string length).\nIn particular,\nthe call `string.sub(s,1,j)` returns a prefix of `s`\nwith length `?j`,\nand `string.sub(s, -i)` returns a suffix of `s`\nwith length `i`."}}, upper = {binding = "string.upper", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s"}, ["fnl/docstring"] = "Receives a string and returns a copy of this string with all\nlowercase letters changed to uppercase.\nAll other characters are left unchanged.\nThe definition of what a lowercase letter is depends on the current locale."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "This library provides generic functions for string manipulation,\nsuch as finding and extracting substrings, and pattern matching.\nWhen indexing a string in Lua, the first character is at position 1\n(not at 0, as in C).\nIndices are allowed to be negative and are interpreted as indexing backwards,\nfrom the end of the string.\nThus, the last character is at position -1, and so on.\n\nThe string library provides all its functions inside the table\n`string`.\nIt also sets a metatable for strings\nwhere the `__index` field points to the `string` table.\nTherefore, you can use the string functions in object-oriented style.\nFor instance, `string.byte(s, i)`\ncan be written as `s:byte(i)`.\n\nThe string library assumes one-byte character encodings."}}, table = {binding = "table", fields = {concat = {binding = "table.concat", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"table", "?sep", "?i", "?j"}, ["fnl/docstring"] = "Given an array where all elements are strings or numbers,\nreturns `table[i]..sep..table[i+1] ... sep..table[j]`.\nThe default value for `?sep` is the empty string,\nthe default for `?i` is 1,\nand the default for `?j` is the length of the table.\nIf `?i` is greater than `?j`, returns the empty string."}}, insert = {binding = "table.insert", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"table", "value"}, ["fnl/docstring"] = "Inserts element `value` at position `pos` in `table`,\nshifting up other elements to open space, if necessary.\nThe default value for `pos` is `n+1`,\nwhere `n` is the length of the table\nso that a call `table.insert(t,x)` inserts `x` at the end\nof table `t`."}}, maxn = {binding = "table.maxn", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"table"}, ["fnl/docstring"] = "Returns the largest positive numerical index of the given table,\nor zero if the table has no positive numerical indices.\n(To do its job this function does a linear traversal of\nthe whole table.)"}}, remove = {binding = "table.remove", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"table", "?pos"}, ["fnl/docstring"] = "Removes from `table` the element at position `?pos`,\nshifting down other elements to close the space, if necessary.\nReturns the value of the removed element.\nThe default value for `?pos` is `n`,\nwhere `n` is the length of the table,\nso that a call `table.remove(t)` removes the last element\nof table `t`."}}, sort = {binding = "table.sort", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"table", "?comp"}, ["fnl/docstring"] = "Sorts table elements in a given order, *in-place*,\nfrom `table[1]` to `table[n]`,\nwhere `n` is the length of the table.\nIf `?comp` is given,\nthen it must be a function that receives two table elements,\nand returns true\nwhen the first is less than the second\n(so that `not comp(a[i+1],a[i])` will be true after the sort).\nIf `?comp` is not given,\nthen the standard Lua operator `<` is used instead.\n\nThe sort algorithm is not stable;\nthat is, elements considered equal by the given order\nmay have their relative positions changed by the sort."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "This library provides generic functions for table manipulation.\nIt provides all its functions inside the table `table`.\n\nMost functions in the table library assume that the table\nrepresents an array or a list.\nFor these functions, when we talk about the \"length\" of a table\nwe mean the result of the length operator."}}, tonumber = {binding = "tonumber", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"e", "?base"}, ["fnl/docstring"] = "Tries to convert its argument to a number.\nIf the argument is already a number or a string convertible\nto a number, then `tonumber` returns this number;\notherwise, it returns **nil**.\n\nAn optional argument specifies the base to interpret the numeral.\nThe base may be any integer between 2 and 36, inclusive.\nIn bases above 10, the letter `\"A\"` (in either upper or lower case)\nrepresents 10, `\"B\"` represents 11, and so forth,\nwith `\"Z\"` representing 35.\nIn base 10 (the default), the number can have a decimal part,\nas well as an optional exponent part\nIn other bases, only unsigned integers are accepted."}}, tostring = {binding = "tostring", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"e"}, ["fnl/docstring"] = "Receives an argument of any type and\nconverts it to a string in a reasonable format.\nFor complete control of how numbers are converted,\nuse `string.format`.\n\nIf the metatable of `e` has a `\"__tostring\"` field,\nthen `tostring` calls the corresponding value\nwith `e` as argument,\nand uses the result of the call as its result."}}, type = {binding = "type", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"v"}, ["fnl/docstring"] = "Returns the type of its only argument, coded as a string.\nThe possible results of this function are\n`\"nil\"` (a string, not the value **nil**),\n`\"number\"`,\n`\"string\"`,\n`\"boolean\"`,\n`\"table\"`,\n`\"function\"`,\n`\"thread\"`,\nand `\"userdata\"`."}}, unpack = {binding = "unpack", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"list", "?i", "?j"}, ["fnl/docstring"] = "Returns the elements from the given table.\nThis function is equivalent to\n\n```lua\n     return list[i], list[i+1], ..., list[j]\n```\nexcept that the above code can be written only for a fixed number\nof elements.\nBy default, `?i` is 1 and `?j` is the length of the list,\nas defined by the length operator"}}, xpcall = {binding = "xpcall", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f", "err"}, ["fnl/docstring"] = "This function is similar to `pcall`,\nexcept that you can set a new error handler.\n\n`xpcall` calls function `f` in protected mode,\nusing `err` as the error handler.\nAny error inside `f` is not propagated;\ninstead, `xpcall` catches the error,\ncalls the `err` function with the original error object,\nand returns a status code.\nIts first result is the status code (a boolean),\nwhich is true if the call succeeds without errors.\nIn this case, `xpcall` also returns all results from the call,\nafter this first result.\nIn case of any error,\n`xpcall` returns **false** plus the result from `err`."}}}
  local file_fields = {close = {binding = "file:close", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"self"}, ["fnl/docstring"] = "Closes `file`.\nNote that files are automatically closed when\ntheir handles are garbage collected,\nbut that takes an unpredictable amount of time to happen."}}, flush = {binding = "file:flush", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"self"}, ["fnl/docstring"] = "Saves any written data to `file`."}}, lines = {binding = "file:lines", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"self"}, ["fnl/docstring"] = "Returns an iterator function that,\neach time it is called,\nreturns a new line from the file.\nTherefore, the construction\n\n```lua\n     for line in file:lines() do *body* end\n```\nwill iterate over all lines of the file.\n(Unlike `io.lines`, this function does not close the file\nwhen the loop ends.)"}}, read = {binding = "file:read", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"self", "..."}, ["fnl/docstring"] = "Reads the file `file`,\naccording to the given formats, which specify what to read.\nFor each format,\nthe function returns a string (or a number) with the characters read,\nor **nil** if it cannot read data with the specified format.\nWhen called without formats,\nit uses a default format that reads the entire next line\n(see below).\n\nThe available formats are\n\n* **\"*n\":**\n  reads a number;\n  this is the only format that returns a number instead of a string.\n\n* **\"*a\":**\n  reads the whole file, starting at the current position.\n  On end of file, it returns the empty string.\n\n* **\"*l\":**\n  reads the next line (skipping the end of line),\n  returning **nil** on end of file.\n  This is the default format.\n\n* ***number*:**\n  reads a string with up to this number of characters,\n  returning **nil** on end of file.\n  If number is zero,\n  it reads nothing and returns an empty string,\n  or **nil** on end of file."}}, seek = {binding = "file:seek", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"self", "[whence]", "?offset"}, ["fnl/docstring"] = "Sets and gets the file position,\nmeasured from the beginning of the file,\nto the position given by `?offset` plus a base\nspecified by the string `whence`, as follows:\n\n* **\"set\":** base is position 0 (beginning of the file);\n* **\"cur\":** base is current position;\n* **\"end\":** base is end of file;\n\nIn case of success, function `seek` returns the final file position,\nmeasured in bytes from the beginning of the file.\nIf this function fails, it returns **nil**,\nplus a string describing the error.\n\nThe default value for `whence` is `\"cur\"`,\nand for `?offset` is 0.\nTherefore, the call `file:seek()` returns the current\nfile position, without changing it;\nthe call `file:seek(\"set\")` sets the position to the\nbeginning of the file (and returns 0);\nand the call `file:seek(\"end\")` sets the position to the\nend of the file, and returns its size."}}, setvbuf = {binding = "file:setvbuf", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"self", "mode", "?size"}, ["fnl/docstring"] = "Sets the buffering mode for an output file.\nThere are three available modes:\n\n* **\"no\":**\n  no buffering; the result of any output operation appears immediately.\n\n* **\"full\":**\n  full buffering; output operation is performed only\n  when the buffer is full (or when you explicitly `flush` the file\n  (see `io.flush`)).\n\n* **\"line\":**\n  line buffering; output is buffered until a newline is output\n  or there is any input from some special files\n  (such as a terminal device).\n\nFor the last two cases, `?size`\nspecifies the size of the buffer, in bytes.\nThe default is an appropriate size."}}, write = {binding = "file:write", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"self", "..."}, ["fnl/docstring"] = "Writes the value of each of its arguments to\nthe `file`.\nThe arguments must be strings or numbers.\nTo write other values,\nuse `tostring` or `string.format` before `write`."}}}
  docs._G.fields = docs
  docs.io.fields.stdin.fields = file_fields
  docs.io.fields.stdout.fields = file_fields
  docs.io.fields.stderr.fields = file_fields
  return docs
end
package.preload["fennel-ls.docs.generated.lua52"] = package.preload["fennel-ls.docs.generated.lua52"] or function(...)
  local docs = {_G = {binding = "_G", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "A global variable (not a function) that\nholds the global environment\nLua itself does not use this variable;\nchanging its value does not affect any environment,\nnor vice-versa."}}, _VERSION = {binding = "_VERSION", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "A global variable (not a function) that\nholds a string containing the current interpreter version.\nThe current contents of this variable is `\"Lua 5.2\"`."}}, arg = {binding = "arg", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "Before starting to run the script,\n`lua` collects all arguments in the command line\nin a global table called `arg`.\nThe script name is stored at index 0,\nthe first argument after the script name goes to index 1,\nand so on.\nAny arguments before the script name\n(that is, the interpreter name plus the options)\ngo to negative indices.\nFor instance, in the call\n\n```lua\n     $ lua -la b.lua t1 t2\n```\nthe interpreter first runs the file `a.lua`,\nthen creates a table\n\n```lua\n     arg = { [-2] = \"lua\", [-1] = \"-la\",\n             [0] = \"b.lua\",\n             [1] = \"t1\", [2] = \"t2\" }\n```\nand finally runs the file `b.lua`.\nThe script is called with `arg[1]`, `arg[2]`, ...\nas arguments;\nit can also access these arguments with the vararg expression `\"...\"`."}}, assert = {binding = "assert", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"v", "?message"}, ["fnl/docstring"] = "Issues an  error when\nthe value of its argument `v` is false (i.e., **nil** or **false**);\notherwise, returns all its arguments.\n`?message` is an error message;\nwhen absent, it defaults to \"assertion failed!\""}}, bit32 = {binding = "bit32", fields = {arshift = {binding = "bit32.arshift", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x", "disp"}, ["fnl/docstring"] = "Returns the number `x` shifted `disp` bits to the right.\nThe number `disp` may be any representable integer.\nNegative displacements shift to the left.\n\nThis shift operation is what is called arithmetic shift.\nVacant bits on the left are filled\nwith copies of the higher bit of `x`;\nvacant bits on the right are filled with zeros.\nIn particular,\ndisplacements with absolute values higher than 31\nresult in zero or `0xFFFFFFFF` (all original bits are shifted out)."}}, band = {binding = "bit32.band", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"..."}, ["fnl/docstring"] = "Returns the bitwise *and* of its operands."}}, bnot = {binding = "bit32.bnot", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the bitwise negation of `x`.\nFor any integer `x`,\nthe following identity holds:\n\n```lua\n     assert(bit32.bnot(x) == (-1 - x) % 2^32)\n```"}}, bor = {binding = "bit32.bor", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"..."}, ["fnl/docstring"] = "Returns the bitwise *or* of its operands."}}, btest = {binding = "bit32.btest", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"..."}, ["fnl/docstring"] = "Returns a boolean signaling\nwhether the bitwise *and* of its operands is different from zero."}}, bxor = {binding = "bit32.bxor", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"..."}, ["fnl/docstring"] = "Returns the bitwise *exclusive or* of its operands."}}, extract = {binding = "bit32.extract", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"n", "field", "?width"}, ["fnl/docstring"] = "Returns the unsigned number formed by the bits\n`field` to `field + width - 1` from `n`.\nBits are numbered from 0 (least significant) to 31 (most significant).\nAll accessed bits must be in the range *[0, 31]*.\n\nThe default for `?width` is 1."}}, lrotate = {binding = "bit32.lrotate", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x", "disp"}, ["fnl/docstring"] = "Returns the number `x` rotated `disp` bits to the left.\nThe number `disp` may be any representable integer.\n\nFor any valid displacement,\nthe following identity holds:\n\n```lua\n     assert(bit32.lrotate(x, disp) == bit32.lrotate(x, disp % 32))\n```\nIn particular,\nnegative displacements rotate to the right."}}, lshift = {binding = "bit32.lshift", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x", "disp"}, ["fnl/docstring"] = "Returns the number `x` shifted `disp` bits to the left.\nThe number `disp` may be any representable integer.\nNegative displacements shift to the right.\nIn any direction, vacant bits are filled with zeros.\nIn particular,\ndisplacements with absolute values higher than 31\nresult in zero (all bits are shifted out).\n\nFor positive displacements,\nthe following equality holds:\n\n```lua\n     assert(bit32.lshift(b, disp) == (b * 2^disp) % 2^32)\n```"}}, replace = {binding = "bit32.replace", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"n", "v", "field", "?width"}, ["fnl/docstring"] = "Returns a copy of `n` with\nthe bits `field` to `field + width - 1`\nreplaced by the value `v`.\nSee `bit32.extract` for details about `field` and `?width`."}}, rrotate = {binding = "bit32.rrotate", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x", "disp"}, ["fnl/docstring"] = "Returns the number `x` rotated `disp` bits to the right.\nThe number `disp` may be any representable integer.\n\nFor any valid displacement,\nthe following identity holds:\n\n```lua\n     assert(bit32.rrotate(x, disp) == bit32.rrotate(x, disp % 32))\n```\nIn particular,\nnegative displacements rotate to the left."}}, rshift = {binding = "bit32.rshift", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x", "disp"}, ["fnl/docstring"] = "Returns the number `x` shifted `disp` bits to the right.\nThe number `disp` may be any representable integer.\nNegative displacements shift to the left.\nIn any direction, vacant bits are filled with zeros.\nIn particular,\ndisplacements with absolute values higher than 31\nresult in zero (all bits are shifted out).\n\nFor positive displacements,\nthe following equality holds:\n\n```lua\n     assert(bit32.rshift(b, disp) == math.floor(b % 2^32 / 2^disp))\n```\n\nThis shift operation is what is called logical shift."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "This library provides bitwise operations.\nIt provides all its functions inside the table `bit32`.\n\nUnless otherwise stated,\nall functions accept numeric arguments in the range\n*(-2\226\129\181\194\185,+2\226\129\181\194\185)*;\neach argument is normalized to\nthe remainder of its division by *2\194\179\194\178*\nand truncated to an integer (in some unspecified way),\nso that its final value falls in the range *[0,2\194\179\194\178 - 1]*.\nSimilarly, all results are in the range *[0,2\194\179\194\178 - 1]*.\nNote that `bit32.bnot(0)` is `0xFFFFFFFF`,\nwhich is different from `-1`."}}, collectgarbage = {binding = "collectgarbage", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?opt", "?arg"}, ["fnl/docstring"] = "This function is a generic interface to the garbage collector.\nIt performs different functions according to its first argument, `?opt`:\n\n* **`\"collect\"`: **\n  performs a full garbage-collection cycle.\n  This is the default option.\n\n* **`\"stop\"`: **\n  stops automatic execution of the garbage collector.\n  The collector will run only when explicitly invoked,\n  until a call to restart it.\n\n* **`\"restart\"`: **\n  restarts automatic execution of the garbage collector.\n\n* **`\"count\"`: **\n  returns the total memory in use by Lua (in Kbytes) and\n  a second value with the total memory in bytes modulo 1024.\n  The first value has a fractional part,\n  so the following equality is always true:\n\n  ```lua\n       k, b = collectgarbage(\"count\")\n       assert(k*1024 == math.floor(k)*1024 + b)\n  ```\n  (The second result is useful when Lua is compiled\n  with a non floating-point type for numbers.)\n\n* **`\"step\"`: **\n  performs a garbage-collection step.\n  The step \"size\" is controlled by `?arg`\n  (larger values mean more steps) in a non-specified way.\n  If you want to control the step size\n  you must experimentally tune the value of `?arg`.\n  Returns **true** if the step finished a collection cycle.\n\n* **`\"setpause\"`: **\n  sets `?arg` as the new value for the *pause* of\n  the collector\n  Returns the previous value for *pause*.\n\n* **`\"setstepmul\"`: **\n  sets `?arg` as the new value for the *step multiplier* of\n  the collector\n  Returns the previous value for *step*.\n\n* **`\"isrunning\"`: **\n  returns a boolean that tells whether the collector is running\n  (i.e., not stopped).\n\n* **`\"generational\"`: **\n  changes the collector to generational mode.\n  This is an experimental feature\n\n* **`\"incremental\"`: **\n  changes the collector to incremental mode.\n  This is the default mode."}}, coroutine = {binding = "coroutine", fields = {create = {binding = "coroutine.create", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f"}, ["fnl/docstring"] = "Creates a new coroutine, with body `f`.\n`f` must be a Lua function.\nReturns this new coroutine,\nan object with type `\"thread\"`."}}, resume = {binding = "coroutine.resume", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"co", "?val1", "..."}, ["fnl/docstring"] = "Starts or continues the execution of coroutine `co`.\nThe first time you resume a coroutine,\nit starts running its body.\nThe values `?val1`, ... are passed\nas the arguments to the body function.\nIf the coroutine has yielded,\n`resume` restarts it;\nthe values `?val1`, ... are passed\nas the results from the yield.\n\nIf the coroutine runs without any errors,\n`resume` returns **true** plus any values passed to `yield`\n(if the coroutine yields) or any values returned by the body function\n(if the coroutine terminates).\nIf there is any error,\n`resume` returns **false** plus the error message."}}, running = {binding = "coroutine.running", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {}, ["fnl/docstring"] = "Returns the running coroutine plus a boolean,\ntrue when the running coroutine is the main one."}}, status = {binding = "coroutine.status", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"co"}, ["fnl/docstring"] = "Returns the status of coroutine `co`, as a string:\n`\"running\"`,\nif the coroutine is running (that is, it called `status`);\n`\"suspended\"`, if the coroutine is suspended in a call to `yield`,\nor if it has not started running yet;\n`\"normal\"` if the coroutine is active but not running\n(that is, it has resumed another coroutine);\nand `\"dead\"` if the coroutine has finished its body function,\nor if it has stopped with an error."}}, wrap = {binding = "coroutine.wrap", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f"}, ["fnl/docstring"] = "Creates a new coroutine, with body `f`.\n`f` must be a Lua function.\nReturns a function that resumes the coroutine each time it is called.\nAny arguments passed to the function behave as the\nextra arguments to `resume`.\nReturns the same values returned by `resume`,\nexcept the first boolean.\nIn case of error, propagates the error."}}, yield = {binding = "coroutine.yield", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"..."}, ["fnl/docstring"] = "Suspends the execution of the calling coroutine.\nAny arguments to `yield` are passed as extra results to `resume`."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "The operations related to coroutines comprise a sub-library of\nthe basic library and come inside the table `coroutine`."}}, debug = {binding = "debug", fields = {debug = {binding = "debug.debug", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {}, ["fnl/docstring"] = "Enters an interactive mode with the user,\nrunning each string that the user enters.\nUsing simple commands and other debug facilities,\nthe user can inspect global and local variables,\nchange their values, evaluate expressions, and so on.\nA line containing only the word `cont` finishes this function,\nso that the caller continues its execution.\n\nNote that commands for `debug.debug` are not lexically nested\nwithin any function and so have no direct access to local variables."}}, gethook = {binding = "debug.gethook", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?thread"}, ["fnl/docstring"] = "Returns the current hook settings of the thread, as three values:\nthe current hook function, the current hook mask,\nand the current hook count\n(as set by the `debug.sethook` function)."}}, getinfo = {binding = "debug.getinfo", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f", "?what"}, ["fnl/docstring"] = "Returns a table with information about a function.\nYou can give the function directly\nor you can give a number as the value of `f`,\nwhich means the function running at level `f` of the call stack\nof the given thread:\nlevel 0 is the current function (`getinfo` itself);\nlevel 1 is the function that called `getinfo`\n(except for tail calls, which do not count on the stack);\nand so on.\nIf `f` is a number larger than the number of active functions,\nthen `getinfo` returns **nil**.\n\nThe returned table can contain all the fields returned by `lua_getinfo`,\nwith the string `?what` describing which fields to fill in.\nThe default for `?what` is to get all information available,\nexcept the table of valid lines.\nIf present,\nthe option `\"f\"`\nadds a field named `func` with the function itself.\nIf present,\nthe option `\"L\"`\nadds a field named `activelines` with the table of\nvalid lines.\n\nFor instance, the expression `debug.getinfo(1,\"n\").name` returns\na table with a name for the current function,\nif a reasonable name can be found,\nand the expression `debug.getinfo(print)`\nreturns a table with all available information\nabout the `print` function."}}, getlocal = {binding = "debug.getlocal", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f", "local"}, ["fnl/docstring"] = "This function returns the name and the value of the local variable\nwith index `local` of the function at level `f` of the stack.\nThis function accesses not only explicit local variables,\nbut also parameters, temporaries, etc.\n\nThe first parameter or local variable has index 1, and so on,\nuntil the last active variable.\nNegative indices refer to vararg parameters;\n-1 is the first vararg parameter.\nThe function returns **nil** if there is no variable with the given index,\nand raises an error when called with a level out of range.\n(You can call `debug.getinfo` to check whether the level is valid.)\n\nVariable names starting with `\"(\"` (open parenthesis)\nrepresent internal variables\n(loop control variables, temporaries, varargs, and C function locals).\n\nThe parameter `f` may also be a function.\nIn that case, `getlocal` returns only the name of function parameters."}}, getmetatable = {binding = "debug.getmetatable", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"value"}, ["fnl/docstring"] = "Returns the metatable of the given `value`\nor **nil** if it does not have a metatable."}}, getregistry = {binding = "debug.getregistry", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {}, ["fnl/docstring"] = "Returns the registry table"}}, getupvalue = {binding = "debug.getupvalue", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f", "up"}, ["fnl/docstring"] = "This function returns the name and the value of the upvalue\nwith index `up` of the function `f`.\nThe function returns **nil** if there is no upvalue with the given index."}}, getuservalue = {binding = "debug.getuservalue", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"u"}, ["fnl/docstring"] = "Returns the Lua value associated to `u`.\nIf `u` is not a userdata,\nreturns **nil**."}}, sethook = {binding = "debug.sethook", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"hook", "mask", "?count"}, ["fnl/docstring"] = "Sets the given function as a hook.\nThe string `mask` and the number `?count` describe\nwhen the hook will be called.\nThe string mask may have any combination of the following characters,\nwith the given meaning:\n\n* **`\"c\"`: ** the hook is called every time Lua calls a function;\n* **`\"r\"`: ** the hook is called every time Lua returns from a function;\n* **`\"l\"`: ** the hook is called every time Lua enters a new line of code.\n\nMoreover,\nwith a `?count` different from zero,\nthe hook is called also after every `?count` instructions.\n\nWhen called without arguments,\n`debug.sethook` turns off the hook.\n\nWhen the hook is called, its first parameter is a string\ndescribing the event that has triggered its call:\n`\"call\"` (or `\"tail call\"`),\n`\"return\"`,\n`\"line\"`, and `\"count\"`.\nFor line events,\nthe hook also gets the new line number as its second parameter.\nInside a hook,\nyou can call `getinfo` with level 2 to get more information about\nthe running function\n(level 0 is the `getinfo` function,\nand level 1 is the hook function)."}}, setlocal = {binding = "debug.setlocal", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"level", "local", "value"}, ["fnl/docstring"] = "This function assigns the value `value` to the local variable\nwith index `local` of the function at level `level` of the stack.\nThe function returns **nil** if there is no local\nvariable with the given index,\nand raises an error when called with a `level` out of range.\n(You can call `getinfo` to check whether the level is valid.)\nOtherwise, it returns the name of the local variable.\n\nSee `debug.getlocal` for more information about\nvariable indices and names."}}, setmetatable = {binding = "debug.setmetatable", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"value", "table"}, ["fnl/docstring"] = "Sets the metatable for the given `value` to the given `table`\n(which can be **nil**).\nReturns `value`."}}, setupvalue = {binding = "debug.setupvalue", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f", "up", "value"}, ["fnl/docstring"] = "This function assigns the value `value` to the upvalue\nwith index `up` of the function `f`.\nThe function returns **nil** if there is no upvalue\nwith the given index.\nOtherwise, it returns the name of the upvalue."}}, setuservalue = {binding = "debug.setuservalue", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"udata", "value"}, ["fnl/docstring"] = "Sets the given `value` as\nthe Lua value associated to the given `udata`.\n`value` must be a table or **nil**;\n`udata` must be a full userdata.\n\nReturns `udata`."}}, traceback = {binding = "debug.traceback", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?message", "?level"}, ["fnl/docstring"] = "If `?message` is present but is neither a string nor **nil**,\nthis function returns `?message` without further processing.\nOtherwise,\nit returns a string with a traceback of the call stack.\nAn optional `?message` string is appended\nat the beginning of the traceback.\nAn optional `?level` number tells at which level\nto start the traceback\n(default is 1, the function calling `traceback`)."}}, upvalueid = {binding = "debug.upvalueid", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f", "n"}, ["fnl/docstring"] = "Returns an unique identifier (as a light userdata)\nfor the upvalue numbered `n`\nfrom the given function.\n\nThese unique identifiers allow a program to check whether different\nclosures share upvalues.\nLua closures that share an upvalue\n(that is, that access a same external local variable)\nwill return identical ids for those upvalue indices."}}, upvaluejoin = {binding = "debug.upvaluejoin", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f1", "n1", "f2", "n2"}, ["fnl/docstring"] = "Make the `n1`-th upvalue of the Lua closure `f1`\nrefer to the `n2`-th upvalue of the Lua closure `f2`."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "This library provides\nthe functionality of the debug interfaceto Lua programs.\nYou should exert care when using this library.\nSeveral of its functions\nviolate basic assumptions about Lua code\n(e.g., that variables local to a function\ncannot be accessed from outside;\nthat userdata metatables cannot be changed by Lua code;\nthat Lua programs do not crash)\nand therefore can compromise otherwise secure code.\nMoreover, some functions in this library may be slow.\n\nAll functions in this library are provided\ninside the `debug` table.\nAll functions that operate over a thread\nhave an optional first argument which is the\nthread to operate over.\nThe default is always the current thread."}}, dofile = {binding = "dofile", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?filename"}, ["fnl/docstring"] = "Opens the named file and executes its contents as a Lua chunk.\nWhen called without arguments,\n`dofile` executes the contents of the standard input (`stdin`).\nReturns all values returned by the chunk.\nIn case of errors, `dofile` propagates the error\nto its caller (that is, `dofile` does not run in protected mode)."}}, error = {binding = "error", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"message", "?level"}, ["fnl/docstring"] = "Terminates the last protected function called\nand returns `message` as the error message.\nFunction `error` never returns.\n\nUsually, `error` adds some information about the error position\nat the beginning of the message, if the message is a string.\nThe `?level` argument specifies how to get the error position.\nWith level 1 (the default), the error position is where the\n`error` function was called.\nLevel 2 points the error to where the function\nthat called `error` was called; and so on.\nPassing a level 0 avoids the addition of error position information\nto the message."}}, getmetatable = {binding = "getmetatable", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"object"}, ["fnl/docstring"] = "If `object` does not have a metatable, returns **nil**.\nOtherwise,\nif the object's metatable has a `\"__metatable\"` field,\nreturns the associated value.\nOtherwise, returns the metatable of the given object."}}, io = {binding = "io", fields = {close = {binding = "io.close", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?file"}, ["fnl/docstring"] = "Equivalent to `file:close()`.\nWithout a `?file`, closes the default output file."}}, flush = {binding = "io.flush", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {}, ["fnl/docstring"] = "Equivalent to `io.output():flush()`."}}, input = {binding = "io.input", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?file"}, ["fnl/docstring"] = "When called with a file name, it opens the named file (in text mode),\nand sets its handle as the default input file.\nWhen called with a file handle,\nit simply sets this file handle as the default input file.\nWhen called without parameters,\nit returns the current default input file.\n\nIn case of errors this function raises the error,\ninstead of returning an error code."}}, lines = {binding = "io.lines", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?filename", "..."}, ["fnl/docstring"] = "Opens the given file name in read mode\nand returns an iterator function that\nworks like `file:lines(...)` over the opened file.\nWhen the iterator function detects the end of file,\nit returns **nil** (to finish the loop) and automatically closes the file.\n\nThe call `io.lines()` (with no file name) is equivalent\nto `io.input():lines()`;\nthat is, it iterates over the lines of the default input file.\nIn this case it does not close the file when the loop ends.\n\nIn case of errors this function raises the error,\ninstead of returning an error code."}}, open = {binding = "io.open", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"filename", "?mode"}, ["fnl/docstring"] = "This function opens a file,\nin the mode specified in the string `?mode`.\nIt returns a new file handle,\nor, in case of errors, **nil** plus an error message.\n\nThe `?mode` string can be any of the following:\n\n* **`\"r\"`: ** read mode (the default);\n* **`\"w\"`: ** write mode;\n* **`\"a\"`: ** append mode;\n* **`\"r+\"`: ** update mode, all previous data is preserved;\n* **`\"w+\"`: ** update mode, all previous data is erased;\n* **`\"a+\"`: ** append update mode, previous data is preserved,\n    writing is only allowed at the end of file.\n\nThe `?mode` string can also have a `\"b\"` at the end,\nwhich is needed in some systems to open the file in binary mode."}}, output = {binding = "io.output", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?file"}, ["fnl/docstring"] = "Similar to `io.input`, but operates over the default output file."}}, popen = {binding = "io.popen", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"prog", "?mode"}, ["fnl/docstring"] = "This function is system dependent and is not available\non all platforms.\n\nStarts program `prog` in a separated process and returns\na file handle that you can use to read data from this program\n(if `?mode` is `\"r\"`, the default)\nor to write data to this program\n(if `?mode` is `\"w\"`)."}}, read = {binding = "io.read", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"..."}, ["fnl/docstring"] = "Equivalent to `io.input():read(...)`."}}, stderr = {binding = "io.stderr", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "stderr file"}}, stdin = {binding = "io.stdin", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "stdin file"}}, stdout = {binding = "io.stdout", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "stdout file"}}, tmpfile = {binding = "io.tmpfile", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {}, ["fnl/docstring"] = "Returns a handle for a temporary file.\nThis file is opened in update mode\nand it is automatically removed when the program ends."}}, type = {binding = "io.type", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"obj"}, ["fnl/docstring"] = "Checks whether `obj` is a valid file handle.\nReturns the string `\"file\"` if `obj` is an open file handle,\n`\"closed file\"` if `obj` is a closed file handle,\nor **nil** if `obj` is not a file handle."}}, write = {binding = "io.write", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"..."}, ["fnl/docstring"] = "Equivalent to `io.output():write(...)`."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "The I/O library provides two different styles for file manipulation.\nThe first one uses implicit file descriptors;\nthat is, there are operations to set a default input file and a\ndefault output file,\nand all input/output operations are over these default files.\nThe second style uses explicit file descriptors.\n\nWhen using implicit file descriptors,\nall operations are supplied by table `io`.\nWhen using explicit file descriptors,\nthe operation `io.open` returns a file descriptor\nand then all operations are supplied as methods of the file descriptor.\n\nThe table `io` also provides\nthree predefined file descriptors with their usual meanings from C:\n`io.stdin`, `io.stdout`, and `io.stderr`.\nThe I/O library never closes these files.\n\nUnless otherwise stated,\nall I/O functions return **nil** on failure\n(plus an error message as a second result and\na system-dependent error code as a third result)\nand some value different from **nil** on success.\nOn non-Posix systems,\nthe computation of the error message and error code\nin case of errors\nmay be not thread safe,\nbecause they rely on the global C variable `errno`."}}, ipairs = {binding = "ipairs", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"t"}, ["fnl/docstring"] = "If `t` has a metamethod `__ipairs`,\ncalls it with `t` as argument and returns the first three\nresults from the call.\n\nOtherwise,\nreturns three values: an iterator function, the table `t`, and 0,\nso that the construction\n\n```lua\n     for i,v in ipairs(t) do *body* end\n```\nwill iterate over the pairs (`1,t[1]`), (`2,t[2]`), ...,\nup to the first integer key absent from the table."}}, load = {binding = "load", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"ld", "?source", "?mode", "?env"}, ["fnl/docstring"] = "Loads a chunk.\n\nIf `ld` is a string, the chunk is this string.\nIf `ld` is a function,\n`load` calls it repeatedly to get the chunk pieces.\nEach call to `ld` must return a string that concatenates\nwith previous results.\nA return of an empty string, **nil**, or no value signals the end of the chunk.\n\nIf there are no syntactic errors,\nreturns the compiled chunk as a function;\notherwise, returns **nil** plus the error message.\n\nIf the resulting function has upvalues,\nthe first upvalue is set to the value of `?env`,\nif that parameter is given,\nor to the value of the global environment.\n(When you load a main chunk,\nthe resulting function will always have exactly one upvalue,\nthe `_ENV` variable\nWhen you load a binary chunk created from a function (see `string.dump`),\nthe resulting function can have arbitrary upvalues.)\n\n`?source` is used as the source of the chunk for error messages\nand debug information\nWhen absent,\nit defaults to `ld`, if `ld` is a string,\nor to `\"=(load)\"` otherwise.\n\nThe string `?mode` controls whether the chunk can be text or binary\n(that is, a precompiled chunk).\nIt may be the string `\"b\"` (only binary chunks),\n`\"t\"` (only text chunks),\nor `\"bt\"` (both binary and text).\nThe default is `\"bt\"`."}}, loadfile = {binding = "loadfile", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?filename", "?mode", "?env"}, ["fnl/docstring"] = "Similar to `load`,\nbut gets the chunk from file `?filename`\nor from the standard input,\nif no file name is given."}}, math = {binding = "math", fields = {abs = {binding = "math.abs", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the absolute value of `x`."}}, acos = {binding = "math.acos", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the arc cosine of `x` (in radians)."}}, asin = {binding = "math.asin", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the arc sine of `x` (in radians)."}}, atan = {binding = "math.atan", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the arc tangent of `x` (in radians)."}}, atan2 = {binding = "math.atan2", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"y", "x"}, ["fnl/docstring"] = "Returns the arc tangent of `y/x` (in radians),\nbut uses the signs of both parameters to find the\nquadrant of the result.\n(It also handles correctly the case of `x` being zero.)"}}, ceil = {binding = "math.ceil", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the smallest integer larger than or equal to `x`."}}, cos = {binding = "math.cos", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the cosine of `x` (assumed to be in radians)."}}, cosh = {binding = "math.cosh", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the hyperbolic cosine of `x`."}}, deg = {binding = "math.deg", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the angle `x` (given in radians) in degrees."}}, exp = {binding = "math.exp", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the value *e\203\163*."}}, floor = {binding = "math.floor", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the largest integer smaller than or equal to `x`."}}, fmod = {binding = "math.fmod", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x", "y"}, ["fnl/docstring"] = "Returns the remainder of the division of `x` by `y`\nthat rounds the quotient towards zero."}}, frexp = {binding = "math.frexp", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns `m` and `e` such that *x = m2\225\181\137*,\n`e` is an integer and the absolute value of `m` is\nin the range *[0.5, 1)*\n(or zero when `x` is zero)."}}, huge = {binding = "math.huge", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "The value `HUGE_VAL`,\na value larger than or equal to any other numerical value."}}, ldexp = {binding = "math.ldexp", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"m", "e"}, ["fnl/docstring"] = "Returns *m2\225\181\137* (`e` should be an integer)."}}, log = {binding = "math.log", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x", "?base"}, ["fnl/docstring"] = "Returns the logarithm of `x` in the given base.\nThe default for `?base` is *e*\n(so that the function returns the natural logarithm of `x`)."}}, max = {binding = "math.max", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x", "..."}, ["fnl/docstring"] = "Returns the maximum value among its arguments."}}, min = {binding = "math.min", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x", "..."}, ["fnl/docstring"] = "Returns the minimum value among its arguments."}}, modf = {binding = "math.modf", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns two numbers,\nthe integral part of `x` and the fractional part of `x`."}}, pi = {binding = "math.pi", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "The value of *\207\128*."}}, pow = {binding = "math.pow", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x", "y"}, ["fnl/docstring"] = "Returns *x\202\184*.\n(You can also use the expression `x^y` to compute this value.)"}}, rad = {binding = "math.rad", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the angle `x` (given in degrees) in radians."}}, random = {binding = "math.random", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?m", "?n"}, ["fnl/docstring"] = "This function is an interface to the simple\npseudo-random generator function `rand` provided by Standard C.\n(No guarantees can be given for its statistical properties.)\n\nWhen called without arguments,\nreturns a uniform pseudo-random real number\nin the range *[0,1)*.  \nWhen called with an integer number `?m`,\n`math.random` returns\na uniform pseudo-random integer in the range *[1, m]*.\nWhen called with two integer numbers `?m` and `?n`,\n`math.random` returns a uniform pseudo-random\ninteger in the range *[m, n]*."}}, randomseed = {binding = "math.randomseed", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Sets `x` as the \"seed\"\nfor the pseudo-random generator:\nequal seeds produce equal sequences of numbers."}}, sin = {binding = "math.sin", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the sine of `x` (assumed to be in radians)."}}, sinh = {binding = "math.sinh", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the hyperbolic sine of `x`."}}, sqrt = {binding = "math.sqrt", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the square root of `x`.\n(You can also use the expression `x^0.5` to compute this value.)"}}, tan = {binding = "math.tan", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the tangent of `x` (assumed to be in radians)."}}, tanh = {binding = "math.tanh", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the hyperbolic tangent of `x`."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "This library is an interface to the standard C math library.\nIt provides all its functions inside the table `math`."}}, next = {binding = "next", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"table", "?index"}, ["fnl/docstring"] = "Allows a program to traverse all fields of a table.\nIts first argument is a table and its second argument\nis an index in this table.\n`next` returns the next index of the table\nand its associated value.\nWhen called with **nil** as its second argument,\n`next` returns an initial index\nand its associated value.\nWhen called with the last index,\nor with **nil** in an empty table,\n`next` returns **nil**.\nIf the second argument is absent, then it is interpreted as **nil**.\nIn particular,\nyou can use `next(t)` to check whether a table is empty.\n\nThe order in which the indices are enumerated is not specified,\n*even for numeric indices*.\n(To traverse a table in numeric order,\nuse a numerical **for**.)\n\nThe behavior of `next` is undefined if,\nduring the traversal,\nyou assign any value to a non-existent field in the table.\nYou may however modify existing fields.\nIn particular, you may clear existing fields."}}, os = {binding = "os", fields = {clock = {binding = "os.clock", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {}, ["fnl/docstring"] = "Returns an approximation of the amount in seconds of CPU time\nused by the program."}}, date = {binding = "os.date", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?format", "?time"}, ["fnl/docstring"] = "Returns a string or a table containing date and time,\nformatted according to the given string `?format`.\n\nIf the `?time` argument is present,\nthis is the time to be formatted\n(see the `os.time` function for a description of this value).\nOtherwise, `date` formats the current time.\n\nIf `?format` starts with `\"!\"`,\nthen the date is formatted in Coordinated Universal Time.\nAfter this optional character,\nif `?format` is the string `\"*t\"`,\nthen `date` returns a table with the following fields:\n`year` (four digits), `month` (1\226\128\14712), `day` (1\226\128\14731),\n`hour` (0\226\128\14723), `min` (0\226\128\14759), `sec` (0\226\128\14761),\n`wday` (weekday, Sunday is 1),\n`yday` (day of the year),\nand `isdst` (daylight saving flag, a boolean).\nThis last field may be absent\nif the information is not available.\n\nIf `?format` is not `\"*t\"`,\nthen `date` returns the date as a string,\nformatted according to the same rules as the ISO C function `strftime`.\n\nWhen called without arguments,\n`date` returns a reasonable date and time representation that depends on\nthe host system and on the current locale\n(that is, `os.date()` is equivalent to `os.date(\"%c\")`).\n\nOn non-Posix systems,\nthis function may be not thread safe\nbecause of its reliance on C function `gmtime` and C function `localtime`."}}, difftime = {binding = "os.difftime", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"t2", "t1"}, ["fnl/docstring"] = "Returns the number of seconds from time `t1` to time `t2`.\nIn POSIX, Windows, and some other systems,\nthis value is exactly `t2`*-*`t1`."}}, execute = {binding = "os.execute", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?command"}, ["fnl/docstring"] = "This function is equivalent to the ISO C function `system`.\nIt passes `?command` to be executed by an operating system shell.\nIts first result is **true**\nif the command terminated successfully,\nor **nil** otherwise.\nAfter this first result\nthe function returns a string and a number,\nas follows:\n\n* **`\"exit\"`: **\n  the command terminated normally;\n  the following number is the exit status of the command.\n\n* **`\"signal\"`: **\n  the command was terminated by a signal;\n  the following number is the signal that terminated the command.\n\nWhen called without a `?command`,\n`os.execute` returns a boolean that is true if a shell is available."}}, exit = {binding = "os.exit", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?code", "?close"}, ["fnl/docstring"] = "Calls the ISO C function `exit` to terminate the host program.\nIf `?code` is **true**,\nthe returned status is `EXIT_SUCCESS`;\nif `?code` is **false**,\nthe returned status is `EXIT_FAILURE`;\nif `?code` is a number,\nthe returned status is this number.\nThe default value for `?code` is **true**.\n\nIf the optional second argument `?close` is true,\ncloses the Lua state before exiting."}}, getenv = {binding = "os.getenv", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"varname"}, ["fnl/docstring"] = "Returns the value of the process environment variable `varname`,\nor **nil** if the variable is not defined."}}, remove = {binding = "os.remove", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"filename"}, ["fnl/docstring"] = "Deletes the file (or empty directory, on POSIX systems)\nwith the given name.\nIf this function fails, it returns **nil**,\nplus a string describing the error and the error code."}}, rename = {binding = "os.rename", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"oldname", "newname"}, ["fnl/docstring"] = "Renames file or directory named `oldname` to `newname`.\nIf this function fails, it returns **nil**,\nplus a string describing the error and the error code."}}, setlocale = {binding = "os.setlocale", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"locale", "?category"}, ["fnl/docstring"] = "Sets the current locale of the program.\n`locale` is a system-dependent string specifying a locale;\n`?category` is an optional string describing which category to change:\n`\"all\"`, `\"collate\"`, `\"ctype\"`,\n`\"monetary\"`, `\"numeric\"`, or `\"time\"`;\nthe default category is `\"all\"`.\nThe function returns the name of the new locale,\nor **nil** if the request cannot be honored.\n\nIf `locale` is the empty string,\nthe current locale is set to an implementation-defined native locale.\nIf `locale` is the string `\"C\"`,\nthe current locale is set to the standard C locale.\n\nWhen called with **nil** as the first argument,\nthis function only returns the name of the current locale\nfor the given category.\n\nThis function may be not thread safe\nbecause of its reliance on C function `setlocale`."}}, time = {binding = "os.time", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?table"}, ["fnl/docstring"] = "Returns the current time when called without arguments,\nor a time representing the date and time specified by the given table.\nThis table must have fields `year`, `month`, and `day`,\nand may have fields\n`hour` (default is 12),\n`min` (default is 0),\n`sec` (default is 0),\nand `isdst` (default is **nil**).\nFor a description of these fields, see the `os.date` function.\n\nThe returned value is a number, whose meaning depends on your system.\nIn POSIX, Windows, and some other systems,\nthis number counts the number\nof seconds since some given start time (the \"epoch\").\nIn other systems, the meaning is not specified,\nand the number returned by `time` can be used only as an argument to\n`os.date` and `os.difftime`."}}, tmpname = {binding = "os.tmpname", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {}, ["fnl/docstring"] = "Returns a string with a file name that can\nbe used for a temporary file.\nThe file must be explicitly opened before its use\nand explicitly removed when no longer needed.\n\nOn POSIX systems,\nthis function also creates a file with that name,\nto avoid security risks.\n(Someone else might create the file with wrong permissions\nin the time between getting the name and creating the file.)\nYou still have to open the file to use it\nand to remove it (even if you do not use it).\n\nWhen possible,\nyou may prefer to use `io.tmpfile`,\nwhich automatically removes the file when the program ends."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "This library is implemented through table `os`."}}, package = {binding = "package", fields = {config = {binding = "package.config", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "A string describing some compile-time configurations for packages.\nThis string is a sequence of lines:\n\n* The first line is the directory separator string.\n  Default is `\"\\\"` for Windows and `\"/\"` for all other systems.\n\n* The second line is the character that separates templates in a path.\n  Default is `\";\"`.\n\n* The third line is the string that marks the\n  substitution points in a template.\n  Default is `\"?\"`.\n\n* The fourth line is a string that, in a path in Windows,\n  is replaced by the executable's directory.\n  Default is `\"!\"`.\n\n* The fifth line is a mark to ignore all text before it\n  when building the `luaopen_` function name.\n  Default is `\"-\"`."}}, cpath = {binding = "package.cpath", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "The path used by `require` to search for a C loader.\n\nLua initializes the C path `package.cpath` in the same way\nit initializes the Lua path `package.path`,\nusing the environment variable `LUA_CPATH_5_2`\nor the environment variable `LUA_CPATH`\nor a default path defined in `luaconf.h`."}}, loaded = {binding = "package.loaded", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "A table used by `require` to control which\nmodules are already loaded.\nWhen you require a module `modname` and\n`package.loaded[modname]` is not false,\n`require` simply returns the value stored there.\n\nThis variable is only a reference to the real table;\nassignments to this variable do not change the\ntable used by `require`."}}, loadlib = {binding = "package.loadlib", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"libname", "funcname"}, ["fnl/docstring"] = "Dynamically links the host program with the C library `libname`.\n\nIf `funcname` is `\"*\"`,\nthen it only links with the library,\nmaking the symbols exported by the library\navailable to other dynamically linked libraries.\nOtherwise,\nit looks for a function `funcname` inside the library\nand returns this function as a C function.\nSo, `funcname` must follow the `lua_CFunction` prototype\n(see `lua_CFunction`).\n\nThis is a low-level function.\nIt completely bypasses the package and module system.\nUnlike `require`,\nit does not perform any path searching and\ndoes not automatically adds extensions.\n`libname` must be the complete file name of the C library,\nincluding if necessary a path and an extension.\n`funcname` must be the exact name exported by the C library\n(which may depend on the C compiler and linker used).\n\nThis function is not supported by Standard C.\nAs such, it is only available on some platforms\n(Windows, Linux, Mac OS X, Solaris, BSD,\nplus other Unix systems that support the `dlfcn` standard)."}}, path = {binding = "package.path", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "The path used by `require` to search for a Lua loader.\n\nAt start-up, Lua initializes this variable with\nthe value of the environment variable `LUA_PATH_5_2` or\nthe environment variable `LUA_PATH` or\nwith a default path defined in `luaconf.h`,\nif those environment variables are not defined.\nAny `\";;\"` in the value of the environment variable\nis replaced by the default path."}}, preload = {binding = "package.preload", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "A table to store loaders for specific modules\n(see `require`).\n\nThis variable is only a reference to the real table;\nassignments to this variable do not change the\ntable used by `require`."}}, searchers = {binding = "package.searchers", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "A table used by `require` to control how to load modules.\n\nEach entry in this table is a *searcher function*.\nWhen looking for a module,\n`require` calls each of these searchers in ascending order,\nwith the module name (the argument given to `require`) as its\nsole parameter.\nThe function can return another function (the module *loader*)\nplus an extra value that will be passed to that loader,\nor a string explaining why it did not find that module\n(or **nil** if it has nothing to say).\n\nLua initializes this table with four searcher functions.\n\nThe first searcher simply looks for a loader in the\n`package.preload` table.\n\nThe second searcher looks for a loader as a Lua library,\nusing the path stored at `package.path`.\nThe search is done as described in function `package.searchpath`.\n\nThe third searcher looks for a loader as a C library,\nusing the path given by the variable `package.cpath`.\nAgain,\nthe search is done as described in function `package.searchpath`.\nFor instance,\nif the C path is the string\n\n```lua\n     \"./?.so;./?.dll;/usr/local/?/init.so\"\n```\nthe searcher for module `foo`\nwill try to open the files `./foo.so`, `./foo.dll`,\nand `/usr/local/foo/init.so`, in that order.\nOnce it finds a C library,\nthis searcher first uses a dynamic link facility to link the\napplication with the library.\nThen it tries to find a C function inside the library to\nbe used as the loader.\nThe name of this C function is the string `\"luaopen_\"`\nconcatenated with a copy of the module name where each dot\nis replaced by an underscore.\nMoreover, if the module name has a hyphen,\nits prefix up to (and including) the first hyphen is removed.\nFor instance, if the module name is `a.v1-b.c`,\nthe function name will be `luaopen_b_c`.\n\nThe fourth searcher tries an *all-in-one loader*.\nIt searches the C path for a library for\nthe root name of the given module.\nFor instance, when requiring `a.b.c`,\nit will search for a C library for `a`.\nIf found, it looks into it for an open function for\nthe submodule;\nin our example, that would be `luaopen_a_b_c`.\nWith this facility, a package can pack several C submodules\ninto one single library,\nwith each submodule keeping its original open function.\n\nAll searchers except the first one (preload) return as the extra value\nthe file name where the module was found,\nas returned by `package.searchpath`.\nThe first searcher returns no extra value."}}, searchpath = {binding = "package.searchpath", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"name", "path", "?sep", "?rep"}, ["fnl/docstring"] = "Searches for the given `name` in the given `path`.\n\nA path is a string containing a sequence of\n*templates* separated by semicolons.\nFor each template,\nthe function replaces each interrogation mark (if any)\nin the template with a copy of `name`\nwherein all occurrences of `?sep`\n(a dot, by default)\nwere replaced by `?rep`\n(the system's directory separator, by default),\nand then tries to open the resulting file name.\n\nFor instance, if the path is the string\n\n```lua\n     \"./?.lua;./?.lc;/usr/local/?/init.lua\"\n```\nthe search for the name `foo.a`\nwill try to open the files\n`./foo/a.lua`, `./foo/a.lc`, and\n`/usr/local/foo/a/init.lua`, in that order.\n\nReturns the resulting name of the first file that it can\nopen in read mode (after closing the file),\nor **nil** plus an error message if none succeeds.\n(This error message lists all file names it tried to open.)"}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "The package library provides basic\nfacilities for loading modules in Lua.\nIt exports one function directly in the global environment:\n`require`.\nEverything else is exported in a table `package`."}}, pairs = {binding = "pairs", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"t"}, ["fnl/docstring"] = "If `t` has a metamethod `__pairs`,\ncalls it with `t` as argument and returns the first three\nresults from the call.\n\nOtherwise,\nreturns three values: the `next` function, the table `t`, and **nil**,\nso that the construction\n\n```lua\n     for k,v in pairs(t) do *body* end\n```\nwill iterate over all key\226\128\147value pairs of table `t`.\n\nSee function `next` for the caveats of modifying\nthe table during its traversal."}}, pcall = {binding = "pcall", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f", "?arg1", "..."}, ["fnl/docstring"] = "Calls function `f` with\nthe given arguments in *protected mode*.\nThis means that any error inside `f` is not propagated;\ninstead, `pcall` catches the error\nand returns a status code.\nIts first result is the status code (a boolean),\nwhich is true if the call succeeds without errors.\nIn such case, `pcall` also returns all results from the call,\nafter this first result.\nIn case of any error, `pcall` returns **false** plus the error message."}}, print = {binding = "print", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"..."}, ["fnl/docstring"] = "Receives any number of arguments\nand prints their values to `stdout`,\nusing the `tostring` function to convert each argument to a string.\n`print` is not intended for formatted output,\nbut only as a quick way to show a value,\nfor instance for debugging.\nFor complete control over the output,\nuse `string.format` and `io.write`."}}, rawequal = {binding = "rawequal", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"v1", "v2"}, ["fnl/docstring"] = "Checks whether `v1` is equal to `v2`,\nwithout invoking any metamethod.\nReturns a boolean."}}, rawget = {binding = "rawget", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"table", "index"}, ["fnl/docstring"] = "Gets the real value of `table[index]`,\nwithout invoking any metamethod.\n`table` must be a table;\n`index` may be any value."}}, rawlen = {binding = "rawlen", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"v"}, ["fnl/docstring"] = "Returns the length of the object `v`,\nwhich must be a table or a string,\nwithout invoking any metamethod.\nReturns an integer number."}}, rawset = {binding = "rawset", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"table", "index", "value"}, ["fnl/docstring"] = "Sets the real value of `table[index]` to `value`,\nwithout invoking any metamethod.\n`table` must be a table,\n`index` any value different from **nil** and NaN,\nand `value` any Lua value.\n\nThis function returns `table`."}}, require = {binding = "require", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"modname"}, ["fnl/docstring"] = "Loads the given module.\nThe function starts by looking into the `package.loaded` table\nto determine whether `modname` is already loaded.\nIf it is, then `require` returns the value stored\nat `package.loaded[modname]`.\nOtherwise, it tries to find a *loader* for the module.\n\nTo find a loader,\n`require` is guided by the `package.searchers` sequence.\nBy changing this sequence,\nwe can change how `require` looks for a module.\nThe following explanation is based on the default configuration\nfor `package.searchers`.\n\nFirst `require` queries `package.preload[modname]`.\nIf it has a value,\nthis value (which should be a function) is the loader.\nOtherwise `require` searches for a Lua loader using the\npath stored in `package.path`.\nIf that also fails, it searches for a C loader using the\npath stored in `package.cpath`.\nIf that also fails,\nit tries an *all-in-one* loader (see `package.searchers`).\n\nOnce a loader is found,\n`require` calls the loader with two arguments:\n`modname` and an extra value dependent on how it got the loader.\n(If the loader came from a file,\nthis extra value is the file name.)\nIf the loader returns any non-nil value,\n`require` assigns the returned value to `package.loaded[modname]`.\nIf the loader does not return a non-nil value and\nhas not assigned any value to `package.loaded[modname]`,\nthen `require` assigns **true** to this entry.\nIn any case, `require` returns the\nfinal value of `package.loaded[modname]`.\n\nIf there is any error loading or running the module,\nor if it cannot find any loader for the module,\nthen `require` raises an error."}}, select = {binding = "select", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"index", "..."}, ["fnl/docstring"] = "If `index` is a number,\nreturns all arguments after argument number `index`;\na negative number indexes from the end (-1 is the last argument).\nOtherwise, `index` must be the string `\"#\"`,\nand `select` returns the total number of extra arguments it received."}}, setmetatable = {binding = "setmetatable", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"table", "metatable"}, ["fnl/docstring"] = "Sets the metatable for the given table.\n(You cannot change the metatable of other types from Lua, only from C.)\nIf `metatable` is **nil**,\nremoves the metatable of the given table.\nIf the original metatable has a `\"__metatable\"` field,\nraises an error.\n\nThis function returns `table`."}}, string = {binding = "string", fields = {byte = {binding = "string.byte", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "?i", "?j"}, ["fnl/docstring"] = "Returns the internal numerical codes of the characters `s[i]`,\n`s[i+1]`, ..., `s[j]`.\nThe default value for `?i` is 1;\nthe default value for `?j` is `?i`.\nThese indices are corrected\nfollowing the same rules of function `string.sub`.\n\nNumerical codes are not necessarily portable across platforms."}}, char = {binding = "string.char", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"..."}, ["fnl/docstring"] = "Receives zero or more integers.\nReturns a string with length equal to the number of arguments,\nin which each character has the internal numerical code equal\nto its corresponding argument.\n\nNumerical codes are not necessarily portable across platforms."}}, dump = {binding = "string.dump", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"function"}, ["fnl/docstring"] = "Returns a string containing a binary representation of the given function,\nso that a later `load` on this string returns\na copy of the function (but with new upvalues)."}}, find = {binding = "string.find", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "pattern", "?init", "?plain"}, ["fnl/docstring"] = "Looks for the first match of\n`pattern` in the string `s`.\nIf it finds a match, then `find` returns the indices of `s`\nwhere this occurrence starts and ends;\notherwise, it returns **nil**.\nA third, optional numerical argument `?init` specifies\nwhere to start the search;\nits default value is 1 and can be negative.\nA value of **true** as a fourth, optional argument `?plain`\nturns off the pattern matching facilities,\nso the function does a plain \"find substring\" operation,\nwith no characters in `pattern` being considered magic.\nNote that if `?plain` is given, then `?init` must be given as well.\n\nIf the pattern has captures,\nthen in a successful match\nthe captured values are also returned,\nafter the two indices."}}, format = {binding = "string.format", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"formatstring", "..."}, ["fnl/docstring"] = "Returns a formatted version of its variable number of arguments\nfollowing the description given in its first argument (which must be a string).\nThe format string follows the same rules as the ISO C function `sprintf`.\nThe only differences are that the options/modifiers\n`*`, `h`, `L`, `l`, `n`,\nand `p` are not supported\nand that there is an extra option, `q`.\nThe `q` option formats a string between double quotes,\nusing escape sequences when necessary to ensure that\nit can safely be read back by the Lua interpreter.\nFor instance, the call\n\n```lua\n     string.format('%q', 'a string with \"quotes\" and \\n new line')\n```\nmay produce the string:\n\n```lua\n     \"a string with \\\"quotes\\\" and \\\n      new line\"\n```\n\nOptions\n`A` and `a` (when available),\n`E`, `e`, `f`,\n`G`, and `g` all expect a number as argument.\nOptions `c`, `d`,\n`i`, `o`, `u`, `X`, and `x`\nalso expect a number,\nbut the range of that number may be limited by\nthe underlying C implementation.\nFor options `o`, `u`, `X`, and `x`,\nthe number cannot be negative.\nOption `q` expects a string;\noption `s` expects a string without embedded zeros.\nIf the argument to option `s` is not a string,\nit is converted to one following the same rules of `tostring`."}}, gmatch = {binding = "string.gmatch", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "pattern"}, ["fnl/docstring"] = "Returns an iterator function that,\neach time it is called,\nreturns the next captures from `pattern` over the string `s`.\nIf `pattern` specifies no captures,\nthen the whole match is produced in each call.\n\nAs an example, the following loop\nwill iterate over all the words from string `s`,\nprinting one per line:\n\n```lua\n     s = \"hello world from Lua\"\n     for w in string.gmatch(s, \"%a+\") do\n       print(w)\n     end\n```\nThe next example collects all pairs `key=value` from the\ngiven string into a table:\n\n```lua\n     t = {}\n     s = \"from=world, to=Lua\"\n     for k, v in string.gmatch(s, \"(%w+)=(%w+)\") do\n       t[k] = v\n     end\n```\n\nFor this function, a caret `\"^\"` at the start of a pattern does not\nwork as an anchor, as this would prevent the iteration."}}, gsub = {binding = "string.gsub", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "pattern", "repl", "?n"}, ["fnl/docstring"] = "Returns a copy of `s`\nin which all (or the first `?n`, if given)\noccurrences of the `pattern` have been\nreplaced by a replacement string specified by `repl`,\nwhich can be a string, a table, or a function.\n`gsub` also returns, as its second value,\nthe total number of matches that occurred.\nThe name `gsub` comes from *Global SUBstitution*.\n\nIf `repl` is a string, then its value is used for replacement.\nThe character `%` works as an escape character:\nany sequence in `repl` of the form `%*d*`,\nwith *d* between 1 and 9,\nstands for the value of the *d*-th captured substring.\nThe sequence `%0` stands for the whole match.\nThe sequence `%%` stands for a single `%`.\n\nIf `repl` is a table, then the table is queried for every match,\nusing the first capture as the key.\n\nIf `repl` is a function, then this function is called every time a\nmatch occurs, with all captured substrings passed as arguments,\nin order.\n\nIn any case,\nif the pattern specifies no captures,\nthen it behaves as if the whole pattern was inside a capture.\n\nIf the value returned by the table query or by the function call\nis a string or a number,\nthen it is used as the replacement string;\notherwise, if it is **false** or **nil**,\nthen there is no replacement\n(that is, the original match is kept in the string).\n\nHere are some examples:\n\n```lua\n     x = string.gsub(\"hello world\", \"(%w+)\", \"%1 %1\")\n     --> x=\"hello hello world world\"\n     \n     x = string.gsub(\"hello world\", \"%w+\", \"%0 %0\", 1)\n     --> x=\"hello hello world\"\n     \n     x = string.gsub(\"hello world from Lua\", \"(%w+)%s*(%w+)\", \"%2 %1\")\n     --> x=\"world hello Lua from\"\n     \n     x = string.gsub(\"home = $HOME, user = $USER\", \"%$(%w+)\", os.getenv)\n     --> x=\"home = /home/roberto, user = roberto\"\n     \n     x = string.gsub(\"4+5 = $return 4+5$\", \"%$(.-)%$\", function (s)\n           return load(s)()\n         end)\n     --> x=\"4+5 = 9\"\n     \n     local t = {name=\"lua\", version=\"5.2\"}\n     x = string.gsub(\"$name-$version.tar.gz\", \"%$(%w+)\", t)\n     --> x=\"lua-5.2.tar.gz\"\n```"}}, len = {binding = "string.len", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s"}, ["fnl/docstring"] = "Receives a string and returns its length.\nThe empty string `\"\"` has length 0.\nEmbedded zeros are counted,\nso `\"a\\000bc\\000\"` has length 5."}}, lower = {binding = "string.lower", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s"}, ["fnl/docstring"] = "Receives a string and returns a copy of this string with all\nuppercase letters changed to lowercase.\nAll other characters are left unchanged.\nThe definition of what an uppercase letter is depends on the current locale."}}, match = {binding = "string.match", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "pattern", "?init"}, ["fnl/docstring"] = "Looks for the first *match* of\n`pattern` in the string `s`.\nIf it finds one, then `match` returns\nthe captures from the pattern;\notherwise it returns **nil**.\nIf `pattern` specifies no captures,\nthen the whole match is returned.\nA third, optional numerical argument `?init` specifies\nwhere to start the search;\nits default value is 1 and can be negative."}}, rep = {binding = "string.rep", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "n", "?sep"}, ["fnl/docstring"] = "Returns a string that is the concatenation of `n` copies of\nthe string `s` separated by the string `?sep`.\nThe default value for `?sep` is the empty string\n(that is, no separator)."}}, reverse = {binding = "string.reverse", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s"}, ["fnl/docstring"] = "Returns a string that is the string `s` reversed."}}, sub = {binding = "string.sub", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "i", "?j"}, ["fnl/docstring"] = "Returns the substring of `s` that\nstarts at `i`  and continues until `?j`;\n`i` and `?j` can be negative.\nIf `?j` is absent, then it is assumed to be equal to -1\n(which is the same as the string length).\nIn particular,\nthe call `string.sub(s,1,j)` returns a prefix of `s`\nwith length `?j`,\nand `string.sub(s, -i)` returns a suffix of `s`\nwith length `i`.\n\nIf, after the translation of negative indices,\n`i` is less than 1,\nit is corrected to 1.\nIf `?j` is greater than the string length,\nit is corrected to that length.\nIf, after these corrections,\n`i` is greater than `?j`,\nthe function returns the empty string."}}, upper = {binding = "string.upper", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s"}, ["fnl/docstring"] = "Receives a string and returns a copy of this string with all\nlowercase letters changed to uppercase.\nAll other characters are left unchanged.\nThe definition of what a lowercase letter is depends on the current locale."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "This library provides generic functions for string manipulation,\nsuch as finding and extracting substrings, and pattern matching.\nWhen indexing a string in Lua, the first character is at position 1\n(not at 0, as in C).\nIndices are allowed to be negative and are interpreted as indexing backwards,\nfrom the end of the string.\nThus, the last character is at position -1, and so on.\n\nThe string library provides all its functions inside the table\n`string`.\nIt also sets a metatable for strings\nwhere the `__index` field points to the `string` table.\nTherefore, you can use the string functions in object-oriented style.\nFor instance, `string.byte(s,i)`\ncan be written as `s:byte(i)`.\n\nThe string library assumes one-byte character encodings."}}, table = {binding = "table", fields = {concat = {binding = "table.concat", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"list", "?sep", "?i", "?j"}, ["fnl/docstring"] = "Given a list where all elements are strings or numbers,\nreturns the string `list[i]..sep..list[i+1] ... sep..list[j]`.\nThe default value for `?sep` is the empty string,\nthe default for `?i` is 1,\nand the default for `?j` is `#list`.\nIf `?i` is greater than `?j`, returns the empty string."}}, insert = {binding = "table.insert", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"list", "value"}, ["fnl/docstring"] = "Inserts element `value` at position `pos` in `list`,\nshifting up the elements\n`list[pos], list[pos+1], ..., list[#list]`.\nThe default value for `pos` is `#list+1`,\nso that a call `table.insert(t,x)` inserts `x` at the end\nof list `t`."}}, pack = {binding = "table.pack", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"..."}, ["fnl/docstring"] = "Returns a new table with all parameters stored into keys 1, 2, etc.\nand with a field `\"n\"` with the total number of parameters.\nNote that the resulting table may not be a sequence."}}, remove = {binding = "table.remove", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"list", "?pos"}, ["fnl/docstring"] = "Removes from `list` the element at position `?pos`,\nreturning the value of the removed element.\nWhen `?pos` is an integer between 1 and `#list`,\nit shifts down the elements\n`list[pos+1], list[pos+2], ..., list[#list]`\nand erases element `list[#list]`;\nThe index `?pos` can also be 0 when `#list` is 0,\nor `#list + 1`;\nin those cases, the function erases the element `list[pos]`.\n\nThe default value for `?pos` is `#list`,\nso that a call `table.remove(t)` removes the last element\nof list `t`."}}, sort = {binding = "table.sort", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"list", "?comp"}, ["fnl/docstring"] = "Sorts list elements in a given order, *in-place*,\nfrom `list[1]` to `list[#list]`.\nIf `?comp` is given,\nthen it must be a function that receives two list elements\nand returns true when the first element must come\nbefore the second in the final order\n(so that `not comp(list[i+1],list[i])` will be true after the sort).\nIf `?comp` is not given,\nthen the standard Lua operator `<` is used instead.\n\nThe sort algorithm is not stable;\nthat is, elements considered equal by the given order\nmay have their relative positions changed by the sort."}}, unpack = {binding = "table.unpack", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"list", "?i", "?j"}, ["fnl/docstring"] = "Returns the elements from the given table.\nThis function is equivalent to\n\n```lua\n     return list[i], list[i+1], ..., list[j]\n```\nBy default, `?i` is 1 and `?j` is `#list`."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "This library provides generic functions for table manipulation.\nIt provides all its functions inside the table `table`.\n\nRemember that, whenever an operation needs the length of a table,\nthe table should be a proper sequence\nor have a `__len` metamethod\nAll functions ignore non-numeric keys\nin tables given as arguments.\n\nFor performance reasons,\nall table accesses (get/set) performed by these functions are raw."}}, tonumber = {binding = "tonumber", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"e", "?base"}, ["fnl/docstring"] = "When called with no `?base`,\n`tonumber` tries to convert its argument to a number.\nIf the argument is already a number or\na string convertible to a number\nthen `tonumber` returns this number;\notherwise, it returns **nil**.\n\nWhen called with `?base`,\nthen `e` should be a string to be interpreted as\nan integer numeral in that base.\nThe base may be any integer between 2 and 36, inclusive.\nIn bases above 10, the letter `\"A\"` (in either upper or lower case)\nrepresents 10, `\"B\"` represents 11, and so forth,\nwith `\"Z\"` representing 35.\nIf the string `e` is not a valid numeral in the given base,\nthe function returns **nil**."}}, tostring = {binding = "tostring", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"v"}, ["fnl/docstring"] = "Receives a value of any type and\nconverts it to a string in a reasonable format.\n(For complete control of how numbers are converted,\nuse `string.format`.)\n\nIf the metatable of `v` has a `\"__tostring\"` field,\nthen `tostring` calls the corresponding value\nwith `v` as argument,\nand uses the result of the call as its result."}}, type = {binding = "type", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"v"}, ["fnl/docstring"] = "Returns the type of its only argument, coded as a string.\nThe possible results of this function are\n`\"nil\"` (a string, not the value **nil**),\n`\"number\"`,\n`\"string\"`,\n`\"boolean\"`,\n`\"table\"`,\n`\"function\"`,\n`\"thread\"`,\nand `\"userdata\"`."}}, xpcall = {binding = "xpcall", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f", "msgh", "?arg1", "..."}, ["fnl/docstring"] = "This function is similar to `pcall`,\nexcept that it sets a new message handler `msgh`."}}}
  local file_fields = {close = {binding = "file:close", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"self"}, ["fnl/docstring"] = "Closes `file`.\nNote that files are automatically closed when\ntheir handles are garbage collected,\nbut that takes an unpredictable amount of time to happen.\n\nWhen closing a file handle created with `io.popen`,\n`file:close` returns the same values\nreturned by `os.execute`."}}, flush = {binding = "file:flush", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"self"}, ["fnl/docstring"] = "Saves any written data to `file`."}}, lines = {binding = "file:lines", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"self", "..."}, ["fnl/docstring"] = "Returns an iterator function that,\neach time it is called,\nreads the file according to the given formats.\nWhen no format is given,\nuses \"*l\" as a default.\nAs an example, the construction\n\n```lua\n     for c in file:lines(1) do *body* end\n```\nwill iterate over all characters of the file,\nstarting at the current position.\nUnlike `io.lines`, this function does not close the file\nwhen the loop ends.\n\nIn case of errors this function raises the error,\ninstead of returning an error code."}}, read = {binding = "file:read", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"self", "..."}, ["fnl/docstring"] = "Reads the file `file`,\naccording to the given formats, which specify what to read.\nFor each format,\nthe function returns a string (or a number) with the characters read,\nor **nil** if it cannot read data with the specified format.\nWhen called without formats,\nit uses a default format that reads the next line\n(see below).\n\nThe available formats are\n\n* **`\"*n\"`: **\n  reads a number;\n  this is the only format that returns a number instead of a string.\n\n* **`\"*a\"`: **\n  reads the whole file, starting at the current position.\n  On end of file, it returns the empty string.\n\n* **`\"*l\"`: **\n  reads the next line skipping the end of line,\n  returning **nil** on end of file.\n  This is the default format.\n\n* **`\"*L\"`: **\n  reads the next line keeping the end of line (if present),\n  returning **nil** on end of file.\n\n* ***number*: **\n  reads a string with up to this number of bytes,\n  returning **nil** on end of file.\n  If number is zero,\n  it reads nothing and returns an empty string,\n  or **nil** on end of file."}}, seek = {binding = "file:seek", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"self", "?whence", "?offset"}, ["fnl/docstring"] = "Sets and gets the file position,\nmeasured from the beginning of the file,\nto the position given by `?offset` plus a base\nspecified by the string `?whence`, as follows:\n\n* **`\"set\"`: ** base is position 0 (beginning of the file);\n* **`\"cur\"`: ** base is current position;\n* **`\"end\"`: ** base is end of file;\n\nIn case of success, `seek` returns the final file position,\nmeasured in bytes from the beginning of the file.\nIf `seek` fails, it returns **nil**,\nplus a string describing the error.\n\nThe default value for `?whence` is `\"cur\"`,\nand for `?offset` is 0.\nTherefore, the call `file:seek()` returns the current\nfile position, without changing it;\nthe call `file:seek(\"set\")` sets the position to the\nbeginning of the file (and returns 0);\nand the call `file:seek(\"end\")` sets the position to the\nend of the file, and returns its size."}}, setvbuf = {binding = "file:setvbuf", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"self", "mode", "?size"}, ["fnl/docstring"] = "Sets the buffering mode for an output file.\nThere are three available modes:\n\n* **`\"no\"`: **\n  no buffering; the result of any output operation appears immediately.\n\n* **`\"full\"`: **\n  full buffering; output operation is performed only\n  when the buffer is full or when\n  you explicitly `flush` the file (see `io.flush`).\n\n* **`\"line\"`: **\n  line buffering; output is buffered until a newline is output\n  or there is any input from some special files\n  (such as a terminal device).\n\nFor the last two cases, `?size`\nspecifies the size of the buffer, in bytes.\nThe default is an appropriate size."}}, write = {binding = "file:write", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"self", "..."}, ["fnl/docstring"] = "Writes the value of each of its arguments to `file`.\nThe arguments must be strings or numbers.\n\nIn case of success, this function returns `file`.\nOtherwise it returns **nil** plus a string describing the error."}}}
  docs._G.fields = docs
  docs.io.fields.stdin.fields = file_fields
  docs.io.fields.stdout.fields = file_fields
  docs.io.fields.stderr.fields = file_fields
  return docs
end
package.preload["fennel-ls.docs.generated.lua53"] = package.preload["fennel-ls.docs.generated.lua53"] or function(...)
  local docs = {_G = {binding = "_G", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "A global variable (not a function) that\nholds the global environment\nLua itself does not use this variable;\nchanging its value does not affect any environment,\nnor vice versa."}}, _VERSION = {binding = "_VERSION", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "A global variable (not a function) that\nholds a string containing the running Lua version.\nThe current value of this variable is `\"Lua 5.3\"`."}}, arg = {binding = "arg", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "Before running any code,\n`lua` collects all command-line arguments\nin a global table called `arg`.\nThe script name goes to index 0,\nthe first argument after the script name goes to index 1,\nand so on.\nAny arguments before the script name\n(that is, the interpreter name plus its options)\ngo to negative indices.\nFor instance, in the call\n\n```lua\n     $ lua -la b.lua t1 t2\n```\nthe table is like this:\n\n```lua\n     arg = { [-2] = \"lua\", [-1] = \"-la\",\n             [0] = \"b.lua\",\n             [1] = \"t1\", [2] = \"t2\" }\n```\nIf there is no script in the call,\nthe interpreter name goes to index 0,\nfollowed by the other arguments.\nFor instance, the call\n\n```lua\n     $ lua -e \"print(arg[1])\"\n```\nwill print `\"-e\"`.\nIf there is a script,\nthe script is called with arguments\n`arg[1]`, ..., `arg[#arg]`.\n(Like all chunks in Lua,\nthe script is compiled as a vararg function.)"}}, assert = {binding = "assert", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"v", "?message"}, ["fnl/docstring"] = "Calls `error` if\nthe value of its argument `v` is false (i.e., **nil** or **false**);\notherwise, returns all its arguments.\nIn case of error,\n`?message` is the error object;\nwhen absent, it defaults to `\"assertion failed!\"`"}}, collectgarbage = {binding = "collectgarbage", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?opt", "?arg"}, ["fnl/docstring"] = "This function is a generic interface to the garbage collector.\nIt performs different functions according to its first argument, `?opt`:\n\n* **`\"collect\"`: **\n  performs a full garbage-collection cycle.\n  This is the default option.\n\n* **`\"stop\"`: **\n  stops automatic execution of the garbage collector.\n  The collector will run only when explicitly invoked,\n  until a call to restart it.\n\n* **`\"restart\"`: **\n  restarts automatic execution of the garbage collector.\n\n* **`\"count\"`: **\n  returns the total memory in use by Lua in Kbytes.\n  The value has a fractional part,\n  so that it multiplied by 1024\n  gives the exact number of bytes in use by Lua\n  (except for overflows).\n\n* **`\"step\"`: **\n  performs a garbage-collection step.\n  The step \"size\" is controlled by `?arg`.\n  With a zero value,\n  the collector will perform one basic (indivisible) step.\n  For non-zero values,\n  the collector will perform as if that amount of memory\n  (in KBytes) had been allocated by Lua.\n  Returns **true** if the step finished a collection cycle.\n\n* **`\"setpause\"`: **\n  sets `?arg` as the new value for the *pause* of\n  the collector\n  Returns the previous value for *pause*.\n\n* **`\"setstepmul\"`: **\n  sets `?arg` as the new value for the *step multiplier* of\n  the collector\n  Returns the previous value for *step*.\n\n* **`\"isrunning\"`: **\n  returns a boolean that tells whether the collector is running\n  (i.e., not stopped)."}}, coroutine = {binding = "coroutine", fields = {create = {binding = "coroutine.create", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f"}, ["fnl/docstring"] = "Creates a new coroutine, with body `f`.\n`f` must be a function.\nReturns this new coroutine,\nan object with type `\"thread\"`."}}, isyieldable = {binding = "coroutine.isyieldable", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {}, ["fnl/docstring"] = "Returns true when the running coroutine can yield.\n\nA running coroutine is yieldable if it is not the main thread and\nit is not inside a non-yieldable C function."}}, resume = {binding = "coroutine.resume", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"co", "?val1", "..."}, ["fnl/docstring"] = "Starts or continues the execution of coroutine `co`.\nThe first time you resume a coroutine,\nit starts running its body.\nThe values `?val1`, ... are passed\nas the arguments to the body function.\nIf the coroutine has yielded,\n`resume` restarts it;\nthe values `?val1`, ... are passed\nas the results from the yield.\n\nIf the coroutine runs without any errors,\n`resume` returns **true** plus any values passed to `yield`\n(when the coroutine yields) or any values returned by the body function\n(when the coroutine terminates).\nIf there is any error,\n`resume` returns **false** plus the error message."}}, running = {binding = "coroutine.running", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {}, ["fnl/docstring"] = "Returns the running coroutine plus a boolean,\ntrue when the running coroutine is the main one."}}, status = {binding = "coroutine.status", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"co"}, ["fnl/docstring"] = "Returns the status of coroutine `co`, as a string:\n`\"running\"`,\nif the coroutine is running (that is, it called `status`);\n`\"suspended\"`, if the coroutine is suspended in a call to `yield`,\nor if it has not started running yet;\n`\"normal\"` if the coroutine is active but not running\n(that is, it has resumed another coroutine);\nand `\"dead\"` if the coroutine has finished its body function,\nor if it has stopped with an error."}}, wrap = {binding = "coroutine.wrap", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f"}, ["fnl/docstring"] = "Creates a new coroutine, with body `f`.\n`f` must be a function.\nReturns a function that resumes the coroutine each time it is called.\nAny arguments passed to the function behave as the\nextra arguments to `resume`.\nReturns the same values returned by `resume`,\nexcept the first boolean.\nIn case of error, propagates the error."}}, yield = {binding = "coroutine.yield", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"..."}, ["fnl/docstring"] = "Suspends the execution of the calling coroutine.\nAny arguments to `yield` are passed as extra results to `resume`."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "This library comprises the operations to manipulate coroutines,\nwhich come inside the table `coroutine`."}}, debug = {binding = "debug", fields = {debug = {binding = "debug.debug", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {}, ["fnl/docstring"] = "Enters an interactive mode with the user,\nrunning each string that the user enters.\nUsing simple commands and other debug facilities,\nthe user can inspect global and local variables,\nchange their values, evaluate expressions, and so on.\nA line containing only the word `cont` finishes this function,\nso that the caller continues its execution.\n\nNote that commands for `debug.debug` are not lexically nested\nwithin any function and so have no direct access to local variables."}}, gethook = {binding = "debug.gethook", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?thread"}, ["fnl/docstring"] = "Returns the current hook settings of the thread, as three values:\nthe current hook function, the current hook mask,\nand the current hook count\n(as set by the `debug.sethook` function)."}}, getinfo = {binding = "debug.getinfo", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f", "?what"}, ["fnl/docstring"] = "Returns a table with information about a function.\nYou can give the function directly\nor you can give a number as the value of `f`,\nwhich means the function running at level `f` of the call stack\nof the given thread:\nlevel 0 is the current function (`getinfo` itself);\nlevel 1 is the function that called `getinfo`\n(except for tail calls, which do not count on the stack);\nand so on.\nIf `f` is a number larger than the number of active functions,\nthen `getinfo` returns **nil**.\n\nThe returned table can contain all the fields returned by `lua_getinfo`,\nwith the string `?what` describing which fields to fill in.\nThe default for `?what` is to get all information available,\nexcept the table of valid lines.\nIf present,\nthe option `\"f\"`\nadds a field named `func` with the function itself.\nIf present,\nthe option `\"L\"`\nadds a field named `activelines` with the table of\nvalid lines.\n\nFor instance, the expression `debug.getinfo(1,\"n\").name` returns\na name for the current function,\nif a reasonable name can be found,\nand the expression `debug.getinfo(print)`\nreturns a table with all available information\nabout the `print` function."}}, getlocal = {binding = "debug.getlocal", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f", "local"}, ["fnl/docstring"] = "This function returns the name and the value of the local variable\nwith index `local` of the function at level `f` of the stack.\nThis function accesses not only explicit local variables,\nbut also parameters, temporaries, etc.\n\nThe first parameter or local variable has index 1, and so on,\nfollowing the order that they are declared in the code,\ncounting only the variables that are active\nin the current scope of the function.\nNegative indices refer to vararg arguments;\n-1 is the first vararg argument.\nThe function returns **nil** if there is no variable with the given index,\nand raises an error when called with a level out of range.\n(You can call `debug.getinfo` to check whether the level is valid.)\n\nVariable names starting with `\"(\"` (open parenthesis) \nrepresent variables with no known names\n(internal variables such as loop control variables,\nand variables from chunks saved without debug information).\n\nThe parameter `f` may also be a function.\nIn that case, `getlocal` returns only the name of function parameters."}}, getmetatable = {binding = "debug.getmetatable", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"value"}, ["fnl/docstring"] = "Returns the metatable of the given `value`\nor **nil** if it does not have a metatable."}}, getregistry = {binding = "debug.getregistry", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {}, ["fnl/docstring"] = "Returns the registry table"}}, getupvalue = {binding = "debug.getupvalue", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f", "up"}, ["fnl/docstring"] = "This function returns the name and the value of the upvalue\nwith index `up` of the function `f`.\nThe function returns **nil** if there is no upvalue with the given index.\n\nVariable names starting with `\"(\"` (open parenthesis) \nrepresent variables with no known names\n(variables from chunks saved without debug information)."}}, getuservalue = {binding = "debug.getuservalue", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"u"}, ["fnl/docstring"] = "Returns the Lua value associated to `u`.\nIf `u` is not a full userdata,\nreturns **nil**."}}, sethook = {binding = "debug.sethook", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"hook", "mask", "?count"}, ["fnl/docstring"] = "Sets the given function as a hook.\nThe string `mask` and the number `?count` describe\nwhen the hook will be called.\nThe string mask may have any combination of the following characters,\nwith the given meaning:\n\n* **`\"c\"`: ** the hook is called every time Lua calls a function;\n* **`\"r\"`: ** the hook is called every time Lua returns from a function;\n* **`\"l\"`: ** the hook is called every time Lua enters a new line of code.\n\nMoreover,\nwith a `?count` different from zero,\nthe hook is called also after every `?count` instructions.\n\nWhen called without arguments,\n`debug.sethook` turns off the hook.\n\nWhen the hook is called, its first argument is a string\ndescribing the event that has triggered its call:\n`\"call\"` (or `\"tail call\"`),\n`\"return\"`,\n`\"line\"`, and `\"count\"`.\nFor line events,\nthe hook also gets the new line number as its second parameter.\nInside a hook,\nyou can call `getinfo` with level 2 to get more information about\nthe running function\n(level 0 is the `getinfo` function,\nand level 1 is the hook function)."}}, setlocal = {binding = "debug.setlocal", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"level", "local", "value"}, ["fnl/docstring"] = "This function assigns the value `value` to the local variable\nwith index `local` of the function at level `level` of the stack.\nThe function returns **nil** if there is no local\nvariable with the given index,\nand raises an error when called with a `level` out of range.\n(You can call `getinfo` to check whether the level is valid.)\nOtherwise, it returns the name of the local variable.\n\nSee `debug.getlocal` for more information about\nvariable indices and names."}}, setmetatable = {binding = "debug.setmetatable", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"value", "table"}, ["fnl/docstring"] = "Sets the metatable for the given `value` to the given `table`\n(which can be **nil**).\nReturns `value`."}}, setupvalue = {binding = "debug.setupvalue", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f", "up", "value"}, ["fnl/docstring"] = "This function assigns the value `value` to the upvalue\nwith index `up` of the function `f`.\nThe function returns **nil** if there is no upvalue\nwith the given index.\nOtherwise, it returns the name of the upvalue."}}, setuservalue = {binding = "debug.setuservalue", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"udata", "value"}, ["fnl/docstring"] = "Sets the given `value` as\nthe Lua value associated to the given `udata`.\n`udata` must be a full userdata.\n\nReturns `udata`."}}, traceback = {binding = "debug.traceback", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?message", "?level"}, ["fnl/docstring"] = "If `?message` is present but is neither a string nor **nil**,\nthis function returns `?message` without further processing.\nOtherwise,\nit returns a string with a traceback of the call stack.\nThe optional `?message` string is appended\nat the beginning of the traceback.\nAn optional `?level` number tells at which level\nto start the traceback\n(default is 1, the function calling `traceback`)."}}, upvalueid = {binding = "debug.upvalueid", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f", "n"}, ["fnl/docstring"] = "Returns a unique identifier (as a light userdata)\nfor the upvalue numbered `n`\nfrom the given function.\n\nThese unique identifiers allow a program to check whether different\nclosures share upvalues.\nLua closures that share an upvalue\n(that is, that access a same external local variable)\nwill return identical ids for those upvalue indices."}}, upvaluejoin = {binding = "debug.upvaluejoin", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f1", "n1", "f2", "n2"}, ["fnl/docstring"] = "Make the `n1`-th upvalue of the Lua closure `f1`\nrefer to the `n2`-th upvalue of the Lua closure `f2`."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "This library provides\nthe functionality of the debug interfaceto Lua programs.\nYou should exert care when using this library.\nSeveral of its functions\nviolate basic assumptions about Lua code\n(e.g., that variables local to a function\ncannot be accessed from outside;\nthat userdata metatables cannot be changed by Lua code;\nthat Lua programs do not crash)\nand therefore can compromise otherwise secure code.\nMoreover, some functions in this library may be slow.\n\nAll functions in this library are provided\ninside the `debug` table.\nAll functions that operate over a thread\nhave an optional first argument which is the\nthread to operate over.\nThe default is always the current thread."}}, dofile = {binding = "dofile", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?filename"}, ["fnl/docstring"] = "Opens the named file and executes its contents as a Lua chunk.\nWhen called without arguments,\n`dofile` executes the contents of the standard input (`stdin`).\nReturns all values returned by the chunk.\nIn case of errors, `dofile` propagates the error\nto its caller (that is, `dofile` does not run in protected mode)."}}, error = {binding = "error", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"message", "?level"}, ["fnl/docstring"] = "Terminates the last protected function called\nand returns `message` as the error object.\nFunction `error` never returns.\n\nUsually, `error` adds some information about the error position\nat the beginning of the message, if the message is a string.\nThe `?level` argument specifies how to get the error position.\nWith level 1 (the default), the error position is where the\n`error` function was called.\nLevel 2 points the error to where the function\nthat called `error` was called; and so on.\nPassing a level 0 avoids the addition of error position information\nto the message."}}, getmetatable = {binding = "getmetatable", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"object"}, ["fnl/docstring"] = "If `object` does not have a metatable, returns **nil**.\nOtherwise,\nif the object's metatable has a `__metatable` field,\nreturns the associated value.\nOtherwise, returns the metatable of the given object."}}, io = {binding = "io", fields = {close = {binding = "io.close", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?file"}, ["fnl/docstring"] = "Equivalent to `file:close()`.\nWithout a `?file`, closes the default output file."}}, flush = {binding = "io.flush", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {}, ["fnl/docstring"] = "Equivalent to `io.output():flush()`."}}, input = {binding = "io.input", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?file"}, ["fnl/docstring"] = "When called with a file name, it opens the named file (in text mode),\nand sets its handle as the default input file.\nWhen called with a file handle,\nit simply sets this file handle as the default input file.\nWhen called without arguments,\nit returns the current default input file.\n\nIn case of errors this function raises the error,\ninstead of returning an error code."}}, lines = {binding = "io.lines", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?filename", "..."}, ["fnl/docstring"] = "Opens the given file name in read mode\nand returns an iterator function that\nworks like `file:lines(...)` over the opened file.\nWhen the iterator function detects the end of file,\nit returns no values (to finish the loop) and automatically closes the file.\n\nThe call `io.lines()` (with no file name) is equivalent\nto `io.input():lines(\"*l\")`;\nthat is, it iterates over the lines of the default input file.\nIn this case, the iterator does not close the file when the loop ends.\n\nIn case of errors this function raises the error,\ninstead of returning an error code."}}, open = {binding = "io.open", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"filename", "?mode"}, ["fnl/docstring"] = "This function opens a file,\nin the mode specified in the string `?mode`.\nIn case of success,\nit returns a new file handle.\n\nThe `?mode` string can be any of the following:\n\n* **`\"r\"`: ** read mode (the default);\n* **`\"w\"`: ** write mode;\n* **`\"a\"`: ** append mode;\n* **`\"r+\"`: ** update mode, all previous data is preserved;\n* **`\"w+\"`: ** update mode, all previous data is erased;\n* **`\"a+\"`: ** append update mode, previous data is preserved,\n    writing is only allowed at the end of file.\n\nThe `?mode` string can also have a `\"b\"` at the end,\nwhich is needed in some systems to open the file in binary mode."}}, output = {binding = "io.output", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?file"}, ["fnl/docstring"] = "Similar to `io.input`, but operates over the default output file."}}, popen = {binding = "io.popen", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"prog", "?mode"}, ["fnl/docstring"] = "This function is system dependent and is not available\non all platforms.\n\nStarts program `prog` in a separated process and returns\na file handle that you can use to read data from this program\n(if `?mode` is `\"r\"`, the default)\nor to write data to this program\n(if `?mode` is `\"w\"`)."}}, read = {binding = "io.read", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"..."}, ["fnl/docstring"] = "Equivalent to `io.input():read(...)`."}}, stderr = {binding = "io.stderr", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "stderr file"}}, stdin = {binding = "io.stdin", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "stdin file"}}, stdout = {binding = "io.stdout", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "stdout file"}}, tmpfile = {binding = "io.tmpfile", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {}, ["fnl/docstring"] = "In case of success,\nreturns a handle for a temporary file.\nThis file is opened in update mode\nand it is automatically removed when the program ends."}}, type = {binding = "io.type", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"obj"}, ["fnl/docstring"] = "Checks whether `obj` is a valid file handle.\nReturns the string `\"file\"` if `obj` is an open file handle,\n`\"closed file\"` if `obj` is a closed file handle,\nor **nil** if `obj` is not a file handle."}}, write = {binding = "io.write", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"..."}, ["fnl/docstring"] = "Equivalent to `io.output():write(...)`."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "The I/O library provides two different styles for file manipulation.\nThe first one uses implicit file handles;\nthat is, there are operations to set a default input file and a\ndefault output file,\nand all input/output operations are over these default files.\nThe second style uses explicit file handles.\n\nWhen using implicit file handles,\nall operations are supplied by table `io`.\nWhen using explicit file handles,\nthe operation `io.open` returns a file handle\nand then all operations are supplied as methods of the file handle.\n\nThe table `io` also provides\nthree predefined file handles with their usual meanings from C:\n`io.stdin`, `io.stdout`, and `io.stderr`.\nThe I/O library never closes these files.\n\nUnless otherwise stated,\nall I/O functions return **nil** on failure\n(plus an error message as a second result and\na system-dependent error code as a third result)\nand some value different from **nil** on success.\nIn non-POSIX systems,\nthe computation of the error message and error code\nin case of errors\nmay be not thread safe,\nbecause they rely on the global C variable `errno`."}}, ipairs = {binding = "ipairs", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"t"}, ["fnl/docstring"] = "Returns three values (an iterator function, the table `t`, and 0)\nso that the construction\n\n```lua\n     for i,v in ipairs(t) do *body* end\n```\nwill iterate over the key\226\128\147value pairs\n(`1,t[1]`), (`2,t[2]`), ...,\nup to the first nil value."}}, load = {binding = "load", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"chunk", "?chunkname", "?mode", "?env"}, ["fnl/docstring"] = "Loads a chunk.\n\nIf `chunk` is a string, the chunk is this string.\nIf `chunk` is a function,\n`load` calls it repeatedly to get the chunk pieces.\nEach call to `chunk` must return a string that concatenates\nwith previous results.\nA return of an empty string, **nil**, or no value signals the end of the chunk.\n\nIf there are no syntactic errors,\nreturns the compiled chunk as a function;\notherwise, returns **nil** plus the error message.\n\nIf the resulting function has upvalues,\nthe first upvalue is set to the value of `?env`,\nif that parameter is given,\nor to the value of the global environment.\nOther upvalues are initialized with **nil**.\n(When you load a main chunk,\nthe resulting function will always have exactly one upvalue,\nthe `_ENV` variable\nHowever,\nwhen you load a binary chunk created from a function (see `string.dump`),\nthe resulting function can have an arbitrary number of upvalues.)\nAll upvalues are fresh, that is,\nthey are not shared with any other function.\n\n`?chunkname` is used as the name of the chunk for error messages\nand debug information\nWhen absent,\nit defaults to `chunk`, if `chunk` is a string,\nor to `\"=(load)\"` otherwise.\n\nThe string `?mode` controls whether the chunk can be text or binary\n(that is, a precompiled chunk).\nIt may be the string `\"b\"` (only binary chunks),\n`\"t\"` (only text chunks),\nor `\"bt\"` (both binary and text).\nThe default is `\"bt\"`.\n\nLua does not check the consistency of binary chunks.\nMaliciously crafted binary chunks can crash\nthe interpreter."}}, loadfile = {binding = "loadfile", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?filename", "?mode", "?env"}, ["fnl/docstring"] = "Similar to `load`,\nbut gets the chunk from file `?filename`\nor from the standard input,\nif no file name is given."}}, math = {binding = "math", fields = {abs = {binding = "math.abs", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the absolute value of `x`. (integer/float)"}}, acos = {binding = "math.acos", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the arc cosine of `x` (in radians)."}}, asin = {binding = "math.asin", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the arc sine of `x` (in radians)."}}, atan = {binding = "math.atan", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"y", "?x"}, ["fnl/docstring"] = "Returns the arc tangent of `y/x` (in radians),\nbut uses the signs of both arguments to find the\nquadrant of the result.\n(It also handles correctly the case of `?x` being zero.)\n\nThe default value for `?x` is 1,\nso that the call `math.atan(y)`\nreturns the arc tangent of `y`."}}, ceil = {binding = "math.ceil", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the smallest integral value larger than or equal to `x`."}}, cos = {binding = "math.cos", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the cosine of `x` (assumed to be in radians)."}}, deg = {binding = "math.deg", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Converts the angle `x` from radians to degrees."}}, exp = {binding = "math.exp", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the value *e\203\163*\n(where `e` is the base of natural logarithms)."}}, floor = {binding = "math.floor", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the largest integral value smaller than or equal to `x`."}}, fmod = {binding = "math.fmod", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x", "y"}, ["fnl/docstring"] = "Returns the remainder of the division of `x` by `y`\nthat rounds the quotient towards zero. (integer/float)"}}, huge = {binding = "math.huge", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "The float value `HUGE_VAL`,\na value larger than any other numeric value."}}, log = {binding = "math.log", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x", "?base"}, ["fnl/docstring"] = "Returns the logarithm of `x` in the given base.\nThe default for `?base` is *e*\n(so that the function returns the natural logarithm of `x`)."}}, max = {binding = "math.max", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x", "..."}, ["fnl/docstring"] = "Returns the argument with the maximum value,\naccording to the Lua operator `<`. (integer/float)"}}, maxinteger = {binding = "math.maxinteger", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "An integer with the maximum value for an integer."}}, min = {binding = "math.min", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x", "..."}, ["fnl/docstring"] = "Returns the argument with the minimum value,\naccording to the Lua operator `<`. (integer/float)"}}, mininteger = {binding = "math.mininteger", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "An integer with the minimum value for an integer."}}, modf = {binding = "math.modf", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the integral part of `x` and the fractional part of `x`.\nIts second result is always a float."}}, pi = {binding = "math.pi", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "The value of *\207\128*."}}, rad = {binding = "math.rad", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Converts the angle `x` from degrees to radians."}}, random = {binding = "math.random", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?m", "?n"}, ["fnl/docstring"] = "When called without arguments,\nreturns a pseudo-random float with uniform distribution\nin the range  *[0,1)*.  \nWhen called with two integers `?m` and `?n`,\n`math.random` returns a pseudo-random integer\nwith uniform distribution in the range *[m, n]*.\n(The value *n-m* cannot be negative and must fit in a Lua integer.)\nThe call `math.random(n)` is equivalent to `math.random(1,n)`.\n\nThis function is an interface to the underling\npseudo-random generator function provided by C."}}, randomseed = {binding = "math.randomseed", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Sets `x` as the \"seed\"\nfor the pseudo-random generator:\nequal seeds produce equal sequences of numbers."}}, sin = {binding = "math.sin", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the sine of `x` (assumed to be in radians)."}}, sqrt = {binding = "math.sqrt", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the square root of `x`.\n(You can also use the expression `x^0.5` to compute this value.)"}}, tan = {binding = "math.tan", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the tangent of `x` (assumed to be in radians)."}}, tointeger = {binding = "math.tointeger", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "If the value `x` is convertible to an integer,\nreturns that integer.\nOtherwise, returns **nil**."}}, type = {binding = "math.type", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns `\"integer\"` if `x` is an integer,\n`\"float\"` if it is a float,\nor **nil** if `x` is not a number."}}, ult = {binding = "math.ult", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"m", "n"}, ["fnl/docstring"] = "Returns a boolean,\ntrue if and only if integer `m` is below integer `n` when\nthey are compared as unsigned integers."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "This library provides basic mathematical functions.\nIt provides all its functions and constants inside the table `math`.\nFunctions with the annotation `\"integer/float\"` give\ninteger results for integer arguments\nand float results for float (or mixed) arguments.\nRounding functions\n(`math.ceil`, `math.floor`, and `math.modf`)\nreturn an integer when the result fits in the range of an integer,\nor a float otherwise."}}, next = {binding = "next", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"table", "?index"}, ["fnl/docstring"] = "Allows a program to traverse all fields of a table.\nIts first argument is a table and its second argument\nis an index in this table.\n`next` returns the next index of the table\nand its associated value.\nWhen called with **nil** as its second argument,\n`next` returns an initial index\nand its associated value.\nWhen called with the last index,\nor with **nil** in an empty table,\n`next` returns **nil**.\nIf the second argument is absent, then it is interpreted as **nil**.\nIn particular,\nyou can use `next(t)` to check whether a table is empty.\n\nThe order in which the indices are enumerated is not specified,\n*even for numeric indices*.\n(To traverse a table in numerical order,\nuse a numerical **for**.)\n\nThe behavior of `next` is undefined if,\nduring the traversal,\nyou assign any value to a non-existent field in the table.\nYou may however modify existing fields.\nIn particular, you may clear existing fields."}}, os = {binding = "os", fields = {clock = {binding = "os.clock", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {}, ["fnl/docstring"] = "Returns an approximation of the amount in seconds of CPU time\nused by the program."}}, date = {binding = "os.date", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?format", "?time"}, ["fnl/docstring"] = "Returns a string or a table containing date and time,\nformatted according to the given string `?format`.\n\nIf the `?time` argument is present,\nthis is the time to be formatted\n(see the `os.time` function for a description of this value).\nOtherwise, `date` formats the current time.\n\nIf `?format` starts with `\"!\"`,\nthen the date is formatted in Coordinated Universal Time.\nAfter this optional character,\nif `?format` is the string `\"*t\"`,\nthen `date` returns a table with the following fields:\n`year`, `month` (1\226\128\14712), `day` (1\226\128\14731),\n`hour` (0\226\128\14723), `min` (0\226\128\14759), `sec` (0\226\128\14761),\n`wday` (weekday, 1\226\128\1477, Sunday is 1),\n`yday` (day of the year, 1\226\128\147366),\nand `isdst` (daylight saving flag, a boolean).\nThis last field may be absent\nif the information is not available.\n\nIf `?format` is not `\"*t\"`,\nthen `date` returns the date as a string,\nformatted according to the same rules as the ISO C function `strftime`.\n\nWhen called without arguments,\n`date` returns a reasonable date and time representation that depends on\nthe host system and on the current locale.\n(More specifically, `os.date()` is equivalent to `os.date(\"%c\")`.)\n\nIn non-POSIX systems,\nthis function may be not thread safe\nbecause of its reliance on C function `gmtime` and C function `localtime`."}}, difftime = {binding = "os.difftime", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"t2", "t1"}, ["fnl/docstring"] = "Returns the difference, in seconds,\nfrom time `t1` to time `t2`\n(where the times are values returned by `os.time`).\nIn POSIX, Windows, and some other systems,\nthis value is exactly `t2`*-*`t1`."}}, execute = {binding = "os.execute", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?command"}, ["fnl/docstring"] = "This function is equivalent to the ISO C function `system`.\nIt passes `?command` to be executed by an operating system shell.\nIts first result is **true**\nif the command terminated successfully,\nor **nil** otherwise.\nAfter this first result\nthe function returns a string plus a number,\nas follows:\n\n* **`\"exit\"`: **\n  the command terminated normally;\n  the following number is the exit status of the command.\n\n* **`\"signal\"`: **\n  the command was terminated by a signal;\n  the following number is the signal that terminated the command.\n\nWhen called without a `?command`,\n`os.execute` returns a boolean that is true if a shell is available."}}, exit = {binding = "os.exit", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?code", "?close"}, ["fnl/docstring"] = "Calls the ISO C function `exit` to terminate the host program.\nIf `?code` is **true**,\nthe returned status is `EXIT_SUCCESS`;\nif `?code` is **false**,\nthe returned status is `EXIT_FAILURE`;\nif `?code` is a number,\nthe returned status is this number.\nThe default value for `?code` is **true**.\n\nIf the optional second argument `?close` is true,\ncloses the Lua state before exiting."}}, getenv = {binding = "os.getenv", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"varname"}, ["fnl/docstring"] = "Returns the value of the process environment variable `varname`,\nor **nil** if the variable is not defined."}}, remove = {binding = "os.remove", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"filename"}, ["fnl/docstring"] = "Deletes the file (or empty directory, on POSIX systems)\nwith the given name.\nIf this function fails, it returns **nil**,\nplus a string describing the error and the error code.\nOtherwise, it returns true."}}, rename = {binding = "os.rename", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"oldname", "newname"}, ["fnl/docstring"] = "Renames the file or directory named `oldname` to `newname`.\nIf this function fails, it returns **nil**,\nplus a string describing the error and the error code.\nOtherwise, it returns true."}}, setlocale = {binding = "os.setlocale", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"locale", "?category"}, ["fnl/docstring"] = "Sets the current locale of the program.\n`locale` is a system-dependent string specifying a locale;\n`?category` is an optional string describing which category to change:\n`\"all\"`, `\"collate\"`, `\"ctype\"`,\n`\"monetary\"`, `\"numeric\"`, or `\"time\"`;\nthe default category is `\"all\"`.\nThe function returns the name of the new locale,\nor **nil** if the request cannot be honored.\n\nIf `locale` is the empty string,\nthe current locale is set to an implementation-defined native locale.\nIf `locale` is the string `\"C\"`,\nthe current locale is set to the standard C locale.\n\nWhen called with **nil** as the first argument,\nthis function only returns the name of the current locale\nfor the given category.\n\nThis function may be not thread safe\nbecause of its reliance on C function `setlocale`."}}, time = {binding = "os.time", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?table"}, ["fnl/docstring"] = "Returns the current time when called without arguments,\nor a time representing the local date and time specified by the given table.\nThis table must have fields `year`, `month`, and `day`,\nand may have fields\n`hour` (default is 12),\n`min` (default is 0),\n`sec` (default is 0),\nand `isdst` (default is **nil**).\nOther fields are ignored.\nFor a description of these fields, see the `os.date` function.\n\nThe values in these fields do not need to be inside their valid ranges.\nFor instance, if `sec` is -10,\nit means -10 seconds from the time specified by the other fields;\nif `hour` is 1000,\nit means +1000 hours from the time specified by the other fields.\n\nThe returned value is a number, whose meaning depends on your system.\nIn POSIX, Windows, and some other systems,\nthis number counts the number\nof seconds since some given start time (the \"epoch\").\nIn other systems, the meaning is not specified,\nand the number returned by `time` can be used only as an argument to\n`os.date` and `os.difftime`."}}, tmpname = {binding = "os.tmpname", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {}, ["fnl/docstring"] = "Returns a string with a file name that can\nbe used for a temporary file.\nThe file must be explicitly opened before its use\nand explicitly removed when no longer needed.\n\nIn POSIX systems,\nthis function also creates a file with that name,\nto avoid security risks.\n(Someone else might create the file with wrong permissions\nin the time between getting the name and creating the file.)\nYou still have to open the file to use it\nand to remove it (even if you do not use it).\n\nWhen possible,\nyou may prefer to use `io.tmpfile`,\nwhich automatically removes the file when the program ends."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "This library is implemented through table `os`."}}, package = {binding = "package", fields = {config = {binding = "package.config", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "A string describing some compile-time configurations for packages.\nThis string is a sequence of lines:\n\n* The first line is the directory separator string.\n  Default is `\"\\\"` for Windows and `\"/\"` for all other systems.\n\n* The second line is the character that separates templates in a path.\n  Default is `\";\"`.\n\n* The third line is the string that marks the\n  substitution points in a template.\n  Default is `\"?\"`.\n\n* The fourth line is a string that, in a path in Windows,\n  is replaced by the executable's directory.\n  Default is `\"!\"`.\n\n* The fifth line is a mark to ignore all text after it\n  when building the `luaopen_` function name.\n  Default is `\"-\"`."}}, cpath = {binding = "package.cpath", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "The path used by `require` to search for a C loader.\n\nLua initializes the C path `package.cpath` in the same way\nit initializes the Lua path `package.path`,\nusing the environment variable `LUA_CPATH_5_3`,\nor the environment variable `LUA_CPATH`,\nor a default path defined in `luaconf.h`."}}, loaded = {binding = "package.loaded", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "A table used by `require` to control which\nmodules are already loaded.\nWhen you require a module `modname` and\n`package.loaded[modname]` is not false,\n`require` simply returns the value stored there.\n\nThis variable is only a reference to the real table;\nassignments to this variable do not change the\ntable used by `require`."}}, loadlib = {binding = "package.loadlib", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"libname", "funcname"}, ["fnl/docstring"] = "Dynamically links the host program with the C library `libname`.\n\nIf `funcname` is `\"*\"`,\nthen it only links with the library,\nmaking the symbols exported by the library\navailable to other dynamically linked libraries.\nOtherwise,\nit looks for a function `funcname` inside the library\nand returns this function as a C function.\nSo, `funcname` must follow the `lua_CFunction` prototype\n(see `lua_CFunction`).\n\nThis is a low-level function.\nIt completely bypasses the package and module system.\nUnlike `require`,\nit does not perform any path searching and\ndoes not automatically adds extensions.\n`libname` must be the complete file name of the C library,\nincluding if necessary a path and an extension.\n`funcname` must be the exact name exported by the C library\n(which may depend on the C compiler and linker used).\n\nThis function is not supported by Standard C.\nAs such, it is only available on some platforms\n(Windows, Linux, Mac OS X, Solaris, BSD,\nplus other Unix systems that support the `dlfcn` standard)."}}, path = {binding = "package.path", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "The path used by `require` to search for a Lua loader.\n\nAt start-up, Lua initializes this variable with\nthe value of the environment variable `LUA_PATH_5_3` or\nthe environment variable `LUA_PATH` or\nwith a default path defined in `luaconf.h`,\nif those environment variables are not defined.\nAny `\";;\"` in the value of the environment variable\nis replaced by the default path."}}, preload = {binding = "package.preload", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "A table to store loaders for specific modules\n(see `require`).\n\nThis variable is only a reference to the real table;\nassignments to this variable do not change the\ntable used by `require`."}}, searchers = {binding = "package.searchers", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "A table used by `require` to control how to load modules.\n\nEach entry in this table is a *searcher function*.\nWhen looking for a module,\n`require` calls each of these searchers in ascending order,\nwith the module name (the argument given to `require`) as its\nsole parameter.\nThe function can return another function (the module *loader*)\nplus an extra value that will be passed to that loader,\nor a string explaining why it did not find that module\n(or **nil** if it has nothing to say).\n\nLua initializes this table with four searcher functions.\n\nThe first searcher simply looks for a loader in the\n`package.preload` table.\n\nThe second searcher looks for a loader as a Lua library,\nusing the path stored at `package.path`.\nThe search is done as described in function `package.searchpath`.\n\nThe third searcher looks for a loader as a C library,\nusing the path given by the variable `package.cpath`.\nAgain,\nthe search is done as described in function `package.searchpath`.\nFor instance,\nif the C path is the string\n\n```lua\n     \"./?.so;./?.dll;/usr/local/?/init.so\"\n```\nthe searcher for module `foo`\nwill try to open the files `./foo.so`, `./foo.dll`,\nand `/usr/local/foo/init.so`, in that order.\nOnce it finds a C library,\nthis searcher first uses a dynamic link facility to link the\napplication with the library.\nThen it tries to find a C function inside the library to\nbe used as the loader.\nThe name of this C function is the string `\"luaopen_\"`\nconcatenated with a copy of the module name where each dot\nis replaced by an underscore.\nMoreover, if the module name has a hyphen,\nits suffix after (and including) the first hyphen is removed.\nFor instance, if the module name is `a.b.c-v2.1`,\nthe function name will be `luaopen_a_b_c`.\n\nThe fourth searcher tries an *all-in-one loader*.\nIt searches the C path for a library for\nthe root name of the given module.\nFor instance, when requiring `a.b.c`,\nit will search for a C library for `a`.\nIf found, it looks into it for an open function for\nthe submodule;\nin our example, that would be `luaopen_a_b_c`.\nWith this facility, a package can pack several C submodules\ninto one single library,\nwith each submodule keeping its original open function.\n\nAll searchers except the first one (preload) return as the extra value\nthe file name where the module was found,\nas returned by `package.searchpath`.\nThe first searcher returns no extra value."}}, searchpath = {binding = "package.searchpath", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"name", "path", "?sep", "?rep"}, ["fnl/docstring"] = "Searches for the given `name` in the given `path`.\n\nA path is a string containing a sequence of\n*templates* separated by semicolons.\nFor each template,\nthe function replaces each interrogation mark (if any)\nin the template with a copy of `name`\nwherein all occurrences of `?sep`\n(a dot, by default)\nwere replaced by `?rep`\n(the system's directory separator, by default),\nand then tries to open the resulting file name.\n\nFor instance, if the path is the string\n\n```lua\n     \"./?.lua;./?.lc;/usr/local/?/init.lua\"\n```\nthe search for the name `foo.a`\nwill try to open the files\n`./foo/a.lua`, `./foo/a.lc`, and\n`/usr/local/foo/a/init.lua`, in that order.\n\nReturns the resulting name of the first file that it can\nopen in read mode (after closing the file),\nor **nil** plus an error message if none succeeds.\n(This error message lists all file names it tried to open.)"}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "The package library provides basic\nfacilities for loading modules in Lua.\nIt exports one function directly in the global environment:\n`require`.\nEverything else is exported in a table `package`."}}, pairs = {binding = "pairs", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"t"}, ["fnl/docstring"] = "If `t` has a metamethod `__pairs`,\ncalls it with `t` as argument and returns the first three\nresults from the call.\n\nOtherwise,\nreturns three values: the `next` function, the table `t`, and **nil**,\nso that the construction\n\n```lua\n     for k,v in pairs(t) do *body* end\n```\nwill iterate over all key\226\128\147value pairs of table `t`.\n\nSee function `next` for the caveats of modifying\nthe table during its traversal."}}, pcall = {binding = "pcall", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f", "?arg1", "..."}, ["fnl/docstring"] = "Calls function `f` with\nthe given arguments in *protected mode*.\nThis means that any error inside `f` is not propagated;\ninstead, `pcall` catches the error\nand returns a status code.\nIts first result is the status code (a boolean),\nwhich is true if the call succeeds without errors.\nIn such case, `pcall` also returns all results from the call,\nafter this first result.\nIn case of any error, `pcall` returns **false** plus the error message."}}, print = {binding = "print", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"..."}, ["fnl/docstring"] = "Receives any number of arguments\nand prints their values to `stdout`,\nusing the `tostring` function to convert each argument to a string.\n`print` is not intended for formatted output,\nbut only as a quick way to show a value,\nfor instance for debugging.\nFor complete control over the output,\nuse `string.format` and `io.write`."}}, rawequal = {binding = "rawequal", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"v1", "v2"}, ["fnl/docstring"] = "Checks whether `v1` is equal to `v2`,\nwithout invoking the `__eq` metamethod.\nReturns a boolean."}}, rawget = {binding = "rawget", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"table", "index"}, ["fnl/docstring"] = "Gets the real value of `table[index]`,\nwithout invoking the `__index` metamethod.\n`table` must be a table;\n`index` may be any value."}}, rawlen = {binding = "rawlen", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"v"}, ["fnl/docstring"] = "Returns the length of the object `v`,\nwhich must be a table or a string,\nwithout invoking the `__len` metamethod.\nReturns an integer."}}, rawset = {binding = "rawset", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"table", "index", "value"}, ["fnl/docstring"] = "Sets the real value of `table[index]` to `value`,\nwithout invoking the `__newindex` metamethod.\n`table` must be a table,\n`index` any value different from **nil** and NaN,\nand `value` any Lua value.\n\nThis function returns `table`."}}, require = {binding = "require", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"modname"}, ["fnl/docstring"] = "Loads the given module.\nThe function starts by looking into the `package.loaded` table\nto determine whether `modname` is already loaded.\nIf it is, then `require` returns the value stored\nat `package.loaded[modname]`.\nOtherwise, it tries to find a *loader* for the module.\n\nTo find a loader,\n`require` is guided by the `package.searchers` sequence.\nBy changing this sequence,\nwe can change how `require` looks for a module.\nThe following explanation is based on the default configuration\nfor `package.searchers`.\n\nFirst `require` queries `package.preload[modname]`.\nIf it has a value,\nthis value (which must be a function) is the loader.\nOtherwise `require` searches for a Lua loader using the\npath stored in `package.path`.\nIf that also fails, it searches for a C loader using the\npath stored in `package.cpath`.\nIf that also fails,\nit tries an *all-in-one* loader (see `package.searchers`).\n\nOnce a loader is found,\n`require` calls the loader with two arguments:\n`modname` and an extra value dependent on how it got the loader.\n(If the loader came from a file,\nthis extra value is the file name.)\nIf the loader returns any non-nil value,\n`require` assigns the returned value to `package.loaded[modname]`.\nIf the loader does not return a non-nil value and\nhas not assigned any value to `package.loaded[modname]`,\nthen `require` assigns **true** to this entry.\nIn any case, `require` returns the\nfinal value of `package.loaded[modname]`.\n\nIf there is any error loading or running the module,\nor if it cannot find any loader for the module,\nthen `require` raises an error."}}, select = {binding = "select", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"index", "..."}, ["fnl/docstring"] = "If `index` is a number,\nreturns all arguments after argument number `index`;\na negative number indexes from the end (-1 is the last argument).\nOtherwise, `index` must be the string `\"#\"`,\nand `select` returns the total number of extra arguments it received."}}, setmetatable = {binding = "setmetatable", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"table", "metatable"}, ["fnl/docstring"] = "Sets the metatable for the given table.\n(To change the metatable of other types from Lua code,\nyou must use the debug library)\nIf `metatable` is **nil**,\nremoves the metatable of the given table.\nIf the original metatable has a `__metatable` field,\nraises an error.\n\nThis function returns `table`."}}, string = {binding = "string", fields = {byte = {binding = "string.byte", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "?i", "?j"}, ["fnl/docstring"] = "Returns the internal numeric codes of the characters `s[i]`,\n`s[i+1]`, ..., `s[j]`.\nThe default value for `?i` is 1;\nthe default value for `?j` is `?i`.\nThese indices are corrected\nfollowing the same rules of function `string.sub`.\n\nNumeric codes are not necessarily portable across platforms."}}, char = {binding = "string.char", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"..."}, ["fnl/docstring"] = "Receives zero or more integers.\nReturns a string with length equal to the number of arguments,\nin which each character has the internal numeric code equal\nto its corresponding argument.\n\nNumeric codes are not necessarily portable across platforms."}}, dump = {binding = "string.dump", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"function", "?strip"}, ["fnl/docstring"] = "Returns a string containing a binary representation\n(a *binary chunk*)\nof the given function,\nso that a later `load` on this string returns\na copy of the function (but with new upvalues).\nIf `?strip` is a true value,\nthe binary representation may not include all debug information\nabout the function,\nto save space.\n\nFunctions with upvalues have only their number of upvalues saved.\nWhen (re)loaded,\nthose upvalues receive fresh instances containing **nil**.\n(You can use the debug library to serialize\nand reload the upvalues of a function\nin a way adequate to your needs.)"}}, find = {binding = "string.find", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "pattern", "?init", "?plain"}, ["fnl/docstring"] = "Looks for the first match of\n`pattern`in the string `s`.\nIf it finds a match, then `find` returns the indices of `s`\nwhere this occurrence starts and ends;\notherwise, it returns **nil**.\nA third, optional numeric argument `?init` specifies\nwhere to start the search;\nits default value is 1 and can be negative.\nA value of **true** as a fourth, optional argument `?plain`\nturns off the pattern matching facilities,\nso the function does a plain \"find substring\" operation,\nwith no characters in `pattern` being considered magic.\nNote that if `?plain` is given, then `?init` must be given as well.\n\nIf the pattern has captures,\nthen in a successful match\nthe captured values are also returned,\nafter the two indices."}}, format = {binding = "string.format", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"formatstring", "..."}, ["fnl/docstring"] = "Returns a formatted version of its variable number of arguments\nfollowing the description given in its first argument (which must be a string).\nThe format string follows the same rules as the ISO C function `sprintf`.\nThe only differences are that the options/modifiers\n`*`, `h`, `L`, `l`, `n`,\nand `p` are not supported\nand that there is an extra option, `q`.\n\nThe `q` option formats a string between double quotes,\nusing escape sequences when necessary to ensure that\nit can safely be read back by the Lua interpreter.\nFor instance, the call\n\n```lua\n     string.format('%q', 'a string with \"quotes\" and \\n new line')\n```\nmay produce the string:\n\n```lua\n     \"a string with \\\"quotes\\\" and \\\n      new line\"\n```\n\nOptions\n`A`, `a`, `E`, `e`, `f`,\n`G`, and `g` all expect a number as argument.\nOptions `c`, `d`,\n`i`, `o`, `u`, `X`, and `x`\nexpect an integer.\nWhen Lua is compiled with a C89 compiler,\noptions `A` and `a` (hexadecimal floats)\ndo not support any modifier (flags, width, length).\n\nOption `s` expects a string;\nif its argument is not a string,\nit is converted to one following the same rules of `tostring`.\nIf the option has any modifier (flags, width, length),\nthe string argument should not contain embedded zeros."}}, gmatch = {binding = "string.gmatch", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "pattern"}, ["fnl/docstring"] = "Returns an iterator function that,\neach time it is called,\nreturns the next captures from `pattern`over the string `s`.\nIf `pattern` specifies no captures,\nthen the whole match is produced in each call.\n\nAs an example, the following loop\nwill iterate over all the words from string `s`,\nprinting one per line:\n\n```lua\n     s = \"hello world from Lua\"\n     for w in string.gmatch(s, \"%a+\") do\n       print(w)\n     end\n```\nThe next example collects all pairs `key=value` from the\ngiven string into a table:\n\n```lua\n     t = {}\n     s = \"from=world, to=Lua\"\n     for k, v in string.gmatch(s, \"(%w+)=(%w+)\") do\n       t[k] = v\n     end\n```\n\nFor this function, a caret `\"^\"` at the start of a pattern does not\nwork as an anchor, as this would prevent the iteration."}}, gsub = {binding = "string.gsub", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "pattern", "repl", "?n"}, ["fnl/docstring"] = "Returns a copy of `s`\nin which all (or the first `?n`, if given)\noccurrences of the `pattern`have been\nreplaced by a replacement string specified by `repl`,\nwhich can be a string, a table, or a function.\n`gsub` also returns, as its second value,\nthe total number of matches that occurred.\nThe name `gsub` comes from *Global SUBstitution*.\n\nIf `repl` is a string, then its value is used for replacement.\nThe character `%` works as an escape character:\nany sequence in `repl` of the form `%*d*`,\nwith *d* between 1 and 9,\nstands for the value of the *d*-th captured substring.\nThe sequence `%0` stands for the whole match.\nThe sequence `%%` stands for a single `%`.\n\nIf `repl` is a table, then the table is queried for every match,\nusing the first capture as the key.\n\nIf `repl` is a function, then this function is called every time a\nmatch occurs, with all captured substrings passed as arguments,\nin order.\n\nIn any case,\nif the pattern specifies no captures,\nthen it behaves as if the whole pattern was inside a capture.\n\nIf the value returned by the table query or by the function call\nis a string or a number,\nthen it is used as the replacement string;\notherwise, if it is **false** or **nil**,\nthen there is no replacement\n(that is, the original match is kept in the string).\n\nHere are some examples:\n\n```lua\n     x = string.gsub(\"hello world\", \"(%w+)\", \"%1 %1\")\n     --> x=\"hello hello world world\"\n     \n     x = string.gsub(\"hello world\", \"%w+\", \"%0 %0\", 1)\n     --> x=\"hello hello world\"\n     \n     x = string.gsub(\"hello world from Lua\", \"(%w+)%s*(%w+)\", \"%2 %1\")\n     --> x=\"world hello Lua from\"\n     \n     x = string.gsub(\"home = $HOME, user = $USER\", \"%$(%w+)\", os.getenv)\n     --> x=\"home = /home/roberto, user = roberto\"\n     \n     x = string.gsub(\"4+5 = $return 4+5$\", \"%$(.-)%$\", function (s)\n           return load(s)()\n         end)\n     --> x=\"4+5 = 9\"\n     \n     local t = {name=\"lua\", version=\"5.3\"}\n     x = string.gsub(\"$name-$version.tar.gz\", \"%$(%w+)\", t)\n     --> x=\"lua-5.3.tar.gz\"\n```"}}, len = {binding = "string.len", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s"}, ["fnl/docstring"] = "Receives a string and returns its length.\nThe empty string `\"\"` has length 0.\nEmbedded zeros are counted,\nso `\"a\\000bc\\000\"` has length 5."}}, lower = {binding = "string.lower", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s"}, ["fnl/docstring"] = "Receives a string and returns a copy of this string with all\nuppercase letters changed to lowercase.\nAll other characters are left unchanged.\nThe definition of what an uppercase letter is depends on the current locale."}}, match = {binding = "string.match", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "pattern", "?init"}, ["fnl/docstring"] = "Looks for the first *match* of\n`pattern`in the string `s`.\nIf it finds one, then `match` returns\nthe captures from the pattern;\notherwise it returns **nil**.\nIf `pattern` specifies no captures,\nthen the whole match is returned.\nA third, optional numeric argument `?init` specifies\nwhere to start the search;\nits default value is 1 and can be negative."}}, pack = {binding = "string.pack", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"fmt", "v1", "v2", "..."}, ["fnl/docstring"] = "Returns a binary string containing the values `v1`, `v2`, etc.\npacked (that is, serialized in binary form)\naccording to the format string `fmt`"}}, packsize = {binding = "string.packsize", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"fmt"}, ["fnl/docstring"] = "Returns the size of a string resulting from `string.pack`\nwith the given format.\nThe format string cannot have the variable-length options\n`\"s\"` or `\"z\"`"}}, rep = {binding = "string.rep", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "n", "?sep"}, ["fnl/docstring"] = "Returns a string that is the concatenation of `n` copies of\nthe string `s` separated by the string `?sep`.\nThe default value for `?sep` is the empty string\n(that is, no separator).\nReturns the empty string if `n` is not positive.\n\n(Note that it is very easy to exhaust the memory of your machine\nwith a single call to this function.)"}}, reverse = {binding = "string.reverse", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s"}, ["fnl/docstring"] = "Returns a string that is the string `s` reversed."}}, sub = {binding = "string.sub", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "i", "?j"}, ["fnl/docstring"] = "Returns the substring of `s` that\nstarts at `i`  and continues until `?j`;\n`i` and `?j` can be negative.\nIf `?j` is absent, then it is assumed to be equal to -1\n(which is the same as the string length).\nIn particular,\nthe call `string.sub(s,1,j)` returns a prefix of `s`\nwith length `?j`,\nand `string.sub(s, -i)` (for a positive `i`)\nreturns a suffix of `s`\nwith length `i`.\n\nIf, after the translation of negative indices,\n`i` is less than 1,\nit is corrected to 1.\nIf `?j` is greater than the string length,\nit is corrected to that length.\nIf, after these corrections,\n`i` is greater than `?j`,\nthe function returns the empty string."}}, unpack = {binding = "string.unpack", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"fmt", "s", "?pos"}, ["fnl/docstring"] = "Returns the values packed in string `s` (see `string.pack`)\naccording to the format string `fmt`\nAn optional `?pos` marks where\nto start reading in `s` (default is 1).\nAfter the read values,\nthis function also returns the index of the first unread byte in `s`."}}, upper = {binding = "string.upper", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s"}, ["fnl/docstring"] = "Receives a string and returns a copy of this string with all\nlowercase letters changed to uppercase.\nAll other characters are left unchanged.\nThe definition of what a lowercase letter is depends on the current locale."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "This library provides generic functions for string manipulation,\nsuch as finding and extracting substrings, and pattern matching.\nWhen indexing a string in Lua, the first character is at position 1\n(not at 0, as in C).\nIndices are allowed to be negative and are interpreted as indexing backwards,\nfrom the end of the string.\nThus, the last character is at position -1, and so on.\n\nThe string library provides all its functions inside the table\n`string`.\nIt also sets a metatable for strings\nwhere the `__index` field points to the `string` table.\nTherefore, you can use the string functions in object-oriented style.\nFor instance, `string.byte(s,i)`\ncan be written as `s:byte(i)`.\n\nThe string library assumes one-byte character encodings."}}, table = {binding = "table", fields = {concat = {binding = "table.concat", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"list", "?sep", "?i", "?j"}, ["fnl/docstring"] = "Given a list where all elements are strings or numbers,\nreturns the string `list[i]..sep..list[i+1] ... sep..list[j]`.\nThe default value for `?sep` is the empty string,\nthe default for `?i` is 1,\nand the default for `?j` is `#list`.\nIf `?i` is greater than `?j`, returns the empty string."}}, insert = {binding = "table.insert", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"list", "value"}, ["fnl/docstring"] = "Inserts element `value` at position `pos` in `list`,\nshifting up the elements\n`list[pos], list[pos+1], ..., list[#list]`.\nThe default value for `pos` is `#list+1`,\nso that a call `table.insert(t,x)` inserts `x` at the end\nof list `t`."}}, move = {binding = "table.move", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"a1", "f", "e", "t", "?a2"}, ["fnl/docstring"] = "Moves elements from table `a1` to table `?a2`,\nperforming the equivalent to the following\nmultiple assignment:\n`a2[t],... = a1[f],...,a1[e]`.\nThe default for `?a2` is `a1`.\nThe destination range can overlap with the source range.\nThe number of elements to be moved must fit in a Lua integer.\n\nReturns the destination table `?a2`."}}, pack = {binding = "table.pack", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"..."}, ["fnl/docstring"] = "Returns a new table with all arguments stored into keys 1, 2, etc.\nand with a field `\"n\"` with the total number of arguments.\nNote that the resulting table may not be a sequence."}}, remove = {binding = "table.remove", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"list", "?pos"}, ["fnl/docstring"] = "Removes from `list` the element at position `?pos`,\nreturning the value of the removed element.\nWhen `?pos` is an integer between 1 and `#list`,\nit shifts down the elements\n`list[pos+1], list[pos+2], ..., list[#list]`\nand erases element `list[#list]`;\nThe index `?pos` can also be 0 when `#list` is 0,\nor `#list + 1`;\nin those cases, the function erases the element `list[pos]`.\n\nThe default value for `?pos` is `#list`,\nso that a call `table.remove(l)` removes the last element\nof list `l`."}}, sort = {binding = "table.sort", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"list", "?comp"}, ["fnl/docstring"] = "Sorts list elements in a given order, *in-place*,\nfrom `list[1]` to `list[#list]`.\nIf `?comp` is given,\nthen it must be a function that receives two list elements\nand returns true when the first element must come\nbefore the second in the final order\n(so that, after the sort,\n`i < j` implies `not comp(list[j],list[i])`).\nIf `?comp` is not given,\nthen the standard Lua operator `<` is used instead.\n\nNote that the `?comp` function must define\na strict partial order over the elements in the list;\nthat is, it must be asymmetric and transitive.\nOtherwise, no valid sort may be possible.\n\nThe sort algorithm is not stable:\nelements considered equal by the given order\nmay have their relative positions changed by the sort."}}, unpack = {binding = "table.unpack", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"list", "?i", "?j"}, ["fnl/docstring"] = "Returns the elements from the given list.\nThis function is equivalent to\n\n```lua\n     return list[i], list[i+1], ..., list[j]\n```\nBy default, `?i` is 1 and `?j` is `#list`."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "This library provides generic functions for table manipulation.\nIt provides all its functions inside the table `table`.\n\nRemember that, whenever an operation needs the length of a table,\nall caveats about the length operator apply\nAll functions ignore non-numeric keys\nin the tables given as arguments."}}, tonumber = {binding = "tonumber", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"e", "?base"}, ["fnl/docstring"] = "When called with no `?base`,\n`tonumber` tries to convert its argument to a number.\nIf the argument is already a number or\na string convertible to a number,\nthen `tonumber` returns this number;\notherwise, it returns **nil**.\n\nThe conversion of strings can result in integers or floats,\naccording to the lexical conventions of Lua\n(The string may have leading and trailing spaces and a sign.)\n\nWhen called with `?base`,\nthen `e` must be a string to be interpreted as\nan integer numeral in that base.\nThe base may be any integer between 2 and 36, inclusive.\nIn bases above 10, the letter `\"A\"` (in either upper or lower case)\nrepresents 10, `\"B\"` represents 11, and so forth,\nwith `\"Z\"` representing 35.\nIf the string `e` is not a valid numeral in the given base,\nthe function returns **nil**."}}, tostring = {binding = "tostring", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"v"}, ["fnl/docstring"] = "Receives a value of any type and\nconverts it to a string in a human-readable format.\n(For complete control of how numbers are converted,\nuse `string.format`.)\n\nIf the metatable of `v` has a `__tostring` field,\nthen `tostring` calls the corresponding value\nwith `v` as argument,\nand uses the result of the call as its result."}}, type = {binding = "type", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"v"}, ["fnl/docstring"] = "Returns the type of its only argument, coded as a string.\nThe possible results of this function are\n`\"nil\"` (a string, not the value **nil**),\n`\"number\"`,\n`\"string\"`,\n`\"boolean\"`,\n`\"table\"`,\n`\"function\"`,\n`\"thread\"`,\nand `\"userdata\"`."}}, utf8 = {binding = "utf8", fields = {char = {binding = "utf8.char", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"..."}, ["fnl/docstring"] = "Receives zero or more integers,\nconverts each one to its corresponding UTF-8 byte sequence\nand returns a string with the concatenation of all these sequences."}}, charpattern = {binding = "utf8.charpattern", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "The pattern (a string, not a function) `\"[\\0-\\x7F\\xC2-\\xF4][\\x80-\\xBF]*\"`\nwhich matches exactly one UTF-8 byte sequence,\nassuming that the subject is a valid UTF-8 string."}}, codepoint = {binding = "utf8.codepoint", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "?i", "?j"}, ["fnl/docstring"] = "Returns the codepoints (as integers) from all characters in `s`\nthat start between byte position `?i` and `?j` (both included).\nThe default for `?i` is 1 and for `?j` is `?i`.\nIt raises an error if it meets any invalid byte sequence."}}, codes = {binding = "utf8.codes", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s"}, ["fnl/docstring"] = "Returns values so that the construction\n\n```lua\n     for p, c in utf8.codes(s) do *body* end\n```\nwill iterate over all characters in string `s`,\nwith `p` being the position (in bytes) and `c` the code point\nof each character.\nIt raises an error if it meets any invalid byte sequence."}}, len = {binding = "utf8.len", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "?i", "?j"}, ["fnl/docstring"] = "Returns the number of UTF-8 characters in string `s`\nthat start between positions `?i` and `?j` (both inclusive).\nThe default for `?i` is 1 and for `?j` is -1.\nIf it finds any invalid byte sequence,\nreturns a false value plus the position of the first invalid byte."}}, offset = {binding = "utf8.offset", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "n", "?i"}, ["fnl/docstring"] = "Returns the position (in bytes) where the encoding of the\n`n`-th character of `s`\n(counting from position `?i`) starts.\nA negative `n` gets characters before position `?i`.\nThe default for `?i` is 1 when `n` is non-negative\nand `#s + 1` otherwise,\nso that `utf8.offset(s, -n)` gets the offset of the\n`n`-th character from the end of the string.\nIf the specified character is neither in the subject\nnor right after its end,\nthe function returns **nil**.\n\nAs a special case,\nwhen `n` is 0 the function returns the start of the encoding\nof the character that contains the `?i`-th byte of `s`.\n\nThis function assumes that `s` is a valid UTF-8 string."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "This library provides basic support for UTF-8 encoding.\nIt provides all its functions inside the table `utf8`.\nThis library does not provide any support for Unicode other\nthan the handling of the encoding.\nAny operation that needs the meaning of a character,\nsuch as character classification, is outside its scope.\n\nUnless stated otherwise,\nall functions that expect a byte position as a parameter\nassume that the given position is either the start of a byte sequence\nor one plus the length of the subject string.\nAs in the string library,\nnegative indices count from the end of the string."}}, xpcall = {binding = "xpcall", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f", "msgh", "?arg1", "..."}, ["fnl/docstring"] = "This function is similar to `pcall`,\nexcept that it sets a new message handler `msgh`."}}}
  local file_fields = {close = {binding = "file:close", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"self"}, ["fnl/docstring"] = "Closes `file`.\nNote that files are automatically closed when\ntheir handles are garbage collected,\nbut that takes an unpredictable amount of time to happen.\n\nWhen closing a file handle created with `io.popen`,\n`file:close` returns the same values\nreturned by `os.execute`."}}, flush = {binding = "file:flush", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"self"}, ["fnl/docstring"] = "Saves any written data to `file`."}}, lines = {binding = "file:lines", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"self", "..."}, ["fnl/docstring"] = "Returns an iterator function that,\neach time it is called,\nreads the file according to the given formats.\nWhen no format is given,\nuses `\"l\"` as a default.\nAs an example, the construction\n\n```lua\n     for c in file:lines(1) do *body* end\n```\nwill iterate over all characters of the file,\nstarting at the current position.\nUnlike `io.lines`, this function does not close the file\nwhen the loop ends.\n\nIn case of errors this function raises the error,\ninstead of returning an error code."}}, read = {binding = "file:read", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"self", "..."}, ["fnl/docstring"] = "Reads the file `file`,\naccording to the given formats, which specify what to read.\nFor each format,\nthe function returns a string or a number with the characters read,\nor **nil** if it cannot read data with the specified format.\n(In this latter case,\nthe function does not read subsequent formats.)\nWhen called without formats,\nit uses a default format that reads the next line\n(see below).\n\nThe available formats are\n\n* **`\"n\"`: **\n  reads a numeral and returns it as a float or an integer,\n  following the lexical conventions of Lua.\n  (The numeral may have leading spaces and a sign.)\n  This format always reads the longest input sequence that\n  is a valid prefix for a numeral;\n  if that prefix does not form a valid numeral\n  (e.g., an empty string, `\"0x\"`, or `\"3.4e-\"`),\n  it is discarded and the function returns **nil**.\n\n* **`\"a\"`: **\n  reads the whole file, starting at the current position.\n  On end of file, it returns the empty string.\n\n* **`\"l\"`: **\n  reads the next line skipping the end of line,\n  returning **nil** on end of file.\n  This is the default format.\n\n* **`\"L\"`: **\n  reads the next line keeping the end-of-line character (if present),\n  returning **nil** on end of file.\n\n* ***number*: **\n  reads a string with up to this number of bytes,\n  returning **nil** on end of file.\n  If `number` is zero,\n  it reads nothing and returns an empty string,\n  or **nil** on end of file.\n\nThe formats `\"l\"` and `\"L\"` should be used only for text files."}}, seek = {binding = "file:seek", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"self", "?whence", "?offset"}, ["fnl/docstring"] = "Sets and gets the file position,\nmeasured from the beginning of the file,\nto the position given by `?offset` plus a base\nspecified by the string `?whence`, as follows:\n\n* **`\"set\"`: ** base is position 0 (beginning of the file);\n* **`\"cur\"`: ** base is current position;\n* **`\"end\"`: ** base is end of file;\n\nIn case of success, `seek` returns the final file position,\nmeasured in bytes from the beginning of the file.\nIf `seek` fails, it returns **nil**,\nplus a string describing the error.\n\nThe default value for `?whence` is `\"cur\"`,\nand for `?offset` is 0.\nTherefore, the call `file:seek()` returns the current\nfile position, without changing it;\nthe call `file:seek(\"set\")` sets the position to the\nbeginning of the file (and returns 0);\nand the call `file:seek(\"end\")` sets the position to the\nend of the file, and returns its size."}}, setvbuf = {binding = "file:setvbuf", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"self", "mode", "?size"}, ["fnl/docstring"] = "Sets the buffering mode for an output file.\nThere are three available modes:\n\n* **`\"no\"`: **\n  no buffering; the result of any output operation appears immediately.\n\n* **`\"full\"`: **\n  full buffering; output operation is performed only\n  when the buffer is full or when\n  you explicitly `flush` the file (see `io.flush`).\n\n* **`\"line\"`: **\n  line buffering; output is buffered until a newline is output\n  or there is any input from some special files\n  (such as a terminal device).\n\nFor the last two cases, `?size`\nspecifies the size of the buffer, in bytes.\nThe default is an appropriate size."}}, write = {binding = "file:write", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"self", "..."}, ["fnl/docstring"] = "Writes the value of each of its arguments to `file`.\nThe arguments must be strings or numbers.\n\nIn case of success, this function returns `file`.\nOtherwise it returns **nil** plus a string describing the error."}}}
  docs._G.fields = docs
  docs.io.fields.stdin.fields = file_fields
  docs.io.fields.stdout.fields = file_fields
  docs.io.fields.stderr.fields = file_fields
  return docs
end
package.preload["fennel-ls.docs.generated.lua54"] = package.preload["fennel-ls.docs.generated.lua54"] or function(...)
  local docs = {_G = {binding = "_G", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "A global variable (not a function) that\nholds the global environment\nLua itself does not use this variable;\nchanging its value does not affect any environment,\nnor vice versa."}}, _VERSION = {binding = "_VERSION", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "A global variable (not a function) that\nholds a string containing the running Lua version.\nThe current value of this variable is `\"Lua 5.4\"`."}}, arg = {binding = "arg", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "Before running any code,\n`lua` collects all command-line arguments\nin a global table called `arg`.\nThe script name goes to index 0,\nthe first argument after the script name goes to index 1,\nand so on.\nAny arguments before the script name\n(that is, the interpreter name plus its options)\ngo to negative indices.\nFor instance, in the call\n\n```lua\n     $ lua -la b.lua t1 t2\n```\nthe table is like this:\n\n```lua\n     arg = { [-2] = \"lua\", [-1] = \"-la\",\n             [0] = \"b.lua\",\n             [1] = \"t1\", [2] = \"t2\" }\n```\nIf there is no script in the call,\nthe interpreter name goes to index 0,\nfollowed by the other arguments.\nFor instance, the call\n\n```lua\n     $ lua -e \"print(arg[1])\"\n```\nwill print `\"-e\"`.\nIf there is a script,\nthe script is called with arguments\n`arg[1]`, ..., `arg[#arg]`.\nLike all chunks in Lua,\nthe script is compiled as a variadic function."}}, assert = {binding = "assert", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"v", "?message"}, ["fnl/docstring"] = "Raises an error if\nthe value of its argument `v` is false (i.e., **nil** or **false**);\notherwise, returns all its arguments.\nIn case of error,\n`?message` is the error object;\nwhen absent, it defaults to `\"assertion failed!\"`"}}, collectgarbage = {binding = "collectgarbage", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?opt", "?arg"}, ["fnl/docstring"] = "This function is a generic interface to the garbage collector.\nIt performs different functions according to its first argument, `?opt`:\n\n* **`\"collect\"`: **\n  Performs a full garbage-collection cycle.\n  This is the default option.\n\n* **`\"stop\"`: **\n  Stops automatic execution of the garbage collector.\n  The collector will run only when explicitly invoked,\n  until a call to restart it.\n\n* **`\"restart\"`: **\n  Restarts automatic execution of the garbage collector.\n\n* **`\"count\"`: **\n  Returns the total memory in use by Lua in Kbytes.\n  The value has a fractional part,\n  so that it multiplied by 1024\n  gives the exact number of bytes in use by Lua.\n\n* **`\"step\"`: **\n  Performs a garbage-collection step.\n  The step \"size\" is controlled by `?arg`.\n  With a zero value,\n  the collector will perform one basic (indivisible) step.\n  For non-zero values,\n  the collector will perform as if that amount of memory\n  (in Kbytes) had been allocated by Lua.\n  Returns **true** if the step finished a collection cycle.\n\n* **`\"isrunning\"`: **\n  Returns a boolean that tells whether the collector is running\n  (i.e., not stopped).\n\n* **`\"incremental\"`: **\n  Change the collector mode to incremental.\n  This option can be followed by three numbers:\n  the garbage-collector pause,\n  the step multiplier,\n  and the step size\n  A zero means to not change that value.\n\n* **`\"generational\"`: **\n  Change the collector mode to generational.\n  This option can be followed by two numbers:\n  the garbage-collector minor multiplier\n  and the major multiplier\n  A zero means to not change that value.\n\nThis function should not be called by a finalizer."}}, coroutine = {binding = "coroutine", fields = {close = {binding = "coroutine.close", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"co"}, ["fnl/docstring"] = "Closes coroutine `co`,\nthat is,\ncloses all its pending to-be-closed variables\nand puts the coroutine in a dead state.\nThe given coroutine must be dead or suspended.\nIn case of error\n(either the original error that stopped the coroutine or\nerrors in closing methods),\nreturns **false** plus the error object;\notherwise returns **true**."}}, create = {binding = "coroutine.create", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f"}, ["fnl/docstring"] = "Creates a new coroutine, with body `f`.\n`f` must be a function.\nReturns this new coroutine,\nan object with type `\"thread\"`."}}, isyieldable = {binding = "coroutine.isyieldable", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?co"}, ["fnl/docstring"] = "Returns **true** when the coroutine `?co` can yield.\nThe default for `?co` is the running coroutine.\n\nA coroutine is yieldable if it is not the main thread and\nit is not inside a non-yieldable C function."}}, resume = {binding = "coroutine.resume", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"co", "?val1", "..."}, ["fnl/docstring"] = "Starts or continues the execution of coroutine `co`.\nThe first time you resume a coroutine,\nit starts running its body.\nThe values `?val1`, ... are passed\nas the arguments to the body function.\nIf the coroutine has yielded,\n`resume` restarts it;\nthe values `?val1`, ... are passed\nas the results from the yield.\n\nIf the coroutine runs without any errors,\n`resume` returns **true** plus any values passed to `yield`\n(when the coroutine yields) or any values returned by the body function\n(when the coroutine terminates).\nIf there is any error,\n`resume` returns **false** plus the error message."}}, running = {binding = "coroutine.running", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {}, ["fnl/docstring"] = "Returns the running coroutine plus a boolean,\n**true** when the running coroutine is the main one."}}, status = {binding = "coroutine.status", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"co"}, ["fnl/docstring"] = "Returns the status of the coroutine `co`, as a string:\n`\"running\"`,\nif the coroutine is running\n(that is, it is the one that called `status`);\n`\"suspended\"`, if the coroutine is suspended in a call to `yield`,\nor if it has not started running yet;\n`\"normal\"` if the coroutine is active but not running\n(that is, it has resumed another coroutine);\nand `\"dead\"` if the coroutine has finished its body function,\nor if it has stopped with an error."}}, wrap = {binding = "coroutine.wrap", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f"}, ["fnl/docstring"] = "Creates a new coroutine, with body `f`;\n`f` must be a function.\nReturns a function that resumes the coroutine each time it is called.\nAny arguments passed to this function behave as the\nextra arguments to `resume`.\nThe function returns the same values returned by `resume`,\nexcept the first boolean.\nIn case of error,\nthe function closes the coroutine and propagates the error."}}, yield = {binding = "coroutine.yield", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"..."}, ["fnl/docstring"] = "Suspends the execution of the calling coroutine.\nAny arguments to `yield` are passed as extra results to `resume`."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "This library comprises the operations to manipulate coroutines,\nwhich come inside the table `coroutine`."}}, debug = {binding = "debug", fields = {debug = {binding = "debug.debug", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {}, ["fnl/docstring"] = "Enters an interactive mode with the user,\nrunning each string that the user enters.\nUsing simple commands and other debug facilities,\nthe user can inspect global and local variables,\nchange their values, evaluate expressions, and so on.\nA line containing only the word `cont` finishes this function,\nso that the caller continues its execution.\n\nNote that commands for `debug.debug` are not lexically nested\nwithin any function and so have no direct access to local variables."}}, gethook = {binding = "debug.gethook", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?thread"}, ["fnl/docstring"] = "Returns the current hook settings of the thread, as three values:\nthe current hook function, the current hook mask,\nand the current hook count,\nas set by the `debug.sethook` function.\n\nReturns **fail** if there is no active hook."}}, getinfo = {binding = "debug.getinfo", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f", "?what"}, ["fnl/docstring"] = "Returns a table with information about a function.\nYou can give the function directly\nor you can give a number as the value of `f`,\nwhich means the function running at level `f` of the call stack\nof the given thread:\nlevel 0 is the current function (`getinfo` itself);\nlevel 1 is the function that called `getinfo`\n(except for tail calls, which do not count in the stack);\nand so on.\nIf `f` is a number greater than the number of active functions,\nthen `getinfo` returns **fail**.\n\nThe returned table can contain all the fields returned by `lua_getinfo`,\nwith the string `?what` describing which fields to fill in.\nThe default for `?what` is to get all information available,\nexcept the table of valid lines.\nThe option `\"f\"`\nadds a field named `func` with the function itself.\nThe option `\"L\"` adds a field named `activelines`\nwith the table of valid lines,\nprovided the function is a Lua function.\nIf the function has no debug information,\nthe table is empty.\n\nFor instance, the expression `debug.getinfo(1,\"n\").name` returns\na name for the current function,\nif a reasonable name can be found,\nand the expression `debug.getinfo(print)`\nreturns a table with all available information\nabout the `print` function."}}, getlocal = {binding = "debug.getlocal", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f", "local"}, ["fnl/docstring"] = "This function returns the name and the value of the local variable\nwith index `local` of the function at level `f` of the stack.\nThis function accesses not only explicit local variables,\nbut also parameters and temporary values.\n\nThe first parameter or local variable has index 1, and so on,\nfollowing the order that they are declared in the code,\ncounting only the variables that are active\nin the current scope of the function.\nCompile-time constants may not appear in this listing,\nif they were optimized away by the compiler.\nNegative indices refer to vararg arguments;\n-1 is the first vararg argument.\nThe function returns **fail**\nif there is no variable with the given index,\nand raises an error when called with a level out of range.\n(You can call `debug.getinfo` to check whether the level is valid.)\n\nVariable names starting with `\"(\"` (open parenthesis) \nrepresent variables with no known names\n(internal variables such as loop control variables,\nand variables from chunks saved without debug information).\n\nThe parameter `f` may also be a function.\nIn that case, `getlocal` returns only the name of function parameters."}}, getmetatable = {binding = "debug.getmetatable", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"value"}, ["fnl/docstring"] = "Returns the metatable of the given `value`\nor **nil** if it does not have a metatable."}}, getregistry = {binding = "debug.getregistry", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {}, ["fnl/docstring"] = "Returns the registry table"}}, getupvalue = {binding = "debug.getupvalue", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f", "up"}, ["fnl/docstring"] = "This function returns the name and the value of the upvalue\nwith index `up` of the function `f`.\nThe function returns **fail**\nif there is no upvalue with the given index.\n\n(For Lua functions,\nupvalues are the external local variables that the function uses,\nand that are consequently included in its closure.)\n\nFor C functions, this function uses the empty string `\"\"`\nas a name for all upvalues.\n\nVariable name `\"?\"` (interrogation mark)\nrepresents variables with no known names\n(variables from chunks saved without debug information)."}}, getuservalue = {binding = "debug.getuservalue", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"u", "n"}, ["fnl/docstring"] = "Returns the `n`-th user value associated\nto the userdata `u` plus a boolean,\n**false** if the userdata does not have that value."}}, sethook = {binding = "debug.sethook", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"hook", "mask", "?count"}, ["fnl/docstring"] = "Sets the given function as the debug hook.\nThe string `mask` and the number `?count` describe\nwhen the hook will be called.\nThe string mask may have any combination of the following characters,\nwith the given meaning:\n\n* **`\"c\"`: ** the hook is called every time Lua calls a function;\n* **`\"r\"`: ** the hook is called every time Lua returns from a function;\n* **`\"l\"`: ** the hook is called every time Lua enters a new line of code.\n\nMoreover,\nwith a `?count` different from zero,\nthe hook is called also after every `?count` instructions.\n\nWhen called without arguments,\n`debug.sethook` turns off the hook.\n\nWhen the hook is called, its first parameter is a string\ndescribing the event that has triggered its call:\n`\"call\"`, `\"tail call\"`, `\"return\"`,\n`\"line\"`, and `\"count\"`.\nFor line events,\nthe hook also gets the new line number as its second parameter.\nInside a hook,\nyou can call `getinfo` with level 2 to get more information about\nthe running function.\n(Level 0 is the `getinfo` function,\nand level 1 is the hook function.)"}}, setlocal = {binding = "debug.setlocal", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"level", "local", "value"}, ["fnl/docstring"] = "This function assigns the value `value` to the local variable\nwith index `local` of the function at level `level` of the stack.\nThe function returns **fail** if there is no local\nvariable with the given index,\nand raises an error when called with a `level` out of range.\n(You can call `getinfo` to check whether the level is valid.)\nOtherwise, it returns the name of the local variable.\n\nSee `debug.getlocal` for more information about\nvariable indices and names."}}, setmetatable = {binding = "debug.setmetatable", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"value", "table"}, ["fnl/docstring"] = "Sets the metatable for the given `value` to the given `table`\n(which can be **nil**).\nReturns `value`."}}, setupvalue = {binding = "debug.setupvalue", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f", "up", "value"}, ["fnl/docstring"] = "This function assigns the value `value` to the upvalue\nwith index `up` of the function `f`.\nThe function returns **fail** if there is no upvalue\nwith the given index.\nOtherwise, it returns the name of the upvalue.\n\nSee `debug.getupvalue` for more information about upvalues."}}, setuservalue = {binding = "debug.setuservalue", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"udata", "value", "n"}, ["fnl/docstring"] = "Sets the given `value` as\nthe `n`-th user value associated to the given `udata`.\n`udata` must be a full userdata.\n\nReturns `udata`,\nor **fail** if the userdata does not have that value."}}, traceback = {binding = "debug.traceback", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?message", "?level"}, ["fnl/docstring"] = "If `?message` is present but is neither a string nor **nil**,\nthis function returns `?message` without further processing.\nOtherwise,\nit returns a string with a traceback of the call stack.\nThe optional `?message` string is appended\nat the beginning of the traceback.\nAn optional `?level` number tells at which level\nto start the traceback\n(default is 1, the function calling `traceback`)."}}, upvalueid = {binding = "debug.upvalueid", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f", "n"}, ["fnl/docstring"] = "Returns a unique identifier (as a light userdata)\nfor the upvalue numbered `n`\nfrom the given function.\n\nThese unique identifiers allow a program to check whether different\nclosures share upvalues.\nLua closures that share an upvalue\n(that is, that access a same external local variable)\nwill return identical ids for those upvalue indices."}}, upvaluejoin = {binding = "debug.upvaluejoin", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f1", "n1", "f2", "n2"}, ["fnl/docstring"] = "Make the `n1`-th upvalue of the Lua closure `f1`\nrefer to the `n2`-th upvalue of the Lua closure `f2`."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "This library provides\nthe functionality of the debug interfaceto Lua programs.\nYou should exert care when using this library.\nSeveral of its functions\nviolate basic assumptions about Lua code\n(e.g., that variables local to a function\ncannot be accessed from outside;\nthat userdata metatables cannot be changed by Lua code;\nthat Lua programs do not crash)\nand therefore can compromise otherwise secure code.\nMoreover, some functions in this library may be slow.\n\nAll functions in this library are provided\ninside the `debug` table.\nAll functions that operate over a thread\nhave an optional first argument which is the\nthread to operate over.\nThe default is always the current thread."}}, dofile = {binding = "dofile", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?filename"}, ["fnl/docstring"] = "Opens the named file and executes its content as a Lua chunk.\nWhen called without arguments,\n`dofile` executes the content of the standard input (`stdin`).\nReturns all values returned by the chunk.\nIn case of errors, `dofile` propagates the error\nto its caller.\n(That is, `dofile` does not run in protected mode.)"}}, error = {binding = "error", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"message", "?level"}, ["fnl/docstring"] = "Raises an errorwith `message` as the error object.\nThis function never returns.\n\nUsually, `error` adds some information about the error position\nat the beginning of the message, if the message is a string.\nThe `?level` argument specifies how to get the error position.\nWith level 1 (the default), the error position is where the\n`error` function was called.\nLevel 2 points the error to where the function\nthat called `error` was called; and so on.\nPassing a level 0 avoids the addition of error position information\nto the message."}}, getmetatable = {binding = "getmetatable", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"object"}, ["fnl/docstring"] = "If `object` does not have a metatable, returns **nil**.\nOtherwise,\nif the object's metatable has a `__metatable` field,\nreturns the associated value.\nOtherwise, returns the metatable of the given object."}}, io = {binding = "io", fields = {close = {binding = "io.close", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?file"}, ["fnl/docstring"] = "Equivalent to `file:close()`.\nWithout a `?file`, closes the default output file."}}, flush = {binding = "io.flush", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {}, ["fnl/docstring"] = "Equivalent to `io.output():flush()`."}}, input = {binding = "io.input", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?file"}, ["fnl/docstring"] = "When called with a file name, it opens the named file (in text mode),\nand sets its handle as the default input file.\nWhen called with a file handle,\nit simply sets this file handle as the default input file.\nWhen called without arguments,\nit returns the current default input file.\n\nIn case of errors this function raises the error,\ninstead of returning an error code."}}, lines = {binding = "io.lines", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?filename", "..."}, ["fnl/docstring"] = "Opens the given file name in read mode\nand returns an iterator function that\nworks like `file:lines(...)` over the opened file.\nWhen the iterator function fails to read any value,\nit automatically closes the file.\nBesides the iterator function,\n`io.lines` returns three other values:\ntwo **nil** values as placeholders,\nplus the created file handle.\nTherefore, when used in a generic **for** loop,\nthe file is closed also if the loop is interrupted by an\nerror or a **break**.\n\nThe call `io.lines()` (with no file name) is equivalent\nto `io.input():lines(\"l\")`;\nthat is, it iterates over the lines of the default input file.\nIn this case, the iterator does not close the file when the loop ends.\n\nIn case of errors opening the file,\nthis function raises the error,\ninstead of returning an error code."}}, open = {binding = "io.open", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"filename", "?mode"}, ["fnl/docstring"] = "This function opens a file,\nin the mode specified in the string `?mode`.\nIn case of success,\nit returns a new file handle.\n\nThe `?mode` string can be any of the following:\n\n* **`\"r\"`: ** read mode (the default);\n* **`\"w\"`: ** write mode;\n* **`\"a\"`: ** append mode;\n* **`\"r+\"`: ** update mode, all previous data is preserved;\n* **`\"w+\"`: ** update mode, all previous data is erased;\n* **`\"a+\"`: ** append update mode, previous data is preserved,\n    writing is only allowed at the end of file.\n\nThe `?mode` string can also have a `\"b\"` at the end,\nwhich is needed in some systems to open the file in binary mode."}}, output = {binding = "io.output", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?file"}, ["fnl/docstring"] = "Similar to `io.input`, but operates over the default output file."}}, popen = {binding = "io.popen", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"prog", "?mode"}, ["fnl/docstring"] = "This function is system dependent and is not available\non all platforms.\n\nStarts the program `prog` in a separated process and returns\na file handle that you can use to read data from this program\n(if `?mode` is `\"r\"`, the default)\nor to write data to this program\n(if `?mode` is `\"w\"`)."}}, read = {binding = "io.read", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"..."}, ["fnl/docstring"] = "Equivalent to `io.input():read(...)`."}}, stderr = {binding = "io.stderr", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "stderr file"}}, stdin = {binding = "io.stdin", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "stdin file"}}, stdout = {binding = "io.stdout", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "stdout file"}}, tmpfile = {binding = "io.tmpfile", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {}, ["fnl/docstring"] = "In case of success,\nreturns a handle for a temporary file.\nThis file is opened in update mode\nand it is automatically removed when the program ends."}}, type = {binding = "io.type", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"obj"}, ["fnl/docstring"] = "Checks whether `obj` is a valid file handle.\nReturns the string `\"file\"` if `obj` is an open file handle,\n`\"closed file\"` if `obj` is a closed file handle,\nor **fail** if `obj` is not a file handle."}}, write = {binding = "io.write", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"..."}, ["fnl/docstring"] = "Equivalent to `io.output():write(...)`."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "The I/O library provides two different styles for file manipulation.\nThe first one uses implicit file handles;\nthat is, there are operations to set a default input file and a\ndefault output file,\nand all input/output operations are done over these default files.\nThe second style uses explicit file handles.\n\nWhen using implicit file handles,\nall operations are supplied by table `io`.\nWhen using explicit file handles,\nthe operation `io.open` returns a file handle\nand then all operations are supplied as methods of the file handle.\n\nThe metatable for file handles provides metamethods\nfor `__gc` and `__close` that try\nto close the file when called.\n\nThe table `io` also provides\nthree predefined file handles with their usual meanings from C:\n`io.stdin`, `io.stdout`, and `io.stderr`.\nThe I/O library never closes these files.\n\nUnless otherwise stated,\nall I/O functions return **fail** on failure,\nplus an error message as a second result and\na system-dependent error code as a third result,\nand some non-false value on success.\nOn non-POSIX systems,\nthe computation of the error message and error code\nin case of errors\nmay be not thread safe,\nbecause they rely on the global C variable `errno`."}}, ipairs = {binding = "ipairs", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"t"}, ["fnl/docstring"] = "Returns three values (an iterator function, the table `t`, and 0)\nso that the construction\n\n```lua\n     for i,v in ipairs(t) do *body* end\n```\nwill iterate over the key\226\128\147value pairs\n(`1,t[1]`), (`2,t[2]`), ...,\nup to the first absent index."}}, load = {binding = "load", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"chunk", "?chunkname", "?mode", "?env"}, ["fnl/docstring"] = "Loads a chunk.\n\nIf `chunk` is a string, the chunk is this string.\nIf `chunk` is a function,\n`load` calls it repeatedly to get the chunk pieces.\nEach call to `chunk` must return a string that concatenates\nwith previous results.\nA return of an empty string, **nil**, or no value signals the end of the chunk.\n\nIf there are no syntactic errors,\n`load` returns the compiled chunk as a function;\notherwise, it returns **fail** plus the error message.\n\nWhen you load a main chunk,\nthe resulting function will always have exactly one upvalue,\nthe `_ENV` variable\nHowever,\nwhen you load a binary chunk created from a function (see `string.dump`),\nthe resulting function can have an arbitrary number of upvalues,\nand there is no guarantee that its first upvalue will be\nthe `_ENV` variable.\n(A non-main function may not even have an `_ENV` upvalue.)\n\nRegardless, if the resulting function has any upvalues,\nits first upvalue is set to the value of `?env`,\nif that parameter is given,\nor to the value of the global environment.\nOther upvalues are initialized with **nil**.\nAll upvalues are fresh, that is,\nthey are not shared with any other function.\n\n`?chunkname` is used as the name of the chunk for error messages\nand debug information\nWhen absent,\nit defaults to `chunk`, if `chunk` is a string,\nor to `\"=(load)\"` otherwise.\n\nThe string `?mode` controls whether the chunk can be text or binary\n(that is, a precompiled chunk).\nIt may be the string `\"b\"` (only binary chunks),\n`\"t\"` (only text chunks),\nor `\"bt\"` (both binary and text).\nThe default is `\"bt\"`.\n\nIt is safe to load malformed binary chunks;\n`load` signals an appropriate error.\nHowever,\nLua does not check the consistency of the code inside binary chunks;\nrunning maliciously crafted bytecode can crash the interpreter."}}, loadfile = {binding = "loadfile", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?filename", "?mode", "?env"}, ["fnl/docstring"] = "Similar to `load`,\nbut gets the chunk from file `?filename`\nor from the standard input,\nif no file name is given."}}, math = {binding = "math", fields = {abs = {binding = "math.abs", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the maximum value between `x` and `-x`. (integer/float)"}}, acos = {binding = "math.acos", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the arc cosine of `x` (in radians)."}}, asin = {binding = "math.asin", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the arc sine of `x` (in radians)."}}, atan = {binding = "math.atan", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"y", "?x"}, ["fnl/docstring"] = "Returns the arc tangent of `y/x` (in radians),\nusing the signs of both arguments to find the\nquadrant of the result.\nIt also handles correctly the case of `?x` being zero.\n\nThe default value for `?x` is 1,\nso that the call `math.atan(y)`\nreturns the arc tangent of `y`."}}, ceil = {binding = "math.ceil", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the smallest integral value greater than or equal to `x`."}}, cos = {binding = "math.cos", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the cosine of `x` (assumed to be in radians)."}}, deg = {binding = "math.deg", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Converts the angle `x` from radians to degrees."}}, exp = {binding = "math.exp", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the value *e\203\163*\n(where `e` is the base of natural logarithms)."}}, floor = {binding = "math.floor", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the largest integral value less than or equal to `x`."}}, fmod = {binding = "math.fmod", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x", "y"}, ["fnl/docstring"] = "Returns the remainder of the division of `x` by `y`\nthat rounds the quotient towards zero. (integer/float)"}}, huge = {binding = "math.huge", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "The float value `HUGE_VAL`,\na value greater than any other numeric value."}}, log = {binding = "math.log", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x", "?base"}, ["fnl/docstring"] = "Returns the logarithm of `x` in the given base.\nThe default for `?base` is *e*\n(so that the function returns the natural logarithm of `x`)."}}, max = {binding = "math.max", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x", "..."}, ["fnl/docstring"] = "Returns the argument with the maximum value,\naccording to the Lua operator `<`."}}, maxinteger = {binding = "math.maxinteger", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "An integer with the maximum value for an integer."}}, min = {binding = "math.min", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x", "..."}, ["fnl/docstring"] = "Returns the argument with the minimum value,\naccording to the Lua operator `<`."}}, mininteger = {binding = "math.mininteger", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "An integer with the minimum value for an integer."}}, modf = {binding = "math.modf", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the integral part of `x` and the fractional part of `x`.\nIts second result is always a float."}}, pi = {binding = "math.pi", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "The value of *\207\128*."}}, rad = {binding = "math.rad", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Converts the angle `x` from degrees to radians."}}, random = {binding = "math.random", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?m", "?n"}, ["fnl/docstring"] = "When called without arguments,\nreturns a pseudo-random float with uniform distribution\nin the range  *[0,1)*.  \nWhen called with two integers `?m` and `?n`,\n`math.random` returns a pseudo-random integer\nwith uniform distribution in the range *[m, n]*.\nThe call `math.random(n)`, for a positive `?n`,\nis equivalent to `math.random(1,n)`.\nThe call `math.random(0)` produces an integer with\nall bits (pseudo)random.\n\nThis function uses the `xoshiro256**` algorithm to produce\npseudo-random 64-bit integers,\nwhich are the results of calls with argument 0.\nOther results (ranges and floats)\nare unbiased extracted from these integers.\n\nLua initializes its pseudo-random generator with the equivalent of\na call to `math.randomseed` with no arguments,\nso that `math.random` should generate\ndifferent sequences of results each time the program runs."}}, randomseed = {binding = "math.randomseed", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?x", "?y"}, ["fnl/docstring"] = "When called with at least one argument,\nthe integer parameters `?x` and `?y` are\njoined into a 128-bit *seed* that\nis used to reinitialize the pseudo-random generator;\nequal seeds produce equal sequences of numbers.\nThe default for `?y` is zero.\n\nWhen called with no arguments,\nLua generates a seed with\na weak attempt for randomness.\n\nThis function returns the two seed components\nthat were effectively used,\nso that setting them again repeats the sequence.\n\nTo ensure a required level of randomness to the initial state\n(or contrarily, to have a deterministic sequence,\nfor instance when debugging a program),\nyou should call `math.randomseed` with explicit arguments."}}, sin = {binding = "math.sin", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the sine of `x` (assumed to be in radians)."}}, sqrt = {binding = "math.sqrt", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the square root of `x`.\n(You can also use the expression `x^0.5` to compute this value.)"}}, tan = {binding = "math.tan", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the tangent of `x` (assumed to be in radians)."}}, tointeger = {binding = "math.tointeger", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "If the value `x` is convertible to an integer,\nreturns that integer.\nOtherwise, returns **fail**."}}, type = {binding = "math.type", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns `\"integer\"` if `x` is an integer,\n`\"float\"` if it is a float,\nor **fail** if `x` is not a number."}}, ult = {binding = "math.ult", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"m", "n"}, ["fnl/docstring"] = "Returns a boolean,\n**true** if and only if integer `m` is below integer `n` when\nthey are compared as unsigned integers."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "This library provides basic mathematical functions.\nIt provides all its functions and constants inside the table `math`.\nFunctions with the annotation `\"integer/float\"` give\ninteger results for integer arguments\nand float results for non-integer arguments.\nThe rounding functions\n`math.ceil`, `math.floor`, and `math.modf`\nreturn an integer when the result fits in the range of an integer,\nor a float otherwise."}}, next = {binding = "next", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"table", "?index"}, ["fnl/docstring"] = "Allows a program to traverse all fields of a table.\nIts first argument is a table and its second argument\nis an index in this table.\nA call to `next` returns the next index of the table\nand its associated value.\nWhen called with **nil** as its second argument,\n`next` returns an initial index\nand its associated value.\nWhen called with the last index,\nor with **nil** in an empty table,\n`next` returns **nil**.\nIf the second argument is absent, then it is interpreted as **nil**.\nIn particular,\nyou can use `next(t)` to check whether a table is empty.\n\nThe order in which the indices are enumerated is not specified,\n*even for numeric indices*.\n(To traverse a table in numerical order,\nuse a numerical **for**.)\n\nYou should not assign any value to a non-existent field in a table\nduring its traversal.\nYou may however modify existing fields.\nIn particular, you may set existing fields to nil."}}, os = {binding = "os", fields = {clock = {binding = "os.clock", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {}, ["fnl/docstring"] = "Returns an approximation of the amount in seconds of CPU time\nused by the program,\nas returned by the underlying ISO C function `clock`."}}, date = {binding = "os.date", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?format", "?time"}, ["fnl/docstring"] = "Returns a string or a table containing date and time,\nformatted according to the given string `?format`.\n\nIf the `?time` argument is present,\nthis is the time to be formatted\n(see the `os.time` function for a description of this value).\nOtherwise, `date` formats the current time.\n\nIf `?format` starts with `\"!\"`,\nthen the date is formatted in Coordinated Universal Time.\nAfter this optional character,\nif `?format` is the string `\"*t\"`,\nthen `date` returns a table with the following fields:\n`year`, `month` (1\226\128\14712), `day` (1\226\128\14731),\n`hour` (0\226\128\14723), `min` (0\226\128\14759),\n`sec` (0\226\128\14761, due to leap seconds),\n`wday` (weekday, 1\226\128\1477, Sunday is 1),\n`yday` (day of the year, 1\226\128\147366),\nand `isdst` (daylight saving flag, a boolean).\nThis last field may be absent\nif the information is not available.\n\nIf `?format` is not `\"*t\"`,\nthen `date` returns the date as a string,\nformatted according to the same rules as the ISO C function `strftime`.\n\nIf `?format` is absent, it defaults to `\"%c\"`,\nwhich gives a human-readable date and time representation\nusing the current locale.\n\nOn non-POSIX systems,\nthis function may be not thread safe\nbecause of its reliance on C function `gmtime` and C function `localtime`."}}, difftime = {binding = "os.difftime", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"t2", "t1"}, ["fnl/docstring"] = "Returns the difference, in seconds,\nfrom time `t1` to time `t2`\n(where the times are values returned by `os.time`).\nIn POSIX, Windows, and some other systems,\nthis value is exactly `t2`*-*`t1`."}}, execute = {binding = "os.execute", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?command"}, ["fnl/docstring"] = "This function is equivalent to the ISO C function `system`.\nIt passes `?command` to be executed by an operating system shell.\nIts first result is **true**\nif the command terminated successfully,\nor **fail** otherwise.\nAfter this first result\nthe function returns a string plus a number,\nas follows:\n\n* **`\"exit\"`: **\n  the command terminated normally;\n  the following number is the exit status of the command.\n\n* **`\"signal\"`: **\n  the command was terminated by a signal;\n  the following number is the signal that terminated the command.\n\nWhen called without a `?command`,\n`os.execute` returns a boolean that is true if a shell is available."}}, exit = {binding = "os.exit", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?code", "?close"}, ["fnl/docstring"] = "Calls the ISO C function `exit` to terminate the host program.\nIf `?code` is **true**,\nthe returned status is `EXIT_SUCCESS`;\nif `?code` is **false**,\nthe returned status is `EXIT_FAILURE`;\nif `?code` is a number,\nthe returned status is this number.\nThe default value for `?code` is **true**.\n\nIf the optional second argument `?close` is true,\nthe function closes the Lua state before exiting (see `lua_close`)."}}, getenv = {binding = "os.getenv", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"varname"}, ["fnl/docstring"] = "Returns the value of the process environment variable `varname`\nor **fail** if the variable is not defined."}}, remove = {binding = "os.remove", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"filename"}, ["fnl/docstring"] = "Deletes the file (or empty directory, on POSIX systems)\nwith the given name.\nIf this function fails, it returns **fail**\nplus a string describing the error and the error code.\nOtherwise, it returns true."}}, rename = {binding = "os.rename", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"oldname", "newname"}, ["fnl/docstring"] = "Renames the file or directory named `oldname` to `newname`.\nIf this function fails, it returns **fail**,\nplus a string describing the error and the error code.\nOtherwise, it returns true."}}, setlocale = {binding = "os.setlocale", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"locale", "?category"}, ["fnl/docstring"] = "Sets the current locale of the program.\n`locale` is a system-dependent string specifying a locale;\n`?category` is an optional string describing which category to change:\n`\"all\"`, `\"collate\"`, `\"ctype\"`,\n`\"monetary\"`, `\"numeric\"`, or `\"time\"`;\nthe default category is `\"all\"`.\nThe function returns the name of the new locale,\nor **fail** if the request cannot be honored.\n\nIf `locale` is the empty string,\nthe current locale is set to an implementation-defined native locale.\nIf `locale` is the string `\"C\"`,\nthe current locale is set to the standard C locale.\n\nWhen called with **nil** as the first argument,\nthis function only returns the name of the current locale\nfor the given category.\n\nThis function may be not thread safe\nbecause of its reliance on C function `setlocale`."}}, time = {binding = "os.time", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?table"}, ["fnl/docstring"] = "Returns the current time when called without arguments,\nor a time representing the local date and time specified by the given table.\nThis table must have fields `year`, `month`, and `day`,\nand may have fields\n`hour` (default is 12),\n`min` (default is 0),\n`sec` (default is 0),\nand `isdst` (default is **nil**).\nOther fields are ignored.\nFor a description of these fields, see the `os.date` function.\n\nWhen the function is called,\nthe values in these fields do not need to be inside their valid ranges.\nFor instance, if `sec` is -10,\nit means 10 seconds before the time specified by the other fields;\nif `hour` is 1000,\nit means 1000 hours after the time specified by the other fields.\n\nThe returned value is a number, whose meaning depends on your system.\nIn POSIX, Windows, and some other systems,\nthis number counts the number\nof seconds since some given start time (the \"epoch\").\nIn other systems, the meaning is not specified,\nand the number returned by `time` can be used only as an argument to\n`os.date` and `os.difftime`.\n\nWhen called with a table,\n`os.time` also normalizes all the fields\ndocumented in the `os.date` function,\nso that they represent the same time as before the call\nbut with values inside their valid ranges."}}, tmpname = {binding = "os.tmpname", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {}, ["fnl/docstring"] = "Returns a string with a file name that can\nbe used for a temporary file.\nThe file must be explicitly opened before its use\nand explicitly removed when no longer needed.\n\nIn POSIX systems,\nthis function also creates a file with that name,\nto avoid security risks.\n(Someone else might create the file with wrong permissions\nin the time between getting the name and creating the file.)\nYou still have to open the file to use it\nand to remove it (even if you do not use it).\n\nWhen possible,\nyou may prefer to use `io.tmpfile`,\nwhich automatically removes the file when the program ends."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "This library is implemented through table `os`."}}, package = {binding = "package", fields = {config = {binding = "package.config", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "A string describing some compile-time configurations for packages.\nThis string is a sequence of lines:\n\n* The first line is the directory separator string.\n  Default is `\"\\\"` for Windows and `\"/\"` for all other systems.\n\n* The second line is the character that separates templates in a path.\n  Default is `\";\"`.\n\n* The third line is the string that marks the\n  substitution points in a template.\n  Default is `\"?\"`.\n\n* The fourth line is a string that, in a path in Windows,\n  is replaced by the executable's directory.\n  Default is `\"!\"`.\n\n* The fifth line is a mark to ignore all text after it\n  when building the `luaopen_` function name.\n  Default is `\"-\"`."}}, cpath = {binding = "package.cpath", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "A string with the path used by `require`\nto search for a C loader.\n\nLua initializes the C path `package.cpath` in the same way\nit initializes the Lua path `package.path`,\nusing the environment variable `LUA_CPATH_5_4`,\nor the environment variable `LUA_CPATH`,\nor a default path defined in `luaconf.h`."}}, loaded = {binding = "package.loaded", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "A table used by `require` to control which\nmodules are already loaded.\nWhen you require a module `modname` and\n`package.loaded[modname]` is not false,\n`require` simply returns the value stored there.\n\nThis variable is only a reference to the real table;\nassignments to this variable do not change the\ntable used by `require`.\nThe real table is stored in the C registry\nindexed by the key `LUA_LOADED_TABLE`, a string."}}, loadlib = {binding = "package.loadlib", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"libname", "funcname"}, ["fnl/docstring"] = "Dynamically links the host program with the C library `libname`.\n\nIf `funcname` is `\"*\"`,\nthen it only links with the library,\nmaking the symbols exported by the library\navailable to other dynamically linked libraries.\nOtherwise,\nit looks for a function `funcname` inside the library\nand returns this function as a C function.\nSo, `funcname` must follow the `lua_CFunction` prototype\n(see `lua_CFunction`).\n\nThis is a low-level function.\nIt completely bypasses the package and module system.\nUnlike `require`,\nit does not perform any path searching and\ndoes not automatically adds extensions.\n`libname` must be the complete file name of the C library,\nincluding if necessary a path and an extension.\n`funcname` must be the exact name exported by the C library\n(which may depend on the C compiler and linker used).\n\nThis functionality is not supported by ISO C.\nAs such, it is only available on some platforms\n(Windows, Linux, Mac OS X, Solaris, BSD,\nplus other Unix systems that support the `dlfcn` standard).\n\nThis function is inherently insecure,\nas it allows Lua to call any function in any readable dynamic\nlibrary in the system.\n(Lua calls any function assuming the function\nhas a proper prototype and respects a proper protocol\n(see `lua_CFunction`).\nTherefore,\ncalling an arbitrary function in an arbitrary dynamic library\nmore often than not results in an access violation.)"}}, path = {binding = "package.path", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "A string with the path used by `require`\nto search for a Lua loader.\n\nAt start-up, Lua initializes this variable with\nthe value of the environment variable `LUA_PATH_5_4` or\nthe environment variable `LUA_PATH` or\nwith a default path defined in `luaconf.h`,\nif those environment variables are not defined.\nA `\";;\"` in the value of the environment variable\nis replaced by the default path."}}, preload = {binding = "package.preload", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "A table to store loaders for specific modules\n(see `require`).\n\nThis variable is only a reference to the real table;\nassignments to this variable do not change the\ntable used by `require`.\nThe real table is stored in the C registry\nindexed by the key `LUA_PRELOAD_TABLE`, a string."}}, searchers = {binding = "package.searchers", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "A table used by `require` to control how to find modules.\n\nEach entry in this table is a *searcher function*.\nWhen looking for a module,\n`require` calls each of these searchers in ascending order,\nwith the module name (the argument given to `require`) as its\nsole argument.\nIf the searcher finds the module,\nit returns another function, the module *loader*,\nplus an extra value, a *loader data*,\nthat will be passed to that loader and\nreturned as a second result by `require`.\nIf it cannot find the module,\nit returns a string explaining why\n(or **nil** if it has nothing to say).\n\nLua initializes this table with four searcher functions.\n\nThe first searcher simply looks for a loader in the\n`package.preload` table.\n\nThe second searcher looks for a loader as a Lua library,\nusing the path stored at `package.path`.\nThe search is done as described in function `package.searchpath`.\n\nThe third searcher looks for a loader as a C library,\nusing the path given by the variable `package.cpath`.\nAgain,\nthe search is done as described in function `package.searchpath`.\nFor instance,\nif the C path is the string\n\n```lua\n     \"./?.so;./?.dll;/usr/local/?/init.so\"\n```\nthe searcher for module `foo`\nwill try to open the files `./foo.so`, `./foo.dll`,\nand `/usr/local/foo/init.so`, in that order.\nOnce it finds a C library,\nthis searcher first uses a dynamic link facility to link the\napplication with the library.\nThen it tries to find a C function inside the library to\nbe used as the loader.\nThe name of this C function is the string `\"luaopen_\"`\nconcatenated with a copy of the module name where each dot\nis replaced by an underscore.\nMoreover, if the module name has a hyphen,\nits suffix after (and including) the first hyphen is removed.\nFor instance, if the module name is `a.b.c-v2.1`,\nthe function name will be `luaopen_a_b_c`.\n\nThe fourth searcher tries an *all-in-one loader*.\nIt searches the C path for a library for\nthe root name of the given module.\nFor instance, when requiring `a.b.c`,\nit will search for a C library for `a`.\nIf found, it looks into it for an open function for\nthe submodule;\nin our example, that would be `luaopen_a_b_c`.\nWith this facility, a package can pack several C submodules\ninto one single library,\nwith each submodule keeping its original open function.\n\nAll searchers except the first one (preload) return as the extra value\nthe file path where the module was found,\nas returned by `package.searchpath`.\nThe first searcher always returns the string `\":preload:\"`.\n\nSearchers should raise no errors and have no side effects in Lua.\n(They may have side effects in C,\nfor instance by linking the application with a library.)"}}, searchpath = {binding = "package.searchpath", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"name", "path", "?sep", "?rep"}, ["fnl/docstring"] = "Searches for the given `name` in the given `path`.\n\nA path is a string containing a sequence of\n*templates* separated by semicolons.\nFor each template,\nthe function replaces each interrogation mark (if any)\nin the template with a copy of `name`\nwherein all occurrences of `?sep`\n(a dot, by default)\nwere replaced by `?rep`\n(the system's directory separator, by default),\nand then tries to open the resulting file name.\n\nFor instance, if the path is the string\n\n```lua\n     \"./?.lua;./?.lc;/usr/local/?/init.lua\"\n```\nthe search for the name `foo.a`\nwill try to open the files\n`./foo/a.lua`, `./foo/a.lc`, and\n`/usr/local/foo/a/init.lua`, in that order.\n\nReturns the resulting name of the first file that it can\nopen in read mode (after closing the file),\nor **fail** plus an error message if none succeeds.\n(This error message lists all file names it tried to open.)"}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "The package library provides basic\nfacilities for loading modules in Lua.\nIt exports one function directly in the global environment:\n`require`.\nEverything else is exported in the table `package`."}}, pairs = {binding = "pairs", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"t"}, ["fnl/docstring"] = "If `t` has a metamethod `__pairs`,\ncalls it with `t` as argument and returns the first three\nresults from the call.\n\nOtherwise,\nreturns three values: the `next` function, the table `t`, and **nil**,\nso that the construction\n\n```lua\n     for k,v in pairs(t) do *body* end\n```\nwill iterate over all key\226\128\147value pairs of table `t`.\n\nSee function `next` for the caveats of modifying\nthe table during its traversal."}}, pcall = {binding = "pcall", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f", "?arg1", "..."}, ["fnl/docstring"] = "Calls the function `f` with\nthe given arguments in *protected mode*.\nThis means that any error inside `f` is not propagated;\ninstead, `pcall` catches the error\nand returns a status code.\nIts first result is the status code (a boolean),\nwhich is **true** if the call succeeds without errors.\nIn such case, `pcall` also returns all results from the call,\nafter this first result.\nIn case of any error, `pcall` returns **false** plus the error object.\nNote that errors caught by `pcall` do not call a message handler."}}, print = {binding = "print", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"..."}, ["fnl/docstring"] = "Receives any number of arguments\nand prints their values to `stdout`,\nconverting each argument to a string\nfollowing the same rules of `tostring`.\n\nThe function `print` is not intended for formatted output,\nbut only as a quick way to show a value,\nfor instance for debugging.\nFor complete control over the output,\nuse `string.format` and `io.write`."}}, rawequal = {binding = "rawequal", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"v1", "v2"}, ["fnl/docstring"] = "Checks whether `v1` is equal to `v2`,\nwithout invoking the `__eq` metamethod.\nReturns a boolean."}}, rawget = {binding = "rawget", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"table", "index"}, ["fnl/docstring"] = "Gets the real value of `table[index]`,\nwithout using the `__index` metavalue.\n`table` must be a table;\n`index` may be any value."}}, rawlen = {binding = "rawlen", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"v"}, ["fnl/docstring"] = "Returns the length of the object `v`,\nwhich must be a table or a string,\nwithout invoking the `__len` metamethod.\nReturns an integer."}}, rawset = {binding = "rawset", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"table", "index", "value"}, ["fnl/docstring"] = "Sets the real value of `table[index]` to `value`,\nwithout using the `__newindex` metavalue.\n`table` must be a table,\n`index` any value different from **nil** and NaN,\nand `value` any Lua value.\n\nThis function returns `table`."}}, require = {binding = "require", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"modname"}, ["fnl/docstring"] = "Loads the given module.\nThe function starts by looking into the `package.loaded` table\nto determine whether `modname` is already loaded.\nIf it is, then `require` returns the value stored\nat `package.loaded[modname]`.\n(The absence of a second result in this case\nsignals that this call did not have to load the module.)\nOtherwise, it tries to find a *loader* for the module.\n\nTo find a loader,\n`require` is guided by the table `package.searchers`.\nEach item in this table is a search function,\nthat searches for the module in a particular way.\nBy changing this table,\nwe can change how `require` looks for a module.\nThe following explanation is based on the default configuration\nfor `package.searchers`.\n\nFirst `require` queries `package.preload[modname]`.\nIf it has a value,\nthis value (which must be a function) is the loader.\nOtherwise `require` searches for a Lua loader using the\npath stored in `package.path`.\nIf that also fails, it searches for a C loader using the\npath stored in `package.cpath`.\nIf that also fails,\nit tries an *all-in-one* loader (see `package.searchers`).\n\nOnce a loader is found,\n`require` calls the loader with two arguments:\n`modname` and an extra value,\na *loader data*,\nalso returned by the searcher.\nThe loader data can be any value useful to the module;\nfor the default searchers,\nit indicates where the loader was found.\n(For instance, if the loader came from a file,\nthis extra value is the file path.)\nIf the loader returns any non-nil value,\n`require` assigns the returned value to `package.loaded[modname]`.\nIf the loader does not return a non-nil value and\nhas not assigned any value to `package.loaded[modname]`,\nthen `require` assigns **true** to this entry.\nIn any case, `require` returns the\nfinal value of `package.loaded[modname]`.\nBesides that value, `require` also returns as a second result\nthe loader data returned by the searcher,\nwhich indicates how `require` found the module.\n\nIf there is any error loading or running the module,\nor if it cannot find any loader for the module,\nthen `require` raises an error."}}, select = {binding = "select", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"index", "..."}, ["fnl/docstring"] = "If `index` is a number,\nreturns all arguments after argument number `index`;\na negative number indexes from the end (-1 is the last argument).\nOtherwise, `index` must be the string `\"#\"`,\nand `select` returns the total number of extra arguments it received."}}, setmetatable = {binding = "setmetatable", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"table", "metatable"}, ["fnl/docstring"] = "Sets the metatable for the given table.\nIf `metatable` is **nil**,\nremoves the metatable of the given table.\nIf the original metatable has a `__metatable` field,\nraises an error.\n\nThis function returns `table`.\n\nTo change the metatable of other types from Lua code,\nyou must use the debug library"}}, string = {binding = "string", fields = {byte = {binding = "string.byte", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "?i", "?j"}, ["fnl/docstring"] = "Returns the internal numeric codes of the characters `s[i]`,\n`s[i+1]`, ..., `s[j]`.\nThe default value for `?i` is 1;\nthe default value for `?j` is `?i`.\nThese indices are corrected\nfollowing the same rules of function `string.sub`.\n\nNumeric codes are not necessarily portable across platforms."}}, char = {binding = "string.char", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"..."}, ["fnl/docstring"] = "Receives zero or more integers.\nReturns a string with length equal to the number of arguments,\nin which each character has the internal numeric code equal\nto its corresponding argument.\n\nNumeric codes are not necessarily portable across platforms."}}, dump = {binding = "string.dump", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"function", "?strip"}, ["fnl/docstring"] = "Returns a string containing a binary representation\n(a *binary chunk*)\nof the given function,\nso that a later `load` on this string returns\na copy of the function (but with new upvalues).\nIf `?strip` is a true value,\nthe binary representation may not include all debug information\nabout the function,\nto save space.\n\nFunctions with upvalues have only their number of upvalues saved.\nWhen (re)loaded,\nthose upvalues receive fresh instances.\n(See the `load` function for details about\nhow these upvalues are initialized.\nYou can use the debug library to serialize\nand reload the upvalues of a function\nin a way adequate to your needs.)"}}, find = {binding = "string.find", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "pattern", "?init", "?plain"}, ["fnl/docstring"] = "Looks for the first match of\n`pattern`in the string `s`.\nIf it finds a match, then `find` returns the indices of `s`\nwhere this occurrence starts and ends;\notherwise, it returns **fail**.\nA third, optional numeric argument `?init` specifies\nwhere to start the search;\nits default value is 1 and can be negative.\nA **true** as a fourth, optional argument `?plain`\nturns off the pattern matching facilities,\nso the function does a plain \"find substring\" operation,\nwith no characters in `pattern` being considered magic.\n\nIf the pattern has captures,\nthen in a successful match\nthe captured values are also returned,\nafter the two indices."}}, format = {binding = "string.format", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"formatstring", "..."}, ["fnl/docstring"] = "Returns a formatted version of its variable number of arguments\nfollowing the description given in its first argument,\nwhich must be a string.\nThe format string follows the same rules as the ISO C function `sprintf`.\nThe only differences are that the conversion specifiers and modifiers\n`F`, `n`, `*`, `h`, `L`, and `l` are not supported\nand that there is an extra specifier, `q`.\nBoth width and precision, when present,\nare limited to two digits.\n\nThe specifier `q` formats booleans, nil, numbers, and strings\nin a way that the result is a valid constant in Lua source code.\nBooleans and nil are written in the obvious way\n(`true`, `false`, `nil`).\nFloats are written in hexadecimal,\nto preserve full precision.\nA string is written between double quotes,\nusing escape sequences when necessary to ensure that\nit can safely be read back by the Lua interpreter.\nFor instance, the call\n\n```lua\n     string.format('%q', 'a string with \"quotes\" and \\n new line')\n```\nmay produce the string:\n\n```lua\n     \"a string with \\\"quotes\\\" and \\\n      new line\"\n```\nThis specifier does not support modifiers (flags, width, precision).\n\nThe conversion specifiers\n`A`, `a`, `E`, `e`, `f`,\n`G`, and `g` all expect a number as argument.\nThe specifiers `c`, `d`,\n`i`, `o`, `u`, `X`, and `x`\nexpect an integer.\nWhen Lua is compiled with a C89 compiler,\nthe specifiers `A` and `a` (hexadecimal floats)\ndo not support modifiers.\n\nThe specifier `s` expects a string;\nif its argument is not a string,\nit is converted to one following the same rules of `tostring`.\nIf the specifier has any modifier,\nthe corresponding string argument should not contain embedded zeros.\n\nThe specifier `p` formats the pointer\nreturned by `lua_topointer`.\nThat gives a unique string identifier for tables, userdata,\nthreads, strings, and functions.\nFor other values (numbers, nil, booleans),\nthis specifier results in a string representing\nthe pointer `NULL`."}}, gmatch = {binding = "string.gmatch", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "pattern", "?init"}, ["fnl/docstring"] = "Returns an iterator function that,\neach time it is called,\nreturns the next captures from `pattern`over the string `s`.\nIf `pattern` specifies no captures,\nthen the whole match is produced in each call.\nA third, optional numeric argument `?init` specifies\nwhere to start the search;\nits default value is 1 and can be negative.\n\nAs an example, the following loop\nwill iterate over all the words from string `s`,\nprinting one per line:\n\n```lua\n     s = \"hello world from Lua\"\n     for w in string.gmatch(s, \"%a+\") do\n       print(w)\n     end\n```\nThe next example collects all pairs `key=value` from the\ngiven string into a table:\n\n```lua\n     t = {}\n     s = \"from=world, to=Lua\"\n     for k, v in string.gmatch(s, \"(%w+)=(%w+)\") do\n       t[k] = v\n     end\n```\n\nFor this function, a caret `\"^\"` at the start of a pattern does not\nwork as an anchor, as this would prevent the iteration."}}, gsub = {binding = "string.gsub", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "pattern", "repl", "?n"}, ["fnl/docstring"] = "Returns a copy of `s`\nin which all (or the first `?n`, if given)\noccurrences of the `pattern`have been\nreplaced by a replacement string specified by `repl`,\nwhich can be a string, a table, or a function.\n`gsub` also returns, as its second value,\nthe total number of matches that occurred.\nThe name `gsub` comes from *Global SUBstitution*.\n\nIf `repl` is a string, then its value is used for replacement.\nThe character `%` works as an escape character:\nany sequence in `repl` of the form `%*d*`,\nwith *d* between 1 and 9,\nstands for the value of the *d*-th captured substring;\nthe sequence `%0` stands for the whole match;\nthe sequence `%%` stands for a single `%`.\n\nIf `repl` is a table, then the table is queried for every match,\nusing the first capture as the key.\n\nIf `repl` is a function, then this function is called every time a\nmatch occurs, with all captured substrings passed as arguments,\nin order.\n\nIn any case,\nif the pattern specifies no captures,\nthen it behaves as if the whole pattern was inside a capture.\n\nIf the value returned by the table query or by the function call\nis a string or a number,\nthen it is used as the replacement string;\notherwise, if it is **false** or **nil**,\nthen there is no replacement\n(that is, the original match is kept in the string).\n\nHere are some examples:\n\n```lua\n     x = string.gsub(\"hello world\", \"(%w+)\", \"%1 %1\")\n     --> x=\"hello hello world world\"\n     \n     x = string.gsub(\"hello world\", \"%w+\", \"%0 %0\", 1)\n     --> x=\"hello hello world\"\n     \n     x = string.gsub(\"hello world from Lua\", \"(%w+)%s*(%w+)\", \"%2 %1\")\n     --> x=\"world hello Lua from\"\n     \n     x = string.gsub(\"home = $HOME, user = $USER\", \"%$(%w+)\", os.getenv)\n     --> x=\"home = /home/roberto, user = roberto\"\n     \n     x = string.gsub(\"4+5 = $return 4+5$\", \"%$(.-)%$\", function (s)\n           return load(s)()\n         end)\n     --> x=\"4+5 = 9\"\n     \n     local t = {name=\"lua\", version=\"5.4\"}\n     x = string.gsub(\"$name-$version.tar.gz\", \"%$(%w+)\", t)\n     --> x=\"lua-5.4.tar.gz\"\n```"}}, len = {binding = "string.len", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s"}, ["fnl/docstring"] = "Receives a string and returns its length.\nThe empty string `\"\"` has length 0.\nEmbedded zeros are counted,\nso `\"a\\000bc\\000\"` has length 5."}}, lower = {binding = "string.lower", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s"}, ["fnl/docstring"] = "Receives a string and returns a copy of this string with all\nuppercase letters changed to lowercase.\nAll other characters are left unchanged.\nThe definition of what an uppercase letter is depends on the current locale."}}, match = {binding = "string.match", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "pattern", "?init"}, ["fnl/docstring"] = "Looks for the first *match* of\nthe `pattern`in the string `s`.\nIf it finds one, then `match` returns\nthe captures from the pattern;\notherwise it returns **fail**.\nIf `pattern` specifies no captures,\nthen the whole match is returned.\nA third, optional numeric argument `?init` specifies\nwhere to start the search;\nits default value is 1 and can be negative."}}, pack = {binding = "string.pack", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"fmt", "v1", "v2", "..."}, ["fnl/docstring"] = "Returns a binary string containing the values `v1`, `v2`, etc.\nserialized in binary form (packed)\naccording to the format string `fmt`"}}, packsize = {binding = "string.packsize", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"fmt"}, ["fnl/docstring"] = "Returns the length of a string resulting from `string.pack`\nwith the given format.\nThe format string cannot have the variable-length options\n`\"s\"` or `\"z\"`"}}, rep = {binding = "string.rep", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "n", "?sep"}, ["fnl/docstring"] = "Returns a string that is the concatenation of `n` copies of\nthe string `s` separated by the string `?sep`.\nThe default value for `?sep` is the empty string\n(that is, no separator).\nReturns the empty string if `n` is not positive.\n\n(Note that it is very easy to exhaust the memory of your machine\nwith a single call to this function.)"}}, reverse = {binding = "string.reverse", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s"}, ["fnl/docstring"] = "Returns a string that is the string `s` reversed."}}, sub = {binding = "string.sub", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "i", "?j"}, ["fnl/docstring"] = "Returns the substring of `s` that\nstarts at `i`  and continues until `?j`;\n`i` and `?j` can be negative.\nIf `?j` is absent, then it is assumed to be equal to -1\n(which is the same as the string length).\nIn particular,\nthe call `string.sub(s,1,j)` returns a prefix of `s`\nwith length `?j`,\nand `string.sub(s, -i)` (for a positive `i`)\nreturns a suffix of `s`\nwith length `i`.\n\nIf, after the translation of negative indices,\n`i` is less than 1,\nit is corrected to 1.\nIf `?j` is greater than the string length,\nit is corrected to that length.\nIf, after these corrections,\n`i` is greater than `?j`,\nthe function returns the empty string."}}, unpack = {binding = "string.unpack", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"fmt", "s", "?pos"}, ["fnl/docstring"] = "Returns the values packed in string `s` (see `string.pack`)\naccording to the format string `fmt`\nAn optional `?pos` marks where\nto start reading in `s` (default is 1).\nAfter the read values,\nthis function also returns the index of the first unread byte in `s`."}}, upper = {binding = "string.upper", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s"}, ["fnl/docstring"] = "Receives a string and returns a copy of this string with all\nlowercase letters changed to uppercase.\nAll other characters are left unchanged.\nThe definition of what a lowercase letter is depends on the current locale."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "This library provides generic functions for string manipulation,\nsuch as finding and extracting substrings, and pattern matching.\nWhen indexing a string in Lua, the first character is at position 1\n(not at 0, as in C).\nIndices are allowed to be negative and are interpreted as indexing backwards,\nfrom the end of the string.\nThus, the last character is at position -1, and so on.\n\nThe string library provides all its functions inside the table\n`string`.\nIt also sets a metatable for strings\nwhere the `__index` field points to the `string` table.\nTherefore, you can use the string functions in object-oriented style.\nFor instance, `string.byte(s,i)`\ncan be written as `s:byte(i)`.\n\nThe string library assumes one-byte character encodings."}}, table = {binding = "table", fields = {concat = {binding = "table.concat", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"list", "?sep", "?i", "?j"}, ["fnl/docstring"] = "Given a list where all elements are strings or numbers,\nreturns the string `list[i]..sep..list[i+1] ... sep..list[j]`.\nThe default value for `?sep` is the empty string,\nthe default for `?i` is 1,\nand the default for `?j` is `#list`.\nIf `?i` is greater than `?j`, returns the empty string."}}, insert = {binding = "table.insert", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"list", "value"}, ["fnl/docstring"] = "Inserts element `value` at position `pos` in `list`,\nshifting up the elements\n`list[pos], list[pos+1], ..., list[#list]`.\nThe default value for `pos` is `#list+1`,\nso that a call `table.insert(t,x)` inserts `x` at the end\nof the list `t`."}}, move = {binding = "table.move", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"a1", "f", "e", "t", "?a2"}, ["fnl/docstring"] = "Moves elements from the table `a1` to the table `?a2`,\nperforming the equivalent to the following\nmultiple assignment:\n`a2[t],... = a1[f],...,a1[e]`.\nThe default for `?a2` is `a1`.\nThe destination range can overlap with the source range.\nThe number of elements to be moved must fit in a Lua integer.\n\nReturns the destination table `?a2`."}}, pack = {binding = "table.pack", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"..."}, ["fnl/docstring"] = "Returns a new table with all arguments stored into keys 1, 2, etc.\nand with a field `\"n\"` with the total number of arguments.\nNote that the resulting table may not be a sequence,\nif some arguments are **nil**."}}, remove = {binding = "table.remove", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"list", "?pos"}, ["fnl/docstring"] = "Removes from `list` the element at position `?pos`,\nreturning the value of the removed element.\nWhen `?pos` is an integer between 1 and `#list`,\nit shifts down the elements\n`list[pos+1], list[pos+2], ..., list[#list]`\nand erases element `list[#list]`;\nThe index `?pos` can also be 0 when `#list` is 0,\nor `#list + 1`.\n\nThe default value for `?pos` is `#list`,\nso that a call `table.remove(l)` removes the last element\nof the list `l`."}}, sort = {binding = "table.sort", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"list", "?comp"}, ["fnl/docstring"] = "Sorts the list elements in a given order, *in-place*,\nfrom `list[1]` to `list[#list]`.\nIf `?comp` is given,\nthen it must be a function that receives two list elements\nand returns true when the first element must come\nbefore the second in the final order,\nso that, after the sort,\n`i <= j` implies `not comp(list[j],list[i])`.\nIf `?comp` is not given,\nthen the standard Lua operator `<` is used instead.\n\nThe `?comp` function must define a consistent order;\nmore formally, the function must define a strict weak order.\n(A weak order is similar to a total order,\nbut it can equate different elements for comparison purposes.)\n\nThe sort algorithm is not stable:\nDifferent elements considered equal by the given order\nmay have their relative positions changed by the sort."}}, unpack = {binding = "table.unpack", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"list", "?i", "?j"}, ["fnl/docstring"] = "Returns the elements from the given list.\nThis function is equivalent to\n\n```lua\n     return list[i], list[i+1], ..., list[j]\n```\nBy default, `?i` is 1 and `?j` is `#list`."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "This library provides generic functions for table manipulation.\nIt provides all its functions inside the table `table`.\n\nRemember that, whenever an operation needs the length of a table,\nall caveats about the length operator apply\nAll functions ignore non-numeric keys\nin the tables given as arguments."}}, tonumber = {binding = "tonumber", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"e", "?base"}, ["fnl/docstring"] = "When called with no `?base`,\n`tonumber` tries to convert its argument to a number.\nIf the argument is already a number or\na string convertible to a number,\nthen `tonumber` returns this number;\notherwise, it returns **fail**.\n\nThe conversion of strings can result in integers or floats,\naccording to the lexical conventions of Lua\nThe string may have leading and trailing spaces and a sign.\n\nWhen called with `?base`,\nthen `e` must be a string to be interpreted as\nan integer numeral in that base.\nThe base may be any integer between 2 and 36, inclusive.\nIn bases above 10, the letter `\"A\"` (in either upper or lower case)\nrepresents 10, `\"B\"` represents 11, and so forth,\nwith `\"Z\"` representing 35.\nIf the string `e` is not a valid numeral in the given base,\nthe function returns **fail**."}}, tostring = {binding = "tostring", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"v"}, ["fnl/docstring"] = "Receives a value of any type and\nconverts it to a string in a human-readable format.\n\nIf the metatable of `v` has a `__tostring` field,\nthen `tostring` calls the corresponding value\nwith `v` as argument,\nand uses the result of the call as its result.\nOtherwise, if the metatable of `v` has a `__name` field\nwith a string value,\n`tostring` may use that string in its final result.\n\nFor complete control of how numbers are converted,\nuse `string.format`."}}, type = {binding = "type", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"v"}, ["fnl/docstring"] = "Returns the type of its only argument, coded as a string.\nThe possible results of this function are\n`\"nil\"` (a string, not the value **nil**),\n`\"number\"`,\n`\"string\"`,\n`\"boolean\"`,\n`\"table\"`,\n`\"function\"`,\n`\"thread\"`,\nand `\"userdata\"`."}}, utf8 = {binding = "utf8", fields = {char = {binding = "utf8.char", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"..."}, ["fnl/docstring"] = "Receives zero or more integers,\nconverts each one to its corresponding UTF-8 byte sequence\nand returns a string with the concatenation of all these sequences."}}, charpattern = {binding = "utf8.charpattern", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "The pattern (a string, not a function) `\"[\\0-\\x7F\\xC2-\\xFD][\\x80-\\xBF]*\"`\nwhich matches exactly one UTF-8 byte sequence,\nassuming that the subject is a valid UTF-8 string."}}, codepoint = {binding = "utf8.codepoint", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "?i", "?j", "?lax"}, ["fnl/docstring"] = "Returns the code points (as integers) from all characters in `s`\nthat start between byte position `?i` and `?j` (both included).\nThe default for `?i` is 1 and for `?j` is `?i`.\nIt raises an error if it meets any invalid byte sequence."}}, codes = {binding = "utf8.codes", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "?lax"}, ["fnl/docstring"] = "Returns values so that the construction\n\n```lua\n     for p, c in utf8.codes(s) do *body* end\n```\nwill iterate over all UTF-8 characters in string `s`,\nwith `p` being the position (in bytes) and `c` the code point\nof each character.\nIt raises an error if it meets any invalid byte sequence."}}, len = {binding = "utf8.len", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "?i", "?j", "?lax"}, ["fnl/docstring"] = "Returns the number of UTF-8 characters in string `s`\nthat start between positions `?i` and `?j` (both inclusive).\nThe default for `?i` is 1 and for `?j` is -1.\nIf it finds any invalid byte sequence,\nreturns **fail** plus the position of the first invalid byte."}}, offset = {binding = "utf8.offset", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "n", "?i"}, ["fnl/docstring"] = "Returns the position (in bytes) where the encoding of the\n`n`-th character of `s`\n(counting from position `?i`) starts.\nA negative `n` gets characters before position `?i`.\nThe default for `?i` is 1 when `n` is non-negative\nand `#s + 1` otherwise,\nso that `utf8.offset(s, -n)` gets the offset of the\n`n`-th character from the end of the string.\nIf the specified character is neither in the subject\nnor right after its end,\nthe function returns **fail**.\n\nAs a special case,\nwhen `n` is 0 the function returns the start of the encoding\nof the character that contains the `?i`-th byte of `s`.\n\nThis function assumes that `s` is a valid UTF-8 string."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "This library provides basic support for UTF-8 encoding.\nIt provides all its functions inside the table `utf8`.\nThis library does not provide any support for Unicode other\nthan the handling of the encoding.\nAny operation that needs the meaning of a character,\nsuch as character classification, is outside its scope.\n\nUnless stated otherwise,\nall functions that expect a byte position as a parameter\nassume that the given position is either the start of a byte sequence\nor one plus the length of the subject string.\nAs in the string library,\nnegative indices count from the end of the string.\n\nFunctions that create byte sequences\naccept all values up to `0x7FFFFFFF`,\nas defined in the original UTF-8 specification;\nthat implies byte sequences of up to six bytes.\n\nFunctions that interpret byte sequences only accept\nvalid sequences (well formed and not overlong).\nBy default, they only accept byte sequences\nthat result in valid Unicode code points,\nrejecting values greater than `10FFFF` and surrogates.\nA boolean argument `lax`, when available,\nlifts these checks,\nso that all values up to `0x7FFFFFFF` are accepted.\n(Not well formed and overlong sequences are still rejected.)"}}, warn = {binding = "warn", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"msg1", "..."}, ["fnl/docstring"] = "Emits a warning with a message composed by the concatenation\nof all its arguments (which should be strings).\n\nBy convention,\na one-piece message starting with `\"@\"`\nis intended to be a *control message*,\nwhich is a message to the warning system itself.\nIn particular, the standard warning function in Lua\nrecognizes the control messages `\"@off\"`,\nto stop the emission of warnings,\nand `\"@on\"`, to (re)start the emission;\nit ignores unknown control messages."}}, xpcall = {binding = "xpcall", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f", "msgh", "?arg1", "..."}, ["fnl/docstring"] = "This function is similar to `pcall`,\nexcept that it sets a new message handler `msgh`."}}}
  local file_fields = {close = {binding = "file:close", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"self"}, ["fnl/docstring"] = "Closes `file`.\nNote that files are automatically closed when\ntheir handles are garbage collected,\nbut that takes an unpredictable amount of time to happen.\n\nWhen closing a file handle created with `io.popen`,\n`file:close` returns the same values\nreturned by `os.execute`."}}, flush = {binding = "file:flush", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"self"}, ["fnl/docstring"] = "Saves any written data to `file`."}}, lines = {binding = "file:lines", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"self", "..."}, ["fnl/docstring"] = "Returns an iterator function that,\neach time it is called,\nreads the file according to the given formats.\nWhen no format is given,\nuses `\"l\"` as a default.\nAs an example, the construction\n\n```lua\n     for c in file:lines(1) do *body* end\n```\nwill iterate over all characters of the file,\nstarting at the current position.\nUnlike `io.lines`, this function does not close the file\nwhen the loop ends."}}, read = {binding = "file:read", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"self", "..."}, ["fnl/docstring"] = "Reads the file `file`,\naccording to the given formats, which specify what to read.\nFor each format,\nthe function returns a string or a number with the characters read,\nor **fail** if it cannot read data with the specified format.\n(In this latter case,\nthe function does not read subsequent formats.)\nWhen called without arguments,\nit uses a default format that reads the next line\n(see below).\n\nThe available formats are\n\n* **`\"n\"`: **\n  reads a numeral and returns it as a float or an integer,\n  following the lexical conventions of Lua.\n  (The numeral may have leading whitespaces and a sign.)\n  This format always reads the longest input sequence that\n  is a valid prefix for a numeral;\n  if that prefix does not form a valid numeral\n  (e.g., an empty string, `\"0x\"`, or `\"3.4e-\"`)\n  or it is too long (more than 200 characters),\n  it is discarded and the format returns **fail**.\n\n* **`\"a\"`: **\n  reads the whole file, starting at the current position.\n  On end of file, it returns the empty string;\n  this format never fails.\n\n* **`\"l\"`: **\n  reads the next line skipping the end of line,\n  returning **fail** on end of file.\n  This is the default format.\n\n* **`\"L\"`: **\n  reads the next line keeping the end-of-line character (if present),\n  returning **fail** on end of file.\n\n* ***number*: **\n  reads a string with up to this number of bytes,\n  returning **fail** on end of file.\n  If `number` is zero,\n  it reads nothing and returns an empty string,\n  or **fail** on end of file.\n\nThe formats `\"l\"` and `\"L\"` should be used only for text files."}}, seek = {binding = "file:seek", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"self", "?whence", "?offset"}, ["fnl/docstring"] = "Sets and gets the file position,\nmeasured from the beginning of the file,\nto the position given by `?offset` plus a base\nspecified by the string `?whence`, as follows:\n\n* **`\"set\"`: ** base is position 0 (beginning of the file);\n* **`\"cur\"`: ** base is current position;\n* **`\"end\"`: ** base is end of file;\n\nIn case of success, `seek` returns the final file position,\nmeasured in bytes from the beginning of the file.\nIf `seek` fails, it returns **fail**,\nplus a string describing the error.\n\nThe default value for `?whence` is `\"cur\"`,\nand for `?offset` is 0.\nTherefore, the call `file:seek()` returns the current\nfile position, without changing it;\nthe call `file:seek(\"set\")` sets the position to the\nbeginning of the file (and returns 0);\nand the call `file:seek(\"end\")` sets the position to the\nend of the file, and returns its size."}}, setvbuf = {binding = "file:setvbuf", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"self", "mode", "?size"}, ["fnl/docstring"] = "Sets the buffering mode for a file.\nThere are three available modes:\n\n* **`\"no\"`: ** no buffering.\n* **`\"full\"`: ** full buffering.\n* **`\"line\"`: ** line buffering.\n\nFor the last two cases,\n`?size` is a hint for the size of the buffer, in bytes.\nThe default is an appropriate size.\n\nThe specific behavior of each mode is non portable;\ncheck the underlying ISO C function `setvbuf` in your platform for\nmore details."}}, write = {binding = "file:write", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"self", "..."}, ["fnl/docstring"] = "Writes the value of each of its arguments to `file`.\nThe arguments must be strings or numbers.\n\nIn case of success, this function returns `file`."}}}
  docs._G.fields = docs
  docs.io.fields.stdin.fields = file_fields
  docs.io.fields.stdout.fields = file_fields
  docs.io.fields.stderr.fields = file_fields
  return docs
end
package.preload["fennel-ls.docs.generated.lua55"] = package.preload["fennel-ls.docs.generated.lua55"] or function(...)
  local docs = {_G = {binding = "_G", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "A global variable (not a function) that\nholds the global environment\nLua itself does not use this variable;\nchanging its value does not affect any environment,\nnor vice versa."}}, _VERSION = {binding = "_VERSION", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "A global variable (not a function) that\nholds a string containing the running Lua version.\nThe current value of this variable is `\"Lua 5.5\"`."}}, arg = {binding = "arg", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "Before running any code,\n`lua` collects all command-line arguments\nin a global table called `arg`.\nThe script name goes to index 0,\nthe first argument after the script name goes to index 1,\nand so on.\nAny arguments before the script name\n(that is, the interpreter name plus its options)\ngo to negative indices.\nFor instance, in the call\n\n```lua\n     $ lua -la b.lua t1 t2\n```\nthe table is like this:\n\n```lua\n     arg = { [-2] = \"lua\", [-1] = \"-la\",\n             [0] = \"b.lua\",\n             [1] = \"t1\", [2] = \"t2\" }\n```\nIf there is no script in the call,\nthe interpreter name goes to index 0,\nfollowed by the other arguments.\nFor instance, the call\n\n```lua\n     $ lua -e \"print(arg[1])\"\n```\nwill print `\"-e\"`.\nIf there is a script,\nthe script is called with arguments\n`arg[1]`, ..., `arg[#arg]`.\nLike all chunks in Lua,\nthe script is compiled as a variadic function."}}, assert = {binding = "assert", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"v", "?message"}, ["fnl/docstring"] = "Raises an error if\nthe value of its argument `v` is false (i.e., **nil** or **false**);\notherwise, returns all its arguments.\nIn case of error,\n`?message` is the error object;\nwhen absent, it defaults to `\"assertion failed!\"`"}}, collectgarbage = {binding = "collectgarbage", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?opt", "?arg"}, ["fnl/docstring"] = "This function is a generic interface to the garbage collector.\nIt performs different functions according to its first argument, `?opt`:\n\n* **`\"collect\"`**: \n  Performs a full garbage-collection cycle.\n  This is the default option.\n\n* **`\"stop\"`**: \n  Stops automatic execution of the garbage collector.\n  The collector will run only when explicitly invoked,\n  until a call to restart it.\n\n* **`\"restart\"`**: \n  Restarts automatic execution of the garbage collector.\n\n* **`\"count\"`**: \n  Returns the total memory in use by Lua in Kbytes.\n  The value has a fractional part,\n  so that it multiplied by 1024\n  gives the exact number of bytes in use by Lua.\n\n* **`\"step\"`**: \n  Performs a garbage-collection step.\n  This option may be followed by an extra argument,\n  an integer with the step size.\n\n  If the size is a positive `n`,\n  the collector acts as if `n` new bytes have been allocated.\n  If the size is zero,\n  the collector performs a basic step.\n  In incremental mode,\n  a basic step corresponds to the current step size.\n  In generational mode,\n  a basic step performs a full minor collection or\n  an incremental step,\n  if the collector has scheduled one.\n\n  In incremental mode,\n  the function returns **true** if the step finished a collection cycle.\n  In generational mode,\n  the function returns **true** if the step finished a major collection.\n\n* **`\"isrunning\"`**: \n  Returns a boolean that tells whether the collector is running\n  (i.e., not stopped).\n\n* **`\"incremental\"`**: \n  Changes the collector mode to incremental and returns the previous mode.\n\n* **`\"generational\"`**: \n  Changes the collector mode to generational and returns the previous mode.\n\n* **`\"param\"`**: \n  Changes and/or retrieves the values of a parameter of the collector.\n  This option must be followed by one or two extra arguments:\n  The name of the parameter being changed or retrieved (a string)\n  and an optional new value for that parameter,\n  an integer in the range *[0,100000]*.\n  The first argument must have one of the following values:\n\n  * **`\"minormul\"`**:  The minor multiplier. \n  * **`\"majorminor\"`**:  The major-minor multiplier. \n  * **`\"minormajor\"`**:  The minor-major multiplier. \n  * **`\"pause\"`**:  The garbage-collector pause. \n  * **`\"stepmul\"`**:  The step multiplier. \n  * **`\"stepsize\"`**:  The step size. \n\n  The call always returns the previous value of the parameter.\n  If the call does not give a new value,\n  the value is left unchanged.\n\n  Lua stores these values in a compressed format,\n  so, the value returned as the previous value may not be\n  exactly the last value set.\n\nThis function should not be called by a finalizer."}}, coroutine = {binding = "coroutine", fields = {close = {binding = "coroutine.close", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?co"}, ["fnl/docstring"] = "Closes coroutine `?co`,\nthat is,\ncloses all its pending to-be-closed variables\nand puts the coroutine in a dead state.\nThe default for `?co` is the running coroutine.\n\nThe given coroutine must be dead, suspended,\nor be the running coroutine.\nFor the running coroutine,\nthis function does not return.\nInstead, the resume that (re)started the coroutine returns.\n\nFor other coroutines,\nin case of error\n(either the original error that stopped the coroutine or\nerrors in closing methods),\nthis function returns **false** plus the error object;\notherwise it returns **true**."}}, create = {binding = "coroutine.create", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f"}, ["fnl/docstring"] = "Creates a new coroutine, with body `f`.\n`f` must be a function.\nReturns this new coroutine,\nan object with type `\"thread\"`."}}, isyieldable = {binding = "coroutine.isyieldable", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?co"}, ["fnl/docstring"] = "Returns **true** when the coroutine `?co` can yield.\nThe default for `?co` is the running coroutine.\n\nA coroutine is yieldable if it is not the main thread and\nit is not inside a non-yieldable C function."}}, resume = {binding = "coroutine.resume", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"co", "?val1", "..."}, ["fnl/docstring"] = "Starts or continues the execution of coroutine `co`.\nThe first time you resume a coroutine,\nit starts running its body.\nThe values `?val1`, ... are passed\nas the arguments to the body function.\nIf the coroutine has yielded,\n`resume` restarts it;\nthe values `?val1`, ... are passed\nas the results from the yield.\n\nIf the coroutine runs without any errors,\n`resume` returns **true** plus any values passed to `yield`\n(when the coroutine yields) or any values returned by the body function\n(when the coroutine terminates).\nIf there is any error,\n`resume` returns **false** plus the error message."}}, running = {binding = "coroutine.running", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {}, ["fnl/docstring"] = "Returns the running coroutine plus a boolean,\n**true** when the running coroutine is the main one."}}, status = {binding = "coroutine.status", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"co"}, ["fnl/docstring"] = "Returns the status of the coroutine `co`, as a string:\n`\"running\"`,\nif the coroutine is running\n(that is, it is the one that called `status`);\n`\"suspended\"`, if the coroutine is suspended in a call to `yield`,\nor if it has not started running yet;\n`\"normal\"` if the coroutine is active but not running\n(that is, it has resumed another coroutine);\nand `\"dead\"` if the coroutine has finished its body function,\nor if it has stopped with an error."}}, wrap = {binding = "coroutine.wrap", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f"}, ["fnl/docstring"] = "Creates a new coroutine, with body `f`;\n`f` must be a function.\nReturns a function that resumes the coroutine each time it is called.\nAny arguments passed to this function behave as the\nextra arguments to `resume`.\nThe function returns the same values returned by `resume`,\nexcept the first boolean.\nIn case of error,\nthe function closes the coroutine and propagates the error."}}, yield = {binding = "coroutine.yield", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"..."}, ["fnl/docstring"] = "Suspends the execution of the calling coroutine.\nAny arguments to `yield` are passed as extra results to `resume`."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "This library comprises the operations to manipulate coroutines,\nwhich come inside the table `coroutine`."}}, debug = {binding = "debug", fields = {debug = {binding = "debug.debug", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {}, ["fnl/docstring"] = "Enters an interactive mode with the user,\nrunning each string that the user enters.\nUsing simple commands and other debug facilities,\nthe user can inspect global and local variables,\nchange their values, evaluate expressions, and so on.\nA line containing only the word `cont` finishes this function,\nso that the caller continues its execution.\n\nNote that commands for `debug.debug` are not lexically nested\nwithin any function and so have no direct access to local variables."}}, gethook = {binding = "debug.gethook", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?thread"}, ["fnl/docstring"] = "Returns the current hook settings of the thread, as three values:\nthe current hook function, the current hook mask,\nand the current hook count,\nas set by the `debug.sethook` function.\n\nReturns **fail** if there is no active hook."}}, getinfo = {binding = "debug.getinfo", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f", "?what"}, ["fnl/docstring"] = "Returns a table with information about a function.\nYou can give the function directly\nor you can give a number as the value of `f`,\nwhich means the function running at level `f` of the call stack\nof the given thread:\nlevel 0 is the current function (`getinfo` itself);\nlevel 1 is the function that called `getinfo`\n(except for tail calls, which do not count in the stack);\nand so on.\nIf `f` is a number greater than the number of active functions,\nthen `getinfo` returns **fail**.\n\nThe returned table can contain all the fields returned by `lua_getinfo`,\nwith the string `?what` describing which fields to fill in.\nThe default for `?what` is to get all information available,\nexcept the table of valid lines.\nThe option `\"f\"`\nadds a field named `func` with the function itself.\nThe option `\"L\"` adds a field named `activelines`\nwith the table of valid lines,\nprovided the function is a Lua function.\nIf the function has no debug information,\nthe table is empty.\n\nFor instance, the expression `debug.getinfo(1,\"n\").name` returns\na name for the current function,\nif a reasonable name can be found,\nand the expression `debug.getinfo(print)`\nreturns a table with all available information\nabout the `print` function."}}, getlocal = {binding = "debug.getlocal", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f", "local"}, ["fnl/docstring"] = "This function returns the name and the value of the local variable\nwith index `local` of the function at level `f` of the stack.\nThis function accesses not only explicit local variables,\nbut also parameters and temporary values.\n\nThe first parameter or local variable has index 1, and so on,\nfollowing the order that they are declared in the code,\ncounting only the variables that are active\nin the current scope of the function.\nCompile-time constants may not appear in this listing,\nif they were optimized away by the compiler.\nNegative indices refer to vararg arguments;\n-1 is the first vararg argument.\nThese negative indices are only available when the vararg table\nhas been optimized away;\notherwise, the vararg arguments are available in the vararg table.\n\nThe function returns **fail**\nif there is no variable with the given index,\nand raises an error when called with a level out of range.\n(You can call `debug.getinfo` to check whether the level is valid.)\n\nVariable names starting with `\"(\"` (open parenthesis) \nrepresent variables with no known names\n(internal variables such as loop control variables,\nand variables from chunks saved without debug information).\n\nThe parameter `f` may also be a function.\nIn that case, `getlocal` returns only the name of function parameters."}}, getmetatable = {binding = "debug.getmetatable", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"value"}, ["fnl/docstring"] = "Returns the metatable of the given `value`\nor **nil** if it does not have a metatable."}}, getregistry = {binding = "debug.getregistry", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {}, ["fnl/docstring"] = "Returns the registry table"}}, getupvalue = {binding = "debug.getupvalue", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f", "up"}, ["fnl/docstring"] = "This function returns the name and the value of the upvalue\nwith index `up` of the function `f`.\nThe function returns **fail**\nif there is no upvalue with the given index.\n\n(For Lua functions,\nupvalues are the external local variables that the function uses,\nand that are consequently included in its closure.)\n\nFor C functions, this function uses the empty string `\"\"`\nas a name for all upvalues.\n\nVariable name `\"?\"` (interrogation mark)\nrepresents variables with no known names\n(variables from chunks saved without debug information)."}}, getuservalue = {binding = "debug.getuservalue", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"u", "n"}, ["fnl/docstring"] = "Returns the `n`-th user value associated\nto the userdata `u` plus a boolean,\n**false** if the userdata does not have that value."}}, sethook = {binding = "debug.sethook", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"hook", "mask", "?count"}, ["fnl/docstring"] = "Sets the given function as the debug hook.\nThe string `mask` and the number `?count` describe\nwhen the hook will be called.\nThe string mask may have any combination of the following characters,\nwith the given meaning:\n\n* **`\"c\"`**:  the hook is called every time Lua calls a function;\n* **`\"r\"`**:  the hook is called every time Lua returns from a function;\n* **`\"l\"`**:  the hook is called every time Lua enters a new line of code.\n\nMoreover,\nwith a `?count` different from zero,\nthe hook is called also after every `?count` instructions.\n\nWhen called without arguments,\n`debug.sethook` turns off the hook.\n\nWhen the hook is called, its first parameter is a string\ndescribing the event that has triggered its call:\n`\"call\"`, `\"tail call\"`, `\"return\"`,\n`\"line\"`, and `\"count\"`.\nFor line events,\nthe hook also gets the new line number as its second parameter.\nInside a hook,\nyou can call `getinfo` with level 2 to get more information about\nthe running function.\n(Level 0 is the `getinfo` function,\nand level 1 is the hook function.)"}}, setlocal = {binding = "debug.setlocal", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"level", "local", "value"}, ["fnl/docstring"] = "This function assigns the value `value` to the local variable\nwith index `local` of the function at level `level` of the stack.\nThe function returns **fail** if there is no local\nvariable with the given index,\nand raises an error when called with a `level` out of range.\n(You can call `getinfo` to check whether the level is valid.)\nOtherwise, it returns the name of the local variable.\n\nSee `debug.getlocal` for more information about\nvariable indices and names."}}, setmetatable = {binding = "debug.setmetatable", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"value", "table"}, ["fnl/docstring"] = "Sets the metatable for the given `value` to the given `table`\n(which can be **nil**).\nReturns `value`."}}, setupvalue = {binding = "debug.setupvalue", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f", "up", "value"}, ["fnl/docstring"] = "This function assigns the value `value` to the upvalue\nwith index `up` of the function `f`.\nThe function returns **fail** if there is no upvalue\nwith the given index.\nOtherwise, it returns the name of the upvalue.\n\nSee `debug.getupvalue` for more information about upvalues."}}, setuservalue = {binding = "debug.setuservalue", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"udata", "value", "n"}, ["fnl/docstring"] = "Sets the given `value` as\nthe `n`-th user value associated to the given `udata`.\n`udata` must be a full userdata.\n\nReturns `udata`,\nor **fail** if the userdata does not have that value."}}, traceback = {binding = "debug.traceback", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?message", "?level"}, ["fnl/docstring"] = "If `?message` is present but is neither a string nor **nil**,\nthis function returns `?message` without further processing.\nOtherwise,\nit returns a string with a traceback of the call stack.\nThe optional `?message` string is appended\nat the beginning of the traceback.\nAn optional `?level` number tells at which level\nto start the traceback\n(default is 1, the function calling `traceback`)."}}, upvalueid = {binding = "debug.upvalueid", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f", "n"}, ["fnl/docstring"] = "Returns a unique identifier (as a light userdata)\nfor the upvalue numbered `n`\nfrom the given function.\n\nThese unique identifiers allow a program to check whether different\nclosures share upvalues.\nLua closures that share an upvalue\n(that is, that access a same external local variable)\nwill return identical ids for those upvalue indices."}}, upvaluejoin = {binding = "debug.upvaluejoin", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f1", "n1", "f2", "n2"}, ["fnl/docstring"] = "Make the `n1`-th upvalue of the Lua closure `f1`\nrefer to the `n2`-th upvalue of the Lua closure `f2`."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "This library provides\nthe functionality of the debug interfaceto Lua programs.\nYou should exert care when using this library.\nSeveral of its functions\nviolate basic assumptions about Lua code\n(e.g., that variables local to a function\ncannot be accessed from outside;\nthat userdata metatables cannot be changed by Lua code;\nthat Lua programs do not crash)\nand therefore can compromise otherwise secure code.\nMoreover, some functions in this library may be slow.\n\nAll functions in this library are provided\ninside the `debug` table.\nAll functions that operate over a thread\nhave an optional first argument which is the\nthread to operate over.\nThe default is always the current thread."}}, dofile = {binding = "dofile", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?filename"}, ["fnl/docstring"] = "Opens the named file and executes its content as a Lua chunk,\nreturning all values returned by the chunk.\nWhen called without arguments,\n`dofile` executes the content of the standard input (`stdin`).\nIn case of errors, `dofile` propagates the error\nto its caller.\n(That is, `dofile` does not run in protected mode.)"}}, error = {binding = "error", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"message", "?level"}, ["fnl/docstring"] = "Raises an errorwith `message` as the error object.\nThis function never returns.\n\nUsually, `error` adds some information about the error position\nat the beginning of the message, if the message is a string.\nThe `?level` argument specifies how to get the error position.\nWith level 1 (the default), the error position is where the\n`error` function was called.\nLevel 2 points the error to where the function\nthat called `error` was called; and so on.\nPassing a level 0 avoids the addition of error position information\nto the message."}}, getmetatable = {binding = "getmetatable", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"object"}, ["fnl/docstring"] = "If `object` does not have a metatable, returns **nil**.\nOtherwise,\nif the object's metatable has a `__metatable` field,\nreturns the associated value.\nOtherwise, returns the metatable of the given object."}}, io = {binding = "io", fields = {close = {binding = "io.close", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?file"}, ["fnl/docstring"] = "Equivalent to `file:close()`.\nWithout a `?file`, closes the default output file."}}, flush = {binding = "io.flush", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {}, ["fnl/docstring"] = "Equivalent to `io.output():flush()`."}}, input = {binding = "io.input", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?file"}, ["fnl/docstring"] = "When called with a file name, it opens the named file (in text mode),\nand sets its handle as the default input file.\nWhen called with a file handle,\nit simply sets this file handle as the default input file.\nWhen called without arguments,\nit returns the current default input file.\n\nIn case of errors this function raises the error,\ninstead of returning an error code."}}, lines = {binding = "io.lines", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?filename", "..."}, ["fnl/docstring"] = "Opens the given file name in read mode\nand returns an iterator function that\nworks like `file:lines(...)` over the opened file.\nWhen the iterator function fails to read any value,\nit automatically closes the file.\nBesides the iterator function,\n`io.lines` returns three other values:\ntwo **nil** values as placeholders,\nplus the created file handle.\nTherefore, when used in a generic **for** loop,\nthe file is closed also if the loop is interrupted by an\nerror or a **break**.\n\nThe call `io.lines()` (with no file name) is equivalent\nto `io.input():lines(\"l\")`;\nthat is, it iterates over the lines of the default input file.\nIn this case, the iterator does not close the file when the loop ends.\n\nIn case of errors opening the file,\nthis function raises the error,\ninstead of returning an error code."}}, open = {binding = "io.open", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"filename", "?mode"}, ["fnl/docstring"] = "This function opens a file,\nin the mode specified in the string `?mode`.\nIn case of success,\nit returns a new file handle.\n\nThe `?mode` string can be any of the following:\n\n* **`\"r\"`**:  read mode (the default);\n* **`\"w\"`**:  write mode;\n* **`\"a\"`**:  append mode;\n* **`\"r+\"`**:  update mode, all previous data is preserved;\n* **`\"w+\"`**:  update mode, all previous data is erased;\n* **`\"a+\"`**:  append update mode, previous data is preserved,\n    writing is only allowed at the end of file.\n\nThe `?mode` string can also have a `\"b\"` at the end,\nwhich is needed in some systems to open the file in binary mode."}}, output = {binding = "io.output", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?file"}, ["fnl/docstring"] = "Similar to `io.input`, but operates over the default output file."}}, popen = {binding = "io.popen", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"prog", "?mode"}, ["fnl/docstring"] = "This function is system dependent and is not available\non all platforms.\n\nStarts the program `prog` in a separated process and returns\na file handle that you can use to read data from this program\n(if `?mode` is `\"r\"`, the default)\nor to write data to this program\n(if `?mode` is `\"w\"`)."}}, read = {binding = "io.read", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"..."}, ["fnl/docstring"] = "Equivalent to `io.input():read(...)`."}}, stderr = {binding = "io.stderr", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "stderr file"}}, stdin = {binding = "io.stdin", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "stdin file"}}, stdout = {binding = "io.stdout", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "stdout file"}}, tmpfile = {binding = "io.tmpfile", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {}, ["fnl/docstring"] = "In case of success,\nreturns a handle for a temporary file.\nThis file is opened in update mode\nand it is automatically removed when the program ends."}}, type = {binding = "io.type", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"obj"}, ["fnl/docstring"] = "Checks whether `obj` is a valid file handle.\nReturns the string `\"file\"` if `obj` is an open file handle,\n`\"closed file\"` if `obj` is a closed file handle,\nor **fail** if `obj` is not a file handle."}}, write = {binding = "io.write", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"..."}, ["fnl/docstring"] = "Equivalent to `io.output():write(...)`."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "The I/O library provides two different styles for file manipulation.\nThe first one uses implicit file handles;\nthat is, there are operations to set a default input file and a\ndefault output file,\nand all input/output operations are done over these default files.\nThe second style uses explicit file handles.\n\nWhen using implicit file handles,\nall operations are supplied by table `io`.\nWhen using explicit file handles,\nthe operation `io.open` returns a file handle\nand then all operations are supplied as methods of the file handle.\n\nThe metatable for file handles provides metamethods\nfor `__gc` and `__close` that try\nto close the file when called.\n\nThe table `io` also provides\nthree predefined file handles with their usual meanings from C:\n`io.stdin`, `io.stdout`, and `io.stderr`.\nThe I/O library never closes these files.\n\nUnless otherwise stated,\nall I/O functions return **fail** on failure,\nplus an error message as a second result and\na system-dependent error code as a third result,\nand some non-false value on success.\nOn non-POSIX systems,\nthe computation of the error message and error code\nin case of errors\nmay be not thread safe,\nbecause they rely on the global C variable `errno`."}}, ipairs = {binding = "ipairs", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"t"}, ["fnl/docstring"] = "Returns three values (an iterator function, the value `t`, and 0)\nso that the construction\n\n```lua\n     for i,v in ipairs(t) do *body* end\n```\nwill iterate over the key\226\128\147value pairs\n(`1,t[1]`), (`2,t[2]`), ...,\nup to the first absent index."}}, load = {binding = "load", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"chunk", "?chunkname", "?mode", "?env"}, ["fnl/docstring"] = "Loads a chunk.\n\nIf `chunk` is a string, the chunk is this string.\nIf `chunk` is a function,\n`load` calls it repeatedly to get the chunk pieces.\nEach call to `chunk` must return a string that concatenates\nwith previous results.\nA return of an empty string, **nil**, or no value signals the end of the chunk.\n\nIf there are no syntactic errors,\n`load` returns the compiled chunk as a function;\notherwise, it returns **fail** plus the error message.\n\nWhen you load a main chunk,\nthe resulting function will always have exactly one upvalue,\nthe `_ENV` variable\nHowever,\nwhen you load a binary chunk created from a function (see `string.dump`),\nthe resulting function can have an arbitrary number of upvalues,\nand there is no guarantee that its first upvalue will be\nthe `_ENV` variable.\n(A non-main function may not even have an `_ENV` upvalue.)\n\nRegardless, if the resulting function has any upvalues,\nits first upvalue is set to the value of `?env`,\nif that parameter is given,\nor to the value of the global environment.\nOther upvalues are initialized with **nil**.\nAll upvalues are fresh, that is,\nthey are not shared with any other function.\n\n`?chunkname` is used as the name of the chunk for error messages\nand debug information\nWhen absent,\nit defaults to `chunk`, if `chunk` is a string,\nor to `\"=(load)\"` otherwise.\n\nThe string `?mode` controls whether the chunk can be text or binary\n(that is, a precompiled chunk).\nIt may be the string `\"b\"` (only binary chunks),\n`\"t\"` (only text chunks),\nor `\"bt\"` (both binary and text).\nThe default is `\"bt\"`.\n\nLua does not check the consistency of binary chunks.\nMaliciously crafted binary chunks can crash\nthe interpreter.\nYou can use the `?mode` parameter to prevent loading binary chunks."}}, loadfile = {binding = "loadfile", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?filename", "?mode", "?env"}, ["fnl/docstring"] = "Similar to `load`,\nbut gets the chunk from file `?filename`\nor from the standard input,\nif no file name is given."}}, math = {binding = "math", fields = {abs = {binding = "math.abs", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the maximum value between `x` and `-x`. (integer/float)"}}, acos = {binding = "math.acos", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the arc cosine of `x` (in radians)."}}, asin = {binding = "math.asin", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the arc sine of `x` (in radians)."}}, atan = {binding = "math.atan", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"y", "?x"}, ["fnl/docstring"] = "Returns the arc tangent of `y/x` (in radians),\nusing the signs of both arguments to find the\nquadrant of the result.\nIt also handles correctly the case of `?x` being zero.\n\nThe default value for `?x` is 1,\nso that the call `math.atan(y)`\nreturns the arc tangent of `y`."}}, ceil = {binding = "math.ceil", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the smallest integral value greater than or equal to `x`."}}, cos = {binding = "math.cos", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the cosine of `x` (assumed to be in radians)."}}, deg = {binding = "math.deg", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Converts the angle `x` from radians to degrees."}}, exp = {binding = "math.exp", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the value *e\203\163*\n(where `e` is the base of natural logarithms)."}}, floor = {binding = "math.floor", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the largest integral value less than or equal to `x`."}}, fmod = {binding = "math.fmod", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x", "y"}, ["fnl/docstring"] = "Returns the remainder of the division of `x` by `y`\nthat rounds the quotient towards zero. (integer/float)"}}, frexp = {binding = "math.frexp", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns two numbers `m` and `e` such that *x = m2\225\181\137*,\nwhere `e` is an integer.\nWhen `x` is zero, NaN, +inf, or -inf,\n`m` is equal to `x`;\notherwise, the absolute value of `m`\nis in the range  *[0.5, 1)* ."}}, huge = {binding = "math.huge", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "The float value `HUGE_VAL`,\na value greater than any other numeric value."}}, ldexp = {binding = "math.ldexp", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"m", "e"}, ["fnl/docstring"] = "Returns *m2\225\181\137*, where `e` is an integer."}}, log = {binding = "math.log", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x", "?base"}, ["fnl/docstring"] = "Returns the logarithm of `x` in the given base.\nThe default for `?base` is *e*\n(so that the function returns the natural logarithm of `x`)."}}, max = {binding = "math.max", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x", "..."}, ["fnl/docstring"] = "Returns the argument with the maximum value,\naccording to the Lua operator `<`."}}, maxinteger = {binding = "math.maxinteger", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "An integer with the maximum value for an integer."}}, min = {binding = "math.min", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x", "..."}, ["fnl/docstring"] = "Returns the argument with the minimum value,\naccording to the Lua operator `<`."}}, mininteger = {binding = "math.mininteger", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "An integer with the minimum value for an integer."}}, modf = {binding = "math.modf", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the integral part of `x` and the fractional part of `x`.\nIts second result is always a float."}}, pi = {binding = "math.pi", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "The value of *\207\128*."}}, rad = {binding = "math.rad", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Converts the angle `x` from degrees to radians."}}, random = {binding = "math.random", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?m", "?n"}, ["fnl/docstring"] = "When called without arguments,\nreturns a pseudo-random float with uniform distribution\nin the range  *[0, 1)*.  \nWhen called with two integers `?m` and `?n`,\n`math.random` returns a pseudo-random integer\nwith uniform distribution in the range *[m, n]*.\nThe call `math.random(n)`, for a positive `?n`,\nis equivalent to `math.random(1,n)`.\nThe call `math.random(0)` produces an integer with\nall bits (pseudo)random.\n\nThis function uses the `xoshiro256**` algorithm to produce\npseudo-random 64-bit integers,\nwhich are the results of calls with argument 0.\nOther results (ranges and floats)\nare unbiased extracted from these integers.\n\nLua initializes its pseudo-random generator with the equivalent of\na call to `math.randomseed` with no arguments,\nso that `math.random` should generate\ndifferent sequences of results each time the program runs."}}, randomseed = {binding = "math.randomseed", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?x", "?y"}, ["fnl/docstring"] = "When called with at least one argument,\nthe integer parameters `?x` and `?y` are\njoined into a *seed* that\nis used to reinitialize the pseudo-random generator;\nequal seeds produce equal sequences of numbers.\nThe default for `?y` is zero.\n\nWhen called with no arguments,\nLua generates a seed with\na weak attempt for randomness.\n\nThis function returns the two seed components\nthat were effectively used,\nso that setting them again repeats the sequence.\n\nTo ensure a required level of randomness to the initial state\n(or contrarily, to have a deterministic sequence,\nfor instance when debugging a program),\nyou should call `math.randomseed` with explicit arguments."}}, sin = {binding = "math.sin", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the sine of `x` (assumed to be in radians)."}}, sqrt = {binding = "math.sqrt", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the square root of `x`.\n(You can also use the expression `x^0.5` to compute this value.)"}}, tan = {binding = "math.tan", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns the tangent of `x` (assumed to be in radians)."}}, tointeger = {binding = "math.tointeger", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "If the value `x` is convertible to an integer,\nreturns that integer.\nOtherwise, returns **fail**."}}, type = {binding = "math.type", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Returns `\"integer\"` if `x` is an integer,\n`\"float\"` if it is a float,\nor **fail** if `x` is not a number."}}, ult = {binding = "math.ult", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"m", "n"}, ["fnl/docstring"] = "Returns a boolean,\n**true** if and only if integer `m` is below integer `n` when\nthey are compared as unsigned integers."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "This library provides basic mathematical functions.\nIt provides all its functions and constants inside the table `math`.\nFunctions with the annotation `\"integer/float\"` give\ninteger results for integer arguments\nand float results for non-integer arguments.\nThe rounding functions\n`math.ceil`, `math.floor`, and `math.modf`\nreturn an integer when the result fits in the range of an integer,\nor a float otherwise."}}, next = {binding = "next", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"table", "?index"}, ["fnl/docstring"] = "Allows a program to traverse all fields of a table.\nIts first argument is a table and its second argument\nis an index in this table.\nA call to `next` returns the next index of the table\nand its associated value.\nWhen called with **nil** as its second argument,\n`next` returns an initial index\nand its associated value.\nWhen called with the last index,\nor with **nil** in an empty table,\n`next` returns **nil**.\nIf the second argument is absent, then it is interpreted as **nil**.\nIn particular,\nyou can use `next(t)` to check whether a table is empty.\n\nThe order in which the indices are enumerated is not specified,\n*even for numeric indices*.\n(To traverse a table in numerical order,\nuse a numerical **for**.)\n\nYou should not assign any value to a non-existent field in a table\nduring its traversal.\nYou may however modify existing fields.\nIn particular, you may set existing fields to nil."}}, os = {binding = "os", fields = {clock = {binding = "os.clock", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {}, ["fnl/docstring"] = "Returns an approximation of the amount in seconds of CPU time\nused by the program,\nas returned by the underlying ISO C function `clock`."}}, date = {binding = "os.date", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?format", "?time"}, ["fnl/docstring"] = "Returns a string or a table containing date and time,\nformatted according to the given string `?format`.\n\nIf the `?time` argument is present,\nthis is the time to be formatted\n(see the `os.time` function for a description of this value).\nOtherwise, `date` formats the current time.\n\nIf `?format` starts with `\"!\"`,\nthen the date is formatted in Coordinated Universal Time.\nAfter this optional character,\nif `?format` is the string `\"*t\"`,\nthen `date` returns a table with the following fields:\n`year`, `month` (1\226\128\14712), `day` (1\226\128\14731),\n`hour` (0\226\128\14723), `min` (0\226\128\14759),\n`sec` (0\226\128\14761, due to leap seconds),\n`wday` (weekday, 1\226\128\1477, Sunday is 1),\n`yday` (day of the year, 1\226\128\147366),\nand `isdst` (daylight saving flag, a boolean).\nThis last field may be absent\nif the information is not available.\n\nIf `?format` is not `\"*t\"`,\nthen `date` returns the date as a string,\nformatted according to the same rules as the ISO C function `strftime`.\n\nIf `?format` is absent, it defaults to `\"%c\"`,\nwhich gives a human-readable date and time representation\nusing the current locale.\n\nOn non-POSIX systems,\nthis function may be not thread safe\nbecause of its reliance on C function `gmtime` and C function `localtime`."}}, difftime = {binding = "os.difftime", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"t2", "t1"}, ["fnl/docstring"] = "Returns the difference, in seconds,\nfrom time `t1` to time `t2`\n(where the times are values returned by `os.time`).\nIn POSIX, Windows, and some other systems,\nthis value is exactly `t2`*-*`t1`."}}, execute = {binding = "os.execute", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?command"}, ["fnl/docstring"] = "This function is equivalent to the ISO C function `system`.\nIt passes `?command` to be executed by an operating system shell.\nIts first result is **true**\nif the command terminated successfully,\nor **fail** otherwise.\nAfter this first result\nthe function returns a string plus a number,\nas follows:\n\n* **`\"exit\"`**: \n  the command terminated normally;\n  the following number is the exit status of the command.\n\n* **`\"signal\"`**: \n  the command was terminated by a signal;\n  the following number is the signal that terminated the command.\n\nWhen called without a `?command`,\n`os.execute` returns a boolean that is true if a shell is available."}}, exit = {binding = "os.exit", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?code", "?close"}, ["fnl/docstring"] = "Calls the ISO C function `exit` to terminate the host program.\nIf `?code` is **true**,\nthe returned status is `EXIT_SUCCESS`;\nif `?code` is **false**,\nthe returned status is `EXIT_FAILURE`;\nif `?code` is a number,\nthe returned status is this number.\nThe default value for `?code` is **true**.\n\nIf the optional second argument `?close` is true,\nthe function closes the Lua state before exiting (see `lua_close`)."}}, getenv = {binding = "os.getenv", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"varname"}, ["fnl/docstring"] = "Returns the value of the process environment variable `varname`\nor **fail** if the variable is not defined."}}, remove = {binding = "os.remove", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"filename"}, ["fnl/docstring"] = "Deletes the file (or empty directory, on POSIX systems)\nwith the given name.\nIf this function fails, it returns **fail**\nplus a string describing the error and the error code.\nOtherwise, it returns true."}}, rename = {binding = "os.rename", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"oldname", "newname"}, ["fnl/docstring"] = "Renames the file or directory named `oldname` to `newname`.\nIf this function fails, it returns **fail**,\nplus a string describing the error and the error code.\nOtherwise, it returns true."}}, setlocale = {binding = "os.setlocale", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"locale", "?category"}, ["fnl/docstring"] = "Sets the current locale of the program.\n`locale` is a system-dependent string specifying a locale;\n`?category` is an optional string describing which category to change:\n`\"all\"`, `\"collate\"`, `\"ctype\"`,\n`\"monetary\"`, `\"numeric\"`, or `\"time\"`;\nthe default category is `\"all\"`.\nThe function returns the name of the new locale,\nor **fail** if the request cannot be honored.\n\nIf `locale` is the empty string,\nthe current locale is set to an implementation-defined native locale.\nIf `locale` is the string `\"C\"`,\nthe current locale is set to the standard C locale.\n\nWhen called with **nil** as the first argument,\nthis function only returns the name of the current locale\nfor the given category.\n\nThis function may be not thread safe\nbecause of its reliance on C function `setlocale`."}}, time = {binding = "os.time", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"?table"}, ["fnl/docstring"] = "Returns the current local time when called without arguments,\nor a time representing the local date and time specified by the given table.\nThis table must have fields `year`, `month`, and `day`,\nand may have fields\n`hour` (default is 12),\n`min` (default is 0),\n`sec` (default is 0),\nand `isdst` (default is **nil**).\nOther fields are ignored.\nFor a description of these fields, see the `os.date` function.\n\nWhen the function is called,\nthe values in these fields do not need to be inside their valid ranges.\nFor instance, if `sec` is -10,\nit means 10 seconds before the time specified by the other fields;\nif `hour` is 1000,\nit means 1000 hours after the time specified by the other fields.\n\nThe returned value is a number, whose meaning depends on your system.\nIn POSIX, Windows, and some other systems,\nthis number counts the number\nof seconds since some given start time (the \"epoch\").\nIn other systems, the meaning is not specified,\nand the number returned by `time` can be used only as an argument to\n`os.date` and `os.difftime`.\n\nWhen called with a table,\n`os.time` also normalizes all the fields\ndocumented in the `os.date` function,\nso that they represent the same time as before the call\nbut with values inside their valid ranges."}}, tmpname = {binding = "os.tmpname", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {}, ["fnl/docstring"] = "Returns a string with a file name that can\nbe used for a temporary file.\nThe file must be explicitly opened before its use\nand explicitly removed when no longer needed.\n\nIn POSIX systems,\nthis function also creates a file with that name,\nto avoid security risks.\n(Someone else might create the file with wrong permissions\nin the time between getting the name and creating the file.)\nYou still have to open the file to use it\nand to remove it (even if you do not use it).\n\nWhen possible,\nyou may prefer to use `io.tmpfile`,\nwhich automatically removes the file when the program ends."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "This library is implemented through table `os`."}}, package = {binding = "package", fields = {config = {binding = "package.config", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "A string describing some compile-time configurations for packages.\nThis string is a sequence of lines:\n\n* The first line is the directory separator string.\n  Default is `\"\\\"` for Windows and `\"/\"` for all other systems.\n\n* The second line is the character that separates templates in a path.\n  Default is `\";\"`.\n\n* The third line is the string that marks the\n  substitution points in a template.\n  Default is `\"?\"`.\n\n* The fourth line is a string that, in a path in Windows,\n  is replaced by the executable's directory.\n  Default is `\"!\"`.\n\n* The fifth line is a mark to ignore all text after it\n  when building the `luaopen_` function name.\n  Default is `\"-\"`."}}, cpath = {binding = "package.cpath", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "A string with the path used by `require`\nto search for a C loader.\n\nLua initializes the C path `package.cpath` in the same way\nit initializes the Lua path `package.path`,\nusing the environment variable `LUA_CPATH_5_5`,\nor the environment variable `LUA_CPATH`,\nor a default path defined in `luaconf.h`."}}, loaded = {binding = "package.loaded", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "A table used by `require` to control which\nmodules are already loaded.\nWhen you require a module `modname` and\n`package.loaded[modname]` is not false,\n`require` simply returns the value stored there.\n\nThis variable is only a reference to the real table;\nassignments to this variable do not change the\ntable used by `require`.\nThe real table is stored in the C registry\nindexed by the key `LUA_LOADED_TABLE`, a string."}}, loadlib = {binding = "package.loadlib", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"libname", "funcname"}, ["fnl/docstring"] = "Dynamically links the host program with the C library `libname`.\n\nIf `funcname` is `\"*\"`,\nthen it only links with the library,\nmaking the symbols exported by the library\navailable to other dynamically linked libraries.\nOtherwise,\nit looks for a function `funcname` inside the library\nand returns this function as a C function.\nSo, `funcname` must follow the `lua_CFunction` prototype\n(see `lua_CFunction`).\n\nThis is a low-level function.\nIt completely bypasses the package and module system.\nUnlike `require`,\nit does not perform any path searching and\ndoes not automatically adds extensions.\n`libname` must be the complete file name of the C library,\nincluding if necessary a path and an extension.\n`funcname` must be the exact name exported by the C library\n(which may depend on the C compiler and linker used).\n\nThis functionality is not supported by ISO C.\nAs such, `loadlib` is only available on some platforms:\nLinux, Windows, Mac OS X, Solaris, BSD,\nplus other Unix systems that support the `dlfcn` standard.\n\nThis function is inherently insecure,\nas it allows Lua to call any function in any readable dynamic\nlibrary in the system.\n(Lua calls any function assuming the function\nhas a proper prototype and respects a proper protocol\n(see `lua_CFunction`).\nTherefore,\ncalling an arbitrary function in an arbitrary dynamic library\nmore often than not results in an access violation.)"}}, path = {binding = "package.path", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "A string with the path used by `require`\nto search for a Lua loader.\n\nAt start-up, Lua initializes this variable with\nthe value of the environment variable `LUA_PATH_5_5` or\nthe environment variable `LUA_PATH` or\nwith a default path defined in `luaconf.h`,\nif those environment variables are not defined.\nA `\";;\"` in the value of the environment variable\nis replaced by the default path."}}, preload = {binding = "package.preload", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "A table to store loaders for specific modules\n(see `require`).\n\nThis variable is only a reference to the real table;\nassignments to this variable do not change the\ntable used by `require`.\nThe real table is stored in the C registry\nindexed by the key `LUA_PRELOAD_TABLE`, a string."}}, searchers = {binding = "package.searchers", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "A table used by `require` to control how to find modules.\n\nEach entry in this table is a *searcher function*.\nWhen looking for a module,\n`require` calls each of these searchers in ascending order,\nwith the module name (the argument given to `require`) as its\nsole argument.\nIf the searcher finds the module,\nit returns another function, the module *loader*,\nplus an extra value, a *loader data*,\nthat will be passed to that loader and\nreturned as a second result by `require`.\nIf it cannot find the module,\nit returns a string explaining why\n(or **nil** if it has nothing to say).\n\nLua initializes this table with four searcher functions.\n\nThe first searcher simply looks for a loader in the\n`package.preload` table.\n\nThe second searcher looks for a loader as a Lua library,\nusing the path stored at `package.path`.\nThe search is done as described in function `package.searchpath`.\n\nThe third searcher looks for a loader as a C library,\nusing the path given by the variable `package.cpath`.\nAgain,\nthe search is done as described in function `package.searchpath`.\nFor instance,\nif the C path is the string\n\n```lua\n     \"./?.so;./?.dll;/usr/local/?/init.so\"\n```\nthe searcher for module `foo`\nwill try to open the files `./foo.so`, `./foo.dll`,\nand `/usr/local/foo/init.so`, in that order.\nOnce it finds a C library,\nthis searcher first uses a dynamic link facility to link the\napplication with the library.\nThen it tries to find a C function inside the library to\nbe used as the loader.\nThe name of this C function is the string `\"luaopen_\"`\nconcatenated with a copy of the module name where each dot\nis replaced by an underscore.\nMoreover, if the module name has a hyphen,\nits suffix after (and including) the first hyphen is removed.\nFor instance, if the module name is `a.b.c-v2.1`,\nthe function name will be `luaopen_a_b_c`.\n\nThe fourth searcher tries an *all-in-one loader*.\nIt searches the C path for a library for\nthe root name of the given module.\nFor instance, when requiring `a.b.c`,\nit will search for a C library for `a`.\nIf found, it looks into it for an open function for\nthe submodule;\nin our example, that would be `luaopen_a_b_c`.\nWith this facility, a package can pack several C submodules\ninto one single library,\nwith each submodule keeping its original open function.\n\nAll searchers except the first one (preload) return as the extra value\nthe file path where the module was found,\nas returned by `package.searchpath`.\nThe first searcher always returns the string `\":preload:\"`.\n\nSearchers should raise no errors and have no side effects in Lua.\n(They may have side effects in C,\nfor instance by linking the application with a library.)"}}, searchpath = {binding = "package.searchpath", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"name", "path", "?sep", "?rep"}, ["fnl/docstring"] = "Searches for the given `name` in the given `path`.\n\nA path is a string containing a sequence of\n*templates* separated by semicolons.\nFor each template,\nthe function replaces each interrogation mark (if any)\nin the template with a copy of `name`\nwherein all occurrences of `?sep`\n(a dot, by default)\nwere replaced by `?rep`\n(the system's directory separator, by default),\nand then tries to open the resulting file name.\n\nFor instance, if the path is the string\n\n```lua\n     \"./?.lua;./?.lc;/usr/local/?/init.lua\"\n```\nthe search for the name `foo.a`\nwill try to open the files\n`./foo/a.lua`, `./foo/a.lc`, and\n`/usr/local/foo/a/init.lua`, in that order.\n\nReturns the resulting name of the first file that it can\nopen in read mode (after closing the file),\nor **fail** plus an error message if none succeeds.\n(This error message lists all file names it tried to open.)"}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "The package library provides basic\nfacilities for loading modules in Lua.\nIt exports one function directly in the global environment:\n`require`.\nEverything else is exported in the table `package`."}}, pairs = {binding = "pairs", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"t"}, ["fnl/docstring"] = "If `t` has a metamethod `__pairs`,\ncalls it with `t` as argument and returns the first four\nresults from the call.\n\nOtherwise,\nreturns the `next` function, the table `t`, plus two **nil** values,\nso that the construction\n\n```lua\n     for k,v in pairs(t) do *body* end\n```\nwill iterate over all key\226\128\147value pairs of table `t`.\n\nSee function `next` for the caveats of modifying\nthe table during its traversal."}}, pcall = {binding = "pcall", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f", "?arg1", "..."}, ["fnl/docstring"] = "Calls the function `f` with\nthe given arguments in *protected mode*.\nThis means that any error inside `f` is not propagated;\ninstead, `pcall` catches the error\nand returns a status code.\nIts first result is the status code (a boolean),\nwhich is **true** if the call succeeds without errors.\nIn such case, `pcall` also returns all results from the call,\nafter this first result.\nIn case of any error, `pcall` returns **false** plus the error object.\nNote that errors caught by `pcall` do not call a message handler."}}, print = {binding = "print", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"..."}, ["fnl/docstring"] = "Receives any number of arguments\nand prints their values to `stdout`,\nconverting each argument to a string\nfollowing the same rules of `tostring`.\n\nThe function `print` is not intended for formatted output,\nbut only as a quick way to show a value,\nfor instance for debugging.\nFor complete control over the output,\nuse `string.format` and `io.write`."}}, rawequal = {binding = "rawequal", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"v1", "v2"}, ["fnl/docstring"] = "Checks whether `v1` is equal to `v2`,\nwithout invoking the `__eq` metamethod.\nReturns a boolean."}}, rawget = {binding = "rawget", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"table", "index"}, ["fnl/docstring"] = "Gets the real value of `table[index]`,\nwithout using the `__index` metavalue.\n`table` must be a table;\n`index` may be any value."}}, rawlen = {binding = "rawlen", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"v"}, ["fnl/docstring"] = "Returns the length of the object `v`,\nwhich must be a table or a string,\nwithout invoking the `__len` metamethod.\nReturns an integer."}}, rawset = {binding = "rawset", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"table", "index", "value"}, ["fnl/docstring"] = "Sets the real value of `table[index]` to `value`,\nwithout using the `__newindex` metavalue.\n`table` must be a table,\n`index` any value different from **nil** and NaN,\nand `value` any Lua value.\n\nThis function returns `table`."}}, require = {binding = "require", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"modname"}, ["fnl/docstring"] = "Loads the given module.\nThe function starts by looking into the `package.loaded` table\nto determine whether `modname` is already loaded.\nIf it is, then `require` returns the value stored\nat `package.loaded[modname]`.\n(The absence of a second result in this case\nsignals that this call did not have to load the module.)\nOtherwise, it tries to find a *loader* for the module.\n\nTo find a loader,\n`require` is guided by the table `package.searchers`.\nEach item in this table is a search function,\nthat searches for the module in a particular way.\nBy changing this table,\nwe can change how `require` looks for a module.\nThe following explanation is based on the default configuration\nfor `package.searchers`.\n\nFirst `require` queries `package.preload[modname]`.\nIf it has a value,\nthis value (which must be a function) is the loader.\nOtherwise `require` searches for a Lua loader using the\npath stored in `package.path`.\nIf that also fails, it searches for a C loader using the\npath stored in `package.cpath`.\nIf that also fails,\nit tries an *all-in-one* loader (see `package.searchers`).\n\nOnce a loader is found,\n`require` calls the loader with two arguments:\n`modname` and an extra value,\na *loader data*,\nalso returned by the searcher.\nThe loader data can be any value useful to the module;\nfor the default searchers,\nit indicates where the loader was found.\n(For instance, if the loader came from a file,\nthis extra value is the file path.)\nIf the loader returns any non-nil value,\n`require` assigns the returned value to `package.loaded[modname]`.\nIf the loader does not return a non-nil value and\nhas not assigned any value to `package.loaded[modname]`,\nthen `require` assigns **true** to this entry.\nIn any case, `require` returns the\nfinal value of `package.loaded[modname]`.\nBesides that value, `require` also returns as a second result\nthe loader data returned by the searcher,\nwhich indicates how `require` found the module.\n\nIf there is any error loading or running the module,\nor if it cannot find any loader for the module,\nthen `require` raises an error."}}, select = {binding = "select", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"index", "..."}, ["fnl/docstring"] = "If `index` is a number,\nreturns all arguments after argument number `index`;\na negative number indexes from the end (-1 is the last argument).\nOtherwise, `index` must be the string `\"#\"`,\nand `select` returns the total number of extra arguments it received."}}, setmetatable = {binding = "setmetatable", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"table", "metatable"}, ["fnl/docstring"] = "Sets the metatable for the given table.\nIf `metatable` is **nil**,\nremoves the metatable of the given table.\nIf the original metatable has a `__metatable` field,\nraises an error.\n\nThis function returns `table`.\n\nTo change the metatable of other types from Lua code,\nyou must use the debug library"}}, string = {binding = "string", fields = {byte = {binding = "string.byte", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "?i", "?j"}, ["fnl/docstring"] = "Returns the internal numeric codes of the characters `s[i]`,\n`s[i+1]`, ..., `s[j]`.\nThe default value for `?i` is 1;\nthe default value for `?j` is `?i`.\nThese indices are corrected\nfollowing the same rules of function `string.sub`.\n\nNumeric codes are not necessarily portable across platforms."}}, char = {binding = "string.char", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"..."}, ["fnl/docstring"] = "Receives zero or more integers.\nReturns a string with length equal to the number of arguments,\nin which each character has the internal numeric code equal\nto its corresponding argument.\n\nNumeric codes are not necessarily portable across platforms."}}, dump = {binding = "string.dump", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"function", "?strip"}, ["fnl/docstring"] = "Returns a string containing a binary representation\n(a *binary chunk*)\nof the given function,\nso that a later `load` on this string returns\na copy of the function (but with new upvalues).\nIf `?strip` is a true value,\nthe binary representation may not include all debug information\nabout the function,\nto save space.\n\nFunctions with upvalues have only their number of upvalues saved.\nWhen (re)loaded,\nthose upvalues receive fresh instances.\n(See the `load` function for details about\nhow these upvalues are initialized.\nYou can use the debug library to serialize\nand reload the upvalues of a function\nin a way adequate to your needs.)"}}, find = {binding = "string.find", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "pattern", "?init", "?plain"}, ["fnl/docstring"] = "Looks for the first match of\n`pattern`in the string `s`.\nIf it finds a match, then `find` returns the indices of `s`\nwhere this occurrence starts and ends;\notherwise, it returns **fail**.\nA third, optional numeric argument `?init` specifies\nwhere to start the search;\nits default value is 1 and can be negative.\nA **true** as a fourth, optional argument `?plain`\nturns off the pattern matching facilities,\nso the function does a plain \"find substring\" operation,\nwith no characters in `pattern` being considered magic.\n\nIf the pattern has captures,\nthen in a successful match\nthe captured values are also returned,\nafter the two indices."}}, format = {binding = "string.format", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"formatstring", "..."}, ["fnl/docstring"] = "Returns a formatted version of its variable number of arguments\nfollowing the description given in its first argument,\nwhich must be a string.\nThe format string follows the same rules as the ISO C function `sprintf`.\nThe accepted conversion specifiers are\n`A`, `a`, `c`, `d`, `E`, `e`, `f`, `G`, `g`,\n`i`, `o`, `p`, `s`, `u`, `X`, `x`, and `\"%\"`,\nplus a non-C specifier `q`.\nThe accepted flags are `\"-\"`, `\"+\"`, `\"#\"`,\n`\"0\"`, and `\" \"` (space).\nBoth width and precision, when present,\nare limited to two digits.\n\nThe specifier `q` formats booleans, nil, numbers, and strings\nin a way that the result is a valid constant in Lua source code.\nBooleans and nil are written in the obvious way\n(`true`, `false`, `nil`).\nFloats are written in hexadecimal,\nto preserve full precision.\nA string is written between double quotes,\nusing escape sequences when necessary to ensure that\nit can safely be read back by the Lua interpreter.\nFor instance, the call\n\n```lua\n     string.format('%q', 'a string with \"quotes\" and \\n new line')\n```\nmay produce the string:\n\n```lua\n     \"a string with \\\"quotes\\\" and \\\n      new line\"\n```\nThis specifier does not support modifiers (flags, width, precision).\n\nThe conversion specifiers\n`A`, `a`, `E`, `e`, `f`,\n`G`, and `g` all expect a number as argument.\nThe specifiers `c`, `d`,\n`i`, `o`, `u`, `X`, and `x`\nexpect an integer.\nWhen Lua is compiled with a C89 compiler,\nthe specifiers `A` and `a` (hexadecimal floats)\ndo not support modifiers.\n\nThe specifier `s` expects a string;\nif its argument is not a string,\nit is converted to one following the same rules of `tostring`.\nIf the specifier has any modifier,\nthe corresponding string argument should not contain embedded zeros.\n\nThe specifier `p` formats the pointer\nreturned by `lua_topointer`.\nThat gives a unique string identifier for tables, userdata,\nthreads, strings, and functions.\nFor other values (numbers, nil, booleans),\nthis specifier results in a string representing\nthe pointer `NULL`."}}, gmatch = {binding = "string.gmatch", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "pattern", "?init"}, ["fnl/docstring"] = "Returns an iterator function that,\neach time it is called,\nreturns the next captures from `pattern`over the string `s`.\nIf `pattern` specifies no captures,\nthen the whole match is produced in each call.\nA third, optional numeric argument `?init` specifies\nwhere to start the search;\nits default value is 1 and can be negative.\n\nAs an example, the following loop\nwill iterate over all the words from string `s`,\nprinting one per line:\n\n```lua\n     s = \"hello world from Lua\"\n     for w in string.gmatch(s, \"%a+\") do\n       print(w)\n     end\n```\nThe next example collects all pairs `key=value` from the\ngiven string into a table:\n\n```lua\n     t = {}\n     s = \"from=world, to=Lua\"\n     for k, v in string.gmatch(s, \"(%w+)=(%w+)\") do\n       t[k] = v\n     end\n```\n\nFor this function, a caret `\"^\"` at the start of a pattern does not\nwork as an anchor, as this would prevent the iteration."}}, gsub = {binding = "string.gsub", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "pattern", "repl", "?n"}, ["fnl/docstring"] = "Returns a copy of `s`\nin which all (or the first `?n`, if given)\noccurrences of the `pattern`have been\nreplaced by a replacement string specified by `repl`,\nwhich can be a string, a table, or a function.\n`gsub` also returns, as its second value,\nthe total number of matches that occurred.\nThe name `gsub` comes from *Global SUBstitution*.\n\nIf `repl` is a string, then its value is used for replacement.\nThe character `%` works as an escape character:\nany sequence in `repl` of the form `%*d*`,\nwith *d* between 1 and 9,\nstands for the value of the *d*-th captured substring;\nthe sequence `%0` stands for the whole match;\nthe sequence `%%` stands for a single `%`.\n\nIf `repl` is a table, then the table is queried for every match,\nusing the first capture as the key.\n\nIf `repl` is a function, then this function is called every time a\nmatch occurs, with all captured substrings passed as arguments,\nin order.\n\nIn any case,\nif the pattern specifies no captures,\nthen it behaves as if the whole pattern was inside a capture.\n\nIf the value returned by the table query or by the function call\nis a string or a number,\nthen it is used as the replacement string;\notherwise, if it is **false** or **nil**,\nthen there is no replacement\n(that is, the original match is kept in the string).\n\nHere are some examples:\n\n```lua\n     x = string.gsub(\"hello world\", \"(%w+)\", \"%1 %1\")\n     -- x=\"hello hello world world\"\n     \n     x = string.gsub(\"hello world\", \"%w+\", \"%0 %0\", 1)\n     -- x=\"hello hello world\"\n     \n     x = string.gsub(\"hello world from Lua\", \"(%w+)%s*(%w+)\", \"%2 %1\")\n     -- x=\"world hello Lua from\"\n     \n     x = string.gsub(\"home = $HOME, user = $USER\", \"%$(%w+)\", os.getenv)\n     -- x=\"home = /home/roberto, user = roberto\"\n     \n     x = string.gsub(\"4+5 = $return 4+5$\", \"%$(.-)%$\", function (s)\n           return load(s)()\n         end)\n     -- x=\"4+5 = 9\"\n     \n     local t = {name=\"lua\", version=\"5.5\"}\n     x = string.gsub(\"$name-$version.tar.gz\", \"%$(%w+)\", t)\n     -- x=\"lua-5.5.tar.gz\"\n```"}}, len = {binding = "string.len", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s"}, ["fnl/docstring"] = "Receives a string and returns its length.\nThe empty string `\"\"` has length 0.\nEmbedded zeros are counted,\nso `\"a\\000bc\\000\"` has length 5."}}, lower = {binding = "string.lower", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s"}, ["fnl/docstring"] = "Receives a string and returns a copy of this string with all\nuppercase letters changed to lowercase.\nAll other characters are left unchanged.\nThe definition of what an uppercase letter is depends on the current locale."}}, match = {binding = "string.match", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "pattern", "?init"}, ["fnl/docstring"] = "Looks for the first *match* of\nthe `pattern`in the string `s`.\nIf it finds one, then `match` returns\nthe captures from the pattern;\notherwise it returns **fail**.\nIf `pattern` specifies no captures,\nthen the whole match is returned.\nA third, optional numeric argument `?init` specifies\nwhere to start the search;\nits default value is 1 and can be negative."}}, pack = {binding = "string.pack", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"fmt", "v1", "v2", "..."}, ["fnl/docstring"] = "Returns a binary string containing the values `v1`, `v2`, etc.\nserialized in binary form (packed)\naccording to the format string `fmt`"}}, packsize = {binding = "string.packsize", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"fmt"}, ["fnl/docstring"] = "Returns the length of a string resulting from `string.pack`\nwith the given format.\nThe format string cannot have the variable-length options\n`\"s\"` or `\"z\"`"}}, rep = {binding = "string.rep", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "n", "?sep"}, ["fnl/docstring"] = "Returns a string that is the concatenation of `n` copies of\nthe string `s` separated by the string `?sep`.\nThe default value for `?sep` is the empty string\n(that is, no separator).\nReturns the empty string if `n` is not positive.\n\n(Note that it is very easy to exhaust the memory of your machine\nwith a single call to this function.)"}}, reverse = {binding = "string.reverse", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s"}, ["fnl/docstring"] = "Returns a string that is the string `s` reversed."}}, sub = {binding = "string.sub", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "i", "?j"}, ["fnl/docstring"] = "Returns the substring of `s` that\nstarts at `i`  and continues until `?j`;\n`i` and `?j` can be negative.\nIf `?j` is absent, then it is assumed to be equal to -1\n(which is the same as the string length).\nIn particular,\nthe call `string.sub(s,1,j)` returns a prefix of `s`\nwith length `?j`,\nand `string.sub(s,-i)` (for a positive `i`)\nreturns a suffix of `s`\nwith length `i`.\n\nIf, after the translation of negative indices,\n`i` is less than 1,\nit is corrected to 1.\nIf `?j` is greater than the string length,\nit is corrected to that length.\nIf, after these corrections,\n`i` is greater than `?j`,\nthe function returns the empty string."}}, unpack = {binding = "string.unpack", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"fmt", "s", "?pos"}, ["fnl/docstring"] = "Returns the values packed in string `s` (see `string.pack`)\naccording to the format string `fmt`\nAn optional `?pos` marks where\nto start reading in `s` (default is 1).\nAfter the read values,\nthis function also returns the index of the first unread byte in `s`."}}, upper = {binding = "string.upper", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s"}, ["fnl/docstring"] = "Receives a string and returns a copy of this string with all\nlowercase letters changed to uppercase.\nAll other characters are left unchanged.\nThe definition of what a lowercase letter is depends on the current locale."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "This library provides generic functions for string manipulation,\nsuch as finding and extracting substrings, and pattern matching.\nWhen indexing a string in Lua, the first character is at position 1\n(not at 0, as in C).\nIndices are allowed to be negative and are interpreted as indexing backwards,\nfrom the end of the string.\nThus, the last character is at position -1, and so on.\n\nThe string library provides all its functions inside the table\n`string`.\nIt also sets a metatable for strings\nwhere the `__index` field points to the `string` table.\nTherefore, you can use the string functions in object-oriented style.\nFor instance, `string.byte(s,i)`\ncan be written as `s:byte(i)`.\n\nThe string library assumes one-byte character encodings."}}, table = {binding = "table", fields = {concat = {binding = "table.concat", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"list", "?sep", "?i", "?j"}, ["fnl/docstring"] = "Given a list where all elements are strings or numbers,\nreturns the string `list[i]..sep..list[i+1] ... sep..list[j]`.\nThe default value for `?sep` is the empty string,\nthe default for `?i` is 1,\nand the default for `?j` is `#list`.\nIf `?i` is greater than `?j`, returns the empty string."}}, create = {binding = "table.create", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"nseq", "?nrec"}, ["fnl/docstring"] = "Creates a new empty table, preallocating memory.\nThis preallocation may help performance and save memory\nwhen you know in advance how many elements the table will have.\n\nParameter `nseq` is a hint for how many elements the table\nwill have as a sequence.\nOptional parameter `?nrec` is a hint for how many other elements\nthe table will have; its default is zero."}}, insert = {binding = "table.insert", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"list", "value"}, ["fnl/docstring"] = "Inserts element `value` at position `pos` in `list`,\nshifting up the elements\n`list[pos],list[pos+1],...,list[#list]`.\nThe default value for `pos` is `#list+1`,\nso that a call `table.insert(t,x)` inserts `x` at the end\nof the list `t`."}}, move = {binding = "table.move", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"a1", "f", "e", "t", "?a2"}, ["fnl/docstring"] = "Moves elements from the table `a1` to the table `?a2`,\nperforming the equivalent to the following\nmultiple assignment:\n`a2[t],... = a1[f],...,a1[e]`.\nThe default for `?a2` is `a1`.\nThe destination range can overlap with the source range.\nThe number of elements to be moved must fit in a Lua integer.\nIf `f` is larger than `e`,\nnothing is moved.\n\nReturns the destination table `?a2`."}}, pack = {binding = "table.pack", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"..."}, ["fnl/docstring"] = "Returns a new table with all arguments stored into keys 1, 2, etc.\nand with a field `\"n\"` with the total number of arguments.\nNote that the resulting table may not be a sequence,\nif some arguments are **nil**."}}, remove = {binding = "table.remove", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"list", "?pos"}, ["fnl/docstring"] = "Removes from `list` the element at position `?pos`,\nreturning the value of the removed element.\nWhen `?pos` is an integer between 1 and `#list`,\nit shifts down the elements\n`list[pos+1],list[pos+2],...,list[#list]`\nand erases element `list[#list]`;\nThe index `?pos` can also be 0 when `#list` is 0,\nor `#list + 1`.\n\nThe default value for `?pos` is `#list`,\nso that a call `table.remove(l)` removes the last element\nof the list `l`."}}, sort = {binding = "table.sort", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"list", "?comp"}, ["fnl/docstring"] = "Sorts the list elements in a given order, *in-place*,\nfrom `list[1]` to `list[#list]`.\nIf `?comp` is given,\nthen it must be a function that receives two list elements\nand returns true when the first element must come\nbefore the second in the final order,\nso that, after the sort,\n`i <= j` implies `not comp(list[j],list[i])`.\nIf `?comp` is not given,\nthen the standard Lua operator `<` is used instead.\n\nThe `?comp` function must define a consistent order;\nmore formally, the function must define a strict weak order.\n(A weak order is similar to a total order,\nbut it can equate different elements for comparison purposes.)\n\nThe sort algorithm is not stable:\nDifferent elements considered equal by the given order\nmay have their relative positions changed by the sort."}}, unpack = {binding = "table.unpack", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"list", "?i", "?j"}, ["fnl/docstring"] = "Returns the elements from the given list.\nThis function is equivalent to\n\n```lua\n     return list[i], list[i+1], ..., list[j]\n```\nBy default, `?i` is 1 and `?j` is `#list`."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "This library provides generic functions for table manipulation.\nIt provides all its functions inside the table `table`.\n\nRemember that, whenever an operation needs the length of a table,\nall caveats about the length operator apply\nAll functions ignore non-numeric keys\nin the tables given as arguments."}}, tonumber = {binding = "tonumber", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"e", "?base"}, ["fnl/docstring"] = "When called with no `?base`,\n`tonumber` tries to convert its argument to a number.\nIf the argument is already a number or\na string convertible to a number,\nthen `tonumber` returns this number;\notherwise, it returns **fail**.\n\nThe conversion of strings can result in integers or floats,\naccording to the lexical conventions of Lua\nThe string may have leading and trailing spaces and a sign.\n\nWhen called with `?base`,\nthen `e` must be a string to be interpreted as\nan integer numeral in that base.\nThe base may be any integer between 2 and 36, inclusive.\nIn bases above 10, the letter `\"A\"` (in either upper or lower case)\nrepresents 10, `\"B\"` represents 11, and so forth,\nwith `\"Z\"` representing 35.\nIf the string `e` is not a valid numeral in the given base,\nthe function returns **fail**."}}, tostring = {binding = "tostring", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"v"}, ["fnl/docstring"] = "Receives a value of any type and\nconverts it to a string in a human-readable format.\n\nIf the metatable of `v` has a `__tostring` field,\nthen `tostring` calls the corresponding value\nwith `v` as argument,\nand uses the result of the call as its result.\nOtherwise, if the metatable of `v` has a `__name` field\nwith a string value,\n`tostring` may use that string in its final result.\n\nFor complete control of how numbers are converted,\nuse `string.format`."}}, type = {binding = "type", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"v"}, ["fnl/docstring"] = "Returns the type of its only argument, coded as a string.\nThe possible results of this function are\n`\"nil\"` (a string, not the value **nil**),\n`\"number\"`,\n`\"string\"`,\n`\"boolean\"`,\n`\"table\"`,\n`\"function\"`,\n`\"thread\"`,\nand `\"userdata\"`."}}, utf8 = {binding = "utf8", fields = {char = {binding = "utf8.char", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"..."}, ["fnl/docstring"] = "Receives zero or more integers,\nconverts each one to its corresponding UTF-8 byte sequence\nand returns a string with the concatenation of all these sequences."}}, charpattern = {binding = "utf8.charpattern", metadata = {["fls/itemKind"] = "Variable", ["fnl/docstring"] = "The pattern (a string, not a function) `\"[\\0-\\x7F\\xC2-\\xFD][\\x80-\\xBF]*\"`\nwhich matches exactly one UTF-8 byte sequence,\nassuming that the subject is a valid UTF-8 string."}}, codepoint = {binding = "utf8.codepoint", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "?i", "?j", "?lax"}, ["fnl/docstring"] = "Returns the code points (as integers) from all characters in `s`\nthat start between byte position `?i` and `?j` (both included).\nThe default for `?i` is 1 and for `?j` is `?i`.\nIt raises an error if it meets any invalid byte sequence."}}, codes = {binding = "utf8.codes", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "?lax"}, ["fnl/docstring"] = "Returns values so that the construction\n\n```lua\n     for p, c in utf8.codes(s) do *body* end\n```\nwill iterate over all UTF-8 characters in string `s`,\nwith `p` being the position (in bytes) and `c` the code point\nof each character.\nIt raises an error if it meets any invalid byte sequence."}}, len = {binding = "utf8.len", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "?i", "?j", "?lax"}, ["fnl/docstring"] = "Returns the number of UTF-8 characters in string `s`\nthat start between positions `?i` and `?j` (both inclusive).\nThe default for `?i` is 1 and for `?j` is -1.\nIf it finds any invalid byte sequence,\nreturns **fail** plus the position of the first invalid byte."}}, offset = {binding = "utf8.offset", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"s", "n", "?i"}, ["fnl/docstring"] = "Returns the position of the `n`-th character of `s`\n(counting from byte position `?i`) as two integers:\nThe index (in bytes) where its encoding starts and the\nindex (in bytes) where it ends.\n\nIf the specified character is right after the end of `s`,\nthe function behaves as if there was a `\"\\0\"` there.\nIf the specified character is neither in the subject\nnor right after its end,\nthe function returns **fail**.\n\nA negative `n` gets characters before position `?i`.\nThe default for `?i` is 1 when `n` is non-negative\nand `#s + 1` otherwise,\nso that `utf8.offset(s,-n)` gets the offset of the\n`n`-th character from the end of the string.\n\nAs a special case,\nwhen `n` is 0 the function returns the start and end\nof the encoding of the character that contains the\n`?i`-th byte of `s`.\n\nThis function assumes that `s` is a valid UTF-8 string."}}}, metadata = {["fls/itemKind"] = "Module", ["fnl/docstring"] = "This library provides basic support for UTF-8 encoding.\nIt provides all its functions inside the table `utf8`.\nThis library does not provide any support for Unicode other\nthan the handling of the encoding.\nAny operation that needs the meaning of a character,\nsuch as character classification, is outside its scope.\n\nUnless stated otherwise,\nall functions that expect a byte position as a parameter\nassume that the given position is either the start of a byte sequence\nor one plus the length of the subject string.\nAs in the string library,\nnegative indices count from the end of the string.\n\nFunctions that create byte sequences\naccept all values up to `0x7FFFFFFF`,\nas defined in the original UTF-8 specification;\nthat implies byte sequences of up to six bytes.\n\nFunctions that interpret byte sequences only accept\nvalid sequences (well formed and not overlong).\nBy default, they only accept byte sequences\nthat result in valid Unicode code points,\nrejecting values greater than `10FFFF` and surrogates.\nA boolean argument `lax`, when available,\nlifts these checks,\nso that all values up to `0x7FFFFFFF` are accepted.\n(Not well formed and overlong sequences are still rejected.)"}}, warn = {binding = "warn", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"msg1", "..."}, ["fnl/docstring"] = "Emits a warning with a message composed by the concatenation\nof all its arguments (which should be strings).\n\nBy convention,\na one-piece message starting with `\"@\"`\nis intended to be a *control message*,\nwhich is a message to the warning system itself.\nIn particular, the standard warning function in Lua\nrecognizes the control messages `\"@off\"`,\nto stop the emission of warnings,\nand `\"@on\"`, to (re)start the emission;\nit ignores unknown control messages."}}, xpcall = {binding = "xpcall", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"f", "msgh", "?arg1", "..."}, ["fnl/docstring"] = "This function is similar to `pcall`,\nexcept that it sets a new message handler `msgh`."}}}
  local file_fields = {close = {binding = "file:close", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"self"}, ["fnl/docstring"] = "Closes `file`.\nNote that files are automatically closed when\ntheir handles are garbage collected,\nbut that takes an unpredictable amount of time to happen.\n\nWhen closing a file handle created with `io.popen`,\n`file:close` returns the same values\nreturned by `os.execute`."}}, flush = {binding = "file:flush", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"self"}, ["fnl/docstring"] = "Saves any written data to `file`."}}, lines = {binding = "file:lines", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"self", "..."}, ["fnl/docstring"] = "Returns an iterator function that,\neach time it is called,\nreads the file according to the given formats.\nWhen no format is given,\nuses `\"l\"` as a default.\nAs an example, the construction\n\n```lua\n     for c in file:lines(1) do *body* end\n```\nwill iterate over all characters of the file,\nstarting at the current position.\nUnlike `io.lines`, this function does not close the file\nwhen the loop ends."}}, read = {binding = "file:read", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"self", "..."}, ["fnl/docstring"] = "Reads the file `file`,\naccording to the given formats, which specify what to read.\nFor each format,\nthe function returns a string or a number with the characters read,\nor **fail** if it cannot read data with the specified format.\n(In this latter case,\nthe function does not read subsequent formats.)\nWhen called without arguments,\nit uses a default format that reads the next line\n(see below).\n\nThe available formats are\n\n* **`\"n\"`**: \n  reads a numeral and returns it as a float or an integer,\n  following the lexical conventions of Lua.\n  (The numeral may have leading whitespaces and a sign.)\n  This format always reads the longest input sequence that\n  is a valid prefix for a numeral;\n  if that prefix does not form a valid numeral\n  (e.g., an empty string, `\"0x\"`, or `\"3.4e-\"`)\n  or it is too long (more than 200 characters),\n  it is discarded and the format returns **fail**.\n\n* **`\"a\"`**: \n  reads the whole file, starting at the current position.\n  On end of file, it returns the empty string;\n  this format never fails.\n\n* **`\"l\"`**: \n  reads the next line skipping the end of line,\n  returning **fail** on end of file.\n  This is the default format.\n\n* **`\"L\"`**: \n  reads the next line keeping the end-of-line character (if present),\n  returning **fail** on end of file.\n\n* ***number***: \n  reads a string with up to this number of bytes,\n  returning **fail** on end of file.\n  If `number` is zero,\n  it reads nothing and returns an empty string,\n  or **fail** on end of file.\n\nThe formats `\"l\"` and `\"L\"` should be used only for text files."}}, seek = {binding = "file:seek", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"self", "?whence", "?offset"}, ["fnl/docstring"] = "Sets and gets the file position,\nmeasured from the beginning of the file,\nto the position given by `?offset` plus a base\nspecified by the string `?whence`, as follows:\n\n* **`\"set\"`**:  base is position 0 (beginning of the file);\n* **`\"cur\"`**:  base is current position;\n* **`\"end\"`**:  base is end of file;\n\nIn case of success, `seek` returns the final file position,\nmeasured in bytes from the beginning of the file.\nIf `seek` fails, it returns **fail**,\nplus a string describing the error.\n\nThe default value for `?whence` is `\"cur\"`,\nand for `?offset` is 0.\nTherefore, the call `file:seek()` returns the current\nfile position, without changing it;\nthe call `file:seek(\"set\")` sets the position to the\nbeginning of the file (and returns 0);\nand the call `file:seek(\"end\")` sets the position to the\nend of the file, and returns its size."}}, setvbuf = {binding = "file:setvbuf", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"self", "mode", "?size"}, ["fnl/docstring"] = "Sets the buffering mode for a file.\nThere are three available modes:\n\n* **`\"no\"`**:  no buffering.\n* **`\"full\"`**:  full buffering.\n* **`\"line\"`**:  line buffering.\n\nFor the last two cases,\n`?size` is a hint for the size of the buffer, in bytes.\nThe default is an appropriate size.\n\nThe specific behavior of each mode is non portable;\ncheck the underlying ISO C function `setvbuf` in your platform for\nmore details."}}, write = {binding = "file:write", metadata = {["fls/itemKind"] = "Function", ["fnl/arglist"] = {"self", "..."}, ["fnl/docstring"] = "Writes the value of each of its arguments to `file`.\nThe arguments must be strings or numbers.\n\nIn case of success, this function returns `file`.\nOtherwise, it returns four values:\n**fail**, the error message, the error code,\nand the number of bytes it was able to write."}}}
  docs._G.fields = docs
  docs.io.fields.stdin.fields = file_fields
  docs.io.fields.stdout.fields = file_fields
  docs.io.fields.stderr.fields = file_fields
  return docs
end
package.preload["fennel-ls.docs.generated.compiler-env"] = package.preload["fennel-ls.docs.generated.compiler-env"] or function(...)
  return {["assert-compile"] = {metadata = {["fls/fntype"] = "fn", ["fls/itemKind"] = "Function", ["fnl/arglist"] = {"condition", "msg", "?ast", "?fallback-ast"}, ["fnl/docstring"] = "Assert a condition and raise a compile error with line numbers.\nThe ast arg should be unmodified so that its first element is the form called."}}, ["ast-source"] = {metadata = {["fls/fntype"] = "fn", ["fls/itemKind"] = "Function", ["fnl/arglist"] = {"ast"}, ["fnl/docstring"] = "Get a table for the given ast which includes file/line info, if possible."}}, comment = {metadata = {["fls/fntype"] = "fn", ["fls/itemKind"] = "Function", ["fnl/arglist"] = {"contents", "?source"}}}, ["comment?"] = {metadata = {["fls/fntype"] = "fn", ["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}}}, ["fennel-module-name"] = {metadata = {["fls/fntype"] = "fn", ["fls/itemKind"] = "Function", ["fnl/arglist"] = {}}}, gensym = {metadata = {["fls/fntype"] = "fn", ["fls/itemKind"] = "Function", ["fnl/arglist"] = {"base"}}}, ["get-scope"] = {metadata = {["fls/fntype"] = "fn", ["fls/itemKind"] = "Function", ["fnl/arglist"] = {}}}, ["in-scope?"] = {metadata = {["fls/fntype"] = "fn", ["fls/itemKind"] = "Function", ["fnl/arglist"] = {"symbol"}}}, list = {metadata = {["fls/fntype"] = "fn", ["fls/itemKind"] = "Function", ["fnl/arglist"] = {"..."}, ["fnl/docstring"] = "Create a new list. Lists are a compile-time construct in Fennel; they are\nrepresented as tables with a special marker metatable. They only come from\nthe parser, and they represent code which comes from reading a paren form;\nthey are specifically not cons cells."}}, ["list?"] = {metadata = {["fls/fntype"] = "fn", ["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Checks if an object is a list. Returns the object if is."}}, ["macro-loaded"] = {fields = {}}, macroexpand = {metadata = {["fls/fntype"] = "fn", ["fls/itemKind"] = "Function", ["fnl/arglist"] = {"form"}}}, ["multi-sym?"] = {metadata = {["fls/fntype"] = "fn", ["fls/itemKind"] = "Function", ["fnl/arglist"] = {"str"}, ["fnl/docstring"] = "Returns a table containing the symbol's segments if passed a multi-sym.\nA multi-sym refers to a table field reference like tbl.x or access.channel:deny.\nReturns nil if passed something other than a multi-sym."}}, pack = {}, sequence = {metadata = {["fls/fntype"] = "fn", ["fls/itemKind"] = "Function", ["fnl/arglist"] = {"..."}, ["fnl/docstring"] = "Create a new sequence. Sequences are tables that come from the parser when\nit encounters a form with square brackets. They are treated as regular tables\nexcept when certain macros need to look for binding forms, etc specifically."}}, ["sequence?"] = {metadata = {["fls/fntype"] = "fn", ["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Checks if an object is a sequence (created with a [] literal)"}}, sym = {metadata = {["fls/fntype"] = "fn", ["fls/itemKind"] = "Function", ["fnl/arglist"] = {"str", "?source"}, ["fnl/docstring"] = "Create a new symbol. Symbols are a compile-time construct in Fennel and are\nnot exposed outside the compiler. Second optional argument is a table describing\nwhere the symbol came from; should be a table with filename, line, bytestart,\nand byteend fields."}}, ["sym?"] = {metadata = {["fls/fntype"] = "fn", ["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x", "?name"}, ["fnl/docstring"] = "Checks if an object is a symbol. Returns the object if it is.\nWhen given a second string argument, will check that the sym's name matches it."}}, ["table?"] = {metadata = {["fls/fntype"] = "fn", ["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Checks if an object any kind of table, EXCEPT list/symbol/varg/comment."}}, unpack = {}, ["varg?"] = {metadata = {["fls/fntype"] = "fn", ["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x"}, ["fnl/docstring"] = "Checks if an object is the varg symbol. Returns the object if is."}}, version = {definition = "1.6.1"}, view = {metadata = {["fls/fntype"] = "fn", ["fls/itemKind"] = "Function", ["fnl/arglist"] = {"x", "?options"}, ["fnl/docstring"] = "Return a string representation of x.\n\nCan take an options table with the following keys:\n\n* :one-line? (default: false) keep the output string as a one-liner\n* :depth (number, default: 128) limit how many levels to go (default: 128)\n* :detect-cycles? (default: true) don't try to traverse a looping table\n* :metamethod? (default: true) use the __fennelview metamethod if found\n* :empty-as-sequence? (default: false) render empty tables as []\n* :line-length (number, default: 80) length of the line at which\n  multi-line output for tables is forced\n* :escape-newlines? (default: false) emit strings with \\n instead of newline\n* :prefer-colon? (default: false) emit strings in colon notation when possible\n* :utf8? (default: true) whether to use the utf8 module to compute string lengths\n* :max-sparse-gap: maximum gap to fill in with nils in sparse sequential tables\n* :preprocess (function) if present, called on x (and recursively on each value\n  in x), and the result is used for pretty printing; takes the same arguments as\n  `fennel.view`\n* :infinity, :negative-infinity - how to serialize infinity and negative infinity\n* :nan, :negative-nan - how to serialize NaN and negative NaN values\n\nAll options can be set to `{:once some-value}` to force their value to be\n`some-value` but only for the current level.  After that, the option is reset\nto its default value.  Alternatively, `{:once value :after other-value}` can\nbe used, with the difference that after the first use, the options will be set to\n`other-value` instead of the default value.\n\nYou can set a `__fennelview` metamethod on a table to override its serialization\nbehavior; see the API reference for details."}}}
end
package.preload["fennel-ls.compiler"] = package.preload["fennel-ls.compiler"] or function(...)
  local _local_174_ = require("fennel")
  local sym_3f = _local_174_["sym?"]
  local list_3f = _local_174_["list?"]
  local sequence_3f = _local_174_["sequence?"]
  local table_3f = _local_174_["table?"]
  local varg_3f = _local_174_["varg?"]
  local sym = _local_174_.sym
  local view = _local_174_.view
  local fennel = _local_174_
  local _local_175_ = require("fennel.compiler")
  local _local_176_ = _local_175_.scopes
  local compiler_scope = _local_176_.compiler
  local _local_177_ = require("fennel.specials")
  local make_compiler_env = _local_177_["make-compiler-env"]
  local docs = require("fennel-ls.docs")
  local message = require("fennel-ls.message")
  local searcher = require("fennel-ls.searcher")
  local utils = require("fennel-ls.utils")
  local print = print
  local compiler_env = make_compiler_env()
  local compiler_globals
  do
    local pairs
    do
      local case_230_ = getmetatable(compiler_env)
      if ((_G.type(case_230_) == "table") and (nil ~= case_230_.__pairs)) then
        local mtpairs = case_230_.__pairs
        pairs = mtpairs
      else
        local _ = case_230_
        pairs = pairs
      end
    end
    local tbl_26_ = {}
    local i_27_ = 0
    for k in pairs(compiler_env) do
      local val_28_ = k
      if (nil ~= val_28_) then
        i_27_ = (i_27_ + 1)
        tbl_26_[i_27_] = val_28_
      else
      end
    end
    compiler_globals = tbl_26_
  end
  compiler_env._G._FENNEL_LS = true
  do
    local tbl_21_ = {}
    for k, v in getmetatable(compiler_env).__pairs(compiler_env) do
      local k_22_, v_23_ = k, v
      if ((k_22_ ~= nil) and (v_23_ ~= nil)) then
        tbl_21_[k_22_] = v_23_
      else
      end
    end
    compiler_env = tbl_21_
  end
  local nil_2a = sym("nil")
  local function scope_3f(candidate)
    return ((type(candidate) == "table") and (type(candidate.includes) == "table") and (type(candidate.macros) == "table") and (type(candidate.manglings) == "table") and (type(candidate.specials) == "table") and (type(candidate.gensyms) == "table"))
  end
  local function multisym_3f(t)
    if (nil == t) then
      _G.error("Missing argument t on /fennel-ls/src/fennel-ls/compiler.fnl:42", 2)
    else
    end
    local and_235_ = sym_3f(t)
    if and_235_ then
      local t0 = tostring(t)
      and_235_ = (t0:find("%.") or t0:find(":"))
    end
    return and_235_
  end
  local function iter(t)
    if (nil == t) then
      _G.error("Missing argument t on /fennel-ls/src/fennel-ls/compiler.fnl:49", 2)
    else
    end
    if (list_3f(t) or sequence_3f(t)) then
      return ipairs(t)
    else
      return pairs(t)
    end
  end
  local has_tables_mt
  local function _239_(self, key)
    if (nil == key) then
      _G.error("Missing argument key on /fennel-ls/src/fennel-ls/compiler.fnl:58", 2)
    else
    end
    if (nil == self) then
      _G.error("Missing argument self on /fennel-ls/src/fennel-ls/compiler.fnl:58", 2)
    else
    end
    local val = {}
    self[key] = val
    return val
  end
  has_tables_mt = {__index = _239_}
  local function line_2bbyte__3erange(server, file, line, byte)
    if (nil == byte) then
      _G.error("Missing argument byte on /fennel-ls/src/fennel-ls/compiler.fnl:63", 2)
    else
    end
    if (nil == line) then
      _G.error("Missing argument line on /fennel-ls/src/fennel-ls/compiler.fnl:63", 2)
    else
    end
    if (nil == file) then
      _G.error("Missing argument file on /fennel-ls/src/fennel-ls/compiler.fnl:63", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/compiler.fnl:63", 2)
    else
    end
    local line0 = (line - 1)
    local position = utils["pos->position"](file.text, line0, byte, server["position-encoding"])
    return {start = position, ["end"] = position}
  end
  local function do_compile(_246_, file)
    local _arg_247_ = _246_.configuration
    local macro_path = _arg_247_["macro-path"]
    local _3froot_uri = _246_["root-uri"]
    local server = _246_
    if (nil == file) then
      _G.error("Missing argument file on /fennel-ls/src/fennel-ls/compiler.fnl:68", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/compiler.fnl:68", 2)
    else
    end
    if (nil == macro_path) then
      _G.error("Missing argument macro-path on /fennel-ls/src/fennel-ls/compiler.fnl:68", 2)
    else
    end
    local definitions_by_scope
    do
      local tmp_9_ = {}
      setmetatable(tmp_9_, has_tables_mt)
      definitions_by_scope = tmp_9_
    end
    local definitions = {}
    local multi_binds = {}
    local compile_diagnostics = {}
    local references = {}
    local macro_refs = {}
    local scopes = {}
    local calls = {}
    local lexical = {}
    local require_calls = {}
    local macro_calls = {}
    local defer = {}
    local function find_definition(name, _3fscope)
      if (nil == name) then
        _G.error("Missing argument name on /fennel-ls/src/fennel-ls/compiler.fnl:85", 2)
      else
      end
      if _3fscope then
        return (definitions_by_scope[_3fscope][name] or find_definition(name, _3fscope.parent))
      else
        return nil
      end
    end
    local function reference(symbol, scope, ref_type)
      if (nil == ref_type) then
        _G.error("Missing argument ref-type on /fennel-ls/src/fennel-ls/compiler.fnl:90", 2)
      else
      end
      if (nil == scope) then
        _G.error("Missing argument scope on /fennel-ls/src/fennel-ls/compiler.fnl:90", 2)
      else
      end
      if (nil == symbol) then
        _G.error("Missing argument symbol on /fennel-ls/src/fennel-ls/compiler.fnl:90", 2)
      else
      end
      assert(((ref_type == "read") or (ref_type == "write") or (ref_type == "mutate")), "wrong ref-type")
      assert(sym_3f(symbol), "not-a-symbol")
      assert(scope_3f(scope), "not-a-scope")
      local name = string.match(tostring(symbol), "[^%.:]+")
      local case_256_ = (find_definition(tostring(name), scope) or docs["get-global"](server, scope, name))
      if (nil ~= case_256_) then
        local target = case_256_
        local ref = {symbol = symbol, target = target, ["ref-type"] = ref_type}
        references[symbol] = ref
        if target["referenced-by"] then
          return table.insert(target["referenced-by"], ref)
        else
          return nil
        end
      else
        return nil
      end
    end
    local function symbol_to_expression(ast, scope, _3freference_3f)
      if (nil == scope) then
        _G.error("Missing argument scope on /fennel-ls/src/fennel-ls/compiler.fnl:103", 2)
      else
      end
      if (nil == ast) then
        _G.error("Missing argument ast on /fennel-ls/src/fennel-ls/compiler.fnl:103", 2)
      else
      end
      assert(sym_3f(ast), "symbols only")
      scopes[ast] = scope
      local function _261_()
        if _3freference_3f then
          return "read"
        elseif not multisym_3f(ast) then
          return "write"
        else
          return "mutate"
        end
      end
      return reference(ast, scope, _261_())
    end
    local function for_each_binding_in(binding, _3fdefinition, action)
      if (nil == action) then
        _G.error("Missing argument action on /fennel-ls/src/fennel-ls/compiler.fnl:112", 2)
      else
      end
      if (nil == binding) then
        _G.error("Missing argument binding on /fennel-ls/src/fennel-ls/compiler.fnl:112", 2)
      else
      end
      local function recurse(binding0, keys, depth)
        if (nil == depth) then
          _G.error("Missing argument depth on /fennel-ls/src/fennel-ls/compiler.fnl:113", 2)
        else
        end
        if (nil == keys) then
          _G.error("Missing argument keys on /fennel-ls/src/fennel-ls/compiler.fnl:113", 2)
        else
        end
        if (nil == binding0) then
          _G.error("Missing argument binding on /fennel-ls/src/fennel-ls/compiler.fnl:113", 2)
        else
        end
        if sym_3f(binding0) then
          return action(binding0, _3fdefinition, keys, keys.multival)
        elseif list_3f(binding0) then
          local set_target_3f = sym_3f(binding0[1], ".")
          if set_target_3f then
            return action(binding0, _3fdefinition, keys, keys.multival)
          elseif (depth ~= 0) then
            return error(("I didn't expect to find a nested multival destructure in " .. view(binding0) .. " at " .. view(keys)))
          else
            for i, child in ipairs(binding0) do
              keys.multival = i
              recurse(child, keys, (depth + 1))
              keys.multival = nil
            end
            return nil
          end
        elseif table_3f(binding0) then
          local prev = nil
          for key, child in iter(binding0) do
            if (sym_3f(key, "&as") or sym_3f(prev, "&as")) then
              prev = recurse(child, keys, (depth + 1))
            elseif (sym_3f(key, "&") or sym_3f(prev, "&")) then
              prev = for_each_binding_in(child, {}, action)
            elseif (sym_3f(child, "&as") or sym_3f(child, "&")) then
              prev = child
            else
              table.insert(keys, key)
              recurse(child, keys, (depth + 1))
              prev = table.remove(keys)
            end
          end
          return prev
        else
          return nil
        end
      end
      return recurse(binding, {}, 0)
    end
    local function define(_3fdefinition, binding, scope, _3fopts)
      if (nil == scope) then
        _G.error("Missing argument scope on /fennel-ls/src/fennel-ls/compiler.fnl:143", 2)
      else
      end
      if (nil == binding) then
        _G.error("Missing argument binding on /fennel-ls/src/fennel-ls/compiler.fnl:143", 2)
      else
      end
      if list_3f(binding) then
        table.insert(multi_binds, {left = binding, right = _3fdefinition})
      else
      end
      local function _273_(symbol, _3fdefinition0, keys, _3fmultival)
        if not (list_3f(symbol) or multisym_3f(symbol)) then
          local definition
          local _275_
          do
            local t_274_ = definitions
            if (nil ~= t_274_) then
              t_274_ = t_274_[symbol]
            else
            end
            if (nil ~= t_274_) then
              t_274_ = t_274_["referenced-by"]
            else
            end
            _275_ = t_274_
          end
          local _278_
          if keys[1] then
            local tbl_26_ = {}
            local i_27_ = 0
            for _, v in ipairs(keys) do
              local val_28_ = v
              if (nil ~= val_28_) then
                i_27_ = (i_27_ + 1)
                tbl_26_[i_27_] = val_28_
              else
              end
            end
            _278_ = tbl_26_
          else
            _278_ = nil
          end
          local _283_
          do
            local t_282_ = _3fopts
            if (nil ~= t_282_) then
              t_282_ = t_282_.isvar
            else
            end
            _283_ = t_282_
          end
          definition = {binding = symbol, definition = _3fdefinition0, ["referenced-by"] = (_275_ or {}), keys = _278_, multival = _3fmultival, ["var?"] = _283_, file = file}
          definitions_by_scope[scope][tostring(symbol)] = definition
          definitions[symbol] = definition
          return nil
        else
          return nil
        end
      end
      return for_each_binding_in(binding, _3fdefinition, _273_)
    end
    local function mutate(_3fdefinition, binding, scope)
      if (nil == scope) then
        _G.error("Missing argument scope on /fennel-ls/src/fennel-ls/compiler.fnl:162", 2)
      else
      end
      if (nil == binding) then
        _G.error("Missing argument binding on /fennel-ls/src/fennel-ls/compiler.fnl:162", 2)
      else
      end
      local function _288_(symbol, __3fdefinition, _keys)
        if not (list_3f(symbol) or multisym_3f(symbol)) then
          reference(symbol, scope, "write")
          if references[symbol] then
            references[symbol].target["var-set"] = true
            return nil
          else
            return nil
          end
        else
          return nil
        end
      end
      return for_each_binding_in(binding, _3fdefinition, _288_)
    end
    local function destructure(to, from, scope, _291_)
      local _3fdeclaration_3f = _291_.declaration
      local symtype = _291_.symtype
      local opts = _291_
      if (nil == opts) then
        _G.error("Missing argument opts on /fennel-ls/src/fennel-ls/compiler.fnl:170", 2)
      else
      end
      if (nil == symtype) then
        _G.error("Missing argument symtype on /fennel-ls/src/fennel-ls/compiler.fnl:170", 2)
      else
      end
      if (nil == scope) then
        _G.error("Missing argument scope on /fennel-ls/src/fennel-ls/compiler.fnl:170", 2)
      else
      end
      if (nil == from) then
        _G.error("Missing argument from on /fennel-ls/src/fennel-ls/compiler.fnl:170", 2)
      else
      end
      if (nil == to) then
        _G.error("Missing argument to on /fennel-ls/src/fennel-ls/compiler.fnl:170", 2)
      else
      end
      if (symtype ~= "pv") then
        if _3fdeclaration_3f then
          return define(to, from, scope, opts)
        else
          return mutate(to, from, scope)
        end
      else
        return nil
      end
    end
    local function add_field(ast, multisym, scope)
      if (nil == scope) then
        _G.error("Missing argument scope on /fennel-ls/src/fennel-ls/compiler.fnl:178", 2)
      else
      end
      if (nil == multisym) then
        _G.error("Missing argument multisym on /fennel-ls/src/fennel-ls/compiler.fnl:178", 2)
      else
      end
      if (nil == ast) then
        _G.error("Missing argument ast on /fennel-ls/src/fennel-ls/compiler.fnl:178", 2)
      else
      end
      local function _302_(...)
        local case_303_ = ...
        if ((_G.type(case_303_) == "table") and (nil ~= case_303_[1]) and (nil ~= case_303_[2]) and (case_303_[3] == nil)) then
          local ref = case_303_[1]
          local field = case_303_[2]
          local function _304_(...)
            local case_305_ = ...
            if (nil ~= case_305_) then
              local target = case_305_
              target.fields = (target.fields or {})
              target.fields[field] = {binding = multisym, definition = ast, file = file}
              return nil
            else
              local __43_ = case_305_
              return ...
            end
          end
          return _304_(find_definition(ref, scope))
        else
          local __43_ = case_303_
          return ...
        end
      end
      return _302_(utils["multi-sym-split"](multisym))
    end
    local function define_function_name(ast, scope)
      if (nil == scope) then
        _G.error("Missing argument scope on /fennel-ls/src/fennel-ls/compiler.fnl:193", 2)
      else
      end
      if (nil == ast) then
        _G.error("Missing argument ast on /fennel-ls/src/fennel-ls/compiler.fnl:193", 2)
      else
      end
      local and_310_ = ((_G.type(ast) == "table") and true and (nil ~= ast[2]) and (nil ~= ast[3]))
      if and_310_ then
        local _fn = ast[1]
        local name = ast[2]
        local args = ast[3]
        and_310_ = (sym_3f(name) and sequence_3f(args))
      end
      if and_310_ then
        local _fn = ast[1]
        local name = ast[2]
        local args = ast[3]
        if multisym_3f(name) then
          return add_field(ast, name, scope)
        else
          return define(ast, name, scope)
        end
      else
        return nil
      end
    end
    local function fn_arg(arg_name, n, fn_sym)
      if (nil == fn_sym) then
        _G.error("Missing argument fn-sym on /fennel-ls/src/fennel-ls/compiler.fnl:204", 2)
      else
      end
      if (nil == n) then
        _G.error("Missing argument n on /fennel-ls/src/fennel-ls/compiler.fnl:204", 2)
      else
      end
      if (nil == arg_name) then
        _G.error("Missing argument arg-name on /fennel-ls/src/fennel-ls/compiler.fnl:204", 2)
      else
      end
      return {["arg-name"] = arg_name, n = n, ["fn-sym"] = fn_sym, type = "fn-arg"}
    end
    local function define_function_args(ast, scope)
      if (nil == scope) then
        _G.error("Missing argument scope on /fennel-ls/src/fennel-ls/compiler.fnl:206", 2)
      else
      end
      if (nil == ast) then
        _G.error("Missing argument ast on /fennel-ls/src/fennel-ls/compiler.fnl:206", 2)
      else
      end
      local args
      local and_319_ = ((_G.type(ast) == "table") and true and (nil ~= ast[2]))
      if and_319_ then
        local _fn = ast[1]
        local args0 = ast[2]
        and_319_ = fennel["sequence?"](args0)
      end
      if and_319_ then
        local _fn = ast[1]
        local args0 = ast[2]
        args = args0
      else
        local and_321_ = ((_G.type(ast) == "table") and true and true and (nil ~= ast[3]))
        if and_321_ then
          local _fn = ast[1]
          local _name = ast[2]
          local args0 = ast[3]
          and_321_ = fennel["sequence?"](args0)
        end
        if and_321_ then
          local _fn = ast[1]
          local _name = ast[2]
          local args0 = ast[3]
          args = args0
        else
          local _ = ast
          args = {}
        end
      end
      for i, argument in ipairs(args) do
        if not sym_3f(argument, "&") then
          define(fn_arg(tostring(argument), i, sym_3f(ast[2])), argument, scope)
        else
        end
      end
      return nil
    end
    local function define_function(ast, scope)
      if (nil == scope) then
        _G.error("Missing argument scope on /fennel-ls/src/fennel-ls/compiler.fnl:217", 2)
      else
      end
      if (nil == ast) then
        _G.error("Missing argument ast on /fennel-ls/src/fennel-ls/compiler.fnl:217", 2)
      else
      end
      return define_function_name(ast, scope)
    end
    local function compile_for(ast, scope, binding)
      if (nil == binding) then
        _G.error("Missing argument binding on /fennel-ls/src/fennel-ls/compiler.fnl:221", 2)
      else
      end
      if (nil == scope) then
        _G.error("Missing argument scope on /fennel-ls/src/fennel-ls/compiler.fnl:221", 2)
      else
      end
      if (nil == ast) then
        _G.error("Missing argument ast on /fennel-ls/src/fennel-ls/compiler.fnl:221", 2)
      else
      end
      scopes[ast] = scope
      return define(nil_2a, binding, scope)
    end
    local function compile_each(ast, scope, bindings)
      if (nil == bindings) then
        _G.error("Missing argument bindings on /fennel-ls/src/fennel-ls/compiler.fnl:225", 2)
      else
      end
      if (nil == scope) then
        _G.error("Missing argument scope on /fennel-ls/src/fennel-ls/compiler.fnl:225", 2)
      else
      end
      if (nil == ast) then
        _G.error("Missing argument ast on /fennel-ls/src/fennel-ls/compiler.fnl:225", 2)
      else
      end
      scopes[ast] = scope
      for _, binding in ipairs(bindings) do
        if (sym_3f(binding) and not scope.gensyms[tostring(binding)]) then
          define(nil_2a, binding, scope)
        else
        end
      end
      return nil
    end
    local function compile_fn(ast, scope)
      if (nil == scope) then
        _G.error("Missing argument scope on /fennel-ls/src/fennel-ls/compiler.fnl:232", 2)
      else
      end
      if (nil == ast) then
        _G.error("Missing argument ast on /fennel-ls/src/fennel-ls/compiler.fnl:232", 2)
      else
      end
      scopes[ast] = scope
      return define_function_args(ast, scope)
    end
    local function compile_do(ast, scope)
      if (nil == scope) then
        _G.error("Missing argument scope on /fennel-ls/src/fennel-ls/compiler.fnl:236", 2)
      else
      end
      if (nil == ast) then
        _G.error("Missing argument ast on /fennel-ls/src/fennel-ls/compiler.fnl:236", 2)
      else
      end
      scopes[ast] = scope
      return nil
    end
    local function call(ast, scope)
      if (nil == scope) then
        _G.error("Missing argument scope on /fennel-ls/src/fennel-ls/compiler.fnl:239", 2)
      else
      end
      if (nil == ast) then
        _G.error("Missing argument ast on /fennel-ls/src/fennel-ls/compiler.fnl:239", 2)
      else
      end
      calls[ast] = true
      if not scopes[ast] then
        scopes[ast] = scope
      else
      end
      local head = ast[1]
      local case_341_ = (sym_3f(head) and tostring(head))
      if (case_341_ == "fn") then
        return define_function(ast, scope)
      elseif ((case_341_ == "require") or (case_341_ == "include")) then
        require_calls[ast] = true
        return nil
      else
        local and_342_ = (nil ~= case_341_)
        if and_342_ then
          local method_call = case_341_
          and_342_ = ((type(method_call) == "string") and method_call:find(":"))
        end
        if and_342_ then
          local method_call = case_341_
          return reference(head, scope, "read")
        elseif (case_341_ == "if") then
          local len = #ast
          local function _344_()
            ast[(len + 1)] = nil
            return nil
          end
          return table.insert(defer, _344_)
        else
          return nil
        end
      end
    end
    local function macroexpand(ast, transformed, scope)
      macro_calls[ast] = transformed
      local macro_id = ast[1]
      local macro_fn
      do
        local t = scope.macros
        for _, part in ipairs(utils["multi-sym-split"](macro_id)) do
          if (type(t) == "table") then
            t = t[part]
          else
            t = nil
          end
        end
        macro_fn = t
      end
      if (type(macro_fn) == "function") then
        assert(sym_3f(macro_id), "macros should be syms")
        macro_refs[macro_id] = macro_fn
        return nil
      else
        return nil
      end
    end
    local function attempt_to_recover_21(msg, _3fast)
      if (nil == msg) then
        _G.error("Missing argument msg on /fennel-ls/src/fennel-ls/compiler.fnl:273", 2)
      else
      end
      local or_349_ = (1 == msg:find("unknown identifier")) or (1 == msg:find("local %S+ was overshadowed by a special form or macro")) or (1 == msg:find("expected var ")) or (1 == msg:find("expected local ")) or (1 == msg:find("cannot call literal value")) or (1 == msg:find("unexpected vararg")) or (1 == msg:find("expected closing delimiter")) or (1 == msg:find("expected body expression")) or (1 == msg:find(".*fennel/macros.fnl:%d+: expected body")) or (1 == msg:find("expected condition and body")) or (1 == msg:find("expected whitespace before opening delimiter")) or (1 == msg:find("malformed multisym")) or (1 == msg:find("expected at least one pattern/body pair")) or (1 == msg:find("module not found")) or (1 == msg:find("expected even number of values in table literal")) or (1 == msg:find("use $%.%.%. in hashfn"))
      if not or_349_ then
        if ((1 == msg:find("expected even number of name/value bindings")) and sequence_3f(_3fast) and (1 == (#_3fast % 2))) then
          table.insert(_3fast, nil_2a)
          local function _350_()
            return table.remove(_3fast)
          end
          table.insert(defer, _350_)
          or_349_ = true
        else
          or_349_ = nil
        end
      end
      if not or_349_ then
        if ((1 == msg:find("expected a function, macro, or special to call")) and list_3f(_3fast) and (#_3fast == 0)) then
          table.insert(_3fast, sym("do"))
          local function _352_()
            return table.remove(_3fast)
          end
          table.insert(defer, _352_)
          or_349_ = true
        else
          or_349_ = nil
        end
      end
      if not or_349_ then
        if (1 == msg:find("unexpected multi symbol")) then
          local old = tostring(_3fast)
          _3fast[1] = "!!invalid-multi-symbol!!"
          local function _355_()
            _3fast[1] = old
            return nil
          end
          table.insert(defer, _355_)
          or_349_ = true
        else
          or_349_ = nil
        end
      end
      if not or_349_ then
        if ((1 == msg:find("expected name and value")) and list_3f(_3fast)) then
          if (1 == #_3fast) then
            table.insert(_3fast, sym("_"))
            local function _357_()
              return table.remove(_3fast)
            end
            table.insert(defer, _357_)
          else
          end
          if (2 == #_3fast) then
            table.insert(_3fast, nil_2a)
            local function _359_()
              return table.remove(_3fast)
            end
            table.insert(defer, _359_)
          else
          end
          or_349_ = (3 == #_3fast)
        else
          or_349_ = nil
        end
      end
      return or_349_
    end
    local function on_compile_error(_, msg, ast, call_me_to_reset_the_compiler)
      if (nil == call_me_to_reset_the_compiler) then
        _G.error("Missing argument call-me-to-reset-the-compiler on /fennel-ls/src/fennel-ls/compiler.fnl:317", 2)
      else
      end
      if (nil == ast) then
        _G.error("Missing argument ast on /fennel-ls/src/fennel-ls/compiler.fnl:317", 2)
      else
      end
      if (nil == msg) then
        _G.error("Missing argument msg on /fennel-ls/src/fennel-ls/compiler.fnl:317", 2)
      else
      end
      do
        local range = (message["ast->range"](server, file, ast) or message["unknown-range"])
        table.insert(compile_diagnostics, {range = range, message = msg, severity = message.severity.ERROR, code = "compiler-error"})
      end
      if attempt_to_recover_21(msg, ast) then
        return true
      else
        call_me_to_reset_the_compiler()
        return error("__NOT_AN_ERROR")
      end
    end
    local function on_parse_error(msg, _filename, line, byte, _source, call_me_to_reset_the_compiler)
      if (nil == call_me_to_reset_the_compiler) then
        _G.error("Missing argument call-me-to-reset-the-compiler on /fennel-ls/src/fennel-ls/compiler.fnl:331", 2)
      else
      end
      if (nil == byte) then
        _G.error("Missing argument byte on /fennel-ls/src/fennel-ls/compiler.fnl:331", 2)
      else
      end
      if (nil == line) then
        _G.error("Missing argument line on /fennel-ls/src/fennel-ls/compiler.fnl:331", 2)
      else
      end
      if (nil == msg) then
        _G.error("Missing argument msg on /fennel-ls/src/fennel-ls/compiler.fnl:331", 2)
      else
      end
      do
        local line0
        if (line == "?") then
          line0 = 1
        else
          line0 = line
        end
        local range = line_2bbyte__3erange(server, file, line0, byte)
        table.insert(compile_diagnostics, {range = range, message = msg, severity = message.severity.ERROR, code = "parse-error"})
      end
      if attempt_to_recover_21(msg) then
        return true
      else
        call_me_to_reset_the_compiler()
        return error("__NOT_AN_ERROR")
      end
    end
    local function warn(msg, _3fast, _file, _3fline, _3fcol)
      if (nil == msg) then
        _G.error("Missing argument msg on /fennel-ls/src/fennel-ls/compiler.fnl:345", 2)
      else
      end
      local range = (message["ast->range"](server, file, _3fast) or line_2bbyte__3erange(server, file, (_3fline or 1), (_3fcol or 0)))
      return table.insert(compile_diagnostics, {range = range, message = msg, severity = message.severity.WARN, code = "compiler-warning"})
    end
    local macro_file_3f = (file.uri:match("%.fnlm$") or (file.text:sub(1, 24) == ";; fennel-ls: macro-file"))
    local allowed_globals
    if macro_file_3f then
      allowed_globals = compiler_globals
    else
      local tbl_24_ = docs["get-all-globals"](server)
      for extra_global in server.configuration["extra-globals"]:gmatch("[^ ]+") do
        local val_25_ = extra_global
        table.insert(tbl_24_, val_25_)
      end
      allowed_globals = tbl_24_
    end
    local plugin = {name = "fennel-ls", versions = {"1.4.1", "1.4.2", "1.5.0", "1.5.1", "1.5.3", "1.5.4", "1.6.0", "1.6.1"}, ["symbol-to-expression"] = symbol_to_expression, call = call, destructure = destructure, macroexpand = macroexpand, ["assert-compile"] = on_compile_error, ["parse-error"] = on_parse_error, ["pre-for"] = compile_for, ["pre-each"] = compile_each, ["pre-fn"] = compile_fn, ["pre-do"] = compile_do}
    local scope
    local function _374_()
      if macro_file_3f then
        return compiler_scope
      else
        return nil
      end
    end
    scope = fennel.scope(_374_())
    local opts = {filename = file.uri, plugins = {plugin}, allowedGlobals = allowed_globals, useMetadata = true, useBitLib = not (_G.loadstring or _G.load)("return 1&1"), scope = scope, ["compiler-env"] = compiler_env, warn = warn, requireAsInclude = false}
    local filter_errors
    local function _filter_errors(component, ...)
      local case_375_, case_376_, case_377_ = ...
      if ((case_375_ == true) and true and true) then
        local _3fitem1 = case_376_
        local _3fitem2 = case_377_
        return _3fitem1, _3fitem2
      else
        local matched_3f_378_, err_379_
        local and_380_ = ((case_375_ == nil) and (nil ~= case_376_))
        if and_380_ then
          local err = case_376_
          and_380_ = not err:find("^[^\n]-__NOT_AN_ERROR\n")
        end
        if and_380_ then
          local err = case_376_
          matched_3f_378_, err_379_ = true, err
        else
          local and_382_ = ((case_375_ == false) and (nil ~= case_376_))
          if and_382_ then
            local err = case_376_
            and_382_ = not err:find("^[^\n]-__NOT_AN_ERROR\n")
          end
          if and_382_ then
            local err = case_376_
            matched_3f_378_, err_379_ = true, err
          else
            matched_3f_378_, err_379_ = nil
          end
        end
        if matched_3f_378_ then
          local err = err_379_
          if os.getenv("DEV") then
            return error(("\nYou have crashed fennel-ls (or the fennel " .. component .. ") with the following message\n:" .. err .. "\n\n^^^ the error message above here is the root problem\n\n"))
          else
            return table.insert(compile_diagnostics, {range = line_2bbyte__3erange(server, file, 1, 1), message = ("unrecoverable " .. component .. " error: " .. err)})
          end
        else
          return nil
        end
      end
    end
    filter_errors = _filter_errors
    local parser
    do
      local p = fennel.parser(file.text, file.uri, opts)
      local function _p1(p2, p3)
        local function _388_()
          return p(p2, p3)
        end
        return filter_errors("parser", xpcall(_388_, fennel.traceback))
      end
      parser = _p1
    end
    local ast
    do
      local tbl_26_ = {}
      local i_27_ = 0
      for ok, ast0 in parser do
        if not ok then break end
        local val_28_ = ast0
        if (nil ~= val_28_) then
          i_27_ = (i_27_ + 1)
          tbl_26_[i_27_] = val_28_
        else
        end
      end
      ast = tbl_26_
    end
    local function traverse(ast0)
      if (nil == ast0) then
        _G.error("Missing argument ast on /fennel-ls/src/fennel-ls/compiler.fnl:403", 2)
      else
      end
      if sym_3f(ast0) then
        local case_391_, case_392_ = tostring(ast0), file.text:sub(ast0.bytestart, ast0.bytestart)
        if ((case_391_ == "hashfn") and (case_392_ == "#")) then
          local function _393_()
            ast0.byteend = ast0.bytestart
            return nil
          end
          table.insert(defer, _393_)
        elseif (((case_391_ == "quote") and (case_392_ == "'")) or ((case_391_ == "quote") and (case_392_ == "`"))) then
          local function _394_()
            ast0.byteend = ast0.bytestart
            return nil
          end
          table.insert(defer, _394_)
        elseif ((case_391_ == "unquote") and (case_392_ == ",")) then
          local function _395_()
            ast0.byteend = ast0.bytestart
            return nil
          end
          table.insert(defer, _395_)
        else
        end
      else
      end
      if (table_3f(ast0) or list_3f(ast0) or sym_3f(ast0) or varg_3f(ast0)) then
        lexical[ast0] = true
      else
      end
      if (table_3f(ast0) or list_3f(ast0)) then
        for k, v in iter(ast0) do
          traverse(k)
          traverse(v)
        end
      else
      end
      if (list_3f(ast0) and (sym_3f(ast0[1], "\206\187") or sym_3f(ast0[1], "lambda"))) then
        local old_sym = ast0[1]
        ast0[1] = sym("fn")
        local function _400_()
          ast0[1] = old_sym
          return nil
        end
        return table.insert(defer, _400_)
      else
        return nil
      end
    end
    traverse(ast)
    if _3froot_uri then
      local old_macro_path = fennel["macro-path"]
      fennel["macro-path"] = searcher["add-workspaces-to-path"](macro_path, {_3froot_uri})
      local function _402_()
        fennel["macro-path"] = old_macro_path
        return nil
      end
      table.insert(defer, _402_)
    else
    end
    local function _404_()
      return 
    end
    _G.print = _404_
    local function _405_()
      _G.print = print
      return nil
    end
    table.insert(defer, _405_)
    for _i, form in ipairs(ast) do
      local function _406_()
        local limiting_3f = (server.configuration["compiler-instruction-limit"] ~= -1)
        if limiting_3f then
          local function hook()
            debug.sethook(nil, nil)
            if _G.jit then
              _G.jit.on()
            else
            end
            table.insert(compile_diagnostics, {range = message["unknown-range"], message = "instruction limit reached", severity = message.severity.ERROR})
            return error("__NOT_AN_ERROR")
          end
          if _G.jit then
            _G.jit.off()
          else
          end
          debug.sethook(hook, "", server.configuration["compiler-instruction-limit"])
        else
        end
        fennel.compile(form, opts)
        if limiting_3f then
          debug.sethook(nil, nil)
          if _G.jit then
            return _G.jit.on()
          else
            return nil
          end
        else
          return nil
        end
      end
      filter_errors("compiler", xpcall(_406_, fennel.traceback))
    end
    for _, cmd in ipairs(defer) do
      cmd()
    end
    do
      local module = ast[#ast]
      local module0
      if sym_3f(module) then
        local t_412_ = references
        if (nil ~= t_412_) then
          t_412_ = t_412_[module]
        else
        end
        if (nil ~= t_412_) then
          t_412_ = t_412_.target
        else
        end
        if (nil ~= t_412_) then
          t_412_ = t_412_.definition
        else
        end
        module0 = t_412_
      else
        module0 = module
      end
      if table_3f(module0) then
        file.module = module0
      else
        file.module = nil
      end
    end
    file["macro-file?"] = macro_file_3f
    file.ast = ast
    file.calls = calls
    file.lexical = lexical
    file.scope = scope
    file.scopes = scopes
    file.definitions = definitions
    file["definitions-by-scope"] = definitions_by_scope
    file["multi-binds"] = multi_binds
    file["compile-errors"] = compile_diagnostics
    file.references = references
    file["require-calls"] = require_calls
    file["allowed-globals"] = allowed_globals
    file["macro-refs"] = macro_refs
    file["macro-calls"] = macro_calls
    return nil
  end
  local function compile(server, file)
    if not file.ast then
      return do_compile(server, file)
    else
      return nil
    end
  end
  return {compile = compile}
end
package.preload["fennel-ls.message"] = package.preload["fennel-ls.message"] or function(...)
  local fennel = require("fennel")
  local utils = require("fennel-ls.utils")
  local json = require("dkjson")
  local function nullify(_3fvalue)
    if (_3fvalue == nil) then
      return json.null
    elseif (nil ~= _3fvalue) then
      local v = _3fvalue
      return v
    else
      return nil
    end
  end
  local error_codes = {ParseError = -32700, InvalidRequest = -32600, MethodNotFound = -32601, InvalidParams = -32602, InternalError = -32603, ServerNotInitialized = -32002, UnknownErrorCode = -32001, RequestFailed = -32803, ServerCancelled = -32802, ContentModified = -32801, RequestCancelled = -32800}
  local severity = {ERROR = 1, WARN = 2, INFO = 3, HINT = 4}
  local severity__3estring
  do
    local tbl_21_ = {}
    for k, v in pairs(severity) do
      local k_22_, v_23_
      local function _179_(...)
        if (k == "WARN") then
          return "warning"
        else
          local _ = k
          return string.lower(k)
        end
      end
      k_22_, v_23_ = v, _179_(...)
      if ((k_22_ ~= nil) and (v_23_ ~= nil)) then
        tbl_21_[k_22_] = v_23_
      else
      end
    end
    severity__3estring = tbl_21_
  end
  local symbol_kind = {File = 1, Module = 2, Namespace = 3, Package = 4, Class = 5, Method = 6, Property = 7, Field = 8, Constructor = 9, Enum = 10, Interface = 11, Function = 12, Variable = 13, Constant = 14, String = 15, Number = 16, Boolean = 17, Array = 18, Object = 19, Key = 20, Null = 21, EnumMember = 22, Struct = 23, Event = 24, Operator = 25, TypeParameter = 26}
  local function create_error(code, message, _3fid, _3fdata)
    if (nil == message) then
      _G.error("Missing argument message on /fennel-ls/src/fennel-ls/message.fnl:52", 2)
    else
    end
    if (nil == code) then
      _G.error("Missing argument code on /fennel-ls/src/fennel-ls/message.fnl:52", 2)
    else
    end
    return {jsonrpc = "2.0", id = _3fid, error = {code = (error_codes[code] or code), data = _3fdata, message = message}}
  end
  local function create_request(id, method, _3fparams)
    if (nil == method) then
      _G.error("Missing argument method on /fennel-ls/src/fennel-ls/message.fnl:59", 2)
    else
    end
    if (nil == id) then
      _G.error("Missing argument id on /fennel-ls/src/fennel-ls/message.fnl:59", 2)
    else
    end
    return {jsonrpc = "2.0", id = id, method = method, params = _3fparams}
  end
  local function create_notification(method, _3fparams)
    if (nil == method) then
      _G.error("Missing argument method on /fennel-ls/src/fennel-ls/message.fnl:65", 2)
    else
    end
    return {jsonrpc = "2.0", method = method, params = _3fparams}
  end
  local function create_response(id, _3fresult)
    if (nil == id) then
      _G.error("Missing argument id on /fennel-ls/src/fennel-ls/message.fnl:70", 2)
    else
    end
    return {jsonrpc = "2.0", id = id, result = nullify(_3fresult)}
  end
  local unknown_range = {start = {line = 0, character = 0}, ["end"] = {line = 0, character = 0}}
  local function ast__3erange(server, file, _3fast)
    if (nil == file) then
      _G.error("Missing argument file on /fennel-ls/src/fennel-ls/message.fnl:78", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/message.fnl:78", 2)
    else
    end
    local case_189_ = fennel["ast-source"](_3fast)
    if ((_G.type(case_189_) == "table") and (nil ~= case_189_.bytestart) and (nil ~= case_189_.byteend)) then
      local bytestart = case_189_.bytestart
      local byteend = case_189_.byteend
      return {start = utils["byte->position"](file.text, bytestart, server["position-encoding"]), ["end"] = utils["byte->position"](file.text, (byteend + 1), server["position-encoding"])}
    else
      return nil
    end
  end
  local function diagnostic__3ecode_action(_server, _191_, diagnostic, _3fkind)
    local uri = _191_.uri
    if (nil == diagnostic) then
      _G.error("Missing argument diagnostic on /fennel-ls/src/fennel-ls/message.fnl:85", 2)
    else
    end
    if (nil == uri) then
      _G.error("Missing argument uri on /fennel-ls/src/fennel-ls/message.fnl:85", 2)
    else
    end
    local function _194_(...)
      local case_195_ = ...
      if (nil ~= case_195_) then
        local fix = case_195_
        local function _196_(...)
          local case_197_ = ...
          if ((_G.type(case_197_) == "table") and (nil ~= case_197_.title) and (nil ~= case_197_.changes)) then
            local title = case_197_.title
            local changes = case_197_.changes
            return {title = title, kind = _3fkind, diagnostics = {diagnostic}, edit = {changes = {[uri] = changes}}}
          else
            local __43_ = case_197_
            return ...
          end
        end
        return _196_(fix())
      else
        local __43_ = case_195_
        return ...
      end
    end
    return _194_(diagnostic.fix)
  end
  local function call__3esignature_help(_server, _file, _call, signature, active_parameter)
    if (nil == active_parameter) then
      _G.error("Missing argument active-parameter on /fennel-ls/src/fennel-ls/message.fnl:93", 2)
    else
    end
    if (nil == signature) then
      _G.error("Missing argument signature on /fennel-ls/src/fennel-ls/message.fnl:93", 2)
    else
    end
    local params_count = #signature.parameters
    local _202_
    if (params_count <= active_parameter) then
      _202_ = (params_count - 1)
    elseif (0 <= active_parameter) then
      _202_ = active_parameter
    else
      _202_ = nil
    end
    return {signatures = {signature}, activeSignature = 0, activeParameter = _202_}
  end
  local function multisym__3erange(server, file, ast, n)
    if (nil == n) then
      _G.error("Missing argument n on /fennel-ls/src/fennel-ls/message.fnl:102", 2)
    else
    end
    if (nil == ast) then
      _G.error("Missing argument ast on /fennel-ls/src/fennel-ls/message.fnl:102", 2)
    else
    end
    if (nil == file) then
      _G.error("Missing argument file on /fennel-ls/src/fennel-ls/message.fnl:102", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/message.fnl:102", 2)
    else
    end
    local spl = utils["multi-sym-split"](ast)
    local case_208_, case_209_ = utils["get-ast-info"](ast, "bytestart"), utils["get-ast-info"](ast, "byteend")
    if ((nil ~= case_208_) and (nil ~= case_209_)) then
      local bytestart = case_208_
      local byteend = case_209_
      local bytesubstart
      do
        local b = bytestart
        for i = 1, (n - 1) do
          b = (b + #spl[i] + 1)
        end
        bytesubstart = b
      end
      local bytesubend
      do
        local b = byteend
        for i = (n + 1), #spl do
          b = (b - #spl[i] - 1)
        end
        bytesubend = b
      end
      return {start = utils["byte->position"](file.text, bytesubstart, server["position-encoding"]), ["end"] = utils["byte->position"](file.text, (bytesubend + 1), server["position-encoding"])}
    else
      return nil
    end
  end
  local function range_and_uri(server, _211_, _3fast)
    local uri = _211_.uri
    local file = _211_
    if (nil == file) then
      _G.error("Missing argument file on /fennel-ls/src/fennel-ls/message.fnl:116", 2)
    else
    end
    if (nil == uri) then
      _G.error("Missing argument uri on /fennel-ls/src/fennel-ls/message.fnl:116", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/message.fnl:116", 2)
    else
    end
    local case_215_ = ast__3erange(server, file, _3fast)
    if (nil ~= case_215_) then
      local range = case_215_
      return {range = range, uri = uri}
    else
      return nil
    end
  end
  local function diagnostics(file)
    if (nil == file) then
      _G.error("Missing argument file on /fennel-ls/src/fennel-ls/message.fnl:121", 2)
    else
    end
    return create_notification("textDocument/publishDiagnostics", {uri = file.uri, diagnostics = file.diagnostics})
  end
  local function show_message(message, msg_type)
    if (nil == msg_type) then
      _G.error("Missing argument msg-type on /fennel-ls/src/fennel-ls/message.fnl:127", 2)
    else
    end
    if (nil == message) then
      _G.error("Missing argument message on /fennel-ls/src/fennel-ls/message.fnl:127", 2)
    else
    end
    return create_notification("window/showMessage", {type = severity[msg_type], message = message})
  end
  local function definition__3esymbol_kind(definition)
    if (nil == definition) then
      _G.error("Missing argument definition on /fennel-ls/src/fennel-ls/message.fnl:133", 2)
    else
    end
    local def = definition.definition
    if fennel["list?"](def) then
      local head = def[1]
      if (fennel["sym?"](head, "fn") or fennel["sym?"](head, "lambda") or fennel["sym?"](head, "\206\187")) then
        return symbol_kind.Function
      else
        return symbol_kind.Variable
      end
    else
      return symbol_kind.Variable
    end
  end
  local function document_symbol_format(server, file, symbols)
    if (nil == symbols) then
      _G.error("Missing argument symbols on /fennel-ls/src/fennel-ls/message.fnl:144", 2)
    else
    end
    if (nil == file) then
      _G.error("Missing argument file on /fennel-ls/src/fennel-ls/message.fnl:144", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/message.fnl:144", 2)
    else
    end
    local symbols0
    do
      local tbl_26_ = {}
      local i_27_ = 0
      for _, _226_ in ipairs(symbols) do
        local symbol = _226_.symbol
        local definition = _226_.definition
        local val_28_
        do
          local name = tostring(symbol)
          local kind = definition__3esymbol_kind(definition)
          local range = ast__3erange(server, file, definition.binding)
          if range then
            val_28_ = {name = name, kind = kind, range = range, selectionRange = range}
          else
            val_28_ = nil
          end
        end
        if (nil ~= val_28_) then
          i_27_ = (i_27_ + 1)
          tbl_26_[i_27_] = val_28_
        else
        end
      end
      symbols0 = tbl_26_
    end
    local function _229_(a, b)
      return ((a.range.start.line < b.range.start.line) or ((a.range.start.line == b.range.start.line) and (a.range.start.character < b.range.start.character)))
    end
    table.sort(symbols0, _229_)
    return symbols0
  end
  return {["create-notification"] = create_notification, ["create-request"] = create_request, ["create-response"] = create_response, ["create-error"] = create_error, ["ast->range"] = ast__3erange, ["diagnostic->code-action"] = diagnostic__3ecode_action, ["call->signature-help"] = call__3esignature_help, ["multisym->range"] = multisym__3erange, ["range-and-uri"] = range_and_uri, diagnostics = diagnostics, severity = severity, ["severity->string"] = severity__3estring, ["show-message"] = show_message, ["unknown-range"] = unknown_range, ["document-symbol-format"] = document_symbol_format, ["symbol-kind"] = symbol_kind}
end
package.preload["dkjson"] = package.preload["dkjson"] or function(...)
  -- Module options:
  local always_use_lpeg = false
  local register_global_module_table = false
  local global_module_name = 'json'
  
  --[==[
  
  David Kolf's JSON module for Lua 5.1 - 5.5
  
  Version 2.9
  
  
  For the documentation see the corresponding readme.txt or visit
  <http://dkolf.de/dkjson-lua/>.
  
  You can contact the author by sending an e-mail to 'david' at the
  domain 'dkolf.de'.
  
  
  Copyright (C) 2010-2026 David Heiko Kolf
  
  Permission is hereby granted, free of charge, to any person obtaining
  a copy of this software and associated documentation files (the
  "Software"), to deal in the Software without restriction, including
  without limitation the rights to use, copy, modify, merge, publish,
  distribute, sublicense, and/or sell copies of the Software, and to
  permit persons to whom the Software is furnished to do so, subject to
  the following conditions:
  
  The above copyright notice and this permission notice shall be
  included in all copies or substantial portions of the Software.
  
  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
  EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
  MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
  NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS
  BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
  ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
  CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  SOFTWARE.
  
  --]==]
  
  -- global dependencies:
  local pairs, type, tostring, tonumber, getmetatable, setmetatable =
        pairs, type, tostring, tonumber, getmetatable, setmetatable
  local error, require, pcall, select = error, require, pcall, select
  local floor, huge = math.floor, math.huge
  local strrep, gsub, strsub, strbyte, strchar, strfind, strlen, strformat =
        string.rep, string.gsub, string.sub, string.byte, string.char,
        string.find, string.len, string.format
  local strmatch = string.match
  local concat = table.concat
  
  local json = { version = "dkjson 2.9" }
  
  local jsonlpeg = {}
  
  if register_global_module_table then
    if always_use_lpeg then
      _G[global_module_name] = jsonlpeg
    else
      _G[global_module_name] = json
    end
  end
  
  local _ENV = nil -- blocking globals in Lua 5.2 and later
  
  pcall (function()
    -- Enable access to blocked metatables.
    -- Don't worry, this module doesn't change anything in them.
    local debmeta = require "debug".getmetatable
    if debmeta then getmetatable = debmeta end
  end)
  
  json.null = setmetatable ({}, {
    __tojson = function () return "null" end
  })
  
  local function isarray (tbl)
    local max, n, arraylen = 0, 0, 0
    for k,v in pairs (tbl) do
      if k == 'n' and type(v) == 'number' then
        arraylen = v
        if v > max then
          max = v
        end
      else
        if type(k) ~= 'number' or k < 1 or floor(k) ~= k then
          return false
        end
        if k > max then
          max = k
        end
        n = n + 1
      end
    end
    if max > 10 and max > arraylen and max > n * 2 then
      return false -- don't create an array with too many holes
    end
    return true, max
  end
  
  local escapecodes = {
    ["\""] = "\\\"", ["\\"] = "\\\\", ["\b"] = "\\b", ["\f"] = "\\f",
    ["\n"] = "\\n",  ["\r"] = "\\r",  ["\t"] = "\\t"
  }
  
  local function escapeutf8 (uchar)
    local value = escapecodes[uchar]
    if value then
      return value
    end
    local a, b, c, d = strbyte (uchar, 1, 4)
    a, b, c, d = a or 0, b or 0, c or 0, d or 0
    if a <= 0x7f then
      value = a
    elseif 0xc0 <= a and a <= 0xdf and b >= 0x80 then
      value = (a - 0xc0) * 0x40 + b - 0x80
    elseif 0xe0 <= a and a <= 0xef and b >= 0x80 and c >= 0x80 then
      value = ((a - 0xe0) * 0x40 + b - 0x80) * 0x40 + c - 0x80
    elseif 0xf0 <= a and a <= 0xf7 and b >= 0x80 and c >= 0x80 and d >= 0x80 then
      value = (((a - 0xf0) * 0x40 + b - 0x80) * 0x40 + c - 0x80) * 0x40 + d - 0x80
    else
      return ""
    end
    if value <= 0xffff then
      return strformat ("\\u%.4x", value)
    elseif value <= 0x10ffff then
      -- encode as UTF-16 surrogate pair
      value = value - 0x10000
      local highsur, lowsur = 0xD800 + floor (value/0x400), 0xDC00 + (value % 0x400)
      return strformat ("\\u%.4x\\u%.4x", highsur, lowsur)
    else
      return ""
    end
  end
  
  local function fsub (str, pattern, repl)
    -- gsub always builds a new string in a buffer, even when no match
    -- exists. First using find should be more efficient when most strings
    -- don't contain the pattern.
    if strfind (str, pattern) then
      return gsub (str, pattern, repl)
    else
      return str
    end
  end
  
  local function quotestring (value)
    -- based on the regexp "escapable" in https://github.com/douglascrockford/JSON-js
    value = fsub (value, "[%z\1-\31\"\\\127]", escapeutf8)
    if strfind (value, "[\194\216\220\225\226\239]") then
      value = fsub (value, "\194[\128-\159\173]", escapeutf8)
      value = fsub (value, "\216[\128-\132]", escapeutf8)
      value = fsub (value, "\220\143", escapeutf8)
      value = fsub (value, "\225\158[\180\181]", escapeutf8)
      value = fsub (value, "\226\128[\140-\143\168-\175]", escapeutf8)
      value = fsub (value, "\226\129[\160-\175]", escapeutf8)
      value = fsub (value, "\239\187\191", escapeutf8)
      value = fsub (value, "\239\191[\176-\191]", escapeutf8)
    end
    return "\"" .. value .. "\""
  end
  json.quotestring = quotestring
  
  local function replace(str, o, n)
    local i, j = strfind (str, o, 1, true)
    if i then
      return strsub(str, 1, i-1) .. n .. strsub(str, j+1, -1)
    else
      return str
    end
  end
  
  -- locale independent num2str and str2num functions
  local decpoint, numfilter
  
  local function updatedecpoint ()
    decpoint = strmatch(tostring(0.5), "([^05+])")
    -- build a filter that can be used to remove group separators
    numfilter = "[^0-9%-%+eE" .. gsub(decpoint, "[%^%$%(%)%%%.%[%]%*%+%-%?]", "%%%0") .. "]+"
  end
  
  updatedecpoint()
  
  local function num2str (num)
    return replace(fsub(tostring(num), numfilter, ""), decpoint, ".")
  end
  
  local function str2num (str)
    local num = tonumber(replace(str, ".", decpoint))
    if not num then
      updatedecpoint()
      num = tonumber(replace(str, ".", decpoint))
    end
    return num
  end
  
  local function addnewline2 (level, buffer, buflen)
    buffer[buflen+1] = "\n"
    buffer[buflen+2] = strrep ("  ", level)
    buflen = buflen + 2
    return buflen
  end
  
  function json.addnewline (state)
    if state.indent then
      state.bufferlen = addnewline2 (state.level or 0,
                             state.buffer, state.bufferlen or #(state.buffer))
    end
  end
  
  local encode2 -- forward declaration
  
  local function addpair (key, value, prev, indent, level, buffer, buflen, tables, globalorder, state)
    local kt = type (key)
    if kt ~= 'string' and kt ~= 'number' then
      return nil, "type '" .. kt .. "' is not supported as a key by JSON."
    end
    if prev then
      buflen = buflen + 1
      buffer[buflen] = ","
    end
    if indent then
      buflen = addnewline2 (level, buffer, buflen)
    end
    -- When Lua is compiled with LUA_NOCVTN2S this will fail when
    -- numbers are mixed into the keys of the table. JSON keys are always
    -- strings, so this would be an implicit conversion too and the failure
    -- is intentional.
    buffer[buflen+1] = quotestring (key)
    buffer[buflen+2] = ":"
    return encode2 (value, indent, level, buffer, buflen + 2, tables, globalorder, state)
  end
  
  local function appendcustom(res, buffer, state)
    local buflen = state.bufferlen
    if type (res) == 'string' then
      buflen = buflen + 1
      buffer[buflen] = res
    end
    return buflen
  end
  
  local function exception(reason, value, state, buffer, buflen, defaultmessage)
    defaultmessage = defaultmessage or reason
    local handler = state.exception
    if not handler then
      return nil, defaultmessage
    else
      state.bufferlen = buflen
      local ret, msg = handler (reason, value, state, defaultmessage)
      if not ret then return nil, msg or defaultmessage end
      return appendcustom(ret, buffer, state)
    end
  end
  
  function json.encodeexception(reason, value, state, defaultmessage)
    return quotestring("<" .. defaultmessage .. ">")
  end
  
  encode2 = function (value, indent, level, buffer, buflen, tables, globalorder, state)
    local valtype = type (value)
    local valmeta = getmetatable (value)
    valmeta = type (valmeta) == 'table' and valmeta -- only tables
    local valtojson = valmeta and valmeta.__tojson
    if valtojson then
      if tables[value] then
        return exception('reference cycle', value, state, buffer, buflen)
      end
      tables[value] = true
      state.bufferlen = buflen
      local ret, msg = valtojson (value, state)
      if not ret then return exception('custom encoder failed', value, state, buffer, buflen, msg) end
      tables[value] = nil
      buflen = appendcustom(ret, buffer, state)
    elseif value == nil then
      buflen = buflen + 1
      buffer[buflen] = "null"
    elseif valtype == 'number' then
      local s
      if value ~= value or value >= huge or -value >= huge then
        -- This is the behaviour of the original JSON implementation.
        s = "null"
      else
        s = num2str (value)
      end
      buflen = buflen + 1
      buffer[buflen] = s
    elseif valtype == 'boolean' then
      buflen = buflen + 1
      buffer[buflen] = value and "true" or "false"
    elseif valtype == 'string' then
      buflen = buflen + 1
      buffer[buflen] = quotestring (value)
    elseif valtype == 'table' then
      if tables[value] then
        return exception('reference cycle', value, state, buffer, buflen)
      end
      tables[value] = true
      level = level + 1
      local isa, n = isarray (value)
      if n == 0 and valmeta and valmeta.__jsontype == 'object' then
        isa = false
      end
      local msg
      if isa then -- JSON array
        buflen = buflen + 1
        buffer[buflen] = "["
        for i = 1, n do
          buflen, msg = encode2 (value[i], indent, level, buffer, buflen, tables, globalorder, state)
          if not buflen then return nil, msg end
          if i < n then
            buflen = buflen + 1
            buffer[buflen] = ","
          end
        end
        buflen = buflen + 1
        buffer[buflen] = "]"
      else -- JSON object
        local prev = false
        buflen = buflen + 1
        buffer[buflen] = "{"
        local order = valmeta and valmeta.__jsonorder or globalorder
        if order then
          local used = {}
          n = #order
          for i = 1, n do
            local k = order[i]
            local v = value[k]
            if v ~= nil then
              used[k] = true
              buflen, msg = addpair (k, v, prev, indent, level, buffer, buflen, tables, globalorder, state)
              if not buflen then return nil, msg end
              prev = true -- add a seperator before the next element
            end
          end
          for k,v in pairs (value) do
            if not used[k] then
              buflen, msg = addpair (k, v, prev, indent, level, buffer, buflen, tables, globalorder, state)
              if not buflen then return nil, msg end
              prev = true -- add a seperator before the next element
            end
          end
        else -- unordered
          for k,v in pairs (value) do
            buflen, msg = addpair (k, v, prev, indent, level, buffer, buflen, tables, globalorder, state)
            if not buflen then return nil, msg end
            prev = true -- add a seperator before the next element
          end
        end
        if indent then
          buflen = addnewline2 (level - 1, buffer, buflen)
        end
        buflen = buflen + 1
        buffer[buflen] = "}"
      end
      tables[value] = nil
    else
      return exception ('unsupported type', value, state, buffer, buflen,
        "type '" .. valtype .. "' is not supported by JSON.")
    end
    return buflen
  end
  
  function json.encode (value, state)
    state = state or {}
    local oldbuffer = state.buffer
    local buffer = oldbuffer or {}
    state.buffer = buffer
    updatedecpoint()
    local ret, msg = encode2 (value, state.indent, state.level or 0,
                     buffer, state.bufferlen or 0, state.tables or {}, state.keyorder, state)
    if not ret then
      error (msg, 2)
    elseif oldbuffer == buffer then
      state.bufferlen = ret
      return true
    else
      state.bufferlen = nil
      state.buffer = nil
      return concat (buffer)
    end
  end
  
  local function loc (str, where)
    local line, pos, linepos = 1, 1, 0
    while true do
      pos = strfind (str, "\n", pos, true)
      if pos and pos < where then
        line = line + 1
        linepos = pos
        pos = pos + 1
      else
        break
      end
    end
    return strformat ("line %d, column %d", line, where - linepos)
  end
  
  local function unterminated (str, what, where)
    return nil, strlen (str) + 1, "unterminated " .. what .. " at " .. loc (str, where)
  end
  
  local function scanwhite (str, pos)
    while true do
      pos = strmatch (str, "%s*()", pos)
      local n1, n2, n3 = strbyte (str, pos, pos + 2)
      if n1 == 239 and n2 == 187 and n3 == 191 then
        -- UTF-8 Byte Order Mark
        pos = pos + 3
      elseif n1 == 47 then
        if n2 == 47 then -- "//"
          pos = strfind (str, "[\n\r]", pos + 2)
          if not pos then return nil end
        elseif n2 == 42 then -- "/*"
          pos = strfind (str, "*/", pos + 2)
          if not pos then return nil end
          pos = pos + 2
        end
      elseif n1 == nil then
        return nil
      else
        return pos, n1
      end
    end
  end
  
  local escapechars = {
    ["\""] = "\"", ["\\"] = "\\", ["/"] = "/", ["b"] = "\b", ["f"] = "\f",
    ["n"] = "\n", ["r"] = "\r", ["t"] = "\t"
  }
  
  local function unichar (value)
    if value < 0 then
      return nil
    elseif value <= 0x007f then
      return strchar (value)
    elseif value <= 0x07ff then
      return strchar (0xc0 + floor(value/0x40),
                      0x80 + (floor(value) % 0x40))
    elseif value <= 0xffff then
      return strchar (0xe0 + floor(value/0x1000),
                      0x80 + (floor(value/0x40) % 0x40),
                      0x80 + (floor(value) % 0x40))
    elseif value <= 0x10ffff then
      return strchar (0xf0 + floor(value/0x40000),
                      0x80 + (floor(value/0x1000) % 0x40),
                      0x80 + (floor(value/0x40) % 0x40),
                      0x80 + (floor(value) % 0x40))
    else
      return nil
    end
  end
  
  local function scanstring (str, pos)
    local lastpos = pos + 1
    local buffer, n = {}, 0
    while true do
      local nextpos = strfind (str, "[\"\\]", lastpos)
      if not nextpos then
        return unterminated (str, "string", pos)
      end
      if nextpos > lastpos then
        n = n + 1
        buffer[n] = strsub (str, lastpos, nextpos - 1)
      end
      if strbyte (str, nextpos) == 34 then -- '"'
        lastpos = nextpos + 1
        break
      else
        local escchar = strsub (str, nextpos + 1, nextpos + 1)
        local value
        if escchar == "u" then
          value = tonumber (strsub (str, nextpos + 2, nextpos + 5), 16)
          if value then
            local value2
            if 0xD800 <= value and value <= 0xDBff then
              -- we have the high surrogate of UTF-16. Check if there is a
              -- low surrogate escaped nearby to combine them.
              if strsub (str, nextpos + 6, nextpos + 7) == "\\u" then
                value2 = tonumber (strsub (str, nextpos + 8, nextpos + 11), 16)
                if value2 and 0xDC00 <= value2 and value2 <= 0xDFFF then
                  value = (value - 0xD800)  * 0x400 + (value2 - 0xDC00) + 0x10000
                else
                  value2 = nil -- in case it was out of range for a low surrogate
                end
              end
            end
            value = value and unichar (value)
            if value then
              if value2 then
                lastpos = nextpos + 12
              else
                lastpos = nextpos + 6
              end
            end
          end
        end
        if not value then
          value = escapechars[escchar] or escchar
          lastpos = nextpos + 2
        end
        n = n + 1
        buffer[n] = value
      end
    end
    if n == 1 then
      return buffer[1], lastpos
    elseif n > 1 then
      return concat (buffer), lastpos
    else
      return "", lastpos
    end
  end
  
  local scanvalue -- forward declaration
  
  local function scanobject (str, startpos, nullval, objectmeta, arraymeta)
    local tbl = setmetatable ({}, objectmeta)
    local pos = startpos + 1
  
    while true do
      local char
      pos, char = scanwhite (str, pos)
      local key, err
      if char == 34 then -- '"'
        key, pos, err = scanstring (str, pos)
      elseif char == 125 then -- "}"
        return tbl, pos + 1
      elseif not pos then
        return unterminated (str, "object", startpos)
      else
        return nil, pos, "invalid key at " .. loc (str, pos)
      end
      if err then return nil, pos, err end
  
      char = strbyte (str, pos)
      if char ~= 58 then -- ":"
        pos, char = scanwhite (str, pos)
        if char ~= 58 then
          return nil, pos, "missing colon at " .. loc (str, pos)
        end
      end
  
      pos = scanwhite (str, pos + 1)
      if not pos then return unterminated (str, "object", startpos) end
      local val
      val, pos, err = scanvalue (str, pos, nullval, objectmeta, arraymeta)
      if err then return nil, pos, err end
      tbl[key] = val
  
      char = strbyte (str, pos)
      if char == 44 then -- ","
        pos = pos + 1
      else
        pos, char = scanwhite (str, pos)
  
        if char == 44 then
          pos = pos + 1
        elseif not pos then
          return unterminated (str, "object", startpos)
        end
      end
    end
  end
  
  local function scanarray (str, startpos, nullval, objectmeta, arraymeta)
    local tbl, n = setmetatable ({}, arraymeta), 0
    local pos = startpos + 1
  
    while true do
      local char
      pos, char = scanwhite (str, pos)
  
      if char == 93 then -- "]"
        return tbl, pos + 1
      elseif not pos then
        return unterminated (str, "array", startpos)
      end
  
      local val, err
      val, pos, err = scanvalue (str, pos, nullval, objectmeta, arraymeta)
      if err then return nil, pos, err end
      n = n + 1
      tbl[n] = val
  
      char = strbyte (str, pos)
      if char == 44 then -- ","
        pos = pos + 1
      else
        pos, char = scanwhite (str, pos)
  
        if char == 44 then
          pos = pos + 1
        elseif not pos then
          return unterminated (str, "array", startpos)
        end
      end
    end
  end
  
  local function scaninvalid (str, pos)
    return nil, pos, "no valid JSON value at " .. loc (str, pos)
  end
  
  local function scanliteral (str, pos, expected, value)
    local pstart, pend = strfind (str, "^%a%w*", pos)
    local name = strsub (str, pstart, pend)
    if name == expected then
      return value, pend + 1
    else
      return scaninvalid (str, pos)
    end
  end
  
  local function scannumber (str, pos)
    local pstart, pend = strfind (str, "^%-?[%d%.]*[eE]?[%+%-]?%d*", pos)
    local number = str2num (strsub (str, pstart, pend))
    if number then
      return number, pend + 1
    else
      return scaninvalid (str, pos)
    end
  end
  
  scanvalue = function (str, pos, nullval, objectmeta, arraymeta)
    pos = pos or 1
    local c
    pos, c = scanwhite (str, pos)
  
    if c == 34 then -- '"'
      return scanstring (str, pos)
    elseif c == 123 then -- "{"
      return scanobject (str, pos, nullval, objectmeta, arraymeta)
    elseif c == 91 then -- "["
      return scanarray (str, pos, nullval, objectmeta, arraymeta)
    elseif c == 45 or (c >= 48 and c <= 57) then -- "-", "0"..."9"
      return scannumber (str, pos)
    elseif c == 116 then -- "t"
      return scanliteral (str, pos, "true", true)
    elseif c == 102 then -- "f"
      return scanliteral (str, pos, "false", false)
    elseif c == 110 then -- "n"
      return scanliteral (str, pos, "null", nullval)
    elseif not pos then
      return nil, strlen (str) + 1, "no valid JSON value (reached the end)"
    else
      return scaninvalid (str, pos)
    end
  end
  
  local function optionalmetatables(...)
    if select("#", ...) > 0 then
      return ...
    else
      return {__jsontype = 'object'}, {__jsontype = 'array'}
    end
  end
  
  function json.decode (str, pos, nullval, ...)
    local objectmeta, arraymeta = optionalmetatables(...)
    return scanvalue (str, pos, nullval, objectmeta, arraymeta)
  end
  
  function json.use_lpeg ()
    local g = require ("lpeg")
  
    if type(g.version) == 'function' and g.version() == "0.11" then
      error "due to a bug in LPeg 0.11, it cannot be used for JSON matching"
    end
  
    local pegmatch = g.match
    local P, S, R = g.P, g.S, g.R
  
    local function ErrorCall (str, pos, msg, state)
      if not state.msg then
        state.msg = msg .. " at " .. loc (str, pos)
        state.pos = pos
      end
      return false
    end
  
    local function Err (msg)
      return g.Cmt (g.Cc (msg) * g.Carg (2), ErrorCall)
    end
  
    local function ErrorUnterminatedCall (str, pos, what, state)
      return ErrorCall (str, pos - 1, "unterminated " .. what, state)
    end
  
    local SingleLineComment = P"//" * (1 - S"\n\r")^0
    local MultiLineComment = P"/*" * (1 - P"*/")^0 * P"*/"
    local Space = (S" \n\r\t" + P"\239\187\191" + SingleLineComment + MultiLineComment)^0
  
    local function ErrUnterminated (what)
      return g.Cmt (g.Cc (what) * g.Carg (2), ErrorUnterminatedCall)
    end
  
    local PlainChar = 1 - S"\"\\\n\r"
    local EscapeSequence = (P"\\" * g.C (S"\"\\/bfnrt" + Err "unsupported escape sequence")) / escapechars
    local HexDigit = R("09", "af", "AF")
    local function UTF16Surrogate (match, pos, high, low)
      high, low = tonumber (high, 16), tonumber (low, 16)
      if 0xD800 <= high and high <= 0xDBff and 0xDC00 <= low and low <= 0xDFFF then
        return true, unichar ((high - 0xD800)  * 0x400 + (low - 0xDC00) + 0x10000)
      else
        return false
      end
    end
    local function UTF16BMP (hex)
      return unichar (tonumber (hex, 16))
    end
    local U16Sequence = (P"\\u" * g.C (HexDigit * HexDigit * HexDigit * HexDigit))
    local UnicodeEscape = g.Cmt (U16Sequence * U16Sequence, UTF16Surrogate) + U16Sequence/UTF16BMP
    local Char = UnicodeEscape + EscapeSequence + PlainChar
    local String = P"\"" * (g.Cs (Char ^ 0) * P"\"" + ErrUnterminated "string")
    local Integer = P"-"^(-1) * (P"0" + (R"19" * R"09"^0))
    local Fractal = P"." * R"09"^0
    local Exponent = (S"eE") * (S"+-")^(-1) * R"09"^1
    local Number = (Integer * Fractal^(-1) * Exponent^(-1))/str2num
    local Constant = P"true" * g.Cc (true) + P"false" * g.Cc (false) + P"null" * g.Carg (1)
    local SimpleValue = Number + String + Constant
    local ArrayContent, ObjectContent
  
    -- The functions parsearray and parseobject parse only a single value/pair
    -- at a time and store them directly to avoid hitting the LPeg limits.
    local function parsearray (str, pos, nullval, state)
      local obj, cont
      local start = pos
      local npos
      local t, nt = {}, 0
      repeat
        obj, cont, npos = pegmatch (ArrayContent, str, pos, nullval, state)
        if cont == 'end' then
          return ErrorUnterminatedCall (str, start, "array", state)
        end
        pos = npos
        if cont == 'cont' or cont == 'last' then
          nt = nt + 1
          t[nt] = obj
        end
      until cont ~= 'cont'
      return pos, setmetatable (t, state.arraymeta)
    end
  
    local function parseobject (str, pos, nullval, state)
      local obj, key, cont
      local start = pos
      local npos
      local t = {}
      repeat
        key, obj, cont, npos = pegmatch (ObjectContent, str, pos, nullval, state)
        if cont == 'end' then
          return ErrorUnterminatedCall (str, start, "object", state)
        end
        pos = npos
        if cont == 'cont' or cont == 'last' then
          t[key] = obj
        end
      until cont ~= 'cont'
      return pos, setmetatable (t, state.objectmeta)
    end
  
    local Array = P"[" * g.Cmt (g.Carg(1) * g.Carg(2), parsearray)
    local Object = P"{" * g.Cmt (g.Carg(1) * g.Carg(2), parseobject)
    local Value = Space * (Array + Object + SimpleValue)
    local ExpectedValue = Value + Space * Err "value expected"
    local ExpectedKey = String + Err "key expected"
    local End = P(-1) * g.Cc'end'
    local ErrInvalid = Err "invalid JSON"
    ArrayContent = (Value * Space * (P"," * g.Cc'cont' + P"]" * g.Cc'last'+ End + ErrInvalid)  + g.Cc(nil) * (P"]" * g.Cc'empty' + End  + ErrInvalid)) * g.Cp()
    local Pair = g.Cg (Space * ExpectedKey * Space * (P":" + Err "colon expected") * ExpectedValue)
    ObjectContent = (g.Cc(nil) * g.Cc(nil) * P"}" * g.Cc'empty' + End + (Pair * Space * (P"," * g.Cc'cont' + P"}" * g.Cc'last' + End + ErrInvalid) + ErrInvalid)) * g.Cp()
    local DecodeValue = ExpectedValue * g.Cp ()
  
    jsonlpeg.version = json.version
    jsonlpeg.encode = json.encode
    jsonlpeg.null = json.null
    jsonlpeg.quotestring = json.quotestring
    jsonlpeg.addnewline = json.addnewline
    jsonlpeg.encodeexception = json.encodeexception
    jsonlpeg.using_lpeg = true
  
    function jsonlpeg.decode (str, pos, nullval, ...)
      local state = {}
      state.objectmeta, state.arraymeta = optionalmetatables(...)
      local obj, retpos = pegmatch (DecodeValue, str, pos, nullval, state)
      if state.msg then
        return nil, state.pos, state.msg
      else
        return obj, retpos
      end
    end
  
    -- cache result of this function:
    json.use_lpeg = function () return jsonlpeg end
    jsonlpeg.use_lpeg = json.use_lpeg
  
    return jsonlpeg
  end
  
  if always_use_lpeg then
    return json.use_lpeg()
  end
  
  return json
end
package.preload["fennel-ls.navigate"] = package.preload["fennel-ls.navigate"] or function(...)
  local docs = require("fennel-ls.docs")
  local analyzer = require("fennel-ls.analyzer")
  local fennel = require("fennel")
  local function iter_fields(server, definition)
    if (nil == definition) then
      _G.error("Missing argument definition on /fennel-ls/src/fennel-ls/navigate.fnl:5", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/navigate.fnl:5", 2)
    else
    end
    local function _578_()
      if (type(definition.definition) == "string") then
        for key, value in pairs(docs["get-global"](server, nil, "string").fields) do
          if ((type(key) == "string") or (type(key) == "number")) then
            coroutine.yield(key, value, true)
          else
          end
        end
        return nil
      else
        if fennel["table?"](definition.definition) then
          for key, value in pairs(definition.definition) do
            if ((type(key) == "string") or (type(key) == "number")) then
              local value0 = analyzer.search(server, definition.file, value, {}, {})
              if value0 then
                coroutine.yield(key, value0)
              else
                do local _ = definition.fields end
              end
            else
            end
          end
        else
        end
        if definition.fields then
          for key, value in pairs(definition.fields) do
            if ((type(key) == "string") or (type(key) == "number")) then
              coroutine.yield(key, value)
            else
            end
          end
          return nil
        else
          return nil
        end
      end
    end
    return coroutine.wrap(_578_)
  end
  local function has_fields(server_, definition)
    if (nil == definition) then
      _G.error("Missing argument definition on /fennel-ls/src/fennel-ls/navigate.fnl:25", 2)
    else
    end
    if (nil == server_) then
      _G.error("Missing argument server_ on /fennel-ls/src/fennel-ls/navigate.fnl:25", 2)
    else
    end
    return ((type(definition.definition) == "string") or fennel["table?"](definition.definition) or definition.fields)
  end
  local function _get_field(server, definition, key)
    if (nil == key) then
      _G.error("Missing argument key on /fennel-ls/src/fennel-ls/navigate.fnl:30", 2)
    else
    end
    if (nil == definition) then
      _G.error("Missing argument definition on /fennel-ls/src/fennel-ls/navigate.fnl:30", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/navigate.fnl:30", 2)
    else
    end
    local fields
    local or_591_ = definition.fields
    if not or_591_ then
      if (type(definition.definition) == "string") then
        or_591_ = docs["get-global"](server, nil, "string").fields
      else
        or_591_ = nil
      end
    end
    fields = or_591_
    local _594_
    do
      local t_593_ = fields
      if (nil ~= t_593_) then
        t_593_ = t_593_[key]
      else
      end
      _594_ = t_593_
    end
    local or_596_ = _594_
    if not or_596_ then
      if fennel["table?"](definition.definition) then
        or_596_ = analyzer.search(server, definition.file, definition.definition, {}, {stack = {key}})
      else
        or_596_ = nil
      end
    end
    return or_596_
  end
  local function getmetadata(server_, definition)
    if (nil == definition) then
      _G.error("Missing argument definition on /fennel-ls/src/fennel-ls/navigate.fnl:38", 2)
    else
    end
    if (nil == server_) then
      _G.error("Missing argument server_ on /fennel-ls/src/fennel-ls/navigate.fnl:38", 2)
    else
    end
    local or_600_ = definition.metadata
    if not or_600_ then
      local metadata
      if fennel["list?"](definition.definition) then
        local case_602_, case_603_, case_604_ = definition.definition
        local matched_3f_605_, _3fdocstring_606_, _3fname_607_, arglist_608_, fn_2a_609_
        local and_610_ = ((_G.type(case_602_) == "table") and (nil ~= case_602_[1]) and true and (nil ~= case_602_[3]) and true and (nil ~= case_602_[5]))
        if and_610_ then
          local fn_2a = case_602_[1]
          local _3fname = case_602_[2]
          local arglist = case_602_[3]
          local _3fdocstring = case_602_[4]
          local body_ = case_602_[5]
          and_610_ = ((fennel["sym?"](fn_2a, "fn") or fennel["sym?"](fn_2a, "\206\187") or fennel["sym?"](fn_2a, "lambda")) and ((_3fname == nil) or fennel["sym?"](_3fname)) and fennel["sequence?"](arglist) and ((_3fdocstring == nil) or ("string" == type(_3fdocstring))))
        end
        if and_610_ then
          local fn_2a = case_602_[1]
          local _3fname = case_602_[2]
          local arglist = case_602_[3]
          local _3fdocstring = case_602_[4]
          local body_ = case_602_[5]
          matched_3f_605_, _3fdocstring_606_, _3fname_607_, arglist_608_, fn_2a_609_ = true, _3fdocstring, _3fname, arglist, fn_2a
        else
          local and_612_ = (((_G.type(case_602_) == "table") and (nil ~= case_602_[1]) and true and (nil ~= case_602_[3])) and true)
          if and_612_ then
            local fn_2a = case_602_[1]
            local _3fname = case_602_[2]
            local arglist = case_602_[3]
            local _3fdocstring = case_603_
            and_612_ = ((fennel["sym?"](fn_2a, "fn") or fennel["sym?"](fn_2a, "\206\187") or fennel["sym?"](fn_2a, "lambda")) and ((_3fname == nil) or fennel["sym?"](_3fname)) and fennel["sequence?"](arglist) and ((_3fdocstring == nil) or ("string" == type(_3fdocstring))))
          end
          if and_612_ then
            local fn_2a = case_602_[1]
            local _3fname = case_602_[2]
            local arglist = case_602_[3]
            local _3fdocstring = case_603_
            matched_3f_605_, _3fdocstring_606_, _3fname_607_, arglist_608_, fn_2a_609_ = true, _3fdocstring, _3fname, arglist, fn_2a
          else
            local and_614_ = (((_G.type(case_602_) == "table") and (nil ~= case_602_[1]) and (nil ~= case_602_[2]) and true and (nil ~= case_602_[4])) and true)
            if and_614_ then
              local fn_2a = case_602_[1]
              local arglist = case_602_[2]
              local _3fdocstring = case_602_[3]
              local body_ = case_602_[4]
              local _3fname = case_603_
              and_614_ = ((fennel["sym?"](fn_2a, "fn") or fennel["sym?"](fn_2a, "\206\187") or fennel["sym?"](fn_2a, "lambda")) and ((_3fname == nil) or fennel["sym?"](_3fname)) and fennel["sequence?"](arglist) and ((_3fdocstring == nil) or ("string" == type(_3fdocstring))))
            end
            if and_614_ then
              local fn_2a = case_602_[1]
              local arglist = case_602_[2]
              local _3fdocstring = case_602_[3]
              local body_ = case_602_[4]
              local _3fname = case_603_
              matched_3f_605_, _3fdocstring_606_, _3fname_607_, arglist_608_, fn_2a_609_ = true, _3fdocstring, _3fname, arglist, fn_2a
            else
              local and_616_ = (((_G.type(case_602_) == "table") and (nil ~= case_602_[1]) and (nil ~= case_602_[2])) and true and true)
              if and_616_ then
                local fn_2a = case_602_[1]
                local arglist = case_602_[2]
                local _3fname = case_603_
                local _3fdocstring = case_604_
                and_616_ = ((fennel["sym?"](fn_2a, "fn") or fennel["sym?"](fn_2a, "\206\187") or fennel["sym?"](fn_2a, "lambda")) and ((_3fname == nil) or fennel["sym?"](_3fname)) and fennel["sequence?"](arglist) and ((_3fdocstring == nil) or ("string" == type(_3fdocstring))))
              end
              if and_616_ then
                local fn_2a = case_602_[1]
                local arglist = case_602_[2]
                local _3fname = case_603_
                local _3fdocstring = case_604_
                matched_3f_605_, _3fdocstring_606_, _3fname_607_, arglist_608_, fn_2a_609_ = true, _3fdocstring, _3fname, arglist, fn_2a
              else
                matched_3f_605_, _3fdocstring_606_, _3fname_607_, arglist_608_, fn_2a_609_ = nil
              end
            end
          end
        end
        if matched_3f_605_ then
          local _3fdocstring, _3fname, arglist, fn_2a = _3fdocstring_606_, _3fname_607_, arglist_608_, fn_2a_609_
          metadata = {["fls/itemKind"] = "Function", ["fls/fntype"] = tostring(fn_2a), ["fnl/arglist"] = arglist, ["fnl/docstring"] = _3fdocstring}
        else
          metadata = nil
        end
      else
        metadata = nil
      end
      definition.metadata = metadata
      or_600_ = metadata
    end
    return or_600_
  end
  return {["_get-field"] = _get_field, ["iter-fields"] = iter_fields, ["has-fields"] = has_fields, getmetadata = getmetadata}
end
package.preload["fennel-ls.config"] = package.preload["fennel-ls.config"] or function(...)
  local files = require("fennel-ls.files")
  local docs = require("fennel-ls.docs")
  local utils = require("fennel-ls.utils")
  local lint = require("fennel-ls.lint")
  local message = require("fennel-ls.message")
  local _local_782_ = require("fennel")
  local view = _local_782_.view
  local fennel = _local_782_
  local _local_783_ = require("fennel-ls.uri")
  local path__3euri = _local_783_["path->uri"]
  local uri__3epath = _local_783_["uri->path"]
  local option_mt = {}
  local function option(default_value, _3fvalidate)
    return setmetatable({["default-value"] = default_value, validate = _3fvalidate}, option_mt)
  end
  local default_configuration
  local _784_
  do
    local tbl_21_ = {}
    for _, lint0 in ipairs(lint.list) do
      local k_22_, v_23_ = lint0.name, option(not lint0.disabled)
      if ((k_22_ ~= nil) and (v_23_ ~= nil)) then
        tbl_21_[k_22_] = v_23_
      else
      end
    end
    _784_ = tbl_21_
  end
  default_configuration = {["fennel-path"] = option("./?.fnl;./?/init.fnl;src/?.fnl;src/?/init.fnl"), ["macro-path"] = option(table.concat({"./?.fnlm", "./?/init.fnlm", "./?.fnl", "./?/init-macros.fnl", "./?/init.fnl", "src/?.fnlm", "src/?/init.fnlm", "src/?.fnl", "src/?/init-macros.fnl", "src/?/init.fnl"}, ";")), ["lua-version"] = option("lua54", docs["validate-lua-version"]), lints = _784_, libraries = option({}, docs["validate-libraries"]), ["compiler-instruction-limit"] = option(-1), plugins = option({}), ["extra-globals"] = option("")}
  local function extend_path(_3froot, extra)
    if (type(extra) ~= "string") then
      return _3froot
    elseif _3froot then
      return (_3froot .. "." .. extra)
    else
      return extra
    end
  end
  local function copy(t)
    local tbl_21_ = {}
    for k, v in pairs(t) do
      local k_22_, v_23_ = k, v
      if ((k_22_ ~= nil) and (v_23_ ~= nil)) then
        tbl_21_[k_22_] = v_23_
      else
      end
    end
    return tbl_21_
  end
  local function select_keys(t, ...)
    local tbl_21_ = {}
    for _, k in ipairs({...}) do
      local k_22_, v_23_ = k, t[k]
      if ((k_22_ ~= nil) and (v_23_ ~= nil)) then
        tbl_21_[k_22_] = v_23_
      else
      end
    end
    return tbl_21_
  end
  local function safe_require(module_name)
    local modules = {["fennel-ls.message"] = require("fennel-ls.message"), ["fennel-ls.analyzer"] = require("fennel-ls.analyzer"), fennel = select_keys(require("fennel"), "sym?", "list?", "table?", "varg?", "sequence?", "sym-char?", "gensym", "ast-source", "multi-sym?", "view", "sym", "list")}
    return assert(modules[module_name], ("module not found: " .. module_name))
  end
  local function safe_env()
    local g
    local _789_
    do
      local tmp_3_ = rawget(_G, "utf8")
      if (nil ~= tmp_3_) then
        _789_ = copy(tmp_3_)
      else
        _789_ = nil
      end
    end
    g = {table = copy(table), math = copy(math), string = copy(string), pairs = pairs, ipairs = ipairs, select = select, tostring = tostring, tonumber = tonumber, bit = rawget(_G, "bit"), pcall = pcall, xpcall = xpcall, next = next, print = print, type = type, assert = assert, error = error, _VERSION = _VERSION, utf8 = _789_, require = safe_require}
    g._G = g
    return g
  end
  local function load_plugins(_3fplugins)
    if _3fplugins then
      for _, plugin_path in ipairs(_3fplugins) do
        local plugin = fennel.dofile(plugin_path, {env = safe_env()})
        for name, l in pairs((plugin.lints or {})) do
          lint["add-lint"](name, l)
        end
      end
      do
        local tbl_21_ = {}
        for _, lint0 in ipairs(lint.list) do
          local k_22_, v_23_ = lint0.name, option(not lint0.disabled)
          if ((k_22_ ~= nil) and (v_23_ ~= nil)) then
            tbl_21_[k_22_] = v_23_
          else
          end
        end
        default_configuration.lints = tbl_21_
      end
      return nil
    else
      return nil
    end
  end
  local function apply_default_configuration(default, _3fflsproject, _3fparent, _3fname, invalid)
    if (getmetatable(default) == option_mt) then
      local setting
      local function _793_(...)
        local case_794_ = ...
        if (case_794_ == nil) then
          local function _795_(...)
            local case_796_ = ...
            if (case_796_ == nil) then
              return default["default-value"]
            else
              local __43_ = case_796_
              return ...
            end
          end
          local function _799_(...)
            local t_798_ = _3fparent
            if (nil ~= t_798_) then
              t_798_ = t_798_.all
            else
            end
            return t_798_
          end
          return _795_(_799_(...))
        else
          local __43_ = case_794_
          return ...
        end
      end
      setting = _793_(_3fflsproject)
      if (type(setting) ~= type(default["default-value"])) then
        invalid(((_3fname or "flsproject.fnl") .. " must be a " .. type(default["default-value"])), _3fflsproject, _3fparent)
        return default["default-value"]
      elseif default.validate then
        local function _802_(...)
          local case_803_ = ...
          if (case_803_ == nil) then
            return default["default-value"]
          else
            local __43_ = case_803_
            return ...
          end
        end
        local function _805_(_241)
          return invalid(_241, _3fflsproject, _3fparent)
        end
        return _802_(default.validate(setting, _805_))
      else
        return setting
      end
    elseif ("table" == type(default)) then
      local case_807_ = type(_3fflsproject)
      if ((case_807_ == "table") or (case_807_ == "nil")) then
        if (type(_3fflsproject) == "table") then
          for k in pairs(_3fflsproject) do
            if not default[k] then
              local function _809_()
                local tmp_9_
                do
                  local tbl_26_ = {}
                  local i_27_ = 0
                  for k0 in pairs(default) do
                    local val_28_ = k0
                    if (nil ~= val_28_) then
                      i_27_ = (i_27_ + 1)
                      tbl_26_[i_27_] = val_28_
                    else
                    end
                  end
                  tmp_9_ = tbl_26_
                end
                table.sort(tmp_9_)
                return tmp_9_
              end
              invalid(("didn't expect " .. (extend_path(_3fname, k) or "flsproject.fnl") .. "\n" .. "valid keys: " .. view(_809_())), _3fflsproject[k], _3fflsproject)
            else
            end
          end
        else
        end
        local tbl_21_ = {}
        for k in pairs(default) do
          local k_22_, v_23_
          local _813_
          do
            local t_812_ = _3fflsproject
            if (nil ~= t_812_) then
              t_812_ = t_812_[k]
            else
            end
            _813_ = t_812_
          end
          k_22_, v_23_ = k, apply_default_configuration(default[k], _813_, _3fflsproject, extend_path(_3fname, k), invalid)
          if ((k_22_ ~= nil) and (v_23_ ~= nil)) then
            tbl_21_[k_22_] = v_23_
          else
          end
        end
        return tbl_21_
      else
        local _ = case_807_
        invalid(("expected " .. (_3fname or "flsproject.fnl") .. " to be a table"), _3fflsproject, _3fparent)
        return apply_default_configuration(default, nil, _3fparent, _3fname, invalid)
      end
    else
      return error(("This is a bug with fennel-ls: default-configuration has a key that isn't a table or option: " .. _3fname))
    end
  end
  local function make_configuration(_3fflsproject, invalid)
    if (nil == invalid) then
      _G.error("Missing argument invalid on /fennel-ls/src/fennel-ls/config.fnl:114", 2)
    else
    end
    local function _820_()
      local t_819_ = _3fflsproject
      if (nil ~= t_819_) then
        t_819_ = t_819_.plugins
      else
      end
      return t_819_
    end
    load_plugins(_820_())
    return apply_default_configuration(default_configuration, _3fflsproject, nil, nil, invalid)
  end
  local function choose_position_encoding(init_params)
    if (nil == init_params) then
      _G.error("Missing argument init-params on /fennel-ls/src/fennel-ls/config.fnl:118", 2)
    else
    end
    local _3fposition_encodings
    do
      local t_823_ = init_params
      if (nil ~= t_823_) then
        t_823_ = t_823_.capabilities
      else
      end
      if (nil ~= t_823_) then
        t_823_ = t_823_.general
      else
      end
      if (nil ~= t_823_) then
        t_823_ = t_823_.positionEncodings
      else
      end
      _3fposition_encodings = t_823_
    end
    local utf8_3f
    if (type(_3fposition_encodings) == "table") then
      local utf_8_3f = false
      for _, encoding in ipairs(_3fposition_encodings) do
        if utf_8_3f then break end
        utf_8_3f = ((encoding == "utf-8") or (encoding == "utf8"))
      end
      utf8_3f = utf_8_3f
    else
      utf8_3f = false
    end
    if utf8_3f then
      return "utf-8"
    else
      return "utf-16"
    end
  end
  local function flsproject_path(server)
    local tmp_3_ = server["root-uri"]
    if (nil ~= tmp_3_) then
      local tmp_3_0 = uri__3epath(tmp_3_)
      if (nil ~= tmp_3_0) then
        local tmp_3_1 = utils["path-join"](tmp_3_0, (server["config-path"] or "flsproject.fnl"))
        if (nil ~= tmp_3_1) then
          return path__3euri(tmp_3_1)
        else
          return nil
        end
      else
        return nil
      end
    else
      return nil
    end
  end
  local function reload(server, _3fconfig)
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/config.fnl:140", 2)
    else
    end
    for k in pairs(fennel["macro-loaded"]) do
      fennel["macro-loaded"][k] = nil
    end
    local or_833_ = _3fconfig
    if not or_833_ then
      local function _834_(...)
        local case_835_ = ...
        if (nil ~= case_835_) then
          local path = case_835_
          local function _836_(...)
            local case_837_ = ...
            if ((_G.type(case_837_) == "table") and (nil ~= case_837_.text) and (nil ~= case_837_.uri)) then
              local text = case_837_.text
              local uri = case_837_.uri
              local case_838_, case_839_, case_840_ = pcall(fennel.parser(text, uri))
              if ((case_838_ == true) and true and (nil ~= case_840_)) then
                local _ = case_839_
                local result = case_840_
                return result
              else
                return nil
              end
            else
              local _ = case_837_
              return nil
            end
          end
          return _836_(files["read-file"](server, path))
        else
          local _ = case_835_
          return nil
        end
      end
      or_833_ = _834_(flsproject_path(server))
    end
    local function _844_(_241)
      return table.insert(server.queue, message["show-message"](_241, "WARN"))
    end
    server.configuration = make_configuration(or_833_, _844_)
    return nil
  end
  local function initialize(server, params)
    if (nil == params) then
      _G.error("Missing argument params on /fennel-ls/src/fennel-ls/config.fnl:157", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/config.fnl:157", 2)
    else
    end
    server.queue = {}
    server.files = {}
    server["files-pending-lint"] = {}
    server.modules = {}
    server["macro-modules"] = {}
    server["root-uri"] = params.rootUri
    server["position-encoding"] = choose_position_encoding(params)
    do
      local case_847_
      do
        local t_848_ = params
        if (nil ~= t_848_) then
          t_848_ = t_848_.capabilities
        else
        end
        if (nil ~= t_848_) then
          t_848_ = t_848_.textDocument
        else
        end
        if (nil ~= t_848_) then
          t_848_ = t_848_.completion
        else
        end
        if (nil ~= t_848_) then
          t_848_ = t_848_.completionList
        else
        end
        if (nil ~= t_848_) then
          t_848_ = t_848_.itemDefaults
        else
        end
        case_847_ = t_848_
      end
      if (nil ~= case_847_) then
        local completion_item_defaults = case_847_
        local _854_
        do
          local found = nil
          for _, v in ipairs(completion_item_defaults) do
            if found then break end
            found = (v == "editRange")
          end
          _854_ = found
        end
        local and_855_ = _854_
        if and_855_ then
          local found = nil
          for _, v in ipairs(completion_item_defaults) do
            if found then break end
            found = (v == "data")
          end
          and_855_ = found
        end
        server["client-capable-of-good-completions?"] = and_855_
      else
        server["client-capable-of-good-completions?"] = nil
      end
    end
    do
      local t_857_ = params
      if (nil ~= t_857_) then
        t_857_ = t_857_.capabilities
      else
      end
      if (nil ~= t_857_) then
        t_857_ = t_857_.textDocument
      else
      end
      if (nil ~= t_857_) then
        t_857_ = t_857_.completion
      else
      end
      if (nil ~= t_857_) then
        t_857_ = t_857_.completionItem
      else
      end
      if (nil ~= t_857_) then
        t_857_ = t_857_.insertReplaceSupport
      else
      end
      server["client-capable-of-insert-replace-completions?"] = t_857_
    end
    local _864_
    do
      local t_863_ = params
      if (nil ~= t_863_) then
        t_863_ = t_863_.capabilities
      else
      end
      if (nil ~= t_863_) then
        t_863_ = t_863_.textDocument
      else
      end
      if (nil ~= t_863_) then
        t_863_ = t_863_.diagnostic
      else
      end
      _864_ = t_863_
    end
    local or_868_ = _864_
    if not or_868_ then
      local _870_
      do
        local t_869_ = params
        if (nil ~= t_869_) then
          t_869_ = t_869_.capabilities
        else
        end
        if (nil ~= t_869_) then
          t_869_ = t_869_.textDocument
        else
        end
        if (nil ~= t_869_) then
          t_869_ = t_869_.publishDiagnostics
        else
        end
        _870_ = t_869_
      end
      or_868_ = not _870_
    end
    server["client-capable-of-pull-diagnostics?"] = or_868_
    return reload(server)
  end
  return {initialize = initialize, reload = reload, ["make-configuration"] = make_configuration, ["flsproject-path"] = flsproject_path}
end
package.preload["fennel-ls.formatter"] = package.preload["fennel-ls.formatter"] or function(...)
  local _local_874_ = require("fennel")
  local sym_3f = _local_874_["sym?"]
  local view = _local_874_.view
  local table_3f = _local_874_["table?"]
  local varg_3f = _local_874_["varg?"]
  local list_3f = _local_874_["list?"]
  local navigate = require("fennel-ls.navigate")
  local function code_block(str)
    if (nil == str) then
      _G.error("Missing argument str on /fennel-ls/src/fennel-ls/formatter.fnl:14", 2)
    else
    end
    return ("```fnl\n" .. str .. "\n```")
  end
  local unview_mt
  local function _876_(_241)
    return _241.value
  end
  unview_mt = {__fennelview = _876_}
  local function unview(value)
    return setmetatable({value = value}, unview_mt)
  end
  local function render_arg(arg)
    if (nil == arg) then
      _G.error("Missing argument arg on /fennel-ls/src/fennel-ls/formatter.fnl:22", 2)
    else
    end
    if table_3f(arg) then
      local _878_
      do
        local tbl_21_ = {}
        for k, v in pairs(arg) do
          local k_22_, v_23_ = k, unview(render_arg(v))
          if ((k_22_ ~= nil) and (v_23_ ~= nil)) then
            tbl_21_[k_22_] = v_23_
          else
          end
        end
        _878_ = tbl_21_
      end
      local function _880_(_241, _242, _243)
        if (_241 == _242) then
          return (": " .. _242 .. _243)
        else
          return nil
        end
      end
      return (view(_878_, {["one-line?"] = true, ["prefer-colon?"] = true}):gsub(":([%w?_-]+) ([%w?_-]+)([ }])", _880_))
    else
      return tostring(arg)
    end
  end
  local function fn_signature_format(special, _3fname, args)
    local function render_arglist(arglist, offset)
      local offset0 = offset
      local tbl_26_ = {}
      local i_27_ = 0
      for _, arg in ipairs(arglist) do
        local val_28_
        do
          local rendered = {label = {offset0, (offset0 + #arg)}}
          offset0 = (1 + rendered.label[2])
          val_28_ = rendered
        end
        if (nil ~= val_28_) then
          i_27_ = (i_27_ + 1)
          tbl_26_[i_27_] = val_28_
        else
        end
      end
      return tbl_26_
    end
    local name = tostring((_3fname or special))
    local args0
    do
      local case_884_
      local function _886_()
        local t_885_ = args
        if (nil ~= t_885_) then
          t_885_ = t_885_[1]
        else
        end
        return t_885_
      end
      case_884_ = type(_886_())
      if (case_884_ == "table") then
        local tbl_26_ = {}
        local i_27_ = 0
        for _, v in ipairs(args) do
          local val_28_ = render_arg(v)
          if (nil ~= val_28_) then
            i_27_ = (i_27_ + 1)
            tbl_26_[i_27_] = val_28_
          else
          end
        end
        args0 = tbl_26_
      else
        local _ = case_884_
        args0 = args
      end
    end
    local args_offset = (2 + #name)
    return ("(" .. name .. " " .. table.concat(args0, " ") .. ")"), render_arglist(args0, args_offset)
  end
  local function fn_3f(symbol)
    if (nil == symbol) then
      _G.error("Missing argument symbol on /fennel-ls/src/fennel-ls/formatter.fnl:67", 2)
    else
    end
    if sym_3f(symbol) then
      local name = tostring(symbol)
      return ((name == "fn") or (name == "\206\187") or (name == "lambda"))
    else
      return nil
    end
  end
  local function analyze_fn(_3fast)
    local and_892_ = ((_G.type(_3fast) == "table") and (nil ~= _3fast[1]) and (nil ~= _3fast[2]) and (nil ~= _3fast[3]) and (nil ~= _3fast[4]) and (nil ~= _3fast[5]))
    if and_892_ then
      local fntype = _3fast[1]
      local name = _3fast[2]
      local arglist = _3fast[3]
      local docstring = _3fast[4]
      local body = _3fast[5]
      and_892_ = (body and fn_3f(fntype) and sym_3f(name) and (type(arglist) == "table") and (type(docstring) == "string"))
    end
    if and_892_ then
      local fntype = _3fast[1]
      local name = _3fast[2]
      local arglist = _3fast[3]
      local docstring = _3fast[4]
      local body = _3fast[5]
      return {fntype = fntype, name = name, arglist = arglist, docstring = docstring}
    else
      local and_894_ = ((_G.type(_3fast) == "table") and (nil ~= _3fast[1]) and (nil ~= _3fast[2]) and (nil ~= _3fast[3]) and (nil ~= _3fast[4]))
      if and_894_ then
        local fntype = _3fast[1]
        local arglist = _3fast[2]
        local docstring = _3fast[3]
        local body = _3fast[4]
        and_894_ = (body and fn_3f(fntype) and (type(arglist) == "table") and (type(docstring) == "string"))
      end
      if and_894_ then
        local fntype = _3fast[1]
        local arglist = _3fast[2]
        local docstring = _3fast[3]
        local body = _3fast[4]
        return {fntype = fntype, arglist = arglist, docstring = docstring}
      else
        local and_896_ = ((_G.type(_3fast) == "table") and (nil ~= _3fast[1]) and (nil ~= _3fast[2]) and (nil ~= _3fast[3]))
        if and_896_ then
          local fntype = _3fast[1]
          local name = _3fast[2]
          local arglist = _3fast[3]
          and_896_ = (fn_3f(fntype) and sym_3f(name) and (type(arglist) == "table"))
        end
        if and_896_ then
          local fntype = _3fast[1]
          local name = _3fast[2]
          local arglist = _3fast[3]
          return {fntype = fntype, name = name, arglist = arglist}
        else
          local and_898_ = ((_G.type(_3fast) == "table") and (nil ~= _3fast[1]) and (nil ~= _3fast[2]))
          if and_898_ then
            local fntype = _3fast[1]
            local arglist = _3fast[2]
            and_898_ = (fn_3f(fntype) and (type(arglist) == "table"))
          end
          if and_898_ then
            local fntype = _3fast[1]
            local arglist = _3fast[2]
            return {fntype = fntype, arglist = arglist}
          else
            return nil
          end
        end
      end
    end
  end
  local function signature_help_format(doc_or_definition)
    if (nil == doc_or_definition) then
      _G.error("Missing argument doc-or-definition on /fennel-ls/src/fennel-ls/formatter.fnl:109", 2)
    else
    end
    local function _902_(...)
      local case_903_ = ...
      if ((_G.type(case_903_) == "table") and true and true and true and true) then
        local _3ffntype = case_903_.fntype
        local _3fname = case_903_.name
        local _3farglist = case_903_.arglist
        local _3fdocstring = case_903_.docstring
        local function _904_(...)
          local case_905_, case_906_ = ...
          if ((nil ~= case_905_) and (nil ~= case_906_)) then
            local signature = case_905_
            local parameters = case_906_
            return {label = signature, documentation = _3fdocstring, parameters = parameters}
          else
            local _ = case_905_
            local function _907_(...)
              local case_908_ = ...
              if ((_G.type(case_908_) == "table") and (nil ~= case_908_.binding) and ((_G.type(case_908_.metadata) == "table") and (nil ~= case_908_.metadata["fnl/arglist"]) and (nil ~= case_908_.metadata["fnl/docstring"]))) then
                local binding = case_908_.binding
                local arglist = case_908_.metadata["fnl/arglist"]
                local docstring = case_908_.metadata["fnl/docstring"]
                local function _909_(...)
                  local case_910_, case_911_ = ...
                  if ((nil ~= case_910_) and (nil ~= case_911_)) then
                    local signature = case_910_
                    local parameters = case_911_
                    return {label = signature, documentation = docstring, parameters = parameters}
                  else
                    local _0 = case_910_
                    return nil
                  end
                end
                return _909_(fn_signature_format("", binding, arglist))
              else
                local _0 = case_908_
                return nil
              end
            end
            return _907_(doc_or_definition)
          end
        end
        return _904_(fn_signature_format(_3ffntype, _3fname, _3farglist))
      else
        local _ = case_903_
        local function _915_(...)
          local case_916_ = ...
          if ((_G.type(case_916_) == "table") and (nil ~= case_916_.binding) and ((_G.type(case_916_.metadata) == "table") and (nil ~= case_916_.metadata["fnl/arglist"]) and (nil ~= case_916_.metadata["fnl/docstring"]))) then
            local binding = case_916_.binding
            local arglist = case_916_.metadata["fnl/arglist"]
            local docstring = case_916_.metadata["fnl/docstring"]
            local function _917_(...)
              local case_918_, case_919_ = ...
              if ((nil ~= case_918_) and (nil ~= case_919_)) then
                local signature = case_918_
                local parameters = case_919_
                return {label = signature, documentation = docstring, parameters = parameters}
              else
                local _0 = case_918_
                return nil
              end
            end
            return _917_(fn_signature_format("", binding, arglist))
          else
            local _0 = case_916_
            return nil
          end
        end
        return _915_(doc_or_definition)
      end
    end
    return _902_(analyze_fn(doc_or_definition.definition))
  end
  local function get_stub(server, name, definition, _3fshort)
    if (nil == definition) then
      _G.error("Missing argument definition on /fennel-ls/src/fennel-ls/formatter.fnl:131", 2)
    else
    end
    if (nil == name) then
      _G.error("Missing argument name on /fennel-ls/src/fennel-ls/formatter.fnl:131", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/formatter.fnl:131", 2)
    else
    end
    local _927_
    do
      local case_926_ = definition.definition
      if (nil ~= case_926_) then
        local ast = case_926_
        local case_929_ = type(ast)
        local and_931_ = true
        if and_931_ then
          local _ = case_929_
          and_931_ = varg_3f(ast)
        end
        if and_931_ then
          local _ = case_929_
          _927_ = view(ast)
        else
          local and_934_ = true
          if and_934_ then
            local _ = case_929_
            and_934_ = sym_3f(ast, "nil")
          end
          if and_934_ then
            local _ = case_929_
            _927_ = "nil"
          elseif ((case_929_ == "string") or (case_929_ == "number") or (case_929_ == "boolean")) then
            _927_ = view(ast, {["prefer-colon?"] = true})
          else
            local and_938_ = true
            if and_938_ then
              local _ = case_929_
              and_938_ = table_3f(ast)
            end
            if and_938_ then
              local _ = case_929_
              if _3fshort then
                _927_ = "{...}"
              else
                local t
                do
                  local tbl_21_ = {}
                  for k, v in navigate["iter-fields"](server, definition) do
                    local k_22_, v_23_ = k, unview(get_stub(server, (name .. "." .. k), v, true))
                    if ((k_22_ ~= nil) and (v_23_ ~= nil)) then
                      tbl_21_[k_22_] = v_23_
                    else
                    end
                  end
                  t = tbl_21_
                end
                _927_ = view(t)
              end
            else
              _927_ = nil
            end
          end
        end
      else
        _927_ = nil
      end
    end
    local or_946_ = _927_
    if not or_946_ then
      local case_947_ = definition.definition
      local and_949_ = ((_G.type(case_947_) == "table") and (nil ~= case_947_[1]) and (nil ~= case_947_[2]))
      if and_949_ then
        local hfn = case_947_[1]
        local body = case_947_[2]
        and_949_ = (list_3f(definition.definition) and sym_3f(hfn, "hashfn"))
      end
      if and_949_ then
        local hfn = case_947_[1]
        local body = case_947_[2]
        or_946_ = ("#" .. view(body, {["one-line?"] = true}))
      else
        or_946_ = nil
      end
    end
    if not or_946_ then
      local case_953_ = navigate.getmetadata(server, definition)
      if (nil ~= case_953_) then
        local metadata = case_953_
        if metadata["fnl/arglist"] then
          local _956_
          do
            local tbl_24_ = {name}
            for _, arg in ipairs(metadata["fnl/arglist"]) do
              local val_25_ = render_arg(arg)
              table.insert(tbl_24_, val_25_)
            end
            _956_ = tbl_24_
          end
          or_946_ = ("(" .. table.concat(_956_, " ") .. ")")
        elseif _3fshort then
          or_946_ = "{...}"
        else
          local t
          do
            local tbl_21_ = {}
            for k, v in navigate["iter-fields"](server, definition) do
              local k_22_, v_23_ = k, unview(get_stub(server, (name .. "." .. k), v, true))
              if ((k_22_ ~= nil) and (v_23_ ~= nil)) then
                tbl_21_[k_22_] = v_23_
              else
              end
            end
            t = tbl_21_
          end
          or_946_ = view(t, {["prefer-colon"] = true})
        end
      else
        or_946_ = nil
      end
    end
    if not or_946_ then
      if definition.indeterminate then
        or_946_ = "?"
      else
        or_946_ = nil
      end
    end
    return (or_946_ or view((definition.binding or definition.definition)))
  end
  local function hover_format(server, name, definition, _3fopts)
    if (nil == definition) then
      _G.error("Missing argument definition on /fennel-ls/src/fennel-ls/formatter.fnl:166", 2)
    else
    end
    if (nil == name) then
      _G.error("Missing argument name on /fennel-ls/src/fennel-ls/formatter.fnl:166", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/formatter.fnl:166", 2)
    else
    end
    local _966_
    do
      local case_965_ = navigate.getmetadata(server, definition)
      if ((_G.type(case_965_) == "table") and (nil ~= case_965_["fnl/docstring"])) then
        local fnl_2fdocstring = case_965_["fnl/docstring"]
        _966_ = ("\n---\n" .. fnl_2fdocstring)
      else
        local _ = case_965_
        _966_ = ""
      end
    end
    local _971_
    do
      local case_970_
      do
        local t_972_ = _3fopts
        if (nil ~= t_972_) then
          t_972_ = t_972_.macroexpansion
        else
        end
        case_970_ = t_972_
      end
      if (nil ~= case_970_) then
        local macroexpansion = case_970_
        _971_ = ("\n---\n" .. "Macro expands to:\n" .. code_block(macroexpansion))
      else
        local _ = case_970_
        _971_ = ""
      end
    end
    return {kind = "markdown", value = (code_block(get_stub(server, name, definition)) .. _966_ .. _971_)}
  end
  local kinds = {Text = 1, Method = 2, Function = 3, Constructor = 4, Field = 5, Variable = 6, Class = 7, Interface = 8, Module = 9, Property = 10, Unit = 11, Value = 12, Enum = 13, Keyword = 14, Snippet = 15, Color = 16, File = 17, Reference = 18, Folder = 19, EnumMember = 20, Constant = 21, Struct = 22, Event = 23, Operator = 24, TypeParameter = 25}
  local function int_to_str(int)
    return string.char(math.min(126, (32 + int)))
  end
  local function sort_text(name, kind)
    local parts
    local function _977_(_241)
      return _241:gsub(".", "x")
    end
    parts = name:gsub("[.:]+$", _977_):gmatch("[^.:]+")
    local part_scores
    do
      local tbl_26_ = {}
      local i_27_ = 0
      for part in parts do
        local val_28_ = int_to_str(#part)
        if (nil ~= val_28_) then
          i_27_ = (i_27_ + 1)
          tbl_26_[i_27_] = val_28_
        else
        end
      end
      part_scores = tbl_26_
    end
    local count = #part_scores
    local kind0
    if (kind == 1) then
      kind0 = 100
    else
      kind0 = kind
    end
    table.insert(part_scores, math.max(1, count), int_to_str(kind0))
    return (int_to_str(count) .. table.concat(part_scores))
  end
  local function completion_item_format(server, name, definition, range, _3fkind)
    if (nil == range) then
      _G.error("Missing argument range on /fennel-ls/src/fennel-ls/formatter.fnl:201", 2)
    else
    end
    if (nil == definition) then
      _G.error("Missing argument definition on /fennel-ls/src/fennel-ls/formatter.fnl:201", 2)
    else
    end
    if (nil == name) then
      _G.error("Missing argument name on /fennel-ls/src/fennel-ls/formatter.fnl:201", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/formatter.fnl:201", 2)
    else
    end
    local kind
    local _985_
    do
      local t_984_ = kinds
      if (nil ~= t_984_) then
        t_984_ = t_984_[_3fkind]
      else
      end
      _985_ = t_984_
    end
    local or_987_ = _985_
    if not or_987_ then
      if name:find(".:") then
        or_987_ = kinds.Method
      else
        or_987_ = nil
      end
    end
    if not or_987_ then
      local case_989_ = navigate.getmetadata(server, definition)
      if (nil ~= case_989_) then
        local metadata = case_989_
        local t_992_ = kinds
        if (nil ~= t_992_) then
          t_992_ = t_992_[metadata["fls/itemKind"]]
        else
        end
        or_987_ = t_992_
      else
        or_987_ = nil
      end
    end
    if not or_987_ then
      if name:find("%.") then
        or_987_ = kinds.Field
      else
        or_987_ = kinds.Value
      end
    end
    kind = or_987_
    local _996_
    if not server["client-capable-of-good-completions?"] then
      _996_ = hover_format(server, name, definition)
    else
      _996_ = nil
    end
    local _998_
    if not server["client-capable-of-good-completions?"] then
      _998_ = {newText = name, range = range}
    else
      _998_ = nil
    end
    return {label = name, documentation = _996_, sortText = sort_text(name, kind), textEdit = _998_, kind = kind}
  end
  return {["signature-help-format"] = signature_help_format, ["hover-format"] = hover_format, ["completion-item-format"] = completion_item_format, ["sort-text"] = sort_text}
end
package.preload["fennel-ls.completion"] = package.preload["fennel-ls.completion"] or function(...)
  local fennel = require("fennel")
  local _local_1083_ = require("fennel.compiler")
  local METADATA = _local_1083_.metadata
  local files = require("fennel-ls.files")
  local utils = require("fennel-ls.utils")
  local analyzer = require("fennel-ls.analyzer")
  local message = require("fennel-ls.message")
  local format = require("fennel-ls.formatter")
  local navigate = require("fennel-ls.navigate")
  local compiler = require("fennel-ls.compiler")
  local docs = require("fennel-ls.docs")
  local function textDocument_2fcompletion(server, _send, _1084_)
    local position = _1084_.position
    local _arg_1085_ = _1084_.textDocument
    local uri = _arg_1085_.uri
    if (nil == uri) then
      _G.error("Missing argument uri on /fennel-ls/src/fennel-ls/completion.fnl:44", 2)
    else
    end
    if (nil == position) then
      _G.error("Missing argument position on /fennel-ls/src/fennel-ls/completion.fnl:44", 2)
    else
    end
    if (nil == server) then
      _G.error("Missing argument server on /fennel-ls/src/fennel-ls/completion.fnl:44", 2)
    else
    end
    local file = files["get-by-uri"](server, uri)
    local byte = utils["position->byte"](file.text, position, server["position-encoding"])
    local file0 = {text = (file.text:sub(1, (byte - 1)) .. "|" .. file.text:sub(byte)), uri = file.uri}
    local _ = compiler.compile(server, file0)
    local symbol, parents = analyzer["find-symbol"](server, file0, byte)
    local in_call_position_3f
    local or_1089_ = (fennel["list?"](parents[1]) and (symbol == parents[1][1]))
    if not or_1089_ then
      local _3ffind = nil
      for ast in pairs(file0.calls) do
        if _3ffind then break end
        _3ffind = (ast[1] == symbol)
      end
      or_1089_ = _3ffind
    end
    in_call_position_3f = or_1089_
    local scope
    local or_1090_ = file0.scopes[symbol]
    if not or_1090_ then
      local _3ffind = nil
      for _0, parent in ipairs(parents) do
        if _3ffind then break end
        _3ffind = file0.scopes[parent]
      end
      or_1090_ = _3ffind
    end
    scope = (or_1090_ or file0.scope)
    local range
    do
      local case_1091_ = message["ast->range"](server, file0, symbol)
      if (nil ~= case_1091_) then
        local r = case_1091_
        r["end"].character = (r["end"].character - 1)
        range = r
      else
        local _0 = case_1091_
        range = {start = position, ["end"] = position}
      end
    end
    local results = {}
    local seen = {}
    local function add_completion_21(name, definition, _3fkind)
      if (symbol and (name ~= tostring(symbol))) then
        return table.insert(results, format["completion-item-format"](server, name, definition, range, _3fkind))
      else
        return nil
      end
    end
    local function add_completion_recursively_21(name, definition)
      if not seen[definition] then
        seen[definition] = true
        add_completion_21(name, definition)
        for field, def, _3fstring_method in navigate["iter-fields"](server, definition) do
          if utils["valid-sym-field?"](field) then
            local function _1095_()
              local t_1094_ = def
              if (nil ~= t_1094_) then
                t_1094_ = t_1094_.metadata
              else
              end
              if (nil ~= t_1094_) then
                t_1094_ = t_1094_["fnl/arglist"]
              else
              end
              if (nil ~= t_1094_) then
                t_1094_ = t_1094_[1]
              else
              end
              return t_1094_
            end
            local or_1099_ = ("self" == tostring(_1095_())) or _3fstring_method
            if not or_1099_ then
              local and_1100_ = fennel["list?"](def.definition) and (fennel["sym?"](def.definition[1], "fn") or fennel["sym?"](def.definition[1], "\206\187"))
              if and_1100_ then
                local or_1101_ = (fennel["table?"](def.definition[2]) and fennel["sym?"](def.definition[2][1], "self"))
                if not or_1101_ then
                  local and_1102_ = fennel["sym?"](def.definition[2]) and fennel["table?"](def.definition[3])
                  if and_1102_ then
                    local _1104_
                    do
                      local t_1103_ = def.definition
                      if (nil ~= t_1103_) then
                        t_1103_ = t_1103_[3]
                      else
                      end
                      if (nil ~= t_1103_) then
                        t_1103_ = t_1103_[1]
                      else
                      end
                      _1104_ = t_1103_
                    end
                    and_1102_ = fennel["sym?"](_1104_, "self")
                  end
                  or_1101_ = and_1102_
                end
                and_1100_ = or_1101_
              end
              or_1099_ = and_1100_
            end
            if or_1099_ then
              add_completion_recursively_21((name .. ":" .. field), def)
            else
              add_completion_recursively_21((name .. "." .. field), def)
            end
          else
          end
        end
        seen[definition] = false
        return nil
      else
        return nil
      end
    end
    local function expression_completions()
      local seen_manglings = {}
      for _0, global_2a in ipairs(file0["allowed-globals"]) do
        if not seen_manglings[global_2a] then
          seen_manglings[global_2a] = true
          local case_1110_ = analyzer["search-name-and-scope"](server, file0, global_2a, scope)
          if (nil ~= case_1110_) then
            local def = case_1110_
            if (("_G" == tostring(global_2a)) and not tostring(symbol):match("_G[:.]")) then
              add_completion_21(global_2a, def)
            else
              add_completion_recursively_21(global_2a, def)
            end
          else
            local _1 = case_1110_
            if not file0["macro-file?"] then
              io.stderr:write("BAD!!!! undocumented global: ", tostring(global_2a), "\n")
            else
            end
            add_completion_21(global_2a, {})
          end
        else
        end
      end
      for k, v in pairs(docs.literals) do
        add_completion_21(k, v)
      end
      local scope0 = scope
      while scope0 do
        for mangling in pairs(scope0.manglings) do
          if not seen_manglings[mangling] then
            seen_manglings[mangling] = true
            local case_1115_ = analyzer["search-name-and-scope"](server, file0, mangling, scope0)
            if (nil ~= case_1115_) then
              local def = case_1115_
              add_completion_recursively_21(mangling, def)
            else
              local _0 = case_1115_
              add_completion_recursively_21(mangling, {})
            end
          else
          end
        end
        if in_call_position_3f then
          for macro_2a, macro_value in pairs(scope0.macros) do
            add_completion_21(macro_2a, {binding = macro_2a, metadata = METADATA[macro_value]}, "Keyword")
          end
          for special in pairs(scope0.specials) do
            local case_1118_ = analyzer["search-name-and-scope"](server, file0, special, scope0)
            if (nil ~= case_1118_) then
              local def = case_1118_
              add_completion_21(special, def, "Operator")
            else
              local _0 = case_1118_
              io.stderr:write("BAD!!!! undocumented special: ", tostring(special), "\n")
              do local _ = {label = special} end
            end
          end
        else
        end
        scope0 = scope0.parent
      end
      return nil
    end
    local function binding_completions()
      local seen0 = {}
      for _0, _1121_ in ipairs(file0["compile-errors"]) do
        local message0 = _1121_.message
        local case_1122_ = message0:match("unknown identifier: ([a-zA-Z0-9_-]+)")
        local and_1123_ = (nil ~= case_1122_)
        if and_1123_ then
          local identifier = case_1122_
          and_1123_ = not seen0[identifier]
        end
        if and_1123_ then
          local identifier = case_1122_
          seen0[identifier] = true
          add_completion_21(identifier, {}, "Variable")
        else
        end
      end
      return nil
    end
    if symbol then
      if file0.definitions[symbol] then
        binding_completions()
      else
        expression_completions()
      end
    else
    end
    if server["client-capable-of-good-completions?"] then
      local _1128_
      if server["client-capable-of-insert-replace-completions?"] then
        _1128_ = {insert = {start = range.start, ["end"] = position}, replace = range}
      else
        _1128_ = range
      end
      return {itemDefaults = {editRange = _1128_, data = {uri = uri, byte = byte}}, items = results, isIncomplete = false}
    else
      return results
    end
  end
  local function completionItem_2fresolve(server, _send, completion_item)
    local uri = completion_item.data.uri
    local byte = completion_item.data.byte
    local file = files["get-by-uri"](server, uri)
    local _symbol, parents = analyzer["find-symbol"](server, file, byte)
    local scope
    local or_1131_ = file.scopes[_symbol]
    if not or_1131_ then
      local _3ffind = nil
      for _, parent in ipairs(parents) do
        if _3ffind then break end
        _3ffind = file.scopes[parent]
      end
      or_1131_ = _3ffind
    end
    scope = (or_1131_ or file.scope)
    local result = analyzer["search-name-and-scope"](server, file, completion_item.label, scope)
    if result then
      completion_item.documentation = format["hover-format"](server, completion_item.label, result)
    else
    end
    return completion_item
  end
  return {["textDocument/completion"] = textDocument_2fcompletion, ["completionItem/resolve"] = completionItem_2fresolve}
end
package.preload["fennel-ls.json-rpc"] = package.preload["fennel-ls.json-rpc"] or function(...)
  local _local_1221_ = require("dkjson")
  local encode = _local_1221_.encode
  local decode = _local_1221_.decode
  local header_separator
  if string.match(package.config, "^\\") then
    header_separator = "\n\n"
  else
    header_separator = "\r\n\r\n"
  end
  local function read_header(_in, _3fheader)
    if (nil == _in) then
      _G.error("Missing argument in on /fennel-ls/src/fennel-ls/json-rpc.fnl:20", 2)
    else
    end
    local header = (_3fheader or {})
    local line = assert(_in:read(), "EOF")
    local case_1224_ = line:match("^(.-)\r?$")
    if (case_1224_ == "") then
      return header
    elseif (nil ~= case_1224_) then
      local line0 = case_1224_
      local k, v = line0:match("^(.-): (.-)$")
      if not (k and v) then
        error(("fennel-ls encountered a malformed json-rpc header: \"" .. line0 .. "\""))
      else
      end
      header[k] = v
      return read_header(_in, header)
    else
      return nil
    end
  end
  local function read_n(_in, len, _3fbuffer)
    if (nil == len) then
      _G.error("Missing argument len on /fennel-ls/src/fennel-ls/json-rpc.fnl:32", 2)
    else
    end
    if (nil == _in) then
      _G.error("Missing argument in on /fennel-ls/src/fennel-ls/json-rpc.fnl:32", 2)
    else
    end
    local buffer = (_3fbuffer or {})
    if (len <= 0) then
      return table.concat(buffer)
    else
      local case_1229_ = _in:read(len)
      if (nil ~= case_1229_) then
        local content = case_1229_
        table.insert(buffer, content)
        return read_n(_in, (len - #content), buffer)
      else
        return nil
      end
    end
  end
  local function read_content(_in, header)
    if (nil == header) then
      _G.error("Missing argument header on /fennel-ls/src/fennel-ls/json-rpc.fnl:43", 2)
    else
    end
    if (nil == _in) then
      _G.error("Missing argument in on /fennel-ls/src/fennel-ls/json-rpc.fnl:43", 2)
    else
    end
    local n = assert(tonumber(header["Content-Length"]), "fennel-ls: I expected a Content-Length header")
    return read_n(_in, n)
  end
  local function read(_in)
    if (nil == _in) then
      _G.error("Missing argument in on /fennel-ls/src/fennel-ls/json-rpc.fnl:48", 2)
    else
    end
    local _3fresult, __3ferr_pos, _3ferr
    do
      local tmp_6_ = read_header(_in)
      if (tmp_6_ ~= nil) then
        local tmp_6_0 = read_content(_in, tmp_6_)
        if (tmp_6_0 ~= nil) then
          _3fresult, __3ferr_pos, _3ferr = decode(tmp_6_0)
        else
          _3fresult, __3ferr_pos, _3ferr = nil
        end
      else
        _3fresult, __3ferr_pos, _3ferr = nil
      end
    end
    return (_3fresult or _3ferr)
  end
  local stdin_ready_3f = nil
  local function try_read(_in)
    if (nil == _in) then
      _G.error("Missing argument in on /fennel-ls/src/fennel-ls/json-rpc.fnl:59", 2)
    else
    end
    local or_1238_ = stdin_ready_3f
    if not or_1238_ then
      local case_1239_, case_1240_ = pcall(require, "posix")
      if ((case_1239_ == true) and (nil ~= case_1240_)) then
        local posix = case_1240_
        local function _1243_()
          return (1 == posix.rpoll(0, 0))
        end
        or_1238_ = _1243_
      else
        or_1238_ = nil
      end
    end
    if not or_1238_ then
      local and_1245_ = package.config:find("^/")
      if and_1245_ then
        local case_1246_ = os.execute("bash --version > /dev/null")
        if ((case_1246_ == 0) or (case_1246_ == true)) then
          and_1245_ = true
        else
          and_1245_ = nil
        end
      end
      if and_1245_ then
        local function _1250_()
          local case_1251_ = os.execute("bash -c 'read -t 0'")
          if ((case_1251_ == 0) or (case_1251_ == true)) then
            return true
          else
            return nil
          end
        end
        or_1238_ = _1250_
      else
        or_1238_ = nil
      end
    end
    if not or_1238_ then
      local function _1254_()
        return false
      end
      or_1238_ = _1254_
    end
    stdin_ready_3f = or_1238_
    if stdin_ready_3f() then
      return read(_in)
    else
      return nil
    end
  end
  local function write(out, msg)
    if (nil == msg) then
      _G.error("Missing argument msg on /fennel-ls/src/fennel-ls/json-rpc.fnl:75", 2)
    else
    end
    if (nil == out) then
      _G.error("Missing argument out on /fennel-ls/src/fennel-ls/json-rpc.fnl:75", 2)
    else
    end
    local content = encode(msg)
    local msg_stringified = ("Content-Length: " .. #content .. header_separator .. content)
    out:write(msg_stringified)
    if out.flush then
      return out:flush()
    else
      return nil
    end
  end
  return {read = read, ["try-read"] = try_read, write = write}
end
return require("fennel-ls.cli")