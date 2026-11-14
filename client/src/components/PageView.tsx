import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { LayoutGrid, Layers3, ZoomIn, ZoomOut, Scan } from "lucide-react";
import CardCellLazy from "./CardCellLazy";
import EdgeCutLines from "./FullPageGuides";
import SortableCard from "./SortableCard";
import { useImageProcessing } from "../hooks/useImageProcessing";
import { useCardsStore, useSettingsStore } from "../store";
import { pageSlots, printLayout } from "../helpers/printLayout";
const ArtworkModal = lazy(() =>
  import("./ArtworkModal").then((module) => ({ default: module.ArtworkModal }))
);

export function PageView() {
  const s = useSettingsStore();
  const cards = useCardsStore((state) => state.cards);
  const indices = useMemo(
    () => new Map(cards.map((card, index) => [card.uuid, index])),
    [cards]
  );
  const fronts = useCardsStore((state) => state.selectedImages);
  const backs = useCardsStore((state) => state.selectedBackFaceImages);
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const layout = printLayout(s);
  const scale =
    Math.min(
      1,
      Math.max(0.1, (width - 32) / ((layout.pageWidthMm * 96) / 25.4))
    ) * s.zoom;
  const capacity = s.columns * s.rows;
  const pageCount = Math.ceil(cards.length / capacity);
  const { loadingMap, ensureProcessed, ensureBackFaceProcessed } =
    useImageProcessing({ unit: "mm", bleedEdgeWidth: s.bleedEdgeWidth });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  return (
    <section
      id="preview-panel"
      className="preview-panel"
      aria-label="Print preview"
      ref={container}
    >
      <div className="preview-toolbar">
        <div className="view-switch" aria-label="Preview side">
          <button
            aria-pressed={s.viewMode === "front"}
            onClick={() => s.setViewMode("front")}
          >
            Fronts
          </button>
          <button
            aria-pressed={s.viewMode === "back"}
            onClick={() => s.setViewMode("back")}
          >
            Backs
          </button>
        </div>
        <div className="zoom-controls">
          <button
            aria-label="Zoom out"
            disabled={s.zoom <= 0.1}
            onClick={() => s.setZoom(s.zoom - 0.1)}
          >
            <ZoomOut size={17} />
          </button>
          <span>{Math.round(s.zoom * 100)}%</span>
          <button
            aria-label="Zoom in"
            disabled={s.zoom >= 3}
            onClick={() => s.setZoom(s.zoom + 0.1)}
          >
            <ZoomIn size={17} />
          </button>
          <button
            aria-label="Fit sheets to preview"
            onClick={() => s.setZoom(1)}
          >
            <Scan size={17} />
          </button>
        </div>
      </div>
      {!cards.length ? (
        <div className="empty-workspace">
          <div className="sample-sheets" aria-hidden="true">
            <div />
            <div>
              <LayoutGrid size={72} strokeWidth={1} />
            </div>
          </div>
          <span className="eyebrow">
            A little paper. Endless possibilities.
          </span>
          <h2>
            Your next deck
            <br />
            starts here.
          </h2>
          <p>
            Paste a decklist or upload your artwork. We’ll lay out your cards,
            add cutting guides, and make a PDF ready for your printer.
          </p>
          <div className="empty-features">
            <span>
              <Layers3 size={16} />
              Choose your art
            </span>
            <span>
              <LayoutGrid size={16} />
              Print at home
            </span>
          </div>
        </div>
      ) : (
        <>
          <div className="preview-caption">
            <span>
              {s.pageSizePreset} · {s.columns} × {s.rows} layout
            </span>
            <span>
              {pageCount} {pageCount === 1 ? "sheet" : "sheets"}
            </span>
          </div>
          {s.viewMode === "back" && (
            <p className="back-hint">
              Backs are mirrored by column to align with the fronts.
            </p>
          )}
          <div className="sheet-scroller">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={({ active, over }) => {
                if (!over || active.id === over.id) return;
                const current = useCardsStore.getState().cards;
                const from = current.findIndex((c) => c.uuid === active.id),
                  to = current.findIndex((c) => c.uuid === over.id);
                if (from >= 0 && to >= 0)
                  useCardsStore
                    .getState()
                    .setCards(arrayMove(current, from, to));
              }}
            >
              <SortableContext
                items={cards.map((c) => c.uuid)}
                strategy={rectSortingStrategy}
              >
                {Array.from({ length: pageCount }, (_, pageIndex) => (
                  <div
                    className="sheet-frame"
                    key={pageIndex}
                    style={{
                      width: ((layout.pageWidthMm * 96) / 25.4) * scale,
                    }}
                  >
                    <div className="sheet-label">
                      Sheet {pageIndex + 1}
                      <span>{s.viewMode === "front" ? "Front" : "Back"}</span>
                    </div>
                    <div
                      className="proxy-page"
                      style={
                        {
                          zoom: scale,
                          width: `${layout.pageWidthMm}mm`,
                          height: `${layout.pageHeightMm}mm`,
                          "--control-zoom": 1 / scale,
                        } as CSSProperties
                      }
                    >
                      <div
                        className="card-grid"
                        style={{
                          display: "grid",
                          gridTemplateColumns: `repeat(${s.columns}, ${layout.cardWidthMm}mm)`,
                          gridTemplateRows: `repeat(${s.rows}, ${layout.cardHeightMm}mm)`,
                          gap: `${s.cardSpacingMm}mm`,
                        }}
                      >
                        {pageSlots(
                          cards.slice(
                            pageIndex * capacity,
                            (pageIndex + 1) * capacity
                          ),
                          s.columns,
                          s.rows,
                          s.viewMode === "back"
                        ).map((card, slot) =>
                          !card ? (
                            <div key={`empty-${slot}`} aria-hidden="true" />
                          ) : (
                            <CardCellLazy
                              key={`${card.uuid}:${s.viewMode}:${s.bleedEdgeWidth}:${s.useHighQualityPreviews}:${s.customCardbackUrl?.length}:${s.customCardbackHasBleed}`}
                              card={card}
                              state={
                                loadingMap[
                                  `${card.uuid}:${s.viewMode === "back"}`
                                ] ?? "idle"
                              }
                              hasImage={
                                !!(s.viewMode === "front"
                                  ? fronts[card.uuid]
                                  : backs[card.uuid])
                              }
                              ensureProcessed={
                                s.viewMode === "front"
                                  ? ensureProcessed
                                  : ensureBackFaceProcessed
                              }
                            >
                              <SortableCard
                                card={card}
                                globalIndex={indices.get(card.uuid) ?? -1}
                                imageSrc={
                                  (s.viewMode === "front"
                                    ? fronts[card.uuid]
                                    : backs[card.uuid]) || ""
                                }
                                totalCardWidth={layout.cardWidthMm}
                                totalCardHeight={layout.cardHeightMm}
                                viewMode={s.viewMode}
                                disableBackPageGuides={s.disableBackPageGuides}
                              />
                            </CardCellLazy>
                          )
                        )}
                      </div>
                      {!(s.viewMode === "back" && s.disableBackPageGuides) && (
                        <EdgeCutLines />
                      )}
                    </div>
                  </div>
                ))}
              </SortableContext>
            </DndContext>
          </div>
        </>
      )}
      <Suspense fallback={null}>
        <ArtworkModal />
      </Suspense>
    </section>
  );
}
