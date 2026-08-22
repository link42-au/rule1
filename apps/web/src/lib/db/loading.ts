import { writable } from "svelte/store";
import type { DatabaseLoadProgress } from "./runtime";

export type DatabaseLoadingState = { visible: false } | ({ visible: true } & DatabaseLoadProgress);

const state = writable<DatabaseLoadingState>({ visible: false });
let activeGeneration = 0;

export const databaseLoading = {
  subscribe: state.subscribe,
  begin: (): number => {
    activeGeneration += 1;
    state.set({ visible: true, stage: "opening" });
    return activeGeneration;
  },
  report: (generation: number, progress: DatabaseLoadProgress): void => {
    if (generation === activeGeneration) state.set({ visible: true, ...progress });
  },
  finish: (generation: number): void => {
    if (generation === activeGeneration) state.set({ visible: false });
  },
};

export const formatBytes = (bytes: number): string => {
  const mebibytes = bytes / (1024 * 1024);
  return mebibytes >= 0.1 ? `${mebibytes.toFixed(1)} MiB` : `${Math.round(bytes / 1024)} KiB`;
};
