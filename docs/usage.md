# Usage

## Where the picker appears

- **GitHub:** on a PR's **Files changed** tab, in the toolbar. If the layout is unknown, it floats bottom-right.
- **Linear Diffs:** on a PR review (`linear.review/<owner>/<repo>/pull/<n>`), bottom-left, next to the help button.
  **Open diff ↗** opens GitHub in a new tab.

The button shows the current range: `v3 → v5`, or **All changes** for Base → latest. Click it to open the version
popover.

## The version list

- **Rows:** Base (the base branch), then v1…vN, oldest first. v1 is the state the PR was opened with, and every later
  push adds a version, so the numbers match Graphite's.
- **Each row** shows the short SHA (with a copy button), the push date, the pusher, and whether it was a force-push.
- **No longer available:** GitHub garbage-collected an old force-pushed commit.
- **⚠ partial history:** GitHub's push activity doesn't cover the whole PR, so the list comes from the PR timeline. See
  [Known limitations](limitations.md).

## Picking a range

- Set the start with the red **from** column and the end with the green **to** column. Options that would put "from"
  after "to" are faded.
- **Open diff ↗** opens GitHub's compare view: `A..B` between versions, or `base...B` from Base.

## The default range

The default is the previous version → latest. Once you've opened a diff on a PR, it becomes the last version you opened
→ latest. That row gets a tag:

- **Your last review:** the version of your latest submitted GitHub review.
- **Last viewed:** the last version you opened a diff to.

The button then shows a "N new" count.

## The rebase warning

**⚠ This range includes a rebase** means the compare view will mix in base-branch changes. Hover it to see which files
changed only on the base branch. Without a [token](token.md) this check is a heuristic.

## Theming

- **GitHub:** uses Primer's colour variables, so it follows every GitHub theme (light, dark, dimmed, high contrast).
- **Linear:** takes the colours and font of the page behind it, plus Linear's indigo accent and compact menu style, so
  custom Linear themes work too.
