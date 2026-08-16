/**
 * The optional hosted layer.
 *
 * NOTHING IN THIS FILE IS LOAD-BEARING, and that is a design commitment rather
 * than a current limitation. Generation and validation happen locally, in
 * `@attestwire/en16931`, for free, with no network call — a shop with no API
 * key and no internet gets identical XML and identical findings. This module
 * adds two things on top, both of which fail soft:
 *
 *  - a **Validation Record**: the same verdict, stored by Attestwire at a URL
 *    you can hand to a buyer's AP desk or an auditor. The document itself never
 *    leaves the process — the hosted side stores a SHA-256 fingerprint of it and
 *    the findings, nothing more.
 *  - a **rule-currency check**: one call at startup that compares the pinned
 *    library against the current hosted ruleset, so a plugin left at 0.7.0 for
 *    a year says so in the log instead of silently validating against a stale
 *    rulebook.
 *
 * Every function here swallows its own errors and returns a null-ish result. An
 * invoice must never fail to generate because a third-party API was down.
 */

import type { EInvoiceResult } from "./generate.js"

const DEFAULT_BASE_URL = "https://api.attestwire.com"
const TIMEOUT_MS = 8_000

export interface ValidationRecord {
  id: string
  /** The human page — this is the URL you paste into an email. */
  url: string
  /** The machine-readable copy of the same record. */
  json: string
  expires?: string
}

export interface VersionsDocument {
  engine: string
  engine_version: string
  ruleset: string
  rule_id_count: number
  kosit_conformance?: { recorded?: string; validator?: string; configuration?: string }
  releases?: { version: string; date: string; rules_added?: string[] }[]
}

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fn(controller.signal)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Create a shareable Validation Record for an invoice we already validated
 * locally.
 *
 * The hosted validator is the same engine, so the verdict is the same; the
 * point of the round trip is the artefact, not a second opinion. If the two
 * ever disagree the local one is the one that generated your XML, and that
 * disagreement is worth reporting as a bug — so it is logged rather than
 * hidden.
 */
export async function createValidationRecord(
  result: EInvoiceResult,
  options: { apiKey: string; baseUrl?: string; logger?: { warn: (msg: string) => void } }
): Promise<ValidationRecord | null> {
  const base = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")

  const body = await withTimeout(async (signal) => {
    const response = await fetch(`${base}/v1/validate?record=true`, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify(result.input),
    })
    if (!response.ok) {
      options.logger?.warn(
        `[einvoice] validation record not created: HTTP ${response.status}. The invoice is unaffected — validation already ran locally.`
      )
      return null
    }
    return (await response.json()) as {
      valid?: boolean
      record?: ValidationRecord
      record_unavailable?: { reason: string; message: string }
    }
  })

  if (!body) return null

  if (body.record_unavailable) {
    options.logger?.warn(
      `[einvoice] validation record not stored: ${body.record_unavailable.message}`
    )
    return null
  }

  if (typeof body.valid === "boolean" && body.valid !== result.valid) {
    options.logger?.warn(
      `[einvoice] hosted validator disagrees with the local engine for invoice ${result.invoiceNumber} (hosted valid=${body.valid}, local valid=${result.valid}). The local verdict is the one that produced your XML. Please report this at https://github.com/attestwire/en16931/issues.`
    )
  }

  return body.record ?? null
}

export async function fetchVersions(options: {
  baseUrl?: string
  apiKey?: string
}): Promise<VersionsDocument | null> {
  const base = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")
  return withTimeout(async (signal) => {
    const response = await fetch(`${base}/v1/versions`, {
      signal,
      headers: options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {},
    })
    if (!response.ok) return null
    return (await response.json()) as VersionsDocument
  })
}

/** Semver compare, enough for `0.7.0` vs `0.8.1`. Returns -1, 0 or 1. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .split("-")[0]
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0)
  const left = parse(a)
  const right = parse(b)
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

/**
 * One line at startup, and only when there is something to say.
 *
 * A compliance library that is quietly a year out of date is the failure mode
 * this exists to prevent: the rules changed, your invoices still pass locally,
 * and the receiver rejects them. Silence when current, one warning when not.
 */
export function ruleCurrencyMessage(
  installedVersion: string | null,
  versions: VersionsDocument | null
): string | null {
  if (!installedVersion || !versions?.engine_version) return null
  if (compareVersions(installedVersion, versions.engine_version) >= 0) return null

  const newer = (versions.releases ?? []).filter(
    (release) => compareVersions(release.version, installedVersion) > 0
  )
  const rules = newer.flatMap((release) => release.rules_added ?? [])
  const ruleNote = rules.length
    ? ` ${rules.length} rule id(s) were named since then, including ${rules
        .slice(0, 5)
        .join(", ")}${rules.length > 5 ? ", …" : ""}.`
    : ""

  return `[einvoice] @attestwire/en16931 ${installedVersion} is behind the current ruleset ${versions.engine_version} (${versions.ruleset}).${ruleNote} Upgrade the dependency to validate against the current rules.`
}

export { DEFAULT_BASE_URL }
