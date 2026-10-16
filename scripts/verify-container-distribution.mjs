import { verifyContainerDistribution } from './container-distribution.mjs';
const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--directory' || args[2] !== '--expected-sha256')
  throw new Error('Usage: node scripts/verify-container-distribution.mjs --directory DIRECTORY --expected-sha256 INDEPENDENT_LOCK_DIGEST');
console.log(JSON.stringify(await verifyContainerDistribution({ directory: args[1], expectedSha256: args[3] }), null, 2));
