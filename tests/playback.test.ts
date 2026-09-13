import { describe, it, expect } from 'vitest';
import { normalizeSpokenName, bestMatch } from '../src/services/playback.js';

describe('spoken name matching', () => {
  it('normalizes invocation bleed-through', () => {
    expect(normalizeSpokenName('ask plexa to play road trip')).toBe('road trip');
    expect(normalizeSpokenName('play Fleetwood Mac')).toBe('fleetwood mac');
    expect(normalizeSpokenName('evening paath Playlist')).toBe('evening paath');
    expect(normalizeSpokenName('the evening paath playlist')).toBe('evening paath');
  });

  it('normalizes German Alexa phrasing', () => {
    expect(normalizeSpokenName('spiele Orden Ogan')).toBe('orden ogan');
    expect(normalizeSpokenName('spiele den Künstler Orden Ogan')).toBe('orden ogan');
    expect(normalizeSpokenName('spiele Musik von Orden Ogan')).toBe('orden ogan');
    expect(normalizeSpokenName('starte das Album Final Days')).toBe('final days');
    expect(normalizeSpokenName('spiele Metal zufällig')).toBe('metal');
  });

  it('finds best playlist match', () => {
    const playlists = [
      { title: 'Road Trip' },
      { title: 'Jazz Night' },
      { title: 'Evening Paath' },
    ];

    expect(bestMatch('road trip', playlists)?.title).toBe('Road Trip');
    expect(bestMatch('jazz', playlists)?.title).toBe('Jazz Night');
    expect(bestMatch('evening paath Playlist', playlists)?.title).toBe('Evening Paath');
  });

  it('tolerates small speech recognition errors', () => {
    const artists = [
      { title: 'Orden Ogan' },
      { title: 'Alestorm' },
      { title: 'Wind Rose' },
    ];

    expect(bestMatch('Orden Organ', artists)?.title).toBe('Orden Ogan');
  });

  it('does not guess when fuzzy matches are ambiguous', () => {
    const artists = [
      { title: 'Metallica' },
      { title: 'Metal Church' },
    ];

    expect(bestMatch('Metal', artists)).toBeNull();
  });
});