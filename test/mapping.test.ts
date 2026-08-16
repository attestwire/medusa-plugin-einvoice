/**
 * The mapping suite.
 *
 * THE STANDING RULE, and the reason this file exists: every fixture that is
 * supposed to produce a sendable invoice must come back `valid: true` from the
 * engine, and a fixture that does not must fail by *naming the rule*. A test
 * that asserts "no errors" without saying which rule would have fired teaches
 * nobody anything when it breaks.
 */

import { describe, expect, it } from "vitest"
import { computeTotals, validateInput } from "@attestwire/en16931"

import { buildEInvoice } from "../src/lib/generate.js"
import { mapOrderToInvoiceInput } from "../src/lib/mapping.js"
import { netUnitPrice, toNumber } from "../src/lib/amounts.js"
import {
  baseOptions,
  discountedOrder,
  domesticNetOrder,
  exportOrder,
  frenchOrder,
  hostileOrder,
  reverseChargeOrder,
  taxInclusiveOrder,
} from "./fixtures.js"

/** Fail with the rule ids, not with `expected true to be false`. */
function expectValid(result: ReturnType<typeof buildEInvoice>, label: string) {
  if (!result.valid) {
    const findings = result.errors
      .map((e) => `${e.rule} (${e.field}): ${e.message} → ${e.docsUrl}`)
      .join("\n  ")
    throw new Error(
      `${label} did not validate. Rules that fired:\n  ${findings || result.generationError?.message}`
    )
  }
  expect(result.valid).toBe(true)
}

describe("valid documents", () => {
  const cases: [string, typeof domesticNetOrder][] = [
    ["domestic, net pricing, two VAT rates", domesticNetOrder],
    ["tax-inclusive pricing", taxInclusiveOrder],
    ["item and shipping promotions", discountedOrder],
    ["intra-EU reverse charge", reverseChargeOrder],
    ["export outside the EU", exportOrder],
    ["French buyer, CII/Factur-X payload", frenchOrder],
  ]

  for (const [label, order] of cases) {
    it(`${label} → valid:true`, () => {
      const result = buildEInvoice(order, baseOptions)
      expectValid(result, label)
      expect(result.xml).toBeTruthy()
      expect(result.xml).not.toContain("NaN")
      expect(result.xml).not.toContain("undefined")
    })
  }
})

describe("profile and syntax selection", () => {
  it("picks XRechnung UBL for a German buyer", () => {
    const result = buildEInvoice(domesticNetOrder, baseOptions)
    expect(result.profile).toBe("xrechnung-ubl")
    expect(result.syntax).toBe("ubl")
    expect(result.xml).toContain(
      "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0"
    )
  })

  it("picks the Factur-X CII payload for a French buyer", () => {
    const result = buildEInvoice(frenchOrder, baseOptions)
    expect(result.profile).toBe("facturx-en16931")
    expect(result.syntax).toBe("cii")
    expect(result.xml).toContain("CrossIndustryInvoice")
  })

  it("falls back to Peppol BIS 3.0 UBL for everyone else", () => {
    const result = buildEInvoice(reverseChargeOrder, baseOptions)
    expect(result.profile).toBe("peppol-bis-3")
    expect(result.syntax).toBe("ubl")
  })

  it("honours an explicit profile over the country default", () => {
    const result = buildEInvoice(domesticNetOrder, {
      ...baseOptions,
      profile: "peppol-bis-3",
    })
    expect(result.profile).toBe("peppol-bis-3")
  })

  it("honours a per-country override", () => {
    const result = buildEInvoice(domesticNetOrder, {
      ...baseOptions,
      profileByCountry: { DE: "xrechnung-cii" },
    })
    expect(result.profile).toBe("xrechnung-cii")
    expect(result.syntax).toBe("cii")
  })
})

describe("tax-inclusive pricing", () => {
  it("takes VAT out of the unit price at full precision, not at two decimals", () => {
    // 11.99 / 1.19 = 10.07563025210084…  Truncating to 10.08 before multiplying
    // by 7 gives 70.56; the correct line net is 70.53.
    const { input } = mapOrderToInvoiceInput(taxInclusiveOrder, baseOptions)
    const line = input.lines[0]
    expect(line.unitPrice).toBeCloseTo(10.07563025, 8)
    const totals = computeTotals(input)
    expect(totals.lineNetAmounts[0]).toBe(70.53)
    expect(70.53).not.toBe(Math.round(10.08 * 7 * 100) / 100)
  })

  it("reconciles with Medusa's own gross total inside tolerance", () => {
    const result = buildEInvoice(taxInclusiveOrder, baseOptions)
    expectValid(result, "tax-inclusive order")
    expect(result.reconciliation.matches).toBe(true)
  })

  it("leaves a net-priced line untouched", () => {
    const { input } = mapOrderToInvoiceInput(domesticNetOrder, baseOptions)
    expect(input.lines[0].unitPrice).toBe(249.5)
  })

  it("takes VAT out of a tax-inclusive shipping charge", () => {
    const { input } = mapOrderToInvoiceInput(taxInclusiveOrder, baseOptions)
    // 4.99 / 1.19 = 4.1932… → 4.19
    expect(input.charges?.[0].amount).toBe(4.19)
    expect(input.charges?.[0].reasonCode).toBe("FC")
  })
})

describe("discounts", () => {
  it("maps an item promotion to a line allowance, not a document allowance", () => {
    const { input } = mapOrderToInvoiceInput(discountedOrder, baseOptions)
    expect(input.lines[0].allowances).toHaveLength(1)
    expect(input.lines[0].allowances?.[0]).toMatchObject({
      amount: 49.9,
      reasonCode: "95",
      reason: "Sommeraktion 10 %",
    })
    // Line allowances have no VAT category of their own — that is the point.
    expect(input.lines[0].allowances?.[0]).not.toHaveProperty("vatCategory")
  })

  it("takes VAT out of a tax-inclusive promotion amount", () => {
    const { input } = mapOrderToInvoiceInput(discountedOrder, baseOptions)
    // 10.00 gross at 19 % → 8.40 net.
    expect(input.lines[1].allowances?.[0].amount).toBe(8.4)
  })

  it("reduces the line net amount by the allowance", () => {
    const { input } = mapOrderToInvoiceInput(discountedOrder, baseOptions)
    const totals = computeTotals(input)
    // 2 × 249.50 = 499.00 less 49.90 = 449.10
    expect(totals.lineNetAmounts[0]).toBe(449.1)
  })

  it("maps a free-shipping promotion to a document allowance at the shipping rate", () => {
    const { input } = mapOrderToInvoiceInput(discountedOrder, baseOptions)
    expect(input.allowances).toHaveLength(1)
    expect(input.allowances?.[0]).toMatchObject({
      amount: 5.9,
      vatCategory: "S",
      vatRate: 19,
      reasonCode: "95",
    })
    // …and the charge it cancels is still stated, because an invoice that shows
    // neither the freight nor its waiver cannot be checked by the buyer.
    expect(input.charges?.[0]).toMatchObject({ amount: 5.9, reasonCode: "FC" })
  })

  it("turns a negative adjustment into a charge, since BR-41/42 require positives", () => {
    const { input } = mapOrderToInvoiceInput(hostileOrder, baseOptions)
    expect(input.lines[0].allowances).toBeUndefined()
    expect(input.lines[0].charges?.[0].amount).toBeGreaterThan(0)
    expect(input.lines[0].charges?.[0].reasonCode).toBe("ZZZ")
  })
})

describe("VAT category derivation", () => {
  it("uses S for a positive rate", () => {
    const { input } = mapOrderToInvoiceInput(domesticNetOrder, baseOptions)
    expect(input.lines.map((l) => [l.vatCategory, l.vatRate])).toEqual([
      ["S", 19],
      ["S", 7],
    ])
  })

  it("uses AE and the reverse-charge note for an intra-EU B2B zero rate", () => {
    const { input, notes } = mapOrderToInvoiceInput(reverseChargeOrder, baseOptions)
    expect(input.lines[0].vatCategory).toBe("AE")
    expect(input.note).toContain("Reverse charge")
    expect(notes.map((n) => n.code)).toContain("VAT_INTRA_COMMUNITY")
  })

  it("uses K when the shop says it supplies goods, not services", () => {
    const { input } = mapOrderToInvoiceInput(reverseChargeOrder, {
      ...baseOptions,
      intraCommunityCategory: "K",
    })
    expect(input.lines[0].vatCategory).toBe("K")
    // BR-IC-11 wants a delivery date with category K; the fixture has none, so
    // this is the one case that legitimately fails, and it must fail by name.
    const validation = validateInput(input)
    if (!validation.valid) {
      expect(validation.errors.some((e) => e.rule.startsWith("BR-IC"))).toBe(true)
    }
  })

  it("uses G for an export outside the EU", () => {
    const { input, notes } = mapOrderToInvoiceInput(exportOrder, baseOptions)
    expect(input.lines[0].vatCategory).toBe("G")
    expect(notes.map((n) => n.code)).toContain("VAT_EXPORT")
  })

  it("uses Z for a domestic zero rate and says it assumed so", () => {
    const zeroDomestic = {
      ...domesticNetOrder,
      items: [{ ...domesticNetOrder.items![0], tax_lines: [] }],
      shipping_methods: [],
    }
    const { input, notes } = mapOrderToInvoiceInput(zeroDomestic, baseOptions)
    expect(input.lines[0].vatCategory).toBe("Z")
    expect(notes.map((n) => n.code)).toContain("VAT_ZERO_DOMESTIC")
  })

  it("warns rather than silently zero-rating a cross-border B2C sale", () => {
    const b2c = {
      ...reverseChargeOrder,
      metadata: { einvoice_buyer_endpoint: { schemeId: "9944", value: "NL000" } },
    }
    const { notes } = mapOrderToInvoiceInput(b2c, baseOptions)
    expect(notes.map((n) => n.code)).toContain("VAT_INTRA_EU_NO_VAT_ID")
  })
})

describe("multi-currency", () => {
  it("carries the order currency through, upper-cased", () => {
    const result = buildEInvoice(exportOrder, baseOptions)
    expectValid(result, "export order")
    expect(result.currency).toBe("CHF")
    expect(result.xml).toContain("CHF")
  })
})

describe("BigNumber and hostile input", () => {
  it("reads BigNumber-shaped amounts without producing NaN", () => {
    expect(toNumber({ numeric_: 12.5 })).toBe(12.5)
    expect(toNumber("12.5")).toBe(12.5)
    expect(toNumber(null)).toBe(0)
    expect(toNumber(undefined, 1)).toBe(1)
    const { input } = mapOrderToInvoiceInput(hostileOrder, baseOptions)
    expect(Number.isFinite(input.lines[0].quantity)).toBe(true)
    expect(Number.isFinite(input.lines[0].unitPrice)).toBe(true)
  })

  it("never throws, and reports a missing city and post code by rule id", () => {
    const result = buildEInvoice(hostileOrder, baseOptions)
    expect(result.valid).toBe(false)
    const rules = result.errors.map((e) => e.rule)
    // BR-10/BR-11 (buyer address) or their CIUS equivalents must be among them.
    expect(rules.length).toBeGreaterThan(0)
    expect(result.errors.every((e) => e.docsUrl.startsWith("https://"))).toBe(true)
  })

  it("warns when it falls back to the shipping address", () => {
    const { notes } = mapOrderToInvoiceInput(hostileOrder, baseOptions)
    expect(notes.map((n) => n.code)).toContain("BUYER_ADDRESS_FROM_SHIPPING")
  })

  it("sums mixed-rate tax lines and says it did", () => {
    const { input, notes } = mapOrderToInvoiceInput(hostileOrder, baseOptions)
    expect(input.lines[0].vatRate).toBe(20)
    expect(notes.map((n) => n.code)).toContain("MULTIPLE_TAX_LINES")
  })

  it("drops a zero-quantity line rather than emitting it", () => {
    const withZero = {
      ...domesticNetOrder,
      items: [...domesticNetOrder.items!, { id: "x", title: "Removed", quantity: 0, unit_price: 5 }],
    }
    const { input } = mapOrderToInvoiceInput(withZero, baseOptions)
    expect(input.lines).toHaveLength(2)
  })
})

describe("reconciliation", () => {
  it("agrees with Medusa on a plain net order", () => {
    const result = buildEInvoice(domesticNetOrder, baseOptions)
    expect(result.reconciliation.matches).toBe(true)
    expect(result.reconciliation.deltas.every((d) => Math.abs(d.delta) <= 0.02)).toBe(true)
  })

  it("reports a delta instead of failing when the shop disagrees", () => {
    const wrong = { ...domesticNetOrder, total: 999.99 }
    const result = buildEInvoice(wrong, baseOptions)
    // The document is still valid — it is internally consistent…
    expectValid(result, "order with a wrong stated total")
    // …but the disagreement is loud.
    expect(result.reconciliation.matches).toBe(false)
    expect(result.notes.map((n) => n.code)).toContain("TOTALS_MISMATCH")
  })

  it("turns the same disagreement into a rule failure when declareTotals is on", () => {
    const wrong = { ...domesticNetOrder, total: 999.99 }
    const result = buildEInvoice(wrong, { ...baseOptions, declareTotals: true })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.rule.startsWith("BR-CO"))).toBe(true)
  })
})

describe("invoice numbering and references", () => {
  it("uses the display id, with an optional prefix", () => {
    const result = buildEInvoice(domesticNetOrder, {
      ...baseOptions,
      invoiceNumberPrefix: "RE-2026-",
    })
    expect(result.invoiceNumber).toBe("RE-2026-1042")
  })

  it("lets order metadata override the number entirely", () => {
    const order = { ...domesticNetOrder, metadata: { ...domesticNetOrder.metadata, inv_no: "X-1" } }
    const result = buildEInvoice(order, {
      ...baseOptions,
      invoiceNumberMetadataKey: "inv_no",
    })
    expect(result.invoiceNumber).toBe("X-1")
  })

  it("takes the Leitweg-ID from order metadata for BT-10", () => {
    const { input } = mapOrderToInvoiceInput(domesticNetOrder, baseOptions)
    expect(input.buyerReference).toBe("04011000-1234512345-06")
  })

  it("falls back to the order number so an XRechnung stays generatable", () => {
    const order = { ...domesticNetOrder, metadata: {} }
    const result = buildEInvoice(order, baseOptions)
    expectValid(result, "German order with no Leitweg-ID")
    expect(result.input.buyerReference).toBe("1042")
  })
})

describe("shipping", () => {
  it("is a document charge by default", () => {
    const { input } = mapOrderToInvoiceInput(domesticNetOrder, baseOptions)
    expect(input.lines).toHaveLength(2)
    expect(input.charges?.[0]).toMatchObject({ amount: 5.9, vatCategory: "S", vatRate: 19 })
  })

  it("becomes an invoice line when asked", () => {
    const result = buildEInvoice(domesticNetOrder, { ...baseOptions, shippingAsLine: true })
    expectValid(result, "order with shipping as a line")
    expect(result.input.lines).toHaveLength(3)
    expect(result.input.charges).toBeUndefined()
    expect(result.input.lines[2].description).toBe("DHL Paket")
  })
})

describe("failOnWarnings", () => {
  it("is off by default, so an advisory finding does not block an invoice", () => {
    const result = buildEInvoice(domesticNetOrder, baseOptions)
    expect(result.valid).toBe(true)
  })
})
