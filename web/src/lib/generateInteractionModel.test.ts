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

  it('preserves intents from the template', () => {
    const model = buildInteractionModel('plexa');
    expect(model.interactionModel.languageModel.intents.length).toBeGreaterThan(0);
    const names = model.interactionModel.languageModel.intents.map(
      (intent) => (intent as { name: string }).name,
    );
    expect(names).toContain('PlayPlaylistIntent');
    expect(names).toContain('SeekToIntent');
  });

  it('validates invocation names', () => {
    expect(isValidInvocationName('plexa')).toBe(true);
    expect(isValidInvocationName('my music')).toBe(true);
    expect(isValidInvocationName('a')).toBe(false);
    expect(isValidInvocationName('')).toBe(false);
    expect(isValidInvocationName('Plexa')).toBe(false);
  });
});
