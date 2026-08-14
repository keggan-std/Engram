# Third-Party Notices

Engram is MIT licensed — see [`LICENSE`](LICENSE).

> **Why this is a separate file.** These notices used to live at the bottom of
> `LICENSE`, under a `## Third-Party Dependencies` heading. Appending anything to a
> licence file defeats GitHub's licence detector: it stops matching the MIT template
> and reports **`NOASSERTION`** — no licence at all — through the repository sidebar
> and the API, while `package.json` continues to say `MIT`. Two public channels, two
> answers, and the one that says "unlicensed" is the one compliance tooling reads.
> Split so both agree. See [`docs/foundations/10-public-surface.md`](docs/foundations/10-public-surface.md) §2.5.

---

## Runtime dependencies

Every package Engram depends on at runtime is MIT licensed. All seven are listed —
the previous table named three of seven, omitting four whose copyright notices MIT
requires a redistributor to carry.

| Package | Copyright | Licence text |
|---|---|---|
| `@modelcontextprotocol/sdk` | © 2024 Anthropic, PBC | https://github.com/modelcontextprotocol/typescript-sdk/blob/main/LICENSE |
| `better-sqlite3` | © 2016 Joshua Wise | https://github.com/WiseLibs/better-sqlite3/blob/master/LICENSE |
| `cors` | © 2013 Troy Goode | https://github.com/expressjs/cors/blob/master/LICENSE |
| `express` | © 2009–2014 TJ Holowaychuk, Roman Shtylman, Douglas Christopher Wilson | https://github.com/expressjs/express/blob/master/LICENSE |
| `open` | © Sindre Sorhus | https://github.com/sindresorhus/open/blob/main/license |
| `ws` | © 2011 Einar Otto Stangvik | https://github.com/websockets/ws/blob/master/LICENSE |
| `zod` | © 2020 Colin McDonnell | https://github.com/colinhacks/zod/blob/master/LICENSE |

Full licence texts are installed under `node_modules/` alongside each package.

---

## Scope

This file covers **runtime dependencies only** — the packages present in a published
install. Development-only dependencies (TypeScript, vitest, supertest, and the rest of
`devDependencies`) are not redistributed and are not listed.

`tests/public-surface/public-surface.test.ts` asserts that every entry in
`package.json`'s `dependencies` appears in the table above, so a dependency added
without a notice fails the suite.
