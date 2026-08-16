import { MedusaService } from "@medusajs/framework/utils"

import EInvoiceDocument from "./models/einvoice-document.js"
import { buildEInvoice, type EInvoiceResult } from "../../lib/generate.js"
import { createValidationRecord } from "../../lib/attestwire.js"
import type { EInvoicePluginOptions, MedusaOrder } from "../../lib/types.js"

/**
 * The module service.
 *
 * It owns two things and deliberately not a third: the plugin's options, and
 * the stored documents. It does **not** own the mapping — that lives in
 * `src/lib`, framework-free, so it can be tested without a container and reused
 * by anyone who wants to generate an invoice from outside a subscriber.
 */
class EInvoiceModuleService extends MedusaService({ EInvoiceDocument }) {
  protected readonly options_: EInvoicePluginOptions

  constructor({}, options?: EInvoicePluginOptions) {
    // eslint-disable-next-line prefer-rest-params
    super(...arguments)
    this.options_ = (options ?? {}) as EInvoicePluginOptions
  }

  get options(): EInvoicePluginOptions {
    return this.options_
  }

  /** Which events actually trigger generation. Default: order placement only. */
  get enabledEvents(): string[] {
    return this.options_.events ?? ["order.placed"]
  }

  /** Map, validate and generate — no I/O, no persistence. */
  build(order: MedusaOrder): EInvoiceResult {
    return buildEInvoice(order, this.options_)
  }

  /**
   * The hosted layer, if configured. Returns `null` for every failure mode
   * including "not configured", because no caller of this method may treat a
   * missing record as a reason not to have an invoice.
   */
  async createRecord(
    result: EInvoiceResult,
    logger?: { warn: (msg: string) => void }
  ): Promise<string | null> {
    const apiKey = this.options_.attestwireApiKey
    if (!apiKey) return null
    if (this.options_.createValidationRecords === false) return null

    const record = await createValidationRecord(result, {
      apiKey,
      baseUrl: this.options_.attestwireBaseUrl,
      logger,
    })
    return record?.url ?? null
  }

  /** The most recent document for an order, or `null`. */
  async getLatestForOrder(orderId: string) {
    const documents = await this.listEInvoiceDocuments(
      { order_id: orderId },
      { order: { created_at: "DESC" }, take: 1 }
    )
    return documents[0] ?? null
  }
}

export default EInvoiceModuleService
