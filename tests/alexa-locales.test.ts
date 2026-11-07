import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { ALEXA_LOCALE_CATALOG } from '../src/alexa/locales.js';
import { createApp } from '../src/app.js';
import { closeDb } from '../src/db/index.js';
import { getPublicSettings, updateSettingsFromInput } from '../src/services/settings.js';

interface ModelIntent {
  name: string;
  samples?: string[];
  slots?: { name: string; type: string }[];
}

interface InteractionModelFile {
  interactionModel: { languageModel: { intents: ModelIntent[] } };
}

const MODEL_FILES = [
  'interaction-model.json',
  'interaction-model.fr-FR.json',
  'interaction-model.de-DE.json',
];

function loadModel(filename: string): InteractionModelFile {
  return JSON.parse(
    readFileSync(new URL(`../skill/${filename}`, import.meta.url), 'utf8'),
  ) as InteractionModelFile;
}

function signature(intent: ModelIntent): string {
  const slots = (intent.slots ?? [])
    .map((slot) => `${slot.name}:${slot.type}`)
    .sort()
    .join(',');
  return `${intent.name}[${slots}]`;
}

describe('interaction model parity', () => {
  const models = MODEL_FILES.map(loadModel);

  it('keeps intent names, slots, and seek support aligned', () => {
    const [english, ...localized] = models;
    const englishSignatures = english.interactionModel.languageModel.intents.map(signature);
    expect(englishSignatures).toContain('SeekToIntent[minutes:AMAZON.NUMBER,seconds:AMAZON.NUMBER]');
    for (const model of localized) {
      expect(model.interactionModel.languageModel.intents.map(signature)).toEqual(englishSignatures);
    }
  });

  it('gives every custom intent native, unique samples', () => {
    for (const model of models) {
      const seen = new Set<string>();
      for (const intent of model.interactionModel.languageModel.intents) {
        const samples = intent.samples ?? [];
        if (!intent.name.startsWith('AMAZON.')) {
          expect(samples.length).toBeGreaterThan(0);
        }
        for (const sample of samples) {
          expect(seen.has(sample)).toBe(false);
          seen.add(sample);
        }
      }
    }
  });
});

describe('Alexa locale settings', () => {
  beforeEach(() => {
    closeDb();
  });

  it('accepts supported locales and rejects unsupported values', () => {
    for (const locale of ALEXA_LOCALE_CATALOG) {
      expect(updateSettingsFromInput({ locale: locale.value }).locale).toBe(locale.value);
    }
    expect(getPublicSettings().locale).toBe('de-DE');
    expect(() => updateSettingsFromInput({ locale: 'es-ES' })).toThrow('Unsupported Alexa locale');
    expect(() => updateSettingsFromInput({ locale: '../fr-FR' })).toThrow('Unsupported Alexa locale');
    expect(getPublicSettings().locale).toBe('de-DE');
  });

  it('persists a selected locale through the settings API', async () => {
    const app = createApp();
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send({ username: 'admin', password: 'testpass' });
    expect(login.status).toBe(200);
    const csrf = await agent.get('/api/auth/csrf');

    const saved = await agent
      .put('/api/settings')
      .set('X-CSRF-Token', csrf.body.csrfToken as string)
      .send({ locale: 'fr-FR' });
    expect(saved.status).toBe(200);
    expect(saved.body.locale).toBe('fr-FR');

    const rejected = await agent
      .put('/api/settings')
      .set('X-CSRF-Token', csrf.body.csrfToken as string)
      .send({ locale: 'es-ES' });
    expect(rejected.status).toBe(400);
    expect(getPublicSettings().locale).toBe('fr-FR');
  });
});
