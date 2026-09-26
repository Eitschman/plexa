import { describe, expect, it } from 'vitest';
import { PlexAdapter } from '../src/plex/adapter.js';

function adapterWithCreds(): PlexAdapter {
  const adapter = new PlexAdapter();
  (adapter as unknown as { baseUrl: string; token: string }).baseUrl =
    'http://plex.local:32400';
  (adapter as unknown as { baseUrl: string; token: string }).token = 'server-token';
  return adapter;
}

describe('Plex audio transcode URLs', () => {
  it('builds a fully identified MP3 universal-transcode request', () => {
    const url = new URL(adapterWithCreds().buildAudioTranscodeUrl('42', {
      sessionId: 'session-123',
      mediaIndex: 1,
      partIndex: 2,
      bitrateKbps: 256,
      offsetSec: 30,
    }));

    expect(url.pathname).toBe('/music/:/transcode/universal/start.mp3');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      path: '/library/metadata/42',
      mediaIndex: '1',
      partIndex: '2',
      protocol: 'http',
      offset: '30',
      directPlay: '0',
      directStream: '0',
      audioCodec: 'mp3',
      musicBitrate: '256',
      maxAudioBitrate: '256',
      session: 'session-123',
      'X-Plex-Session-Identifier': 'session-123',
      'X-Plex-Client-Identifier': 'plexa',
      'X-Plex-Product': 'Plexa',
      'X-Plex-Version': '0.2.0',
      'X-Plex-Platform': 'Web',
      'X-Plex-Platform-Version': '1.0',
      'X-Plex-Device': 'Plexa',
      'X-Plex-Device-Name': 'Plexa',
      'X-Plex-Token': 'server-token',
      'X-Plex-Client-Profile-Extra':
        'add-transcode-target(type=musicProfile&context=streaming&protocol=http&container=mp3&audioCodec=mp3)',
    });
  });

  it('includes media selection and a matching profile in the HLS fallback', () => {
    const url = new URL(adapterWithCreds().buildTranscodeUrl('42', 'session-456', 3, 4));

    expect(url.pathname).toBe('/music/:/transcode/universal/start.m3u8');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      path: '/library/metadata/42',
      mediaIndex: '3',
      partIndex: '4',
      protocol: 'hls',
      session: 'session-456',
      'X-Plex-Session-Identifier': 'session-456',
      'X-Plex-Client-Profile-Extra':
        'add-transcode-target(type=musicProfile&context=streaming&protocol=hls&container=mpegts&audioCodec=aac,mp3)',
    });
  });

  it('builds a stop URL carrying the transcode session and token', () => {
    const url = new URL(adapterWithCreds().buildTranscodeStopUrl('session-789'));

    expect(url.pathname).toBe('/video/:/transcode/universal/stop');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      session: 'session-789',
      'X-Plex-Token': 'server-token',
    });
  });
});
