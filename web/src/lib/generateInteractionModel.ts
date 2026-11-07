import { modelLanguageForLocale } from '../../../src/alexa/locales';
import deTemplate from '@skill/interaction-model.de-DE.json';
import enTemplate from '@skill/interaction-model.json';
import frTemplate from '@skill/interaction-model.fr-FR.json';

export interface InteractionModel {
  interactionModel: {
    languageModel: {
      invocationName: string;
      intents: unknown[];
    };
  };
}

const MODELS_BY_LANGUAGE = {
  en: enTemplate,
  fr: frTemplate,
  de: deTemplate,
} as const satisfies Record<string, InteractionModel>;

const INVOCATION_NAME_PATTERN = /^[a-z0-9][a-z0-9 ]{1,}$/;

export function isValidInvocationName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= 2 && INVOCATION_NAME_PATTERN.test(trimmed);
}

export function buildInteractionModel(invocationName: string, locale = 'en-US'): InteractionModel {
  const language = modelLanguageForLocale(locale);
  if (!language) {
    throw new Error(`Unsupported Alexa locale: ${locale}`);
  }
  const model = structuredClone(MODELS_BY_LANGUAGE[language]) as InteractionModel;
  model.interactionModel.languageModel.invocationName = invocationName.trim();
  return model;
}

export function downloadInteractionModel(invocationName: string, locale: string): void {
  const trimmed = invocationName.trim();
  if (!isValidInvocationName(trimmed)) return;

  const model = buildInteractionModel(trimmed, locale);
  const json = JSON.stringify(model, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `interaction-model-${locale}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
