import axios from "axios";
import { useEffect, useMemo, useRef, useState } from "react";
import { X, Search } from "lucide-react";
import { API_BASE } from "../constants";
import { toProxied } from "../helpers/ImageHelper";
import { useArtworkModalStore, useCardsStore } from "../store";
import {
  BleedArtworkControls,
  type BleedPreviewStatus,
} from "./BleedArtworkControls";
import { errorMessage, notify } from "../store/notifications";
import type { CardOption } from "../types/Card";

type SetInfo = { code: string; name: string };
let setsPromise: Promise<SetInfo[]> | null = null;
function getSets() {
  if (!setsPromise)
    setsPromise = axios
      .get<{ data: SetInfo[] }>(`${API_BASE}/api/cards/images/sets`, {
        timeout: 15000,
      })
      .then((res) => res.data.data)
      .catch(() => {
        setsPromise = null;
        return [];
      });
  return setsPromise;
}
export function ArtworkModal(props: BleedPreviewStatus) {
  const { open, card } = useArtworkModalStore();
  return open && card ? (
    <ArtworkDialog key={card.uuid} card={card} {...props} />
  ) : null;
}
function ArtworkDialog({
  card,
  loadingMap,
  errorMap,
  onRetry,
}: { card: CardOption } & BleedPreviewStatus) {
  const dialog = useRef<HTMLDialogElement>(null);
  const language = useCardsStore((s) => s.globalLanguage);
  const original = useCardsStore((s) => s.originalSelectedImages[card.uuid]);
  const [query, setQuery] = useState(card.name);
  const [requestedName, setRequestedName] = useState(card.name);
  const [attempt, setAttempt] = useState(0);
  const [prints, setPrints] = useState<CardOption[]>([]);
  const [sets, setSets] = useState<SetInfo[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [applyAll, setApplyAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const close = useArtworkModalStore.getState().closeModal;
  useEffect(() => {
    const el = dialog.current,
      opener = document.activeElement;
    el?.showModal();
    return () => {
      el?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  useEffect(() => {
    let active = true;
    void getSets().then((value) => {
      if (active) setSets(value);
    });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (query.trim().length < 2) {
        setSuggestions([]);
        return;
      }
      void axios
        .get<{ data: string[] }>(`${API_BASE}/api/cards/images/autocomplete`, {
          params: { q: query.trim() },
          signal: controller.signal,
          timeout: 10000,
        })
        .then((res) => {
          if (!controller.signal.aborted)
            setSuggestions(res.data.data.slice(0, 10));
        })
        .catch(() => {
          if (!controller.signal.aborted) setSuggestions([]);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setPrints([]);
    setFilter("");
    void axios
      .post<CardOption[]>(
        `${API_BASE}/api/cards/images`,
        { cardNames: [requestedName], cardArt: "prints", language },
        { signal: controller.signal, timeout: 60000 }
      )
      .then((res) => {
        if (!controller.signal.aborted)
          setPrints(res.data.filter((p) => p.imageUrls?.length));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [requestedName, language, attempt]);
  const setNames = useMemo(
    () => new Map(sets.map((set) => [set.code.toLowerCase(), set.name])),
    [sets]
  );
  const choices = useMemo(
    () =>
      prints
        .filter(
          (p) =>
            !filter ||
            `${p.set} ${setNames.get(p.set?.toLowerCase() ?? "") ?? ""}`
              .toLowerCase()
              .includes(filter.toLowerCase())
        )
        .flatMap((print) =>
          print.imageUrls.map((url, faceIndex) => ({ print, url, faceIndex }))
        ),
    [prints, filter, setNames]
  );
  function choose(
    print: CardOption,
    url: string,
    faceIndex: number,
    all: boolean
  ) {
    useCardsStore.setState((state) => {
      const ids = new Set(
        state.cards
          .filter((c) =>
            all
              ? c.name.toLowerCase() === card.name.toLowerCase()
              : c.uuid === card.uuid
          )
          .map((c) => c.uuid)
      );
      const strip = <T,>(map: Record<string, T>) =>
        Object.fromEntries(Object.entries(map).filter(([id]) => !ids.has(id)));
      const originals = { ...state.originalSelectedImages };
      for (const id of ids) originals[id] = url;
      return {
        cards: state.cards.map((c) =>
          ids.has(c.uuid)
            ? {
                ...c,
                name: print.name,
                set: print.set,
                number: print.number,
                imageUrls: print.imageUrls,
                faces: print.faces,
                layout: print.layout,
                currentFaceIndex: faceIndex,
                isUserUpload: false,
                hasBakedBleed: false,
                hasBackImage: false,
                backHasBakedBleed: false,
              }
            : c
        ),
        originalSelectedImages: originals,
        selectedImages: strip(state.selectedImages),
        selectedBackFaceImages: strip(state.selectedBackFaceImages),
        uploadedFiles: strip(state.uploadedFiles),
        uploadedBackFiles: strip(state.uploadedBackFiles),
        originalSelectedBackImages: strip(state.originalSelectedBackImages),
      };
    });
    close();
    notify(
      `Artwork updated${all ? " for all matching cards" : ""}.`,
      "success"
    );
  }
  return (
    <dialog
      ref={dialog}
      className="artwork-dialog"
      aria-labelledby="artwork-title"
      onCancel={close}
    >
      <header className="dialog-heading">
        <div>
          <span className="eyebrow">Choose your printing</span>
          <h2 id="artwork-title">{card.name}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close artwork picker"
          onClick={close}
        >
          <X size={21} />
        </button>
      </header>
      <div className="dialog-body">
        <BleedArtworkControls
          card={card}
          loadingMap={loadingMap}
          errorMap={errorMap}
          onRetry={onRetry}
        />
        <form
          className="art-search"
          onSubmit={(e) => {
            e.preventDefault();
            if (query.trim()) {
              setRequestedName(query.trim());
              setAttempt((n) => n + 1);
            }
          }}
        >
          <div className="field">
            <label htmlFor="art-search">Find a card</label>
            <input
              id="art-search"
              list="card-suggestions"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
            <datalist id="card-suggestions">
              {suggestions.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </datalist>
          </div>
          <button className="secondary-button" disabled={!query.trim()}>
            <Search size={17} aria-hidden="true" /> Search
          </button>
        </form>
        <p className="hint">
          Showing printings for <strong>{requestedName}</strong>. Selecting
          artwork also replaces the card when you search for a different name.
        </p>
        <div className="art-filters">
          <div className="field">
            <label htmlFor="set-filter">Filter by set name or code</label>
            <input
              id="set-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="e.g. Commander or C21"
            />
          </div>
          <label className="check-field">
            <input
              type="checkbox"
              checked={applyAll}
              onChange={(e) => setApplyAll(e.target.checked)}
            />
            Apply to every “{card.name}”
          </label>
        </div>
        {loading ? (
          <p role="status" className="empty-results">
            Finding printings…
          </p>
        ) : error ? (
          <div role="alert" className="empty-results">
            <p>Could not load artwork. {error}</p>
            <button
              className="secondary-button"
              onClick={() => setAttempt((n) => n + 1)}
            >
              Try again
            </button>
          </div>
        ) : !choices.length ? (
          <div className="empty-results">
            <p>
              No matching artwork. Try another card name or clear the set
              filter.
            </p>
            {filter && (
              <button
                className="secondary-button"
                onClick={() => setFilter("")}
              >
                Clear filter
              </button>
            )}
          </div>
        ) : (
          <>
            <p className="hint" role="status">
              {choices.length} artwork choices
            </p>
            <div className="artwork-grid">
              {choices.map(({ print, url, faceIndex }) => (
                <button
                  key={`${print.set}:${print.number}:${url}`}
                  className="artwork-choice"
                  aria-pressed={original === url}
                  aria-label={`Choose ${print.name}, ${print.set} ${print.number}, face ${faceIndex + 1}`}
                  onClick={(e) =>
                    choose(print, url, faceIndex, applyAll || e.shiftKey)
                  }
                >
                  <img
                    src={print.faces?.[faceIndex]?.thumbUrl || toProxied(url)}
                    referrerPolicy="no-referrer"
                    alt={`${print.faces?.[faceIndex]?.name ?? print.name} — ${print.set} #${print.number}`}
                    loading="lazy"
                  />
                  <span>
                    {print.set?.toUpperCase()} · #{print.number}
                    {original === url ? " · Selected" : ""}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
