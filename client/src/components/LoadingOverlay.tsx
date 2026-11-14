import type { LoadingProgressState } from "@/store/loading";
import { useEffect, useRef } from "react";
export default function LoadingOverlay({
  task,
  progress,
  cancelLabel,
  onCancel,
}: {
  task: string;
  progress: LoadingProgressState | null;
  cancelLabel?: string | null;
  onCancel?: (() => void) | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current,
      opener = document.activeElement;
    el?.showModal();
    return () => {
      el?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="task-dialog"
      aria-labelledby="task-title"
      onCancel={(e) => {
        e.preventDefault();
        onCancel?.();
      }}
    >
      <h2 id="task-title">{task}</h2>
      <p role="status" className="hint">
        {cancelLabel === "Cancelling…"
          ? "Finishing the current image. Your deck is safe."
          : "Keep this tab open while your files are prepared."}
      </p>
      <label className="progress-label" htmlFor="overall-progress">
        Overall progress{" "}
        <span>
          {progress?.overall != null ? `${progress.overall}%` : "Working…"}
        </span>
      </label>
      <progress
        id="overall-progress"
        max={100}
        value={progress?.overall ?? undefined}
      />
      {progress?.currentPage != null && (
        <>
          <label className="progress-label" htmlFor="page-progress">
            Page {progress.currentPage} of {progress.totalPages}
          </label>
          <progress
            id="page-progress"
            max={100}
            value={progress.pageProgress ?? undefined}
          />
        </>
      )}
      {cancelLabel && (
        <button
          className="secondary-button"
          disabled={!onCancel}
          onClick={() => onCancel?.()}
        >
          {cancelLabel}
        </button>
      )}
    </dialog>
  );
}
