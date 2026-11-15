import { useEffect, useState } from "react";
import { Loader } from "./components/Loader";
import { ConfirmDialog } from "./components/feedback/ConfirmDialog";
import { Notifications } from "./components/feedback/Notifications";
import ProxyBuilderPage from "./pages/ProxyBuilderPage";
import { useCardsStore, useSettingsStore } from "./store";
import {
  continueWithoutSaving,
  reportStorageError,
  useStorageStatus,
} from "./helpers/IndexedDBStorage";
import { confirmAction, DELETE_SAVED_DATA } from "./store/confirm";
import { notify } from "./store/notifications";
import { undoFromUser } from "./store/undo";

function isTextEntry(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.matches("input, textarea, select"))
  );
}

function App() {
  const [hydrated, setHydrated] = useState(
    useCardsStore.persist.hasHydrated() &&
      useSettingsStore.persist.hasHydrated()
  );
  const storageError = useStorageStatus((s) => s.error);
  const savingDisabled = useStorageStatus((s) => s.savingDisabled);
  const [resetting, setResetting] = useState(false);
  useEffect(() => {
    const done = () =>
      setHydrated(
        useCardsStore.persist.hasHydrated() &&
          useSettingsStore.persist.hasHydrated()
      );
    const offCards = useCardsStore.persist.onFinishHydration(done);
    const offSettings = useSettingsStore.persist.onFinishHydration(done);
    done();
    return () => {
      offCards();
      offSettings();
    };
  }, []);
  useEffect(() => {
    const undoOnShortcut = (e: KeyboardEvent) => {
      if (
        e.key.toLowerCase() !== "z" ||
        !(e.ctrlKey || e.metaKey) ||
        e.shiftKey ||
        e.altKey ||
        isTextEntry(e.target)
      )
        return;
      e.preventDefault();
      const label = undoFromUser();
      if (label) notify(`Undid: ${label}.`);
    };
    window.addEventListener("keydown", undoOnShortcut);
    return () => window.removeEventListener("keydown", undoOnShortcut);
  }, []);
  return (
    <>
      <h1 className="sr-only">Oops, All Proxies — Magic card proxy builder</h1>
      {(storageError || savingDisabled) && (
        <div role="alert" className="storage-error">
          {savingDisabled
            ? "Temporary workspace — saving is disabled. Download your deck and images before closing this tab."
            : storageError}
        </div>
      )}
      {hydrated || savingDisabled ? (
        <>
          <ProxyBuilderPage />
          <Loader />
        </>
      ) : (
        <main className="startup-screen">
          <h2>
            {storageError
              ? "Your saved workspace couldn’t be opened"
              : "Opening your workspace…"}
          </h2>
          <p>
            {storageError
              ? "Retry loading, work in a temporary session, or remove the saved workspace and start fresh."
              : "Your saved deck and print settings are loading."}
          </p>
          {storageError && (
            <div className="recovery-actions">
              <button
                className="secondary-button"
                disabled={resetting}
                onClick={() => {
                  void useCardsStore.persist.rehydrate();
                  void useSettingsStore.persist.rehydrate();
                }}
              >
                Retry loading
              </button>
              <button
                className="primary-button"
                disabled={resetting}
                onClick={continueWithoutSaving}
              >
                Continue without saving
              </button>
              <button
                className="text-button danger"
                disabled={resetting}
                onClick={async (e) => {
                  e.currentTarget.focus();
                  if (!(await confirmAction(DELETE_SAVED_DATA))) return;
                  setResetting(true);
                  try {
                    const cards = useCardsStore.persist.getOptions(),
                      settings = useSettingsStore.persist.getOptions();
                    if (
                      !cards.name ||
                      !cards.storage ||
                      !settings.name ||
                      !settings.storage
                    )
                      throw new Error("Browser storage is unavailable.");
                    await Promise.all([
                      cards.storage.removeItem(cards.name),
                      settings.storage.removeItem(settings.name),
                    ]);
                    window.location.reload();
                  } catch (error) {
                    reportStorageError(
                      "recovery",
                      `Could not delete saved data. ${error instanceof Error ? error.message : "Browser storage is unavailable."}`
                    );
                    setResetting(false);
                  }
                }}
              >
                {resetting
                  ? "Deleting saved data…"
                  : "Delete saved data and start fresh"}
              </button>
            </div>
          )}
        </main>
      )}
      <ConfirmDialog />
      <Notifications />
    </>
  );
}
export default App;
