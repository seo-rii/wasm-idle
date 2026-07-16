import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pythonSourceDir = path.resolve(packageRoot, 'src', 'python', 'package');
const pythonOutputDir = path.resolve(packageRoot, 'dist', 'python', 'package');

await mkdir(path.dirname(pythonOutputDir), { recursive: true });
await cp(pythonSourceDir, pythonOutputDir, { recursive: true });
