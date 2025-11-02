type LoadingOverlayProps = {
  task: string;
  progress: number | null;
};

export default function LoadingOverlay({ task, progress }: LoadingOverlayProps) {
  const clampedProgress =
    typeof progress === "number" ? Math.max(0, Math.min(100, progress)) : null;
  const widthStyle = {
    width: clampedProgress === null ? "100%" : `${clampedProgress}%`,
  };
  const barClassName = clampedProgress === null
    ? "h-full bg-green-500 animate-pulse"
    : "h-full bg-green-500 transition-[width] duration-200 ease-out";

  return (
    <div className="fixed rounded-xl inset-0 z-50 bg-gray-900/50 flex items-center justify-center">
      {" "}
      <div className="bg-white dark:bg-gray-800 p-6 rounded shadow-md w-96 text-center">
        <div className="mb-4 text-lg font-semibold text-gray-800 dark:text-white">
          {task}
        </div>
        <div className="w-full h-2 bg-gray-300 dark:bg-gray-700 rounded overflow-hidden">
          <div className={barClassName} style={widthStyle} />
        </div>
        {clampedProgress !== null && (
          <div className="mt-2 text-sm font-medium text-gray-600 dark:text-gray-300">
            {clampedProgress}%
          </div>
        )}
      </div>
    </div>
  );
}
