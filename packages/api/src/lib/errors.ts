import { DomainError, type DomainErrorCode } from '@ticket/domain';


export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details);
export const unauthorized = (message = 'Unauthorized') => new HttpError(401, message);
export const forbidden = (message = 'Forbidden') => new HttpError(403, message);
export const notFound = (message = 'Not found') => new HttpError(404, message);
export const conflict = (message: string, details?: unknown) => new HttpError(409, message, details);
export const paymentRequired = (message: string) => new HttpError(402, message);
export const gone = (message = 'This resource has expired') => new HttpError(410, message);

const STATUS_BY_DOMAIN_CODE: Record<DomainErrorCode, number> = {
  invalid: 400,
  not_found: 404,
  conflict: 409,
  expired: 410,
};

/** Translate a business-rule refusal from @ticket/domain into its HTTP status; pass anything else through. */
export const toHttpError = (error: unknown): unknown =>
  error instanceof DomainError
    ? new HttpError(STATUS_BY_DOMAIN_CODE[error.code], error.message, error.details)
    : error;

/** `.catch(rethrowAsHttp)` on a domain call keeps the legacy services' HttpError contract. */
export const rethrowAsHttp = (error: unknown): never => {
  throw toHttpError(error);
};
