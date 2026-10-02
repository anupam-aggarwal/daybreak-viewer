# Daybreak

Public source for an owner-authenticated CV-preparation workspace. The published site is in `docs/`; personal records, original documents, prepared PDFs, requests and replies live in the private Supabase project. The Python worker and CV tools in `tools/` run in a private cloud workspace using this repository. Normal operation needs no private Git checkout or old vault passphrase.

Read [guide/CLOUD_WORKFLOW.md](guide/CLOUD_WORKFLOW.md) for installation, source recovery, CV preparation, explicit claim/checkpoint/reply steps, and the verified private recovery copy. Never put personal documents or server credentials in this repository. The worker is single-publisher and CV-only; there is no scheduled processing or employer submission.

Email/password uses the existing owner account. GitHub login remains temporary recovery. The browser keeps tokens and drafts in memory; RLS and private Storage protect personal data. The public project URL and publishable key in the browser are not server credentials.

For UI changes run `npm ci`, `npm test`, `npm run check`, and the synthetic browser check described in the cloud guide. `npm run build:auth` rebuilds the pinned local Auth SDK bundle. The Pages workflow publishes only `docs/` on a normal push to `main`.

Current-branch `docs/vault.enc.json` and `docs/artifacts/*.enc` were removed at hosted cutover. Earlier encrypted versions remain in Git history and may already have been downloaded. This source cleanup cannot revoke those historical ciphertexts.
