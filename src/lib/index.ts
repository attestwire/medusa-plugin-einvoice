/**
 * The framework-free half of the plugin.
 *
 * Everything exported here runs without Medusa, without a container and without
 * a database — `mapOrderToInvoiceInput` takes a plain object shaped like an
 * order and `buildEInvoice` returns XML and findings. That is deliberate: it is
 * what makes the mapping unit-testable, and it means a shop that wants to
 * generate an invoice from somewhere other than a subscriber can import this
 * subpath and call it directly.
 */

export {
  mapOrderToInvoiceInput,
  reconcileTotals,
  MAPPING_DEFAULTS,
  type MappingResult,
  type Reconciliation,
} from "./mapping.js"

export {
  buildEInvoice,
  generateForInput,
  type EInvoiceResult,
  type FindingSummary,
} from "./generate.js"

export { resolveProfile, syntaxFor, type Syntax } from "./profile.js"

export {
  createValidationRecord,
  fetchVersions,
  ruleCurrencyMessage,
  compareVersions,
  DEFAULT_BASE_URL,
  type ValidationRecord,
  type VersionsDocument,
} from "./attestwire.js"

export { toNumber, round2, netUnitPrice, netAmount } from "./amounts.js"
export { isEuCountry, normaliseCountryCode } from "./countries.js"

export type {
  EInvoicePluginOptions,
  SellerConfig,
  MappingNote,
  MedusaOrder,
  MedusaLineItem,
  MedusaShippingMethod,
  MedusaTaxLine,
  MedusaAdjustment,
  MedusaAddress,
} from "./types.js"
