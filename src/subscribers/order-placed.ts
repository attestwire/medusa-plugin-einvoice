import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

import { generateEInvoiceWorkflow } from "../workflows/generate-einvoice.js"
import { EINVOICE_MODULE } from "../modules/einvoice/index.js"
import type EInvoiceModuleService from "../modules/einvoice/service.js"

/**
 * Generate the invoice when the order is placed.
 *
 * WHY BOTH EVENTS ARE SUBSCRIBED AND THEN FILTERED AT RUNTIME. `config.event`
 * is a module-level export, evaluated when Medusa loads the file — before any
 * plugin options exist. There is no way to make the subscribed event list
 * itself configurable. So this file subscribes to both order events and asks
 * the module service, at handling time, whether the one that fired is enabled.
 * The default is `order.placed` alone: that is when the money is committed and
 * when most jurisdictions consider the invoice due.
 *
 * `payment.captured` is deliberately **not** here. Its payload is a payment id,
 * not an order id, so wiring it needs a payment→payment-collection→order
 * lookup, and getting that wrong generates an invoice against the wrong order.
 * If you want it, call `generateEInvoiceWorkflow` from your own subscriber with
 * the order id you resolved.
 */
export default async function handleOrderEvent({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const service = container.resolve(EINVOICE_MODULE) as EInvoiceModuleService
  const logger = container.resolve("logger") as { error: (msg: string) => void }

  if (!service.enabledEvents.includes(event.name)) return

  try {
    await generateEInvoiceWorkflow(container).run({
      input: { order_id: event.data.id },
    })
  } catch (err) {
    // A failed invoice must never fail the order. The workflow already logged
    // the rule ids; this catch exists so an unexpected throw — a database
    // hiccup, a bug here — cannot roll back a placed order.
    logger.error(
      `[einvoice] generation threw for order ${event.data.id}: ${
        (err as Error).message
      }. The order is unaffected; retry from the admin panel.`
    )
  }
}

export const config: SubscriberConfig = {
  event: ["order.placed", "order.completed"],
  context: { subscriberId: "einvoice-order-generate" },
}
