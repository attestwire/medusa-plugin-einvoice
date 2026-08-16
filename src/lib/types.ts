/**
 * Plugin options and the structural view of a Medusa order this plugin maps
 * from.
 *
 * WHY THE ORDER TYPES ARE DECLARED HERE RATHER THAN IMPORTED. The mapping layer
 * is the part of this plugin most likely to be wrong, so it is the part that
 * has to be unit-testable without a database, a container or a running Medusa.
 * Importing `AdminOrder` from `@medusajs/framework/types` would drag the whole
 * framework into the test process for the sake of a shape. These interfaces are
 * deliberately *structural and loose* — every field optional, every amount
 * `unknown` — because that is also the honest description of what arrives:
 * server-side totals are `BigNumber` instances, HTTP-side totals are numbers,
 * and a field you did not name in `fields` is simply absent.
 */

import type {
  DocumentAllowanceCharge,
  PaymentInstructions,
  Profile,
  VatCategory,
} from "@attestwire/en16931"

/** An amount as it may arrive: number, numeric string, or Medusa `BigNumber`. */
export type MedusaAmount =
  | number
  | string
  | { numeric_?: number; numeric?: number; value?: unknown }
  | null
  | undefined

export interface MedusaTaxLine {
  /** Percentage, e.g. `19` for 19 %. Never a fraction. */
  rate?: MedusaAmount
  /** Required on the model; the tax provider's code for the rate. */
  code?: string | null
  description?: string | null
  tax_rate_id?: string | null
}

export interface MedusaAdjustment {
  id?: string
  code?: string | null
  description?: string | null
  promotion_id?: string | null
  amount?: MedusaAmount
  /** Present on line-item adjustments; absent on shipping-method adjustments. */
  is_tax_inclusive?: boolean | null
}

export interface MedusaLineItem {
  id?: string
  title?: string | null
  subtitle?: string | null
  product_title?: string | null
  product_description?: string | null
  variant_title?: string | null
  variant_sku?: string | null
  variant_barcode?: string | null
  product_id?: string | null
  variant_id?: string | null
  quantity?: MedusaAmount
  unit_price?: MedusaAmount
  is_tax_inclusive?: boolean | null
  tax_lines?: MedusaTaxLine[] | null
  adjustments?: MedusaAdjustment[] | null
  metadata?: Record<string, unknown> | null
  /** `OrderLineItem.metadata`, distinct from the versioned item metadata. */
  line_item_metadata?: Record<string, unknown> | null
  /** Computed; used only for reconciliation, never as a source of truth. */
  subtotal?: MedusaAmount
  total?: MedusaAmount
  tax_total?: MedusaAmount
  discount_total?: MedusaAmount
}

export interface MedusaShippingMethod {
  id?: string
  name?: string | null
  amount?: MedusaAmount
  is_tax_inclusive?: boolean | null
  tax_lines?: MedusaTaxLine[] | null
  adjustments?: MedusaAdjustment[] | null
  metadata?: Record<string, unknown> | null
}

export interface MedusaAddress {
  company?: string | null
  first_name?: string | null
  last_name?: string | null
  address_1?: string | null
  address_2?: string | null
  city?: string | null
  province?: string | null
  postal_code?: string | null
  country_code?: string | null
  phone?: string | null
  metadata?: Record<string, unknown> | null
}

export interface MedusaOrder {
  id?: string
  display_id?: number | string | null
  custom_display_id?: string | null
  email?: string | null
  currency_code?: string | null
  created_at?: string | Date | null
  status?: string | null
  metadata?: Record<string, unknown> | null
  billing_address?: MedusaAddress | null
  shipping_address?: MedusaAddress | null
  items?: MedusaLineItem[] | null
  shipping_methods?: MedusaShippingMethod[] | null
  /** Computed order totals, used for reconciliation only. */
  total?: MedusaAmount
  subtotal?: MedusaAmount
  tax_total?: MedusaAmount
  discount_total?: MedusaAmount
  shipping_total?: MedusaAmount
  item_total?: MedusaAmount
}

/**
 * The seller. Not derivable from an order: Medusa's Store entity has a name and
 * nothing a tax authority recognises — no VAT id, no registered address, no
 * contact — so this is configuration, and it is required.
 */
export interface SellerConfig {
  /** BT-27 registered legal name. */
  name: string
  /** BT-31 seller VAT identifier. Required in practice by BR-CO-26 / BR-DE-*. */
  vatId?: string
  /** BT-32 tax registration id (German Steuernummer), when there is no VAT id. */
  taxRegistrationId?: string
  /** BT-30 legal registration id (HRB, SIREN, Companies House number). */
  legalRegistrationId?: string
  legalRegistrationSchemeId?: string
  /** BT-28 trading name, when it differs from the legal name. */
  tradingName?: string
  /** BT-33 additional legal information (Rechtsform, share capital). */
  additionalLegalInformation?: string
  address: {
    line1?: string
    line2?: string
    line3?: string
    city: string
    postalCode: string
    countrySubdivision?: string
    countryCode: string
  }
  /** BT-34 seller electronic address. Mandatory on Peppol (R020). */
  electronicAddress?: { schemeId: string; value: string }
  /** BG-6. All three fields are mandatory under XRechnung (BR-DE-2/5/6/7). */
  contact?: { name?: string; email?: string; phone?: string }
  identifier?: { value: string; schemeId?: string }
}

export type ProfileSetting = Profile | "auto"

export interface EInvoicePluginOptions {
  /** Required. See {@link SellerConfig}. */
  seller: SellerConfig

  /**
   * Output profile, or `"auto"` to pick from the buyer's country:
   * DE → `xrechnung-ubl`, FR → `facturx-en16931` (CII), everything else →
   * `peppol-bis-3`. Default `"auto"`.
   */
  profile?: ProfileSetting

  /** Per-country overrides applied before the `"auto"` defaults. */
  profileByCountry?: Record<string, Profile>

  /**
   * Events that trigger generation. Default `["order.placed"]`. Medusa emits no
   * `invoice.*` event; `order.completed` and `payment.captured` are the other
   * two sensible hooks.
   */
  events?: string[]

  /** Prefix on the invoice number. Default `""`; the number is the `display_id`. */
  invoiceNumberPrefix?: string
  /** Order metadata key that, when set, overrides the invoice number entirely. */
  invoiceNumberMetadataKey?: string

  /**
   * Order metadata key holding BT-10 buyer reference — the Leitweg-ID for a
   * German public-sector buyer (BR-DE-15). Default `"buyer_reference"`.
   */
  buyerReferenceMetadataKey?: string
  /**
   * Order metadata key holding the buyer's electronic address (BT-49) as
   * `{ schemeId, value }`. Mandatory on Peppol (R010). Default
   * `"einvoice_buyer_endpoint"`.
   */
  buyerEndpointMetadataKey?: string
  /** Order metadata key holding the buyer's VAT id (BT-48). Default `"vat_id"`. */
  buyerVatIdMetadataKey?: string

  /** BT-130 unit of measure when nothing on the item says otherwise. Default `"C62"`. */
  defaultUnitCode?: string
  /** Item metadata key holding a per-item UN/ECE Rec 20 unit code. */
  unitCodeMetadataKey?: string

  /** VAT category for a zero-rated domestic supply. Default `"Z"`. */
  zeroRateCategory?: Extract<VatCategory, "Z" | "E" | "O">
  /** VAT category for a zero-rated intra-EU B2B supply. Default `"AE"`. */
  intraCommunityCategory?: Extract<VatCategory, "AE" | "K">
  /** Free-text exemption reasons (BT-120) per category. `E` has no default. */
  vatExemptionReasons?: Partial<Record<VatCategory, string>>
  /** Exemption reason codes (BT-121, CEF VATEX) per category. */
  vatExemptionReasonCodes?: Partial<Record<VatCategory, string>>

  /** UNCL 7161 reason code for the shipping charge. Default `"FC"` (freight service). */
  shippingChargeReasonCode?: string
  /** UNCL 5189 reason code for a promotion. Default `"95"` (discount). */
  discountReasonCode?: string
  /**
   * Map shipping as an extra invoice line instead of a document-level charge
   * (BG-21). Default `false` — freight belongs in BG-21, and putting it on a
   * line makes it look like a purchased item to the buyer's AP system.
   */
  shippingAsLine?: boolean

  /** BG-16 payment instructions. Required for XRechnung by BR-DE-1. */
  payment?: PaymentInstructions
  /** BT-20 payment terms, free text. */
  paymentTerms?: string
  /** Days from issue date to BT-9 due date. Omitted when unset. */
  paymentTermDays?: number

  /** Extra document-level allowances and charges, appended to the derived ones. */
  extraAllowances?: DocumentAllowanceCharge[]
  extraCharges?: DocumentAllowanceCharge[]

  /**
   * Write Medusa's own totals into BT-106…BT-115 as *declared* totals, so the
   * validator compares them against what it computes (BR-CO-10…16).
   *
   * Default `false`, and that default is the considered one: the two arithmetics
   * disagree by a cent often enough — Medusa rounds a tax-inclusive line one
   * way, EN 16931 rounds it another — that switching this on turns a working
   * integration into a stream of BR-CO-13 failures. Off, the generated document
   * is always internally consistent and any disagreement is reported as a
   * reconciliation note instead. Turn it on when you want the mismatch to be
   * loud.
   */
  declareTotals?: boolean
  /** Reconciliation tolerance in major units. Default `0.02`. */
  totalsTolerance?: number

  /** Treat `warning`-severity findings as a failure. Default `false`. */
  failOnWarnings?: boolean
  /** Store the XML in the plugin's own table. Default `true`. */
  storeXml?: boolean
  /** Write the validation report to `order.metadata`. Default `true`. */
  writeOrderMetadata?: boolean
  /** Order metadata key for the report. Default `"einvoice"`. */
  metadataKey?: string

  /** Hosted layer. Everything below is optional and nothing depends on it. */
  attestwireApiKey?: string
  attestwireBaseUrl?: string
  /** Create a shareable Validation Record per invoice (`?record=true`). Default `true` when a key is set. */
  createValidationRecords?: boolean
  /** Log a line at startup if the pinned library trails the hosted ruleset. Default `true` when a key is set. */
  checkRuleCurrency?: boolean
}

/** A note the mapping wants a human to see, but which is not a rule finding. */
export interface MappingNote {
  code: string
  message: string
  /** `warning` means the document may be wrong; `info` means we made a choice. */
  level: "info" | "warning"
}
