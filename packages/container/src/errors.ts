export type ContainerErrorCode =
  | 'INVALID_ARGUMENT' | 'DISPOSED' | 'COMMAND_NOT_FOUND' | 'UNSUPPORTED_PROFILE'
  | 'STARTUP_FAILED' | 'ABORTED' | 'RESOURCE_LIMIT' | 'CAPTURE_LIMIT'
  | 'INVALID_DISTRIBUTION' | 'INTEGRITY' | 'FILESYSTEM_BUSY' | 'FILESYSTEM_CONFLICT';

/** Host failures are distinct from a guest's ordinary nonzero exit. */
export class ContainerError extends Error {
  override readonly name = 'ContainerError';
  constructor(readonly code: ContainerErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
  }
}
