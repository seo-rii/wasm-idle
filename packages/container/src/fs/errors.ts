export type FsErrorCode =
  | 'EINVAL' | 'ENOENT' | 'ENOTDIR' | 'EISDIR' | 'EBADF' | 'ELOOP'
  | 'EXDEV' | 'EACCES' | 'EROFS' | 'EEXIST' | 'ENOTEMPTY' | 'ENOSPC'
  | 'EBUSY' | 'ENOTSUP' | 'ECONFLICT';

/** Filesystem errors stay independent of the numeric errno used by a guest ABI. */
export class FsError extends Error {
  override readonly name = 'FsError';
  readonly errno: FsErrorCode;
  constructor(readonly code: FsErrorCode, message: string) {
    super(message);
    this.errno = code;
  }
}
