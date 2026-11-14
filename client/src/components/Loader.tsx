import { useLoadingStore } from "../store";
import LoadingOverlay from "./LoadingOverlay";

export function Loader() {
  const loadingTask = useLoadingStore((state) => state.loadingTask);
  const loadingProgress = useLoadingStore((state) => state.loadingProgress);
  const cancelLabel = useLoadingStore((state) => state.cancelLabel);
  const canCancel = useLoadingStore((state) => !!state.cancelAction);
  const requestCancel = useLoadingStore((state) => state.requestCancel);

  if (loadingTask === null) {
    return null;
  }

  return (
    <LoadingOverlay
      task={loadingTask}
      progress={loadingProgress}
      cancelLabel={cancelLabel}
      onCancel={canCancel ? requestCancel : null}
    />
  );
}
