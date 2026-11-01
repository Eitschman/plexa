import { ALEXA_LOCALE_CATALOG, isSupportedAlexaLocale } from '../../../src/alexa/locales';

export interface AlexaLocale {
  value: string;
  label: string;
}

export const ALEXA_LOCALES: AlexaLocale[] = ALEXA_LOCALE_CATALOG.map((locale) => ({
  value: locale.value,
  label: locale.label,
}));

export { isSupportedAlexaLocale };

export function getAlexaLocaleLabel(code: string): string {
  return ALEXA_LOCALES.find((locale) => locale.value === code)?.label ?? code;
}
