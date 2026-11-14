import { beforeAll, beforeEach, expect, it } from "vitest";
import { useSettingsStore } from "./settings";
beforeAll(async () => {
  await useSettingsStore.persist.rehydrate();
});
beforeEach(() => useSettingsStore.getState().resetSettings());
it("fits automatic grids in each orientation without losing portrait capacity", () => {
  useSettingsStore.getState().swapPageOrientation();
  expect([
    useSettingsStore.getState().columns,
    useSettingsStore.getState().rows,
  ]).toEqual([4, 2]);
  useSettingsStore.getState().swapPageOrientation();
  expect([
    useSettingsStore.getState().columns,
    useSettingsStore.getState().rows,
  ]).toEqual([3, 3]);
});
it("restores custom row preferences after a temporary size constraint", () => {
  useSettingsStore.getState().setColumns(2);
  useSettingsStore.getState().swapPageOrientation();
  expect([
    useSettingsStore.getState().columns,
    useSettingsStore.getState().rows,
  ]).toEqual([2, 2]);
  useSettingsStore.getState().swapPageOrientation();
  expect([
    useSettingsStore.getState().columns,
    useSettingsStore.getState().rows,
  ]).toEqual([2, 3]);
});
