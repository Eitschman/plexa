import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPage } from '../pages/SettingsPage';

vi.mock('../lib/api', () => ({
  api: vi.fn(),
  fetchCsrf: vi.fn().mockResolvedValue('csrf'),
  startPlexOAuth: vi.fn(),
  getPlexOAuthStatus: vi.fn(),
  selectPlexServer: vi.fn(),
  fetchPlexServers: vi.fn().mockResolvedValue([]),
  disconnectPlex: vi.fn(),
  changePassword: vi.fn(),
}));

import { api, changePassword, disconnectPlex, fetchCsrf, startPlexOAuth } from '../lib/api';

const connectedSettings = {
  plexUrl: 'https://plex.example',
  hasPlexToken: true,
  hasPlexAccountToken: true,
  musicLibraryId: '1',
  publicUrl: null,
  alexaSkillId: null,
  invocationName: 'plexa',
  locale: 'en-US',
  plexAccountEmail: 'user@example.com',
  plexServerName: 'Home',
  plexServerMachineId: 'machine-1',
  updatedAt: new Date().toISOString(),
};

function mockConnectedSettings() {
  vi.mocked(api).mockImplementation(async (path: string, options?: RequestInit) => {
    if (path === '/api/settings' && options?.method === 'PUT') {
      throw new Error('Unexpected settings save');
    }
    if (path === '/api/settings') return connectedSettings;
    if (path === '/api/plex/libraries') return { items: [] };
    throw new Error(`Unexpected path: ${path}`);
  });
}

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    vi.mocked(startPlexOAuth).mockReset();
    vi.mocked(disconnectPlex).mockReset();
    vi.mocked(changePassword).mockReset();
    window.open = vi.fn();
  });

  it('loads settings and starts plex oauth', async () => {
    const user = userEvent.setup();
    vi.mocked(api)
      .mockResolvedValueOnce({
        plexUrl: null,
        hasPlexToken: false,
        hasPlexAccountToken: false,
        musicLibraryId: null,
        publicUrl: null,
        alexaSkillId: null,
        invocationName: 'plexa',
        locale: 'en-US',
        plexAccountEmail: null,
        plexServerName: null,
        plexServerMachineId: null,
        updatedAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({ items: [] });
    vi.mocked(startPlexOAuth).mockResolvedValue({
      authId: 'auth-1',
      authUrl: 'https://app.plex.tv/auth',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    render(<SettingsPage />);
    expect(await screen.findByRole('heading', { name: /sign in with plex/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /sign in with plex/i }));
    await waitFor(() => expect(startPlexOAuth).toHaveBeenCalled());
    expect(window.open).toHaveBeenCalledWith('https://app.plex.tv/auth', '_blank', 'noopener,noreferrer');
  });

  it('disconnects Plex via ConfirmDialog instead of window.confirm', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm');
    const connectedSettings = {
      plexUrl: 'https://plex.example',
      hasPlexToken: true,
      hasPlexAccountToken: true,
      musicLibraryId: '1',
      publicUrl: null,
      alexaSkillId: null,
      invocationName: 'plexa',
      locale: 'en-US',
      plexAccountEmail: 'user@example.com',
      plexServerName: 'Home',
      plexServerMachineId: 'machine-1',
      updatedAt: new Date().toISOString(),
    };
    const disconnectedSettings = {
      ...connectedSettings,
      plexUrl: null,
      hasPlexToken: false,
      hasPlexAccountToken: false,
      musicLibraryId: null,
      plexAccountEmail: null,
      plexServerName: null,
      plexServerMachineId: null,
    };

    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === '/api/settings') return connectedSettings;
      if (path === '/api/plex/libraries') return { items: [] };
      throw new Error(`Unexpected path: ${path}`);
    });
    vi.mocked(disconnectPlex).mockResolvedValue(undefined);

    render(<SettingsPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: /Plex Server/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Plex Server/i }));

    expect(await screen.findByRole('button', { name: /^Disconnect$/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Disconnect$/i }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Disconnect Plex' })).toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled();

    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === '/api/settings') return disconnectedSettings;
      if (path === '/api/plex/libraries') return { items: [] };
      throw new Error(`Unexpected path: ${path}`);
    });

    await user.click(within(dialog).getByRole('button', { name: /^Disconnect$/i }));

    await waitFor(() => expect(disconnectPlex).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    confirmSpy.mockRestore();
  });

  it('blocks save and shows an error for invalid public HTTPS URLs', async () => {
    const user = userEvent.setup();
    mockConnectedSettings();

    render(<SettingsPage />);

    const publicUrlInput = await screen.findByLabelText(/public https url/i);
    await user.clear(publicUrlInput);
    await user.type(publicUrlInput, 'http://example.com');
    await user.click(screen.getByRole('button', { name: /save settings/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('URL must use HTTPS');
    expect(api).not.toHaveBeenCalledWith('/api/settings', expect.objectContaining({ method: 'PUT' }));
  });

  it('saves a normalized public HTTPS URL', async () => {
    const user = userEvent.setup();
    const savedSettings = {
      ...connectedSettings,
      publicUrl: 'https://example.com',
    };

    vi.mocked(api).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/api/settings' && options?.method === 'PUT') {
        const body = JSON.parse(options.body as string) as { publicUrl: string | null };
        expect(body.publicUrl).toBe('https://example.com');
        return savedSettings;
      }
      if (path === '/api/settings') return connectedSettings;
      if (path === '/api/plex/libraries') return { items: [] };
      throw new Error(`Unexpected path: ${path}`);
    });

    render(<SettingsPage />);

    const publicUrlInput = await screen.findByLabelText(/public https url/i);
    await user.clear(publicUrlInput);
    await user.type(publicUrlInput, 'https://example.com/');
    await user.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => expect(fetchCsrf).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Settings saved.'));
    expect(publicUrlInput).toHaveValue('https://example.com');
  });

  it('shows retention and password only on Configuration tab', async () => {
    const user = userEvent.setup();
    vi.mocked(api)
      .mockResolvedValueOnce({
        plexUrl: null,
        hasPlexToken: false,
        hasPlexAccountToken: false,
        musicLibraryId: null,
        publicUrl: null,
        alexaSkillId: null,
        invocationName: 'plexa',
        locale: 'en-US',
        plexAccountEmail: null,
        plexServerName: null,
        plexServerMachineId: null,
        updatedAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({ items: [] });

    render(<SettingsPage />);

    await screen.findByRole('heading', { name: /sign in with plex/i });
    expect(screen.queryByRole('heading', { name: /activity log retention/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /change admin password/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Configuration/i }));

    expect(await screen.findByRole('heading', { name: /activity log retention/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /change admin password/i })).toBeInTheDocument();
  });

  it('does not show Configuration save card on Plex Server tab', async () => {
    vi.mocked(api)
      .mockResolvedValueOnce({
        plexUrl: null,
        hasPlexToken: false,
        hasPlexAccountToken: false,
        musicLibraryId: null,
        publicUrl: null,
        alexaSkillId: null,
        invocationName: 'plexa',
        locale: 'en-US',
        plexAccountEmail: null,
        plexServerName: null,
        plexServerMachineId: null,
        updatedAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({ items: [] });

    render(<SettingsPage />);

    await screen.findByRole('heading', { name: /sign in with plex/i });
    expect(screen.queryByRole('heading', { name: /^Configuration$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save settings/i })).not.toBeInTheDocument();
  });

  it('keeps Plex disconnect feedback on Plex Server tab only', async () => {
    const user = userEvent.setup();
    const connectedSettings = {
      plexUrl: 'https://plex.example',
      hasPlexToken: true,
      hasPlexAccountToken: true,
      musicLibraryId: '1',
      publicUrl: null,
      alexaSkillId: null,
      invocationName: 'plexa',
      locale: 'en-US',
      plexAccountEmail: 'user@example.com',
      plexServerName: 'Home',
      plexServerMachineId: 'machine-1',
      updatedAt: new Date().toISOString(),
    };
    const disconnectedSettings = {
      ...connectedSettings,
      plexUrl: null,
      hasPlexToken: false,
      hasPlexAccountToken: false,
      musicLibraryId: null,
      plexAccountEmail: null,
      plexServerName: null,
      plexServerMachineId: null,
    };

    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === '/api/settings') return connectedSettings;
      if (path === '/api/plex/libraries') return { items: [] };
      throw new Error(`Unexpected path: ${path}`);
    });
    vi.mocked(disconnectPlex).mockResolvedValue(undefined);

    render(<SettingsPage />);

    await user.click(await screen.findByRole('button', { name: /Plex Server/i }));
    await user.click(screen.getByRole('button', { name: /^Disconnect$/i }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Disconnect$/i }));

    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === '/api/settings') return disconnectedSettings;
      if (path === '/api/plex/libraries') return { items: [] };
      throw new Error(`Unexpected path: ${path}`);
    });

    expect(await screen.findByRole('status')).toHaveTextContent('Plex disconnected.');

    await user.click(screen.getByRole('button', { name: /Configuration/i }));
    expect(screen.queryByText('Plex disconnected.')).not.toBeInTheDocument();
  });

  it('keeps Configuration save feedback on Configuration tab only', async () => {
    const user = userEvent.setup();
    const savedSettings = {
      ...connectedSettings,
      publicUrl: 'https://example.com',
    };

    vi.mocked(api).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/api/settings' && options?.method === 'PUT') return savedSettings;
      if (path === '/api/settings') return connectedSettings;
      if (path === '/api/plex/libraries') return { items: [] };
      throw new Error(`Unexpected path: ${path}`);
    });

    render(<SettingsPage />);

    const publicUrlInput = await screen.findByLabelText(/public https url/i);
    await user.clear(publicUrlInput);
    await user.type(publicUrlInput, 'https://example.com/');
    await user.click(screen.getByRole('button', { name: /save settings/i }));

    expect(await screen.findByRole('status')).toHaveTextContent('Settings saved.');

    await user.click(screen.getByRole('button', { name: /Plex Server/i }));
    expect(screen.queryByText('Settings saved.')).not.toBeInTheDocument();
  });

  it('offers French and German skill locales and saves the selection', async () => {
    const user = userEvent.setup();
    const savedSettings = { ...connectedSettings, locale: 'fr-FR' };

    vi.mocked(api).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/api/settings' && options?.method === 'PUT') {
        const body = JSON.parse(options.body as string) as { locale: string };
        expect(body.locale).toBe('fr-FR');
        return savedSettings;
      }
      if (path === '/api/settings') return connectedSettings;
      if (path === '/api/plex/libraries') return { items: [] };
      throw new Error(`Unexpected path: ${path}`);
    });

    render(<SettingsPage />);

    const select = await screen.findByLabelText(/alexa skill locale/i);
    expect(screen.getByRole('option', { name: /Français \(France\) \(fr-FR\)/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Deutsch \(Deutschland\) \(de-DE\)/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /English \(UK\) \(en-GB\)/ })).toBeInTheDocument();
    await user.selectOptions(select, 'fr-FR');
    await user.click(screen.getByRole('button', { name: /save settings/i }));

    expect(await screen.findByRole('status')).toHaveTextContent('Settings saved.');
  });

  it('hydrates a saved German skill locale', async () => {
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === '/api/settings') return { ...connectedSettings, locale: 'de-DE' };
      if (path === '/api/plex/libraries') return { items: [] };
      throw new Error(`Unexpected path: ${path}`);
    });

    render(<SettingsPage />);

    expect(await screen.findByLabelText(/alexa skill locale/i)).toHaveValue('de-DE');
  });

  it('shows password feedback in the password form only', async () => {
    const user = userEvent.setup();
    mockConnectedSettings();
    vi.mocked(changePassword).mockResolvedValue(undefined);

    render(<SettingsPage />);

    await user.type(await screen.findByLabelText(/^Current password$/i), 'old-pass');
    await user.type(screen.getByLabelText(/^New password$/i), 'new-pass');
    await user.click(screen.getByRole('button', { name: /update password/i }));

    expect(await screen.findByRole('status')).toHaveTextContent('Password updated.');

    await user.click(screen.getByRole('button', { name: /Plex Server/i }));
    expect(screen.queryByText('Password updated.')).not.toBeInTheDocument();
  });
});
