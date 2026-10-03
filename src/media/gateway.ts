import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import type { Request, Response } from 'express';
import { getEnv, signPayload } from '../config/index.js';
import { getPublicBaseUrl } from '../services/settings.js';
import { requirePlexConnected } from '../plex/auth.js';
import { plexAdapter, normalizeThumbPath } from '../plex/adapter.js';
import { logger } from '../logger.js';

const MEDIA_TTL_SEC = 3600;
const TRANSCODE_BITRATE_KBPS = 320;
const ALEXA_COMPATIBLE_TYPES = new Set([
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/x-m4a',
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
]);

const WEB_COMPATIBLE_TYPES = new Set([
  ...ALEXA_COMPATIBLE_TYPES,
  'audio/flac',
  'audio/x-flac',
  'audio/ogg',
  'audio/opus',
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
]);

export type AudioTarget = 'web' | 'alexa';

export interface SignedMediaPayload {
  ratingKey: string;
  kind: 'audio' | 'artwork';
  thumb?: string;
  exp: number;
  transcode?: boolean;
  target?: AudioTarget;
}

export interface SignedSegmentPayload {
  kind: 'segment';
  path: string;
  exp: number;
}

type SignedPayload = SignedMediaPayload | SignedSegmentPayload;

function encodePayload(payload: SignedPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodePayload(encoded: string): SignedPayload | null {
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SignedPayload;
  } catch {
    return null;
  }
}

/** Same-origin path for in-app playback (Vite proxy / Express). */
export function createSignedMediaPath(
  ratingKey: string,
  kind: 'audio' | 'artwork',
  thumb?: string,
  target?: AudioTarget,
): string {
  const env = getEnv();
  const payload: SignedMediaPayload = {
    ratingKey,
    kind,
    thumb,
    target,
    exp: Math.floor(Date.now() / 1000) + MEDIA_TTL_SEC,
  };
  const encoded = encodePayload(payload);
  const sig = signPayload(encoded, env.APP_SECRET);
  const path = kind === 'artwork' ? 'artwork' : 'media';
  return `/${path}/${encoded}.${sig}`;
}

export function createSignedSegmentPath(path: string): string {
  const env = getEnv();
  const payload: SignedSegmentPayload = {
    kind: 'segment',
    path,
    exp: Math.floor(Date.now() / 1000) + MEDIA_TTL_SEC,
  };
  const encoded = encodePayload(payload);
  const sig = signPayload(encoded, env.APP_SECRET);
  return `/media/seg/${encoded}.${sig}`;
}

/** Signed artwork path when Plex metadata includes a thumb; otherwise undefined. */
export function artUrlForTrack(ratingKey: string, thumb?: string): string | undefined {
  if (!thumb) return undefined;
  return createSignedMediaPath(ratingKey, 'artwork', normalizeThumbPath(thumb ?? ''));
}

/** Absolute URL for Alexa (requires PUBLIC_URL / Settings public_url). */
export function createSignedMediaUrl(
  ratingKey: string,
  kind: 'audio' | 'artwork',
  thumb?: string,
  target?: AudioTarget,
): string | null {
  const base = getPublicBaseUrl();
  if (!base) return null;
  return `${base.replace(/\/$/, '')}${createSignedMediaPath(ratingKey, kind, thumb, target)}`;
}

/** Turn a relative /media|/artwork path into an absolute public URL. */
export function toPublicMediaUrl(url: string | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  const base = getPublicBaseUrl();
  if (!base) return null;
  const path = url.startsWith('/') ? url : `/${url}`;
  return `${base.replace(/\/$/, '')}${path}`;
}

export function verifySignedToken(encoded: string, signature: string): SignedPayload | null {
  const env = getEnv();
  const expected = signPayload(encoded, env.APP_SECRET);
  try {
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
  } catch {
    return null;
  }
  const payload = decodePayload(encoded);
  if (!payload || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

function parseTokenParam(param: string): { encoded: string; signature: string } | null {
  const dot = param.lastIndexOf('.');
  if (dot <= 0) return null;
  return { encoded: param.slice(0, dot), signature: param.slice(dot + 1) };
}

function normalizeContentType(contentType: string | null): string | null {
  if (!contentType) return null;
  return contentType.split(';')[0].trim().toLowerCase();
}

function containerToMimeType(container?: string, audioCodec?: string): string | null {
  const value = (container ?? audioCodec)?.trim().toLowerCase();
  switch (value) {
    case 'flac':
      return 'audio/flac';
    case 'mp3':
    case 'mpeg':
      return 'audio/mpeg';
    case 'aac':
      return 'audio/aac';
    case 'm4a':
    case 'mp4':
      return 'audio/mp4';
    case 'ogg':
    case 'oga':
      return 'audio/ogg';
    case 'opus':
      return 'audio/opus';
    case 'wav':
    case 'wave':
      return 'audio/wav';
    case 'webm':
      return 'audio/webm';
    default:
      return null;
  }
}

function isCompatibleAudio(contentType: string | null, target: AudioTarget): boolean {
  if (!contentType) return false;
  const compatibleTypes = target === 'alexa' ? ALEXA_COMPATIBLE_TYPES : WEB_COMPATIBLE_TYPES;
  return compatibleTypes.has(contentType);
}

function isHlsContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const base = contentType.split(';')[0].trim().toLowerCase();
  return base === 'application/vnd.apple.mpegurl' || base === 'application/x-mpegurl';
}

function isHlsUrl(url: string): boolean {
  return /\.m3u8(?:\?|$)/i.test(url);
}

function stripPlexTokenFromUrl(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.delete('X-Plex-Token');
  return `${parsed.pathname}${parsed.search}`;
}

function resolveManifestUri(manifestUrl: string, line: string): string {
  if (/^https?:\/\//i.test(line)) return line;
  return new URL(line, manifestUrl).href;
}

function toPublicSegmentUrl(path: string): string | null {
  const base = getPublicBaseUrl();
  const signed = createSignedSegmentPath(path);
  if (base) return `${base.replace(/\/$/, '')}${signed}`;
  return signed;
}

async function proxyUrl(
  targetUrl: string,
  req: Request,
  res: Response,
  options: { requireOk?: boolean; cacheMaxAge?: number; forwardRange?: boolean } = {},
): Promise<void> {
  const controller = new AbortController();
  const onClose = () => controller.abort();
  req.on('close', onClose);

  const headers: Record<string, string> = {};
  if (options.forwardRange !== false && req.headers.range) {
    headers['Range'] = req.headers.range as string;
  }

  try {
    const upstream = await fetch(targetUrl, {
      headers,
      redirect: 'follow',
      signal: controller.signal,
      method: req.method === 'HEAD' ? 'HEAD' : 'GET',
    });

    if (options.requireOk && !upstream.ok) {
      const status = upstream.status === 404 ? 404 : 502;
      res.status(status).type('text').send(status === 404 ? 'Not found' : 'Upstream error');
      return;
    }

    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (['content-type', 'content-length', 'content-range', 'accept-ranges'].includes(lower)) {
        res.setHeader(key, value);
      }
    });

    if (options.cacheMaxAge !== undefined) {
      res.setHeader('cache-control', `public, max-age=${options.cacheMaxAge}, immutable`);
    }
    if (options.forwardRange === false) {
      res.setHeader('accept-ranges', 'none');
    }

    if (req.method === 'HEAD' || !upstream.body) {
      res.end();
      return;
    }

    const reader = upstream.body.getReader();
    const pump = async (): Promise<void> => {
      const { done, value } = await reader.read();
      if (done) {
        res.end();
        return;
      }
      if (!res.writableEnded) {
        res.write(Buffer.from(value));
        await pump();
      }
    };
    await pump();
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    throw err;
  } finally {
    req.off('close', onClose);
  }
}

async function rewriteHlsManifest(manifestUrl: string, manifestText: string): Promise<string> {
  const lines = manifestText.split(/\r?\n/);
  const rewritten: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      rewritten.push(line);
      continue;
    }

    const absolute = resolveManifestUri(manifestUrl, trimmed);
    const path = stripPlexTokenFromUrl(absolute);
    const publicUrl = toPublicSegmentUrl(path);
    if (!publicUrl) {
      rewritten.push(line);
      continue;
    }
    rewritten.push(publicUrl);
  }

  return rewritten.join('\n');
}

async function serveHlsManifest(manifestUrl: string, req: Request, res: Response): Promise<void> {
  const upstream = await fetch(manifestUrl, { method: 'GET' });
  if (!upstream.ok) {
    res.status(upstream.status === 404 ? 404 : 502).type('text').send('Upstream error');
    return;
  }
  const text = await upstream.text();
  const rewritten = await rewriteHlsManifest(manifestUrl, text);
  res.status(200);
  res.setHeader('content-type', 'application/vnd.apple.mpegurl');
  res.setHeader('cache-control', 'public, max-age=0');
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.send(rewritten);
}

export type AudioDeliveryMode = 'direct' | 'transcode' | 'hls';
export type AudioDelivery =
  | { mode: 'direct' | 'hls'; url: string }
  | {
      mode: 'transcode';
      url: string;
      sessionId: string;
      ratingKey: string;
      mediaIndex: number;
      partIndex: number;
      bitrateKbps: number;
      durationMs?: number;
    };

export async function resolveAudioDelivery(
  ratingKey: string,
  target: AudioTarget = 'web',
): Promise<AudioDelivery> {
  const parts = await plexAdapter.getMediaParts(ratingKey);
  if (parts.length === 0) throw new Error('No media parts');

  const part = parts[0];
  const directUrl = plexAdapter.buildDirectStreamUrl(part.key);
  const directHead = await fetch(directUrl, { method: 'HEAD' });
  const upstreamContentType = directHead.headers.get('content-type');
  const normalizedContentType = normalizeContentType(upstreamContentType);
  const contentType =
    !normalizedContentType || normalizedContentType === 'application/octet-stream'
      ? containerToMimeType(part.container, part.audioCodec)
      : normalizedContentType;
  if (
    directHead.ok &&
    isCompatibleAudio(contentType, target) &&
    !isHlsContentType(upstreamContentType)
  ) {
    logger.debug({ ratingKey, target, mode: 'direct', contentType }, 'Resolved direct audio stream');
    return { url: directUrl, mode: 'direct' };
  }

  const sessionId = randomUUID();
  const transcodeUrl = plexAdapter.buildAudioTranscodeUrl(ratingKey, {
    sessionId,
    mediaIndex: part.mediaIndex,
    partIndex: part.partIndex,
    bitrateKbps: TRANSCODE_BITRATE_KBPS,
  });
  logger.debug({ ratingKey, target, mode: 'transcode' }, 'Resolved MP3 transcode stream');
  return {
    url: transcodeUrl,
    mode: 'transcode',
    sessionId,
    ratingKey,
    mediaIndex: part.mediaIndex,
    partIndex: part.partIndex,
    bitrateKbps: TRANSCODE_BITRATE_KBPS,
    durationMs: part.durationMs,
  };
}

function transcodeBytesPerSecond(bitrateKbps: number): number {
  return (bitrateKbps * 1000) / 8;
}

function parseRange(
  range: string | undefined,
  totalBytes: number,
): { start: number; end: number } | null {
  if (!range) return null;
  const match = /^bytes=(\d+)-(\d*)$/i.exec(range.trim());
  if (!match) return null;
  const start = Math.min(Number(match[1]), totalBytes - 1);
  const requestedEnd = match[2] ? Number(match[2]) : totalBytes - 1;
  const end = Math.max(start, Math.min(requestedEnd, totalBytes - 1));
  return { start, end };
}

async function writeResponseChunk(res: Response, chunk: Uint8Array): Promise<void> {
  if (!res.write(Buffer.from(chunk))) {
    await once(res, 'drain');
  }
}

function stopTranscodeSession(sessionId: string): void {
  const stopUrl = plexAdapter.buildTranscodeStopUrl(sessionId);
  void fetch(stopUrl, { method: 'GET' }).catch((err) => {
    logger.debug({ err, sessionId }, 'Unable to stop Plex transcode session');
  });
}

async function proxyTranscodedAudio(
  delivery: Extract<AudioDelivery, { mode: 'transcode' }>,
  req: Request,
  res: Response,
): Promise<void> {
  if (!delivery.durationMs || delivery.durationMs <= 0) {
    try {
      await proxyUrl(delivery.url, req, res, { forwardRange: false });
    } finally {
      stopTranscodeSession(delivery.sessionId);
    }
    return;
  }

  const bytesPerSecond = transcodeBytesPerSecond(delivery.bitrateKbps);
  const totalBytes = Math.max(1, Math.floor((delivery.durationMs / 1000) * bytesPerSecond));
  const range = parseRange(req.headers.range as string | undefined, totalBytes);
  const responseStart = range?.start ?? 0;
  const responseEnd = range?.end ?? totalBytes - 1;
  const responseLength = responseEnd - responseStart + 1;
  let sessionId = delivery.sessionId;
  let upstreamUrl = delivery.url;
  let bytesToDiscard = 0;

  if (range) {
    const offsetSec = Math.floor(range.start / bytesPerSecond);
    bytesToDiscard = range.start - Math.floor(offsetSec * bytesPerSecond);
    if (offsetSec > 0) {
      stopTranscodeSession(sessionId);
      sessionId = randomUUID();
      upstreamUrl = plexAdapter.buildAudioTranscodeUrl(delivery.ratingKey, {
        sessionId,
        mediaIndex: delivery.mediaIndex,
        partIndex: delivery.partIndex,
        bitrateKbps: delivery.bitrateKbps,
        offsetSec,
      });
    }
  }

  const setResponseHeaders = () => {
    res.status(range === null ? 200 : 206);
    res.setHeader('content-type', 'audio/mpeg');
    res.setHeader('accept-ranges', 'bytes');
    res.setHeader('content-length', String(responseLength));
    if (range) {
      res.setHeader('content-range', `bytes ${responseStart}-${responseEnd}/${totalBytes}`);
    }
  };
  if (req.method === 'HEAD') {
    setResponseHeaders();
    res.end();
    return;
  }

  const controller = new AbortController();
  let connectionClosed = false;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    controller.abort();
    stopTranscodeSession(sessionId);
  };
  const onClose = () => {
    connectionClosed = true;
    stop();
  };
  req.on('close', onClose);

  try {
    const upstream = await fetch(upstreamUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!upstream.ok || !upstream.body) {
      const body = (await upstream.text()).slice(0, 500);
      logger.warn(
        { ratingKey: delivery.ratingKey, status: upstream.status, body },
        'MP3 transcode failed; falling back to HLS',
      );
      const fallbackSessionId = randomUUID();
      const hlsUrl = plexAdapter.buildTranscodeUrl(
        delivery.ratingKey,
        fallbackSessionId,
        delivery.mediaIndex,
        delivery.partIndex,
      );
      await serveHlsManifest(hlsUrl, req, res);
      return;
    }

    setResponseHeaders();
    const reader = upstream.body.getReader();
    let remaining = responseLength;
    let discard = bytesToDiscard;
    while (remaining > 0 && !connectionClosed) {
      const { done, value } = await reader.read();
      if (done) break;
      let chunk = value;
      if (discard > 0) {
        const skipped = Math.min(discard, chunk.byteLength);
        discard -= skipped;
        chunk = chunk.subarray(skipped);
      }
      if (chunk.byteLength === 0) continue;
      const output = chunk.subarray(0, Math.min(chunk.byteLength, remaining));
      await writeResponseChunk(res, output);
      remaining -= output.byteLength;
    }
    await reader.cancel();

    const zeroChunk = new Uint8Array(64 * 1024);
    while (remaining > 0 && !connectionClosed) {
      const chunk = zeroChunk.subarray(0, Math.min(zeroChunk.byteLength, remaining));
      await writeResponseChunk(res, chunk);
      remaining -= chunk.byteLength;
    }
    if (!connectionClosed) res.end();
  } catch (err) {
    if ((err as Error).name !== 'AbortError') throw err;
  } finally {
    req.off('close', onClose);
    stop();
  }
}

export async function handleMediaRequest(req: Request, res: Response): Promise<void> {
  const parsed = parseTokenParam(String(req.params.token));
  if (!parsed) {
    res.status(400).send('Invalid token');
    return;
  }
  const payload = verifySignedToken(parsed.encoded, parsed.signature);
  if (!payload || payload.kind !== 'audio') {
    res.status(403).send('Forbidden');
    return;
  }

  try {
    await requirePlexConnected();
    const target = payload.target ?? (payload.transcode ? 'alexa' : 'web');
    const delivery = await resolveAudioDelivery(payload.ratingKey, target);
    if (delivery.mode === 'hls') {
      await serveHlsManifest(delivery.url, req, res);
      return;
    }
    if (delivery.mode === 'transcode') {
      await proxyTranscodedAudio(delivery, req, res);
      return;
    }
    await proxyUrl(delivery.url, req, res);
  } catch (err) {
    const message = (err as Error).message;
    const isNotFound =
      (err as Error).name === 'NotFoundError' ||
      message?.includes('Unable to find item');
    const isNotConfigured = message === 'Plex not configured';
    logger.error({ err }, 'Media proxy failed');
    if (!res.headersSent) {
      if (isNotFound) res.status(404).send('Not found');
      else if (isNotConfigured) res.status(503).send('Plex not configured');
      else res.status(500).send('Proxy error');
    }
  }
}

export async function handleSegmentRequest(req: Request, res: Response): Promise<void> {
  const parsed = parseTokenParam(String(req.params.token));
  if (!parsed) {
    res.status(400).send('Invalid token');
    return;
  }
  const payload = verifySignedToken(parsed.encoded, parsed.signature);
  if (!payload || payload.kind !== 'segment') {
    res.status(403).send('Forbidden');
    return;
  }

  try {
    await requirePlexConnected();
    const targetUrl = plexAdapter.buildDirectStreamUrl(payload.path);
    if (isHlsUrl(targetUrl)) {
      await serveHlsManifest(targetUrl, req, res);
      return;
    }
    await proxyUrl(targetUrl, req, res);
  } catch (err) {
    const message = (err as Error).message;
    logger.error({ err }, 'Segment proxy failed');
    if (!res.headersSent) {
      if (message === 'Plex not configured') res.status(503).send('Plex not configured');
      else res.status(500).send('Proxy error');
    }
  }
}

export async function handleArtworkRequest(req: Request, res: Response): Promise<void> {
  const parsed = parseTokenParam(String(req.params.token));
  if (!parsed) {
    res.status(400).send('Invalid token');
    return;
  }
  const payload = verifySignedToken(parsed.encoded, parsed.signature);
  if (!payload || payload.kind !== 'artwork') {
    res.status(403).send('Forbidden');
    return;
  }
  if (!payload.thumb) {
    res.status(404).type('text').send('Not found');
    return;
  }

  try {
    await requirePlexConnected();
    const artUrl = plexAdapter.buildArtworkUrl(payload.thumb);
    await proxyUrl(artUrl, req, res, { requireOk: true, cacheMaxAge: MEDIA_TTL_SEC });
  } catch (err) {
    const message = (err as Error).message;
    logger.error({ err }, 'Artwork proxy failed');
    if (!res.headersSent) {
      if (message === 'Plex not configured') res.status(503).send('Plex not configured');
      else res.status(500).send('Proxy error');
    }
  }
}

export function createHmacToken(data: string): string {
  const env = getEnv();
  return createHmac('sha256', env.APP_SECRET).update(data).digest('base64url');
}

// Test helpers
export {
  rewriteHlsManifest as rewriteHlsManifestForTests,
  stripPlexTokenFromUrl as stripPlexTokenFromUrlForTests,
  resolveManifestUri as resolveManifestUriForTests,
};
