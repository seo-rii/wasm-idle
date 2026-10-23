/** Automatic locals must not dispatch user inspection or container overrides. */
export const RUBY_DEBUG_PREVIEW = String.raw`
debug_class = Kernel.instance_method(:class)
debug_equal = BasicObject.instance_method(:equal?)
debug_type_name = Module.instance_method(:name)
debug_string_slice = String.instance_method(:byteslice)
debug_string_size = String.instance_method(:bytesize)
debug_string_length = String.instance_method(:length)
debug_string_characters = String.instance_method(:[])
debug_string_encode = String.instance_method(:encode)
debug_string_inspect = String.instance_method(:inspect)
debug_integer_bits = Integer.instance_method(:bit_length)
debug_integer_text = Integer.instance_method(:to_s)
debug_integer_greater = Integer.instance_method(:>)
debug_integer_at_least = Integer.instance_method(:>=)
debug_integer_at_most = Integer.instance_method(:<=)
debug_integer_add = Integer.instance_method(:+)
debug_float_text = Float.instance_method(:to_s)
debug_symbol_name = Symbol.instance_method(:name)
debug_array_size = Array.instance_method(:length)
debug_array_get = Array.instance_method(:[])
debug_array_append = Array.instance_method(:<<)
debug_array_join = Array.instance_method(:join)
debug_hash_size = Hash.instance_method(:length)
debug_hash_each = Hash.instance_method(:each_pair)
preview_join = ->(*parts) { debug_array_join.bind_call(parts, '') }
preview_type = ->(value) do
  kind = debug_class.bind_call(value)
  name = debug_type_name.bind_call(kind)
  name ? debug_string_encode.bind_call(debug_string_slice.bind_call(name, 0, 64), 'UTF-8', invalid: :replace, undef: :replace) : 'Object'
rescue StandardError
  'Object'
end
preview_value = nil
preview_value = ->(value, depth = 0) do
  next '...' if debug_integer_at_least.bind_call(depth, 2)
  next 'nil' if debug_equal.bind_call(value, nil)
  next 'true' if debug_equal.bind_call(value, true)
  next 'false' if debug_equal.bind_call(value, false)
  kind = debug_class.bind_call(value)
  text = if debug_equal.bind_call(kind, Integer)
    bits = debug_integer_bits.bind_call(value)
    debug_integer_at_most.bind_call(bits, 256) ? debug_integer_text.bind_call(value) : preview_join.call('<Integer: ', debug_integer_text.bind_call(bits), ' bits>')
  elsif debug_equal.bind_call(kind, Float)
    debug_float_text.bind_call(value)
  elsif debug_equal.bind_call(kind, String) || debug_equal.bind_call(kind, Symbol)
    string = debug_equal.bind_call(kind, Symbol) ? debug_symbol_name.bind_call(value) : value
    prefix = debug_string_slice.bind_call(string, 0, 128)
    prefix = debug_string_encode.bind_call(prefix, 'UTF-8', invalid: :replace, undef: :replace)
    quoted = debug_string_inspect.bind_call(prefix)
    preview_join.call(debug_equal.bind_call(kind, Symbol) ? ':' : '', quoted, debug_integer_greater.bind_call(debug_string_size.bind_call(string), 128) ? '...' : '')
  elsif debug_equal.bind_call(kind, Array)
    size = debug_array_size.bind_call(value)
    items = []
    limit = debug_integer_greater.bind_call(size, 8) ? 8 : size
    # Integer#times can dispatch an overridden #succ in the pinned Ruby runtime.
    index = 0
    while debug_integer_greater.bind_call(limit, index)
      debug_array_append.bind_call(items, preview_value.call(debug_array_get.bind_call(value, index), debug_integer_add.bind_call(depth, 1)))
      index = debug_integer_add.bind_call(index, 1)
    end
    debug_array_append.bind_call(items, '...') if debug_integer_greater.bind_call(size, 8)
    preview_join.call('[', debug_array_join.bind_call(items, ', '), ']')
  elsif debug_equal.bind_call(kind, Hash)
    items = []
    debug_hash_each.bind_call(value) do |key, item|
      next_depth = debug_integer_add.bind_call(depth, 1)
      debug_array_append.bind_call(items, preview_join.call(preview_value.call(key, next_depth), '=>', preview_value.call(item, next_depth)))
      break if debug_integer_at_least.bind_call(debug_array_size.bind_call(items), 6)
    end
    debug_array_append.bind_call(items, '...') if debug_integer_greater.bind_call(debug_hash_size.bind_call(value), 6)
    preview_join.call('{', debug_array_join.bind_call(items, ', '), '}')
  else
    preview_join.call('<', preview_type.call(value), ' object>')
  end
  debug_integer_greater.bind_call(debug_string_length.bind_call(text), 512) ? preview_join.call(debug_string_characters.bind_call(text, 0, 509), '...') : text
rescue StandardError
  preview_join.call('<', preview_type.call(value), ' object>')
end
`;
