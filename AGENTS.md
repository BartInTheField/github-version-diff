# PR Versions for GitHub

A Chrome extension (Manifest V3, TypeScript, esbuild) that adds a version picker to GitHub PRs and Linear Diffs.
`mise.toml` pins Node and lists the tasks (`mise tasks`); each wraps an npm script. The code map is in
[docs/development.md](docs/development.md).

## Before you change code

- **Data sourcing** (`src/github/`, `src/versions.ts`): read [NOTES.md](NOTES.md) first. It records which GitHub
  page or API each fact comes from, and why the obvious sources (the PR timeline) were rejected.
- **Where the picker mounts**: every GitHub DOM selector lives in `src/ui/mount-targets.ts`. Keep it that way.

## Proving a change works

A change is done when it is _seen_ in a browser, not only when the tests are green.

1. `mise run check`.
2. `mise run screenshot`. It builds `dist/`, loads it into Playwright's Chromium on
   [cli/cli#14768](https://github.com/cli/cli/pull/14768) and writes `docs/images/screenshot-{light,dark}.png`.
   First run: `mise install && mise run setup`.
3. **Read both PNGs.** The picker should sit in the toolbar with the popover open, rows v11…v15, and a range on the
   trigger. A missing popover, an error note or a blank frame is a failure, whatever the exit code says.
4. The README shows these PNGs. Commit them only when the picker's look changed on purpose. Otherwise
   `git checkout docs/images` to drop the re-render noise.

Flags, the reference PR, and what the output means: [docs/testing.md](docs/testing.md#browser-run-and-screenshots).

To drive the picker further (click a row, follow **Open diff ↗**), write a throwaway Playwright script in your
scratchpad that reuses the launch options in `scripts/screenshot.mjs`. The picker renders in an open shadow root on
`.prv-host`; Playwright locators pierce it, so `.prv-host .popover` works.

## What only the user can test

The Playwright browser is logged out, has no token, and can't push. These need the user, in their own Chrome:

- anything behind a login: private repos, **Your last review**, Linear Diffs
- the token path
- anything that needs a new push or force-push

Name the items from the manual checklist in [docs/testing.md](docs/testing.md#manual-test-checklist) that the change
touches, and ask the user to run them. To load a new build there: `npm run build`, click reload on the extension card
in `chrome://extensions`, then reload the PR tab.

## Docs

- `README.md` is the product page: what it does, why, install. Keep it short and user-facing.
- Details go in `docs/`, one topic per file, linked from the README's **Docs** list.

## Commits

One imperative sentence as the subject, no prefix (`Shut down quietly after the extension is reloaded or updated`).
The body says why.
