import { describe, it, expect, beforeEach } from 'vitest';
import type { RequestEnvelope, ResponseEnvelope } from 'ask-sdk-model';
import { buildAlexaSkill } from '../src/alexa/handlers.js';
import { deDE } from '../src/alexa/localization/de-DE.js';
import { enUS } from '../src/alexa/localization/en-US.js';
import { frFR } from '../src/alexa/localization/fr-FR.js';
import { resolveAlexaMessages } from '../src/alexa/localization/index.js';
import { closeDb, getDb } from '../src/db/index.js';
import { updateSettingsFromInput } from '../src/services/settings.js';

function envelope(locale: string, request: Record<string, unknown>): RequestEnvelope {
  return {
    version: '1.0',
    session: {
      new: true,
      sessionId: 'session-1',
      application: { applicationId: 'amzn1.ask.skill.test' },
      user: { userId: 'user-1' },
    },
    context: {
      System: {
        application: { applicationId: 'amzn1.ask.skill.test' },
        user: { userId: 'user-1' },
        device: { deviceId: 'device-1' },
        apiEndpoint: 'https://api.amazonalexa.com',
      },
    },
    request: {
      requestId: 'request-1',
      timestamp: new Date().toISOString(),
      locale,
      ...request,
    },
  } as RequestEnvelope;
}

function speechText(response: ResponseEnvelope): string {
  const output = response.response?.outputSpeech;
  if (output && output.type === 'PlainText') return output.text;
  return '';
}

describe('Alexa message catalogs', () => {
  it('gives every locale the same message ids', () => {
    expect(Object.keys(frFR).sort()).toEqual(Object.keys(enUS).sort());
    expect(Object.keys(deDE).sort()).toEqual(Object.keys(enUS).sort());
  });

  it('resolves exact locales, language variants, and unsupported locales', () => {
    expect(resolveAlexaMessages('fr-FR').whichPlaylist()).toBe(frFR.whichPlaylist());
    expect(resolveAlexaMessages('fr_CA').whichPlaylist()).toBe(frFR.whichPlaylist());
    expect(resolveAlexaMessages('de-AT').whichSong()).toBe(deDE.whichSong());
    expect(resolveAlexaMessages('en-GB').launchWelcome('plexa')).toBe(enUS.launchWelcome('plexa'));
    expect(resolveAlexaMessages('ja-JP').fallback()).toBe(enUS.fallback());
    expect(resolveAlexaMessages(undefined).help()).toBe(enUS.help());
  });
});

describe('Alexa handler localization', () => {
  beforeEach(() => {
    closeDb();
    updateSettingsFromInput({ locale: 'en-US', invocationName: 'plexa' });
  });

  it('speaks the language from the Alexa request rather than the saved locale', async () => {
    updateSettingsFromInput({ locale: 'de-DE' });
    const skill = buildAlexaSkill();

    const english = await skill.invoke(envelope('en-GB', { type: 'LaunchRequest' }));
    expect(speechText(english)).toBe(enUS.launchWelcome('plexa'));

    const french = await skill.invoke(envelope('fr-CA', { type: 'LaunchRequest' }));
    expect(speechText(french)).toBe(frFR.launchWelcome('plexa'));

    const german = await skill.invoke(
      envelope('de-DE', {
        type: 'IntentRequest',
        intent: { name: 'AMAZON.HelpIntent', confirmationStatus: 'NONE' },
      }),
    );
    expect(speechText(german)).toBe(deDE.help());
    expect(speechText(german)).toContain('oder');
  });

  it('localizes prompts and configuration errors', async () => {
    const skill = buildAlexaSkill();
    const missingPlaylist = await skill.invoke(
      envelope('fr-FR', {
        type: 'IntentRequest',
        intent: { name: 'PlayPlaylistIntent', confirmationStatus: 'NONE', slots: {} },
      }),
    );
    expect(speechText(missingPlaylist)).toBe(frFR.whichPlaylist());

    const plexError = await skill.invoke(
      envelope('de-DE', {
        type: 'IntentRequest',
        intent: {
          name: 'PlayPlaylistIntent',
          confirmationStatus: 'NONE',
          slots: {
            playlist: { name: 'playlist', value: 'Autofahrt', confirmationStatus: 'NONE' },
          },
        },
      }),
    );
    expect(speechText(plexError)).toBe(deDE.plexNotConfiguredSetup());

    const fallback = await skill.invoke(
      envelope('ja-JP', {
        type: 'IntentRequest',
        intent: { name: 'UnknownIntent', confirmationStatus: 'NONE' },
      }),
    );
    expect(speechText(fallback)).toBe(enUS.fallback());
  });

  it('keeps activity summaries in English', async () => {
    const skill = buildAlexaSkill();
    await skill.invoke(envelope('fr-FR', { type: 'LaunchRequest' }));
    const latest = getDb()
      .prepare('SELECT summary FROM alexa_events ORDER BY id DESC LIMIT 1')
      .get() as { summary: string };
    expect(latest.summary).toBe('Opened Plexa');
  });
});
