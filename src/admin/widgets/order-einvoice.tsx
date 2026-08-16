import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { DetailWidgetProps, AdminOrder } from "@medusajs/framework/types"
import { Badge, Button, Container, Heading, Text, toast } from "@medusajs/ui"
import { useEffect, useState } from "react"

/**
 * The order-details widget: status, findings, download, regenerate.
 *
 * Scope note — this is intentionally one widget and no settings page. Plugin
 * options live in `medusa-config.ts` and are read at boot; a settings UI that
 * appeared to edit them would either lie or need a second source of truth for
 * the seller's VAT id, which is exactly the kind of split-brain a compliance
 * plugin should not introduce.
 */

type Finding = {
  rule: string
  field: string
  message: string
  fix: string
  docsUrl?: string
  docs?: string
}

type EInvoiceDocument = {
  id: string
  invoice_number: string
  profile: string
  syntax: string
  valid: boolean
  record_url: string | null
  report?: {
    errors?: Finding[]
    warnings?: Finding[]
    notes?: { code: string; message: string; level: string }[]
  } | null
}

const OrderEInvoiceWidget = ({ data: order }: DetailWidgetProps<AdminOrder>) => {
  const [document, setDocument] = useState<EInvoiceDocument | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/admin/orders/${order.id}/einvoice`, {
        credentials: "include",
      })
      setDocument(response.ok ? (await response.json()).einvoice : null)
    } catch {
      setDocument(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id])

  const generate = async (force: boolean) => {
    setBusy(true)
    try {
      const response = await fetch(`/admin/orders/${order.id}/einvoice`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      })
      const body = await response.json()
      if (response.ok) toast.success("E-invoice generated and valid.")
      else
        toast.error(
          `E-invoice failed validation: ${
            body?.einvoice?.errors?.[0]?.rule ?? "see the findings below"
          }`
        )
      await load()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const errors = document?.report?.errors ?? []
  const warnings = document?.report?.warnings ?? []

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">E-invoice</Heading>
        {document ? (
          <Badge color={document.valid ? "green" : "red"} size="2xsmall">
            {document.valid ? "Valid" : "Invalid"}
          </Badge>
        ) : null}
      </div>

      <div className="flex flex-col gap-y-3 px-6 py-4">
        {loading ? (
          <Text size="small" className="text-ui-fg-subtle">
            Loading…
          </Text>
        ) : document ? (
          <>
            <div className="flex flex-col gap-y-1">
              <Text size="small">
                <span className="text-ui-fg-subtle">Invoice number: </span>
                {document.invoice_number}
              </Text>
              <Text size="small">
                <span className="text-ui-fg-subtle">Profile: </span>
                {document.profile} ({document.syntax.toUpperCase()})
              </Text>
              {document.record_url ? (
                <Text size="small">
                  <a
                    href={document.record_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-ui-fg-interactive"
                  >
                    Shareable validation record
                  </a>
                </Text>
              ) : null}
            </div>

            {errors.length ? (
              <div className="flex flex-col gap-y-2">
                <Text size="small" weight="plus">
                  {errors.length} rule failure{errors.length === 1 ? "" : "s"} — do not send
                  this document
                </Text>
                {errors.map((finding) => (
                  <div key={`${finding.rule}-${finding.field}`} className="flex flex-col">
                    <Text size="small" weight="plus">
                      {finding.rule} ({finding.field})
                    </Text>
                    <Text size="small" className="text-ui-fg-subtle">
                      {finding.message}
                    </Text>
                    <Text size="small" className="text-ui-fg-subtle">
                      Fix: {finding.fix}
                    </Text>
                    {finding.docsUrl || finding.docs ? (
                      <a
                        href={finding.docsUrl ?? finding.docs}
                        target="_blank"
                        rel="noreferrer"
                        className="text-ui-fg-interactive text-xs"
                      >
                        What this rule means
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            {warnings.length ? (
              <Text size="small" className="text-ui-fg-subtle">
                {warnings.length} warning{warnings.length === 1 ? "" : "s"} — accepted by the
                official validators, worth a look.
              </Text>
            ) : null}

            <div className="flex gap-x-2">
              <Button
                size="small"
                variant="secondary"
                // Downloadable even when invalid: the person who has to fix the
                // document is the person who needs to read it.
                onClick={() =>
                  window.open(`/admin/orders/${order.id}/einvoice?format=xml`, "_blank")
                }
              >
                Download XML
              </Button>
              <Button size="small" variant="transparent" isLoading={busy} onClick={() => generate(true)}>
                Regenerate
              </Button>
            </div>
          </>
        ) : (
          <>
            <Text size="small" className="text-ui-fg-subtle">
              No e-invoice has been generated for this order.
            </Text>
            <div>
              <Button size="small" variant="secondary" isLoading={busy} onClick={() => generate(false)}>
                Generate
              </Button>
            </div>
          </>
        )}
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details",
  // Prefixed, per the plugin-author convention, so it cannot collide with
  // another plugin's widget id.
  id: "medusa-plugin-einvoice:order-einvoice",
})

export default OrderEInvoiceWidget
