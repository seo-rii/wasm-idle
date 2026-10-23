# Run the exact automatic-preview helper with native CRuby, independently of Wasm assets.
require 'minitest/autorun'

class RubyDebugPreviewTest < Minitest::Test
  class Dangerous
    def inspect = raise('inspect must not run')
    def to_s = raise('to_s must not run')
    def class = raise('class override must not run')
  end

  class DangerousArray < Array
    def inspect = raise('subclass inspect must not run')
    def length = raise('subclass length must not run')
    def [](index) = raise('subclass [] must not run')
  end

  def setup
    path = File.expand_path('../src/lib/playground/worker/rubyDebugPreview.ts', __dir__)
    helper = File.read(path).split('String.raw`', 2).last.split('`;', 2).first
    context = Object.new.instance_eval { binding }
    eval(helper, context, path)
    @preview = context.local_variable_get(:preview_value)
    @type = context.local_variable_get(:preview_type)
  end

  def test_scalars_keep_useful_previews
    [nil, true, false, 42, -7, 1.25, 'hello', :hello].zip(
      ['nil', 'true', 'false', '42', '-7', '1.25', '"hello"', ':"hello"']
    ).each { |value, expected| assert_equal expected, @preview.call(value) }
    assert_equal 'String', @type.call('hello')
  end

  def test_user_objects_and_subclasses_are_opaque
    assert_equal '<RubyDebugPreviewTest::Dangerous object>', @preview.call(Dangerous.new)
    assert_equal 'RubyDebugPreviewTest::Dangerous', @type.call(Dangerous.new)
    assert_equal '<RubyDebugPreviewTest::DangerousArray object>', @preview.call(DangerousArray.new([Dangerous.new]))
    assert_equal '<BasicObject object>', @preview.call(BasicObject.new)
  end

  def test_builtin_values_with_singleton_overrides_use_captured_methods
    values = ['hello', [1, Dangerous.new], {a: Dangerous.new}]
    values.each do |value|
      [:inspect, :to_s, :class, :byteslice, :bytesize, :encode, :length, :[], :each_pair].each do |name|
        value.define_singleton_method(name) { |*| raise("override #{name} must not run") }
      end
    end
    assert_equal '"hello"', @preview.call(values[0])
    assert_equal '[1, <RubyDebugPreviewTest::Dangerous object>]', @preview.call(values[1])
    assert_equal '{:"a"=><RubyDebugPreviewTest::Dangerous object>}', @preview.call(values[2])
  end

  def test_large_values_limit_work_before_conversion
    assert_equal '<Integer: 100001 bits>', @preview.call(1 << 100_000)
    ['한' * 1_000_000, "\xff".b * 1_000_000, Array.new(100_000, Dangerous.new),
     (1..10_000).to_h { |index| [index, Dangerous.new] }].each do |value|
      text = @preview.call(value)
      assert_operator text.length, :<=, 512
      assert text.valid_encoding?
      assert_includes text, '...'
    end
  end

  def test_nested_and_cyclic_containers_stop_at_depth_limit
    cycle = []; cycle << cycle
    assert_equal '[[...]]', @preview.call(cycle)
    assert_equal '{:"a"=>[...]}', @preview.call({a: [Dangerous.new]})
  end

  def test_unavailable_encoding_converters_do_not_abort_preview
    Encoding.list.each do |encoding|
      text = @preview.call('a'.force_encoding(encoding))
      assert text.valid_encoding?, encoding.name
      assert_operator text.length, :<=, 512
    end
  end

  def test_large_integer_bit_count_does_not_call_replaced_integer_to_s
    preview, calls = with_core_overrides(Integer => [:to_s]) { @preview.call(1 << 300) }
    assert_equal '<Integer: 301 bits>', preview
    assert_empty calls
  end

  def test_preview_formatting_uses_captured_core_methods
    values = [nil, true, false, 42, 1 << 300, 1.25, 'hello', :hello,
              [1, [2], Dangerous.new], {a: [3]}, Dangerous.new,
              Array.new(8, 'a' * 200), Array.new(8, '한' * 100),
              Array.new(9, 1), (1..7).to_h { |n| [n, n] }]
    expected = values.map { |value| @preview.call(value) }
    append = Array.instance_method(:<<)
    previews, calls = with_core_overrides(
      Integer => [:to_s, :bit_length, :+, :succ, :times, :>, :>=, :<=],
      Float => [:to_s], Symbol => [:name],
      String => [:to_s, :+, :<<, :length, :[], :byteslice, :bytesize, :encode, :inspect],
      Array => [:length, :[], :<<, :join, :min], Hash => [:length, :each_pair],
      Module => [:name], Kernel => [:class], BasicObject => [:equal?]
    ) do
      result = []
      values.each { |value| append.bind_call(result, @preview.call(value)) }
      result
    end
    assert_equal expected, previews
    assert_empty calls
  end

  private

  # Replace methods only after the debugger captured them, as user source can do.
  # Restore before assertions so test-framework formatting cannot affect the count.
  def with_core_overrides(methods)
    originals = methods.flat_map do |type, names|
      names.map { |name| [type, name, type.instance_method(name)] }
    end
    calls = []
    append = Array.instance_method(:<<)
    begin
      originals.each do |type, name, original|
        type.define_method(name) do |*args, **kwargs, &block|
          append.bind_call(calls, [type, name])
          original.bind_call(self, *args, **kwargs, &block)
        end
      end
      result = yield
    ensure
      originals.each { |type, name, original| type.define_method(name, original) }
    end
    [result, calls]
  end
end
