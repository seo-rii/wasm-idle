"""Real CPython execution/cache tests; Pyodide's import finder is a counted stub here."""
import asyncio
import builtins
from pathlib import Path
import sys
import types
import unittest

source = (Path(__file__).resolve().parents[1] / 'src/lib/playground/worker/pythonExecution.ts').read_text()
helper = source.split('String.raw`', 1)[1].split('`;', 1)[0]

class ExecutionTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.find_calls = []
        def find_imports(source):
            self.find_calls.append(source)
            return [] if source == 'invalid' else ['numpy', 'scipy', 'scipy.stats']
        self.previous_module = sys.modules.get('pyodide.code')
        sys.modules['pyodide.code'] = types.SimpleNamespace(find_imports=find_imports)
        self.addCleanup(self.restore_module)
        self.ns = {}
        exec(compile(helper, '<helper>', 'exec'), self.ns)
        self.factory = self.ns['__wasm_idle_make_execution_helpers']
        self.helpers = self.factory('if not globals().get("image_inited"):\n    image_inited = True\n    image_count = globals().get("image_count", 0) + 1')
        self.output = []
        self.ready = 0
        self.native = (builtins.input, builtins.print)

    def restore_module(self):
        if self.previous_module is None:
            sys.modules.pop('pyodide.code', None)
        else:
            sys.modules['pyodide.code'] = self.previous_module

    def mark_ready(self):
        self.ready += 1

    async def execute(self, code, filename='main.py', helpers=None, input=lambda prompt: None):
        await (helpers or self.helpers)['run'](code, filename, self.mark_ready, input,
            lambda *args, **kwargs: self.output.append((args, kwargs)))

    async def test_same_code_reuses_compilation_but_has_fresh_globals(self):
        code = 'assert "value" not in globals()\nvalue = 3\nprint(value, __name__)'
        await self.execute(code); await self.execute(code)
        info = self.helpers['info']()['code']
        self.assertEqual((info['hits'], info['misses']), (1, 1))
        self.assertEqual([item[0] for item in self.output], [(3, '__main__')] * 2)
        self.assertEqual(self.ready, 2)
        self.assertEqual(self.ns['image_count'], 1)

    async def test_filename_is_part_of_cache_key_and_traceback(self):
        code = 'raise ValueError("failure")'
        for filename in ('one.py', 'two.py'):
            try:
                await self.execute(code, filename)
            except ValueError as error:
                import traceback
                self.assertEqual(traceback.extract_tb(error.__traceback__)[-1].filename, filename)
        self.assertEqual(self.helpers['info']()['code']['misses'], 2)

    async def test_top_level_await_runs_each_time(self):
        code = 'import asyncio\nawait asyncio.sleep(0)\nprint("awaited")'
        await self.execute(code); await self.execute(code)
        self.assertEqual([item[0] for item in self.output], [('awaited',)] * 2)

    async def test_syntax_errors_are_not_cached_or_reported_ready(self):
        for _ in range(2):
            with self.assertRaises(SyntaxError):
                await self.execute('def :')
        self.assertEqual(self.ready, 0)
        self.assertEqual(self.helpers['info']()['code']['entries'], 0)
        self.assertEqual((builtins.input, builtins.print), self.native)

    async def test_runtime_exception_restores_builtins_and_next_run_is_clean(self):
        with self.assertRaises(RuntimeError):
            await self.execute('leaked = 1\nraise RuntimeError("bad")')
        self.assertEqual((builtins.input, builtins.print), self.native)
        await self.execute('assert "leaked" not in globals()\nprint(42)')
        self.assertEqual(self.output[-1][0], (42,))

    async def test_input_and_keyword_output_contracts_are_preserved(self):
        await self.execute('print(input("prompt>"), sep="|", end="!")', input=lambda prompt: 'answer\r\n')
        self.assertEqual(self.output, [(('answer',), {'sep': '|', 'end': '!'})])
        with self.assertRaises(EOFError):
            await self.execute('input()')

    async def test_ready_is_not_exposed_in_user_globals(self):
        await self.execute('assert "ready" not in globals()\nassert "runner" not in globals()')
        self.assertEqual(self.ready, 1)

    async def test_lru_eviction_and_budget(self):
        helpers = self.factory('', max_entries=2, max_bytes=10000)
        await self.execute('x=1', helpers=helpers)
        await self.execute('x=2', helpers=helpers)
        await self.execute('x=1', helpers=helpers)
        await self.execute('x=3', helpers=helpers)
        await self.execute('x=2', helpers=helpers)
        info = helpers['info']()['code']
        self.assertEqual(info['entries'], 2)
        self.assertEqual((info['hits'], info['misses']), (1, 4))
        self.assertLessEqual(info['accountedBytes'], 10000)

    async def test_oversized_code_executes_without_being_cached(self):
        helpers = self.factory('', max_bytes=1)
        await self.execute('print(1)', helpers=helpers)
        self.assertEqual(helpers['info']()['code']['entries'], 0)
        self.assertEqual(self.output[-1][0], (1,))

    async def test_import_analysis_is_cached_but_not_package_state(self):
        scan = self.helpers['imports']
        self.assertEqual(scan('source'), 'import numpy\nimport scipy\nimport scipy.stats')
        self.assertEqual(scan('source'), 'import numpy\nimport scipy\nimport scipy.stats')
        self.assertEqual(self.find_calls, ['source'])
        self.assertEqual(scan('invalid'), '')
        self.assertEqual(scan('invalid'), '')
        self.assertEqual(self.find_calls, ['source', 'invalid'])

    async def test_import_cache_is_bounded(self):
        helpers = self.factory('', max_import_entries=2, max_import_bytes=10000)
        for code in ('a', 'b', 'c', 'a'):
            helpers['imports'](code)
        info = helpers['info']()['imports']
        self.assertEqual(info['entries'], 2)
        self.assertEqual(info['misses'], 4)
        self.assertLessEqual(info['accountedBytes'], 10000)

    async def test_future_flags_do_not_leak_to_other_sources(self):
        await self.execute('from __future__ import annotations\nx: Missing = 1\nassert __annotations__["x"] == "Missing"')
        with self.assertRaises(NameError):
            await self.execute('x: Missing = 1\nprint(__annotations__["x"])')


if __name__ == '__main__':
    unittest.main()
