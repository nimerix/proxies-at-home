import {
  lazy,
  Suspense,
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { MatToolbar } from "./mat/MatToolbar";
import type { RetryPreview } from "./SheetGrid";
import {
  scrollBehavior,
  useCurrentSheet,
  useFocusRequest,
  useScrollerSize,
  useSheetLabelHeight,
} from "../hooks/useSheetView";
import { useCardsStore, useSettingsStore, useUiStore } from "../store";
import { printLayout } from "../helpers/printLayout";
import { cardSource } from "../helpers/cardSources";
import { needsArtwork } from "../helpers/deckGroups";
import { mmToPx, sheetScale } from "../helpers/sheetScale";
import { loadSheetGrid } from "../helpers/sheetGridLoader";
const ArtworkModal = lazy(() =>
  import("./ArtworkModal").then((module) => ({ default: module.ArtworkModal }))
);
const SheetGrid = lazy(loadSheetGrid);

const COMPACT_CARD_PX = 96;

export function PageView() {
  const s = useSettingsStore();
  const cards = useCardsStore((state) => state.cards);
  const indices = useMemo(
    () => new Map(cards.map((card, index) => [card.uuid, index])),
    [cards]
  );
  const images = useCardsStore(
    useShallow((state) => ({
      originalSelectedImages: state.originalSelectedImages,
      originalSelectedBackImages: state.originalSelectedBackImages,
      uploadedFiles: state.uploadedFiles,
      uploadedBackFiles: state.uploadedBackFiles,
    }))
  );
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const size = useScrollerSize(scroller);
  const layout = printLayout(s);
  const capacity = s.columns * s.rows;
  const pageCount = Math.ceil(cards.length / capacity);
  // Sheets render once their chunk loads; DOM measurements wait for them.
  const retry = useRef<RetryPreview | null>(null);
  const [gridReady, setGridReady] = useState(false);
  const onGridReady = useCallback((value: RetryPreview | null) => {
    retry.current = value;
    setGridReady(!!value);
  }, []);
  const shownSheets = gridReady ? pageCount : 0;
  const labelHeight = useSheetLabelHeight(scroller, shownSheets);
  const scale = sheetScale({
    mode: cards.length ? s.zoomMode : "page",
    zoom: s.zoom,
    containerWidth: size.width,
    containerHeight: size.height,
    pageWidthPx: mmToPx(layout.pageWidthMm),
    pageHeightPx: mmToPx(layout.pageHeightMm),
    labelHeight,
  });
  const back = s.viewMode === "back";
  useCurrentSheet(scroller, shownSheets);
  const located = useFocusRequest(scroller, scale, gridReady);
  const hasSource = (card: (typeof cards)[number]) =>
    back
      ? !!cardSource(
          card,
          images,
          true,
          s.customCardbackUrl,
          s.customCardbackHasBleed
        ).source
      : !needsArtwork(card, images);
  const showSheet = useCallback(
    (index: number) => {
      const frames = scroller?.querySelectorAll(".sheet-frame");
      frames?.[index]?.scrollIntoView({
        block: "start",
        behavior: scrollBehavior(),
      });
    },
    [scroller]
  );
  const pageStyle = {
    zoom: scale,
    width: `${layout.pageWidthMm}mm`,
    height: `${layout.pageHeightMm}mm`,
    "--control-zoom": 1 / scale,
  } as CSSProperties;
  const frameWidth = mmToPx(layout.pageWidthMm) * scale;
  return (
    <section
      id="preview-panel"
      className="preview-panel"
      aria-label="Print preview"
    >
      {cards.length > 0 && (
        <MatToolbar
          scale={scale}
          sheetCount={pageCount}
          onShowSheet={showSheet}
        />
      )}
      {cards.length > 0 && back && (
        <p className="back-hint">
          Backs are mirrored by column to align with the fronts.
        </p>
      )}
      <div
        className="sheet-scroller"
        ref={setScroller}
        style={{ "--sheet-scale": scale } as CSSProperties}
        /* A card can miss its own pointer leave; this clears what it left. */
        onPointerLeave={() => {
          const ui = useUiStore.getState();
          const id = ui.highlightedCardId;
          if (!id || id === located) return;
          const focused = document.activeElement
            ?.closest("[data-card-id]")
            ?.getAttribute("data-card-id");
          if (focused !== id) ui.setHighlightedCardId(null);
        }}
        data-compact={
          mmToPx(layout.cardWidthMm) * scale < COMPACT_CARD_PX || undefined
        }
      >
        {!cards.length ? (
          <div className="sheet-frame" style={{ width: frameWidth }}>
            <div className="proxy-page empty-sheet" style={pageStyle}>
              <div className="empty-sheet-message">
                <h2>No cards yet</h2>
                <p>
                  Paste a decklist in the Deck panel, or drop card images
                  anywhere.
                </p>
                <button
                  className="empty-sheet-add"
                  onClick={() => useUiStore.getState().setRegion("deck")}
                >
                  Add cards
                </button>
              </div>
            </div>
          </div>
        ) : (
          <Suspense fallback={null}>
            <SheetGrid
              pageCount={pageCount}
              layout={layout}
              pageStyle={pageStyle}
              frameWidth={frameWidth}
              located={located}
              indices={indices}
              hasSource={hasSource}
              onReady={onGridReady}
            />
          </Suspense>
        )}
      </div>
      <Suspense fallback={null}>
        <ArtworkModal onRetry={(card, back) => retry.current?.(card, back)} />
      </Suspense>
    </section>
  );
}
