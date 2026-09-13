import enUsTemplate from '@skill/interaction-model.json';
import deDeTemplate from '@skill/interaction-model.de-DE.json';

export interface InteractionModel {
  interactionModel: {
    languageModel: {
      invocationName: string;
      intents: unknown[];
    };
  };
}

const INVOCATION_NAME_PATTERN = /^[a-z0-9][a-z0-9 ]{1,}$/;

const templates: Record<string, InteractionModel> = {
  'en-US': enUsTemplate as InteractionModel,
  'de-DE': deDeTemplate as InteractionModel,
};

export function isValidInvocationName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= 2 && INVOCATION_NAME_PATTERN.test(trimmed);
}

export function buildInteractionModel(
  invocationName: string,
  locale = 'en-US',
): InteractionModel {
  const template = templates[locale] ?? enUsTemplate as InteractionModel;
  const model = structuredClone(template);

  model.interactionModel.languageModel.invocationName = invocationName.trim();

  return model;
}

export function downloadInteractionModel(
  invocationName: string,
  locale: string,
): void {
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