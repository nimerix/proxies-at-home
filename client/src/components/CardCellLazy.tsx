import React, { useEffect, memo, useRef } from "react";
import { useOnScreen } from "../hooks/useOnScreen";
import type { CardOption } from "../types/Card";

type Props = {
  card: CardOption;
  state: "idle" | "loading" | "error" | undefined;
  hasImage: boolean;
  ensureProcessed: (card: CardOption) => Promise<void>;
  children: React.ReactNode;
};

const CardCellLazy = memo(function CardCellLazy({
  card,
  state,
  hasImage,
  ensureProcessed,
  children,
}: Props) {
  const { ref, visible } = useOnScreen<HTMLDivElement>("400px");
  const attemptedRef = useRef(false);
  const prevHasImageRef = useRef(hasImage);

  useEffect(() => {
    attemptedRef.current = false;
  }, [card, ensureProcessed]);

  // Reset attemptedRef when hasImage changes from true to false (image was cleared)
  useEffect(() => {
    if (prevHasImageRef.current && !hasImage) {
      attemptedRef.current = false;
    }
    prevHasImageRef.current = hasImage;
  }, [hasImage]);

  useEffect(() => {
    // Only attempt to process once - don't retry automatically when in error state
    if (visible && !hasImage && !attemptedRef.current) {
      attemptedRef.current = true;
      void ensureProcessed(card);
    }
  }, [visible, card, ensureProcessed, hasImage, state]);

  return (
    <div ref={ref} className="relative">
      {!hasImage && state !== "error" && (
        <div className="absolute inset-0 grid place-items-center z-10 pointer-events-none">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-transparent" />
        </div>
      )}
      {state === "error" && !hasImage && (
        <div className="absolute inset-0 grid place-items-center z-10 pointer-events-none">
          <button
            type="button"
            className="px-2 py-1 text-xs bg-red-600 text-white rounded cursor-pointer pointer-events-auto"
            onClick={(e) => {
              e.stopPropagation();
              attemptedRef.current = false;
              void ensureProcessed(card);
            }}
          >
            Load failed · retry
          </button>
        </div>
      )}
      {children}
    </div>
  );
});

export default CardCellLazy;
