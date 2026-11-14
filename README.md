# Proxxied

A browser workspace for building Magic: The Gathering proxy sheets. Paste a decklist, choose printings, upload your own artwork, arrange the deck, and download a PDF for printing at home.

## What it does

- Imports quantities, split-card names, set codes and collector numbers, such as `2 Sol Ring (c21) 263`. Supports 11 card languages, with English fallback when a printing is unavailable.
- Offers a searchable artwork picker, set filtering, double-faced cards, and applying a printing to all matching cards.
- Accepts standard images, MPC images with **3 mm baked bleed**, and MPCFill XML/text with public Google Drive image IDs. XML slot order, assigned backs and the default cardback are preserved.
- Saves the deck, original uploaded files, assigned backs and print settings in the current browser using IndexedDB. Existing v6/v7 card workspaces and layout settings migrate in place. If storage is unavailable, you can continue in a clearly marked temporary workspace and download your work. Clearing browser data removes this local workspace; ZIP and decklist downloads provide portable originals and card lists.
- Supports drag or keyboard reordering, duplicate/remove actions, custom backs, paper presets from Letter/A4 through A1, portrait/landscape, adjustable grid, bleed and spacing. Automatic grids maximize sheet capacity; custom grid preferences survive orientation changes.
- Exports fronts, mirrored backs, or alternating front/back pages, including partially filled sheets. Larger exports can be split into files while keeping front/back pairs together.
- Uses shared canvas and guide geometry for previews and PDFs. Cards trim to **63 × 88 mm**. PDF resolution is 600, 900 or 1200 DPI; higher output DPI cannot add detail to the source artwork.
- Exports original images as ZIP and decklists as text. Long imports and exports show progress and support cancellation. Errors are visible instead of silently omitting cards.
- Adapts to narrow screens and system light/dark appearance. Native buttons, dialogs and menus provide keyboard access.

For duplex printing, use **100% / actual size**, with **long-edge flip in portrait** or **short-edge flip in landscape**. Test one sheet first: printer margins, registration and scaling vary. Bleed is extra artwork outside the 63 × 88 mm trim box.

## Run locally

Requires **Node.js 22.12 or newer** and npm.

```sh
npm ci
npm ci --prefix client
npm ci --prefix server
npm run dev
```

The client runs at `http://127.0.0.1:5173`; Vite forwards `/api` to the Express server at `http://127.0.0.1:3001`. No Scryfall API key is required. Uploaded files stay in the browser; the server fetches only Scryfall and public MPC Google Drive images.

PowerShell users can also run `./proxxied.ps1 install` and `./proxxied.ps1 dev`.

## Validate

```sh
npm run check                 # client lint, unit tests, server HTTP tests, both builds
npx playwright install chromium webkit
npm run test:e2e              # production-build browser, PDF, ZIP and accessibility tests
```

Run `npm run build --prefix client` before `test:e2e` after client changes. Browser tests run in Chromium and WebKit and use controlled Scryfall/Drive responses; they do not establish live provider availability. See [docs/REVIEW.md](docs/REVIEW.md) for review findings and validation limits.

## Configure and deploy

Client build configuration (`client/.env.local`):

| Variable        | Default | Purpose                                                                                     |
| --------------- | ------- | ------------------------------------------------------------------------------------------- |
| `VITE_API_BASE` | empty   | API origin when the client and server are hosted separately. Empty uses same-origin `/api`. |

Server configuration (`server/.env.local` or environment variables):

| Variable          | Default                                      | Purpose                                                                   |
| ----------------- | -------------------------------------------- | ------------------------------------------------------------------------- |
| `PORT`            | `3001`                                       | HTTP listen port.                                                         |
| `CORS_ORIGINS`    | Local development and `proxxied.com` origins | Comma-separated allowed browser origins when using a separate API origin. |
| `IMAGE_CACHE_DIR` | `cached-images` next to the compiled server  | Writable image cache directory.                                           |
| `LOG_LEVEL`       | `info`                                       | Pino log level.                                                           |
| `SCRYFALL_HOST`   | `https://api.scryfall.com`                   | Upstream API origin; overridden in server tests.                          |

Build with `npm run build`. Serve `client/dist` as static files and route `/api/*` to `npm start --prefix server`. The existing `client/netlify.toml` contains the project's Koyeb API redirect; update that host for a different deployment. The server container can be built from the repository root with `docker build -f server/dockerfile .`.

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
- [alex-taxiera/proxy-print](https://github.com/alex-taxiera/proxy-print) — original project inspiration.

Package manifests currently declare ISC; the repository does not include a standalone license file.
