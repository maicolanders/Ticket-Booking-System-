/** Why a business rule refused an operation. Hosts map these to their protocol (HTTP status, checkout status). */
export type DomainErrorCode = 'invalid' | 'not_found' | 'conflict' | 'expired';

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
