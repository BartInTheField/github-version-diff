# Privacy policy

PR Versions for GitHub collects nothing. It has no server, no analytics and no tracking.

## What it stores

Everything stays in your browser, in `chrome.storage.local`:

- **Your GitHub token**, only if you add one on the options page.
- **The last version you viewed per pull request**: the PR (owner, repo, number) and that version's commit SHA. This
  is what the default range is based on.

Removing the extension deletes both.

## What it sends, and where

- **github.com**: it reads PR pages with your normal GitHub session, the same requests your browser makes when you
  open those pages. On Linear Diffs, the extension's background worker makes these requests for the page.
- **api.github.com**: only if you added a token. The token goes only to the GitHub API.

On linear.app it reads the page you're on to find the linked GitHub PR. It sends nothing to Linear.

No data is sold, shared with third parties, or used for anything other than showing PR versions.

## Contact

Questions: [open an issue](https://github.com/BartInTheField/github-version-diff/issues/new).
