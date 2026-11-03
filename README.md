# PR Versions for GitHub

A Chrome extension that adds a Graphite-style **version picker** to the Files tab of a GitHub pull request, and to the same PR in [Linear Diffs](https://linear.app/docs/diffs). Each push to the PR branch is a version, like in Graphite, including states lost to force-pushes. Pick any two versions and **Open diff ↗** shows exactly what changed between them in GitHub's own compare view.

Typical use: an agent or colleague says "pushed the fix" after a few force-pushes, and you want to see only what changed since the version you reviewed.

## Install

1. Download the latest `pr-versions_<version>.zip` from [Releases](https://github.com/BartInTheField/github-version-diff/releases/latest) and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and pick the unzipped `pr-versions` folder.
4. Open any PR's **Files changed** tab. The picker appears in the toolbar, or bottom-right if the layout is unknown.
5. In Linear, open a PR review (`linear.review/<owner>/<repo>/pull/<n>`). The picker sits bottom-left, next to the help button; **Open diff ↗** opens GitHub in a new tab.

**To update:** unzip a newer release over the same `pr-versions` folder, then click reload on the extension card.

### From source

```sh
npm install
npm run build   # → dist/, then Load unpacked on dist/
```

## Optional: GitHub token

Without a token, versions come from github.com pages using your normal login: the repo's **Activity** page for the PR branch, which lists every push. A token adds an exact rebase check, and is a fallback if the pages can't be read.

1. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new) for the right resource owner (e.g. your org). Give it read-only **Pull requests** and **Contents** access to the repos you review.
2. In `chrome://extensions`, click **Details** on PR Versions for GitHub, then **Extension options**.
3. Paste the token and click **Save**. It is checked against the API and stored only in `chrome.storage.local`.
4. Reload the PR page.

If the token fails later (expired, no access), the picker falls back to page data and says so.

## What you see

The toolbar button shows the current range (`v3 → v5`, or **All changes** for Base → latest). Click it to open the version popover:

- **Rows:** Base (the base branch), then v1…vN, oldest first. v1 is the state the PR was opened with, and every later push adds a version, so the numbers match Graphite's. Each row shows the short SHA (with a copy button), the push date, the pusher, and whether it was a force-push.
- **Picking a range:** set the start with the red **from** column and the end with the green **to** column. Options that would put "from" after "to" are faded.
- **Default range:** the previous version → latest. Once you've opened a diff on a PR, it becomes the last version you opened → latest. That row gets a **Your last review** tag (from your latest submitted GitHub review) or a **Last viewed** tag, and the button shows a "N new" count.
- **Open diff ↗** opens GitHub's compare view: `A..B` between versions, or `base...B` from Base.
- **⚠ This range includes a rebase:** the compare view will mix in base-branch changes. Hover to see which files changed only on the base branch.
- **No longer available:** GitHub garbage-collected an old force-pushed commit.
- **Looks native on each site:** on GitHub it uses Primer's own colour variables, so it follows every GitHub theme (light, dark, dimmed, high contrast). On Linear it takes the colours and font of the page behind it, plus Linear's indigo accent and compact menu style, so custom Linear themes work too.

## Known limitations

- **Partial history** only when GitHub's push activity doesn't cover the PR (e.g. very old PRs). The extension then falls back to the PR timeline and shows **⚠ partial history**.
- **The rebase check without a token is a heuristic.** It can't decide when a version is already in the base branch (e.g. after a merge-commit merge), and then says nothing.
- **No interdiff.** For a rebased range, the compare view shows base-branch changes mixed in, and there is no "PR changes only" view.
- **New "Files changed" experience:** the mount selectors are unverified, so the picker may float bottom-right instead of sitting in the toolbar.
- **Linear Diffs:** the picker sits bottom-left, next to Linear's help button, because Linear's layout wasn't available to target. It shows on `linear.app/…/review/…` pages, taking the PR from the URL or from a GitHub PR link on the page. GitHub data is fetched through the extension's background worker using your GitHub login. Whether Chrome sends GitHub's session cookies on those requests is **not yet verified on a private repo**. If it doesn't, add a token.
- **Content script scope:** it runs on all of `github.com` and `linear.app` (needed to catch SPA navigation), but only does something on PR Files tabs and Linear review pages.

## Development

```sh
npm test           # Vitest, uses recorded fixtures in test/fixtures
npm run typecheck
npm run build      # → dist/
npm run zip        # → pr-versions.zip
```

### Releases

Every push to `main` is tested, built and published as a GitHub release (`.github/workflows/release.yml`). Versions use CalVer: `YYYY.MM.DD.N`, where N counts the releases of that UTC day.

- The tag and the version Chrome shows (`version_name`) are e.g. `2026.11.03.1`.
- The manifest `version` drops leading zeros (`2026.11.3.1`), because Chrome requires plain integers.
- Local builds are `0.0.0` / `dev`.

Code map:

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

## Manual test checklist

Run against a real PR, logged in, with and without a token:

- [ ] **Graphite parity**: on a PR that's also in Graphite, the version count and SHAs match Graphite's picker (v1 = the state the PR was opened with).
- [ ] **Normal pushes only** (no force-push): one version per push, not per commit; **Open diff** shows just the last push.
- [ ] **Force-pushes only** (amend + force-push a few times): one version per force-push, marked `force-push`; v2 → v4 opens the right compare page.
- [ ] **Rebase onto a newer main**: pick a range across the rebase and check the rebase warning appears; hover lists main-only files. A range without the rebase has no warning.
- [ ] **Stacked PR** (base is another feature branch that gets force-pushed): base-branch force-pushes are not versions.
- [ ] **Your last review**: review a colleague's PR, push again; your reviewed version is tagged **Your last review** and is the default "from".
- [ ] **SPA navigation**: Files → Conversation → Files, and PR → another PR via links. The picker is there once, for the right PR, without reloading.
- [ ] **Dark mode**: switch GitHub's theme; the picker follows it.
- [ ] **Edge cases**: draft PR, PR from a fork, closed and merged PRs. An old SHA that was garbage-collected shows "no longer available".
- [ ] **Linear Diffs**: open `linear.review/<owner>/<repo>/pull/<n>` for a PR in a private repo. The picker appears bottom-left with the same versions as on GitHub, and **Open diff ↗** opens GitHub. Navigating to a Linear issue removes it.
- [ ] **Last viewed**: open a diff to vN, push again, and reload. The default becomes vN → latest with a "1 new version" badge.
