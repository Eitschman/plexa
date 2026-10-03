import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchAlexaEventsAfter,
  fetchAlexaEventsPage,
  type AlexaEventItem,
  type PageResult,
} from '../lib/api';

export interface FetchAlexaEventsPageArgs {
  start: number;
  size: number;
  signal: AbortSignal;
}

export interface FetchAlexaEventsAfterArgs {
  afterId: number;
  size: number;
  signal: AbortSignal;
}

export interface UseInfiniteAlexaEventsOptions {
  fetchPage?: (args: FetchAlexaEventsPageArgs) => Promise<PageResult<AlexaEventItem>>;
  fetchAfter?: (args: FetchAlexaEventsAfterArgs) => Promise<PageResult<AlexaEventItem>>;
  pageSize?: number;
  pollBatchSize?: number;
  pollIntervalMs?: number;
  pollingEnabled?: boolean;
  enabled?: boolean;
  onNewItemsPrepended?: (count: number) => void;
}

export interface InfiniteAlexaEventsState {
  items: AlexaEventItem[];
  loading: boolean;
  loadingMore: boolean;
  error: string;
  hasMore: boolean;
  nextStart: number;
  loadMore: () => void;
  retry: () => void;
}

function dedupeById(existing: AlexaEventItem[], incoming: AlexaEventItem[]): AlexaEventItem[] {
  const seen = new Set(existing.map((item) => item.id));
  const merged = [...existing];
  for (const item of incoming) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }
  return merged;
}

export function prependNewById(
  existing: AlexaEventItem[],
  incoming: AlexaEventItem[],
): { items: AlexaEventItem[]; addedCount: number } {
  if (incoming.length === 0) return { items: existing, addedCount: 0 };
  const seen = new Set(existing.map((item) => item.id));
  const fresh = incoming.filter((item) => !seen.has(item.id));
  if (fresh.length === 0) return { items: existing, addedCount: 0 };
  return { items: [...fresh, ...existing], addedCount: fresh.length };
}

export function useInfiniteAlexaEvents({
  fetchPage = ({ start, size, signal }) => fetchAlexaEventsPage(start, size, signal),
  fetchAfter = ({ afterId, size, signal }) => fetchAlexaEventsAfter(afterId, size, signal),
  pageSize = 50,
  pollBatchSize = 20,
  pollIntervalMs = 30_000,
  pollingEnabled = true,
  enabled = true,
  onNewItemsPrepended,
}: UseInfiniteAlexaEventsOptions = {}): InfiniteAlexaEventsState {
  const [items, setItems] = useState<AlexaEventItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [nextStart, setNextStart] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);
  const pollInFlightRef = useRef(false);
  const nextStartRef = useRef(0);
  const hasMoreRef = useRef(false);
  const itemsRef = useRef<AlexaEventItem[]>([]);
  const fetchPageRef = useRef(fetchPage);
  const fetchAfterRef = useRef(fetchAfter);
  const onNewItemsPrependedRef = useRef(onNewItemsPrepended);

  fetchPageRef.current = fetchPage;
  fetchAfterRef.current = fetchAfter;
  onNewItemsPrependedRef.current = onNewItemsPrepended;

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    nextStartRef.current = nextStart;
  }, [nextStart]);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  const runFetch = useCallback(async (start: number, append: boolean) => {
    if (!enabled) return;
    if (inFlightRef.current) return;
    if (append && !hasMoreRef.current) return;

    inFlightRef.current = true;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (append) setLoadingMore(true);
    else setLoading(true);
    setError('');

    try {
      const page = await fetchPageRef.current({
        start,
        size: pageSize,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;

      setItems((prev) => {
        const merged = append ? dedupeById(prev, page.items) : dedupeById([], page.items);
        itemsRef.current = merged;
        return merged;
      });
      setNextStart(page.nextStart);
      nextStartRef.current = page.nextStart;
      setHasMore(page.hasMore);
      hasMoreRef.current = page.hasMore;
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : 'Request failed';
      if ((err as Error).name === 'AbortError' || message === 'AbortError' || message === 'The operation was aborted.') {
        return;
      }
      setError(message);
      if (!append) {
        setItems([]);
        itemsRef.current = [];
        setNextStart(0);
        nextStartRef.current = 0;
        setHasMore(false);
        hasMoreRef.current = false;
      }
    } finally {
      if (abortRef.current === controller && !controller.signal.aborted) {
        setLoading(false);
        setLoadingMore(false);
        inFlightRef.current = false;
      }
    }
  }, [enabled, pageSize]);

  const runPoll = useCallback(async () => {
    if (!enabled || !pollingEnabled) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (pollInFlightRef.current) return;

    const newestId = itemsRef.current[0]?.id;
    if (newestId === undefined) return;

    pollInFlightRef.current = true;
    pollAbortRef.current?.abort();
    const controller = new AbortController();
    pollAbortRef.current = controller;

    try {
      const page = await fetchAfterRef.current({
        afterId: newestId,
        size: pollBatchSize,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;

      setItems((prev) => {
        const { items: merged, addedCount } = prependNewById(prev, page.items);
        if (addedCount === 0) return prev;
        itemsRef.current = merged;
        onNewItemsPrependedRef.current?.(addedCount);
        return merged;
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : 'Request failed';
      if ((err as Error).name === 'AbortError' || message === 'AbortError' || message === 'The operation was aborted.') {
        return;
      }
    } finally {
      if (pollAbortRef.current === controller) {
        pollInFlightRef.current = false;
      }
    }
  }, [enabled, pollBatchSize, pollingEnabled]);

  useEffect(() => {
    abortRef.current?.abort();
    pollAbortRef.current?.abort();
    inFlightRef.current = false;
    pollInFlightRef.current = false;
    setItems([]);
    itemsRef.current = [];
    setNextStart(0);
    nextStartRef.current = 0;
    setHasMore(false);
    hasMoreRef.current = false;
    setError('');
    setLoadingMore(false);

    if (!enabled) {
      setLoading(false);
      return;
    }

    void runFetch(0, false);

    return () => {
      abortRef.current?.abort();
      pollAbortRef.current?.abort();
      inFlightRef.current = false;
      pollInFlightRef.current = false;
    };
  }, [enabled, runFetch]);

  useEffect(() => {
    if (!enabled || !pollingEnabled || pollIntervalMs <= 0) return;

    const tick = () => {
      void runPoll();
    };

    const intervalId = window.setInterval(tick, pollIntervalMs);
    const onVisibilityChange = () => {
      if (!document.hidden) {
        void runPoll();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      pollAbortRef.current?.abort();
      pollInFlightRef.current = false;
    };
  }, [enabled, pollIntervalMs, pollingEnabled, runPoll]);

  const loadMore = useCallback(() => {
    void runFetch(nextStartRef.current, true);
  }, [runFetch]);

  const retry = useCallback(() => {
    if (itemsRef.current.length === 0) {
      void runFetch(0, false);
      return;
    }
    void runFetch(nextStartRef.current, true);
  }, [runFetch]);

  return {
    items,
    loading,
    loadingMore,
    error,
    hasMore,
    nextStart,
    loadMore,
    retry,
  };
}
