import type { Response as SkillResponse } from 'ask-sdk-model';
import { toPublicMediaUrl } from '../media/gateway.js';
import type { QueueItem } from '../services/playback.js';

export interface AudioPlayOptions {
  playBehavior?: 'REPLACE_ALL' | 'ENQUEUE';
  offsetMs?: number;
  expectedPreviousToken?: string;
}

export function speech(text: string, endSession = true): SkillResponse {
  return {
    outputSpeech: { type: 'PlainText', text },
    shouldEndSession: endSession,
  };
}

export function emptyAudioResponse(): SkillResponse {
  return {};
}

export function audioPlayResponse(
  item: Pick<
    QueueItem,
    'streamUrl' | 'streamUrlAlexa' | 'streamToken' | 'title' | 'artist' | 'artUrl'
  >,
  options: AudioPlayOptions = {},
): SkillResponse | null {
  const { streamUrlAlexa, streamUrl, streamToken, title, artist, artUrl } = item;
  const alexaStreamUrl = streamUrlAlexa ?? streamUrl;
  if (!alexaStreamUrl) return null;

  const absoluteStream = toPublicMediaUrl(alexaStreamUrl);
  if (!absoluteStream) return null;
  const absoluteArt = artUrl ? toPublicMediaUrl(artUrl) ?? undefined : undefined;

  const metadata =
    title || artist || absoluteArt
      ? {
          metadata: {
            title: title ?? 'Unknown',
            subtitle: artist,
            art: absoluteArt ? { sources: [{ url: absoluteArt }] } : undefined,
          },
        }
      : {};

  const playBehavior = options.playBehavior ?? 'REPLACE_ALL';
  const stream: {
    url: string;
    token: string;
    offsetInMilliseconds: number;
    expectedPreviousToken?: string;
  } = {
    url: absoluteStream,
    token: streamToken,
    offsetInMilliseconds: options.offsetMs ?? 0,
  };
  if (options.expectedPreviousToken) {
    stream.expectedPreviousToken = options.expectedPreviousToken;
  }

  return {
    directives: [
      {
        type: 'AudioPlayer.Play',
        playBehavior,
        audioItem: {
          stream,
          ...metadata,
        },
      },
    ],
    shouldEndSession: true,
  };
}

export function audioStopResponse(): SkillResponse {
  return {
    directives: [{ type: 'AudioPlayer.Stop' }],
    shouldEndSession: true,
  };
}

export function playQueueItem(
  item: QueueItem,
  options: AudioPlayOptions = {},
): SkillResponse | null {
  return audioPlayResponse(item, options);
}
