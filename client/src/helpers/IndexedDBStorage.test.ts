import { expect, it, vi } from "vitest";
import {
  continueWithoutSaving,
  createIndexedDBStorage,
  useStorageStatus,
} from "./IndexedDBStorage";

async function openStorage() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("proxxied-storage", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("zustand-store");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

it("migrates v6 to the active key without deleting layout settings", async () => {
  localStorage.setItem(
    "legacy-cards",
    JSON.stringify({ state: { cards: ["Sol Ring"] }, version: 6 })
  );
  localStorage.setItem("proxxied:layout-settings:v2", "keep");
  const storage = createIndexedDBStorage(["legacy-cards"]);
  expect(await storage.getItem("active-cards")).toEqual({
    state: { cards: ["Sol Ring"] },
    version: 6,
  });
  expect(localStorage.getItem("legacy-cards")).toBeNull();
  expect(localStorage.getItem("proxxied:layout-settings:v2")).toBe("keep");
  expect(await storage.getItem("active-cards")).not.toBeNull();
});

it("falls back to exact binary snapshots when WebKit cannot store files", async () => {
  const put = IDBObjectStore.prototype.put;
  const mock = vi
    .spyOn(IDBObjectStore.prototype, "put")
    .mockImplementation(function (this: IDBObjectStore, value, key) {
      if (value instanceof Blob)
        throw new DOMException("Blob storage unavailable", "UnknownError");
      return put.call(this, value, key);
    });
  try {
    const storage = createIndexedDBStorage<{ file: File }>();
    await storage.setItem("binary-fallback", {
      state: {
        file: new File(["exact bytes"], "original.png", {
          type: "image/png",
          lastModified: 42,
        }),
      },
      version: 8,
    });
    const saved = await storage.getItem("binary-fallback");
    expect(await saved?.state.file.text()).toBe("exact bytes");
    expect(saved?.state.file.name).toBe("original.png");
    expect(saved?.state.file.lastModified).toBe(42);
    expect(saved?.state.file.type).toBe("image/png");
    await storage.removeItem("binary-fallback");
  } finally {
    mock.mockRestore();
  }
});
it("keeps binary uploads in a structured snapshot", async () => {
  const storage = createIndexedDBStorage<{ file: Blob }>();
  await storage.setItem("binary-test", {
    state: { file: new Blob(["image bytes"], { type: "image/png" }) },
    version: 8,
  });
  const saved = await storage.getItem("binary-test");
  expect(await saved?.state.file.text()).toBe("image bytes");
  expect(saved?.state.file.type).toBe("image/png");
  await storage.removeItem("binary-test");
  expect(await storage.getItem("binary-test")).toBeNull();
});

it("writes each original once, coalesces rapid edits and removes unused records", async () => {
  const storage = createIndexedDBStorage<{
    file?: File;
    order: number;
    back?: string;
  }>();
  const file = new File(["original bytes"], "card.png", { type: "image/png" });
  const image = "data:image/png;base64,AQID";
  const put = vi.spyOn(IDBObjectStore.prototype, "put");
  try {
    await storage.setItem("efficient", {
      state: { file, back: image, order: 0 },
      version: 1,
    });
    await Promise.all(
      Array.from({ length: 100 }, (_, order) =>
        storage.setItem("efficient", {
          state: { file, back: image, order },
          version: 1,
        })
      )
    );
    expect(
      put.mock.calls.filter(([, key]) =>
        String(key).startsWith("efficient:file:")
      )
    ).toHaveLength(2);
    expect(
      put.mock.calls.filter(([, key]) => key === "efficient")
    ).toHaveLength(2);
    const saved = await storage.getItem("efficient");
    expect(saved?.state.order).toBe(99);
    expect(saved?.state.back).toBe(image);
    expect(await saved?.state.file?.text()).toBe("original bytes");
    const remove = vi.spyOn(IDBObjectStore.prototype, "delete");
    await storage.setItem("efficient", { state: { order: 100 }, version: 1 });
    expect(
      remove.mock.calls.filter(([key]) =>
        String(key).startsWith("efficient:file:")
      )
    ).toHaveLength(2);
    remove.mockRestore();
    await storage.removeItem("efficient");
  } finally {
    put.mockRestore();
  }
});

it("keeps the previous snapshot and originals intact if a replacement save fails", async () => {
  const storage = createIndexedDBStorage<{ file: File; order: number }>();
  await storage.setItem("atomic", {
    state: { file: new File(["kept"], "kept.png"), order: 1 },
    version: 1,
  });
  const originalPut = IDBObjectStore.prototype.put;
  const failure = vi
    .spyOn(IDBObjectStore.prototype, "put")
    .mockImplementation(function (this: IDBObjectStore, value, key) {
      if (key === "atomic")
        throw new DOMException("Device full", "QuotaExceededError");
      return originalPut.call(this, value, key);
    });
  try {
    await storage.setItem("atomic", {
      state: { file: new File(["replacement"], "new.png"), order: 2 },
      version: 1,
    });
  } finally {
    failure.mockRestore();
  }
  const saved = await storage.getItem("atomic");
  expect(saved?.state.order).toBe(1);
  expect(await saved?.state.file.text()).toBe("kept");
  await storage.removeItem("atomic");
});

it("keeps legacy data when a temporary session interrupts WebKit migration", async () => {
  const db = await openStorage();
  const storage = createIndexedDBStorage(["migration-race-legacy"]);
  const legacy = {
    state: {
      file: {
        __proxxiedBinary: 1,
        bytes: new TextEncoder().encode("original").buffer,
        type: "image/png",
        name: "original.png",
      },
    },
    version: 6,
  };
  await requestResult(
    db
      .transaction("zustand-store", "readwrite")
      .objectStore("zustand-store")
      .put(legacy, "migration-race-legacy")
  );
  localStorage.setItem("migration-race-legacy", "kept backup");
  let started!: () => void, release!: () => void;
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const originalRead = Blob.prototype.arrayBuffer;
  const read = vi
    .spyOn(Blob.prototype, "arrayBuffer")
    .mockImplementation(async function (this: Blob) {
      started();
      await hold;
      return originalRead.call(this);
    });
  const originalPut = IDBObjectStore.prototype.put;
  const put = vi
    .spyOn(IDBObjectStore.prototype, "put")
    .mockImplementation(function (this: IDBObjectStore, value, key) {
      if (value instanceof Blob)
        throw new DOMException("Blob storage unavailable", "UnknownError");
      return originalPut.call(this, value, key);
    });
  const migration = Promise.resolve(storage.getItem("migration-race"));
  const rejected = expect(migration).rejects.toThrow(/temporary workspace/);
  try {
    await reading;
    continueWithoutSaving();
    release();
    await rejected;
    const records = db
      .transaction("zustand-store")
      .objectStore("zustand-store");
    expect(await requestResult(records.get("migration-race-legacy"))).toEqual(
      legacy
    );
    expect(localStorage.getItem("migration-race-legacy")).toBe("kept backup");
    expect(
      await requestResult(
        db
          .transaction("zustand-store")
          .objectStore("zustand-store")
          .get("migration-race")
      )
    ).toBeUndefined();
  } finally {
    release();
    await migration.catch(() => {});
    read.mockRestore();
    put.mockRestore();
    useStorageStatus.setState({ savingDisabled: false });
    await storage.removeItem("migration-race");
    db.close();
  }
});

it("reset removes a concurrent original atomically without deleting neighboring keys", async () => {
  const db = await openStorage();
  const storage = createIndexedDBStorage<{ file: Blob }>(["reset-race-legacy"]);
  await storage.setItem("reset-race", {
    state: { file: new Blob(["old"]) },
    version: 1,
  });
  const seed = db
    .transaction("zustand-store", "readwrite")
    .objectStore("zustand-store");
  seed.put("orphan", "reset-race-legacy:file:old");
  await requestResult(seed.put("keep", "reset-race:fileable"));
  const originalTransaction = IDBDatabase.prototype.transaction;
  let inject = true;
  const transaction = vi
    .spyOn(IDBDatabase.prototype, "transaction")
    .mockImplementation(function (this: IDBDatabase, names, mode, options) {
      if (mode === "readwrite" && inject) {
        inject = false;
        // A competing write queues immediately before the deletion transaction.
        originalTransaction
          .call(this, names, mode, options)
          .objectStore("zustand-store")
          .put("new original", "reset-race:file:late");
      }
      return originalTransaction.call(this, names, mode, options);
    });
  try {
    await storage.removeItem("reset-race");
  } finally {
    transaction.mockRestore();
  }
  try {
    const keys = await requestResult(
      db.transaction("zustand-store").objectStore("zustand-store").getAllKeys()
    );
    expect(keys.filter((key) => String(key).startsWith("reset-race"))).toEqual([
      "reset-race:fileable",
    ]);
  } finally {
    await requestResult(
      db
        .transaction("zustand-store", "readwrite")
        .objectStore("zustand-store")
        .delete("reset-race:fileable")
    );
    db.close();
  }
});
