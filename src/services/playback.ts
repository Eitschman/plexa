import { randomBytes } from 'node:crypto';
import {
  getPlaybackState,
  upsertPlaybackState,
  deletePlaybackState,
} from '../db/index.js';
import type { PlexTrackSummary } from '../plex/adapter.js';
import { artUrlForTrack, createSignedMediaPath } from '../media/gateway.js';

export interface QueueItem {
  ratingKey: string;
  title: string;
  artist?: string;
  album?: string;
  durationMs?: number;
  thumb?: string;
  streamUrl?: string;
  artUrl?: string;
  /** Opaque Alexa AudioPlayer stream token for this queue occurrence. */
  streamToken: string;
}

export interface PlaybackQueue {
  id: string;
  userId: string;
  deviceId?: string;
  items: QueueItem[];
  currentIndex: number;
  shuffle: boolean;
  /** When true, the queue wraps from last item back to first. */
  loop: boolean;
}

const DEFAULT_SEEK_SECONDS = 30;

function playbackId(userId: string, deviceId?: string): string {
  return deviceId ? `${userId}:${deviceId}` : userId;
}

function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function normalizeQueueItem(item: QueueItem): QueueItem {
  return {
    ...item,
    streamToken: item.streamToken || newStreamToken(),
  };
}

function toQueueItem(track: PlexTrackSummary): QueueItem {
  return {
    ratingKey: track.ratingKey,
    title: track.title,
    artist: track.artist,
    album: track.album,
    durationMs: track.durationMs,
    thumb: track.thumb,
    streamUrl: createSignedMediaPath(track.ratingKey, 'audio'),
    artUrl: artUrlForTrack(track.ratingKey, track.thumb),
    streamToken: newStreamToken(),
  };
}

export function loadQueue(userId: string, deviceId?: string): PlaybackQueue | null {
  const id = playbackId(userId, deviceId);
  const row = getPlaybackState(id);
  if (!row) return null;
  const items = (JSON.parse(row.queue_json) as QueueItem[]).map(normalizeQueueItem);
  return {
    id,
    userId: row.user_id,
    deviceId: row.device_id ?? undefined,
    items,
    currentIndex: row.current_index,
    shuffle: row.shuffle === 1,
    loop: row.loop === 1,
  };
}

export function saveQueue(queue: PlaybackQueue): void {
  upsertPlaybackState({
    id: queue.id,
    user_id: queue.userId,
    device_id: queue.deviceId ?? null,
    queue_json: JSON.stringify(queue.items),
    current_index: queue.currentIndex,
    shuffle: queue.shuffle ? 1 : 0,
    loop: queue.loop ? 1 : 0,
  });
}

export function clearQueue(userId: string, deviceId?: string): void {
  deletePlaybackState(playbackId(userId, deviceId));
}

export function createQueueFromTracks(
  userId: string,
  tracks: PlexTrackSummary[],
  options: { shuffle?: boolean; deviceId?: string; startIndex?: number; loop?: boolean } = {},
): PlaybackQueue {
  const items = options.shuffle ? shuffleArray(tracks.map(toQueueItem)) : tracks.map(toQueueItem);
  const queue: PlaybackQueue = {
    id: playbackId(userId, options.deviceId),
    userId,
    deviceId: options.deviceId,
    items,
    currentIndex: options.startIndex ?? 0,
    shuffle: options.shuffle ?? false,
    loop: options.loop ?? false,
  };
  saveQueue(queue);
  return queue;
}

export function getCurrentTrack(queue: PlaybackQueue): QueueItem | null {
  if (queue.items.length === 0) return null;
  return queue.items[queue.currentIndex] ?? null;
}

export function findQueueItemByToken(queue: PlaybackQueue, token: string): QueueItem | null {
  return queue.items.find((item) => item.streamToken === token) ?? null;
}

export function findQueueIndexByToken(queue: PlaybackQueue, token: string): number {
  return queue.items.findIndex((item) => item.streamToken === token);
}

/** Sync currentIndex to the item matching the Alexa stream token. Returns true if matched. */
export function syncQueueFromToken(queue: PlaybackQueue, token: string): boolean {
  const index = findQueueIndexByToken(queue, token);
  if (index < 0) return false;
  queue.currentIndex = index;
  saveQueue(queue);
  return true;
}

export function getNextTrack(queue: PlaybackQueue): QueueItem | null {
  if (queue.items.length === 0) return null;
  if (queue.currentIndex < queue.items.length - 1) {
    return queue.items[queue.currentIndex + 1] ?? null;
  }
  if (queue.loop) return queue.items[0] ?? null;
  return null;
}

export function getPreviousTrack(queue: PlaybackQueue): QueueItem | null {
  if (queue.items.length === 0) return null;
  if (queue.currentIndex > 0) {
    return queue.items[queue.currentIndex - 1] ?? null;
  }
  if (queue.loop) return queue.items[queue.items.length - 1] ?? null;
  return null;
}

export function advanceQueue(queue: PlaybackQueue): QueueItem | null {
  const next = getNextTrack(queue);
  if (!next) return null;
  if (queue.currentIndex >= queue.items.length - 1) {
    queue.currentIndex = 0;
  } else {
    queue.currentIndex += 1;
  }
  saveQueue(queue);
  return getCurrentTrack(queue);
}

export function previousTrack(queue: PlaybackQueue): QueueItem | null {
  const prev = getPreviousTrack(queue);
  if (!prev) return null;
  if (queue.currentIndex === 0) {
    queue.currentIndex = queue.items.length - 1;
  } else {
    queue.currentIndex -= 1;
  }
  saveQueue(queue);
  return getCurrentTrack(queue);
}

/** Advance index after a track finishes; ignores stale tokens. */
export function advanceIndexOnPlaybackFinished(queue: PlaybackQueue, finishedToken: string): boolean {
  const current = getCurrentTrack(queue);
  if (!current || current.streamToken !== finishedToken) return false;
  const next = getNextTrack(queue);
  if (!next) return false;
  if (queue.currentIndex >= queue.items.length - 1) {
    queue.currentIndex = 0;
  } else {
    queue.currentIndex += 1;
  }
  saveQueue(queue);
  return true;
}

export function setQueueLoop(queue: PlaybackQueue, loop: boolean): void {
  queue.loop = loop;
  saveQueue(queue);
}

export function removeQueueItem(queue: PlaybackQueue, index: number): QueueItem | null {
  if (index < 0 || index >= queue.items.length) return getCurrentTrack(queue);

  const wasCurrent = index === queue.currentIndex;
  queue.items.splice(index, 1);

  if (queue.items.length === 0) {
    clearQueue(queue.userId, queue.deviceId);
    return null;
  }

  if (index < queue.currentIndex) {
    queue.currentIndex -= 1;
  } else if (wasCurrent && queue.currentIndex >= queue.items.length) {
    queue.currentIndex = queue.items.length - 1;
  }

  saveQueue(queue);
  return getCurrentTrack(queue);
}

export function reorderQueueItems(queue: PlaybackQueue, fromIndex: number, toIndex: number): void {
  if (fromIndex === toIndex) return;
  if (fromIndex < 0 || fromIndex >= queue.items.length) return;
  if (toIndex < 0 || toIndex >= queue.items.length) return;

  const currentToken = queue.items[queue.currentIndex]?.streamToken;
  const [moved] = queue.items.splice(fromIndex, 1);
  queue.items.splice(toIndex, 0, moved);

  if (currentToken) {
    const newIndex = queue.items.findIndex((item) => item.streamToken === currentToken);
    if (newIndex >= 0) queue.currentIndex = newIndex;
  }

  saveQueue(queue);
}

export function setQueueShuffle(queue: PlaybackQueue, enabled: boolean): void {
  if (queue.shuffle === enabled) return;
  queue.shuffle = enabled;
  if (enabled && queue.items.length > 1) {
    const current = queue.currentIndex;
    const head = queue.items.slice(0, current + 1);
    const tail = shuffleArray(queue.items.slice(current + 1));
    queue.items = [...head, ...tail];
  }
  saveQueue(queue);
}

export function clampSeekOffset(
  currentMs: number,
  deltaMs: number,
  durationMs?: number,
): number {
  const target = currentMs + deltaMs;
  const max = durationMs && durationMs > 0 ? durationMs : undefined;
  if (max !== undefined) return Math.max(0, Math.min(target, max));
  return Math.max(0, target);
}

export function parseSeekSeconds(slotValue: string | undefined, defaultSeconds = DEFAULT_SEEK_SECONDS): number {
  if (!slotValue) return defaultSeconds;
  const parsed = Number.parseInt(slotValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultSeconds;
  return parsed;
}

export function normalizeSpokenName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^(ask|tell)\s+\w+(\s+\w+)?\s+to\s+/i, '')
    .replace(/^(play|start|mix|shuffle)\s+/i, '')
    .replace(/^(the|my)\s+/i, '')
    .replace(/\s+(playlist|album|song|track)$/i, '')
    .trim();
}

export function bestMatch<T extends { title: string }>(query: string, items: T[]): T | null {
  const q = normalizeSpokenName(query);

  if (!q) return null;
  const exact = items.find((i) => i.title.toLowerCase() === q);
  const contains = items.filter((i) => i.title.toLowerCase().includes(q));
  const reverseContains = items.filter((i) => q.includes(i.title.toLowerCase()));

  if (exact) return exact;
  if (contains.length === 1) return contains[0];
  if (reverseContains.length === 1) return reverseContains[0];
  return null;
}

export function newStreamToken(): string {
  return randomBytes(8).toString('hex');
}
