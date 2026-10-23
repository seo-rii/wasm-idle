-- Host adaptation for the unmodified, pinned MobDebug engine.
-- User source is loaded as a named chunk without rewriting its text.
local source, filename = __wasm_idle_debug_source, __wasm_idle_debug_file
local emit, read = __wasm_idle_debug_event, __wasm_idle_debug_read
local pause_at_entry = __wasm_idle_debug_entry
local initial_breakpoints = __wasm_idle_debug_breakpoints
local mobdebug_source = __wasm_idle_mobdebug_source
local original_tostring = tostring
local function safe_tostring(value)
  local kind = type(value)
  if kind == 'table' or kind == 'userdata' then return '<' .. kind .. '>' end
  return original_tostring(value)
end
local function quote(value)
  return '"' .. value:gsub('[%z\1-\31\\"]', function(char)
    if char == '"' then return '\\"' end
    if char == '\\' then return '\\\\' end
    return string.format('\\u%04x', string.byte(char))
  end) .. '"'
end
local function bounded(value, limit)
  value = safe_tostring(value)
  return #value > limit and value:sub(1, limit) .. '…' or value
end
local queue, received = {'LOAD 0 -\n'}, ''
local nonblocking, closed = false, false
local current_file, current_line, current_reason = filename, 1, 'entry'
local next_reason, stack_requested, eval_id = 'step', false, nil
local breakpoints = {}
for line in initial_breakpoints:gmatch('%d+') do breakpoints[tonumber(line)] = true end
local pending_error, error_size
local peer = {}
function peer:settimeout(timeout) nonblocking = timeout == 0 end
function peer:close() closed = true end
function peer:connect() return true end
function peer:receive(pattern)
  while true do
    local ending = pattern == '*l' and received:find('\n', 1, true)
      or type(pattern) == 'number' and #received >= pattern and pattern
    if ending then
      local value = received:sub(1, pattern == '*l' and ending - 1 or ending)
      received = received:sub(ending + 1)
      if pattern == '*l' then
        stack_requested = value:match('^STACK') ~= nil
        local command, file, line = value:match('^(%u+)%s+(.-)%s+(%d+)%s*$')
        if command == 'DELB' and file == '*' and line == '0' then breakpoints = {} end
        if command == 'SETB' and file == filename then breakpoints[tonumber(line)] = true end
        if command == 'DELB' and file == filename then breakpoints[tonumber(line)] = nil end
        if value == 'STEP' then next_reason = 'step'
        elseif value == 'OVER' then next_reason = 'nextLine'
        elseif value == 'OUT' then next_reason = 'stepOut' end
        if value:match('^EXEC ') then
          local parameters = value:match('%-%-(%b{})%s*$')
          eval_id = parameters and tonumber(parameters:match('requestId=(%d+)')) or nil
        end
      end
      return value
    end
    if closed then return nil, 'closed' end
    local chunk
    if #queue > 0 then chunk = table.remove(queue, 1) else chunk = read(not nonblocking) end
    if chunk == nil then closed = true; return nil, 'closed' end
    if chunk == '' then return nil, 'timeout' end
    received = received .. chunk
  end
end
local function request_stack()
  queue[#queue + 1] = 'STACK --{maxlevel=4,maxnum=50,metatostring=false}\n'
end
function peer:send(message)
  if pending_error then
    pending_error = pending_error .. message
    if #pending_error >= error_size then
      if eval_id then
        emit('{"type":"evaluate","id":' .. eval_id .. ',"error":' .. quote(bounded(pending_error, 4096)) .. '}')
        eval_id = nil
      end
      pending_error = nil
    end
    return #message
  end
  local started_file, started_line = message:match('^201 Started%s+(.-)%s+(%d+)\n$')
  local paused_file, paused_line = message:match('^202 Paused%s+(.-)%s+(%d+)\n$')
  if started_file or paused_file then
    current_file, current_line = started_file or paused_file, tonumber(started_line or paused_line)
    current_reason = started_file and 'entry' or breakpoints[current_line] and 'breakpoint' or next_reason
    if started_file and not pause_at_entry and not breakpoints[current_line] then
      queue[#queue + 1] = 'RUN\n'
    else
      request_stack()
    end
  elseif message:match('^401 ') then
    error_size = tonumber(message:match('(%d+)\n$')) or 0
    pending_error = ''
  end
  return #message
end
local saved_socket = package.loaded.socket
package.loaded.socket = {tcp = function() return peer end}
local environment = setmetatable({tostring = safe_tostring}, {__index = _G})
local mobdebug = assert(load(mobdebug_source, '@__wasm_idle_mobdebug.lua', 't', environment))()
package.loaded.socket = saved_socket
mobdebug.connect = function() return peer end
mobdebug.onexit = function() error('Lua debugger stopped', 0) end
local original_dump = mobdebug.dump
local function preview(value)
  local ok, text = pcall(mobdebug.line, value, {
    nocode = true, comment = false, metatostring = false,
    maxlevel = 2, maxnum = 25, maxlength = 512
  })
  return ok and bounded(text, 1024) or '<unavailable>'
end
local preview_budget = 0
local function variables(values, existing)
  local entries, names = {}, {}
  for name in next, values or {} do
    if type(name) == 'string' and name ~= '_ENV' and not name:match('^%(') then
      names[#names + 1] = name
    end
  end
  table.sort(names)
  for _, name in ipairs(names) do
    if #entries >= 100 then break end
    if not existing[name] then
      existing[name] = true
      if preview_budget <= 0 then break end
      local value = rawget(rawget(values, name), 1)
      local entry = '{"name":' .. quote(bounded(name, 256))
        .. ',"type":' .. quote(type(value)) .. ',"value":' .. quote(preview(value)) .. '}'
      if #entry > preview_budget then break end
      entries[#entries + 1] = entry
      preview_budget = preview_budget - #entry
    end
  end
  return entries
end
mobdebug.dump = function(value, parameters)
  if stack_requested then
    stack_requested = false
    preview_budget = 131072
    local frames = {}
    for _, frame in ipairs(value) do
      local info = frame[1]
      local file, line = info[2], info[4]
      if file == filename and line > 0 then
        local names = {}
        local entries = variables(frame[2], names)
        for _, item in ipairs(variables(frame[3], names)) do entries[#entries + 1] = item end
        frames[#frames + 1] = '{"functionName":' .. quote(bounded(info[1] or '<main>', 256))
          .. ',"sourcePath":' .. quote(file) .. ',"line":' .. line
          .. ',"locals":[' .. table.concat(entries, ',') .. ']}'
        if #frames >= 64 then break end
      end
    end
    emit('{"type":"pause","sourcePath":' .. quote(current_file) .. ',"line":' .. current_line
      .. ',"reason":' .. quote(current_reason) .. ',"frames":[' .. table.concat(frames, ',') .. ']}')
    return 'nil'
  elseif eval_id then
    emit('{"type":"evaluate","id":' .. eval_id .. ',"value":' .. quote(bounded(value[1] or 'nil', 4096)) .. '}')
    eval_id = nil
    return ''
  end
  return original_dump(value, parameters)
end
for line in pairs(breakpoints) do mobdebug.setbreakpoint(filename, line) end
mobdebug.coro()
local program = assert(load(source, '@' .. filename))
local ok, result = pcall(function() mobdebug.start(); program(); mobdebug.done() end)
mobdebug.done()
if not ok then error(result, 0) end
