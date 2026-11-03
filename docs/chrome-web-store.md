# Chrome Web Store

How to publish a release to the store, and the text for the listing form.

## Publish a release

Every push to `main` makes a GitHub release with a `pr-versions_<version>_chrome-web-store.zip` (manifest at the zip
root). Sending one to the store is a manual step, because each submission sits in review for days:

1. Open **Actions → Chrome Web Store → Run workflow**.
2. Leave **tag** empty for the latest release, or enter one (e.g. `2026.11.03.1`).
3. Run it. The job summary shows the state, normally `PENDING_REVIEW`. It goes live when the review passes.

If a previous submission is still in review, the run stops. Tick the cancel option to replace it. That restarts the
review wait.

The manifest `version` is the release's CalVer (see [development.md](development.md#releases)). The store requires each
upload to have a higher version, and CalVer always goes up.

## Publish from CI: one-time setup

The workflow (`.github/workflows/chrome-web-store.yml`) logs in to Google with GitHub's OIDC token, as a service account
that the store dashboard trusts. No key is stored in GitHub.

1. **First submission, by hand.** The API can't create an item. In the
   [developer dashboard](https://chrome.google.com/webstore/devconsole), upload the latest `_chrome-web-store.zip`,
   fill in the **Store listing** and **Privacy** tabs from [Form text](#form-text), and submit. Note the item ID (in the
   item's URL) and the publisher ID (on the **Account** page).
2. **Service account.** In a Google Cloud project:

   ```sh
   gcloud services enable chromewebstore.googleapis.com iamcredentials.googleapis.com sts.googleapis.com
   gcloud iam service-accounts create chrome-web-store
   ```

   It needs no IAM roles.
3. **Trust it in the store.** Dashboard → **Account** → add the service account's email
   (`chrome-web-store@PROJECT_ID.iam.gserviceaccount.com`). One per publisher.
4. **Let this repo's workflows act as it.** `PROJECT_NUMBER` is on the Cloud console's project dashboard.

   ```sh
   gcloud iam workload-identity-pools create github --location=global
   gcloud iam workload-identity-pools providers create-oidc github --location=global --workload-identity-pool=github \
     --issuer-uri=https://token.actions.githubusercontent.com \
     --attribute-mapping=google.subject=assertion.sub,attribute.repository=assertion.repository \
     --attribute-condition="assertion.repository=='BartInTheField/github-version-diff'"
   gcloud iam service-accounts add-iam-policy-binding chrome-web-store@PROJECT_ID.iam.gserviceaccount.com \
     --role=roles/iam.workloadIdentityUser \
     --member=principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/BartInTheField/github-version-diff
   ```

5. **GitHub environment and variables.** None of these are secrets.

   ```sh
   gh api -X PUT repos/BartInTheField/github-version-diff/environments/chrome-web-store
   gh variable set CWS_PUBLISHER_ID --env chrome-web-store --body PUBLISHER_ID
   gh variable set CWS_ITEM_ID --env chrome-web-store --body ITEM_ID
   gh variable set GCP_SERVICE_ACCOUNT --env chrome-web-store --body chrome-web-store@PROJECT_ID.iam.gserviceaccount.com
   gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --env chrome-web-store \
     --body projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/github
   ```

   Optional: in the repo's **Settings → Environments → chrome-web-store**, add yourself as a required reviewer.

If the OIDC login doesn't work with the store API, fall back to a key: create a JSON key for the service account, store
it as the `GCP_SA_KEY` secret in the environment, and replace the auth step's `workload_identity_provider` and
`service_account` with `credentials_json: ${{ secrets.GCP_SA_KEY }}`.

## Listing assets

- Icon: `static/icons/icon-128.png`
- Small promo tile: `docs/store/promo-440x280.png`
- Screenshot: `docs/store/screenshot-1280x800.png`

`node scripts/icons.mjs` renders the icons and the promo tile from `assets/icon.svg`. `mise run screenshot` renders the
screenshot.

## Form text

**Summary**: Compare any two versions of a GitHub pull request, including across force-pushes. Works on GitHub and
Linear Diffs.

**Category**: Developer Tools

**Single purpose**: Adds a version picker to GitHub pull requests, so a reviewer can see what changed between any two
pushes.

**Permission justifications**:

- `storage`: keeps the optional GitHub token and the last version the user viewed per pull request, locally.
- Host `https://github.com/*`: reads the pull request's push history from github.com pages, and lets the picker on
  Linear Diffs make those same requests.
- Content script on `https://linear.app/*`: shows the same picker on Linear Diffs, which review GitHub pull requests.

**Remote code**: No. All code is in the package.

**Data usage**: tick **Authentication information** (the optional GitHub token, stored locally and sent only to
api.github.com). Tick all three certifications: not sold, not used for unrelated purposes, not used for
creditworthiness.

**Privacy policy URL**: https://github.com/BartInTheField/github-version-diff/blob/main/docs/privacy.md
