# Contributing

This repository is developed in the open, so the normal GitHub flow applies:
fork it, branch, open a pull request. No CLA, no template to sign.

## Where your issue belongs

This plugin maps a Medusa order onto the EN 16931 invoice model and stores the
result. **The validation rules and the XML generation come from
[`@attestwire/en16931`](https://github.com/attestwire/en16931).**

So:

- A rule that fired when it shouldn't have, wrong XML in the output, a parsing
  failure — that's the engine. Report it at
  [attestwire/en16931](https://github.com/attestwire/en16931/issues), with the
  XML and the rule ID you expected.
- Order mapping, plugin options, the module and its migrations, workflows and
  subscribers, the admin widget — that's here.

The mapping layer is where most real bugs live, and they look like this: a
Medusa field lands on the wrong business term, a tax line groups differently
from how the VAT breakdown expects, an order shape the mapper doesn't handle
yet. Those are worth reporting in detail, with the order shape that caused them.

## Running the tests

Node 20.19+ or 22.12+.

```bash
npm install
npm test          # vitest run
npm run typecheck # tsc --noEmit
npm run build     # medusa plugin:build
```

To run one file while you iterate:

```bash
npx vitest run test/mapping.test.ts
```

`test/fixtures.ts` holds the order shapes the mapping tests run against. If
you're fixing a mapping bug, the cleanest PR adds the order shape that broke to
that file, asserts the invoice fields it should produce, and then fixes it.

## Before you open the PR

Run `npm test` and `npm run typecheck`. If your change touches the module or its
schema, regenerate migrations with `npm run db:generate` and commit them.

Keep it working against the Medusa version in `peerDependencies`. If a change
needs a newer Medusa, say so in the PR. That's a version bump, not a detail.

## Questions

Open an issue, or email hello@attestwire.com.

Security issues go to hello@attestwire.com. See [SECURITY.md](SECURITY.md).

## Licence

MIT. By contributing, you agree your contribution ships under it.
