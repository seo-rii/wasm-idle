"""Run the actual embedded Python trace/preview logic on native CPython, not Pyodide."""
import json
from pathlib import Path
import sys
import types
import unittest

root = Path(__file__).resolve().parents[1]
source = (root / 'src/lib/playground/worker/python.ts').read_text()
preview = (root / 'src/lib/playground/worker/pythonDebugPreview.ts').read_text().split('String.raw`', 1)[1].split('`;', 1)[0]
trace = source[source.index('__wasm_idle_debug_breakpoints = set('):source.index('sys.settrace(__wasm_idle_debug_trace)')]
for old, new in {
    '${normalizedBreakpoints}': '[]',
    "${pauseOnEntry ? 'True' : 'False'}": 'False',
    '${debugFilenameLiteral}': '"user.py"',
    '${debugPauseName}': 'pause', '${debugWaitName}': 'wait',
    '${debugReadWatchName}': 'read_watch', '${debugWriteWatchName}': 'write_watch',
    '${debugReadBreakpointsName}': 'read_breakpoints', '${PYTHON_DEBUG_PREVIEW}': preview,
}.items():
    trace = trace.replace(old, new)
assert '${' not in trace


class DebugTests(unittest.TestCase):
    def setUp(self):
        self.events = []
        self.commands = iter([1] * 20)
        self.version = 0
        self.lines = []
        self.snapshots = 0
        self.ns = {'sys': sys, 'json': json,
                   'pause': lambda line, reason, *_: self.events.append((line, reason)),
                   'wait': lambda: next(self.commands),
                   'read_watch': lambda: 'value', 'write_watch': lambda _: None,
                   'read_breakpoints': self.read_breakpoints}
        exec(compile(trace, '<trace-helper>', 'exec'), self.ns)
        self.preview = self.ns['__wasm_idle_debug_preview']

    def read_breakpoints(self, known):
        if known == self.version:
            return None
        self.snapshots += 1
        return json.dumps({'version': self.version, 'lines': self.lines})

    def frame(self, line=1, parent=None):
        return types.SimpleNamespace(f_code=types.SimpleNamespace(co_filename='user.py', co_name='main'),
                                     f_lineno=line, f_back=parent, f_locals={})

    def test_breakpoint_payload_only_decoded_when_version_changes(self):
        refresh = self.ns['__wasm_idle_debug_refresh_breakpoints']
        for _ in range(1000):
            refresh()
        self.assertEqual(self.snapshots, 1)
        self.version, self.lines = 1, [3, 7]
        refresh()
        self.assertEqual(self.snapshots, 2)
        self.assertEqual(self.ns['__wasm_idle_debug_breakpoints'], {3, 7})

    def test_continue_does_not_walk_call_stack(self):
        self.ns['__wasm_idle_debug_depth'] = lambda _: self.fail('unnecessary stack walk')
        for line in range(1, 100):
            self.ns['__wasm_idle_debug_trace'](self.frame(line), 'line', None)
        self.assertEqual(self.events, [])

    def test_pause_still_calculates_depth_and_can_continue(self):
        calls = []
        depth = self.ns['__wasm_idle_debug_depth']
        self.ns['__wasm_idle_debug_depth'] = lambda frame: (calls.append(frame), depth(frame))[1]
        self.lines, self.version = [3], 1
        self.ns['__wasm_idle_debug_trace'](self.frame(3), 'line', None)
        self.ns['__wasm_idle_debug_trace'](self.frame(4), 'line', None)
        self.ns['__wasm_idle_debug_trace'](self.frame(5), 'line', None)
        self.assertEqual(self.events, [(3, 'breakpoint')])
        self.assertEqual(len(calls), 2)  # pause depth and one resume-skip comparison

    def test_real_trace_preserves_entry_next_step_and_step_out(self):
        self.ns['__wasm_idle_debug_pause_on_entry'] = True
        self.commands = iter([3, 2, 4, 1])
        code = 'def double(x):\n    return x * 2\nvalue = double(3)\nvalue += 1\n'
        scope = {}
        try:
            sys.settrace(self.ns['__wasm_idle_debug_trace'])
            exec(compile(code, 'user.py', 'exec'), scope)
        finally:
            sys.settrace(None)
        self.assertEqual(scope['value'], 7)
        self.assertEqual(self.events, [(1, 'entry'), (3, 'nextLine'), (2, 'step'), (4, 'stepOut')])

    def test_large_string_and_bytes_are_sliced_before_repr(self):
        for value in ('한' * 1000000, b'x' * 1000000, bytearray(1000000)):
            text = self.preview(value)
            self.assertLessEqual(len(text), 80)
            self.assertTrue(text.endswith('...'))

    def test_large_integer_avoids_decimal_conversion(self):
        self.assertEqual(self.preview(1 << 100000), '<int: 100001 bits>')
        self.assertEqual(self.preview(-42), '-42')

    def test_custom_repr_and_container_overrides_are_not_called(self):
        class Dangerous:
            def __repr__(self):
                raise AssertionError('repr must not be called')
        class DangerousList(list):
            def __len__(self):
                raise AssertionError('len must not be called')
            def __getitem__(self, _):
                raise AssertionError('getitem must not be called')
        self.assertEqual(self.preview(Dangerous()), '<Dangerous object>')
        self.assertEqual(self.preview(DangerousList()), '<DangerousList object>')

    def test_sets_do_not_sort_or_repr_all_elements(self):
        class Item:
            def __repr__(self):
                raise AssertionError('set sorting called repr')
        text = self.preview({Item() for _ in range(10000)})
        self.assertEqual(text.count('<Item object>'), 6)
        self.assertIn('...', text)

    def test_recursive_containers_are_bounded(self):
        value = []; value.append(value)
        self.assertEqual(self.preview(value), '[[...]]')
        self.assertEqual(self.preview(set()), 'set()')
        self.assertEqual(self.preview(frozenset()), 'frozenset()')
        self.assertEqual(self.preview((1,)), '(1,)')
        self.assertLess(len(self.preview(list(range(100000)))), 100)

    def test_cancel_command_still_interrupts(self):
        self.ns['__wasm_idle_debug_pause_on_entry'] = True
        self.commands = iter([-1])
        with self.assertRaises(KeyboardInterrupt):
            self.ns['__wasm_idle_debug_trace'](self.frame(), 'line', None)


if __name__ == '__main__':
    unittest.main()
