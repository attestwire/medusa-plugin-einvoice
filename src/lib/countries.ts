/**
 * The EU VAT area, as far as this plugin needs to know it.
 *
 * Used for exactly one decision: whether a zero-rated cross-border supply is an
 * intra-Community one (category AE/K) or an export (category G). Getting it
 * wrong puts the wrong exemption reason on the invoice, which is a VAT
 * statement, not a formatting detail.
 *
 * ⚠ This is the list of member *states*, not the VAT territory. The two differ:
 * the Canary Islands, Ceuta and Melilla are Spanish but outside the VAT area
 * (their own IGIC/IPSI, VAT categories L and M), Livigno is Italian and outside
 * it, and Northern Ireland is UK but inside it for goods, under country code
 * `XI`. A postal country code cannot express any of that, so a shop trading
 * into those territories must override the category itself.
 */

const EU_MEMBER_STATES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
  "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES",
  "SE",
  // Northern Ireland, for goods. EN 16931 admits XI as a BT-40/BT-55 value.
  "XI",
])

/** Greece is `GR` in ISO 3166-1 and `EL` in the EU's own VAT-number prefix. */
export function normaliseCountryCode(code: string | null | undefined): string {
  if (!code) return ""
  const upper = code.trim().toUpperCase()
  return upper === "EL" ? "GR" : upper
}

export function isEuCountry(code: string | null | undefined): boolean {
  return EU_MEMBER_STATES.has(normaliseCountryCode(code))
}
