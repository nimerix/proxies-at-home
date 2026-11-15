import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { AlertTriangle, Minus, MoreHorizontal, Plus } from "lucide-react";
import type { DeckGroup } from "@/helpers/deckGroups";
import { makeUploadedFileToken } from "@/helpers/imageUtils";
import { canMoveGroup, moveGroup, type MoveTarget } from "@/helpers/deckGroups";
import { plural } from "@/helpers/plural";
import { copyUpload } from "@/helpers/uploads";
import {
  useArtworkModalStore,
  useCardsStore,
  usePreviewStore,
  useUiStore,
} from "@/store";
import { errorMessage, notify } from "@/store/notifications";
import { deckEdit, UNDO_NOTICE_TAG, undoFromUser } from "@/store/undo";

export type RowStatus = "missing" | "error" | null;

type CloseMenu = (focusSummary?: boolean) => void;

// Opens upward when there is no room below, staying inside the scrolling panel.
function place(details: HTMLDetailsElement) {
  const panel = details.querySelector<HTMLElement>(".action-menu-panel");
  if (!panel) return;
  delete panel.dataset.up;
  const bounds = details.closest(".side-panel")?.getBoundingClientRect() ?? {
    top: 0,
    bottom: innerHeight,
  };
  const rect = panel.getBoundingClientRect();
  const summary = details.getBoundingClientRect();
  if (
    rect.bottom > bounds.bottom - 8 &&
    summary.top - bounds.top > rect.height + 8
  )
    panel.dataset.up = "";
}

export function ActionMenu({
  label,
  children,
}: {
  label: string;
  children: (close: CloseMenu) => ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  const close: CloseMenu = (focusSummary = true) => {
    const details = ref.current;
    if (!details) return;
    details.open = false;
    if (focusSummary) details.querySelector("summary")?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        ref.current.open = false;
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);
  return (
    <details
      ref={ref}
      className="action-menu"
      name="deck-menu"
      onToggle={(e) => setOpen(e.currentTarget.open)}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        close();
      }}
    >
      <summary
        className="icon-button"
        aria-label={label}
        onClick={(e) => {
          // Open by hand so the items render and the menu is placed before the next paint.
          e.preventDefault();
          const details = e.currentTarget.parentElement as HTMLDetailsElement;
          if (details.open) {
            details.open = false;
            return;
          }
          flushSync(() => setOpen(true));
          details.open = true;
          place(details);
        }}
      >
        <MoreHorizontal size={18} aria-hidden="true" />
      </summary>
      <div className="action-menu-panel">{open && children(close)}</div>
    </details>
  );
}

const indexOf = (uuid: string) =>
  useCardsStore.getState().cards.findIndex((c) => c.uuid === uuid);

function removedNotice(message: string, entry: ReturnType<typeof deckEdit>) {
  if (!entry) return;
  notify(message, "info", {
    label: "Undo",
    tag: UNDO_NOTICE_TAG,
    run: () => undoFromUser(entry) !== null,
  });
}

// When a row leaves the list, keep focus in the panel instead of dropping it to <body>.
function focusNeighbour(row: HTMLElement | null) {
  const neighbour = (
    row?.nextElementSibling ?? row?.previousElementSibling
  )?.querySelector<HTMLElement>(".deck-row-name");
  requestAnimationFrame(() => {
    if (neighbour?.isConnected) neighbour.focus();
    else
      (
        document.getElementById("deck-filter") ??
        document.getElementById("deck-undo")
      )?.focus();
  });
}

function describe(group: DeckGroup, hasOwnBack: boolean) {
  const { card } = group;
  const parts: string[] = [];
  if (card.isUserUpload) parts.push("Your image");
  else if (card.set)
    parts.push(
      card.number
        ? `${card.set.toUpperCase()} #${card.number}`
        : card.set.toUpperCase()
    );
  const face = card.currentFaceIndex ?? 0;
  if (face > 0 && card.faces?.[face])
    parts.push(`showing ${card.faces[face].name}`);
  if (hasOwnBack) parts.push("own back");
  return parts.join(" · ");
}

export const DeckRow = memo(function DeckRow({
  group,
  status,
  hasOwnBack,
  active,
  shownCopy,
}: {
  group: DeckGroup;
  status: RowStatus;
  hasOwnBack: boolean;
  active: boolean;
  // Which copy the last "Show on the sheet" went to, or -1 when it was
  // another row's.
  shownCopy: number;
}) {
  const { card, uuids } = group;
  const name = card.name;
  const count = uuids.length;
  const deckLength = useCardsStore((s) => s.cards.length);
  const row = useRef<HTMLLIElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const canFlip = (card.faces?.length ?? 0) > 1;

  const showOnSheet = () => {
    const next = (shownCopy + 1) % count;
    const ui = useUiStore.getState();
    ui.requestFocusCard(uuids[next]);
    ui.setHighlightedCardId(uuids[next]);
    if (matchMedia("(max-width: 759px)").matches) ui.setRegion("sheets");
  };
  const openPicker = () =>
    useArtworkModalStore.getState().openModal({
      card: useCardsStore.getState().cards[indexOf(uuids[0])] ?? card,
      index: indexOf(uuids[0]),
      autoFetchPrints: true,
      scope: "row",
    });
  const addOne = () =>
    deckEdit(`add one ${name}`, () =>
      useCardsStore.getState().duplicateCardAt(indexOf(uuids[count - 1]))
    );
  const removeOne = () => {
    const last = uuids[count - 1];
    const entry = deckEdit(`remove ${name}`, () =>
      useCardsStore.getState().removeCardsByUuid([last])
    );
    if (!entry) return;
    usePreviewStore.getState().forget([last]);
    if (count === 1) {
      focusNeighbour(row.current);
      removedNotice(`Removed ${name}.`, entry);
    }
  };
  const removeAll = () => {
    const entry = deckEdit(
      count === 1 ? `remove ${name}` : `remove ${count} copies of ${name}`,
      () => useCardsStore.getState().removeCardsByUuid(uuids)
    );
    if (!entry) return;
    usePreviewStore.getState().forget(uuids);
    focusNeighbour(row.current);
    removedNotice(
      count === 1 ? `Removed ${name}.` : `Removed ${count} copies of ${name}.`,
      entry
    );
  };
  const flip = () => {
    const index = (card.currentFaceIndex ?? 0) === 0 ? 1 : 0;
    const face = card.faces?.[index];
    if (!face) return;
    deckEdit(`flip ${name}`, () => {
      const state = useCardsStore.getState();
      for (const uuid of uuids) {
        state.updateCard(indexOf(uuid), { currentFaceIndex: index });
        state.appendOriginalSelectedImages({ [uuid]: face.imageUrl });
        state.clearSelectedImage(uuid);
        state.clearSelectedBackFaceImage(uuid);
      }
    });
  };
  const move = (to: MoveTarget) => {
    const state = useCardsStore.getState();
    deckEdit(`move ${name}`, () =>
      state.setCards(moveGroup(state.cards, group, to))
    );
    // React re-inserts the moved row, which drops focus.
    requestAnimationFrame(() =>
      row.current?.querySelector<HTMLElement>(".action-menu summary")?.focus()
    );
  };
  const uploadBack = async (file: File) => {
    if (
      !/^image\/(png|jpeg|webp)$/.test(file.type) ||
      file.size > 30 * 1024 * 1024
    ) {
      notify("Choose a PNG, JPEG or WebP back image up to 30 MB.", "error");
      return;
    }
    const before = uuids.map(
      (uuid) => useCardsStore.getState().cards[indexOf(uuid)]
    );
    try {
      const copies = await Promise.all(uuids.map(() => copyUpload(file)));
      const state = useCardsStore.getState();
      if (uuids.some((uuid, i) => state.cards[indexOf(uuid)] !== before[i])) {
        notify(
          "Back image not added: the card changed while the file was loading. Choose the image again."
        );
        return;
      }
      deckEdit(`add back for ${name}`, () => {
        uuids.forEach((uuid, i) => {
          state.appendUploadedBackFiles({ [uuid]: copies[i] });
          state.appendOriginalSelectedBackImages({
            [uuid]: makeUploadedFileToken(uuid),
          });
          state.clearSelectedBackFaceImage(uuid);
          state.updateCard(indexOf(uuid), {
            hasBackImage: true,
            backHasBakedBleed: false,
          });
        });
      });
      notify(
        "Back image added. Upload a standard image without baked bleed.",
        "success"
      );
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  };

  const copies = count > 1 ? plural(count, "copy", "copies") : null;
  const moves: [MoveTarget, string][] = copies
    ? [
        ["start", `Move ${copies} to start`],
        ["earlier", `Move ${copies} earlier`],
        ["later", `Move ${copies} later`],
        ["end", `Move ${copies} to end`],
      ]
    : [
        ["start", "Move to start"],
        ["earlier", "Move earlier"],
        ["later", "Move later"],
        ["end", "Move to end"],
      ];
  const meta = describe(group, hasOwnBack);
  const showCopy = shownCopy >= 0 && count > 1;
  return (
    <li
      ref={row}
      className="deck-row"
      data-row-id={uuids[0]}
      data-status={status ?? undefined}
      data-active={active || undefined}
    >
      <span className="deck-qty">{count}</span>
      <div className="deck-row-main">
        <button
          className="deck-row-name"
          aria-label={`Show ${name} on the sheet`}
          title={name}
          onClick={showOnSheet}
        >
          <span>{name}</span>
        </button>
        {(meta || showCopy) && (
          <p className="deck-row-meta">
            {meta && <span>{meta}</span>}
            {showCopy && (
              <span className="deck-row-copy" aria-live="polite">
                copy {shownCopy + 1} of {count}
              </span>
            )}
          </p>
        )}
        {status && (
          <div className="deck-row-status">
            <p>
              <AlertTriangle size={14} aria-hidden="true" />
              {status === "missing"
                ? "No artwork found"
                : "Couldn't load this image"}
            </p>
            {status === "missing" && (
              <button
                className="text-button"
                aria-label={`Find artwork for ${name}`}
                onClick={(e) => {
                  e.currentTarget.focus();
                  openPicker();
                }}
              >
                Find artwork
              </button>
            )}
          </div>
        )}
      </div>
      <div className="deck-row-actions">
        <button
          className="icon-button"
          aria-label={`Remove one ${name}`}
          onClick={removeOne}
        >
          <Minus size={16} aria-hidden="true" />
        </button>
        <button
          className="icon-button"
          aria-label={`Add one ${name}`}
          onClick={addOne}
        >
          <Plus size={16} aria-hidden="true" />
        </button>
        <ActionMenu label={`More actions for ${name}`}>
          {(close) => (
            <>
              <button
                onClick={() => {
                  close();
                  openPicker();
                }}
              >
                Change artwork
              </button>
              {canFlip && (
                <button
                  onClick={() => {
                    close();
                    flip();
                  }}
                >
                  {copies ? `Flip all ${copies}` : "Flip card"}
                </button>
              )}
              {card.isUserUpload && (
                <button
                  onClick={() => {
                    close();
                    fileInput.current?.click();
                  }}
                >
                  {copies
                    ? `Upload back image for ${copies}`
                    : "Upload back image"}
                </button>
              )}
              {moves.map(([to, label]) => (
                <button
                  key={to}
                  disabled={!canMoveGroup(group, deckLength, to)}
                  onClick={() => {
                    close();
                    move(to);
                  }}
                >
                  {label}
                </button>
              ))}
              <button
                className="danger"
                onClick={() => {
                  close(false);
                  removeAll();
                }}
              >
                {copies ? `Remove all ${copies}` : "Remove card"}
              </button>
            </>
          )}
        </ActionMenu>
      </div>
      {card.isUserUpload && (
        <input
          ref={fileInput}
          type="file"
          className="sr-only"
          tabIndex={-1}
          aria-label={`Back image for every copy of ${name}`}
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void uploadBack(file);
          }}
        />
      )}
    </li>
  );
});
