import { deDE } from './de-DE.js';
import { enUS } from './en-US.js';
import { frFR } from './fr-FR.js';
import type { AlexaMessages } from './messages.js';

export type { AlexaMessages } from './messages.js';

const BY_LANGUAGE: Record<string, AlexaMessages> = {
  en: enUS,
  fr: frFR,
  de: deDE,
};

/** Exact locale catalogs override the language default when a regional variant is added. */
const BY_LOCALE: Record<string, AlexaMessages> = {
  'en-US': enUS,
  'fr-FR': frFR,
  'de-DE': deDE,
};

export function normalizeAlexaLocale(locale: string | undefined): string | null {
  const trimmed = locale?.trim();
  if (!trimmed) return null;
  const [language, region] = trimmed.replaceAll('_', '-').split('-');
  if (!language) return null;
  const normalizedLanguage = language.toLowerCase();
  if (!region) return normalizedLanguage;
  return `${normalizedLanguage}-${region.toUpperCase()}`;
}

export function resolveAlexaMessages(locale: string | undefined): AlexaMessages {
  const normalized = normalizeAlexaLocale(locale);
  if (!normalized) return enUS;
  const exact = BY_LOCALE[normalized];
  if (exact) return exact;
  const language = normalized.split('-')[0] ?? '';
  return BY_LANGUAGE[language] ?? enUS;
}
