# GitHub token

A token is optional. Without one, versions come from github.com pages using your normal login: the repo's **Activity**
page for the PR branch, which lists every push.

A token adds:

- an exact rebase check, instead of a heuristic
- a fallback when the pages can't be read

## Set it up

1. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new) for the right resource owner
   (e.g. your org). Give it read-only **Pull requests** and **Contents** access to the repos you review.
2. In `chrome://extensions`, click **Details** on PR Versions for GitHub, then **Extension options**.
3. Paste the token and click **Save**. It is checked against the API and stored only in `chrome.storage.local`.
4. Reload the PR page.

If the token fails later (expired, no access), the picker falls back to page data and says so.
