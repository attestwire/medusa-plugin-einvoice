import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { Modules } from "@medusajs/framework/utils"

import { EINVOICE_MODULE } from "../modules/einvoice/index.js"
import type EInvoiceModuleService from "../modules/einvoice/service.js"
import type { EInvoiceResult } from "../lib/generate.js"
import type { MedusaOrder } from "../lib/types.js"

/**
 * Every field the mapping reads.
 *
 * Named explicitly rather than with `"*"`: a wildcard on an order silently
 * force-loads every relation and computes every total on a query that runs once
 * per placed order. It is also documentation — this list *is* the answer to
 * "what does the plugin look at".
 */
export const EINVOICE_ORDER_FIELDS = [
  "id",
  "display_id",
  "custom_display_id",
  "email",
  "currency_code",
  "created_at",
  "status",
  "metadata",
  "total",
  "subtotal",
  "tax_total",
  "discount_total",
  "shipping_total",
  "item_total",
  "billing_address.*",
  "shipping_address.*",
  "items.id",
  "items.title",
  "items.subtitle",
  "items.product_title",
  "items.product_description",
  "items.variant_title",
  "items.variant_sku",
  "items.variant_barcode",
  "items.product_id",
  "items.variant_id",
  "items.quantity",
  "items.unit_price",
  "items.is_tax_inclusive",
  "items.metadata",
  "items.subtotal",
  "items.total",
  "items.tax_total",
  "items.discount_total",
  "items.tax_lines.*",
  "items.adjustments.*",
  "shipping_methods.id",
  "shipping_methods.name",
  "shipping_methods.amount",
  "shipping_methods.is_tax_inclusive",
  "shipping_methods.metadata",
  "shipping_methods.tax_lines.*",
  "shipping_methods.adjustments.*",
]

export interface GenerateEInvoiceInput {
  order_id: string
  /** Regenerate even if a document already exists for this order. */
  force?: boolean
}

export interface GenerateEInvoiceOutput {
  /** `null` when a document already existed and `force` was not set. */
  document_id: string | null
  invoice_number: string
  valid: boolean
  profile: string
  record_url: string | null
  errors: EInvoiceResult["errors"]
  warnings: EInvoiceResult["warnings"]
  skipped?: "already_generated"
}

const fetchOrderStep = createStep(
  "einvoice-fetch-order",
  async (input: GenerateEInvoiceInput, { container }) => {
    const query = container.resolve("query") as {
      graph: (args: unknown) => Promise<{ data: MedusaOrder[] }>
    }
    const { data } = await query.graph({
      entity: "order",
      fields: EINVOICE_ORDER_FIELDS,
      filters: { id: input.order_id },
    })
    return new StepResponse(data[0] ?? null)
  }
)

const buildStep = createStep(
  "einvoice-build",
  async (input: { order: MedusaOrder | null; force?: boolean }, { container }) => {
    const service = container.resolve(EINVOICE_MODULE) as EInvoiceModuleService
    if (!input.order) {
      return new StepResponse<{ result: EInvoiceResult | null; existing: boolean }>({
        result: null,
        existing: false,
      })
    }

    if (!input.force) {
      const existing = await service.getLatestForOrder(input.order.id as string)
      if (existing) {
        return new StepResponse({ result: null, existing: true })
      }
    }

    // Pure: no I/O, no persistence, so no compensation is needed and a retry
    // produces byte-identical XML.
    return new StepResponse({ result: service.build(input.order), existing: false })
  }
)

const recordStep = createStep(
  "einvoice-validation-record",
  async (input: { result: EInvoiceResult | null }, { container }) => {
    if (!input.result) return new StepResponse<string | null>(null)
    const service = container.resolve(EINVOICE_MODULE) as EInvoiceModuleService
    const logger = container.resolve("logger") as { warn: (msg: string) => void }
    const url = await service.createRecord(input.result, logger)
    return new StepResponse(url)
  }
)

const persistStep = createStep(
  "einvoice-persist",
  async (
    input: { order: MedusaOrder | null; result: EInvoiceResult | null; recordUrl: string | null },
    { container }
  ) => {
    if (!input.result || !input.order) return new StepResponse<{ id: string } | null>(null)

    const service = container.resolve(EINVOICE_MODULE) as EInvoiceModuleService
    const options = service.options
    const { result } = input

    const [document] = await service.createEInvoiceDocuments([
      {
        order_id: input.order.id as string,
        invoice_number: result.invoiceNumber,
        profile: result.profile,
        syntax: result.syntax,
        currency: result.currency,
        valid: result.valid,
        xml: options.storeXml === false ? null : (result.xml ?? null),
        report: {
          errors: result.errors,
          warnings: result.warnings,
          information: result.information,
          notes: result.notes,
          reconciliation: result.reconciliation,
          generation_error: result.generationError ?? null,
        },
        record_url: input.recordUrl,
      },
    ])

    return new StepResponse({ id: document.id }, { id: document.id })
  },
  async (compensation, { container }) => {
    if (!compensation) return
    const service = container.resolve(EINVOICE_MODULE) as EInvoiceModuleService
    await service.deleteEInvoiceDocuments(compensation.id)
  }
)

const writeOrderMetadataStep = createStep(
  "einvoice-write-order-metadata",
  async (
    input: {
      order: MedusaOrder | null
      result: EInvoiceResult | null
      recordUrl: string | null
      documentId: string | null
    },
    { container }
  ) => {
    const service = container.resolve(EINVOICE_MODULE) as EInvoiceModuleService
    const options = service.options
    if (options.writeOrderMetadata === false) return new StepResponse(null)
    if (!input.result || !input.order) return new StepResponse(null)

    const orderModule = container.resolve(Modules.ORDER) as {
      updateOrders: (data: unknown) => Promise<unknown>
    }
    const key = options.metadataKey ?? "einvoice"
    const previous = input.order.metadata ?? {}

    // The summary, not the document. Order metadata is returned by the Store
    // API on every order read, so putting 40 kB of XML in it would ship the
    // whole invoice to the storefront on every fetch.
    const summary = {
      document_id: input.documentId,
      invoice_number: input.result.invoiceNumber,
      profile: input.result.profile,
      syntax: input.result.syntax,
      valid: input.result.valid,
      generated_at: new Date().toISOString(),
      record_url: input.recordUrl,
      errors: input.result.errors.map((e) => ({
        rule: e.rule,
        field: e.field,
        message: e.message,
        fix: e.fix,
        docs: e.docsUrl,
      })),
      warnings: input.result.warnings.map((w) => ({
        rule: w.rule,
        message: w.message,
        docs: w.docsUrl,
      })),
      notes: input.result.notes,
      reconciliation: input.result.reconciliation,
    }

    await orderModule.updateOrders({
      id: input.order.id,
      metadata: { ...previous, [key]: summary },
    })

    return new StepResponse({ orderId: input.order.id as string, previous, key }, {
      orderId: input.order.id as string,
      previous,
      key,
    })
  },
  async (compensation, { container }) => {
    if (!compensation) return
    const orderModule = container.resolve(Modules.ORDER) as {
      updateOrders: (data: unknown) => Promise<unknown>
    }
    await orderModule.updateOrders({
      id: compensation.orderId,
      metadata: compensation.previous,
    })
  }
)

const logStep = createStep(
  "einvoice-log",
  async (input: { result: EInvoiceResult | null; existing: boolean }, { container }) => {
    const logger = container.resolve("logger") as {
      info: (msg: string) => void
      warn: (msg: string) => void
      error: (msg: string) => void
    }

    if (input.existing) return new StepResponse(null)
    if (!input.result) {
      logger.warn("[einvoice] no order found; nothing generated.")
      return new StepResponse(null)
    }

    const { result } = input
    if (result.valid) {
      logger.info(
        `[einvoice] ${result.invoiceNumber}: ${result.profile} (${result.syntax}) generated and valid.`
      )
    } else {
      // The whole point of the library: a failure names the rule and links to
      // the page that explains it. One line per finding, because a developer
      // fixing an invoice needs all of them at once, not the first.
      logger.error(
        `[einvoice] ${result.invoiceNumber}: ${result.profile} FAILED validation with ${result.errors.length} error(s). The document was stored but must not be sent.`
      )
      for (const error of result.errors) {
        logger.error(`[einvoice]   ${error.rule} (${error.field}): ${error.message}`)
        logger.error(`[einvoice]     fix: ${error.fix}`)
        logger.error(`[einvoice]     ${error.docsUrl}`)
      }
      if (result.generationError) {
        logger.error(
          `[einvoice]   generation failed: ${result.generationError.code} — ${result.generationError.message}`
        )
      }
    }

    for (const note of result.notes) {
      const line = `[einvoice]   note ${note.code}: ${note.message}`
      if (note.level === "warning") logger.warn(line)
      else logger.info(line)
    }

    return new StepResponse(null)
  }
)

/**
 * Order → validated EN 16931 document, stored.
 *
 * Exposed as a workflow rather than as a service method so it is retryable,
 * compensatable and callable from anywhere — a subscriber, the admin route, a
 * scheduled backfill job, or a shop's own code.
 */
export const generateEInvoiceWorkflow = createWorkflow(
  "generate-einvoice",
  function (input: GenerateEInvoiceInput) {
    const order = fetchOrderStep(input)
    const built = buildStep({ order, force: input.force })
    const recordUrl = recordStep({ result: built.result })
    const document = persistStep({ order, result: built.result, recordUrl })
    writeOrderMetadataStep({
      order,
      result: built.result,
      recordUrl,
      documentId: document?.id ?? null,
    })
    logStep({ result: built.result, existing: built.existing })

    return new WorkflowResponse({
      document_id: document?.id ?? null,
      invoice_number: built.result?.invoiceNumber ?? "",
      valid: built.result?.valid ?? false,
      profile: built.result?.profile ?? "",
      record_url: recordUrl,
      errors: built.result?.errors ?? [],
      warnings: built.result?.warnings ?? [],
      skipped: built.existing ? "already_generated" : undefined,
    } as unknown as GenerateEInvoiceOutput)
  }
)

export default generateEInvoiceWorkflow
