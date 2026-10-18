import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { createReleaseExampleServer } from '../../../examples/container/serve-release.mjs';
import { runProductShellBrowser } from './test-product-shell-browser.mjs';
import { readPinnedProbeInputs, digest } from '../../../scripts/probe-container-shell-acceptance-lib.mjs';

const args = process.argv.slice(2);
assert(args.length === 8 && args[0] === '--directory' && args[2] === '--expected-sha256' && args[4] === '--config' && args[6] === '--output',
  'Use --directory IMMUTABLE_RELEASE --expected-sha256 LOCK_DIGEST --config PINNED_CONFIG --output NEW_EVIDENCE');
assert([args[1], args[5], args[7]].every(isAbsolute), 'Absolute paths required');
const outputRelation = relative(resolve(args[1]), resolve(args[7]));
assert(outputRelation === '..' || outputRelation.startsWith(`..${sep}`) || isAbsolute(outputRelation), 'Browser evidence must be outside the immutable release directory');
const configBytes = await readFile(args[5]), configuration = JSON.parse(configBytes);
await readPinnedProbeInputs(configuration);
const application = await createReleaseExampleServer({ directory: args[1], expectedSha256: args[3] });
try { await runProductShellBrowser({ configuration, configurationSha256: digest(configBytes), output: args[7], application }); }
finally { await application.close(); }
