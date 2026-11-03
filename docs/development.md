# Development

## Setup

```sh
npm install
npm run build      # → dist/, then Load unpacked on dist/
npm run watch      # rebuild on change
npm run typecheck
npm test           # see testing.md
npm run zip        # → pr-versions.zip
```

After a rebuild, click reload on the extension card in `chrome://extensions` and reload the PR page.

How the version list is sourced, and why, is in [NOTES.md](../NOTES.md).

## Code map

| Path | What |
|---|---|
| `src/versions.ts` | Builds the version list from force-pushes + commits |
| `src/github/html-source.ts` | Token-less scraping of Conversation + Commits pages |
| `src/github/api-source.ts` | GraphQL timeline + REST merge-base (PAT) |
| `src/diff/` | `.diff` fetching, a git diff parser, the rebase check |
| `src/ui/mount-targets.ts` | All "where to inject" selectors |
| `src/ui/picker.ts`, `src/ui/range.ts` | Trigger button + version popover (shadow DOM) |
| `src/page.ts` | Which PR the current page (GitHub or Linear) is about |
| `src/github/net.ts`, `src/background.ts` | github.com requests: direct on GitHub, via the service worker on Linear |
| `src/content.ts` | Entry point and SPA navigation handling |

## Releases

Every push to `main` is tested, built and published as a GitHub release (`.github/workflows/release.yml`). Versions use
CalVer: `YYYY.MM.DD.N`, where N counts the releases of that UTC day.

- The tag and the version Chrome shows (`version_name`) are e.g. `2026.11.03.1`.
- The manifest `version` drops leading zeros (`2026.11.3.1`), because Chrome requires plain integers.
- Local builds are `0.0.0` / `dev`.
