/**
 * Medusa order → EN 16931 `InvoiceInput`.
 *
 * This is the whole product. Everything else in the plugin is plumbing around
 * this function, and every defect a user will report will be a defect here.
 *
 * THE FOUR DECISIONS, stated up front because they are choices and not
 * derivations, and a reader deserves to disagree with them in one place:
 *
 * 1. TAX-INCLUSIVE PRICING. EN 16931's BT-146 is a *net* unit price; Medusa's
 *    `unit_price` is net or gross depending on `is_tax_inclusive`. When it is
 *    gross we divide it out at 8 decimals (`PRICE_DECIMALS`) rather than at 2,
 *    because rounding the unit price before multiplying by the quantity is what
 *    makes a ten-line invoice a cent short. The engine then rounds the line
 *    *amount*, which is what BR-DEC-* and BR-CO-10 actually constrain.
 *
 * 2. DISCOUNTS BECOME LINE ALLOWANCES, NOT DOCUMENT ALLOWANCES. A Medusa
 *    promotion arrives as an `adjustment` attached to the item or the shipping
 *    method it discounted. A line allowance (BG-27) inherits that line's VAT
 *    treatment; a document allowance (BG-20) carries its own VAT category and
 *    rate, so hoisting a per-item discount to document level forces us to
 *    invent a rate for it, and gets the VAT breakdown wrong the moment an order
 *    mixes 19 % and 7 % goods. The one exception is a shipping-method
 *    adjustment, which has no line to sit on when shipping is a BG-21 charge —
 *    that one does become a document allowance, at the shipping rate.
 *
 * 3. SHIPPING BECOMES A DOCUMENT CHARGE (BG-21, reason code `FC`). Putting
 *    freight on an invoice line makes it look like a purchased article to the
 *    buyer's AP system and to any downstream ERP that reads BG-25. Set
 *    `shippingAsLine` if you would rather have the line.
 *
 * 4. TOTALS ARE COMPUTED, NOT COPIED. The engine derives BT-106…BT-115 from the
 *    lines. We do not echo Medusa's totals into the document by default (see
 *    `declareTotals`); we compare them and report the delta. A generated
 *    document is therefore always internally consistent, and a disagreement
 *    with the shop's own arithmetic surfaces as a note rather than as a
 *    rejection at the tax authority.
 */

import type {
  DocumentAllowanceCharge,
  InvoiceInput,
  InvoiceLine,
  LineAllowanceCharge,
  Party,
  PostalAddress,
  Profile,
  VatCategory,
} from "@attestwire/en16931"

import { netAmount, netUnitPrice, round2, toNumber } from "./amounts.js"
import { isEuCountry, normaliseCountryCode } from "./countries.js"
import { resolveProfile } from "./profile.js"
import type {
  EInvoicePluginOptions,
  MappingNote,
  MedusaAddress,
  MedusaAdjustment,
  MedusaLineItem,
  MedusaOrder,
  MedusaShippingMethod,
  MedusaTaxLine,
} from "./types.js"

export interface MappingResult {
  input: InvoiceInput
  profile: Profile
  notes: MappingNote[]
}

const DEFAULTS = {
  defaultUnitCode: "C62",
  zeroRateCategory: "Z" as const,
  intraCommunityCategory: "AE" as const,
  shippingChargeReasonCode: "FC",
  discountReasonCode: "95",
  buyerReferenceMetadataKey: "buyer_reference",
  buyerEndpointMetadataKey: "einvoice_buyer_endpoint",
  buyerVatIdMetadataKey: "vat_id",
  metadataKey: "einvoice",
  totalsTolerance: 0.02,
}

/**
 * The standard reverse-charge sentence. BR-AE-* wants an exemption reason on
 * the breakdown (the engine supplies a default) but the buyer's accountant
 * wants it on the face of the invoice, and several member states require it
 * there by name.
 */
const REVERSE_CHARGE_NOTE =
  "Reverse charge — VAT is payable by the recipient under Article 196 of Council Directive 2006/112/EC."

const INTRA_COMMUNITY_NOTE =
  "Intra-Community supply, exempt under Article 138 of Council Directive 2006/112/EC."

const EXPORT_NOTE =
  "Export outside the EU, exempt under Article 146 of Council Directive 2006/112/EC."

// --- small readers -----------------------------------------------------------

function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length ? trimmed : undefined
}

function meta(order: MedusaOrder, key: string | undefined): unknown {
  if (!key) return undefined
  return order.metadata?.[key]
}

function isoDate(value: string | Date | null | undefined): string {
  if (!value) return new Date().toISOString().slice(0, 10)
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10)
  return d.toISOString().slice(0, 10)
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Combined VAT rate of a set of tax lines.
 *
 * Medusa applies every tax line on an item to the same base — they are additive
 * (a 19 % line and a 2 % line make 21 % of the net), not compounded — so the
 * sum is the rate EN 16931 wants in BT-152. Two tax lines at different rates on
 * one item cannot be expressed in EN 16931 at all: an invoice line carries one
 * category and one rate. We sum, and say so in a note.
 */
function combinedRate(taxLines: MedusaTaxLine[] | null | undefined): number {
  if (!taxLines?.length) return 0
  return taxLines.reduce((sum, line) => sum + toNumber(line.rate), 0)
}

// --- parties -----------------------------------------------------------------

function mapAddress(address: MedusaAddress | null | undefined): PostalAddress {
  return {
    line1: str(address?.address_1),
    line2: str(address?.address_2),
    // `city` and `postalCode` are non-optional in the model, and we do not
    // invent them: an empty string reaches the validator, which reports BR-10 /
    // BR-DE-4 against the exact business term. Substituting a placeholder would
    // produce a document that passes and is wrong.
    city: str(address?.city) ?? "",
    postalCode: str(address?.postal_code) ?? "",
    countrySubdivision: str(address?.province),
    countryCode: normaliseCountryCode(address?.country_code),
  }
}

function buyerName(address: MedusaAddress | null | undefined, order: MedusaOrder): string {
  const company = str(address?.company)
  if (company) return company
  const person = [str(address?.first_name), str(address?.last_name)]
    .filter(Boolean)
    .join(" ")
  return person || str(order.email) || "Customer"
}

function mapBuyer(order: MedusaOrder, options: EInvoicePluginOptions, notes: MappingNote[]): Party {
  // Billing first: an invoice is addressed to whoever owes the money, and a
  // shipping address is regularly a different person entirely (a gift, a depot,
  // a customer's customer). Falling back to shipping is better than emitting
  // nothing, but it is a fallback and it says so.
  const address = order.billing_address ?? order.shipping_address ?? null
  if (!order.billing_address && order.shipping_address) {
    notes.push({
      code: "BUYER_ADDRESS_FROM_SHIPPING",
      level: "warning",
      message:
        "Order has no billing address; the shipping address was used for BG-8. Verify before sending: the invoice recipient and the delivery recipient are not always the same party.",
    })
  }

  const vatId =
    str(meta(order, options.buyerVatIdMetadataKey ?? DEFAULTS.buyerVatIdMetadataKey)) ??
    str(address?.metadata?.["vat_id"])

  const endpointRaw = meta(
    order,
    options.buyerEndpointMetadataKey ?? DEFAULTS.buyerEndpointMetadataKey
  )
  let electronicAddress: Party["electronicAddress"]
  if (endpointRaw && typeof endpointRaw === "object") {
    const bag = endpointRaw as Record<string, unknown>
    const schemeId = str(bag.schemeId) ?? str(bag.scheme_id)
    const value = str(bag.value)
    if (schemeId && value) electronicAddress = { schemeId, value }
  }

  const buyer: Party = {
    name: buyerName(address, order),
    vatId,
    address: mapAddress(address),
    electronicAddress,
  }

  const contactName = [str(address?.first_name), str(address?.last_name)]
    .filter(Boolean)
    .join(" ")
  const contactEmail = str(order.email)
  const contactPhone = str(address?.phone)
  if (contactName || contactEmail || contactPhone) {
    buyer.contact = {
      name: contactName || undefined,
      email: contactEmail,
      phone: contactPhone,
    }
  }

  return buyer
}

function mapSeller(options: EInvoicePluginOptions): Party {
  const { seller } = options
  return {
    name: seller.name,
    legalName: seller.name,
    tradingName: seller.tradingName,
    vatId: seller.vatId,
    taxRegistrationId: seller.taxRegistrationId,
    legalRegistrationId: seller.legalRegistrationId,
    legalRegistrationSchemeId: seller.legalRegistrationSchemeId,
    additionalLegalInformation: seller.additionalLegalInformation,
    identifier: seller.identifier,
    address: {
      line1: seller.address.line1,
      line2: seller.address.line2,
      line3: seller.address.line3,
      city: seller.address.city,
      postalCode: seller.address.postalCode,
      countrySubdivision: seller.address.countrySubdivision,
      countryCode: normaliseCountryCode(seller.address.countryCode),
    },
    electronicAddress: seller.electronicAddress,
    contact: seller.contact,
  }
}

// --- VAT ---------------------------------------------------------------------

interface VatContext {
  sellerCountry: string
  buyerCountry: string
  buyerHasVatId: boolean
  options: EInvoicePluginOptions
  notes: MappingNote[]
}

interface VatTreatment {
  category: VatCategory
  /** Omitted for category O, which must not carry a rate (BR-O-05). */
  rate?: number
}

/**
 * A rate, plus the country pair, decides the VAT category.
 *
 * Medusa knows how much tax it charged and nothing about *why* it charged none.
 * Zero can mean four different things — domestic zero rating, an intra-EU
 * reverse charge, an export, or a supply outside the scope — and they are four
 * different categories with four different exemption reasons. The country pair
 * and the presence of a buyer VAT id are the only signals available, so those
 * are what we use, and each branch leaves a note saying what it assumed.
 */
function resolveVat(ratePercent: number, ctx: VatContext): VatTreatment {
  if (ratePercent > 0) return { category: "S", rate: ratePercent }

  const { sellerCountry, buyerCountry, buyerHasVatId, options, notes } = ctx

  if (!buyerCountry || buyerCountry === sellerCountry) {
    const category = options.zeroRateCategory ?? DEFAULTS.zeroRateCategory
    notes.push({
      code: "VAT_ZERO_DOMESTIC",
      level: "info",
      message: `No tax was charged on a domestic supply; VAT category ${category} was assumed. Set \`zeroRateCategory\` if this is an exemption (E) or out of scope (O) rather than zero-rated.`,
    })
    return { category, rate: 0 }
  }

  if (isEuCountry(buyerCountry) && isEuCountry(sellerCountry)) {
    if (buyerHasVatId) {
      const category = options.intraCommunityCategory ?? DEFAULTS.intraCommunityCategory
      notes.push({
        code: "VAT_INTRA_COMMUNITY",
        level: "info",
        message: `Zero-rated intra-EU supply to a VAT-registered buyer; category ${category} was applied. AE is the reverse charge for services, K the intra-Community supply of goods — set \`intraCommunityCategory\` to whichever you actually make.`,
      })
      return { category, rate: 0 }
    }
    notes.push({
      code: "VAT_INTRA_EU_NO_VAT_ID",
      level: "warning",
      message:
        "Zero tax on a cross-border EU sale to a buyer with no VAT id. That is a B2C supply, which is normally taxable at the destination rate — check your tax configuration. Category Z was applied so the document remains generatable.",
    })
    return { category: "Z", rate: 0 }
  }

  notes.push({
    code: "VAT_EXPORT",
    level: "info",
    message:
      "Zero-rated supply to a country outside the EU; category G (export) was applied.",
  })
  return { category: "G", rate: 0 }
}

// --- lines -------------------------------------------------------------------

function unitCodeFor(item: MedusaLineItem, options: EInvoicePluginOptions): string {
  const key = options.unitCodeMetadataKey
  if (key) {
    const fromItem = str(item.metadata?.[key]) ?? str(item.line_item_metadata?.[key])
    if (fromItem) return fromItem
  }
  return options.defaultUnitCode ?? DEFAULTS.defaultUnitCode
}

/**
 * Item adjustments → BG-27 line allowances.
 *
 * A promotion `amount` is the whole discount on that line, not a per-unit one,
 * and it may itself be tax-inclusive (`is_tax_inclusive` on the adjustment,
 * independently of the item's own flag — a shop can run a "€10 off" promotion
 * on a net-priced catalogue). We take VAT out at the line's rate, because a
 * line allowance has no VAT category of its own: it inherits the line's, which
 * is exactly why it is the right home for a per-item discount.
 *
 * A *negative* adjustment amount is a surcharge in disguise, and becomes a
 * BG-28 line charge — EN 16931 requires both to be stated positively (BR-41,
 * BR-42), so a negative allowance would be rejected.
 */
function mapItemAdjustments(
  adjustments: MedusaAdjustment[] | null | undefined,
  ratePercent: number,
  options: EInvoicePluginOptions
): { allowances: LineAllowanceCharge[]; charges: LineAllowanceCharge[] } {
  const allowances: LineAllowanceCharge[] = []
  const charges: LineAllowanceCharge[] = []

  for (const adjustment of adjustments ?? []) {
    const gross = toNumber(adjustment.amount)
    if (gross === 0) continue
    const inclusive = adjustment.is_tax_inclusive === true
    const amount = netAmount(Math.abs(gross), ratePercent, inclusive)
    if (amount === 0) continue

    const reason =
      str(adjustment.description) ??
      (str(adjustment.code) ? `Promotion ${str(adjustment.code)}` : "Discount")

    if (gross > 0) {
      allowances.push({
        amount,
        reason,
        reasonCode: options.discountReasonCode ?? DEFAULTS.discountReasonCode,
      })
    } else {
      // UNCL 7161 has no "negative discount"; `ZZZ` is the mutually-defined
      // code, and the free-text reason carries the meaning.
      charges.push({ amount, reason, reasonCode: "ZZZ" })
    }
  }

  return { allowances, charges }
}

function mapLine(
  item: MedusaLineItem,
  index: number,
  ctx: VatContext,
  options: EInvoicePluginOptions
): InvoiceLine {
  const quantity = toNumber(item.quantity, 1)
  const taxLines = item.tax_lines ?? []
  const rate = combinedRate(taxLines)

  if (taxLines.length > 1) {
    const rates = taxLines.map((t) => toNumber(t.rate))
    if (new Set(rates).size > 1) {
      ctx.notes.push({
        code: "MULTIPLE_TAX_LINES",
        level: "warning",
        message: `Line ${index + 1} ("${str(item.title) ?? item.id}") carries ${
          taxLines.length
        } tax lines at different rates (${rates.join(", ")}). EN 16931 allows one VAT category and one rate per line, so they were summed to ${rate}. Verify this is what the tax authority expects.`,
      })
    }
  }

  const inclusive = item.is_tax_inclusive === true
  const unitPrice = netUnitPrice(toNumber(item.unit_price), rate, inclusive)
  const vat = resolveVat(rate, ctx)
  const { allowances, charges } = mapItemAdjustments(item.adjustments, rate, options)

  const description =
    str(item.title) ??
    str(item.product_title) ??
    str(item.variant_title) ??
    `Item ${index + 1}`

  const longDescription = str(item.product_description)

  const line: InvoiceLine = {
    // BT-126 is a document-local identifier, not a database key. `ordli_01J…`
    // is legal but unreadable on a printed invoice and meaningless to the
    // buyer's AP system; the ordinal is what every other invoice in the world
    // uses.
    id: String(index + 1),
    description,
    longDescription: longDescription !== description ? longDescription : undefined,
    quantity,
    unitCode: unitCodeFor(item, options),
    unitPrice,
    vatCategory: vat.category,
    vatRate: vat.rate,
    sellerItemId: str(item.variant_sku) ?? str(item.variant_id) ?? undefined,
    allowances: allowances.length ? allowances : undefined,
    charges: charges.length ? charges : undefined,
  }

  const barcode = str(item.variant_barcode)
  if (barcode) {
    // BT-157 with ICD 0160 = GTIN. Only claimed when the barcode is actually a
    // GTIN length (8/12/13/14 digits); a shop that puts an internal code in
    // `variant_barcode` should not have it announced as a global identifier.
    if (/^\d{8}$|^\d{12,14}$/.test(barcode)) {
      line.standardItemId = { value: barcode, schemeId: "0160" }
    }
  }

  return line
}

// --- shipping ----------------------------------------------------------------

interface ShippingMapping {
  charges: DocumentAllowanceCharge[]
  allowances: DocumentAllowanceCharge[]
  lines: InvoiceLine[]
}

function mapShipping(
  order: MedusaOrder,
  ctx: VatContext,
  options: EInvoicePluginOptions,
  lineOffset: number
): ShippingMapping {
  const result: ShippingMapping = { charges: [], allowances: [], lines: [] }
  const methods = order.shipping_methods ?? []

  methods.forEach((method: MedusaShippingMethod, index) => {
    const rate = combinedRate(method.tax_lines)
    const inclusive = method.is_tax_inclusive === true
    const amount = netAmount(toNumber(method.amount), rate, inclusive)
    const vat = resolveVat(rate, ctx)
    const reason = str(method.name) ?? "Shipping"

    if (amount !== 0) {
      if (options.shippingAsLine) {
        result.lines.push({
          id: String(lineOffset + index + 1),
          description: reason,
          quantity: 1,
          unitCode: "C62",
          unitPrice: amount,
          vatCategory: vat.category,
          vatRate: vat.rate,
        })
      } else {
        result.charges.push({
          amount,
          vatCategory: vat.category,
          vatRate: vat.rate,
          reason,
          reasonCode:
            options.shippingChargeReasonCode ?? DEFAULTS.shippingChargeReasonCode,
        })
      }
    }

    // A shipping-method adjustment is the one discount that genuinely belongs
    // at document level when shipping is a BG-21 charge: there is no line for
    // it to hang off, and it carries the shipping rate, so BG-20 can state it
    // exactly. (When `shippingAsLine` is on it still goes to document level —
    // splitting the behaviour would be worse than the small inconsistency.)
    for (const adjustment of method.adjustments ?? []) {
      const gross = toNumber(adjustment.amount)
      if (gross === 0) continue
      const adjustmentAmount = netAmount(
        Math.abs(gross),
        rate,
        adjustment.is_tax_inclusive === true
      )
      if (adjustmentAmount === 0) continue
      const adjustmentReason =
        str(adjustment.description) ??
        (str(adjustment.code) ? `Promotion ${str(adjustment.code)}` : "Shipping discount")
      const entry: DocumentAllowanceCharge = {
        amount: adjustmentAmount,
        vatCategory: vat.category,
        vatRate: vat.rate,
        reason: adjustmentReason,
      }
      if (gross > 0) {
        result.allowances.push({
          ...entry,
          reasonCode: options.discountReasonCode ?? DEFAULTS.discountReasonCode,
        })
      } else {
        result.charges.push({ ...entry, reasonCode: "ZZZ" })
      }
    }
  })

  return result
}

// --- the mapping -------------------------------------------------------------

export function mapOrderToInvoiceInput(
  order: MedusaOrder,
  options: EInvoicePluginOptions
): MappingResult {
  const notes: MappingNote[] = []

  const profile = resolveProfile(order, options)
  const sellerCountry = normaliseCountryCode(options.seller.address.countryCode)
  const buyerAddress = order.billing_address ?? order.shipping_address ?? null
  const buyerCountry = normaliseCountryCode(buyerAddress?.country_code)

  const buyer = mapBuyer(order, options, notes)
  const ctx: VatContext = {
    sellerCountry,
    buyerCountry,
    buyerHasVatId: Boolean(buyer.vatId),
    options,
    notes,
  }

  const items = (order.items ?? []).filter((item) => toNumber(item.quantity, 1) !== 0)
  const lines = items.map((item, index) => mapLine(item, index, ctx, options))
  const shipping = mapShipping(order, ctx, options, lines.length)
  lines.push(...shipping.lines)

  if (!lines.length) {
    notes.push({
      code: "NO_LINES",
      level: "warning",
      message:
        "The order produced no invoice lines. BR-16 requires at least one, so the document will not validate. Check that `items` was requested in the order query.",
    })
  }

  const issueDate = isoDate(order.created_at)
  const invoiceNumber = resolveInvoiceNumber(order, options)

  const categories = new Set<VatCategory>([
    ...lines.map((line) => line.vatCategory),
    ...shipping.charges.map((charge) => charge.vatCategory),
    ...shipping.allowances.map((allowance) => allowance.vatCategory),
  ])

  const input: InvoiceInput = {
    profile,
    invoiceNumber,
    issueDate,
    currency: (order.currency_code ?? "EUR").toUpperCase(),
    invoiceTypeCode: "380",
    buyerReference:
      str(meta(order, options.buyerReferenceMetadataKey ?? DEFAULTS.buyerReferenceMetadataKey)) ??
      // BR-DE-15 makes BT-10 mandatory for XRechnung, and a German public-sector
      // buyer supplies a Leitweg-ID for it. Absent that, the order's own number
      // is a defensible value — it is a reference the buyer can quote back —
      // and it keeps a B2B XRechnung generatable.
      String(order.custom_display_id ?? order.display_id ?? order.id ?? ""),
    orderReference: str(meta(order, "purchase_order")) ?? undefined,
    salesOrderReference: String(order.custom_display_id ?? order.display_id ?? "") || undefined,
    seller: mapSeller(options),
    buyer,
    lines,
    allowances: [...shipping.allowances, ...(options.extraAllowances ?? [])],
    charges: [...shipping.charges, ...(options.extraCharges ?? [])],
    payment: options.payment,
    paymentTerms: options.paymentTerms,
    vatExemptionReasons: options.vatExemptionReasons,
    vatExemptionReasonCodes: options.vatExemptionReasonCodes,
  }

  if (!input.allowances?.length) delete input.allowances
  if (!input.charges?.length) delete input.charges
  if (!input.orderReference) delete input.orderReference

  if (typeof options.paymentTermDays === "number") {
    input.dueDate = addDays(issueDate, options.paymentTermDays)
  }

  // The note on the face of the document. Several member states require the
  // reverse-charge sentence to be printed, not merely coded in BT-120.
  if (categories.has("AE")) input.note = REVERSE_CHARGE_NOTE
  else if (categories.has("K")) input.note = INTRA_COMMUNITY_NOTE
  else if (categories.has("G")) input.note = EXPORT_NOTE

  if (categories.has("E") && !options.vatExemptionReasons?.E) {
    notes.push({
      code: "EXEMPTION_REASON_MISSING",
      level: "warning",
      message:
        "VAT category E is in use and no exemption reason was configured. BR-E-10 requires one, and the standard supplies no default text — set `vatExemptionReasons.E` to the article you are exempt under.",
    })
  }

  if (options.declareTotals) {
    input.declaredTotals = {
      taxInclusiveAmount: round2(toNumber(order.total)),
      taxAmount: round2(toNumber(order.tax_total)),
      payableAmount: round2(toNumber(order.total)),
    }
  }

  return { input, profile, notes }
}

function resolveInvoiceNumber(order: MedusaOrder, options: EInvoicePluginOptions): string {
  const override = str(meta(order, options.invoiceNumberMetadataKey))
  if (override) return override
  const base = String(order.custom_display_id ?? order.display_id ?? order.id ?? "")
  return `${options.invoiceNumberPrefix ?? ""}${base}`
}

// --- reconciliation ----------------------------------------------------------

export interface Reconciliation {
  matches: boolean
  tolerance: number
  deltas: { term: string; medusa: number; document: number; delta: number }[]
}

/**
 * Compare the engine's computed totals against Medusa's own.
 *
 * This is the honest replacement for copying Medusa's totals into the document.
 * A mismatch does not make the invoice invalid — the document is internally
 * consistent either way — it means the shop and the standard round differently,
 * and somebody should look once. In practice a cent of drift on a tax-inclusive
 * order is normal and a euro is a mapping bug.
 */
export function reconcileTotals(
  order: MedusaOrder,
  computed: { taxAmount: number; taxInclusiveAmount: number },
  tolerance = DEFAULTS.totalsTolerance
): Reconciliation {
  const pairs: Reconciliation["deltas"] = [
    {
      term: "BT-112 (total with VAT)",
      medusa: round2(toNumber(order.total)),
      document: round2(computed.taxInclusiveAmount),
      delta: 0,
    },
    {
      term: "BT-110 (total VAT)",
      medusa: round2(toNumber(order.tax_total)),
      document: round2(computed.taxAmount),
      delta: 0,
    },
  ].map((entry) => ({ ...entry, delta: round2(entry.document - entry.medusa) }))

  return {
    matches: pairs.every((entry) => Math.abs(entry.delta) <= tolerance),
    tolerance,
    deltas: pairs,
  }
}

export { DEFAULTS as MAPPING_DEFAULTS }
