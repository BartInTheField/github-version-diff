# Testing

There are three layers:

| Layer | Where | Runs with |
|---|---|---|
| Unit tests | `test/*.test.ts`, against recorded fixtures in `test/fixtures/` | `npm test` |
| Browser run | the built extension in Playwright's Chromium, on a public PR | `npm run screenshot` |
| Manual checklist | a real PR in Chrome, below | by hand, before a risky change ships |

CI (`.github/workflows/test.yml`) runs `npm run typecheck`, `npm test` and `npm run build` on every pull request and
push to `main`.

## Unit tests

[Vitest](https://vitest.dev) with jsdom. The fixtures are real GitHub responses for `cli/cli#14768` (14 force-pushes),
recorded during the data-sourcing spike in [NOTES.md](../NOTES.md):

| Fixture | What |
|---|---|
| `pr14768-activity.html` | The branch's Activity page: one entry per push |
| `pr14768-conversation.html` | The Conversation tab, with force-push timeline items |
| `pr14768-commits.html` | The Commits tab: head, base, current commits |
| `pr14768-files-classic.html` | The classic Files changed tab, for the mount selectors |
| `pr14768-graphql.json` | The GraphQL timeline, as the token path sees it |
| `real-6-files.diff` | A `.diff` for the diff parser and the rebase check |

When GitHub changes its markup, record a fresh page into `test/fixtures/` and update the test that reads it.

## Browser run and screenshots

`npm run screenshot` builds `dist/`, loads it as an unpacked extension into Playwright's Chromium (logged out, fresh
profile), opens the Files tab of [cli/cli#14768](https://github.com/cli/cli/pull/14768), opens the picker, and saves
`docs/images/screenshot-light.png` and `screenshot-dark.png`. These are the README screenshots.

```sh
mise run setup                     # once: npm ci + Playwright's Chromium
npm run screenshot                                         # cli/cli#14768, headless
npm run screenshot -- https://github.com/<o>/<r>/pull/<n>  # another public PR
npm run screenshot -- --headed                             # watch it run
```

It prints where the picker mounted (`light: mounted at classic-diffbar → …`). `floating` means no toolbar selector in
`src/ui/mount-targets.ts` matched. It fails if the picker never appears or stays disabled for 30 seconds.

cli/cli#14768 is the reference PR: public, merged, 15 versions from 14 force-pushes, and the source of the fixtures.

## Manual test checklist

Run against a real PR, logged in, with and without a [token](token.md):

- [ ] **Graphite parity**: on a PR that's also in Graphite, the version count and SHAs match Graphite's picker (v1 =
  the state the PR was opened with).
- [ ] **Normal pushes only** (no force-push): one version per push, not per commit; **Open diff** shows just the last
  push.
- [ ] **Force-pushes only** (amend + force-push a few times): one version per force-push, marked `force-push`; v2 → v4
  opens the right compare page.
- [ ] **Rebase onto a newer main**: pick a range across the rebase and check the rebase warning appears; hover lists
  main-only files. A range without the rebase has no warning.
- [ ] **Stacked PR** (base is another feature branch that gets force-pushed): base-branch force-pushes are not
  versions.
- [ ] **Your last review**: review a colleague's PR, push again; your reviewed version is tagged **Your last review**
  and is the default "from".
- [ ] **Last viewed**: open a diff to vN, push again, and reload. The default becomes vN → latest with a "1 new
  version" badge.
- [ ] **SPA navigation**: Files → Conversation → Files, and PR → another PR via links. The picker is there once, for
  the right PR, without reloading.
- [ ] **Dark mode**: switch GitHub's theme; the picker follows it.
- [ ] **Edge cases**: draft PR, PR from a fork, closed and merged PRs. An old SHA that was garbage-collected shows "no
  longer available".
- [ ] **Linear Diffs**: open `linear.review/<owner>/<repo>/pull/<n>` for a PR in a private repo. The picker appears
  bottom-left with the same versions as on GitHub, and **Open diff ↗** opens GitHub. Navigating to a Linear issue
  removes it.
- [ ] **Extension reload**: reload the extension while a PR is open. The old picker is removed with no console errors,
  and reloading the page brings it back.
