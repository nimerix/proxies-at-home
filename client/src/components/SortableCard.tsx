import { memo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVertical,
  MoreHorizontal,
  RotateCw,
  ImagePlus,
} from "lucide-react";
import {
  useArtworkModalStore,
  useSettingsStore,
  useCardsStore,
} from "../store";
import { makeUploadedFileToken } from "../helpers/ImageHelper";
import { errorMessage, notify } from "../store/notifications";
import { copyUpload } from "../helpers/uploads";
import { cornerGuideLines } from "../helpers/printGuides";
import { GuideOverlay } from "./GuideOverlay";
import type { CardOption } from "../types/Card";

type Props = {
  card: CardOption;
  globalIndex: number;
  imageSrc: string;
  totalCardWidth: number;
  totalCardHeight: number;
  viewMode: "front" | "back";
  disableBackPageGuides: boolean;
};
const SortableCard = memo(function SortableCard({
  card,
  globalIndex,
  imageSrc,
  totalCardWidth,
  totalCardHeight,
  viewMode,
  disableBackPageGuides,
}: Props) {
  const {
    useCornerGuides,
    guideWidth,
    guideColor,
    roundedCornerGuides,
    cornerGuideOffsetMm,
    bleedEdgeWidth,
  } = useSettingsStore(
    useShallow((s) => ({
      useCornerGuides: s.useCornerGuides,
      guideWidth: s.guideWidth,
      guideColor: s.guideColor,
      roundedCornerGuides: s.roundedCornerGuides,
      cornerGuideOffsetMm: s.cornerGuideOffsetMm,
      bleedEdgeWidth: s.bleedEdgeWidth,
    }))
  );
  const shouldShowGuides =
    useCornerGuides && !(viewMode === "back" && disableBackPageGuides);
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
  } = useSortable({ id: card.uuid });
  const menu = useRef<HTMLDetailsElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const currentIndex = () =>
    useCardsStore.getState().cards.findIndex((c) => c.uuid === card.uuid);
  const flip = () => {
    const index = (card.currentFaceIndex ?? 0) === 0 ? 1 : 0;
    const state = useCardsStore.getState();
    const face = card.faces?.[index];
    if (!face) return;
    state.updateCard(currentIndex(), { currentFaceIndex: index });
    state.appendOriginalSelectedImages({ [card.uuid]: face.imageUrl });
    state.clearSelectedImage(card.uuid);
    state.clearSelectedBackFaceImage(card.uuid);
  };
  const move = (direction: number) => {
    const state = useCardsStore.getState();
    const from = currentIndex();
    const to = from + direction;
    if (from < 0 || to < 0 || to >= state.cards.length) return;
    const cards = [...state.cards];
    const [selected] = cards.splice(from, 1);
    cards.splice(to, 0, selected);
    if (menu.current) menu.current.open = false;
    state.setCards(cards);
    requestAnimationFrame(() =>
      menu.current?.querySelector("summary")?.focus()
    );
  };
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    width: `${totalCardWidth}mm`,
    height: `${totalCardHeight}mm`,
  };
  return (
    <div ref={setNodeRef} className="sortable-card" style={style}>
      <button
        className="card-art"
        aria-label={`${card.name}, change artwork`}
        onContextMenu={(e) => {
          e.preventDefault();
          if (menu.current) menu.current.open = true;
        }}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey)
            useCardsStore.getState().duplicateCardAt(currentIndex());
          else
            useArtworkModalStore.getState().openModal({
              card,
              index: currentIndex(),
              autoFetchPrints: true,
            });
        }}
      >
        {imageSrc ? (
          <img src={imageSrc} alt={card.name} draggable={false} />
        ) : (
          <span className="missing-art">
            <strong>{card.name}</strong>
            <span>Choose artwork</span>
          </span>
        )}
      </button>
      <button
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        className="card-control drag-handle"
        aria-label={`Reorder ${card.name}`}
        title="Drag to reorder, or press Space and use arrow keys"
      >
        <GripVertical size={17} />
      </button>
      {(card.faces?.length ?? 0) > 1 && (
        <button
          className="card-control flip-card"
          aria-label={`Flip ${card.name}`}
          onClick={flip}
        >
          <RotateCw size={16} />
        </button>
      )}
      <details
        ref={menu}
        className="card-menu"
        name="card-actions"
        onToggle={(e) => {
          const details = e.currentTarget;
          if (!details.open) return;
          const panel = details.querySelector("div");
          const scroller = details.closest(".sheet-scroller");
          if (!panel || !scroller) return;
          const bounds = scroller.getBoundingClientRect();
          const left = Math.max(8, bounds.left + 8);
          const right = Math.min(innerWidth - 8, bounds.right - 8);
          const top = Math.max(8, bounds.top + 8);
          const bottom = Math.min(innerHeight - 8, bounds.bottom - 8);
          panel.style.transform = "";
          panel.style.maxHeight = `${Math.max(32, bottom - top)}px`;
          const rect = panel.getBoundingClientRect();
          const x = Math.max(left - rect.left, Math.min(0, right - rect.right));
          const y = Math.max(top - rect.top, Math.min(0, bottom - rect.bottom));
          panel.style.transform = `translate(${x}px, ${y}px)`;
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            if (menu.current) {
              menu.current.open = false;
              menu.current.querySelector("summary")?.focus();
            }
          }
        }}
      >
        <summary aria-label={`Actions for ${card.name}`}>
          <MoreHorizontal size={18} />
        </summary>
        <div>
          <strong>{card.name}</strong>
          {(card.faces?.length ?? 0) > 1 && (
            <button
              onClick={() => {
                flip();
                if (menu.current) menu.current.open = false;
              }}
            >
              Flip card
            </button>
          )}
          {card.isUserUpload && (
            <button
              onClick={() => {
                fileInput.current?.click();
                if (menu.current) menu.current.open = false;
              }}
            >
              Upload back image
            </button>
          )}
          <button
            onClick={() => {
              useCardsStore.getState().duplicateCardAt(currentIndex());
              if (menu.current) menu.current.open = false;
            }}
          >
            Duplicate
          </button>
          <button disabled={globalIndex === 0} onClick={() => move(-1)}>
            Move earlier
          </button>
          <button
            disabled={globalIndex === useCardsStore.getState().cards.length - 1}
            onClick={() => move(1)}
          >
            Move later
          </button>
          <button
            className="danger"
            onClick={() => {
              if (window.confirm(`Remove “${card.name}” from the deck?`))
                useCardsStore.getState().removeCardAt(currentIndex());
            }}
          >
            Remove card
          </button>
        </div>
      </details>
      {card.isUserUpload && (
        <>
          <button
            className="card-control back-upload"
            aria-label={`Upload back for ${card.name}`}
            onClick={() => fileInput.current?.click()}
          >
            <ImagePlus size={16} />
          </button>
          <input
            ref={fileInput}
            type="file"
            className="sr-only"
            tabIndex={-1}
            aria-label={`Back image for ${card.name}`}
            accept="image/png,image/jpeg,image/webp"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (
                !/^image\/(png|jpeg|webp)$/.test(file.type) ||
                file.size > 30 * 1024 * 1024
              ) {
                notify(
                  "Choose a PNG, JPEG or WebP back image up to 30 MB.",
                  "error"
                );
                return;
              }
              try {
                const copied = await copyUpload(file);
                const state = useCardsStore.getState();
                if (state.cards.find((c) => c.uuid === card.uuid) !== card) {
                  notify(
                    "Back image not added: the card changed while the file was loading. Choose the image again."
                  );
                  return;
                }
                state.appendUploadedBackFiles({ [card.uuid]: copied });
                state.appendOriginalSelectedBackImages({
                  [card.uuid]: makeUploadedFileToken(card.uuid),
                });
                state.clearSelectedBackFaceImage(card.uuid);
                state.updateCard(currentIndex(), {
                  hasBackImage: true,
                  backHasBakedBleed: false,
                });
                notify(
                  "Back image added. Upload a standard image without baked bleed.",
                  "success"
                );
              } catch (error) {
                notify(errorMessage(error), "error");
              }
            }}
          />
        </>
      )}
      {shouldShowGuides && (
        <GuideOverlay
          lines={cornerGuideLines(
            bleedEdgeWidth,
            roundedCornerGuides,
            cornerGuideOffsetMm
          )}
          width={totalCardWidth}
          height={totalCardHeight}
          color={guideColor}
          strokeWidth={(guideWidth * 25.4) / 96}
        />
      )}
    </div>
  );
});
export default SortableCard;
