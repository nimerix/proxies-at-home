import { useState } from "react";
import { Layers3, Plus, SlidersHorizontal, LayoutGrid } from "lucide-react";
import { PageSettingsControls } from "../components/PageSettingsControls";
import { PageView } from "../components/PageView";
import { UploadSection } from "../components/UploadSection";
import { useCardsStore, useSettingsStore } from "../store";
export default function ProxyBuilderPage() {
  const cards = useCardsStore((s) => s.cards);
  const columns = useSettingsStore((s) => s.columns),
    rows = useSettingsStore((s) => s.rows);
  const [panel, setPanel] = useState("add");
  return (
    <div className="app-shell">
      <header className="app-header">
        <a href="#" className="brand" aria-label="Proxxied home">
          <Layers3 size={27} aria-hidden="true" />
          <span>
            proxxied<span className="brand-dot">.</span>
          </span>
        </a>
        <span className="header-tagline">Your deck. Your table.</span>
        <div className="deck-summary">
          <span>
            {cards.length} {cards.length === 1 ? "card" : "cards"}
          </span>
          <span>
            {Math.ceil(cards.length / (columns * rows))}{" "}
            {Math.ceil(cards.length / (columns * rows)) === 1
              ? "sheet"
              : "sheets"}
          </span>
        </div>
      </header>
      <nav className="mobile-nav" aria-label="Workspace panels">
        {[
          { id: "add", label: "Add cards", icon: Plus },
          { id: "preview", label: "Preview", icon: LayoutGrid },
          { id: "settings", label: "Print settings", icon: SlidersHorizontal },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            aria-pressed={panel === id}
            aria-controls={`${id}-panel`}
            onClick={() => setPanel(id)}
          >
            <Icon size={16} aria-hidden="true" />
            {label}
          </button>
        ))}
      </nav>
      <main className="workspace" data-panel={panel}>
        <UploadSection />
        <PageView />
        <PageSettingsControls />
      </main>
    </div>
  );
}
