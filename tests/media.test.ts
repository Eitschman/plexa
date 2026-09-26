import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  createSignedMediaPath,
  createSignedMediaUrl,
  createSignedSegmentPath,
  toPublicMediaUrl,
  verifySignedToken,
  artUrlForTrack,
  resolveAudioDelivery,
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
      buildAudioTranscodeUrl: vi.fn(),
      buildTranscodeUrl: vi.fn(),
      buildTranscodeStopUrl: vi.fn(),
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

describe('audio delivery compatibility', () => {
  beforeEach(() => {
    vi.mocked(plexAdapter.getMediaParts).mockReset();
    vi.mocked(plexAdapter.buildDirectStreamUrl).mockReset();
    vi.mocked(plexAdapter.buildAudioTranscodeUrl).mockReset();
    vi.mocked(plexAdapter.buildTranscodeUrl).mockReset();
    vi.mocked(plexAdapter.buildTranscodeStopUrl).mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['audio/flac', undefined],
    ['application/octet-stream', 'flac'],
  ])('direct-plays FLAC on web for %s', async (contentType, container) => {
    vi.mocked(plexAdapter.getMediaParts).mockResolvedValue([{
      key: '/part/flac',
      mediaIndex: 1,
      partIndex: 2,
      container,
      audioCodec: 'flac',
    }]);
    vi.mocked(plexAdapter.buildDirectStreamUrl).mockReturnValue('https://plex/part/flac');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': contentType }),
    }));

    await expect(resolveAudioDelivery('42', 'web')).resolves.toEqual({
      url: 'https://plex/part/flac',
      mode: 'direct',
    });
    expect(plexAdapter.buildAudioTranscodeUrl).not.toHaveBeenCalled();
  });

  it('transcodes the same FLAC part to MP3 for Alexa', async () => {
    vi.mocked(plexAdapter.getMediaParts).mockResolvedValue([{
      key: '/part/flac',
      mediaIndex: 1,
      partIndex: 2,
      container: 'flac',
      audioCodec: 'flac',
      durationMs: 180000,
    }]);
    vi.mocked(plexAdapter.buildDirectStreamUrl).mockReturnValue('https://plex/part/flac');
    vi.mocked(plexAdapter.buildAudioTranscodeUrl).mockReturnValue('https://plex/start.mp3');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'audio/flac' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(resolveAudioDelivery('42', 'alexa')).resolves.toEqual({
      url: 'https://plex/start.mp3',
      mode: 'transcode',
      sessionId: expect.any(String),
      ratingKey: '42',
      mediaIndex: 1,
      partIndex: 2,
      bitrateKbps: 320,
      durationMs: 180000,
    });
    expect(plexAdapter.buildAudioTranscodeUrl).toHaveBeenCalledWith('42', {
      sessionId: expect.any(String),
      mediaIndex: 1,
      partIndex: 2,
      bitrateKbps: 320,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('https://plex/part/flac', { method: 'HEAD' });
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
    vi.mocked(plexAdapter.buildAudioTranscodeUrl).mockReset();
    vi.mocked(plexAdapter.buildTranscodeUrl).mockReset();
    vi.mocked(plexAdapter.buildTranscodeStopUrl).mockReset();
  });

  it('reconnects Plex before proxying audio', async () => {
    const path = createSignedMediaPath('12345', 'audio');
    const token = path.replace(/^\/media\//, '');

    vi.mocked(plexAdapter.getMediaParts).mockResolvedValue([{
      key: '/part/1',
      mediaIndex: 0,
      partIndex: 0,
    }]);
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

  it('reports a finite length and byte ranges for an MP3 transcode', async () => {
    const path = createSignedMediaPath('42', 'audio', undefined, 'alexa');
    const token = path.replace(/^\/media\//, '');
    vi.mocked(plexAdapter.getMediaParts).mockResolvedValue([{
      key: '/part/flac',
      mediaIndex: 0,
      partIndex: 0,
      container: 'flac',
      audioCodec: 'flac',
      durationMs: 1000,
    }]);
    vi.mocked(plexAdapter.buildDirectStreamUrl).mockReturnValue('https://plex/part/flac');
    vi.mocked(plexAdapter.buildAudioTranscodeUrl).mockReturnValue('https://plex/start.mp3');
    vi.mocked(plexAdapter.buildTranscodeStopUrl).mockReturnValue('https://plex/stop');

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x49, 0x44, 0x33]));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/part/flac')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'audio/flac' }),
        });
      }
      if (url.endsWith('/start.mp3')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'audio/mpeg' }),
          body,
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
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
    const headers: Record<string, string> = {};
    const state = { statusCode: 200, writableEnded: false, bytesWritten: 0 };
    const res = {
      status(code: number) {
        state.statusCode = code;
        return this;
      },
      setHeader(key: string, value: string) {
        headers[key.toLowerCase()] = value;
        return this;
      },
      end() {
        state.writableEnded = true;
        return this;
      },
      write(chunk: Uint8Array) {
        state.bytesWritten += chunk.byteLength;
        return true;
      },
    } as unknown as import('express').Response;

    const { handleMediaRequest } = await import('../src/media/gateway.js');
    await handleMediaRequest(req, res);

    expect(headers['content-type']).toBe('audio/mpeg');
    expect(headers['content-length']).toBe('40000');
    expect(headers['accept-ranges']).toBe('bytes');
    expect(state.statusCode).toBe(200);
    expect(state.bytesWritten).toBe(40000);
    expect(plexAdapter.buildTranscodeStopUrl).toHaveBeenCalledWith(expect.any(String));
  });

  it('honors the end of AppleCoreMedia byte probe ranges', async () => {
    const path = createSignedMediaPath('42', 'audio', undefined, 'alexa');
    const token = path.replace(/^\/media\//, '');
    vi.mocked(plexAdapter.getMediaParts).mockResolvedValue([{
      key: '/part/flac',
      mediaIndex: 0,
      partIndex: 0,
      container: 'flac',
      audioCodec: 'flac',
      durationMs: 1000,
    }]);
    vi.mocked(plexAdapter.buildDirectStreamUrl).mockReturnValue('https://plex/part/flac');
    vi.mocked(plexAdapter.buildAudioTranscodeUrl).mockReturnValue('https://plex/start.mp3');
    vi.mocked(plexAdapter.buildTranscodeStopUrl).mockReturnValue('https://plex/stop');

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x49, 0x44, 0x33]));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/part/flac')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'audio/flac' }),
        });
      }
      if (url.endsWith('/start.mp3')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'audio/mpeg' }),
          body,
        });
      }
      return Promise.resolve({ ok: true, status: 200 });
    }));

    const req = {
      params: { token },
      method: 'GET',
      headers: { range: 'bytes=0-1' },
      on() {},
      off() {},
    } as unknown as import('express').Request;
    const headers: Record<string, string> = {};
    const state = { statusCode: 200, bytesWritten: 0 };
    const res = {
      status(code: number) {
        state.statusCode = code;
        return this;
      },
      setHeader(key: string, value: string) {
        headers[key.toLowerCase()] = value;
        return this;
      },
      end() {
        return this;
      },
      write(chunk: Uint8Array) {
        state.bytesWritten += chunk.byteLength;
        return true;
      },
    } as unknown as import('express').Response;

    const { handleMediaRequest } = await import('../src/media/gateway.js');
    await handleMediaRequest(req, res);

    expect(state.statusCode).toBe(206);
    expect(headers['content-length']).toBe('2');
    expect(headers['content-range']).toBe('bytes 0-1/40000');
    expect(state.bytesWritten).toBe(2);
    expect(plexAdapter.buildAudioTranscodeUrl).toHaveBeenCalledTimes(1);
  });

  it('translates byte ranges into Plex transcode time offsets', async () => {
    const path = createSignedMediaPath('42', 'audio', undefined, 'alexa');
    const token = path.replace(/^\/media\//, '');
    vi.mocked(plexAdapter.getMediaParts).mockResolvedValue([{
      key: '/part/flac',
      mediaIndex: 1,
      partIndex: 2,
      container: 'flac',
      audioCodec: 'flac',
      durationMs: 60000,
    }]);
    vi.mocked(plexAdapter.buildDirectStreamUrl).mockReturnValue('https://plex/part/flac');
    vi.mocked(plexAdapter.buildAudioTranscodeUrl).mockReturnValue('https://plex/start.mp3');
    vi.mocked(plexAdapter.buildTranscodeStopUrl).mockReturnValue('https://plex/stop');

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x49, 0x44, 0x33]));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockImplementation(
      (url: string) => {
        if (url.endsWith('/part/flac')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'audio/flac' }),
          });
        }
        if (url.endsWith('/start.mp3')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'audio/mpeg' }),
            body,
          });
        }
        return Promise.resolve({ ok: true, status: 200 });
      },
    ));

    const req = {
      params: { token },
      method: 'GET',
      headers: { range: 'bytes=1200000-' },
      on() {},
      off() {},
    } as unknown as import('express').Request;
    const headers: Record<string, string> = {};
    const state = { statusCode: 200, bytesWritten: 0 };
    const res = {
      status(code: number) {
        state.statusCode = code;
        return this;
      },
      setHeader(key: string, value: string) {
        headers[key.toLowerCase()] = value;
        return this;
      },
      end() {
        return this;
      },
      write(chunk: Uint8Array) {
        state.bytesWritten += chunk.byteLength;
        return true;
      },
    } as unknown as import('express').Response;

    const { handleMediaRequest } = await import('../src/media/gateway.js');
    await handleMediaRequest(req, res);

    expect(state.statusCode).toBe(206);
    expect(headers['content-range']).toBe('bytes 1200000-2399999/2400000');
    expect(headers['content-length']).toBe('1200000');
    expect(headers['accept-ranges']).toBe('bytes');
    expect(state.bytesWritten).toBe(1200000);
    expect(plexAdapter.buildAudioTranscodeUrl).toHaveBeenLastCalledWith('42', {
      sessionId: expect.any(String),
      mediaIndex: 1,
      partIndex: 2,
      bitrateKbps: 320,
      offsetSec: 30,
    });
  });

  it('falls back to HLS when the MP3 transcode GET fails', async () => {
    const path = createSignedMediaPath('42', 'audio', undefined, 'alexa');
    const token = path.replace(/^\/media\//, '');
    vi.mocked(plexAdapter.getMediaParts).mockResolvedValue([{
      key: '/part/flac',
      mediaIndex: 0,
      partIndex: 0,
      container: 'flac',
      audioCodec: 'flac',
      durationMs: 1000,
    }]);
    vi.mocked(plexAdapter.buildDirectStreamUrl).mockReturnValue('https://plex/part/flac');
    vi.mocked(plexAdapter.buildAudioTranscodeUrl).mockReturnValue('https://plex/start.mp3');
    vi.mocked(plexAdapter.buildTranscodeUrl).mockReturnValue('https://plex/start.m3u8');
    vi.mocked(plexAdapter.buildTranscodeStopUrl).mockReturnValue('https://plex/stop');
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/part/flac')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'audio/flac' }),
        });
      }
      if (url.endsWith('/start.mp3')) {
        return Promise.resolve({
          ok: false,
          status: 400,
          body: null,
          text: () => Promise.resolve('<html>Bad Request</html>'),
        });
      }
      if (url.endsWith('/start.m3u8')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve('#EXTM3U\nsegment.ts'),
        });
      }
      return Promise.resolve({ ok: true, status: 200 });
    }));

    const req = {
      params: { token },
      method: 'GET',
      headers: { range: 'bytes=0-1' },
      on() {},
      off() {},
    } as unknown as import('express').Request;
    const headers: Record<string, string> = {};
    const state = { statusCode: 200, body: '' };
    const res = {
      headersSent: false,
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
      send(body: string) {
        state.body = body;
        return this;
      },
      end() {
        return this;
      },
    } as unknown as import('express').Response;

    const { handleMediaRequest } = await import('../src/media/gateway.js');
    await handleMediaRequest(req, res);

    expect(state.statusCode).toBe(200);
    expect(headers['content-type']).toBe('application/vnd.apple.mpegurl');
    expect(state.body).toContain('/media/seg/');
    expect(plexAdapter.buildTranscodeUrl).toHaveBeenCalledWith(
      '42',
      expect.any(String),
      0,
      0,
    );
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
