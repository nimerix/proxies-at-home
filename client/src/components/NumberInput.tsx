import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange"
> & {
  value: number;
  onCommit: (value: number) => void;
};
export function NumberInput({
  value,
  onCommit,
  min,
  max,
  onBlur,
  onKeyDown,
  ...props
}: Props) {
  const [draft, setDraft] = useState(String(value));
  const cancelled = useRef(false);
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <input
      {...props}
      type="number"
      min={min}
      max={max}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        if (cancelled.current) {
          cancelled.current = false;
          setDraft(String(value));
          return;
        }
        const parsed = draft.trim() ? Number(draft) : value;
        const rounded =
          props.step === undefined || Number(props.step) === 1
            ? Math.round(parsed)
            : parsed;
        const next = Number.isFinite(rounded)
          ? Math.max(
              Number(min ?? -Infinity),
              Math.min(Number(max ?? Infinity), rounded)
            )
          : value;
        if (next !== value) onCommit(next);
        setDraft(String(next));
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          cancelled.current = true;
          e.currentTarget.blur();
        }
        onKeyDown?.(e);
      }}
    />
  );
}
