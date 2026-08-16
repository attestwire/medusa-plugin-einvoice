/**
 * Workflow barrel.
 *
 * The `./workflows` subpath in package.json points here. The Medusa plugin
 * starter ships no such file, so importing `medusa-plugin-einvoice/workflows`
 * from a shop would fail without it.
 */

export {
  generateEInvoiceWorkflow,
  EINVOICE_ORDER_FIELDS,
  type GenerateEInvoiceInput,
  type GenerateEInvoiceOutput,
} from "./generate-einvoice.js"

export { generateEInvoiceWorkflow as default } from "./generate-einvoice.js"
