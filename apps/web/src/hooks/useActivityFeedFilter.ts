import { useSyncExternalStore } from "react";

export type ActivityFeedFilter = "all" | "activity" | "comments";

const DEFAULT_ACTIVITY_FEED_FILTER: ActivityFeedFilter = "all";
const STORAGE_KEY = "kan_activity-feed-filter";
const CHANGE_EVENT = `${STORAGE_KEY}-change`;

const isActivityFeedFilter = (
  value: string | null,
): value is ActivityFeedFilter =>
  value === "all" || value === "activity" || value === "comments";

const getSnapshot = (): ActivityFeedFilter => {
  try {
    const storedFilter = localStorage.getItem(STORAGE_KEY);
    return isActivityFeedFilter(storedFilter)
      ? storedFilter
      : DEFAULT_ACTIVITY_FEED_FILTER;
  } catch {
    return DEFAULT_ACTIVITY_FEED_FILTER;
  }
};

export const setActivityFeedFilter = (filter: ActivityFeedFilter) => {
  try {
    localStorage.setItem(STORAGE_KEY, filter);
  } catch {
    // The hook falls back to the default when storage is unavailable.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
};

const subscribe = (onStoreChange: () => void) => {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) onStoreChange();
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(CHANGE_EVENT, onStoreChange);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
  };
};

export const useActivityFeedFilter = () =>
  useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => DEFAULT_ACTIVITY_FEED_FILTER,
  );
