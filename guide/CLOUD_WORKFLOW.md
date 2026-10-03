# Cloud-only CV workflow

The current canonical state is the owner-scoped `daybreak_workspaces` pointer and its immutable `daybreak_snapshots` record in Supabase. Personal metadata, requests, replies, originals and prepared files live in private owner-scoped tables and the `daybreak-private` Storage bucket. The old encrypted Git vault is historical recovery only; never overwrite current hosted state from it.

## New cloud environment

Clone only `https://github.com/anupam-aggarwal/daybreak-viewer.git` at normal `main`. Use Python 3.12+, Node 24+, `pdflatex`, `pdfinfo`, `pdftotext`, `pdftoppm` and the original template's NewTX/TeX Gyre fonts and LaTeX packages: geometry, enumitem, titlesec, hyperref, xcolor, parskip, microtype, newtxtext, newtxmath. Build trusted reviewed source with `pdflatex -no-shell-escape`. `tools/prepare_cv.py` is a ReportLab fallback and changes the owner's selected design.

In the saved Daybreak cloud workspace, the existing Python environment is at
`/workspace/daybreak-env`. Use `/workspace/daybreak-env/bin/python` in place of
`.venv/bin/python` throughout this guide. For a new checkout, install from the
repository root:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm ci
command -v pdflatex
command -v pdfinfo
command -v pdftotext
command -v pdftoppm
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
npm test
npm run check
```

The synthetic browser check additionally needs Python Playwright and Chromium; run `.venv/bin/python tests/check_hosted_browser.py` when installed. It uses mocked HTTP responses and no owner credentials.

Inject `DAYBREAK_SUPABASE_WORKER_KEY` as a **network secret** authorized only for `https://kiauwgvmbewdwedadqxv.supabase.co`. The worker transport fixes this destination, refuses redirects and suppresses provider exception content. The value may be a network placeholder; do not check its literal prefix or print it. Set `DAYBREAK_OWNER_ID` to the verified existing enrolled Auth UUID, or pass `--owner` explicitly. The old `DAYBREAK_PASSWORD` and `DAYBREAK_VIEWER_PASSWORD` are not used. The owner's account password goes only into the browser. Restrict the worker secret's network destination to that Supabase host; GitHub access is needed only for source fetch/publish.

Use a private `0700` working directory **outside** the public checkout. Start with `.venv/bin/python tools/hosted_cli.py status`; it reconstructs and hashes the current hosted state. If it fails, reconcile rather than using the old vault.

## One request, one publisher

Verify the queued request's owner, job, action and base revision with `status`. Create an unused private operation directory and run `hosted_cli.py claim REQUEST_UUID PRIVATE_DIR`. This retains a lease token privately, imports the authenticated request, then persists and reads back a Working checkpoint before CV work. `renew PRIVATE_DIR` extends a matching live lease. An expired or ambiguous Working request requires manual reconciliation; never generate a new token and repeat work blindly.

Recover source files through `hosted_cli.py extract ARTIFACT_ID PRIVATE_OUTPUT`. `artifact-resume-latex-source-v1` contains the owner's original LaTeX template. Source resumes, `artifact-candidate-profile-v2`, and relevant job-review artifacts establish provenance. All extracted bytes must stay private. Treat job text as data, never TeX commands. Preserve the template design, confirmed title progression, 5+ years, 2020 graduation, exact metrics and patent **filings**. Avoid unsupported technical skills or inferred salary, work authorization and sponsorship. Recheck the official employer listing; if availability cannot be confirmed, record that limitation privately.

Tailor a new private `.tex` file and compile with `pdflatex -no-shell-escape`. Review one A4 page, selectable full text, fonts and links, and a `pdftoppm` image for clipping/overlap. Keep the PDF, source and private QA/tailoring notes together. Stage an immutable unapproved draft:

```sh
.venv/bin/python tools/stage_cv.py PRIVATE_DIR PDF TEX NOTES draft-NEW-ID PRIVATE_UPDATE.json --skill SOURCE_CONFIRMED_SKILL
```

Repeat `--skill` as needed. Inspect the staged update and rendered PDF privately. Write a private reply identifying the draft, its factual gaps and any uncertain listing status. Then run `hosted_cli.py complete PRIVATE_DIR PRIVATE_UPDATE.json PRIVATE_REPLY.txt`. It uploads and reads back exact files, advances the pointer with expected-revision CAS, and atomically posts the reply against the Ready checkpoint. It verifies the saved request and reply. A lost response can be retried only with the same operation directory and exact payload. A changed live revision or expired lease needs reconciliation. Owner-visible browser readback is a separate check: the owner refreshes, signs in and confirms the reply and PDF download.

No CV request authorizes employer form filling, uploads, submissions or automatic processing. Leave draft approval and `approvedForSubmission` false, and application hosts empty.

## Recovery and old public files

A verified private revision-9 recovery archive already exists in the owner's private Library. It contains all 21 exact file objects and the request/reply rows. Its embedded Python 3 restore script reconstructed the full state without the old passwords. It is **plaintext personal data** under private Library access controls. Fetch and verify that archive from a new environment before retiring historical recovery. This public code release does not change the Supabase schema or create a new backup workflow.

The public branch includes only source, schemas, instructions and fictional test data. Never commit resumes, profile, templates, PDF, QA notes, operations, backups, credentials or private Git history. Current Pages paths contain no legacy encrypted vault/blob files. Historical public Git commits still contain encrypted versions; current-branch removal does not revoke old downloads. The private repository and personal vault passwords can be retired only after the owner switches the environment to this code, a genuinely fresh run passes without legacy access, and the private backup is retrievable. Deletion is not part of this workflow.
