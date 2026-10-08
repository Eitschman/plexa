import { describe, it, expect, beforeEach } from 'vitest';
import { audioPlayResponse, playQueueItem } from '../src/alexa/playback.js';
import { resetEnvForTests } from '../src/config/index.js';
import { closeDb } from '../src/db/index.js';

describe('alexa playback responses', () => {
  beforeEach(() => {
    process.env.PUBLIC_URL = 'https://example.com';
    resetEnvForTests();
    closeDb();
  });

  it('builds AudioPlayer.Play with absolute stream url and token', () => {
    const response = audioPlayResponse({
      streamUrl: '/media/token.sig',
      streamToken: 'abc123',
      title: 'Song',
      artist: 'Artist',
    });
    expect(response?.directives?.[0]).toMatchObject({
      type: 'AudioPlayer.Play',
      playBehavior: 'REPLACE_ALL',
      audioItem: {
        stream: {
          url: 'https://example.com/media/token.sig',
          token: 'abc123',
          offsetInMilliseconds: 0,
        },
      },
    });
  });

  it('prefers the Alexa-targeted stream URL', () => {
    const response = audioPlayResponse({
      streamUrl: '/media/web-token.sig',
      streamUrlAlexa: '/media/alexa-token.sig',
      streamToken: 'abc123',
      title: 'Song',
    });

    expect(response?.directives?.[0]).toMatchObject({
      audioItem: {
        stream: {
          url: 'https://example.com/media/alexa-token.sig',
        },
      },
    });
  });

  it('includes expectedPreviousToken for enqueue directives', () => {
    const response = audioPlayResponse(
      {
        streamUrl: '/media/next.sig',
        streamToken: 'next-token',
        title: 'Next',
      },
      {
        playBehavior: 'ENQUEUE',
        expectedPreviousToken: 'prev-token',
      },
    );
    expect(response?.directives?.[0]).toMatchObject({
      playBehavior: 'ENQUEUE',
      audioItem: {
        stream: {
          expectedPreviousToken: 'prev-token',
        },
      },
    });
  });

  it('supports non-zero seek offsets', () => {
    const response = playQueueItem(
      {
        ratingKey: '1',
        title: 'Song',
        streamUrl: '/media/token.sig',
        streamToken: 'seek-token',
      },
      { offsetMs: 45000 },
    );
    expect(response?.directives?.[0]).toMatchObject({
      audioItem: {
        stream: {
          offsetInMilliseconds: 45000,
        },
      },
    });
  });

  it('returns null when public url is missing', () => {
    delete process.env.PUBLIC_URL;
    resetEnvForTests();
    closeDb();
    const response = audioPlayResponse({
      streamUrl: '/media/token.sig',
      streamToken: 'abc123',
      title: 'Song',
    });
    expect(response).toBeNull();
  });
});
