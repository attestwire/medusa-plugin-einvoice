import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { generateEInvoiceWorkflow } from "../../../../../workflows/generate-einvoice.js"
import { EINVOICE_MODULE } from "../../../../../modules/einvoice/index.js"
import type EInvoiceModuleService from "../../../../../modules/einvoice/service.js"

/**
 * `GET /admin/orders/:id/einvoice`
 *
 * Default: the report as JSON. `?format=xml` streams the document itself as a
 * download — the file a user actually needs to upload to a portal or hand to an
 * access point.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const service = req.scope.resolve(EINVOICE_MODULE) as EInvoiceModuleService
  const orderId = req.params.id
  const document = await service.getLatestForOrder(orderId)

  if (!document) {
    res.status(404).json({
      message: "No e-invoice has been generated for this order yet.",
      order_id: orderId,
    })
    return
  }

  if (req.query.format === "xml") {
    if (!document.xml) {
      res.status(409).json({
        message:
          "This e-invoice was stored without its XML (storeXml is off, or generation failed). The report is still available.",
        report: document.report,
      })
      return
    }
    const filename = `${document.invoice_number}-${document.syntax}.xml`
    res.setHeader("Content-Type", "application/xml; charset=utf-8")
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)
    res.send(document.xml)
    return
  }

  res.json({ einvoice: document })
}

/**
 * `POST /admin/orders/:id/einvoice`
 *
 * Generate, or regenerate with `{ "force": true }`.
 *
 * ⚠ Regenerating mints a document with the **same invoice number** as the one
 * it replaces. That is correct while an invoice is unsent and wrong once it has
 * been: a corrected invoice needs its own number and a BG-3 reference back to
 * the original. The plugin does not stop you, because it cannot know whether
 * the document left the building — but the old row is kept, not overwritten, so
 * the history survives.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const orderId = req.params.id
  const force = (req.body as { force?: boolean } | undefined)?.force === true

  const { result } = await generateEInvoiceWorkflow(req.scope).run({
    input: { order_id: orderId, force },
  })

  res.status(result.valid ? 200 : 422).json({ einvoice: result })
}
