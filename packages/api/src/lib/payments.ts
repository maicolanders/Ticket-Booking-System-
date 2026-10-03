import { SimulatorPaymentGateway, type PaymentGateway } from '@ticket/domain';
import { env } from '../config/env';

/** The API's payment provider, wired from its environment. */
export const paymentGateway: PaymentGateway = new SimulatorPaymentGateway({
  baseUrl: env.PAYMENT_API_URL,
  timeoutMs: env.PAYMENT_TIMEOUT_MS,
});
