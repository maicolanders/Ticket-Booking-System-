// @ticket/domain — checkout business rules and persistence, shared by the
// legacy API and the Durable Functions app.
export { prisma } from './db/client';
export { runInTransaction, isRetryableTransactionError, type Tx, type TransactionOptions } from './db/transaction';
export { DomainError, type DomainErrorCode } from './errors';
export * from './auth/tokens';
export { bookingReference, offerToken } from './ids';
export * from './pricing/pricing';
export * from './seats/seats';
export * from './holds/holds';
export * from './bookings/bookings';
export * from './payments/payments';
export { SimulatorPaymentGateway, type SimulatorGatewayConfig } from './payments/simulatorGateway';
export { logger, createLogger, type Logger, type LogFields } from './observability/logger';
export * from './checkout/checkout';
