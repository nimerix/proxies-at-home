import React from "react";

type LoadingOverlayProps = {
  task: string;
};

export default function LoadingOverlay({ task }: LoadingOverlayProps) {
  return (
    <div className="fixed rounded-xl inset-0 z-50 bg-gray-900/50 flex items-center justify-center">      <div className="bg-white dark:bg-gray-800 p-6 rounded shadow-md w-96 text-center">
      <div className="mb-4 text-lg font-semibold text-gray-800 dark:text-white">{task}</div>
      <div className="w-full h-2 bg-gray-300 dark:bg-gray-700 rounded overflow-hidden">
        <div className="h-full bg-green-500 animate-pulse" style={{ width: "100%" }} />
      </div>
    </div>
    </div>
  );
}
