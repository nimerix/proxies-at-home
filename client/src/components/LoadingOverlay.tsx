import type { LoadingProgressState } from "@/store/loading";

type LoadingOverlayProps = {
  task: string;
  progress: LoadingProgressState | null;
};

function buildBarConfig(value: number | null) {
  const normalized =
    typeof value === "number" ? Math.max(0, Math.min(100, value)) : null;

  return {
    percent: normalized,
    widthStyle: { width: normalized === null ? "100%" : `${normalized}%` },
    className:
      normalized === null
        ? "h-full bg-green-500 animate-pulse"
        : "h-full bg-green-500 transition-[width] duration-200 ease-out",
  };
}

export default function LoadingOverlay({ task, progress }: LoadingOverlayProps) {
  const overallBar = buildBarConfig(progress?.overall ?? null);
  const pageBar = buildBarConfig(progress?.pageProgress ?? null);
  const showPageBar =
    progress?.currentPage != null &&
    progress.totalPages != null &&
    progress.totalPages > 0;

  return (
    <div className="fixed rounded-xl inset-0 z-50 bg-gray-900/50 flex items-center justify-center">
      <div className="bg-white dark:bg-gray-800 p-6 rounded shadow-md w-[26rem] text-left space-y-5">
        <div className="text-lg font-semibold text-gray-800 dark:text-white text-center">
          {task}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm font-medium text-gray-600 dark:text-gray-300">
            <span>Overall progress</span>
            {overallBar.percent !== null && <span>{overallBar.percent}%</span>}
          </div>
          <div className="w-full h-2 bg-gray-300 dark:bg-gray-700 rounded overflow-hidden">
            <div className={overallBar.className} style={overallBar.widthStyle} />
          </div>
        </div>

        {showPageBar && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm font-medium text-gray-600 dark:text-gray-300">
              <span>
                Page {progress.currentPage} of {progress.totalPages}
              </span>
              {pageBar.percent !== null && <span>{pageBar.percent}%</span>}
            </div>
            <div className="w-full h-2 bg-gray-300 dark:bg-gray-700 rounded overflow-hidden">
              <div className={pageBar.className} style={pageBar.widthStyle} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
