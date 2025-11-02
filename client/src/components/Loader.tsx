import { useLoadingStore } from "../store";
import LoadingOverlay from "./LoadingOverlay";

export function Loader() {
  const loadingTask = useLoadingStore((state) => state.loadingTask);
  const loadingProgress = useLoadingStore((state) => state.loadingProgress);

  if (loadingTask === null) {
    return null;
  }

  return <LoadingOverlay task={loadingTask} progress={loadingProgress} />;
}
