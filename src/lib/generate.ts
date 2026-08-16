/**
 * Validate first, then generate. Never the other way round.
 *
 * The engine's generators compute their own totals and will happily emit a
 * well-formed document from an input that no tax authority will accept — a
 * missing Leitweg-ID, a buyer with no post code, a reverse charge with no buyer
 * VAT id. Emitting first and validating afterwards would mean the failure is
 * discovered by the receiver. So: `validateInput` runs, the findings are kept
 * whatever the verdict, and generation runs anyway (a rejected document is
 * still the most useful thing to show someone who has to fix it) — but the
 * result is flagged `valid: false` and nothing downstream may treat it as
 * sendable.
 */

import {
  computeTotals,
  generateCii,
  generateXRechnungUBL,
  validateInput,
  type InvoiceInput,
  type Profile,
  type TeachingError,
} from "@attestwire/en16931"

import { mapOrderToInvoiceInput, reconcileTotals, type Reconciliation } from "./mapping"
import { syntaxFor, type Syntax } from "./profile"
import type { EInvoicePluginOptions, MappingNote, MedusaOrder } from "./types"

export interface FindingSummary {
  rule: string
  field: string
  severity: TeachingError["severity"]
  message: string
  fix: string
  /** `https://attestwire.com/rules/<ID>` — one page per rule. */
  docsUrl: string
}

export interface EInvoiceResult {
  valid: boolean
  profile: Profile
  syntax: Syntax
  invoiceNumber: string
  currency: string
  /** `undefined` only when generation itself threw. */
  xml?: string
  errors: FindingSummary[]
  warnings: FindingSummary[]
  information: FindingSummary[]
  notes: MappingNote[]
  reconciliation: Reconciliation
  /** Present when generation threw; carries the engine's stable error code. */
  generationError?: { code: string; message: string }
  input: InvoiceInput
}

function summarise(finding: TeachingError): FindingSummary {
  return {
    rule: finding.rule,
    field: Array.isArray(finding.field) ? finding.field.join(", ") : finding.field,
    severity: finding.severity,
    message: finding.message,
    fix: finding.fix,
    docsUrl: finding.docsUrl,
  }
}

export function generateForInput(
  input: InvoiceInput,
  syntax: Syntax
): { xml?: string; error?: { code: string; message: string } } {
  try {
    const xml = syntax === "cii" ? generateCii(input) : generateXRechnungUBL(input)
    return { xml }
  } catch (err) {
    const error = err as { code?: string; message?: string }
    return {
      error: {
        code: error.code ?? "GENERATION_FAILED",
        message: error.message ?? String(err),
      },
    }
  }
}

export function buildEInvoice(
  order: MedusaOrder,
  options: EInvoicePluginOptions
): EInvoiceResult {
  const { input, profile, notes } = mapOrderToInvoiceInput(order, options)
  const syntax = syntaxFor(profile)
  const validation = validateInput(input)
  const { xml, error } = generateForInput(input, syntax)

  // Reconciliation needs the engine's own totals. `computeTotals` is the public
  // way to get them without re-reading the XML.
  const totals = requireTotals(input)
  const reconciliation = reconcileTotals(order, totals, options.totalsTolerance)

  if (!reconciliation.matches) {
    for (const delta of reconciliation.deltas) {
      if (Math.abs(delta.delta) > reconciliation.tolerance) {
        notes.push({
          code: "TOTALS_MISMATCH",
          level: "warning",
          message: `${delta.term}: the document says ${delta.document.toFixed(
            2
          )}, Medusa says ${delta.medusa.toFixed(2)} (delta ${delta.delta.toFixed(
            2
          )}). The document is internally consistent; the two systems round differently or a line was mapped wrongly.`,
        })
      }
    }
  }

  const failOnWarnings = options.failOnWarnings === true
  const valid =
    validation.valid && Boolean(xml) && (!failOnWarnings || validation.warnings.length === 0)

  return {
    valid,
    profile,
    syntax,
    invoiceNumber: input.invoiceNumber,
    currency: input.currency,
    xml,
    errors: validation.errors.map(summarise),
    warnings: validation.warnings.map(summarise),
    information: validation.information.map(summarise),
    notes,
    reconciliation,
    generationError: error,
    input,
  }
}

/**
 * The engine's computed BT-110 / BT-112.
 *
 * Delegated rather than reimplemented: the whole value of reconciliation is
 * that the number it compares against is the number that went into the
 * document, produced by the same rounding rules (`round2`, sum-of-rounded-lines
 * rather than rounded-sum). A second implementation here would eventually
 * disagree with the first and report drift that does not exist.
 *
 * Throws only on an input so malformed that generation failed too, in which
 * case the reconciliation is meaningless and zeroes are the honest answer.
 */
function requireTotals(input: InvoiceInput): {
  taxAmount: number
  taxInclusiveAmount: number
} {
  try {
    const totals = computeTotals(input)
    return {
      taxAmount: totals.taxAmount,
      taxInclusiveAmount: totals.taxInclusiveAmount,
    }
  } catch {
    return { taxAmount: 0, taxInclusiveAmount: 0 }
  }
}
