import type { LoadingProgressState } from "@/store/loading";
import { Button, Progress } from "flowbite-react";

type LoadingOverlayProps = {
  task: string;
  progress: LoadingProgressState | null;
  cancelLabel?: string | null;
  onCancel?: (() => void) | null;
};

function clampPercent(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(100, value));
}

export default function LoadingOverlay({ task, progress, cancelLabel, onCancel }: LoadingOverlayProps) {
  const overallPercent = clampPercent(progress?.overall ?? null);
  const pagePercent = clampPercent(progress?.pageProgress ?? null);
  const showPageBar =
    progress?.currentPage != null && progress.totalPages != null && progress.totalPages > 0;

  return (
    <div className="fixed rounded-xl inset-0 z-50 bg-gray-900/50 flex items-center justify-center">
      <div className="bg-white dark:bg-gray-800 p-6 rounded shadow-md w-[26rem] text-left space-y-6">
        <div className="text-lg font-semibold text-gray-800 dark:text-white text-center">
          {task}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm font-medium text-gray-600 dark:text-gray-300">
            <span>Overall progress</span>
            {overallPercent !== null && <span>{overallPercent}%</span>}
          </div>
          {overallPercent === null ? (
            <Progress progress={12} color="green" size="sm" className="animate-pulse" />
          ) : (
            <Progress progress={overallPercent} color="green" size="sm" />
          )}
        </div>

        {showPageBar && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm font-medium text-gray-600 dark:text-gray-300">
              <span>
                Page {progress.currentPage} of {progress.totalPages}
              </span>
              {pagePercent !== null && <span>{pagePercent}%</span>}
            </div>
            {pagePercent === null ? (
              <Progress progress={18} color="blue" size="sm" className="animate-pulse" />
            ) : (
              <Progress progress={pagePercent} color="blue" size="sm" />
            )}
          </div>
        )}

        {onCancel && (
          <div className="pt-2 flex justify-end">
            <Button color="light" onClick={onCancel}>
              {cancelLabel ?? "Cancel"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
