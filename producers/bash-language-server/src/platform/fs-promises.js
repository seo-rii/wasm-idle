import { promises } from './fs.js';
export const { readFile, readdir, stat, lstat, access } = promises;
