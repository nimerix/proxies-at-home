# Oops, All Proxies maintenance review

Reviewed the application source, persistence, image processing, import/export flows, UI, package dependencies, and build/deployment configuration. The working tree started clean at `3165420e`. Changes are local; no deployment or production configuration was modified.

The existing React, TypeScript, Zustand, Tailwind and Express architecture remains. Native controls replace Flowbite. No AGENTS.md or additional repository design conventions were present. The review uses the code-reviewer and better-interface skills, with independent Opus 5.5 criticism.

## Baseline

Both builds failed, client lint reported 39 errors and 2 warnings, and no automated tests were configured. The most serious defects affected exported backs, exact printings, saved uploaded images and upgrade/reset behavior. The server exposed an unrestricted URL proxy, public cache deletion and unused upload/streaming endpoints.

## Findings addressed

| Area                     | Trigger and original failure                                                                                                       | Correction and evidence                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duplex PDFs              | A final row with one or two cards crashed, duplicated backs, or shifted them away from their fronts.                               | Fixed-size nullable slots mirror columns consistently in preview and export. Browser tests decode real PDF drawing operations and check image counts, physical dimensions and positions for 1, 2, 3, 10 and 11 cards. Collated batching keeps pairs together.                                                                                                                                  |
| Artwork source           | Flipping/replacing artwork left stale URLs or back previews; local and already-proxied URLs were proxied twice.                    | One `cardSource` resolver supplies current faces, assigned uploads and global backs. Stale cached URL state is removed except migration fallback. Production-build PDF/ZIP/MPC tests cover these paths.                                                                                                                                                                                        |
| Bleed and cutting guides | DPI bucket lookup used `Object.entries` on a Map; preview and PDF used different crops, guide positions and units.                 | Physical 63 × 88 mm trim geometry, explicit 3 mm MPC input bleed, and shared canvas/guide helpers. Unit tests cover trim dimensions. Browser tests sample preview pixels and embedded PDF JPEG pixels at 0, 1, 2 and 3 mm bleed.                                                                                                                                                               |
| Exact printings          | Two sets of the same card could receive identical artwork. Split-card faces were handled as DFC images.                            | API responses echo request identity, queries use exact card names, and top-level printed images take precedence. HTTP/browser tests and live Scryfall checks cover separate Sol Ring printings and Fire // Ice.                                                                                                                                                                                |
| Artwork picker           | Replacement used the old name, selecting a DFC back kept front art, language was omitted, and upload flags persisted.              | Abortable searches keyed by requested name/language; atomic card/source updates; correct face selection; old files and previews removed. Tests replace a card, select/flip a DFC, and inspect ZIP requests.                                                                                                                                                                                    |
| Persistence              | Uploaded File objects were lost after reload. Migration deleted unrelated keys; reset did not await IndexedDB deletion.            | Native structured-clone snapshots with an exact-byte ArrayBuffer fallback for WebKit contexts that reject Blob/File storage, targeted legacy migration, hydration gate and transaction completion. Reload tests retain fronts, backs, orientation and global back; reset remains empty after reload. The implementation awaits storage directly because Zustand `clearStorage()` returns void. |
| Storage failure          | A successful settings write could hide a failed deck save.                                                                         | Failure status is tracked per storage operation. A simulated quota failure remains visible while settings save successfully. Failed writes do not destroy the in-memory deck.                                                                                                                                                                                                                  |
| Deck actions             | Second-page actions assumed nine cards per sheet; deleting/duplicating left image maps inconsistent.                               | UUID identity, actual global indices, immutable store actions, full source cleanup/copy and workspace size limits. Browser tests exercise custom grids, duplicate and reset.                                                                                                                                                                                                                   |
| MPC import               | Relative image URLs were proxied twice; assigned/default backs and slot order were lost.                                           | Direct trusted Drive-ID route, ordered slots, assigned/default backs, quantity and duplicate-slot validation. Browser tests cover XML, backs, export and malformed duplicate slots.                                                                                                                                                                                                            |
| Async work               | Unbounded image work, stale preview completion, orphaned timeouts and silent export failures.                                      | Bounded preview/batch queues, source/generation checks, upstream rate limits, real abort signals, visible failures and cancel controls. Tests cover queue recovery, import cancellation and failed export feedback.                                                                                                                                                                            |
| Image service            | Arbitrary destinations, unlimited downloads, partial cache files and public destructive endpoints.                                 | HTTPS host allowlists with redirect revalidation, size/time/queue limits, atomic cache writes, in-flight deduplication, bounded retention and removal of unused endpoints. HTTP tests reject private/untrusted URLs; three concurrent live image requests succeeded with one cache file.                                                                                                       |
| UI/accessibility         | Fixed columns overflowed small screens; clickable artwork/actions lacked keyboard paths; modal focus was lost.                     | Responsive panels, native dialogs/inputs/menus, keyboard drag and explicit move actions, persistent labels, focus restoration and meaningful status. Automated accessibility scans cover light/dark empty states at 320/390/768/1440 px, plus populated preview and artwork dialog.                                                                                                            |
| Maintenance              | Dead workers and duplicated image helpers obscured the active pipeline. Unused libraries inflated installs and exposed advisories. | Removed dead workers/helpers/assets and unused dependencies; lazy export/artwork chunks; updated compatible dependencies and targeted minimatch tooling override. Clean installs and audits cover root, client and server. README now describes actual behavior and configuration.                                                                                                             |

## UI inspection

Inspected generated desktop, narrow-screen, dark-mode and artwork-dialog screenshots. Kept the paper white in both themes, consolidated print settings, added fit-to-preview zoom, and made the primary export action explicit. Notification stacks are limited to two, avoid desktop export controls, and dismiss successful/informational results after eight seconds; hover/focus pauses dismissal and errors remain dismissible manually.

Local screenshot artifacts generated by browser tests:

- `.artifacts/{chromium,webkit}/workspace-empty.png`
- `.artifacts/{chromium,webkit}/workspace-cards.png`
- `.artifacts/{chromium,webkit}/workspace-mobile.png`
- `.artifacts/{chromium,webkit}/workspace-mobile-dark.png`
- `.artifacts/{chromium,webkit}/artwork-picker.png`

The tests deliberately use controlled card artwork, so screenshots illustrate layout and interaction rather than live card selection. On phones, one card menu provides flip, upload-back and reorder actions without covering the artwork with four separate controls. Open menus are kept inside the visible preview.

## Opus implementation-review follow-ups

- **Storage recovery:** failed hydration shows the actual error, retry, a temporary workspace with saving disabled, and an explicit confirmed delete-and-restart action. Tests reproduce blocked storage and corrupt legacy JSON, then exercise editing, PDF export and recovery.
- **Artwork thumbnails:** the API returns the normal JPEG thumbnail separately from the original PNG. The picker loads lazy thumbnails directly from Scryfall; selection and export keep the original. Browser tests inspect both request paths.
- **Saving large uploads:** original files and data-URL backs are separate immutable IndexedDB records. A coalesced metadata write atomically inserts new images and deletes unused images. Tests count writes across 100 rapid changes and prove failed replacement saves retain the previous snapshot and originals. WebKit fallback buffers exist only for the active write.
- **File lifetime:** uploads are detached from disk before entering the workspace. A browser test edits the source file after upload and compares exported bytes before and after reload.
- **Grid capacity and editing:** automatic layouts refit to the maximum capacity; custom preferred rows/columns survive temporary constraints. Number fields retain draft strings and commit on blur or Enter, with Escape to cancel. Tests cover portrait/landscape round trips and editing decimals from an empty field.
- **Preview and URL cleanup:** loading status is keyed by card and side, a memoized UUID index replaces repeated per-cell searches, and MPC image routes are stored independently of the API origin.
- **Final hardening:** a temporary-session switch aborts migration before legacy cleanup; reset removes its records and file-key ranges in one transaction. Two focused race tests cover these cases. The temporary-session banner stays accurate after reset, a stale back upload reports why it was discarded, and card controls subscribe only to the settings they use.

## Verification

- Clean `npm ci` in root, client and server succeeds.
- `npm run check`: client lint, 25 client unit tests, 8 server HTTP tests, TypeScript checks and both production builds.
- Browser suite: 21 workflows on Chromium and WebKit (42 checks). Includes downloaded PDF inspection, original ZIP contents/source requests, mixed/custom backs, portrait and landscape, legacy migration, durable uploads/reset, quota failure, blocked-storage recovery, corrupt-data reset, thumbnail requests, disk-file changes, cancellation, keyboard focus and accessibility scans.
- `npm audit` in all three packages reports no vulnerabilities, including development dependencies.
- Live read-only Scryfall checks: two Sol Ring sets, exact collector number, Fire // Ice, and a double-faced lookup. Three simultaneous requests through the local Express image proxy returned HTTP 200, PNG content and equal byte counts; one atomic cache entry was produced.
- `git diff --check` passes.

## Iteration status

1. Opus 5.5 baseline critique supplied concrete PDF, persistence, artwork and UI defects. Those paths were fixed and incorporated into regression coverage.
2. Main implementation validation found and fixed async reset completion, modal focus restoration, inconsistent rounded guides and storage-error suppression.
3. Cross-engine validation reproduced WebKit Blob/File storage rejection; an exact-byte binary snapshot fallback and visible save status address it. Storage alerts now occupy layout space instead of blocking mobile navigation.
4. Opus 5.5 implementation review identified two blockers (startup lockout and full-size artwork thumbnails) plus persistence, file-lifetime, grid and input improvements. All findings were addressed, including the mobile card-control observation.
5. Opus 5.5 follow-up verdict: **locally complete**, with no material correctness, data-loss, performance or UI defect remaining. The critic read the recovery/persistence changes and related Zustand implementation, re-ran all 23 then-current client tests, and ran a scratch migration probe; it did not repeat the browser suite. Its three low-severity hardening notes were subsequently addressed and covered by the final validation above. No further critique round was needed.

## Explicit limits

Physical printer scaling, printable margins and duplex registration require a real print. Automated keyboard/axe checks do not establish full screen-reader usability, and browser viewport emulation is not a physical phone test. Live Google Drive images depend on public sharing and provider download limits; automated MPC tests use controlled responses. Production hosting, the existing Netlify/Koyeb redirect, Docker runtime, Windows PowerShell helper and sustained multi-user traffic have not been deployed or exercised here. Workspaces are local to a browser, with one active editing tab assumed; cross-tab collaborative editing is not implemented.

Earlier versions did not persist every uploaded file. Expired legacy blob URLs or files that were never saved cannot be reconstructed; those images require re-upload.

## Interface revamp (2026-11-14)

The interface was evaluated from scratch and restructured. The print pipeline, storage format and server were not changed. The design, with the full findings table, is in [docs/superpowers/specs/2026-11-14-ui-revamp-design.md](superpowers/specs/2026-11-14-ui-revamp-design.md); the build plan is in [docs/superpowers/plans/2026-11-14-ui-revamp.md](superpowers/plans/2026-11-14-ui-revamp.md).

### How it was done

Two reviewers evaluated the old interface independently (Claude, and GPT-6 Astra without sight of the first review) and agreed on the diagnosis: the layout followed the order of first use instead of what a user checks and does for most of a session. They then agreed one design. Astra's four blocking conditions were written into it: named target sets for artwork changes, undo as whole-action transactions, a saved one-sided choice taking precedence over the old collate setting, and no whole-card dragging. Opus 5.5 built it in five tasks. Each task had a separate reviewer and one fix round. Astra then reviewed the finished build, one fix wave followed, and Astra signed it off with the residual items listed under "Limits".

### Findings addressed

| Before | Now |
| --- | --- |
| Export sat below the fold at 1440×900 and at the bottom of the third tab on a phone. | Export is in the top bar at every width. It opens a dialog holding the output choices and the print instructions. |
| An unknown card name showed "Load failed · retry", which could never work, drawn over the name. The only accurate message was a toast that left after 8 seconds. | The card says "No artwork found" and offers "Find artwork". The Deck panel lists it under "needs artwork" until it is fixed. No preview is attempted and no retry is offered. |
| Loading cards read "Choose artwork" with a spinner over the name. | Loading cards show the name and "Loading artwork…", with no overlap and no reliance on motion. |
| The print sheets were the only view of the deck. | The Deck panel lists every distinct card with quantity buttons, a filter, and a menu that can do everything the card's own menu can. |
| The left column was an add-cards form for the whole session. | Adding cards fills the Deck panel only while the deck is empty; afterwards it is a dialog. Files can be dropped anywhere. |
| Two to four buttons covered every card's artwork permanently. | Controls appear when a card is hovered or focused. On touch they stay visible. |
| "100%" meant "fits the width", and a whole sheet could not be shown. | Fit page is the default. The percentage is document scale. |
| Expert bleed controls were as loud as paper size, and the print-at-100% instruction was 11 px text. | Paper, Sides and Cutting lead. Edge-repair controls are under "Advanced". The print instructions are in the export dialog at body size. |
| A checkbox in another section decided which export buttons existed. | Sides is a choice in Print setup; the export dialog offers the matching outputs. |
| The picker showed 8 of 72 printings, labelled by set code. "Apply to every" silently discarded uploads. | 21 printings are visible at 1440×900, with set names and years. A choice names its target (this copy, this row, or every card of that name) and says when uploads will be replaced. |
| Removing one card raised a browser confirm. Nothing could be undone. | Removal is immediate and undoable. Undo covers the last 20 deck changes. Confirmation remains for clearing the deck and resetting data. |
| 40 text nodes under 12 px; a typeface named but never loaded. | No text under 12 px. The system interface face is used and no font file is requested. |
| Taglines, numbered eyebrows, "1 need artwork". | Removed. Counts go through one plural helper. |

### Verification

- `npm run check`: lint, 202 client unit tests, 8 server tests, TypeScript and both builds.
- Browser suite: 196 tests, 98 each on Chromium and WebKit (132 before). Three consecutive full runs passed. The existing PDF, pixel, ZIP, saved-data and cancellation assertions were kept; tests changed only how they reach a control. A WebKit test that failed about one run in four during the build passed 15 of 15 after its cause was fixed (card controls no longer depend on a shared hover flag).
- Axe scans in light and dark at 1440, 768, 390 and 320 px for the empty deck, a populated deck, the export dialog, both picker tabs and the confirm dialog. No violations, no excluded rules.
- Measured in the running app (`.artifacts/ui-revamp/after/measure.json`): every text pair at or above 4.5:1 and every control boundary and focus ring at or above 3:1, with two noted exceptions below; Export inside the viewport without scrolling at 1440×900 and in all three phone regions; a whole sheet inside the view at Fit page for Letter portrait, Letter landscape and A1; no sideways scroll at 320 px in any region or dialog; card controls at opacity 0 at rest and 1 on hover and on keyboard focus.
- Screenshots: the old interface in `.artifacts/ui-revamp/baseline/` and the new one, in the same states, in `.artifacts/ui-revamp/after/`.

### Limits

- Not tested on a physical phone or tablet, with a screen reader, or with a real file dragged in from the desktop. Touch, drag-and-drop and announcements were checked through emulation, synthetic events and markup.
- Safe-area padding for notched phones is implemented and tested by overriding the inset values; it has not been seen on an iOS device.
- A notice shows at the bottom centre of the sheet area for 8 seconds and can cover part of a sheet, or on a phone the last item of an open row menu.
- Uploading a back to a deck row with several copies splits it into one row per copy, because each copy keeps its own uploaded file.
- Two measured contrast exceptions, both judged acceptable: control borders on the light-theme mat are 2.65:1, but the control's white fill against the mat (9.5:1) is its boundary; the temporary ring drawn after "Show on the sheet" can fall to 2.2:1 against some artwork, and it is not the focus ring.
- `Lightning Bolt (m11) 146` imports as M11 #149 without a message. That is the server's matching and predates this work.
- Deferred by agreement: selecting several cards for bulk actions, and dragging a card by its whole face.
- Smaller follow-ups recorded during review: deck rows re-render on every deck change; the storage-clearing code exists in two places; the artwork-change mutation lives in a component without unit tests; an uploaded back chosen while a copy is being added misses the new copy.
