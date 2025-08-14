# Proxxied — MTG Proxy Builder

**Proxxied** is a web-based Magic: The Gathering proxy printing tool, designed for printing at home.
It lets you easily fetch, arrange, and print high-quality pre-bleeded MTG card images on standard 8.5"×11" sheets, with full cut/bleed guides for accurate trimming.
The site is hosted at https://proxxied.com

## Features

### Card & Image Management

- **Decklist Import** — Paste a decklist (`1x Sol Ring`) and automatically fetch images from Scryfall's API.
- **Alternate Artwork Selector** — Choose from multiple art options per card.
- **Custom Image Upload** — Upload your own pre-bleeded card images (e.g., from MPCFill Google Drive packs).
- **Caching & Reuse** — Uploaded/fetched images are cached locally for faster reprocessing and export.

### Print Layout

- **True-to-Size Layout** — Cards are placed at the exact 2.5" × 3.5" size with optional bleed edge.
- **Configurable Bleed Edge** — Toggle bleed on/off, adjust width (mm), and choose black or mirrored-edge bleed.
- **Cut Guides** —
  - **Primary guides** follow your chosen guide color.
  - **Edge bleed guides** are always black for visibility.
- **Accurate Scaling** — 1200 DPI export for professional-quality prints.

### PDF Export

- **Multi-Page Support** — Automatically paginates when more than 9 cards are selected.
- **Precise Crop Marks** — 1px crop marks positioned exactly at the cut edge.
- **High-Resolution Export** — jsPDF-powered, preserving full image quality.

### Drag & Drop

- **Grid Reordering** — Rearrange cards in the 3×3 layout using drag-and-drop.
- **UUID-based Ordering** — Keeps layout stable even when cards are added or removed.

### Settings Panel

- **Page Size & Columns** — Adjust width, height, and grid columns.
- **Guide Width & Color** — Customize visual cut guides.
- **Unit Selection** — Switch between inches and millimeters.

### Theming

- **Dark & Light Mode** — Layout preview matches your system theme.
- **PDF Always White** — Exports on a white background to avoid color contamination.

---

## Tech Stack

- **Frontend:** React + TypeScript + TailwindCSS + Flowbite
- **Backend:** Node.js + Express (image fetching & caching)
- **Image Processing:** Canvas API (client-side bleed edge, scaling, guides)
- **PDF Generation:** jsPDF (custom placement & scaling logic)
- **Drag & Drop:** @dnd-kit/core

---

## Getting Started

### Prerequisites

- **Node.js** v18+
- **npm** or **yarn**
- (Optional) API access for card image sources

### Installation (For developers)

```bash
# Clone repository
git clone https://github.com/your-username/mtg-proxxied.git
cd mtg-proxxied

# Install dependencies
npm install

# Start development server
npm run dev
Backend Setup
cd server
npm install
npm run dev
The backend handles image fetching, caching, and proxying for higher-quality assets.
📄 Usage
Enter your decklist in the left panel.
Choose alternate artworks or upload custom images.
Adjust bleed edge, guide color, and page size in the Settings panel.
Drag cards to reorder in the central 3×3 grid.
Click Export PDF to download a high-quality, print-ready sheet.

License
MIT — feel free to use, modify, and contribute.

Credits
alex-taxiera/proxy-print — Original project inspiration
Scryfall API — Card image & data source
MPCFill — Community art resource
```
