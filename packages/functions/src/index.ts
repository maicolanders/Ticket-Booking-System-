// Azure Functions entry point: registers every function of the checkout app.
import * as df from 'durable-functions';
import { CHECKOUT_ORCHESTRATOR } from './contracts';
import { checkoutOrchestrator } from './orchestrators/checkoutOrchestrator';
import './activities/checkoutActivities';
import './http/checkouts';
import './timers/recoverAbandonedCheckouts';

df.app.orchestration(CHECKOUT_ORCHESTRATOR, checkoutOrchestrator);
