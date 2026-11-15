# Oops, All Proxies

A browser workspace for building Magic: The Gathering proxy sheets. Paste a decklist, choose printings, upload your own artwork, arrange the deck, and download a PDF for printing at home.

Use it at [www.oopsallproxies.com](https://www.oopsallproxies.com).

The workspace has three parts. **Deck** lists the cards with their quantities. The **sheet** in the middle shows each page as it will print. **Print setup** holds paper, sides, cutting and card-back choices. **Export** is in the top bar at every screen size.

## What it does

- Imports quantities, split-card names, set codes and collector numbers, such as `2 Sol Ring (c21) 263`. Supports 11 card languages, with English fallback when a printing is unavailable.
- Lists the deck with one row per distinct card. Each row has quantity buttons and a menu for changing artwork, flipping, moving and removing, so nothing depends on finding a card on the sheet. A card the search could not match stays listed under "needs artwork" until it is fixed. The filter narrows the list by name.
- Undoes deck changes with the Undo button or Ctrl/Cmd+Z: adding, removing, reordering, quantity, artwork, flips, uploaded backs and per-card bleed, up to the last 20, until the page is reloaded.
- Offers a searchable artwork picker that shows printings with their set names and years, and a set filter. A choice applies to one copy, to the copies in its deck row, or to every card of that name, and says how many cards change and whether uploaded images will be replaced. Replacing a card with a different one is a separate, named action.
- Accepts standard images, MPC images with **3 mm baked bleed**, and MPCFill XML/text with public Google Drive image IDs. XML slot order, assigned backs and the default cardback are preserved. Files can also be dropped anywhere on the window, onto one of two targets: trimmed card images, or images with 3 mm bleed. An upload filed under the wrong kind can be corrected afterwards in the picker's **Bleed for this card** tab.
- Saves the deck, original uploaded files, assigned backs and print settings in the current browser using IndexedDB. Existing v6/v7 card workspaces and layout settings migrate in place. If storage is unavailable, you can continue in a clearly marked temporary workspace and download your work. Clearing browser data removes this local workspace; ZIP and decklist downloads provide portable originals and card lists.
- Supports drag or keyboard reordering, duplicate/remove actions, custom backs, paper presets from Letter/A4 through A1, portrait/landscape, adjustable grid, bleed and spacing. Automatic grids maximize sheet capacity; custom grid preferences survive orientation changes.
- Shows a whole sheet by default (**Fit page**), with **Fit width** and fixed zoom levels. The percentage is the scale of the document, where 100% is 96 CSS pixels per inch; it is not a measurement of your monitor. The grid behind the paper is 10 mm of the document at the current zoom.
- Exports from one dialog. With **One-sided** chosen in Print setup it exports fronts. With **Two-sided** it exports either one file with fronts and backs alternating, for printers that duplex automatically, or separate fronts and backs files for flipping the stack by hand. Partially filled sheets are included. Larger exports can be split into files while keeping front/back pairs together. The dialog repeats the print instructions below.
- Uses shared canvas and guide geometry for previews and PDFs. Cards trim to **63 × 88 mm**. PDF resolution is 600, 900 or 1200 DPI; higher output DPI cannot add detail to the source artwork.
- Exports original images as ZIP and decklists as text. Long imports and exports show progress and support cancellation. Errors are visible instead of silently omitting cards.
- Adapts to screen width: three columns on a wide screen, one side panel beside the sheet on a medium one, and one region at a time with a bottom bar on a phone. Follows the system light or dark appearance. Native buttons, dialogs and menus provide keyboard access.

For duplex printing, use **100% / actual size**, with **long-edge flip in portrait** or **short-edge flip in landscape**. Test one sheet first: printer margins, registration and scaling vary. Bleed is extra artwork outside the 63 × 88 mm trim box.

Under **Print setup → Advanced: artwork edges**, scanned cards use a **2.5 mm corner radius** and remove
**0.25 mm** of the outer scan rim by default. The excluded perimeter is rebuilt
from nearby clean artwork before reflection into the bleed. This keeps each
corner continuous with its own edges and avoids copying rounded scan cutouts,
transparent fringes, or shadows within the selected margin. The remaining
artwork keeps its position; the card is not enlarged to hide its edges.

**Auto** border bleed extends black border sections as black, including partial
borders on extended-art cards, and fully white borders as white. A short 0.2 mm
transition matches the scan's aged border tone at the cut. Fine monochrome line
art stays artwork. Choose **Mirror all artwork** if Auto mistakes dark artwork
for a border. Border detection changes only generated bleed, not the card face.

Use upright images already cropped to the card, such as Scryfall scans. This is
not a tool for locating or straightening cards in photographs. Increase **Shadow
removal** up to 1 mm if a rim remains, or choose **Square artwork** to preserve
the image's rectangular edges. If an opaque image has a larger rounded cutout,
set **Image corner radius** to 3.2 mm (up to 3.5 mm); the physical cut radius
stays 2.5 mm. Uniform white/black corner ink is preserved by default because it
cannot reliably be distinguished from an identically colored scanner bed.
These settings are defaults for regular fronts and backs, including zero-bleed
output. The **Bleed for this card** tab of each card's artwork picker has overrides
with a live front/back preview and a summary of detected edge treatments for mixed decks. Preview and PDF
repair run in a cancellable worker where supported, with a browser fallback.
When at least two matching borders support shadows on the remaining edges, the preview
suggests a stronger removal margin; you choose whether to apply it. A failed
preview shows an error and a retry action.
MPC images bypass scan cleanup, retain their supplied 3 mm of bleed, and
generate only the extra width when more is requested.
Missing corner artwork is reconstructed, so reflected details may repeat; it
cannot recover artwork absent from the scan. Original-image ZIPs stay unchanged.

## Run locally

Requires **Node.js 22.12 or newer** and npm.

```sh
npm ci
npm ci --prefix client
npm ci --prefix server
npm run dev
```

The client runs at `http://127.0.0.1:5173`; Vite forwards `/api` to the Express server at `http://127.0.0.1:3001`. No Scryfall API key is required. Uploaded files stay in the browser; the server fetches only Scryfall and public MPC Google Drive images.

PowerShell users can also run `./oops-all-proxies.ps1 install` and `./oops-all-proxies.ps1 dev`.

## Validate

```sh
npm run check                 # client lint, unit tests, server HTTP tests, both builds
npx playwright install chromium webkit
npm run test:e2e              # production-build browser, PDF, ZIP and accessibility tests
```

Run `npm run build --prefix client` before `test:e2e` after client changes. Browser tests run in Chromium and WebKit and use controlled Scryfall/Drive responses; they do not establish live provider availability. See [docs/REVIEW.md](docs/REVIEW.md) for review findings and validation limits.

Bleed-specific fixtures, pixel comparisons, performance measurements and review
iterations are recorded in [docs/BLEED_REVIEW.md](docs/BLEED_REVIEW.md). Firefox
can be included with `TEST_FIREFOX=1 npm run test:e2e` after installing its
Playwright browser; its browser process could not start in the current local
environment, so it is not counted as verified.

## Configure and deploy

Client build configuration (`client/.env.local`):

| Variable        | Default | Purpose                                                                                     |
| --------------- | ------- | ------------------------------------------------------------------------------------------- |
| `VITE_API_BASE` | empty   | API origin when the client and server are hosted separately. Empty uses same-origin `/api`. |

Server configuration (`server/.env.local` or environment variables):

| Variable          | Default                                            | Purpose                                                                   |
| ----------------- | -------------------------------------------------- | ------------------------------------------------------------------------- |
| `PORT`            | `3001`                                             | HTTP listen port.                                                         |
| `CORS_ORIGINS`    | Local development and `oopsallproxies.com` origins | Comma-separated allowed browser origins when using a separate API origin. |
| `IMAGE_CACHE_DIR` | `cached-images` next to the compiled server        | Writable image cache directory.                                           |
| `LOG_LEVEL`       | `info`                                             | Pino log level.                                                           |
| `SCRYFALL_HOST`   | `https://api.scryfall.com`                         | Upstream API origin; overridden in server tests.                          |

Build with `npm run build`. Serve `client/dist` as static files and route `/api/*` to `npm start --prefix server`. The server container can be built from the repository root with `docker build -f server/dockerfile .`.

The server limits API batches and concurrent upstream work, enforces request/download timeouts and image size limits, validates image hosts and every redirect, writes cache entries atomically, and prunes the cache to a seven-day/512 MB retention policy. It has no public upload or cache-deletion endpoint. A deployment should provide a writable cache directory and its usual edge traffic controls.

## Architecture

- React, TypeScript, Zustand, Tailwind CSS and dnd-kit in `client/`.
- IndexedDB storage keeps originals in separate immutable records, coalesces rapid edits, falls back to byte snapshots when a browser rejects Blob storage, and avoids saving generated preview images. Uploads are copied into memory so later changes to the source files cannot break them.
- Shared `printLayout`, `printGuides`, `cardSources` and `canvasProcessing` helpers define printed output.
- PDF generation (`pdf-lib`), ZIP generation (`JSZip`) and the artwork picker load on demand.
- Express, Axios and Bottleneck in `server/` handle card lookups and bounded image caching.

## Credits

- [Scryfall](https://scryfall.com/docs/api) — card images and metadata.
- [MPCFill](https://mpcfill.com/) — community artwork workflow.
- [acoreyj/proxies-at-home](https://github.com/acoreyj/proxies-at-home) — the project this is based on, as of commit [`b465915`](https://github.com/acoreyj/proxies-at-home/commit/b465915395e401bf29169b01d5dd2166a22a8c0e).
- [alex-taxiera/proxy-print](https://github.com/alex-taxiera/proxy-print) — original project inspiration.

## License

MIT © 2025–2026 Michael Pearce. See [LICENSE](LICENSE).

Oops, All Proxies is based on [proxies-at-home](https://github.com/acoreyj/proxies-at-home) by acoreyj at commit [`b465915`](https://github.com/acoreyj/proxies-at-home/commit/b465915395e401bf29169b01d5dd2166a22a8c0e). Code derived from it keeps its upstream ISC notice; see [NOTICE](NOTICE).
