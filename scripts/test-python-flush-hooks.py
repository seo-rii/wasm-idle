"""Execute the actual embedded helper with native CPython streams (not Pyodide)."""
import io
from pathlib import Path
import sys
import unittest

source = (Path(__file__).resolve().parents[1] / 'src/lib/playground/worker/pythonStdio.ts').read_text()
helper = source.split('PYTHON_FLUSH_HOOK_FACTORY = String.raw`', 1)[1].split('`;', 1)[0]

class FlushTests(unittest.TestCase):
    def setUp(self):
        self.original = (sys.stdout, sys.stderr)
        self.bytes = io.BytesIO()
        self.errbytes = io.BytesIO()
        self.out = io.TextIOWrapper(self.bytes, encoding='utf-8', line_buffering=True)
        self.err = io.TextIOWrapper(self.errbytes, encoding='utf-8', line_buffering=True)
        sys.stdout, sys.stderr = self.out, self.err
        self.namespace = {}
        exec(compile(helper, '<stdio-helper>', 'exec'), self.namespace)
        self.drains = 0
        self.restore = self.namespace['__wasm_idle_flush_installer'](self.drain)

    def drain(self):
        self.drains += 1

    def tearDown(self):
        try:
            self.restore()
        finally:
            sys.stdout, sys.stderr = self.original

    def test_native_print_and_implicit_line_flush_do_not_force_host_messages(self):
        for _ in range(10):
            print('한글', True, None, sep='|')
        self.assertEqual(self.drains, 0)
        self.assertEqual(self.bytes.getvalue().decode(), '한글|True|None\n' * 10)

    def test_print_flush_true_is_observed(self):
        print('prompt', end='', flush=True)
        self.assertGreater(self.drains, 0)
        self.assertEqual(self.bytes.getvalue(), b'prompt')

    def test_explicit_binary_flush_is_observed(self):
        sys.stdout.buffer.write(b'bytes')
        sys.stdout.buffer.flush()
        self.assertGreater(self.drains, 0)
        self.assertEqual(self.bytes.getvalue(), b'bytes')

    def test_custom_file_target_and_stream_identity_are_preserved(self):
        target = io.StringIO()
        print('custom', file=target, end='!')
        self.assertEqual(target.getvalue(), 'custom!')
        self.assertIs(sys.stdout, self.out)
        self.assertEqual(sys.stdout.encoding, 'utf-8')
        self.assertEqual(self.drains, 0)

    def test_restore_flushes_pending_data_and_removes_instance_overrides(self):
        print('pending', end='')
        self.restore()
        self.assertEqual(self.bytes.getvalue(), b'pending')
        self.assertNotIn('write', vars(self.out))
        self.assertNotIn('flush', vars(self.out))
        self.assertNotIn('flush', vars(self.bytes))

    def test_cleanup_is_idempotent(self):
        self.restore()
        count = self.drains
        self.restore()
        self.assertEqual(self.drains, count)

if __name__ == '__main__':
    unittest.main()
