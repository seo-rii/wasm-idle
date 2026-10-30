// Real GCC programs for the optional, per-run WASI memory filesystem.
// Expected file bytes are independent constants, never derived from guest output.
const c = { language: 'c', emit: 'executable', standard: 'gnu11', simd: false };
const binaryInput = Uint8Array.from([0, 1, 127, 128, 255, 10, 65, 0]);
const binaryOutput = Uint8Array.from([42, 43, 85, 170, 213, 32, 107, 42, 254, 0]);

const baseCases = [
	{
		id: 'filesystem-read-write',
		features: [
			'preopen',
			'binary-fread-fwrite',
			'mkdir',
			'readdir',
			'stat',
			'unlink',
			'rmdir',
			'run-isolation'
		],
		code: `#include <dirent.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
int main(void) {
  int key;
  if (scanf("%d", &key) != 1 || key != 42) return 1;
  FILE *input = fopen("/sandbox/input.bin", "rb");
  if (!input) return 2;
  unsigned char bytes[8], expected[] = {0, 1, 127, 128, 255, 10, 65, 0};
  if (fread(bytes, 1, sizeof bytes, input) != sizeof bytes || memcmp(bytes, expected, sizeof bytes)) return 3;
  if (fgetc(input) != EOF || fclose(input)) return 4;
  struct stat metadata;
  if (stat("/sandbox/input.bin", &metadata) || metadata.st_size != 8 || !S_ISREG(metadata.st_mode)) return 5;
  if (stat("/sandbox/empty", &metadata) || !S_ISDIR(metadata.st_mode)) return 6;
  if (mkdir("/sandbox/results", 0700)) return 7;
  FILE *output = fopen("/sandbox/results/output.bin", "wb");
  if (!output) return 8;
  for (unsigned i = 0; i < sizeof bytes; ++i) bytes[i] ^= key;
  if (fwrite(bytes, 1, sizeof bytes, output) != sizeof bytes || fclose(output)) return 9;
  output = fopen("/sandbox/results/output.bin", "ab");
  const unsigned char suffix[] = {254, 0};
  if (!output || fwrite(suffix, 1, sizeof suffix, output) != sizeof suffix || fclose(output)) return 10;
  output = fopen("/sandbox/results/output.bin", "rb");
  if (!output || fseek(output, 0, SEEK_END) || ftell(output) != 10 || fclose(output)) return 11;
  DIR *directory = opendir("/sandbox");
  if (!directory) return 12;
  int seen = 0;
  struct dirent *entry;
  while ((entry = readdir(directory))) {
    if (!strcmp(entry->d_name, "input.bin")) seen |= 1;
    if (!strcmp(entry->d_name, "nested")) seen |= 2;
    if (!strcmp(entry->d_name, "empty")) seen |= 4;
    if (!strcmp(entry->d_name, "results")) seen |= 8;
  }
  if (closedir(directory) || seen != 15) return 13;
  FILE *temporary = fopen("/sandbox/temporary", "wb");
  if (!temporary || fputs("remove me", temporary) < 0 || fclose(temporary)) return 14;
  if (unlink("/sandbox/temporary") || mkdir("/sandbox/temporary-dir", 0700) || rmdir("/sandbox/temporary-dir")) return 15;
  printf("files %d %u\\n", key, (unsigned)sizeof bytes);
  return 0;
}
`,
		stdin: '42\n',
		stdout: 'files 42 8\n',
		runOptions: {
			preopens: [
				{
					path: '/sandbox',
					directories: ['empty', 'nested'],
					files: [
						{ path: 'input.bin', contents: binaryInput },
						{ path: 'nested/seed.txt', contents: 'seed\n' }
					]
				}
			]
		},
		expectedFiles: [
			{ path: '/sandbox/input.bin', contents: binaryInput },
			{ path: '/sandbox/nested/seed.txt', contents: 'seed\n' },
			{ path: '/sandbox/results/output.bin', contents: binaryOutput }
		],
		repeatRuns: 2
	},
	{
		id: 'filesystem-path-errors',
		features: ['preopen', 'missing-file', 'path-escape', 'relative-path-normalization'],
		code: `#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
int main(void) {
  errno = 0;
  int missing = open("/sandbox/missing.txt", O_RDONLY);
  if (missing != -1 || errno != ENOENT) return 1;
  DIR *directory = opendir("/sandbox");
  if (!directory) return 2;
  errno = 0;
  int escaped = openat(dirfd(directory), "../outside.txt", O_RDONLY);
  if (escaped != -1 || (errno != ENOTCAPABLE && errno != EACCES)) return 3;
  int normalized = openat(dirfd(directory), "./nested/../input.txt", O_RDONLY);
  if (normalized < 0) return 4;
  char text[5];
  if (read(normalized, text, sizeof text) != sizeof text || memcmp(text, "safe\\n", sizeof text)) return 5;
  if (close(normalized) || closedir(directory)) return 6;
  puts("path errors ok");
  return 0;
}
`,
		stdin: '',
		stdout: 'path errors ok\n',
		runOptions: {
			preopens: [
				{
					path: '/sandbox',
					directories: ['nested'],
					files: [{ path: 'input.txt', contents: 'safe\n' }]
				}
			]
		},
		expectedFiles: [{ path: '/sandbox/input.txt', contents: 'safe\n' }]
	},
	{
		id: 'filesystem-readonly',
		features: ['readonly-preopen', 'write-rejection', 'directory-mutation-rejection'],
		code: `#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
int main(void) {
  FILE *input = fopen("/readonly/input.txt", "rb");
  char text[10];
  if (!input || fread(text, 1, sizeof text, input) != sizeof text || memcmp(text, "immutable\\n", sizeof text) || fclose(input)) return 1;
  errno = 0;
  FILE *output = fopen("/readonly/input.txt", "wb");
  if (output || errno != EROFS) return 2;
  errno = 0;
  output = fopen("/readonly/new.txt", "wb");
  if (output || errno != EROFS) return 3;
  errno = 0;
  if (unlink("/readonly/input.txt") != -1 || errno != EROFS) return 4;
  errno = 0;
  if (mkdir("/readonly/new-dir", 0700) != -1 || errno != EROFS) return 5;
  errno = 0;
  if (rmdir("/readonly/empty") != -1 || errno != EROFS) return 6;
  puts("readonly errors ok");
  return 0;
}
`,
		stdin: '',
		stdout: 'readonly errors ok\n',
		runOptions: {
			preopens: [
				{
					path: '/readonly',
					readonly: true,
					directories: ['empty'],
					files: [{ path: 'input.txt', contents: 'immutable\n' }]
				}
			]
		},
		expectedFiles: [{ path: '/readonly/input.txt', contents: 'immutable\n' }],
		nodeWasiUnsupported:
			'Node WASI preopens do not expose a read-only mount contract; checked by the actual GCC program in the SDK Chromium Worker.'
	},
	{
		id: 'filesystem-file-quota',
		features: ['file-byte-quota', 'quota-errno', 'failed-write-preserves-bytes'],
		code: `#include <errno.h>
#include <stdio.h>
int main(void) {
  FILE *file = fopen("/quota/kept.bin", "r+b");
  if (!file || setvbuf(file, 0, _IONBF, 0) || fseek(file, 4, SEEK_SET)) return 1;
  const unsigned char more[] = {5, 6};
  errno = 0;
  if (fwrite(more, 1, sizeof more, file) != 0 || errno != ENOSPC || !ferror(file)) return 2;
  fclose(file);
  puts("file quota ok");
  return 0;
}
`,
		stdin: '',
		stdout: 'file quota ok\n',
		runOptions: {
			preopens: [
				{
					path: '/quota',
					files: [{ path: 'kept.bin', contents: Uint8Array.from([1, 2, 3, 4]) }]
				}
			],
			filesystemLimits: { maxFileBytes: 4 }
		},
		expectedFiles: [{ path: '/quota/kept.bin', contents: Uint8Array.from([1, 2, 3, 4]) }],
		nodeWasiUnsupported:
			'Node WASI preopens do not expose per-file memory quotas; checked by the actual GCC program in the SDK Chromium Worker.'
	},
	{
		id: 'filesystem-total-quota',
		features: ['total-byte-quota', 'quota-errno', 'failed-write-preserves-bytes'],
		code: `#include <errno.h>
#include <stdio.h>
int main(void) {
  FILE *file = fopen("/quota/b.bin", "ab");
  if (!file || setvbuf(file, 0, _IONBF, 0)) return 1;
  errno = 0;
  if (fputc(7, file) != EOF || errno != ENOSPC || !ferror(file)) return 2;
  fclose(file);
  puts("total quota ok");
  return 0;
}
`,
		stdin: '',
		stdout: 'total quota ok\n',
		runOptions: {
			preopens: [
				{
					path: '/quota',
					files: [
						{ path: 'a.bin', contents: Uint8Array.from([1, 2, 3, 4]) },
						{ path: 'b.bin', contents: Uint8Array.from([5, 6]) }
					]
				}
			],
			filesystemLimits: { maxFileBytes: 8, maxTotalBytes: 6 }
		},
		expectedFiles: [
			{ path: '/quota/a.bin', contents: Uint8Array.from([1, 2, 3, 4]) },
			{ path: '/quota/b.bin', contents: Uint8Array.from([5, 6]) }
		],
		nodeWasiUnsupported:
			'Node WASI preopens do not expose total memory quotas; checked by the actual GCC program in the SDK Chromium Worker.'
	},
	{
		id: 'filesystem-entry-quota',
		features: ['entry-quota', 'quota-errno', 'unlink-reclaims-entry', 'rmdir-reclaims-entry'],
		code: `#include <errno.h>
#include <stdio.h>
#include <sys/stat.h>
#include <unistd.h>
int main(void) {
  errno = 0;
  FILE *file = fopen("/quota/new.bin", "wb");
  if (file || errno != ENOSPC) return 1;
  errno = 0;
  if (mkdir("/quota/new-dir", 0700) != -1 || errno != ENOSPC) return 2;
  if (unlink("/quota/kept.txt")) return 3;
  file = fopen("/quota/replacement.bin", "wb");
  if (!file || fputc(9, file) == EOF || fclose(file)) return 4;
  if (rmdir("/quota/existing") || mkdir("/quota/replacement-dir", 0700)) return 5;
  puts("entry quota ok");
  return 0;
}
`,
		stdin: '',
		stdout: 'entry quota ok\n',
		runOptions: {
			preopens: [
				{
					path: '/quota',
					directories: ['existing'],
					files: [{ path: 'kept.txt', contents: 'kept\n' }]
				}
			],
			filesystemLimits: { maxEntries: 3 }
		},
		expectedFiles: [{ path: '/quota/replacement.bin', contents: Uint8Array.from([9]) }],
		nodeWasiUnsupported:
			'Node WASI preopens do not expose memory entry quotas; checked by the actual GCC program in the SDK Chromium Worker.'
	},
	{
		id: 'filesystem-no-preopens',
		features: ['no-preopen-default', 'stdin', 'stdout', 'empty-file-snapshot'],
		code: `#include <errno.h>
#include <stdio.h>
int main(void) {
  int value;
  if (scanf("%d", &value) != 1 || value != 42) return 1;
  errno = 0;
  FILE *file = fopen("/sandbox/input.bin", "rb");
  if (file || errno != ENOENT) return 2;
  printf("no preopens %d\\n", value);
  return 0;
}
`,
		stdin: '42\n',
		stdout: 'no preopens 42\n',
		expectedFiles: []
	}
];

export const cases = baseCases.flatMap(({ code, ...fixture }) =>
	['0', '2'].map((optimization) => ({
		...fixture,
		id: `${fixture.id}-o${optimization}`,
		request: { ...c, optimization, code }
	}))
);
