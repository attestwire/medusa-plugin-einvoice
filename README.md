# medusa-plugin-einvoice

EN 16931 e-invoicing for Medusa v2. When an order is placed, generate a
compliant **XRechnung**, **Peppol BIS 3.0** or **Factur-X (CII)** XML document
from the order, validate it against the business rules *before* storing it, and
attach the verdict to the order.

Generation and validation run **locally and for free** via
[`@attestwire/en16931`](https://www.npmjs.com/package/@attestwire/en16931) — a
zero-dependency TypeScript implementation of the rules. There is no API to sign
up for, no per-invoice cost, and no network call in the default configuration.

## Quickstart

```bash
npm install medusa-plugin-einvoice
```

```ts
// medusa-config.ts
module.exports = defineConfig({
  plugins: [
    {
      resolve: "medusa-plugin-einvoice",
      options: {
        seller: {
          name: "Beispiel Handels GmbH",
          vatId: "DE123456789",
          legalRegistrationId: "HRB 12345 B",
          address: {
            line1: "Hauptstraße 1",
            city: "Berlin",
            postalCode: "10115",
            countryCode: "DE",
          },
          // BR-DE-2/5/6/7: all three are mandatory for XRechnung.
          contact: {
            name: "Buchhaltung",
            email: "rechnungen@beispiel.example",
            phone: "+49 30 1234567",
          },
          electronicAddress: { schemeId: "9930", value: "DE123456789" },
        },
        // BR-DE-1: XRechnung requires payment instructions.
        payment: {
          meansCode: "58",
          iban: "DE02120300000000202051",
          accountName: "Beispiel Handels GmbH",
        },
        paymentTermDays: 30,
      },
    },
  ],
})
```

```bash
npx medusa db:migrate
```

That is the whole setup. Place an order and the plugin generates the document,
validates it, stores it, and writes a report to `order.metadata.einvoice`. The
order details page in the admin gains an **E-invoice** panel with the status,
any rule failures, and a download button.

**Node 20.19+ or 22.12+ is required** (the same floor as Medusa 2.19). This is
load-bearing rather than incidental: the validation engine is an ESM-only
package and a Medusa plugin compiles to CommonJS, so the plugin relies on
Node's `require(esm)` support, which is unflagged from exactly those versions.

## What it produces

| Buyer country | Profile (`profile: "auto"`) | Syntax |
| --- | --- | --- |
| DE | `xrechnung-ubl` | UBL 2.1 |
| FR | `facturx-en16931` | CII D16B |
| anywhere else | `peppol-bis-3` | UBL 2.1 |

Override globally with `profile`, or per country with
`profileByCountry: { AT: "peppol-bis-3" }`.

### The Factur-X boundary, stated plainly

For a French buyer this plugin emits the **Factur-X CII XML payload**. It does
**not** build the PDF/A-3 container that makes a file a Factur-X *invoice*. The
underlying library reads that container (`extractFacturX`) and deliberately does
not write one.

So: if your counterparty wants the XML — which is what portals, access points
and the Chorus Pro/PPF pipeline consume — you have it. If you need the
human-readable PDF with the XML embedded, you need a PDF/A-3 step this plugin
does not provide. Take the XML from `GET /admin/orders/:id/einvoice?format=xml`
and embed it with a PDF library of your choice.

## Validation-first

Nothing is stored before it is validated, and a document that fails is stored
flagged and logged rule by rule:

```
[einvoice] RE-2026-1042: xrechnung-ubl FAILED validation with 1 error(s).
[einvoice]   BR-DE-15 (BT-10): A German public-sector buyer requires a Leitweg-ID …
[einvoice]     fix: set buyerReference to the Leitweg-ID your client gave you
[einvoice]     https://attestwire.com/rules/BR-DE-15
```

The same findings land on the order:

```jsonc
// order.metadata.einvoice
{
  "invoice_number": "RE-2026-1042",
  "profile": "xrechnung-ubl",
  "valid": false,
  "errors": [{ "rule": "BR-DE-15", "field": "BT-10", "fix": "…", "docs": "https://attestwire.com/rules/BR-DE-15" }],
  "notes": [{ "code": "VAT_INTRA_COMMUNITY", "level": "info", "message": "…" }],
  "reconciliation": { "matches": true, "deltas": [ /* … */ ] }
}
```

An invoice never blocks an order. A failed generation is logged and stored; the
checkout is unaffected.

## Mapping decisions

This is the part worth reading before you trust it in production.

**Tax-inclusive pricing.** EN 16931's BT-146 is a *net* unit price. When
`is_tax_inclusive` is set, VAT is divided out at 8 decimals before the quantity
is applied — rounding the unit price to 2 decimals first is what makes a
multi-line order a cent short. The line *amount* is then rounded as BR-DEC-*
requires.

**Discounts become line allowances (BG-27), not document allowances.** A Medusa
promotion arrives as an `adjustment` on the item it discounted. A line allowance
inherits that line's VAT treatment; a document allowance carries its own
category and rate, so hoisting a per-item discount to document level means
inventing a rate for it — and getting the VAT breakdown wrong as soon as an
order mixes 19 % and 7 % goods. An adjustment that is itself tax-inclusive has
VAT removed at the line's rate. A *negative* adjustment becomes a line charge
(BG-28), because BR-41/BR-42 require both to be stated positively.

**Shipping becomes a document charge (BG-21, reason code `FC`).** A
shipping-method promotion becomes a document allowance (BG-20) at the shipping
rate — it is the one discount with no line to sit on. Set `shippingAsLine: true`
if you would rather see freight as an invoice line.

**Totals are computed, not copied.** The engine derives BT-106…BT-115 from the
lines, so the document is always internally consistent. Medusa's own totals are
then *compared* and any disagreement is reported as a `TOTALS_MISMATCH` note.
Set `declareTotals: true` to write Medusa's figures into the document instead
and let BR-CO-10…16 reject the mismatch outright — useful for catching an
accounting bug, disruptive as a default.

**VAT categories are inferred, and every inference leaves a note.** Medusa knows
how much tax it charged, never why it charged none. Zero can mean four different
things:

| Situation | Category | Option |
| --- | --- | --- |
| rate > 0 | `S` | — |
| zero, same country | `Z` | `zeroRateCategory` |
| zero, EU buyer with a VAT id | `AE` | `intraCommunityCategory` (`K` for goods) |
| zero, EU buyer without a VAT id | `Z` + warning | — |
| zero, non-EU buyer | `G` | — |

`AE`, `K` and `G` also put the standard exemption sentence in BT-22.

**Multi-currency** passes `currency_code` through as BT-5. If VAT must be
*reported* in another currency (BT-6/BT-111) the plugin does not attempt it: the
required exchange rate is not on the order, and inventing one would be a tax
statement.

**Multiple tax lines at different rates on one item** are summed, because
EN 16931 allows one category and one rate per line — with a `MULTIPLE_TAX_LINES`
warning.

**Buyer identity** comes from the billing address, falling back to shipping with
a warning. Company name wins over person name. The buyer's VAT id and Peppol
endpoint come from order metadata (`vat_id`, `einvoice_buyer_endpoint`), because
Medusa has nowhere else to keep them.

## Optional hosted layer

Everything above works with no account. Setting `attestwireApiKey` adds two
things, neither of which anything depends on:

```ts
options: {
  attestwireApiKey: process.env.ATTESTWIRE_API_KEY,
  createValidationRecords: true, // default when a key is set
  checkRuleCurrency: true,       // default when a key is set
}
```

- **Validation Records.** A shareable URL proving the check ran, for a buyer's
  AP desk or an auditor, stored on the order as `record_url`. The invoice itself
  never leaves your process — the hosted side keeps a SHA-256 fingerprint and
  the findings, nothing more.
- **Rule-currency check.** One call to `/v1/versions` at boot. If the pinned
  library trails the current ruleset you get one warning naming the rule ids
  added since. Silence when current.

Both fail soft. An invoice is never blocked by a network problem, and the local
verdict is always the one that produced your XML.

## API

```
GET  /admin/orders/:id/einvoice              → the stored document + report
GET  /admin/orders/:id/einvoice?format=xml   → download the XML
POST /admin/orders/:id/einvoice { force }    → generate / regenerate
```

Programmatically, from anywhere in your app:

```ts
import { generateEInvoiceWorkflow } from "medusa-plugin-einvoice/workflows"

const { result } = await generateEInvoiceWorkflow(container).run({
  input: { order_id: "order_123" },
})
```

Or without Medusa at all — the mapping layer is framework-free:

```ts
import { buildEInvoice } from "medusa-plugin-einvoice/lib"

const { xml, valid, errors } = buildEInvoice(order, options)
```

## Configuration reference

| Option | Default | Meaning |
| --- | --- | --- |
| `seller` | — | **Required.** Name, address, VAT id, contact. |
| `profile` | `"auto"` | Fixed profile, or country-derived. |
| `profileByCountry` | `{}` | Per-country override. |
| `events` | `["order.placed"]` | Also accepts `"order.completed"`. |
| `invoiceNumberPrefix` | `""` | Prefixed to the order's `display_id`. |
| `invoiceNumberMetadataKey` | — | Order metadata key that overrides the number. |
| `buyerReferenceMetadataKey` | `"buyer_reference"` | BT-10 / Leitweg-ID. |
| `buyerEndpointMetadataKey` | `"einvoice_buyer_endpoint"` | BT-49, `{ schemeId, value }`. |
| `buyerVatIdMetadataKey` | `"vat_id"` | BT-48. |
| `defaultUnitCode` | `"C62"` | BT-130 unit of measure. |
| `zeroRateCategory` | `"Z"` | Domestic zero rate. |
| `intraCommunityCategory` | `"AE"` | `"K"` for goods. |
| `vatExemptionReasons` | — | BT-120 per category. `E` has no default. |
| `shippingAsLine` | `false` | Freight as a line instead of BG-21. |
| `payment` / `paymentTerms` / `paymentTermDays` | — | BG-16, BT-20, BT-9. |
| `declareTotals` | `false` | Write Medusa's totals into BT-106…115. |
| `totalsTolerance` | `0.02` | Reconciliation tolerance. |
| `failOnWarnings` | `false` | Treat warnings as failures. |
| `storeXml` | `true` | Keep the XML in the plugin's table. |
| `writeOrderMetadata` | `true` | Write the report to `order.metadata`. |
| `attestwireApiKey` | — | Enables the hosted layer. |

## Scope, honestly

**In scope and working:** order → EN 16931 XML (UBL and CII), local validation
with rule ids and docs links, storage, order metadata report, admin panel,
download endpoint, workflow API, tax-inclusive pricing, promotions, shipping,
multi-currency, reverse charge and export.

**Not in scope, and here is what you would need instead:**

- **PDF/A-3 Factur-X containers.** XML payload only. See above.
- **Transmission.** Nothing is sent anywhere. No Peppol access point, no Chorus
  Pro, no email. The document is generated and stored; delivery is yours.
- **Credit notes and refunds.** A Medusa return or claim does not yet produce a
  BT-3 `381` document. The underlying library supports credit notes fully
  (one field), so this is a mapping gap, not a capability gap.
- **Order edits.** An invoice is generated once. Editing an order afterwards
  does not amend it — a corrected invoice legally needs its own number and a
  BG-3 reference back, which the plugin does not mint.
- **`payment.captured` as a trigger.** Its payload is a payment id, not an
  order id; resolving one to the other reliably is left to your own subscriber.
- **Sequential invoice numbering.** The number is the order's `display_id` with
  an optional prefix. Several jurisdictions require a gap-free sequence per
  seller, which an order id is not.
- **Storing seller data per sales channel or region.** One seller, from config.

## Development

```bash
npm install
npm test          # 42 mapping tests, every fixture validated by the engine
npm run typecheck
npm run build     # medusa plugin:build
```

The test suite's standing rule: every fixture that should produce a sendable
invoice must come back `valid: true` from the engine, and one that should not
must fail *by naming the rule*.

### Regenerating the migration

Only needed after changing the model in `src/modules/einvoice/models/`. The
Medusa CLI builds its own MikroORM config for this command, so it reads
`DB_HOST`/`DB_PORT`/`DB_USERNAME`/`DB_PASSWORD` rather than `DATABASE_URL`, and
it connects to a database named `medusa-einvoice`, which must exist:

```bash
DB_HOST=localhost DB_PORT=5432 DB_USERNAME=postgres DB_PASSWORD=postgres \
  npm run db:generate
```

The diff is taken against `.snapshot-medusa-einvoice.json`, which is committed
next to the migrations. Keep it committed — without it the next run emits a
duplicate create-table migration instead of an incremental one.

## License

MIT
