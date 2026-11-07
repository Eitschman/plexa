import { isSupportedAlexaLocale } from '../alexa/locales.js';
import { decryptSecret, encryptSecret, getEnv, migrateSecretIfLegacy } from '../config/index.js';
import { getSettings, updateSettings, type SettingsRow } from '../db/index.js';
import { normalizePublicHttpsUrl, validatePublicHttpsUrl } from '../lib/publicUrl.js';

export interface PublicSettings {
  plexUrl: string | null;
  hasPlexToken: boolean;
  hasPlexAccountToken: boolean;
  musicLibraryId: string | null;
  publicUrl: string | null;
  alexaSkillId: string | null;
  invocationName: string;
  locale: string;
  plexAccountEmail: string | null;
  plexServerName: string | null;
  plexServerMachineId: string | null;
  alexaEventsRetentionDays: number;
  updatedAt: string;
}

export interface SettingsInput {
  plexUrl?: string | null;
  plexToken?: string | null;
  musicLibraryId?: string | null;
  publicUrl?: string | null;
  alexaSkillId?: string | null;
  invocationName?: string;
  locale?: string;
  alexaEventsRetentionDays?: number;
}

function toPublic(row: SettingsRow): PublicSettings {
  return {
    plexUrl: row.plex_url,
    hasPlexToken: Boolean(row.plex_token_enc),
    hasPlexAccountToken: Boolean(row.plex_account_token_enc),
    musicLibraryId: row.music_library_id,
    publicUrl: row.public_url,
    alexaSkillId: row.alexa_skill_id,
    invocationName: row.invocation_name,
    locale: row.locale,
    plexAccountEmail: row.plex_account_email,
    plexServerName: row.plex_server_name,
    plexServerMachineId: row.plex_server_machine_id,
    alexaEventsRetentionDays: row.alexa_events_retention_days ?? 7,
    updatedAt: row.updated_at,
  };
}

export function getPlexAccountToken(): string | null {
  const env = getEnv();
  const row = getSettings();
  if (!row.plex_account_token_enc) return null;
  const token = decryptSecret(row.plex_account_token_enc, env.APP_SECRET);
  const migrated = migrateSecretIfLegacy(row.plex_account_token_enc, env.APP_SECRET);
  if (migrated !== row.plex_account_token_enc) {
    updateSettings({ plex_account_token_enc: migrated });
  }
  return token;
}

export function getPublicSettings(): PublicSettings {
  return toPublic(getSettings());
}

export function getPlexCredentials(): { url: string; token: string } | null {
  const env = getEnv();
  const row = getSettings();
  const url = row.plex_url ?? env.PLEX_URL;
  let token: string | undefined;
  if (row.plex_token_enc) {
    token = decryptSecret(row.plex_token_enc, env.APP_SECRET);
    const migrated = migrateSecretIfLegacy(row.plex_token_enc, env.APP_SECRET);
    if (migrated !== row.plex_token_enc) {
      updateSettings({ plex_token_enc: migrated });
    }
  } else if (env.PLEX_TOKEN) {
    token = env.PLEX_TOKEN;
  }
  if (!url || !token) return null;
  return { url, token };
}

export function getAlexaSkillId(): string | null {
  const env = getEnv();
  const row = getSettings();
  return row.alexa_skill_id ?? env.ALEXA_SKILL_ID ?? null;
}

export function getPublicBaseUrl(): string | null {
  const env = getEnv();
  const row = getSettings();
  return row.public_url ?? env.PUBLIC_URL ?? null;
}

export function updateSettingsFromInput(input: SettingsInput): PublicSettings {
  const env = getEnv();
  const patch: Partial<SettingsRow> = {};

  if (input.plexUrl !== undefined) patch.plex_url = input.plexUrl;
  if (input.musicLibraryId !== undefined) patch.music_library_id = input.musicLibraryId;
  if (input.publicUrl !== undefined) {
    const trimmed = input.publicUrl?.trim() ?? '';
    if (!trimmed) {
      patch.public_url = null;
    } else {
      const error = validatePublicHttpsUrl(trimmed);
      if (error) throw new Error(error);
      patch.public_url = normalizePublicHttpsUrl(trimmed);
    }
  }
  if (input.alexaSkillId !== undefined) patch.alexa_skill_id = input.alexaSkillId;
  if (input.invocationName !== undefined) patch.invocation_name = input.invocationName;
  if (input.locale !== undefined) {
    if (!isSupportedAlexaLocale(input.locale)) {
      throw new Error('Unsupported Alexa locale');
    }
    patch.locale = input.locale;
  }

  if (input.alexaEventsRetentionDays !== undefined) {
    const days = input.alexaEventsRetentionDays;
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      throw new Error('Event retention days must be an integer between 1 and 365');
    }
    patch.alexa_events_retention_days = days;
  }

  if (input.plexToken !== undefined) {
    patch.plex_token_enc =
      input.plexToken && input.plexToken.length > 0
        ? encryptSecret(input.plexToken, env.APP_SECRET)
        : null;
  }

  return toPublic(updateSettings(patch));
}

export function applyEnvDefaultsOnBoot(): void {
  const env = getEnv();
  const row = getSettings();
  const patch: Partial<SettingsRow> = {};
  if (!row.plex_url && env.PLEX_URL) patch.plex_url = env.PLEX_URL;
  if (!row.public_url && env.PUBLIC_URL) patch.public_url = env.PUBLIC_URL;
  if (!row.alexa_skill_id && env.ALEXA_SKILL_ID) patch.alexa_skill_id = env.ALEXA_SKILL_ID;
  if (!row.plex_token_enc && env.PLEX_TOKEN) {
    patch.plex_token_enc = encryptSecret(env.PLEX_TOKEN, env.APP_SECRET);
  }
  if (Object.keys(patch).length > 0) updateSettings(patch);
}
