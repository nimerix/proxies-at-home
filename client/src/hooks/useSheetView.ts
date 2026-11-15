import { useEffect, useRef, useState } from "react";
import { useUiStore } from "../store";
import { SHEET_LABEL_PX } from "../helpers/sheetScale";

const HIGHLIGHT_MS = 1600;
export const scrollBehavior = (): ScrollBehavior =>
  matchMedia("(prefers-reduced-motion: no-preference)").matches
    ? "smooth"
    : "auto";

// The scroller's content box, so its padding and safe-area inset are left
// out. Keeps the last measured size while the panel is hidden on a phone.
export function useScrollerSize(scroller: HTMLElement | null) {
  const [size, setSize] = useState({ width: 832, height: 698 });
  useEffect(() => {
    if (!scroller) return;
    const measure = () => {
      if (!scroller.clientWidth || !scroller.clientHeight) return;
      const style = getComputedStyle(scroller);
      const width =
        scroller.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight);
      const height =
        scroller.clientHeight -
        parseFloat(style.paddingTop) -
        parseFloat(style.paddingBottom);
      if (width > 0 && height > 0)
        setSize((old) =>
          old.width === width && old.height === height ? old : { width, height }
        );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    measure();
    return () => observer.disconnect();
  }, [scroller]);
  return size;
}

// The rendered sheet label and its margin, which grow with the browser's font size.
export function useSheetLabelHeight(
  scroller: HTMLElement | null,
  sheetCount: number
) {
  const [height, setHeight] = useState(SHEET_LABEL_PX);
  useEffect(() => {
    const label = scroller?.querySelector<HTMLElement>(".sheet-label");
    if (!label) return;
    const measure = () => {
      const next =
        label.getBoundingClientRect().height +
        parseFloat(getComputedStyle(label).marginBottom);
      if (next > 0)
        setHeight((old) => (Math.abs(old - next) < 0.5 ? old : next));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(label);
    measure();
    return () => observer.disconnect();
  }, [scroller, sheetCount]);
  return height;
}

export function useCurrentSheet(
  scroller: HTMLElement | null,
  sheetCount: number
) {
  useEffect(() => {
    if (!scroller || !sheetCount) return;
    const frames = Array.from(
      scroller.querySelectorAll<HTMLElement>(".sheet-frame")
    );
    const shown = new Map<Element, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          shown.set(entry.target, entry.intersectionRect.height);
        let best = 0;
        frames.forEach((frame, index) => {
          if ((shown.get(frame) ?? 0) > (shown.get(frames[best]) ?? 0))
            best = index;
        });
        useUiStore.getState().setCurrentSheet(best);
      },
      {
        root: scroller,
        threshold: Array.from({ length: 21 }, (_, i) => i / 20),
      }
    );
    frames.forEach((frame) => observer.observe(frame));
    return () => observer.disconnect();
  }, [scroller, sheetCount]);
}

// Scrolls a card asked for by the deck panel into view and marks it briefly.
export function useFocusRequest(
  scroller: HTMLElement | null,
  scale: number,
  ready = true
) {
  const request = useUiStore((s) => s.focusRequest);
  const [located, setLocated] = useState<string | null>(null);
  const pending = useRef<{ uuid: string; until: number } | null>(null);
  useEffect(() => {
    if (!request) return;
    pending.current = { uuid: request.uuid, until: Date.now() + HIGHLIGHT_MS };
    setLocated(request.uuid);
    const ui = useUiStore.getState();
    ui.setHighlightedCardId(request.uuid);
    const timer = setTimeout(() => {
      pending.current = null;
      setLocated(null);
      if (useUiStore.getState().highlightedCardId === request.uuid)
        useUiStore.getState().setHighlightedCardId(null);
    }, HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [request]);
  // Runs again if the scale settles after the request, as when a phone
  // switches to the sheets region.
  useEffect(() => {
    const target = pending.current;
    if (!scroller || !target || Date.now() > target.until) return;
    const frame = requestAnimationFrame(() =>
      scroller
        .querySelector(`[data-card-id="${CSS.escape(target.uuid)}"]`)
        ?.scrollIntoView({
          block: "center",
          inline: "center",
          behavior: scrollBehavior(),
        })
    );
    return () => cancelAnimationFrame(frame);
  }, [scroller, request, scale, ready]);
  return located;
}
