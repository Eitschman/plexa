import { FormEvent, useCallback, useEffect, useState } from 'react';
import { AlexaSetupChecklist } from '../components/AlexaSetupChecklist';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
  ServerOptionSkeleton,
  SettingsPageSkeleton,
  Skeleton,
  SkeletonStack,
} from '../components/Skeleton';
import { ALEXA_LOCALES, isSupportedAlexaLocale } from '../lib/alexaLocales';
import { normalizePublicHttpsUrl, validatePublicHttpsUrl } from '../lib/publicUrl';
import {
  api,
  changePassword,
  cleanupAlexaEvents,
  disconnectPlex,
  fetchCsrf,
  fetchPlexServers,
  getPlexOAuthStatus,
  selectPlexServer,
  startPlexOAuth,
  type PlexOAuthStatus,
  type PlexServerOption,
  type PublicSettings,
} from '../lib/api';

type SetupStep = 'plex' | 'config';

export function SettingsPage() {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [step, setStep] = useState<SetupStep>('plex');
  const [plexUrl, setPlexUrl] = useState('');
  const [plexToken, setPlexToken] = useState('');
  const [musicLibraryId, setMusicLibraryId] = useState('');
  const [publicUrl, setPublicUrl] = useState('');
  const [publicUrlError, setPublicUrlError] = useState('');
  const [publicUrlTouched, setPublicUrlTouched] = useState(false);
  const [alexaSkillId, setAlexaSkillId] = useState('');
  const [invocationName, setInvocationName] = useState('plexa');
  const [locale, setLocale] = useState('en-US');
  const [libraries, setLibraries] = useState<{ key: string; title: string; type: string }[]>([]);
  const [plexMessage, setPlexMessage] = useState('');
  const [plexError, setPlexError] = useState('');
  const [configMessage, setConfigMessage] = useState('');
  const [configError, setConfigError] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [authId, setAuthId] = useState<string | null>(null);
  const [oauthStatus, setOauthStatus] = useState<PlexOAuthStatus | null>(null);
  const [servers, setServers] = useState<PlexServerOption[]>([]);
  const [serversError, setServersError] = useState('');
  const [serversLoading, setServersLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [adminUsername, setAdminUsername] = useState('admin');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [disconnectBusy, setDisconnectBusy] = useState(false);
  const [alexaEventsRetentionDays, setAlexaEventsRetentionDays] = useState(7);
  const [retentionMessage, setRetentionMessage] = useState('');
  const [retentionError, setRetentionError] = useState('');
  const [retentionBusy, setRetentionBusy] = useState(false);
  const [cleanupBusy, setCleanupBusy] = useState(false);

  const currentServerFallback = (s: PublicSettings): PlexServerOption[] => {
    if (!s.plexServerMachineId || !s.plexServerName) return [];
    return [
      {
        clientIdentifier: s.plexServerMachineId,
        name: s.plexServerName,
        owned: true,
        product: 'Plex Media Server',
        platform: 'Unknown',
        presence: true,
        connections: [],
      },
    ];
  };

  const refreshServers = useCallback(async (s: PublicSettings) => {
    if (!s.hasPlexAccountToken) {
      setServersError('');
      return;
    }
    setServersLoading(true);
    setServersError('');
    try {
      const listed = await fetchPlexServers();
      setServers(listed.length > 0 ? listed : currentServerFallback(s));
      if (listed.length === 0 && !s.plexServerMachineId) {
        setServersError('No Plex servers found for this account.');
      }
    } catch (err) {
      setServers((prev) => (prev.length > 0 ? prev : currentServerFallback(s)));
      setServersError(err instanceof Error ? err.message : "Couldn't load servers.");
    } finally {
      setServersLoading(false);
    }
  }, []);

  const loadSettings = useCallback(async (opts?: { hydrateStep?: boolean }) => {
    const s = await api<PublicSettings>('/api/settings');
    setSettings(s);
    setPlexUrl(s.plexUrl ?? '');
    setMusicLibraryId(s.musicLibraryId ?? '');
    setPublicUrl(s.publicUrl ?? '');
    setAlexaSkillId(s.alexaSkillId ?? '');
    setInvocationName(s.invocationName);
    setLocale(isSupportedAlexaLocale(s.locale) ? s.locale : 'en-US');
    setAlexaEventsRetentionDays(s.alexaEventsRetentionDays ?? 7);
    if (opts?.hydrateStep && s.hasPlexToken) {
      setStep('config');
    }
    const libs = await api<{ items: { key: string; title: string; type: string }[] }>('/api/plex/libraries').catch(() => ({ items: [] }));
    setLibraries(libs.items.filter((l) => l.type === 'artist' || l.type === '8'));
    await refreshServers(s);
  }, [refreshServers]);

  useEffect(() => {
    loadSettings({ hydrateStep: true }).catch(() => setPlexError('Failed to load settings'));
  }, [loadSettings]);

  useEffect(() => {
    if (!authId) return;
    const timer = window.setInterval(async () => {
      try {
        const status = await getPlexOAuthStatus(authId);
        setOauthStatus(status);
        if (status.status === 'completed' && status.servers) {
          setServers(status.servers);
          setStep('plex');
          window.clearInterval(timer);
          await loadSettings();
        }
        if (status.status === 'expired' || status.status === 'error') {
          window.clearInterval(timer);
        }
      } catch {
        setPlexError('OAuth polling failed');
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [authId, loadSettings]);

  const signInWithPlex = async () => {
    setPlexError('');
    setPlexMessage('');
    const start = await startPlexOAuth();
    setAuthId(start.authId);
    window.open(start.authUrl, '_blank', 'noopener,noreferrer');
    setPlexMessage('Complete sign-in in the Plex window, then return here.');
  };

  const chooseServer = async (clientIdentifier: string) => {
    if (!authId && !settings?.hasPlexAccountToken) return;
    setConfigError('');
    const result = await selectPlexServer(clientIdentifier, authId);
    setPlexUrl(result.url);
    setLibraries(result.libraries.filter((l) => l.type === 'artist' || l.type === '8'));
    setConfigMessage(`Connected to ${result.name}`);
    setAuthId(null);
    setStep('config');
    await loadSettings();
  };

  const testManualPlex = async () => {
    setConfigError('');
    setConfigMessage('');
    await fetchCsrf();
    const res = await api<{ ok: boolean; libraries: { key: string; title: string; type: string }[] }>(
      '/api/plex/test',
      { method: 'POST', body: JSON.stringify({ url: plexUrl, token: plexToken || undefined }) },
    );
    setLibraries(res.libraries.filter((l) => l.type === 'artist' || l.type === '8'));
    setConfigMessage('Plex connection successful.');
    setStep('config');
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setConfigError('');
    setConfigMessage('');
    setPublicUrlTouched(true);
    const publicUrlValidationError = validatePublicHttpsUrl(publicUrl);
    setPublicUrlError(publicUrlValidationError ?? '');
    if (publicUrlValidationError) return;

    const normalizedPublicUrl = publicUrl.trim() ? normalizePublicHttpsUrl(publicUrl) : '';
    try {
      await fetchCsrf();
      const updated = await api<PublicSettings>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          plexUrl,
          plexToken: plexToken || undefined,
          musicLibraryId,
          publicUrl: normalizedPublicUrl || null,
          alexaSkillId,
          invocationName,
          locale,
        }),
      });
      setPublicUrl(normalizedPublicUrl);
      setSettings(updated);
      setConfigMessage('Settings saved.');
    } catch (err) {
      setConfigError((err as Error).message);
    }
  };

  const closeDisconnect = () => {
    if (disconnectBusy) return;
    setDisconnectOpen(false);
  };

  const confirmDisconnect = async () => {
    setDisconnectBusy(true);
    try {
      await disconnectPlex();
      setAuthId(null);
      setOauthStatus(null);
      setServers([]);
      setServersError('');
      setLibraries([]);
      setPlexUrl('');
      setPlexToken('');
      setMusicLibraryId('');
      setStep('plex');
      setPlexMessage('Plex disconnected.');
      setDisconnectOpen(false);
      await loadSettings();
    } catch (err) {
      setPlexError((err as Error).message);
    } finally {
      setDisconnectBusy(false);
    }
  };

  const updatePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordMessage('');
    try {
      await changePassword(adminUsername, currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setPasswordMessage('Password updated.');
    } catch (err) {
      setPasswordError((err as Error).message);
    }
  };

  const saveRetention = async (e: FormEvent) => {
    e.preventDefault();
    setRetentionError('');
    setRetentionMessage('');
    const days = Number(alexaEventsRetentionDays);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      setRetentionError('Retention days must be an integer between 1 and 365.');
      return;
    }
    setRetentionBusy(true);
    try {
      await fetchCsrf();
      const updated = await api<PublicSettings>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ alexaEventsRetentionDays: days }),
      });
      setAlexaEventsRetentionDays(updated.alexaEventsRetentionDays);
      setSettings(updated);
      setRetentionMessage('Retention settings saved.');
    } catch (err) {
      setRetentionError((err as Error).message);
    } finally {
      setRetentionBusy(false);
    }
  };

  const runCleanup = async () => {
    setRetentionError('');
    setRetentionMessage('');
    setCleanupBusy(true);
    try {
      const result = await cleanupAlexaEvents();
      setRetentionMessage(
        `Deleted ${result.deletedCount} event${result.deletedCount === 1 ? '' : 's'} older than ${result.retentionDays} day${result.retentionDays === 1 ? '' : 's'}.`,
      );
    } catch (err) {
      setRetentionError((err as Error).message);
    } finally {
      setCleanupBusy(false);
    }
  };

  const switchStep = (next: SetupStep) => {
    setStep(next);
    if (next === 'plex') {
      setConfigMessage('');
      setConfigError('');
      setPasswordMessage('');
      setPasswordError('');
    } else {
      setPlexMessage('');
      setPlexError('');
    }
  };

  const steps: { id: SetupStep; label: string }[] = [
    { id: 'plex', label: 'Plex Server' },
    { id: 'config', label: 'Configuration' },
  ];

  if (!settings) {
    return <SettingsPageSkeleton />;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-6">
        <nav aria-label="Setup steps" className="card flex flex-wrap gap-2 p-4">
          {steps.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`rounded-xl px-3 py-2 text-sm ${step === s.id ? 'bg-accent text-white' : 'bg-surface-muted text-muted'}`}
              onClick={() => switchStep(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>

        {step === 'plex' && (
          <>
            <section className="card space-y-4 p-6">
              <h2 className="text-xl font-semibold">Sign in with Plex</h2>
              <p className="text-sm text-muted">
                Use Plex OAuth for accounts with 2FA. Plex will open in a new tab for authorization.
              </p>
              <button className="btn btn-primary" type="button" onClick={signInWithPlex}>Sign in with Plex</button>
              {oauthStatus?.status === 'pending' && (
                <div className="space-y-2" role="status" aria-busy="true">
                  <span className="sr-only">Waiting for Plex authorization…</span>
                  <Skeleton className="h-4 w-56" />
                  <Skeleton className="h-3 w-72 max-w-full" />
                </div>
              )}
              {settings?.hasPlexToken && (
                <div className="rounded-xl bg-surface-muted/50 p-4 text-sm">
                  <p>Connected{settings.plexAccountEmail ? ` as ${settings.plexAccountEmail}` : ''}</p>
                  {settings.plexServerName && <p className="text-muted">Server: {settings.plexServerName}</p>}
                  <button className="btn btn-secondary mt-3" type="button" onClick={() => setDisconnectOpen(true)}>Disconnect</button>
                </div>
              )}
              <button className="text-sm text-accent" type="button" onClick={() => setShowAdvanced((v) => !v)}>
                {showAdvanced ? 'Hide' : 'Show'} manual token setup
              </button>
              {showAdvanced && (
                <div className="space-y-3 border-t border-white/10 pt-4">
                  <Field label="Plex URL" value={plexUrl} onChange={setPlexUrl} />
                  <Field
                    label="Plex token"
                    value={plexToken}
                    onChange={setPlexToken}
                    placeholder={settings?.hasPlexToken ? 'Token saved (leave blank to keep)' : ''}
                  />
                  <p className="text-xs text-muted">
                    Find your token: Plex Web → item → ⋯ → Get Info → View XML → copy <code>X-Plex-Token</code>.{' '}
                    <a className="text-accent underline" href="https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/" target="_blank" rel="noreferrer">
                      Plex guide
                    </a>
                  </p>
                  <button className="btn btn-secondary" type="button" onClick={testManualPlex}>Test connection</button>
                </div>
              )}
            </section>

            <section className="card space-y-4 p-6">
              <h2 className="text-xl font-semibold">Choose Plex server</h2>
              {serversLoading && (
                <SkeletonStack count={3} label="Loading servers">
                  {(index) => <ServerOptionSkeleton key={index} />}
                </SkeletonStack>
              )}
              {serversError && (
                <div className="space-y-2">
                  <p className="text-sm text-danger" role="alert">{serversError}</p>
                  {settings && (
                    <button className="btn btn-secondary" type="button" onClick={() => refreshServers(settings)}>
                      Retry
                    </button>
                  )}
                </div>
              )}
              {servers.length === 0 && !serversLoading ? (
                <div className="space-y-2 text-sm text-muted">
                  {settings?.hasPlexAccountToken ? (
                    <p>No servers to show. Try Retry, or sign in with Plex again.</p>
                  ) : settings?.hasPlexToken ? (
                    <p>Sign in with Plex again to list or change servers.</p>
                  ) : (
                    <p>Sign in with Plex first to list your servers.</p>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {servers.map((server) => {
                    const selected = settings?.plexServerMachineId === server.clientIdentifier;
                    return (
                      <button
                        key={server.clientIdentifier}
                        type="button"
                        className={`w-full rounded-xl px-4 py-3 text-left hover:bg-surface-muted ${
                          selected ? 'bg-accent/20 ring-1 ring-accent' : 'bg-surface-muted/50'
                        }`}
                        onClick={() => chooseServer(server.clientIdentifier)}
                      >
                        <p className="font-medium">
                          {server.name}
                          {selected ? ' (current)' : ''}
                        </p>
                        <p className="text-sm text-muted">{server.platform} · {server.presence ? 'Online' : 'Offline'}</p>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            {(plexMessage || plexError) && (
              <div className="card space-y-2 p-6">
                {plexMessage && <p className="text-sm text-success" role="status">{plexMessage}</p>}
                {plexError && <p className="text-sm text-danger" role="alert">{plexError}</p>}
              </div>
            )}
          </>
        )}

        {step === 'config' && (
          <form onSubmit={save} className="card space-y-4 p-6">
            <h2 className="text-xl font-semibold">Configuration</h2>
            <p className="text-sm text-muted">
              Choose your music library, public HTTPS URL for Alexa streaming, and skill settings.
            </p>
            <label className="block space-y-1">
              <span className="text-sm text-muted">Music library</span>
              <select className="input" value={musicLibraryId} onChange={(e) => setMusicLibraryId(e.target.value)}>
                <option value="">Select library</option>
                {libraries.map((lib) => (
                  <option key={lib.key} value={lib.key}>{lib.title} ({lib.type})</option>
                ))}
              </select>
            </label>
            <Field
              label="Public HTTPS URL"
              value={publicUrl}
              onChange={(value) => {
                setPublicUrl(value);
                if (publicUrlTouched) {
                  setPublicUrlError(validatePublicHttpsUrl(value) ?? '');
                }
              }}
              onBlur={() => {
                setPublicUrlTouched(true);
                setPublicUrlError(validatePublicHttpsUrl(publicUrl) ?? '');
              }}
              error={publicUrlTouched ? publicUrlError : ''}
              placeholder="https://your-domain.example.com"
            />
            <Field label="Alexa skill ID" value={alexaSkillId} onChange={setAlexaSkillId} />
            <Field label="Invocation name" value={invocationName} onChange={setInvocationName} />
            <label className="block space-y-1">
              <span className="text-sm text-muted">Alexa skill locale</span>
              <select className="input" value={locale} onChange={(e) => setLocale(e.target.value)}>
                {ALEXA_LOCALES.map((option) => (
                  <option key={option.value} value={option.value}>{option.label} ({option.value})</option>
                ))}
              </select>
              <p className="text-xs text-muted">
                Chooses the interaction model you download. Spoken replies follow the language of the Alexa device.
              </p>
            </label>
            <button className="btn btn-primary" type="submit">Save settings</button>
            {configMessage && <p className="text-sm text-success" role="status">{configMessage}</p>}
            {configError && <p className="text-sm text-danger" role="alert">{configError}</p>}
          </form>
        )}

        {step === 'config' && (
          <>
            <form onSubmit={saveRetention} className="card space-y-4 p-6">
              <h2 className="text-xl font-semibold">Activity log retention</h2>
              <p className="text-sm text-muted">
                Automatically delete Alexa activity events older than the configured number of days. Cleanup runs daily.
              </p>
              <label className="block space-y-1">
                <span className="text-sm text-muted">Keep events for (days)</span>
                <input
                  id="alexa-events-retention-days"
                  className="input"
                  type="number"
                  min={1}
                  max={365}
                  value={alexaEventsRetentionDays}
                  onChange={(e) => setAlexaEventsRetentionDays(Number(e.target.value))}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-primary" type="submit" disabled={retentionBusy}>
                  {retentionBusy ? 'Saving…' : 'Save retention'}
                </button>
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={cleanupBusy}
                  onClick={runCleanup}
                >
                  {cleanupBusy ? 'Running…' : 'Run cleanup now'}
                </button>
              </div>
              {retentionMessage && <p className="text-sm text-success" role="status">{retentionMessage}</p>}
              {retentionError && <p className="text-sm text-danger" role="alert">{retentionError}</p>}
            </form>

            <form onSubmit={updatePassword} className="card space-y-4 p-6">
              <h2 className="text-xl font-semibold">Change admin password</h2>
              <Field label="Username" value={adminUsername} onChange={setAdminUsername} />
              <Field label="Current password" value={currentPassword} onChange={setCurrentPassword} type="password" />
              <Field label="New password" value={newPassword} onChange={setNewPassword} type="password" />
              <button className="btn btn-secondary" type="submit">Update password</button>
              {passwordMessage && <p className="text-sm text-success" role="status">{passwordMessage}</p>}
              {passwordError && <p className="text-sm text-danger" role="alert">{passwordError}</p>}
            </form>
          </>
        )}
      </div>

      <AlexaSetupChecklist
        invocationName={invocationName}
        locale={locale}
        publicUrl={publicUrl}
      />

      <ConfirmDialog
        open={disconnectOpen}
        title="Disconnect Plex"
        description="Disconnect Plex account and clear stored credentials?"
        confirmLabel="Disconnect"
        danger
        busy={disconnectBusy}
        onConfirm={confirmDisconnect}
        onCancel={closeDisconnect}
      />
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  type = 'text',
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  type?: string;
  error?: string;
}) {
  const id = label.toLowerCase().replace(/\s+/g, '-');
  return (
    <label className="block space-y-1" htmlFor={id}>
      <span className="text-sm text-muted">{label}</span>
      <input
        id={id}
        className="input"
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        aria-invalid={Boolean(error)}
      />
      {error && <p className="text-xs text-danger" role="alert">{error}</p>}
    </label>
  );
}
