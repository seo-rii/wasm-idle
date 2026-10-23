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
end
