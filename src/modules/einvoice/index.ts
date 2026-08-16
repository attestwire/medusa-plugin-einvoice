import { Module } from "@medusajs/framework/utils"

import EInvoiceModuleService from "./service"
import startupLoader from "./loaders/startup"

/** Container registration key. Resolve with `container.resolve(EINVOICE_MODULE)`. */
export const EINVOICE_MODULE = "einvoice"

export default Module(EINVOICE_MODULE, {
  service: EInvoiceModuleService,
  loaders: [startupLoader],
})

export { default as EInvoiceModuleService } from "./service"
export { default as EInvoiceDocument } from "./models/einvoice-document"
