import { model } from "@medusajs/framework/utils"

/**
 * One generated e-invoice, kept because the XML *is* the tax record.
 *
 * WHY THE XML IS STORED AND NOT REGENERATED ON DEMAND. An invoice is a
 * statement made on a date. Regenerating it later from the live order would
 * produce a different document the moment the seller's address changes, a
 * promotion is edited, or this plugin's mapping is improved — and a tax
 * authority comparing the two would be looking at two different invoices with
 * the same number. So the document is written once and read back verbatim.
 *
 * The findings are stored beside it for the same reason: "this document failed
 * BR-DE-15 when we made it" is the fact worth keeping, and it does not survive
 * a re-validation against a newer ruleset.
 */
const EInvoiceDocument = model
  .define("einvoice_document", {
    id: model.id({ prefix: "einv" }).primaryKey(),
    /** The Medusa order this was generated from. Not a foreign key: the Order
     *  module is a separate module and cross-module relations go through links. */
    order_id: model.text().index("IDX_einvoice_document_order_id"),
    /** BT-1. Unique per seller in law; unique per shop here. */
    invoice_number: model.text(),
    /** EN 16931 profile, e.g. `xrechnung-ubl`. */
    profile: model.text(),
    /** `ubl` or `cii`. Derivable from the profile, stored so a query can filter. */
    syntax: model.text(),
    /** BT-5 currency, uppercase ISO 4217. */
    currency: model.text(),
    /** The engine's verdict at generation time. */
    valid: model.boolean().default(false),
    /** The document. Null only when generation itself threw. */
    xml: model.text().nullable(),
    /** Findings, as `{ errors, warnings, information, notes, reconciliation }`. */
    report: model.json().nullable(),
    /** Shareable Attestwire Validation Record URL, when the hosted layer is on. */
    record_url: model.text().nullable(),
    /** Version of @attestwire/en16931 that produced this document. */
    engine_version: model.text().nullable(),
  })
  .indexes([
    {
      // One document per invoice number, so a re-run of the subscriber after a
      // retry cannot mint a second invoice with the same number.
      on: ["invoice_number"],
      unique: true,
      where: "deleted_at IS NULL",
    },
  ])

export default EInvoiceDocument
