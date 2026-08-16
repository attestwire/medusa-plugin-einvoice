/**
 * Reading amounts out of Medusa, and taking VAT back out of a price.
 *
 * Two things live here because they are the two arithmetic mistakes this plugin
 * exists to not make: reading a `BigNumber` as `[object Object]`, and treating a
 * tax-inclusive price as a net one.
 */

import type { MedusaAmount } from "./types"

/**
 * Coerce whatever Medusa handed us into a number.
 *
 * Server-side, every monetary field on an order is a `BigNumber` whose numeric
 * value sits on `numeric_`; over HTTP the same field is a plain number; and a
 * `bigNumber` column can also surface as a decimal *string* from the driver.
 * `Number(bigNumberInstance)` is `NaN`, so a naive read does not throw — it
 * silently produces an invoice of NaN, which is the worst of the three
 * outcomes. Hence: check every representation, and return the fallback rather
 * than NaN.
 */
export function toNumber(value: MedusaAmount, fallback = 0): number {
  if (value === null || value === undefined) return fallback
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback
  if (typeof value === "string") {
    const n = Number(value)
    return Number.isFinite(n) ? n : fallback
  }
  if (typeof value === "object") {
    const bag = value as Record<string, unknown>
    // `numeric_` is the MikroORM-hydrated BigNumber; `numeric` is the getter on
    // the same class; `value` is the raw string it was built from.
    for (const key of ["numeric_", "numeric", "value"]) {
      const raw = bag[key]
      if (typeof raw === "number" && Number.isFinite(raw)) return raw
      if (typeof raw === "string") {
        const n = Number(raw)
        if (Number.isFinite(n)) return n
      }
    }
    // Last resort: a BigNumber that only implements toString/valueOf.
    const n = Number(value as unknown as number)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

/** Round half-up, away from zero, at `decimals` — the EN 16931 rounding mode. */
export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** decimals
  // `toPrecision(15)` discards the IEEE-754 representation error before the
  // rounding decision, so 1.005 rounds to 1.01 rather than to 1.00. Same
  // reasoning as `round2` in @attestwire/en16931 — see its docblock.
  const normalised = Number((value * factor).toPrecision(15))
  const rounded =
    normalised >= 0 ? Math.round(normalised) : -Math.round(-normalised)
  return rounded / factor
}

export const round2 = (value: number): number => roundTo(value, 2)

/**
 * Maximum decimals kept on a derived net unit price.
 *
 * Matches `MAX_PRICE_DECIMALS` in the engine. Taking 19 % out of a 11.99
 * gross price gives 10.075630252100840…, and truncating that to two decimals
 * before multiplying by the quantity is how a tax-inclusive shop ends up a cent
 * short on every line of a ten-item order.
 */
export const PRICE_DECIMALS = 8

/**
 * Net unit price from a possibly tax-inclusive one.
 *
 * `ratePercent` is the *combined* rate of every tax line on the item, because
 * Medusa applies each tax line to the same base (they are additive, not
 * compounded) and EN 16931 has room for exactly one rate per line.
 */
export function netUnitPrice(
  unitPrice: number,
  ratePercent: number,
  taxInclusive: boolean
): number {
  if (!taxInclusive || ratePercent === 0) return roundTo(unitPrice, PRICE_DECIMALS)
  return roundTo(unitPrice / (1 + ratePercent / 100), PRICE_DECIMALS)
}

/** Net amount from a possibly tax-inclusive one, at document precision. */
export function netAmount(
  amount: number,
  ratePercent: number,
  taxInclusive: boolean
): number {
  if (!taxInclusive || ratePercent === 0) return round2(amount)
  return round2(amount / (1 + ratePercent / 100))
}
