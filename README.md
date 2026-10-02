# Daybreak

Source-only frontend for an authenticated private CV-preparation workspace.

The published site contains application code, styles and the pinned locally bundled Supabase SDK. Personal records and original/prepared files live in private owner-scoped database tables and a private Storage bucket. No personal vault, document bytes, server credentials or private repository history belongs here.

Email/password sign-in uses the existing enrolled account. GitHub sign-in remains available for recovery while the owner verifies password setup and recovery. There is no signup, automatic employer application or scheduled processing. A submitted CV request is saved for an authorized private worker; it is not a promise of immediate processing.

Passwords go directly to the configured authentication service. Session tokens and drafts stay in memory; only a short-lived PKCE verifier survives an auth redirect in tab storage. Refresh requires sign-in. Public project URL and publishable key are not server secrets. RLS and private Storage policies enforce access.

## Development

Use Node 24, run `npm ci`, `npm test`, and `npm run check`. `npm run build:auth` rebuilds the locally pinned Auth SDK bundle. Serve `docs/` with a local static server. Public tests use synthetic data only. Full browser and private worker tests are maintained with the private operator implementation.

The `docs/index.html` entry loads `hosted-app.js`, `hosted-auth.js` and `hosted-store.js`. Source publication uses the Pages workflow. Never put environment secrets in browser code or commit private data.

The current public ciphertext files were removed at hosted cutover. Previously published encrypted versions remain in Git history; this release does not claim to revoke historical downloads.
