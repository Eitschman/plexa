import { describe, it, expect, beforeEach } from 'vitest';
import {
  advanceIndexOnPlaybackFinished,
  advanceQueue,
  clampSeekOffset,
  clearQueue,
  createQueueFromTracks,
  getCurrentTrack,
  getNextTrack,
  getPreviousTrack,
  loadQueue,
  parseSeekPosition,
  parseSeekSeconds,
  previousTrack,
  removeQueueItem,
  reorderQueueItems,
  setQueueLoop,
  setQueueShuffle,
  syncQueueFromToken,
} from '../src/services/playback.js';
import { closeDb } from '../src/db/index.js';
import { resetEnvForTests } from '../src/config/index.js';

const tracks = [
  { ratingKey: '1', title: 'A', durationMs: 180000 },
  { ratingKey: '2', title: 'B', durationMs: 200000 },
  { ratingKey: '3', title: 'C', durationMs: 220000 },
];

describe('playback queue', () => {
  beforeEach(() => {
    delete process.env.PUBLIC_URL;
    resetEnvForTests();
    closeDb();
  });

  it('preserves shuffle order', () => {
    const queue = createQueueFromTracks('user', tracks, { shuffle: true });
    const keys = queue.items.map((i) => i.ratingKey).join(',');
    const original = tracks.map((t) => t.ratingKey).join(',');
    expect(keys.split(',').sort().join(',')).toBe(original.split(',').sort().join(','));
  });

  it('uses relative same-origin media paths for queue items', () => {
    const queue = createQueueFromTracks(
      'user',
      [{ ratingKey: '42', title: 'Song', thumb: '/library/metadata/42/thumb/0' }],
    );

    expect(queue.items[0].streamUrl).toMatch(/^\/media\/.+\..+$/);
    expect(queue.items[0].artUrl).toMatch(/^\/artwork\/.+\..+$/);
    expect(queue.items[0].streamToken).toMatch(/^[a-f0-9]{16}$/);
  });

  it('omits artUrl when track has no thumb', () => {
    const queue = createQueueFromTracks('user', [{ ratingKey: '42', title: 'Song' }]);
    expect(queue.items[0].streamUrl).toMatch(/^\/media\/.+\..+$/);
    expect(queue.items[0].artUrl).toBeUndefined();
  });

  it('embeds the plex thumb path in signed artwork tokens', () => {
    const thumb = '/library/metadata/42/thumb/123';
    const queue = createQueueFromTracks('user', [{ ratingKey: '42', title: 'Song', thumb }]);
    const match = queue.items[0].artUrl!.match(/^\/artwork\/(.+)\.(.+)$/);
    expect(match).toBeTruthy();
    const encoded = match![1];
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
      thumb?: string;
      kind: string;
    };
    expect(payload.kind).toBe('artwork');
    expect(payload.thumb).toBe(thumb);
  });

  it('does not wrap next/previous at queue boundaries by default', () => {
    const queue = createQueueFromTracks('user', tracks, { loop: false });
    expect(getNextTrack(queue)?.ratingKey).toBe('2');
    expect(advanceQueue(queue)?.ratingKey).toBe('2');
    queue.currentIndex = tracks.length - 1;
    expect(getNextTrack(queue)).toBeNull();
    expect(advanceQueue(queue)).toBeNull();

    queue.currentIndex = 0;
    expect(getPreviousTrack(queue)).toBeNull();
    expect(previousTrack(queue)).toBeNull();
  });

  it('wraps next/previous when loop mode is enabled', () => {
    const queue = createQueueFromTracks('user', tracks, { loop: true });
    queue.currentIndex = tracks.length - 1;
    expect(getNextTrack(queue)?.ratingKey).toBe('1');
    expect(advanceQueue(queue)?.ratingKey).toBe('1');

    queue.currentIndex = 0;
    expect(getPreviousTrack(queue)?.ratingKey).toBe('3');
    expect(previousTrack(queue)?.ratingKey).toBe('3');
  });

  it('persists loop mode in the database', () => {
    const queue = createQueueFromTracks('user', tracks);
    setQueueLoop(queue, true);
    const reloaded = loadQueue('user');
    expect(reloaded?.loop).toBe(true);
  });

  it('assigns unique stream tokens per queue item', () => {
    const queue = createQueueFromTracks('user', [
      { ratingKey: '1', title: 'A' },
      { ratingKey: '1', title: 'A duplicate' },
    ]);
    expect(queue.items[0].streamToken).not.toBe(queue.items[1].streamToken);
  });

  it('syncs queue position from alexa stream token', () => {
    const queue = createQueueFromTracks('user', tracks);
    const token = queue.items[2].streamToken;
    expect(syncQueueFromToken(queue, token)).toBe(true);
    expect(getCurrentTrack(queue)?.ratingKey).toBe('3');
  });

  it('ignores stale playback finished tokens', () => {
    const queue = createQueueFromTracks('user', tracks);
    const stale = 'not-a-real-token';
    expect(advanceIndexOnPlaybackFinished(queue, stale)).toBe(false);
    expect(queue.currentIndex).toBe(0);
  });

  it('advances index on playback finished for the active token', () => {
    const queue = createQueueFromTracks('user', tracks);
    const current = getCurrentTrack(queue)!;
    expect(advanceIndexOnPlaybackFinished(queue, current.streamToken)).toBe(true);
    expect(getCurrentTrack(queue)?.ratingKey).toBe('2');
  });

  it('does not advance on playback finished at queue end without loop', () => {
    const queue = createQueueFromTracks('user', tracks, { loop: false });
    queue.currentIndex = tracks.length - 1;
    const current = getCurrentTrack(queue)!;
    expect(advanceIndexOnPlaybackFinished(queue, current.streamToken)).toBe(false);
    expect(queue.currentIndex).toBe(tracks.length - 1);
  });

  it('clamps seek offsets to track duration', () => {
    expect(clampSeekOffset(60000, 30000, 90000)).toBe(90000);
    expect(clampSeekOffset(10000, -20000, 90000)).toBe(0);
    expect(clampSeekOffset(50000, 10000, 90000)).toBe(60000);
  });

  it('defaults seek seconds and rejects invalid values', () => {
    expect(parseSeekSeconds(undefined)).toBe(30);
    expect(parseSeekSeconds('15')).toBe(15);
    expect(parseSeekSeconds('abc')).toBe(30);
    expect(parseSeekSeconds('-5')).toBe(30);
  });

  it('parses absolute seek positions and clamps them to track duration', () => {
    expect(parseSeekPosition('2', undefined)).toBe(120000);
    expect(parseSeekPosition(undefined, '45')).toBe(45000);
    expect(parseSeekPosition('1', '30')).toBe(90000);
    expect(parseSeekPosition(undefined, undefined)).toBeNull();
    expect(parseSeekPosition('5', '0', 180000)).toBe(180000);
  });

  it('removes a track before the current index', () => {
    const queue = createQueueFromTracks('user', tracks);
    queue.currentIndex = 2;
    removeQueueItem(queue, 0);
    expect(queue.items.map((i) => i.ratingKey)).toEqual(['2', '3']);
    expect(queue.currentIndex).toBe(1);
    expect(getCurrentTrack(queue)?.ratingKey).toBe('3');
  });

  it('removes the current track and advances to the next item', () => {
    const queue = createQueueFromTracks('user', tracks);
    removeQueueItem(queue, 0);
    expect(queue.items.map((i) => i.ratingKey)).toEqual(['2', '3']);
    expect(queue.currentIndex).toBe(0);
    expect(getCurrentTrack(queue)?.ratingKey).toBe('2');
  });

  it('removes the last track while current and moves to previous', () => {
    const queue = createQueueFromTracks('user', tracks);
    queue.currentIndex = 2;
    removeQueueItem(queue, 2);
    expect(queue.items.map((i) => i.ratingKey)).toEqual(['1', '2']);
    expect(queue.currentIndex).toBe(1);
    expect(getCurrentTrack(queue)?.ratingKey).toBe('2');
  });

  it('clears the queue when removing the only track', () => {
    const queue = createQueueFromTracks('user', [tracks[0]]);
    removeQueueItem(queue, 0);
    expect(loadQueue('user')).toBeNull();
  });

  it('reorders items while keeping the current track in sync', () => {
    const queue = createQueueFromTracks('user', tracks);
    queue.currentIndex = 1;
    const currentToken = queue.items[1].streamToken;
    reorderQueueItems(queue, 1, 0);
    expect(queue.items[0].streamToken).toBe(currentToken);
    expect(queue.currentIndex).toBe(0);
    expect(getCurrentTrack(queue)?.ratingKey).toBe('2');
  });

  it('toggles shuffle and reshuffles upcoming tracks only', () => {
    const queue = createQueueFromTracks('user', tracks, { shuffle: false });
    queue.currentIndex = 0;
    const currentToken = queue.items[0].streamToken;
    setQueueShuffle(queue, true);
    expect(queue.shuffle).toBe(true);
    expect(queue.items[0].streamToken).toBe(currentToken);
    expect(queue.items.slice(1).map((i) => i.ratingKey).sort().join(',')).toBe('2,3');
  });

  it('clears queue via clearQueue helper', () => {
    createQueueFromTracks('user', tracks);
    clearQueue('user');
    expect(loadQueue('user')).toBeNull();
  });
});
