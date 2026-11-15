import { useEffect, useMemo, useState } from "react";
import { Check, ImageOff, Replace, Search } from "lucide-react";
import { resolveImageUrl } from "../helpers/ImageHelper";
import {
  replacedUploads,
  scopeOptions,
  scopeTargets,
  type ArtworkScope,
} from "../helpers/artworkScope";
import { needsArtwork } from "../helpers/deckGroups";
import { plural } from "../helpers/plural";
import {
  autocompleteCardNames,
  findPrintings,
  getSets,
  type FoundCard,
  type SetInfo,
} from "../helpers/scryfall";
import { useArtworkModalStore, useCardsStore, usePreviewStore } from "../store";
import { errorMessage, notify } from "../store/notifications";
import { deckEdit } from "../store/undo";
import type { CardOption } from "../types/Card";

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// A printing named for both faces ("Delver of Secrets // Insectile
// Aberration") is the same card as its front face's name.
const isOtherCard = (print: FoundCard, name: string) =>
  !sameName(print.name, name) && !sameName(print.name.split(" // ")[0], name);

function scopeLabel(scope: ArtworkScope, count: number, name: string) {
  if (scope === "row") return `The ${count} copies in this row`;
  if (scope === "name")
    return `All ${count} cards named ${name}, across printings`;
  return "This copy";
}

function useScope(card: CardOption) {
  const cards = useCardsStore((s) => s.cards);
  const originalSelectedImages = useCardsStore((s) => s.originalSelectedImages);
  const originalSelectedBackImages = useCardsStore(
    (s) => s.originalSelectedBackImages
  );
  const uploadedFiles = useCardsStore((s) => s.uploadedFiles);
  const opened = useArtworkModalStore((s) => s.scope);
  const [chosen, setChosen] = useState<ArtworkScope>(opened);
  return useMemo(() => {
    const images = {
      originalSelectedImages,
      originalSelectedBackImages,
      uploadedFiles,
    };
    const options = scopeOptions(card, cards, images);
    const scope = options.some((o) => o.scope === chosen) ? chosen : "copy";
    const { fronts, backs } = replacedUploads(
      scopeTargets(scope, card, cards, images),
      cards,
      images
    );
    const parts = [
      fronts && plural(fronts, "uploaded image", "uploaded images"),
      backs && plural(backs, "custom back", "custom backs"),
    ].filter(Boolean);
    const replaces = parts.length
      ? `This replaces ${parts.join(" and ")}.`
      : "";
    return { options, scope, setScope: setChosen, replaces };
  }, [
    card,
    cards,
    originalSelectedImages,
    originalSelectedBackImages,
    uploadedFiles,
    chosen,
  ]);
}

function Thumbnail({ src, alt }: { src: string; alt: string }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  if (state === "error")
    return (
      <span className="artwork-missing">
        <ImageOff size={20} aria-hidden="true" />
        Image unavailable
      </span>
    );
  return (
    <img
      src={src}
      alt={alt}
      data-state={state}
      referrerPolicy="no-referrer"
      loading="lazy"
      onLoad={() => setState("ready")}
      onError={() => setState("error")}
    />
  );
}

export function ArtworkPrintings({
  card,
  onClose,
}: {
  card: CardOption;
  onClose: () => void;
}) {
  const language = useCardsStore((s) => s.globalLanguage);
  const original = useCardsStore((s) => s.originalSelectedImages[card.uuid]);
  const [replacing, setReplacing] = useState(() =>
    needsArtwork(card, useCardsStore.getState())
  );
  const [query, setQuery] = useState(card.name);
  const [requestedName, setRequestedName] = useState(card.name);
  const [attempt, setAttempt] = useState(0);
  const [prints, setPrints] = useState<FoundCard[]>([]);
  const [sets, setSets] = useState<SetInfo[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { options, scope, setScope, replaces } = useScope(card);
  const replacesCard = !sameName(requestedName, card.name);
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
    if (!replacing) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (query.trim().length < 2) {
        setSuggestions([]);
        return;
      }
      void autocompleteCardNames(query.trim(), controller.signal)
        .then((names) => {
          if (!controller.signal.aborted) setSuggestions(names.slice(0, 10));
        })
        .catch(() => {
          if (!controller.signal.aborted) setSuggestions([]);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, replacing]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setPrints([]);
    setFilter("");
    void findPrintings(requestedName, language, true, controller.signal)
      .then((found) => {
        if (!controller.signal.aborted)
          setPrints(found.filter((p) => p.imageUrls.length));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [requestedName, language, attempt]);
  const setInfo = useMemo(
    () => new Map(sets.map((set) => [set.code.toLowerCase(), set])),
    [sets]
  );
  const shown = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return prints.filter(
      (p) =>
        !term ||
        `${p.set} ${setInfo.get(p.set?.toLowerCase() ?? "")?.name ?? ""}`
          .toLowerCase()
          .includes(term)
    );
  }, [prints, filter, setInfo]);

  function choose(print: FoundCard, url: string, faceIndex: number) {
    const state = useCardsStore.getState();
    const current = state.cards.find((c) => c.uuid === card.uuid) ?? card;
    const differs = (c: CardOption) =>
      state.originalSelectedImages[c.uuid] !== url ||
      c.name !== print.name ||
      c.set !== print.set ||
      c.number !== print.number ||
      c.layout !== print.layout ||
      (c.currentFaceIndex ?? 0) !== faceIndex ||
      c.imageUrls.join("\n") !== print.imageUrls.join("\n") ||
      c.isUserUpload ||
      !!c.hasBakedBleed ||
      !!c.hasBackImage ||
      !!c.backHasBakedBleed ||
      !!state.originalSelectedBackImages[c.uuid] ||
      !!state.uploadedFiles[c.uuid] ||
      !!state.uploadedBackFiles[c.uuid];
    const targets = new Set(scopeTargets(scope, current, state.cards, state));
    const ids = new Set(
      state.cards
        .filter((c) => targets.has(c.uuid) && differs(c))
        .map((c) => c.uuid)
    );
    onClose();
    if (!ids.size) return;
    const subject =
      ids.size === 1 ? current.name : `${ids.size} cards named ${current.name}`;
    const renames = !sameName(print.name, current.name);
    deckEdit(
      renames
        ? `replace ${subject} with ${print.name}`
        : `change artwork for ${subject}`,
      () =>
        useCardsStore.setState((s) => {
          const strip = <T,>(map: Record<string, T>) =>
            Object.fromEntries(
              Object.entries(map).filter(([id]) => !ids.has(id))
            );
          const originals = { ...s.originalSelectedImages };
          for (const id of ids) originals[id] = url;
          return {
            cards: s.cards.map((c) =>
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
            selectedImages: strip(s.selectedImages),
            selectedBackFaceImages: strip(s.selectedBackFaceImages),
            bleedReports: strip(s.bleedReports),
            uploadedFiles: strip(s.uploadedFiles),
            uploadedBackFiles: strip(s.uploadedBackFiles),
            originalSelectedBackImages: strip(s.originalSelectedBackImages),
          };
        })
    );
    usePreviewStore.getState().forget([...ids]);
    notify(
      renames
        ? `Replaced ${subject} with ${print.name}.`
        : ids.size === 1
          ? "Artwork updated."
          : `Artwork updated for ${ids.size} cards.`,
      "success"
    );
  }

  const renames = !replacesCard && shown.some((p) => isOtherCard(p, card.name));
  const status = loading
    ? "Finding printings…"
    : error || !prints.length
      ? ""
      : filter.trim()
        ? `${shown.length} of ${plural(prints.length, "printing", "printings")}`
        : plural(prints.length, "printing", "printings");
  return (
    <>
      <div className="printings-bar">
        <div className="printings-title">
          <h3>Printings of {requestedName}</h3>
          <p className="hint" role="status">
            {status}
          </p>
          {renames && (
            <p className="rename-note">
              Some printings are a different card and will rename this one.
            </p>
          )}
        </div>
        <div className="printings-filter" hidden={!loading && !prints.length}>
          <label htmlFor="set-filter" className="sr-only">
            Filter by set name or code
          </label>
          <Search size={16} aria-hidden="true" />
          <input
            id="set-filter"
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by set"
            autoComplete="off"
          />
        </div>
        <button
          type="button"
          className="secondary-button printings-replace"
          aria-expanded={replacing}
          aria-controls="art-search"
          onClick={() => setReplacing((open) => !open)}
        >
          <Replace size={16} aria-hidden="true" />
          Replace with a different card
        </button>
      </div>
      {replacing && (
        <form
          id="art-search"
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
            <label htmlFor="art-search-name">Find a card</label>
            <input
              id="art-search-name"
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
            <Search size={16} aria-hidden="true" /> Search
          </button>
        </form>
      )}
      {replacesCard && (
        <p className="replace-note">Choosing one replaces {card.name}.</p>
      )}
      {options.length > 1 && (
        <fieldset className="scope-options">
          <legend>Change</legend>
          {options.map((option) => (
            <label key={option.scope} className="check-field">
              <input
                type="radio"
                name="artwork-scope"
                value={option.scope}
                checked={scope === option.scope}
                onChange={() => setScope(option.scope)}
              />
              {scopeLabel(option.scope, option.count, card.name)}
            </label>
          ))}
        </fieldset>
      )}
      <div aria-live="polite">
        {replaces && <p className="scope-note">{replaces}</p>}
      </div>
      {loading ? null : error ? (
        <div role="alert" className="empty-results">
          <p>Could not load printings. {error}</p>
          <button
            className="secondary-button"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Try again
          </button>
        </div>
      ) : !prints.length ? (
        <div className="empty-results">
          <p>
            No printings found for “{requestedName}”. Check the spelling and
            search again.
          </p>
          {!replacing && (
            <button
              className="secondary-button"
              onClick={() => setReplacing(true)}
            >
              Search for another card
            </button>
          )}
        </div>
      ) : !shown.length ? (
        <div className="empty-results">
          <p>No printings match “{filter.trim()}”.</p>
          <button className="secondary-button" onClick={() => setFilter("")}>
            Clear filter
          </button>
        </div>
      ) : (
        <ul className="artwork-grid">
          {shown.flatMap((print) => {
            const info = setInfo.get(print.set?.toLowerCase() ?? "");
            const code = print.set?.toUpperCase() ?? "";
            const year = info?.released_at?.slice(0, 4);
            const meta = `${code} #${print.number}${year ? `, ${year}` : ""}`;
            const multiFace = print.imageUrls.length > 1;
            const otherCard = isOtherCard(print, card.name);
            return print.imageUrls.map((url, faceIndex) => {
              const selected = original === url;
              const face = print.faces?.[faceIndex];
              const faceName = multiFace
                ? (face?.name ?? `Face ${faceIndex + 1}`)
                : null;
              return (
                <li key={`${print.set}:${print.number}:${url}`}>
                  <button
                    className="artwork-choice"
                    aria-pressed={selected}
                    aria-label={[
                      `Choose ${print.name}`,
                      faceName,
                      info?.name,
                      meta,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                    onClick={() => choose(print, url, faceIndex)}
                  >
                    <span className="artwork-thumb">
                      <Thumbnail
                        src={face?.thumbUrl || resolveImageUrl(url)}
                        alt={`${face?.name ?? print.name}, ${meta}`}
                      />
                      {selected && (
                        <span className="artwork-selected">
                          <Check size={14} aria-hidden="true" />
                          Selected
                        </span>
                      )}
                    </span>
                    <span className="artwork-set" title={info?.name ?? code}>
                      {info?.name ?? code}
                    </span>
                    <span className="artwork-meta">{meta}</span>
                    {faceName && (
                      <span className="artwork-meta">{faceName}</span>
                    )}
                    {otherCard && (
                      <span className="artwork-other" title={print.name}>
                        {print.name}
                      </span>
                    )}
                  </button>
                </li>
              );
            });
          })}
        </ul>
      )}
    </>
  );
}
