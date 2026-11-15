import { Download, Layers3 } from "lucide-react";
import { plural } from "@/helpers/plural";
import { useCardsStore, useSettingsStore, useUiStore } from "@/store";
import { SaveStatus } from "./SaveStatus";

export function TopBar() {
  const count = useCardsStore((s) => s.cards.length);
  const perSheet = useSettingsStore((s) => s.columns * s.rows);
  const setExportOpen = useUiStore((s) => s.setExportOpen);
  const sheets = Math.ceil(count / perSheet);
  return (
    <header className="top-bar">
      <a href="#" className="brand" aria-label="Oops, All Proxies home">
        <Layers3 size={22} aria-hidden="true" />
        <span className="brand-name">
          Oops<span className="brand-accent">,</span> All Proxies
        </span>
      </a>
      <p className="deck-summary">
        {plural(count, "card", "cards") +
          ", " +
          plural(sheets, "sheet", "sheets")}
      </p>
      <SaveStatus />
      <button
        className="primary-button export-button"
        disabled={!count}
        onClick={(e) => {
          // Safari does not focus buttons on click; the dialog returns focus here.
          e.currentTarget.focus();
          setExportOpen(true);
        }}
      >
        <Download size={17} aria-hidden="true" />
        Export
      </button>
    </header>
  );
}
