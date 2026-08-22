import { writable } from "svelte/store";
import type { DatabaseLoadProgress } from "./runtime";

export type DatabaseLoadingState = { visible: false } | ({ visible: true } & DatabaseLoadProgress);

const state = writable<DatabaseLoadingState>({ visible: false });

export const databaseLoading = {
  subscribe: state.subscribe,
  report: (progress: DatabaseLoadProgress): void => state.set({ visible: true, ...progress }),
  finish: (): void => state.set({ visible: false }),
};

export const formatBytes = (bytes: number): string => {
  const mebibytes = bytes / (1024 * 1024);
  return mebibytes >= 0.1 ? `${mebibytes.toFixed(1)} MiB` : `${Math.round(bytes / 1024)} KiB`;
};
