import { describe, it, expect } from 'vitest';
import { normalizeSpokenName, bestMatch } from '../src/services/playback.js';

describe('spoken name matching', () => {
  it('normalizes invocation bleed-through', () => {
    expect(normalizeSpokenName('ask plexa to play road trip')).toBe('road trip');
    expect(normalizeSpokenName('play Fleetwood Mac')).toBe('fleetwood mac');
    expect(normalizeSpokenName('evening paath Playlist')).toBe('evening paath');
    expect(normalizeSpokenName('the evening paath playlist')).toBe('evening paath');
  });

  it('finds best playlist match', () => {
    const playlists = [{ title: 'Road Trip' }, { title: 'Jazz Night' }, { title: 'Evening Paath' }];
    expect(bestMatch('road trip', playlists)?.title).toBe('Road Trip');
    expect(bestMatch('jazz', playlists)?.title).toBe('Jazz Night');
    expect(bestMatch('evening paath Playlist', playlists)?.title).toBe('Evening Paath');
  });

  it('strips French and German command phrases without changing stored titles', () => {
    expect(normalizeSpokenName('joue la playlist voyage', 'fr-FR')).toBe('voyage');
    expect(normalizeSpokenName("joue l'album rumours", 'fr-FR')).toBe('rumours');
    expect(normalizeSpokenName('joue de la musique de stromae', 'fr-FR')).toBe('stromae');
    expect(normalizeSpokenName('Les Misérables', 'fr-FR')).toBe('les misérables');
    expect(normalizeSpokenName('spiele die playlist autofahrt', 'de-DE')).toBe('autofahrt');
    expect(normalizeSpokenName('spiele musik von rammstein', 'de-DE')).toBe('rammstein');
    expect(normalizeSpokenName('Die Ärzte', 'de-DE')).toBe('die ärzte');
    expect(normalizeSpokenName('Album', 'de-DE')).toBe('album');
  });

  it('keeps command stripping inside the request language', () => {
    expect(normalizeSpokenName('joue la playlist voyage', 'en-US')).toBe('joue la playlist voyage');
    expect(normalizeSpokenName('spiele die playlist autofahrt', 'fr-FR')).toBe('spiele die playlist autofahrt');
    expect(normalizeSpokenName('play the album rumours', 'de-DE')).toBe('play the album rumours');
  });

  it('matches accented titles and preserves the original title', () => {
    const artists = [{ title: 'Die Ärzte' }, { title: 'Björk' }, { title: 'Beyoncé' }];
    expect(bestMatch('spiele die ärzte', artists, 'de-DE')?.title).toBe('Die Ärzte');
    expect(bestMatch('Bjork', artists, 'de-DE')?.title).toBe('Björk');
    expect(bestMatch('Beyonce', artists, 'fr-FR')?.title).toBe('Beyoncé');
    expect(bestMatch('strasse', [{ title: 'Straße' }], 'de-DE')?.title).toBe('Straße');
  });
});
