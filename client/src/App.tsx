import { useEffect, useState } from "react";
import { X, AlertCircle, CheckCircle2 } from "lucide-react";
import { Loader } from "./components/Loader";
import ProxyBuilderPage from "./pages/ProxyBuilderPage";
import { useCardsStore, useSettingsStore } from "./store";
import {
  continueWithoutSaving,
  reportStorageError,
  useStorageStatus,
} from "./helpers/IndexedDBStorage";
import { useNotifications, type Notice } from "./store/notifications";

function Notification({ notice: n }: { notice: Notice }) {
  const [paused, setPaused] = useState(false);
  const dismiss = useNotifications((s) => s.dismiss);
  useEffect(() => {
    if (paused || n.kind === "error") return;
    const timer = setTimeout(() => dismiss(n.id), 8000);
    return () => clearTimeout(timer);
  }, [paused, n.id, n.kind, dismiss]);
  return (
    <div
      className={`notice ${n.kind}`}
      role={n.kind === "error" ? "alert" : "status"}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setPaused(false);
      }}
    >
      {n.kind === "success" ? (
        <CheckCircle2 size={19} aria-hidden="true" />
      ) : (
        <AlertCircle size={19} aria-hidden="true" />
      )}
      <p>{n.message}</p>
      <button aria-label="Dismiss notification" onClick={() => dismiss(n.id)}>
        <X size={17} aria-hidden="true" />
      </button>
    </div>
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
  const notices = useNotifications((s) => s.notices);
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
  return (
    <>
      <h1 className="sr-only">Proxxied — Magic card proxy builder</h1>
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
                onClick={async () => {
                  if (
                    !window.confirm(
                      "Delete this browser’s saved cards, uploads and print settings? This cannot be undone."
                    )
                  )
                    return;
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
      <section className="notifications" aria-label="Notifications">
        {notices.map((n) => (
          <Notification key={n.id} notice={n} />
        ))}
      </section>
    </>
  );
}
export default App;
