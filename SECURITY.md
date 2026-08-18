# Security

## Reporting

Email **hello@attestwire.com**. The maintainer reads these directly.

Include what you found, how to reproduce it, and the plugin version you were on.
Please don't open a public issue for a security report.

There's no bug bounty. If you'd like credit, say so and you'll be named in the
release notes for the fix.

## Scope

This plugin runs inside your Medusa server and handles invoice documents, which
carry customer names, addresses, VAT IDs and bank details. Worth reporting:

- Anything that exposes a stored invoice, its XML, or its findings to a request
  that shouldn't see it — an admin route missing an authentication check, a
  store-facing endpoint returning another customer's document, an ID that can be
  guessed or enumerated.
- Anything that puts document contents or configured seller credentials into a
  log, an error response, or an admin view the wrong people can reach.
- Injection through order data into the generated XML, or through plugin options
  into a query or a filesystem path.
- Anything that makes an outbound network call in the default configuration.
  Generation and validation run locally.

## Out of scope

A wrong verdict, or malformed XML out of the generator, is a bug in the rule
engine. Report it at
[attestwire/en16931](https://github.com/attestwire/en16931/issues).

Vulnerabilities in the engine itself (XML parsing, entity expansion, the PDF
reader) belong in that repository's
[SECURITY.md](https://github.com/attestwire/en16931/blob/main/SECURITY.md)
process, same email either way.

Vulnerabilities in Medusa itself go to the Medusa project.
