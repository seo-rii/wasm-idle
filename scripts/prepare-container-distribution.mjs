import { prepareContainerDistribution } from './container-distribution.mjs';
const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--input' || args[2] !== '--output')
  throw new Error('Usage: node scripts/prepare-container-distribution.mjs --input recipe.json --output NEW_DIRECTORY');
console.log(JSON.stringify(await prepareContainerDistribution({ input: args[1], output: args[3] }), null, 2));
