import type { PersistStorage, StorageValue } from "zustand/middleware";
import { create } from "zustand";

const DB_NAME = "proxxied-storage";
const STORE_NAME = "zustand-store";
let dbPromise: Promise<IDBDatabase> | null = null;
let storageEpoch = 0;
export const useStorageStatus = create<{
  error: string | null;
  pending: number;
  savingDisabled: boolean;
}>(() => ({ error: null, pending: 0, savingDisabled: false }));
const storageErrors = new Map<string, string>();
export function reportStorageError(scope: string, error?: string) {
  if (useStorageStatus.getState().savingDisabled) return;
  if (error) storageErrors.set(scope, error);
  else storageErrors.delete(scope);
  useStorageStatus.setState({
    error: [...new Set(storageErrors.values())].join(" ") || null,
  });
}
export function hydrationErrorMessage(error: unknown) {
  if (!error) return undefined;
  return `Your saved workspace could not be opened. ${error instanceof Error ? error.message : String(error)} Existing saved data has been kept.`;
}
export function continueWithoutSaving() {
  storageEpoch++;
  storageErrors.clear();
  useStorageStatus.setState({ savingDisabled: true, error: null });
}
function getDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      let settled = false;
      const fail = (error: unknown) => {
        settled = true;
        reject(error);
      };
      request.onupgradeneeded = () =>
        request.result.createObjectStore(STORE_NAME);
      request.onerror = () => fail(request.error);
      request.onblocked = () =>
        fail(new Error("Close other Oops, All Proxies tabs, then retry."));
      request.onsuccess = () => {
        const db = request.result;
        if (settled) {
          db.close();
          return;
        }
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
    }).catch((error: unknown) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}
async function transaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    let request: IDBRequest<T>;
    try {
      request = action(tx.objectStore(STORE_NAME));
    } catch (error) {
      tx.abort();
      reject(error);
      return;
    }
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () =>
      reject(tx.error ?? new Error("Saving the workspace was interrupted."));
    tx.onerror = (event) =>
      reject(
        (event.target as IDBRequest).error ??
          tx.error ??
          new Error("Browser storage failed.")
      );
  });
}
type BinarySnapshot = {
  __proxxiedBinary: 1;
  bytes: ArrayBuffer;
  type: string;
  name?: string;
  lastModified?: number;
};
function isBinary(value: unknown): value is BinarySnapshot {
  return (
    !!value &&
    typeof value === "object" &&
    "__proxxiedBinary" in value &&
    value.__proxxiedBinary === 1 &&
    "bytes" in value &&
    value.bytes instanceof ArrayBuffer
  );
}
function restoreBinary(value: BinarySnapshot): Blob {
  return typeof value.name === "string"
    ? new File([value.bytes], value.name, {
        type: value.type,
        lastModified: value.lastModified,
      })
    : new Blob([value.bytes], { type: value.type });
}
async function binarySnapshot(value: Blob): Promise<BinarySnapshot> {
  return {
    __proxxiedBinary: 1,
    bytes: await value.arrayBuffer(),
    type: value.type,
    ...(value instanceof File
      ? { name: value.name, lastModified: value.lastModified }
      : {}),
  };
}

// Main snapshots hold references to immutable file records. Reordering a deck
// rewrites only its small metadata record. File insertion, deletion and the new
// snapshot commit together, so a failed save cannot strand an existing deck.
export function createIndexedDBStorage<S>(
  legacyKeys: string[] = []
): PersistStorage<S> {
  let lastState: S | undefined;
  let pending: { name: string; value: StorageValue<S> } | undefined;
  let draining: Promise<void> | undefined;
  let previousFiles = new Set<string>();
  let useBinarySnapshots = false;
  const fileKeys = new WeakMap<Blob, string>();
  const textKeys = new Map<string, string>();
  const readers = new Set<Promise<unknown>>();

  async function decode(
    raw: unknown,
    name: string
  ): Promise<StorageValue<S> | null> {
    if (raw == null) return null;
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!value || typeof value !== "object" || !("state" in value))
      throw new Error("The saved record is unreadable.");
    const loaded = new Map<string, Promise<Blob | string>>();
    const references = new Set<string>();
    const unpack = async (item: unknown): Promise<unknown> => {
      if (item instanceof Blob || item instanceof ArrayBuffer) return item;
      if (isBinary(item)) return restoreBinary(item); // Earlier inline binary snapshots.
      if (Array.isArray(item)) return Promise.all(item.map(unpack));
      if (item && typeof item === "object") {
        if (
          "__proxxiedFile" in item &&
          typeof item.__proxxiedFile === "string"
        ) {
          const key = item.__proxxiedFile;
          if (!key.startsWith(`${name}:file:`))
            throw new Error("An uploaded image reference is invalid.");
          references.add(key);
          if (!loaded.has(key))
            loaded.set(
              key,
              transaction("readonly", (store) => store.get(key)).then(
                (stored: unknown) => {
                  const file = isBinary(stored)
                    ? restoreBinary(stored)
                    : stored;
                  if (
                    "asText" in item &&
                    item.asText === true &&
                    typeof file === "string"
                  ) {
                    textKeys.set(file, key);
                    return file;
                  }
                  if (!(file instanceof Blob))
                    throw new Error("A saved uploaded image is missing.");
                  fileKeys.set(file, key);
                  return file;
                }
              )
            );
          return loaded.get(key);
        }
        return Object.fromEntries(
          await Promise.all(
            Object.entries(item).map(async ([key, value]) => [
              key,
              await unpack(value),
            ])
          )
        );
      }
      return item;
    };
    const result = (await unpack(value)) as StorageValue<S>;
    previousFiles = references;
    return result;
  }

  async function writeSnapshot(name: string, value: StorageValue<S>) {
    const references = new Set<string>(),
      additions = new Map<string, Blob | string>();
    const pack = (item: unknown): unknown => {
      if (typeof item === "string" && item.startsWith("data:image/")) {
        let key = textKeys.get(item);
        if (!key) {
          key = `${name}:file:${crypto.randomUUID()}`;
          textKeys.set(item, key);
        }
        references.add(key);
        if (!previousFiles.has(key)) additions.set(key, item);
        return { __proxxiedFile: key, asText: true };
      }
      if (item instanceof Blob) {
        let key = fileKeys.get(item);
        if (!key) {
          key = `${name}:file:${crypto.randomUUID()}`;
          fileKeys.set(item, key);
        }
        references.add(key);
        if (!previousFiles.has(key)) additions.set(key, item);
        return { __proxxiedFile: key };
      }
      if (Array.isArray(item)) return item.map(pack);
      if (item && typeof item === "object" && !(item instanceof ArrayBuffer))
        return Object.fromEntries(
          Object.entries(item).map(([key, value]) => [key, pack(value)])
        );
      return item;
    };
    const packed = pack(value);
    const commit = async (
      files: Map<string, Blob | BinarySnapshot | string>
    ) => {
      await transaction("readwrite", (store) => {
        if (useStorageStatus.getState().savingDisabled)
          throw new Error("Saving is disabled in this temporary workspace.");
        for (const [key, file] of files) store.put(file, key);
        for (const key of previousFiles)
          if (!references.has(key)) store.delete(key);
        return store.put(packed, name);
      });
    };
    const asBytes = async () => {
      const files = new Map<string, BinarySnapshot | string>();
      // Keep only this transaction's new bytes; no retained ArrayBuffer cache.
      for (const [key, file] of additions)
        files.set(
          key,
          typeof file === "string" ? file : await binarySnapshot(file)
        );
      return files;
    };
    if (useBinarySnapshots) await commit(await asBytes());
    else {
      try {
        await commit(additions);
      } catch (error) {
        if (
          !(error instanceof DOMException) ||
          !["UnknownError", "DataCloneError"].includes(error.name) ||
          !additions.size
        )
          throw error;
        await commit(await asBytes());
        useBinarySnapshots = true;
      }
    }
    previousFiles = references;
    for (const [text, key] of textKeys)
      if (!references.has(key)) textKeys.delete(text);
  }

  return {
    getItem(name) {
      const read = (async () => {
        const epoch = storageEpoch;
        const ensureActive = () => {
          if (
            epoch !== storageEpoch ||
            useStorageStatus.getState().savingDisabled
          )
            throw new Error("Loading stopped for this temporary workspace.");
        };
        const stored = await decode(
          await transaction("readonly", (store) => store.get(name)),
          name
        );
        ensureActive();
        if (stored) return stored;
        for (const key of [name, ...legacyKeys]) {
          const raw =
            key !== name
              ? await transaction("readonly", (store) => store.get(key))
              : null;
          const legacy = await decode(raw ?? localStorage.getItem(key), name);
          ensureActive();
          if (!legacy) continue;
          await writeSnapshot(name, legacy);
          ensureActive();
          if (key !== name && raw != null)
            await transaction("readwrite", (store) => store.delete(key));
          ensureActive();
          localStorage.removeItem(key);
          return legacy;
        }
        return null;
      })();
      readers.add(read);
      void read.then(
        () => readers.delete(read),
        () => readers.delete(read)
      );
      return read;
    },
    setItem(name, value) {
      if (useStorageStatus.getState().savingDisabled) return;
      if (
        lastState &&
        Object.keys(value.state as object).every(
          (key) => value.state[key as keyof S] === lastState![key as keyof S]
        )
      )
        return draining;
      lastState = value.state;
      pending = { name, value };
      if (!draining) {
        useStorageStatus.setState((s) => ({ pending: s.pending + 1 }));
        draining = Promise.resolve().then(async () => {
          try {
            while (pending && !useStorageStatus.getState().savingDisabled) {
              const next = pending;
              pending = undefined;
              try {
                await writeSnapshot(next.name, next.value);
                reportStorageError(`write:${next.name}`);
              } catch (error) {
                lastState = undefined;
                reportStorageError(
                  `write:${next.name}`,
                  `Changes could not be saved in this browser. ${error instanceof Error ? error.message : "Browser storage is unavailable."} Keep this tab open and export your work before reloading. Free device storage, then make another change to retry.`
                );
              }
            }
          } finally {
            pending = undefined;
            draining = undefined;
            useStorageStatus.setState((s) => ({ pending: s.pending - 1 }));
          }
        });
      }
      return draining;
    },
    async removeItem(name) {
      await Promise.allSettled([...readers]);
      await draining;
      const names = [name, ...legacyKeys];
      await transaction("readwrite", (store) => {
        for (const key of names) {
          if (key !== name) store.delete(key);
          const prefix = `${key}:file:`;
          store.delete(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
        }
        return store.delete(name);
      });
      for (const key of names) localStorage.removeItem(key);
      previousFiles.clear();
      textKeys.clear();
      lastState = undefined;
      reportStorageError(`write:${name}`);
    },
  };
}
