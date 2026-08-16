import type { LoaderOptions } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"
import { createRequire } from "node:module"
import { join } from "node:path"

import { fetchVersions, ruleCurrencyMessage } from "../../../lib/attestwire.js"
import type { EInvoicePluginOptions } from "../../../lib/types.js"

/**
 * Fail loudly at boot for a misconfiguration, and warn once about a stale
 * ruleset.
 *
 * The validation half is not optional politeness: a seller block with no
 * address produces an invoice that fails BR-8 on every single order, and
 * discovering that from a subscriber log at 2 a.m. is strictly worse than
 * refusing to start.
 */
export default async function startupLoader({
  options,
  container,
}: LoaderOptions<EInvoicePluginOptions>): Promise<void> {
  const logger = container.resolve("logger") as {
    info: (msg: string) => void
    warn: (msg: string) => void
  }

  const opts = (options ?? {}) as EInvoicePluginOptions

  const missing: string[] = []
  if (!opts.seller) missing.push("seller")
  else {
    if (!opts.seller.name) missing.push("seller.name")
    if (!opts.seller.address) missing.push("seller.address")
    else {
      if (!opts.seller.address.city) missing.push("seller.address.city")
      if (!opts.seller.address.postalCode) missing.push("seller.address.postalCode")
      if (!opts.seller.address.countryCode) missing.push("seller.address.countryCode")
    }
  }

  if (missing.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `medusa-plugin-einvoice: missing required option(s): ${missing.join(
        ", "
      )}. An EN 16931 invoice cannot be generated without a seller name and postal address (BT-27, BG-5).`
    )
  }

  if (!opts.seller.vatId && !opts.seller.taxRegistrationId) {
    logger.warn(
      "[einvoice] neither seller.vatId (BT-31) nor seller.taxRegistrationId (BT-32) is set. BR-CO-26 requires one of them, so every generated invoice will fail validation."
    )
  }

  // Only a German profile can be selected by "auto", so this warning is scoped
  // to shops that will actually hit BR-DE-*.
  const wantsXRechnung =
    opts.profile === "xrechnung-ubl" ||
    opts.profile === "xrechnung-cii" ||
    opts.profile === undefined ||
    opts.profile === "auto"
  if (wantsXRechnung && !opts.payment) {
    logger.warn(
      "[einvoice] no `payment` option is set. BR-DE-1 makes payment instructions (BG-16) mandatory for XRechnung, which is the profile selected for German buyers."
    )
  }
  if (wantsXRechnung && !opts.seller.contact?.email) {
    logger.warn(
      "[einvoice] seller.contact is incomplete. BR-DE-2/5/6/7 make the seller contact name, phone and email mandatory for XRechnung."
    )
  }

  await logRuleCurrency(opts, logger)
}

/**
 * One line, once, and only when the pinned library trails the hosted ruleset.
 *
 * WHY THIS IS NOT A HARD FAILURE. A compliance library that refuses to boot
 * because a newer one exists would take a shop's checkout down for a release it
 * did not ask for. The failure mode being guarded against is the *silent* one —
 * validating happily against last year's rules — and a log line at boot fixes
 * that without holding anyone's store hostage.
 */
async function logRuleCurrency(
  options: EInvoicePluginOptions,
  logger: { info: (msg: string) => void; warn: (msg: string) => void }
): Promise<void> {
  if (options.checkRuleCurrency === false) return
  // No key, no call: the endpoint is public, but making an unrequested outbound
  // request from a plugin nobody configured for network access is the kind of
  // surprise that gets a package removed from a shop.
  if (!options.attestwireApiKey) return

  const installed = installedEngineVersion()
  const versions = await fetchVersions({
    baseUrl: options.attestwireBaseUrl,
    apiKey: options.attestwireApiKey,
  })

  const message = ruleCurrencyMessage(installed, versions)
  if (message) logger.warn(message)
  else if (versions && installed) {
    logger.info(
      `[einvoice] validating against ${versions.ruleset} via @attestwire/en16931 ${installed} (${versions.rule_id_count} rule ids).`
    )
  }
}

/** The version of the engine actually loaded, or `null` if it cannot be read. */
function installedEngineVersion(): string | null {
  try {
    const require_ = createRequire(join(process.cwd(), "package.json"))
    const pkg = require_("@attestwire/en16931/package.json") as { version?: string }
    return pkg.version ?? null
  } catch {
    return null
  }
}
