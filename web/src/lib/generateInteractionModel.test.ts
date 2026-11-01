import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildInteractionModel,
  downloadInteractionModel,
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

  it('uses the French or German model for that locale and English for regional English', () => {
    const french = buildInteractionModel('ma musique', 'fr-FR');
    const german = buildInteractionModel('meine musik', 'de-DE');
    const british = buildInteractionModel('my music', 'en-GB');

    expect(french.interactionModel.languageModel.invocationName).toBe('ma musique');
    expect(samplesFor(french, 'PlayPlaylistIntent')).toContain('joue la playlist {playlist}');
    expect(samplesFor(french, 'PlayPlaylistIntent')).not.toContain('play playlist {playlist}');
    expect(samplesFor(german, 'PlayArtistIntent')).toContain('spiele musik von {artist}');
    expect(samplesFor(german, 'SeekToIntent')).toContain('springe zu {minutes} minuten');
    expect(samplesFor(british, 'PlayPlaylistIntent')).toContain('play playlist {playlist}');
    expect(intentNames(french)).toEqual(intentNames(british));
    expect(intentNames(german)).toEqual(intentNames(british));
  });

  it('rejects an unsupported locale instead of returning the English model', () => {
    expect(() => buildInteractionModel('plexa', 'es-ES')).toThrow(/unsupported alexa locale/i);
    expect(() => downloadInteractionModel('plexa', 'es-ES')).toThrow(/unsupported alexa locale/i);
  });

  it('downloads the model for the selected locale', async () => {
    const anchors: HTMLAnchorElement[] = [];
    const originalCreate = document.createElement.bind(document);
    const originalCreateUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const originalRevokeUrl = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const element = originalCreate(tag);
      if (tag === 'a') anchors.push(element as HTMLAnchorElement);
      return element;
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    let downloaded = '';
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: (blob: Blob) => {
        void blob.text().then((text) => {
          downloaded = text;
        });
        return 'blob:model';
      },
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: () => {},
    });

    try {
      downloadInteractionModel('plexa', 'de-DE');
      expect(anchors[0]?.download).toBe('interaction-model-de-DE.json');
      await vi.waitFor(() => expect(downloaded).toContain('spiele die playlist {playlist}'));
    } finally {
      if (originalCreateUrl) Object.defineProperty(URL, 'createObjectURL', originalCreateUrl);
      else Reflect.deleteProperty(URL, 'createObjectURL');
      if (originalRevokeUrl) Object.defineProperty(URL, 'revokeObjectURL', originalRevokeUrl);
      else Reflect.deleteProperty(URL, 'revokeObjectURL');
    }
  });
});

function intentNames(model: ReturnType<typeof buildInteractionModel>): string[] {
  return model.interactionModel.languageModel.intents.map(
    (intent) => (intent as { name: string }).name,
  );
}

function samplesFor(model: ReturnType<typeof buildInteractionModel>, intentName: string): string[] {
  const intent = model.interactionModel.languageModel.intents.find(
    (item) => (item as { name: string }).name === intentName,
  ) as { samples?: string[] } | undefined;
  return intent?.samples ?? [];
}

afterEach(() => {
  vi.restoreAllMocks();
});
