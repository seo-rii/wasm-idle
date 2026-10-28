"""Run the actual embedded Python trace/preview logic on native CPython, not Pyodide."""
import json
from pathlib import Path
import sys
import types
import unittest

root = Path(__file__).resolve().parents[1]
source = (root / 'src/lib/playground/worker/pythonDebug.ts').read_text()
preview = (root / 'src/lib/playground/worker/pythonDebugPreview.ts').read_text().split('String.raw`', 1)[1].split('`;', 1)[0]
trace = source.split('export const PYTHON_DEBUG_TRACE = String.raw`', 1)[1].split('`;', 1)[0]
trace = trace.replace('${PYTHON_DEBUG_PREVIEW}', preview)
factory = source.split('export const PYTHON_DEBUG_FACTORY = String.raw`', 1)[1].split('`;', 1)[0]
assert '${' not in trace


class DebugTests(unittest.TestCase):
    def setUp(self):
        self.events = []
        self.commands = iter([1] * 20)
        self.version = 0
        self.lines = []
        self.snapshots = 0
        self.callback_calls = 0
        self.bridge = types.SimpleNamespace(
            pause=lambda line, reason, *_: self.events.append((line, reason)),
            wait=lambda: next(self.commands),
            readWatch=lambda: 'value', writeWatch=lambda _: None,
            readBreakpoints=self.read_breakpoints, state=self)
        namespace = {}
        exec(compile(factory, '<debug-factory>', 'exec'), namespace)
        self.make_trace = namespace['__wasm_idle_compile_debug_helpers'](trace, '')
        self.ns = self.make_trace('user.py', '[]', False, self.bridge).__globals__
        self.preview = self.ns['__wasm_idle_debug_preview']

    def read_breakpoints(self, known):
        self.callback_calls += 1
        if known == self.version:
            return None
        self.snapshots += 1
        return json.dumps({'version': self.version, 'lines': self.lines})

    def frame(self, line=1, parent=None):
        return types.SimpleNamespace(f_code=types.SimpleNamespace(co_filename='user.py', co_name='main'),
                                     f_lineno=line, f_back=parent, f_locals={})

    def test_cached_helper_code_has_fresh_run_state_and_filename(self):
        first = self.ns['__wasm_idle_debug_trace']
        self.ns['__wasm_idle_debug_step_mode'] = 'next'
        second = self.make_trace('other.py', '[7]', True, self.bridge)
        self.assertIs(first.__code__, second.__code__)
        self.assertIsNot(first.__globals__, second.__globals__)
        self.assertIsNone(second.__globals__['__wasm_idle_debug_step_mode'])
        self.assertEqual(second.__globals__['__wasm_idle_debug_breakpoints'], {7})
        self.assertTrue(second.__globals__['__wasm_idle_debug_pause_on_entry'])
        self.assertIn('other.py', second.__globals__['__wasm_idle_debug_source_filenames'])
        self.assertNotIn('user.py', second.__globals__['__wasm_idle_debug_source_filenames'])

    def test_breakpoint_payload_only_decoded_when_version_changes(self):
        refresh = self.ns['__wasm_idle_debug_refresh_breakpoints']
        for _ in range(1000):
            refresh()
        self.assertEqual(self.snapshots, 1)
        self.assertEqual(self.callback_calls, 1)
        self.version, self.lines = 1, [3, 7]
        refresh()
        self.assertEqual(self.snapshots, 2)
        self.assertEqual(self.ns['__wasm_idle_debug_breakpoints'], {3, 7})

    def test_unchanged_lines_poll_version_without_calling_snapshot_helper(self):
        refresh = self.ns['__wasm_idle_debug_refresh_breakpoints']
        calls, polls = [], []
        class State:
            @property
            def version(state):
                polls.append(self.version)
                return self.version
        self.ns['__wasm_idle_debug_breakpoint_state'] = State()
        self.ns['__wasm_idle_debug_refresh_breakpoints'] = lambda: (calls.append(1), refresh())[1]
        for line in range(1, 1000):
            self.ns['__wasm_idle_debug_trace'](self.frame(line), 'line', None)
        self.assertEqual(len(calls), 1)
        self.assertGreaterEqual(len(polls), 999)
        self.lines, self.version = [1000], 1
        self.ns['__wasm_idle_debug_trace'](self.frame(1000), 'line', None)
        self.assertEqual(len(calls), 2)
        self.assertEqual(self.events, [(1000, 'breakpoint')])

    def test_large_locals_only_preview_the_requested_page(self):
        frame = self.frame()
        frame.f_locals = {f'value_{index}': index for index in range(10000)}
        calls = []
        self.ns['__wasm_idle_debug_preview'] = lambda value: (calls.append(value), str(value))[1]
        first = self.ns['__wasm_idle_debug_locals'](frame)
        second = self.ns['__wasm_idle_debug_locals'](frame, 50, 50)
        self.assertEqual(len(first), 50)
        self.assertEqual(first[0], {'name': 'value_0', 'value': '0'})
        self.assertEqual(second[0], {'name': 'value_50', 'value': '50'})
        self.assertEqual(calls, list(range(100)))

    def test_clipped_local_names_keep_distinct_display_labels(self):
        frame = self.frame()
        frame.f_locals = {'name_' + 'x' * 300 + suffix: 1 for suffix in ['a', 'b']}
        page = self.ns['__wasm_idle_debug_locals'](frame)
        self.assertNotEqual(page[0]['name'], page[1]['name'])
        self.assertTrue(all(len(value['name']) <= 256 for value in page))

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
        self.assertEqual(len(calls), 1)  # Only an actual pause needs the stack depth.

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

    def test_recursive_step_out_returns_to_the_selected_caller(self):
        self.ns['__wasm_idle_debug_pause_on_entry'] = True
        self.commands = iter([3, 2, 3, 2, 4, 1])
        code = 'def recur(n):\n    if n == 0:\n        return 0\n    value = recur(n - 1)\n    return value + 1\nvalue = recur(2)\nresult = value\n'
        scope = {}
        try:
            sys.settrace(self.ns['__wasm_idle_debug_trace'])
            exec(compile(code, 'user.py', 'exec'), scope)
        finally:
            sys.settrace(None)
        self.assertEqual(scope['result'], 2)
        self.assertEqual(self.events, [(1, 'entry'), (6, 'nextLine'), (2, 'step'),
                                      (4, 'nextLine'), (2, 'step'), (5, 'stepOut')])

    def test_continue_revisits_breakpoints_on_same_line_loop_iterations(self):
        self.lines, self.version = [2], 1
        scope = {}
        try:
            sys.settrace(self.ns['__wasm_idle_debug_trace'])
            exec(compile('value = 0\nwhile value < 3: value += 1\nfinished = value\n', 'user.py', 'exec'), scope)
        finally:
            sys.settrace(None)
        self.assertEqual(scope['finished'], 3)
        self.assertEqual(self.events, [(2, 'breakpoint')] * 3)

    def test_step_commands_stop_on_later_iterations_of_the_same_line(self):
        for command, reason in [(2, 'step'), (3, 'nextLine')]:
            with self.subTest(command=command):
                self.setUp()
                self.ns['__wasm_idle_debug_pause_on_entry'] = True
                self.commands = iter([command] * 4 + [1])
                scope = {}
                try:
                    sys.settrace(self.ns['__wasm_idle_debug_trace'])
                    exec(compile('value = 0\nwhile value < 3: value += 1\nfinished = value\n', 'user.py', 'exec'), scope)
                finally:
                    sys.settrace(None)
                self.assertEqual(scope['finished'], 3)
                self.assertEqual(self.events, [(1, 'entry'), (2, reason), (2, reason), (2, reason), (3, reason)])

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
