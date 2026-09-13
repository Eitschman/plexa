import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  createSignedMediaPath,
  createSignedMediaUrl,
  createSignedSegmentPath,
  toPublicMediaUrl,
  verifySignedToken,
  artUrlForTrack,
  stripPlexTokenFromUrlForTests,
  resolveManifestUriForTests,
} from '../src/media/gateway.js';
import { resetEnvForTests } from '../src/config/index.js';
import { closeDb } from '../src/db/index.js';
import { plexAdapter } from '../src/plex/adapter.js';
import { requirePlexConnected } from '../src/plex/auth.js';

vi.mock('../src/plex/auth.js', async () => {
  const actual = await vi.importActual<typeof import('../src/plex/auth.js')>('../src/plex/auth.js');
  return {
    ...actual,
    requirePlexConnected: vi.fn(),
  };
});

vi.mock('../src/plex/adapter.js', async () => {
  const actual = await vi.importActual<typeof import('../src/plex/adapter.js')>('../src/plex/adapter.js');
  return {
    ...actual,
    plexAdapter: {
      ...actual.plexAdapter,
      buildArtworkUrl: vi.fn(),
      getMediaParts: vi.fn(),
      buildDirectStreamUrl: vi.fn(),
    },
  };
});

describe('signed media urls', () => {
  beforeEach(() => {
    process.env.PUBLIC_URL = 'https://example.com';
    resetEnvForTests();
    closeDb();
    vi.mocked(requirePlexConnected).mockResolvedValue(undefined);
    vi.mocked(plexAdapter.getMediaParts).mockReset();
    vi.mocked(plexAdapter.buildDirectStreamUrl).mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(plexAdapter.buildArtworkUrl).mockReset();
    vi.mocked(requirePlexConnected).mockReset();
  });

  it('creates relative signed paths without requiring PUBLIC_URL', () => {
    delete process.env.PUBLIC_URL;
    resetEnvForTests();
    closeDb();

    const path = createSignedMediaPath('12345', 'audio');
    expect(path).toMatch(/^\/media\/.+\..+$/);
    const match = path.match(/^\/media\/(.+)\.(.+)$/);
    expect(match).toBeTruthy();
    const payload = verifySignedToken(match![1], match![2]);
    expect(payload?.kind).toBe('audio');
    if (payload?.kind === 'audio') expect(payload.ratingKey).toBe('12345');
  });

  it('creates and verifies absolute signed urls when PUBLIC_URL is set', () => {
    const url = createSignedMediaUrl('12345', 'audio');
    expect(url).toBeTruthy();
    expect(url!.startsWith('https://example.com/media/')).toBe(true);
    const match = url!.match(/\/media\/(.+)\.(.+)$/);
    expect(match).toBeTruthy();
    const payload = verifySignedToken(match![1], match![2]);
    expect(payload?.kind).toBe('audio');
    if (payload?.kind === 'audio') expect(payload.ratingKey).toBe('12345');
  });

  it('rejects tampered signatures', () => {
    const path = createSignedMediaPath('12345', 'audio');
    const match = path.match(/\/media\/(.+)\.(.+)$/);
    const payload = verifySignedToken(match![1], 'tampered');
    expect(payload).toBeNull();
  });

  it('absolutizes relative media paths for Alexa', () => {
    const path = createSignedMediaPath('99', 'artwork');
    expect(toPublicMediaUrl(path)).toBe(`https://example.com${path}`);
    expect(toPublicMediaUrl('https://cdn.example/x')).toBe('https://cdn.example/x');
  });

  it('returns null when absolutizing without PUBLIC_URL', () => {
    delete process.env.PUBLIC_URL;
    resetEnvForTests();
    closeDb();
    expect(toPublicMediaUrl('/media/token.sig')).toBeNull();
    expect(createSignedMediaUrl('1', 'audio')).toBeNull();
  });

  it('builds signed playlist track artwork urls only when thumb exists', () => {
    const withArt = artUrlForTrack('42', '/library/metadata/42/thumb/0');
    expect(withArt).toMatch(/^\/artwork\/.+\..+$/);
    const match = withArt!.match(/^\/artwork\/(.+)\.(.+)$/);
    expect(match).toBeTruthy();
    const payload = verifySignedToken(match![1], match![2]);
    expect(payload?.kind).toBe('artwork');
    if (payload?.kind === 'artwork') {
      expect(payload.ratingKey).toBe('42');
      expect(payload.thumb).toBe('/library/metadata/42/thumb/0');
    }

    expect(artUrlForTrack('42')).toBeUndefined();
    expect(artUrlForTrack('42', undefined)).toBeUndefined();
  });

  it('does not expose Plex token in signed artwork payload', () => {
    const path = artUrlForTrack(
      '42',
      'https://example.plex.direct:32400/library/metadata/42/thumb/123?X-Plex-Token=super-secret-token',
    );

    expect(path).toBeDefined();
    expect(path).not.toContain('super-secret-token');

    const token = path!.split('/artwork/')[1];
    const encoded = token.split('.')[0];

    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as {
      ratingKey: string;
      kind: string;
      thumb?: string;
    };

    expect(payload.ratingKey).toBe('42');
    expect(payload.kind).toBe('artwork');
    expect(payload.thumb).toBe('/library/metadata/42/thumb/123');
    expect(payload.thumb).not.toContain('X-Plex-Token');
  });

  it('rejects artwork tokens that omit thumb with a clean 404', async () => {
    const { handleArtworkRequest } = await import('../src/media/gateway.js');
    const path = createSignedMediaPath('99', 'artwork');
    const token = path.replace(/^\/artwork\//, '');
    const req = {
      params: { token },
      method: 'GET',
      headers: {},
      on() {},
      off() {},
    } as unknown as import('express').Request;

    const state = { statusCode: 200, body: '' };
    const res = {
      status(code: number) {
        state.statusCode = code;
        return this;
      },
      type(_contentType: string) {
        return this;
      },
      send(body: string) {
        state.body = body;
        return this;
      },
    } as unknown as import('express').Response;

    await handleArtworkRequest(req, res);
    expect(state.statusCode).toBe(404);
    expect(state.body).toBe('Not found');
  });

  it('sets cache-control on successful artwork proxy responses', async () => {
    const thumb = '/library/metadata/99/thumb/0';
    const path = createSignedMediaPath('99', 'artwork', thumb);
    const token = path.replace(/^\/artwork\//, '');

    vi.mocked(plexAdapter.buildArtworkUrl).mockReturnValue('https://plex.example.com/thumb.jpg');

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0xff, 0xd8, 0xff]));
        controller.close();
      },
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      body,
    });
    vi.stubGlobal('fetch', fetchMock);

    const req = {
      params: { token },
      method: 'GET',
      headers: {},
      on() {},
      off() {},
    } as unknown as import('express').Request;

    const headers: Record<string, string> = {};
    const state = { statusCode: 200, writableEnded: false };
    const res = {
      status(code: number) {
        state.statusCode = code;
        return this;
      },
      setHeader(key: string, value: string) {
        headers[key.toLowerCase()] = value;
        return this;
      },
      type() {
        return this;
      },
      end() {
        state.writableEnded = true;
        return this;
      },
      write() {
        return true;
      },
    } as unknown as import('express').Response;

    const { handleArtworkRequest } = await import('../src/media/gateway.js');
    await handleArtworkRequest(req, res);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://plex.example.com/thumb.jpg',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(headers['cache-control']).toBe('public, max-age=3600, immutable');
    expect(headers['content-type']).toBe('image/jpeg');
  });

  it('creates signed segment paths without exposing plex tokens', () => {
    const path = createSignedSegmentPath('/video/:/transcode/universal/session/seg-1.ts');
    expect(path).toMatch(/^\/media\/seg\/.+\..+$/);
    const match = path.match(/^\/media\/seg\/(.+)\.(.+)$/);
    expect(match).toBeTruthy();
    const payload = verifySignedToken(match![1], match![2]);
    expect(payload?.kind).toBe('segment');
    if (payload?.kind === 'segment') {
      expect(payload.path).toBe('/video/:/transcode/universal/session/seg-1.ts');
      expect(JSON.stringify(payload)).not.toContain('X-Plex-Token');
    }
  });

  it('strips plex tokens from upstream urls', () => {
    const stripped = stripPlexTokenFromUrlForTests(
      'https://plex.example.com/video/:/transcode/universal/session/seg-1.ts?X-Plex-Token=secret',
    );
    expect(stripped).toBe('/video/:/transcode/universal/session/seg-1.ts');
    expect(stripped).not.toContain('secret');
  });

  it('resolves relative manifest uris against the manifest base', () => {
    const resolved = resolveManifestUriForTests(
      'https://plex.example.com/music/:/transcode/universal/start.m3u8?session=1',
      'seg-1-v1-a1.ts',
    );
    expect(resolved).toBe('https://plex.example.com/music/:/transcode/universal/seg-1-v1-a1.ts');
  });
});

describe('media proxy reconnect', () => {
  beforeEach(() => {
    process.env.PUBLIC_URL = 'https://example.com';
    resetEnvForTests();
    closeDb();
    vi.mocked(requirePlexConnected).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(requirePlexConnected).mockReset();
    vi.mocked(plexAdapter.getMediaParts).mockReset();
    vi.mocked(plexAdapter.buildDirectStreamUrl).mockReset();
  });

  it('reconnects Plex before proxying audio', async () => {
    const path = createSignedMediaPath('12345', 'audio');
    const token = path.replace(/^\/media\//, '');

    vi.mocked(plexAdapter.getMediaParts).mockResolvedValue([{ key: '/part/1' }]);
    vi.mocked(plexAdapter.buildDirectStreamUrl).mockReturnValue('https://plex.example.com/part/1');

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x00]));
        controller.close();
      },
    });

    const fetchMock = vi.fn().mockImplementation((_url: string, opts?: { method?: string }) => {
      if (opts?.method === 'HEAD') {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'audio/mpeg' }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'audio/mpeg' }),
        body,
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const req = {
      params: { token },
      method: 'GET',
      headers: {},
      on() {},
      off() {},
    } as unknown as import('express').Request;

    const state = { statusCode: 200, writableEnded: false };
    const res = {
      status(code: number) {
        state.statusCode = code;
        return this;
      },
      setHeader() {
        return this;
      },
      end() {
        state.writableEnded = true;
        return this;
      },
      write() {
        return true;
      },
    } as unknown as import('express').Response;

    const { handleMediaRequest } = await import('../src/media/gateway.js');
    await handleMediaRequest(req, res);

    expect(requirePlexConnected).toHaveBeenCalled();
    expect(plexAdapter.getMediaParts).toHaveBeenCalledWith('12345');
    expect(state.statusCode).toBe(200);
  });

  it('returns 503 when Plex is not configured', async () => {
    const path = createSignedMediaPath('99', 'audio');
    const token = path.replace(/^\/media\//, '');

    vi.mocked(requirePlexConnected).mockRejectedValue(new Error('Plex not configured'));

    const req = {
      params: { token },
      method: 'GET',
      headers: {},
      on() {},
      off() {},
    } as unknown as import('express').Request;

    const state = { statusCode: 200, body: '' };
    const res = {
      status(code: number) {
        state.statusCode = code;
        return this;
      },
      send(body: string) {
        state.body = body;
        return this;
      },
      headersSent: false,
    } as unknown as import('express').Response;

    const { handleMediaRequest } = await import('../src/media/gateway.js');
    await handleMediaRequest(req, res);

    expect(state.statusCode).toBe(503);
    expect(state.body).toBe('Plex not configured');
  });
});
