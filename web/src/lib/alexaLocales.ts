export interface AlexaLocale {
  value: string;
  label: string;
}

export const ALEXA_LOCALES: AlexaLocale[] = [
  { value: 'de-DE', label: 'Deutsch (Deutschland)' },  
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'en-CA', label: 'English (Canada)' },
  { value: 'en-AU', label: 'English (Australia)' },
  { value: 'en-IN', label: 'English (India)' },
];

export function getAlexaLocaleLabel(code: string): string {
  return ALEXA_LOCALES.find((l) => l.value === code)?.label ?? code;
}

export function isSupportedAlexaLocale(code: string): boolean {
  return ALEXA_LOCALES.some((l) => l.value === code);
}
