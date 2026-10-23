/** Automatic locals must not dispatch user inspection or container overrides. */
export const RUBY_DEBUG_PREVIEW = String.raw`
debug_class = Kernel.instance_method(:class)
debug_equal = BasicObject.instance_method(:equal?)
debug_type_name = Module.instance_method(:name)
debug_string_slice = String.instance_method(:byteslice)
debug_string_size = String.instance_method(:bytesize)
debug_string_encode = String.instance_method(:encode)
debug_string_inspect = String.instance_method(:inspect)
debug_integer_bits = Integer.instance_method(:bit_length)
debug_integer_text = Integer.instance_method(:to_s)
debug_float_text = Float.instance_method(:to_s)
debug_symbol_name = Symbol.instance_method(:name)
debug_array_size = Array.instance_method(:length)
debug_array_get = Array.instance_method(:[])
debug_hash_size = Hash.instance_method(:length)
debug_hash_each = Hash.instance_method(:each_pair)
preview_type = ->(value) do
  kind = debug_class.bind_call(value)
  name = debug_type_name.bind_call(kind)
  name ? debug_string_encode.bind_call(debug_string_slice.bind_call(name, 0, 64), 'UTF-8', invalid: :replace, undef: :replace) : 'Object'
rescue StandardError
  'Object'
end
preview_value = nil
preview_value = ->(value, depth = 0) do
  next '...' if depth >= 2
  next 'nil' if debug_equal.bind_call(value, nil)
  next 'true' if debug_equal.bind_call(value, true)
  next 'false' if debug_equal.bind_call(value, false)
  kind = debug_class.bind_call(value)
  text = if debug_equal.bind_call(kind, Integer)
    bits = debug_integer_bits.bind_call(value)
    bits <= 256 ? debug_integer_text.bind_call(value) : '<Integer: ' + bits.to_s + ' bits>'
  elsif debug_equal.bind_call(kind, Float)
    debug_float_text.bind_call(value)
  elsif debug_equal.bind_call(kind, String) || debug_equal.bind_call(kind, Symbol)
    string = debug_equal.bind_call(kind, Symbol) ? debug_symbol_name.bind_call(value) : value
    prefix = debug_string_slice.bind_call(string, 0, 128)
    prefix = debug_string_encode.bind_call(prefix, 'UTF-8', invalid: :replace, undef: :replace)
    quoted = debug_string_inspect.bind_call(prefix)
    (debug_equal.bind_call(kind, Symbol) ? ':' : '') + quoted + (debug_string_size.bind_call(string) > 128 ? '...' : '')
  elsif debug_equal.bind_call(kind, Array)
    size = debug_array_size.bind_call(value)
    items = []
    [size, 8].min.times { |index| items << preview_value.call(debug_array_get.bind_call(value, index), depth + 1) }
    items << '...' if size > 8
    '[' + items.join(', ') + ']'
  elsif debug_equal.bind_call(kind, Hash)
    items = []
    debug_hash_each.bind_call(value) do |key, item|
      items << preview_value.call(key, depth + 1) + '=>' + preview_value.call(item, depth + 1)
      break if items.length >= 6
    end
    items << '...' if debug_hash_size.bind_call(value) > 6
    '{' + items.join(', ') + '}'
  else
    '<' + preview_type.call(value) + ' object>'
  end
  text.length > 512 ? text[0, 509] + '...' : text
rescue StandardError
  '<' + preview_type.call(value) + ' object>'
end
`;
