export interface AlexaLocaleDefinition {
  value: string;
  label: string;
  /** Interaction-model language shared by regional locales. */
  modelLanguage: 'en' | 'fr' | 'de';
}

export const ALEXA_LOCALE_CATALOG = [
  { value: 'en-US', label: 'English (US)', modelLanguage: 'en' },
  { value: 'en-GB', label: 'English (UK)', modelLanguage: 'en' },
  { value: 'en-CA', label: 'English (Canada)', modelLanguage: 'en' },
  { value: 'en-AU', label: 'English (Australia)', modelLanguage: 'en' },
  { value: 'en-IN', label: 'English (India)', modelLanguage: 'en' },
  { value: 'fr-FR', label: 'Français (France)', modelLanguage: 'fr' },
  { value: 'de-DE', label: 'Deutsch (Deutschland)', modelLanguage: 'de' },
] as const satisfies readonly AlexaLocaleDefinition[];

export type AlexaLocaleCode = (typeof ALEXA_LOCALE_CATALOG)[number]['value'];
export type AlexaModelLanguage = (typeof ALEXA_LOCALE_CATALOG)[number]['modelLanguage'];

const LOCALES_BY_CODE = new Map<string, (typeof ALEXA_LOCALE_CATALOG)[number]>(
  ALEXA_LOCALE_CATALOG.map((locale) => [locale.value, locale]),
);

export function isSupportedAlexaLocale(code: string): code is AlexaLocaleCode {
  return LOCALES_BY_CODE.has(code);
}

export function modelLanguageForLocale(code: string): AlexaModelLanguage | null {
  return LOCALES_BY_CODE.get(code)?.modelLanguage ?? null;
}
