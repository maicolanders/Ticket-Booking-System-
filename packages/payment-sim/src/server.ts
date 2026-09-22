import { createPaymentSimulator } from './app.js';

const port = Number(process.env.PORT ?? 4100);
createPaymentSimulator().listen(port, () => {
  process.stdout.write(`${JSON.stringify({ level: 'info', message: 'payment simulator listening', port })}\n`);
});
