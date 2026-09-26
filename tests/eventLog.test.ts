import { describe, it, expect } from 'vitest';
import {
  summarizeFallback,
  summarizeLoop,
  summarizePlayNotFound,
  summarizePlaySuccess,
  summarizeSeek,
  summarizeSeekTo,
  summarizeTransport,
} from '../src/alexa/eventLog.js';

describe('eventLog summaries', () => {
  it('summarizes successful playlist play with shuffle', () => {
    expect(
      summarizePlaySuccess({
        kind: 'playlist',
        matched: 'Road Trip',
        trackCount: 42,
        shuffle: true,
      }),
    ).toBe('Shuffling playlist "Road Trip" (42 tracks)');
  });

  it('summarizes play not found', () => {
    expect(summarizePlayNotFound('playlist', 'road trip')).toBe(
      'Couldn\'t find playlist "road trip"',
    );
  });

  it('summarizes track play with artist', () => {
    expect(
      summarizePlaySuccess({
        kind: 'track',
        matched: 'Dreams',
        trackCount: 1,
        shuffle: false,
        artist: 'Fleetwood Mac',
      }),
    ).toBe('Playing "Dreams" by Fleetwood Mac');
  });

  it('summarizes seek forward with seconds', () => {
    expect(summarizeSeek('forward', 30)).toBe('Skipped forward 30 seconds');
  });

  it('summarizes an absolute seek position', () => {
    expect(summarizeSeekTo(125000)).toBe('Jumped to 2:05');
  });

  it('summarizes loop state', () => {
    expect(summarizeLoop(true)).toBe('Loop enabled');
    expect(summarizeLoop(false)).toBe('Loop disabled');
  });

  it('summarizes transport with track title', () => {
    expect(summarizeTransport('resume', 'Dreams')).toBe('Resumed "Dreams"');
  });

  it('summarizes fallback with intent name', () => {
    expect(summarizeFallback('AMAZON.FallbackIntent')).toBe(
      'Didn\'t understand (AMAZON.FallbackIntent)',
    );
  });
});
