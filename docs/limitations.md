# Known limitations

- **Partial history** only when GitHub's push activity doesn't cover the PR (e.g. very old PRs). The extension then
  falls back to the PR timeline and shows **⚠ partial history**.
- **The rebase check without a token is a heuristic.** It can't decide when a version is already in the base branch
  (e.g. after a merge-commit merge), and then says nothing.
- **No interdiff.** For a rebased range, the compare view shows base-branch changes mixed in, and there is no "PR
  changes only" view.
- **New "Files changed" experience:** the mount selectors are unverified, so the picker may float bottom-right instead
  of sitting in the toolbar.
- **Linear Diffs:** the picker sits bottom-left, next to Linear's help button, because Linear's layout wasn't available
  to target. It shows on `linear.app/…/review/…` pages, taking the PR from the URL or from a GitHub PR link on the page.
  GitHub data is fetched through the extension's background worker using your GitHub login. Whether Chrome sends
  GitHub's session cookies on those requests is **not yet verified on a private repo**. If it doesn't, add a
  [token](token.md).
- **Content script scope:** it runs on all of `github.com` and `linear.app` (needed to catch SPA navigation), but only
  does something on PR Files tabs and Linear review pages.
