/**
 * Which document to produce, and in which syntax.
 *
 * Profile and syntax are not independent: `xrechnung-ubl` is UBL by definition,
 * `xrechnung-cii` and `facturx-en16931` are CII by definition, and `en16931`
 * and `peppol-bis-3` exist in both. The engine refuses a mismatch rather than
 * emitting a file no validator anywhere accepts, so this module makes the
 * decision once and hands the caller a function that cannot be wrong.
 */

import {
  CII_GENERATABLE_PROFILES,
  UBL_GENERATABLE_PROFILES,
  type Profile,
} from "@attestwire/en16931"

import { normaliseCountryCode } from "./countries.js"
import type { EInvoicePluginOptions, MedusaOrder } from "./types.js"

export type Syntax = "ubl" | "cii"

/**
 * Country → profile, for `profile: "auto"`.
 *
 * DE gets XRechnung because that is what the German federal portals accept.
 * FR gets the Factur-X CII payload because Factur-X is the French national
 * format and the 2026 mandate is built on it. Everything else gets Peppol BIS
 * 3.0 UBL, which is the widest-accepted EN 16931 document in Europe and the one
 * an access point will take without configuration.
 */
const AUTO_PROFILE_BY_COUNTRY: Record<string, Profile> = {
  DE: "xrechnung-ubl",
  FR: "facturx-en16931",
}

const DEFAULT_AUTO_PROFILE: Profile = "peppol-bis-3"

export function resolveProfile(
  order: MedusaOrder,
  options: EInvoicePluginOptions
): Profile {
  const buyerCountry = normaliseCountryCode(
    (order.billing_address ?? order.shipping_address)?.country_code
  )

  const override = options.profileByCountry?.[buyerCountry]
  if (override) return override

  const setting = options.profile ?? "auto"
  if (setting !== "auto") return setting

  return AUTO_PROFILE_BY_COUNTRY[buyerCountry] ?? DEFAULT_AUTO_PROFILE
}

export function syntaxFor(profile: Profile): Syntax {
  // Order matters for the two profiles that are in both lists: `en16931` and
  // `peppol-bis-3` are generatable as either, and UBL is the syntax every
  // Peppol receiver must accept (CII is optional, registered per-receiver in
  // the SMP), so UBL is the safe default for anything ambiguous.
  if ((UBL_GENERATABLE_PROFILES as readonly string[]).includes(profile)) return "ubl"
  if ((CII_GENERATABLE_PROFILES as readonly string[]).includes(profile)) return "cii"
  return "ubl"
}

/** File extension and media type for a generated document. */
export function documentMediaType(syntax: Syntax): string {
  return syntax === "cii" ? "application/xml" : "application/xml"
}
