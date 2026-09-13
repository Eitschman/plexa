import { describe, it, expect } from 'vitest';

import {
  buildInteractionModel,
  isValidInvocationName,
} from './generateInteractionModel';

describe('generateInteractionModel', () => {
  it('patches invocation name in the template', () => {
    const model = buildInteractionModel('my music');

    expect(model.interactionModel.languageModel.invocationName).toBe('my music');
  });

  it('replaces default plexa invocation name', () => {
    const model = buildInteractionModel('plex tunes');

    expect(model.interactionModel.languageModel.invocationName).not.toBe('plexa');
    expect(model.interactionModel.languageModel.invocationName).toBe('plex tunes');
  });

  it('preserves intents from the English template', () => {
    const model = buildInteractionModel('plexa', 'en-US');

    expect(model.interactionModel.languageModel.intents.length).toBeGreaterThan(0);

    const names = model.interactionModel.languageModel.intents.map(
      (intent) => (intent as { name: string }).name,
    );

    expect(names).toContain('PlayPlaylistIntent');
  });

  it('uses the German interaction model for de-DE', () => {
    const model = buildInteractionModel('plexa', 'de-DE');

    const playArtistIntent = model.interactionModel.languageModel.intents.find(
      (intent) => (intent as { name: string }).name === 'PlayArtistIntent',
    ) as {
      name: string;
      samples?: string[];
    } | undefined;

    expect(playArtistIntent).toBeDefined();
    expect(playArtistIntent?.samples).toContain('spiele {artist}');
    expect(playArtistIntent?.samples).toContain('spiele Musik von {artist}');
  });

  it('falls back to English for unsupported locales', () => {
    const model = buildInteractionModel('plexa', 'fr-FR');

    const playArtistIntent = model.interactionModel.languageModel.intents.find(
      (intent) => (intent as { name: string }).name === 'PlayArtistIntent',
    ) as {
      name: string;
      samples?: string[];
    } | undefined;

    expect(playArtistIntent).toBeDefined();
    expect(playArtistIntent?.samples).toContain('play {artist}');
  });

  it('validates invocation names', () => {
    expect(isValidInvocationName('plexa')).toBe(true);
    expect(isValidInvocationName('my music')).toBe(true);
    expect(isValidInvocationName('a')).toBe(false);
    expect(isValidInvocationName('')).toBe(false);
    expect(isValidInvocationName('Plexa')).toBe(false);
  });
});