# Data sourcing notes

> The first spike (sections 1–3) used the PR timeline. It was superseded by push activity; see **Decision** below.

Spike done on 2026-11-03 against public PRs in `cli/cli`, mostly #14768: 14 force-pushes, 2 current commits, merged with a merge commit.
Recorded responses are in `test/fixtures/`.

## Decision (revised: one version per push, like Graphite)

| Need | Without a token (default) | With a PAT |
|---|---|---|
| **Pushes to the head branch (primary)** | Activity page `/<headOwner>/<headRepo>/activity?ref=<branch>`, embedded JSON | REST `GET /repos/{o}/{r}/activity?ref=refs/heads/<branch>` |
| Force-push events (fallback) | Conversation page HTML, head branch only | GraphQL `timelineItems` |
| Current commits, head, base, branch, created time | Commits tab embedded JSON | REST `GET /pulls/{n}` |
| "Your last review" | Reviewers sidebar `a#review-status-<login>` → `/files/<sha>` | REST `GET /pulls/{n}/reviews` + `/user` |
| Rebase check | Heuristic using 3 `.diff` fetches | REST compare `merge_base_commit` |
| Showing the diff | GitHub's native `/compare/A..B` page | same |

### Why the change: Graphite comparison on a private stacked PR

On a private PR, Graphite showed v21 and the extension showed v57, with the same three newest heads. There were two causes:

1. **Base-branch force-pushes were counted.** The PR is stacked on another feature branch, which was force-pushed 15 times during the PR. The Conversation page renders `BaseRefForcePushedEvent` exactly like a head force-push (same `octicon-repo-push` icon and `/compare/A..B` link). The only difference is the branch name in `.commit-ref`. Each one added 2 versions.
2. **The timeline is lossy.** GitHub collapses consecutive force-pushes into a single item ("force-pushed the X branch 11 times, most recently from A to B"), and hides the middle of long timelines.

Graphite counts one version per push, from the PR's opening state onward. GitHub's **repository activity** has exactly that: one entry per push with `before`, `after`, `pushType` (`push`, `force_push`, `branch_creation`, `branch_deletion`), time and pusher. For that PR, the REST activity has 1 creation + 20 force-pushes = 21, which matches Graphite's v1…v21 SHA for SHA. For cli/cli#14768 the token-less Activity page gives 15 versions, identical to the GraphQL force-push chain.

Rules (`buildFromPushes` in `src/versions.ts`):

- v1 is the last push at or before the PR's creation time.
- Then one version per later push. A normal push of several commits counts as one version.
- The list ends at the last push whose `after` is the PR head. This handles reused branch names and pushes after merge.
- If no push matches the head, fall back to the timeline and mark the list partial.

The Activity page paginates newest-first, 30 per page, via `&after=<endCursor>`. Loading stops once a page reaches the PR's creation time. It works logged out for public repos (verified), and with the session cookie for private ones (not yet verified).

## 1. Token-less: github.com HTML

**Force-push events: works, with gaps.** Each event is a `.TimelineItem` with an `octicon-repo-push` badge. It contains `<a href="/o/r/compare/<before40>..<after40>">force-pushed</a>`, an `a.author` actor and `relative-time[datetime]`. Each event has two compare links (the text link and the "Compare" button), so the parser de-duplicates them.

**Pagination: the main weakness.** On #14768, the logged-out HTML shows **4 of 14** force-pushes: the oldest two and the newest two. The hidden middle is behind an element like this:

```html
<div id="js-timeline-progressive-loader"
     data-timeline-item-src="cli/cli/timeline_focused_item?after_cursor=…&before_cursor=…&id=PR_…">
```

That URL returns **404 when logged out**. The scanner follows it, as well as classic `form.ajax-pagination-form` "Load more…" forms. **It is not verified whether a logged-in session can load it.** If any page fails, the list is marked incomplete.

A second incompleteness check runs on any source: the newest force-push we saw landed on a SHA that is neither in the current history nor the head. That means a later force-push was missed.

**Commits tab: works.** `script[data-target="react-app.embeddedData"]` → `payload.pullRequestsCommitsRoute.commitGroups[].commits[]` has `oid`, `committedDate`, `authors`, `shortMessage` and `pushedDate` (always null so far). `payload.pullRequestsLayoutRoute.pullRequest` has `headSha`, `baseBranch`, `baseSha` and `state`. The code falls back to `/pull/N/commits/<sha>` links if the JSON is missing.

**`.diff` URLs: work.** `github.com/o/r/compare/A..B.diff` and `base...sha.diff` are served from github.com as `text/plain` with no redirect, so a same-origin `fetch` with cookies works for private repos. A garbage-collected SHA returns 404.

**Merge-base: not exposed** by any page we looked at (compare page, commits page). Hence the heuristic below.

## 2. GraphQL with a PAT

`repository.pullRequest(number).timelineItems(itemTypes: [HEAD_REF_FORCE_PUSHED_EVENT, PULL_REQUEST_COMMIT])` is complete and paginated (100 per page).

- **`totalCount` is wrong when `itemTypes` is set.** #14804 reported 72 with zero matching nodes. Never use it; count the nodes.
- `PullRequestCommit` nodes come sorted by commit date, and can appear before the force-push that introduced them. The version builder does not depend on that ordering.
- `beforeCommit` / `afterCommit` can be null for objects GitHub no longer has. Those events are skipped.

`api.github.com` sends CORS headers, so the content script calls it directly. No `api.github.com` host permission is needed.

## 3. REST timeline

`GET /repos/{o}/{r}/issues/{n}/timeline` was not needed: GraphQL covers everything and returns the before/after SHAs directly.

## Native diff view

GitHub's in-PR range view (`/pull/N/files/A..B` and `/changes/A..B`) returns **404 for force-pushed SHAs**, so it can't be used. `/compare/A..B` works for any SHAs that still exist, so the picker links there (new tab). This replaced the custom diff2html viewer from the original spec.

## Rebase heuristic (no token)

Fetch the range diff `A..B` and the PR patch at both versions (`base...A`, `base...B`). A file in the range diff came from the base branch if:

- it is in neither patch, or
- its patch is identical in both versions, after dropping hunk line numbers and blob ids (which a rebase changes).

If either patch is empty, the check gives no answer. This happens for a version already contained in the base, such as after a merge-commit merge.

## Version list algorithm

See `buildVersions` in `src/versions.ts`. In short:

1. Commits still in history that predate the first force-push.
2. For each force-push: its `before` (this also captures normal pushes since the previous force-push) and its `after` (marked as force-push).
3. Commits after the last force-push's `after`, one version each.
4. The head, if not already last.

Commits that were pushed normally and later rewritten are lost, except for the last one before each force-push. GitHub keeps no record of them.

## Mount points

The classic Files tab has `.pr-toolbar .diffbar` (verified in a recorded page). The newer React "Files changed" experience was not visible logged out, so its selectors in `src/ui/mount-targets.ts` are guesses. If none match, the picker floats in the bottom-right corner, so it still works.

## Linear Diffs

`linear.review/<o>/<r>/pull/<n>` returns a 302 to `linear.app/review/<o>/<r>/pull/<n>`. The page is behind a login, so its DOM wasn't inspected.

- **Detection:** `src/page.ts` matches `/review/<o>/<r>/pull/<n>` anywhere in the path. If that fails, it uses the first `https://github.com/<o>/<r>/pull/<n>` link on a `/review/` page.
- **Mount:** floating (bottom-right). No Linear selectors.
- **Data:** from linear.app, github.com requests are cross-origin, and GitHub sends no CORS headers. They go through the background service worker (`host_permissions: github.com`) with `credentials: 'include'`. Tested with a stand-in page on a public PR. **Unverified:** whether Chrome attaches GitHub's SameSite session cookies to service-worker requests for private repos. The PAT path doesn't depend on this.
