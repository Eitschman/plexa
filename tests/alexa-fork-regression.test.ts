import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestEnvelope } from 'ask-sdk-model';
import { buildAlexaSkill } from '../src/alexa/handlers.js';
import { closeDb } from '../src/db/index.js';
import { plexAdapter } from '../src/plex/adapter.js';
import { clearQueue, createQueueFromTracks, loadQueue } from '../src/services/playback.js';

vi.mock('../src/services/settings.js', () => ({
  getPlexCredentials: () => ({ url: 'http://plex.test:32400', token: 'test-token' }),
  getPublicSettings: () => ({ musicLibraryId: '1', invocationName: 'plexa', locale: 'de-DE' }),
  getPublicBaseUrl: () => 'https://plexa.example.com',
  getAlexaSkillId: () => null,
}));

vi.mock('../src/plex/adapter.js', async () => {
  const actual = await vi.importActual<typeof import('../src/plex/adapter.js')>('../src/plex/adapter.js');
  return {
    ...actual,
    plexAdapter: {
      connect: vi.fn(),
      searchMusic: vi.fn(),
      listPlaylists: vi.fn(),
      getPlaylistTracks: vi.fn(),
      getArtistTracks: vi.fn(),
      getAlbumTracks: vi.fn(),
    },
  };
});

const tracks = [
  { ratingKey: 'track-1', title: 'Gunman', artist: 'Orden Ogan', durationMs: 180000 },
  { ratingKey: 'track-2', title: 'Final Days', artist: 'Orden Ogan', durationMs: 240000 },
];

function request(name: string, values: Record<string, string> = {}, offsetMs = 0): RequestEnvelope {
  return {
    version: '1.0',
    session: {
      new: true,
      sessionId: 'fork-session',
      application: { applicationId: 'amzn1.ask.skill.fork-test' },
      user: { userId: 'fork-user' },
    },
    context: {
      System: {
        application: { applicationId: 'amzn1.ask.skill.fork-test' },
        user: { userId: 'fork-user' },
        device: { deviceId: 'fork-device' },
      },
      AudioPlayer: { playerActivity: 'PLAYING', offsetInMilliseconds: offsetMs },
    },
    request: {
      type: 'IntentRequest',
      requestId: 'fork-request',
      timestamp: new Date().toISOString(),
      locale: 'de-DE',
      intent: {
        name,
        confirmationStatus: 'NONE',
        slots: Object.fromEntries(Object.entries(values).map(([key, value]) => [
          key, { name: key, value, confirmationStatus: 'NONE' },
        ])),
      },
    },
  } as RequestEnvelope;
}

describe('German fork handler regressions', () => {
  beforeEach(() => {
    closeDb();
    vi.resetAllMocks();
    vi.mocked(plexAdapter.connect).mockResolvedValue({ name: 'Test Plex' });
    vi.mocked(plexAdapter.listPlaylists).mockResolvedValue([{ ratingKey: 'pl-1', title: 'Orden Ogan' }]);
    vi.mocked(plexAdapter.searchMusic).mockResolvedValue({
      artists: [{ ratingKey: 'artist-1', title: 'Orden Ogan' }],
      albums: [{ ratingKey: 'album-1', title: 'Orden Ogan' }],
      tracks: [{ ...tracks[0], title: 'Orden Ogan' }],
      playlists: [],
    });
    vi.mocked(plexAdapter.getPlaylistTracks).mockResolvedValue(tracks);
    vi.mocked(plexAdapter.getArtistTracks).mockResolvedValue(tracks);
    vi.mocked(plexAdapter.getAlbumTracks).mockResolvedValue(tracks);
  });

  afterEach(() => {
    clearQueue('fork-user', 'fork-device');
    closeDb();
  });

  it.each([
    ['PlayPlaylistIntent', 'playlist', false],
    ['ShufflePlaylistIntent', 'playlist', true],
    ['PlayArtistIntent', 'artist', false],
    ['ShuffleArtistIntent', 'artist', true],
    ['PlayAlbumIntent', 'album', false],
    ['ShuffleAlbumIntent', 'album', true],
    ['PlayTrackIntent', 'track', false],
  ] as const)('plays a fuzzy German match through %s', async (intent, slot, shuffle) => {
    const response = await buildAlexaSkill().invoke(request(intent, { [slot]: 'Orden Organ' }));
    expect(response.response.directives?.[0]).toMatchObject({
      type: 'AudioPlayer.Play', playBehavior: 'REPLACE_ALL',
      audioItem: { stream: { url: expect.stringContaining('https://plexa.example.com/media/') } },
    });
    expect(loadQueue('fork-user', 'fork-device')?.shuffle).toBe(shuffle);
  });

  it('returns a German not-found response for ambiguous fuzzy matches', async () => {
    vi.mocked(plexAdapter.searchMusic).mockResolvedValue({
      artists: [{ ratingKey: 'a', title: 'Orden Ogan' }, { ratingKey: 'b', title: 'Orden Oran' }],
      albums: [], tracks: [], playlists: [],
    });
    const response = await buildAlexaSkill().invoke(request('PlayArtistIntent', { artist: 'Orden Organ' }));
    expect(response.response.outputSpeech).toMatchObject({ type: 'PlainText', text: 'Ich konnte Orden Organ nicht finden.' });
    expect(response.response.directives).toBeUndefined();
    expect(plexAdapter.getArtistTracks).not.toHaveBeenCalled();
  });

  it.each([
    ['SeekForwardIntent', { seconds: '30' }, 90000],
    ['SeekBackwardIntent', { seconds: '15' }, 45000],
    ['SeekToIntent', { minutes: '2' }, 120000],
    ['AMAZON.StartOverIntent', {}, 0],
  ] as const)('keeps the active track and seek offset for %s', async (intent, slots, offset) => {
    const queue = createQueueFromTracks('fork-user', tracks, { deviceId: 'fork-device' });
    const response = await buildAlexaSkill().invoke(request(intent, slots, 60000));
    expect(response.response.directives?.[0]).toMatchObject({
      type: 'AudioPlayer.Play',
      audioItem: { stream: { token: queue.items[0].streamToken, offsetInMilliseconds: offset } },
    });
  });

  it('preserves loop, next, previous, pause, resume and stop', async () => {
    const queue = createQueueFromTracks('fork-user', tracks, { deviceId: 'fork-device' });
    const skill = buildAlexaSkill();
    await skill.invoke(request('AMAZON.LoopOnIntent'));
    expect(loadQueue('fork-user', 'fork-device')?.loop).toBe(true);
    await skill.invoke(request('AMAZON.NextIntent'));
    expect(loadQueue('fork-user', 'fork-device')?.currentIndex).toBe(1);
    await skill.invoke(request('AMAZON.PreviousIntent'));
    expect(loadQueue('fork-user', 'fork-device')?.currentIndex).toBe(0);
    const paused = await skill.invoke(request('AMAZON.PauseIntent'));
    expect(paused.response.directives?.[0]).toMatchObject({ type: 'AudioPlayer.Stop' });
    const resumed = await skill.invoke(request('AMAZON.ResumeIntent', {}, 45000));
    expect(resumed.response.directives?.[0]).toMatchObject({
      type: 'AudioPlayer.Play',
      audioItem: { stream: { token: queue.items[0].streamToken, offsetInMilliseconds: 45000 } },
    });
    await skill.invoke(request('AMAZON.LoopOffIntent'));
    expect(loadQueue('fork-user', 'fork-device')?.loop).toBe(false);
    await skill.invoke(request('AMAZON.StopIntent'));
    expect(loadQueue('fork-user', 'fork-device')).toBeNull();
  });
});
