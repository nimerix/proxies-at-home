import { useEffect, useMemo, useRef } from "react";
import { Plus, Undo2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { buildDecklist, downloadDecklist } from "@/helpers/DecklistHelper";
import { groupDeck, needsArtwork } from "@/helpers/deckGroups";
import { plural } from "@/helpers/plural";
import {
  useCardsStore,
  useLoadingStore,
  usePreviewStore,
  useUiStore,
  useUndoStore,
} from "@/store";
import { confirmAction } from "@/store/confirm";
import { notify } from "@/store/notifications";
import { deckEdit, UNDO_NOTICE_TAG, undoFromUser } from "@/store/undo";
import { AddCardsForm } from "./AddCardsForm";
import { ActionMenu, DeckRow, type RowStatus } from "./DeckRow";

const focusLater = (id: string) =>
  requestAnimationFrame(() => document.getElementById(id)?.focus());

export function DeckPanel() {
  const empty = useCardsStore((s) => s.cards.length === 0);
  const depth = useUndoStore((s) => s.past.length);
  const showHead = !empty || depth > 0;
  const previous = useRef({ empty, depth });
  useEffect(() => {
    const was = previous.current;
    previous.current = { empty, depth };
    // An undo that refills an empty deck replaces the form the user was in.
    if (!was.empty || empty || depth >= was.depth) return;
    const undo = document.getElementById("deck-undo") as HTMLButtonElement;
    const active = document.activeElement;
    if (active && active !== document.body && active !== undo) return;
    if (active === undo && !undo.disabled) return;
    (undo.disabled ? document.getElementById("deck-add") : undo)?.focus();
  }, [empty, depth]);

  return (
    <aside
      className="side-panel deck-panel"
      data-panel="deck"
      aria-labelledby={showHead ? "deck-heading" : "add-heading"}
      id="deck-panel"
    >
      {showHead && <DeckHead empty={empty} />}
      {empty ? (
        <>
          {showHead ? (
            <h3 id="add-heading" className="deck-subtitle">
              Add cards
            </h3>
          ) : (
            <h2 id="add-heading" className="panel-title">
              Add cards
            </h2>
          )}
          <AddCardsForm onAdded={() => focusLater("deck-heading")} />
        </>
      ) : (
        <DeckList />
      )}
    </aside>
  );
}

// Rendered in the same place for an empty and a filled deck, so the Undo
// button keeps its DOM node, and focus, when an undo refills the deck.
function DeckHead({ empty }: { empty: boolean }) {
  const busy = useLoadingStore((s) => !!s.loadingTask);
  const lastEdit = useUndoStore((s) => s.past.at(-1));

  const undo = () => {
    const label = undoFromUser();
    if (label) notify(`Undid: ${label}.`);
  };
  const clearDeck = async () => {
    const count = useCardsStore.getState().cards.length;
    const confirmed = await confirmAction({
      title: `Clear all ${plural(count, "card", "cards")}?`,
      body: "This removes every card and uploaded image from the workspace. Print settings are kept. You can undo this until you reload the page.",
      confirmLabel: "Clear deck",
      danger: true,
      fallbackFocus: () => document.getElementById("deck-heading"),
    });
    if (!confirmed) return;
    const entry = deckEdit("clear deck", () =>
      useCardsStore.getState().clearAll()
    );
    if (!entry) return;
    usePreviewStore.getState().clear();
    notify("Deck cleared. Your print settings are unchanged.", "info", {
      label: "Undo",
      tag: UNDO_NOTICE_TAG,
      run: () => undoFromUser(entry) !== null,
    });
    focusLater("deck-undo");
  };
  const decklist = () =>
    buildDecklist(useCardsStore.getState().cards, {
      style: "withSetNum",
      sort: "none",
    });

  return (
    <div className="deck-head">
      <h2 id="deck-heading" className="panel-title" tabIndex={-1}>
        Deck
      </h2>
      {!empty && (
        <button
          id="deck-add"
          className="secondary-button deck-tool"
          disabled={busy}
          onClick={(e) => {
            // Safari does not focus buttons on click; the dialog returns focus here.
            e.currentTarget.focus();
            useUiStore.getState().setAddCardsOpen(true);
          }}
        >
          <Plus size={16} aria-hidden="true" />
          Add cards
        </button>
      )}
      <button
        id="deck-undo"
        className="text-button deck-tool"
        aria-label={lastEdit ? `Undo: ${lastEdit.label}` : "Undo"}
        disabled={!lastEdit || busy}
        onClick={undo}
      >
        <Undo2 size={16} aria-hidden="true" />
        Undo
      </button>
      {!empty && (
        <ActionMenu label="Deck actions">
          {(close) => (
            <>
              <button
                onClick={async () => {
                  close();
                  try {
                    await navigator.clipboard.writeText(decklist());
                    notify("Decklist copied.", "success");
                  } catch {
                    notify(
                      "Clipboard is unavailable. Use Download decklist to save it.",
                      "error"
                    );
                  }
                }}
              >
                Copy decklist
              </button>
              <button
                onClick={() => {
                  close();
                  downloadDecklist("oops-all-proxies-decklist.txt", decklist());
                }}
              >
                Download decklist
              </button>
              <button
                className="danger"
                disabled={busy}
                onClick={() => {
                  close();
                  void clearDeck();
                }}
              >
                Clear deck
              </button>
            </>
          )}
        </ActionMenu>
      )}
    </div>
  );
}

function DeckList() {
  const cards = useCardsStore((s) => s.cards);
  const images = useCardsStore(
    useShallow((s) => ({
      originalSelectedImages: s.originalSelectedImages,
      originalSelectedBackImages: s.originalSelectedBackImages,
      uploadedFiles: s.uploadedFiles,
      uploadedBackFiles: s.uploadedBackFiles,
    }))
  );
  // Only failed fronts change the list, not every preview's progress.
  const failedPreviews = usePreviewStore(
    useShallow((s) =>
      Object.keys(s.status).filter(
        (key) => key.endsWith(":false") && s.status[key] === "error"
      )
    )
  );
  const ui = useUiStore(
    useShallow((s) => ({
      filter: s.deckFilter,
      attentionOnly: s.attentionOnly,
      highlighted: s.highlightedCardId,
      requested: s.focusRequest?.uuid,
      setFilter: s.setDeckFilter,
      setAttentionOnly: s.setAttentionOnly,
    }))
  );
  const groups = useMemo(() => groupDeck(cards, images), [cards, images]);
  const failed = (uuid: string) => failedPreviews.includes(`${uuid}:false`);
  const rows = groups.map((group) => {
    const status: RowStatus = needsArtwork(group.card, images)
      ? "missing"
      : group.uuids.some(failed)
        ? "error"
        : null;
    const attention =
      status === "missing"
        ? group.uuids.length
        : group.uuids.filter(failed).length;
    return { group, status, attention };
  });
  const attentionCount = rows.reduce((sum, row) => sum + row.attention, 0);
  const attentionOnly = ui.attentionOnly && attentionCount > 0;
  useEffect(() => {
    if (!attentionCount && ui.attentionOnly) ui.setAttentionOnly(false);
  }, [attentionCount, ui]);

  const query = ui.filter.trim().toLowerCase();
  const visible = rows.filter(
    (row) =>
      (!attentionOnly || row.status) &&
      (!query || row.group.card.name.toLowerCase().includes(query))
  );

  return (
    <>
      <div
        className="deck-status"
        data-attention={attentionCount > 0 || undefined}
      >
        <p role="status">
          {attentionCount
            ? `${(cards.length - attentionCount).toLocaleString("en")} ready, ${plural(
                attentionCount,
                "card needs",
                "cards need"
              )} artwork`
            : `${plural(cards.length, "card", "cards")} ready`}
        </p>
        {attentionCount > 0 && (
          <button
            className="text-button deck-tool"
            aria-label={
              attentionOnly
                ? "Show all cards"
                : "Show only cards that need artwork"
            }
            onClick={() => ui.setAttentionOnly(!attentionOnly)}
          >
            {attentionOnly ? "Show all" : "Show"}
          </button>
        )}
      </div>
      <div className="deck-filter">
        <label htmlFor="deck-filter" className="sr-only">
          Filter deck
        </label>
        <input
          id="deck-filter"
          type="search"
          placeholder="Filter deck"
          autoComplete="off"
          value={ui.filter}
          onChange={(e) => ui.setFilter(e.target.value)}
        />
      </div>
      {visible.length ? (
        <ul className="deck-list" aria-labelledby="deck-heading">
          {visible.map(({ group, status }) => (
            <DeckRow
              key={group.uuids[0]}
              group={group}
              status={status}
              hasOwnBack={!!images.originalSelectedBackImages[group.uuids[0]]}
              active={!!ui.highlighted && group.uuids.includes(ui.highlighted)}
              shownCopy={ui.requested ? group.uuids.indexOf(ui.requested) : -1}
            />
          ))}
        </ul>
      ) : (
        <p className="deck-empty">
          No cards match “{ui.filter.trim()}”.{" "}
          <button className="text-button" onClick={() => ui.setFilter("")}>
            Clear filter
          </button>
        </p>
      )}
      <p className="deck-footer">
        {cards.length.toLocaleString("en")} of 1,000 cards
      </p>
    </>
  );
}
