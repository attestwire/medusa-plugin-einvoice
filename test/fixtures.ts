/**
 * Synthetic Medusa orders, one per mapping decision worth getting wrong.
 *
 * These are hand-built rather than captured from a live shop on purpose: a
 * captured order tells you what one shop did, and a hand-built one lets you
 * state the case you are testing. Amounts are deliberately awkward (11.99 at
 * 19 % inclusive, 33.33 split three ways) because round numbers hide exactly
 * the rounding defects this suite exists to catch.
 */

import type { EInvoicePluginOptions, MedusaOrder } from "../src/lib/types.js"

/** A German seller, fully configured — the XRechnung-capable baseline. */
export const sellerDE: EInvoicePluginOptions["seller"] = {
  name: "Beispiel Handels GmbH",
  vatId: "DE123456789",
  taxRegistrationId: "181/815/08155",
  legalRegistrationId: "HRB 12345 B",
  address: {
    line1: "Hauptstraße 1",
    city: "Berlin",
    postalCode: "10115",
    countryCode: "DE",
  },
  electronicAddress: { schemeId: "9930", value: "DE123456789" },
  contact: {
    name: "Buchhaltung",
    email: "rechnungen@beispiel.example",
    phone: "+49 30 1234567",
  },
}

export const baseOptions: EInvoicePluginOptions = {
  seller: sellerDE,
  payment: {
    meansCode: "58",
    meansName: "SEPA credit transfer",
    iban: "DE02120300000000202051",
    accountName: "Beispiel Handels GmbH",
    bic: "BYLADEM1001",
  },
  paymentTerms: "Zahlbar innerhalb von 30 Tagen ohne Abzug.",
  paymentTermDays: 30,
}

const germanBuyer = {
  company: "Bundesamt für Musterangelegenheiten",
  first_name: "Erika",
  last_name: "Mustermann",
  address_1: "Behördenweg 9",
  city: "München",
  postal_code: "80331",
  country_code: "de",
  phone: "+49 89 7654321",
}

/**
 * Case 1 — the ordinary domestic order. Net pricing, two VAT rates, no
 * promotions, one shipping method.
 */
export const domesticNetOrder: MedusaOrder = {
  id: "order_01H1",
  display_id: 1042,
  email: "erika@example.de",
  currency_code: "eur",
  created_at: "2026-08-15T09:31:00.000Z",
  metadata: { buyer_reference: "04011000-1234512345-06" },
  billing_address: germanBuyer,
  shipping_address: germanBuyer,
  items: [
    {
      id: "ordli_1",
      title: "Ergonomischer Bürostuhl",
      product_description: "Bürostuhl mit Lordosenstütze",
      variant_sku: "CHAIR-ERG-01",
      quantity: 2,
      unit_price: 249.5,
      is_tax_inclusive: false,
      tax_lines: [{ rate: 19, code: "DE-STD", description: "Regelsteuersatz" }],
      adjustments: [],
    },
    {
      id: "ordli_2",
      title: "Handbuch (gedruckt)",
      variant_sku: "BOOK-01",
      variant_barcode: "4006381333931",
      quantity: 3,
      unit_price: 11.11,
      is_tax_inclusive: false,
      tax_lines: [{ rate: 7, code: "DE-RED", description: "Ermäßigt" }],
      adjustments: [],
    },
  ],
  shipping_methods: [
    {
      id: "ordsm_1",
      name: "DHL Paket",
      amount: 5.9,
      is_tax_inclusive: false,
      tax_lines: [{ rate: 19, code: "DE-STD" }],
      adjustments: [],
    },
  ],
  // 499.00 + 33.33 + 5.90 = 538.23 net; VAT 19% on 504.90 = 95.931 → 95.93,
  // 7% on 33.33 = 2.3331 → 2.33. Total 636.49.
  subtotal: 538.23,
  tax_total: 98.26,
  total: 636.49,
}

/**
 * Case 2 — tax-inclusive pricing, the case this plugin most has to get right.
 * 11.99 gross at 19 % is 10.075630252100840… net; truncating that to 10.08
 * before multiplying by 7 loses a cent.
 */
export const taxInclusiveOrder: MedusaOrder = {
  ...domesticNetOrder,
  id: "order_01H2",
  display_id: 1043,
  items: [
    {
      id: "ordli_1",
      title: "Kaffeebohnen 1 kg",
      variant_sku: "COFFEE-1KG",
      quantity: 7,
      unit_price: 11.99,
      is_tax_inclusive: true,
      tax_lines: [{ rate: 19, code: "DE-STD" }],
      adjustments: [],
    },
  ],
  shipping_methods: [
    {
      id: "ordsm_1",
      name: "DHL Paket",
      amount: 4.99,
      is_tax_inclusive: true,
      tax_lines: [{ rate: 19, code: "DE-STD" }],
      adjustments: [],
    },
  ],
  subtotal: 74.72,
  tax_total: 14.19,
  total: 88.92,
}

/**
 * Case 3 — promotions. An item-level percentage discount, a fixed-amount
 * discount on a second item, and a free-shipping promotion that zeroes the
 * shipping charge through an adjustment rather than through the amount.
 */
export const discountedOrder: MedusaOrder = {
  ...domesticNetOrder,
  id: "order_01H3",
  display_id: 1044,
  items: [
    {
      id: "ordli_1",
      title: "Ergonomischer Bürostuhl",
      variant_sku: "CHAIR-ERG-01",
      quantity: 2,
      unit_price: 249.5,
      is_tax_inclusive: false,
      tax_lines: [{ rate: 19, code: "DE-STD" }],
      adjustments: [
        {
          id: "ordliadj_1",
          code: "SUMMER10",
          description: "Sommeraktion 10 %",
          promotion_id: "promo_1",
          amount: 49.9,
          is_tax_inclusive: false,
        },
      ],
    },
    {
      id: "ordli_2",
      title: "Schreibtischlampe",
      variant_sku: "LAMP-01",
      quantity: 1,
      unit_price: 59.99,
      is_tax_inclusive: true,
      tax_lines: [{ rate: 19, code: "DE-STD" }],
      adjustments: [
        {
          id: "ordliadj_2",
          code: "TENOFF",
          description: "10 € Gutschein",
          amount: 10,
          is_tax_inclusive: true,
        },
      ],
    },
  ],
  shipping_methods: [
    {
      id: "ordsm_1",
      name: "DHL Paket",
      amount: 5.9,
      is_tax_inclusive: false,
      tax_lines: [{ rate: 19, code: "DE-STD" }],
      adjustments: [
        {
          id: "ordsmadj_1",
          code: "FREESHIP",
          description: "Versandkostenfrei ab 100 €",
          amount: 5.9,
        },
      ],
    },
  ],
  subtotal: 499 + 50.41 + 5.9,
  tax_total: 94.29,
  total: 590.2,
}

/**
 * Case 4 — intra-EU B2B reverse charge. Dutch buyer with a VAT id, zero tax
 * lines. Should produce category AE, the standard note, and a Peppol document
 * (the `"auto"` profile for a non-DE/FR buyer).
 */
export const reverseChargeOrder: MedusaOrder = {
  id: "order_01H4",
  display_id: 1045,
  email: "ap@voorbeeld.nl",
  currency_code: "eur",
  created_at: "2026-08-15T09:31:00.000Z",
  metadata: {
    vat_id: "NL123456789B01",
    einvoice_buyer_endpoint: { schemeId: "9944", value: "NL123456789B01" },
    purchase_order: "PO-2026-0088",
  },
  billing_address: {
    company: "Voorbeeld Handelsmaatschappij B.V.",
    address_1: "Keizersgracht 1",
    city: "Amsterdam",
    postal_code: "1015 CJ",
    country_code: "NL",
  },
  items: [
    {
      id: "ordli_1",
      title: "Beratungsleistung",
      quantity: 10,
      unit_price: 150,
      is_tax_inclusive: false,
      tax_lines: [],
      adjustments: [],
    },
  ],
  shipping_methods: [],
  subtotal: 1500,
  tax_total: 0,
  total: 1500,
}

/**
 * Case 5 — export outside the EU, in a non-EUR currency. Swiss buyer, CHF,
 * zero tax. Should produce category G and a CHF document.
 */
export const exportOrder: MedusaOrder = {
  ...reverseChargeOrder,
  id: "order_01H5",
  display_id: 1046,
  currency_code: "chf",
  metadata: {
    einvoice_buyer_endpoint: { schemeId: "0183", value: "CHE-123.456.789" },
  },
  billing_address: {
    company: "Beispiel Schweiz AG",
    address_1: "Bahnhofstrasse 1",
    city: "Zürich",
    postal_code: "8001",
    country_code: "CH",
  },
  items: [
    {
      id: "ordli_1",
      title: "Ersatzteil-Set",
      quantity: 4,
      unit_price: 87.25,
      is_tax_inclusive: false,
      tax_lines: [{ rate: 0, code: "EXPORT" }],
      adjustments: [],
    },
  ],
  subtotal: 349,
  tax_total: 0,
  total: 349,
}

/**
 * Case 6 — a French buyer, so `"auto"` selects the Factur-X CII payload. Also
 * carries a quantity of 0.5 (a metred service) to exercise a non-integer
 * quantity against BR-DEC-*.
 */
export const frenchOrder: MedusaOrder = {
  id: "order_01H6",
  display_id: 1047,
  email: "compta@exemple.fr",
  currency_code: "eur",
  created_at: "2026-08-15T09:31:00.000Z",
  metadata: {
    vat_id: "FR12345678901",
    einvoice_buyer_endpoint: { schemeId: "0009", value: "12345678900017" },
  },
  billing_address: {
    company: "Exemple SARL",
    address_1: "12 rue de la Paix",
    city: "Paris",
    postal_code: "75002",
    country_code: "FR",
  },
  items: [
    {
      id: "ordli_1",
      title: "Prestation de conseil",
      quantity: 0.5,
      unit_price: 1200,
      is_tax_inclusive: false,
      tax_lines: [{ rate: 20, code: "FR-STD" }],
      adjustments: [],
    },
  ],
  shipping_methods: [],
  subtotal: 600,
  tax_total: 120,
  total: 720,
}

/**
 * Case 7 — the hostile one. Server-side `BigNumber` shapes instead of numbers,
 * a missing billing address, a mixed-rate item, and a negative adjustment.
 * Nothing here is expected to be *valid*; the test asserts that it does not
 * throw, produces named findings, and never emits NaN.
 */
export const hostileOrder: MedusaOrder = {
  id: "order_01H7",
  display_id: 1048,
  email: "buyer@example.com",
  currency_code: "eur",
  created_at: "2026-08-15T09:31:00.000Z",
  metadata: {},
  billing_address: null,
  shipping_address: {
    first_name: "Sam",
    last_name: "Buyer",
    address_1: "1 Nowhere Lane",
    city: "",
    postal_code: "",
    country_code: "gb",
  },
  items: [
    {
      id: "ordli_1",
      title: "Mystery box",
      quantity: { numeric_: 2 },
      unit_price: { numeric_: 33.335 },
      is_tax_inclusive: true,
      tax_lines: [
        { rate: { numeric_: 15 }, code: "A" },
        { rate: { numeric_: 5 }, code: "B" },
      ],
      adjustments: [
        { id: "adj", description: "Handling surcharge", amount: -2.5, is_tax_inclusive: true },
      ],
    },
  ],
  shipping_methods: [],
  total: { numeric_: 66.67 },
  tax_total: { numeric_: 11.11 },
}
