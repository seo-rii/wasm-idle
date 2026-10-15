import assert from 'node:assert/strict';
import test from 'node:test';
import { dependencyPaths } from '../fixtures/clang-headers/runner.mjs';

test('decodes actual Make filename escapes without interpreting shell syntax', () => {
  assert.deepEqual(dependencyPaths('container-header-probe: /workspace/a\\ b/한글.c \\\n /workspace/$$\\#\\\\file.h\n'), [
    '/workspace/a b/한글.c', '/workspace/$#\\file.h'
  ]);
});

test('rejects a foreign target, truncated escape, NUL and empty dependency rule', () => {
  for (const contents of ['output.o: source.c', 'container-header-probe: source.c\\', 'container-header-probe: a\0b', 'container-header-probe: \n', 'container-header-probe: source.c\nother: unrelated.h'])
    assert.throws(() => dependencyPaths(contents));
});
