import {
  HandlerInput,
  RequestHandler,
  SkillBuilders,
} from 'ask-sdk-core';
import type { Response as SkillResponse } from 'ask-sdk-model';

import {
  AlexaEventType,
  logAlexaEvent,
  summarizeFallback,
  summarizeHelp,
  summarizeLaunch,
  summarizeLoop,
  summarizeLoopNoPlayback,
  summarizeNothingPlaying,
  summarizePlaybackFinished,
  summarizePlaybackStarted,
  summarizePlayEmpty,
  summarizePlayNotFound,
  summarizePlayPrompt,
  summarizePlayStreamFailed,
  summarizePlaySuccess,
  summarizePlexNotConfigured,
  summarizeQueueEnd,
  summarizeQueueStart,
  summarizeSeek,
  summarizeSeekNoPlayback,
  summarizeSeekTo,
  summarizeStartOver,
  summarizeStop,
  summarizeTransport,
} from './eventLog.js';
import { resolveAlexaMessages, type AlexaMessages } from './localization/index.js';
import { plexAdapter } from '../plex/adapter.js';
import {
  advanceIndexOnPlaybackFinished,
  advanceQueue,
  bestMatch,
  clampSeekOffset,
  createQueueFromTracks,
  findQueueItemByToken,
  getCurrentTrack,
  getNextTrack,
  loadQueue,
  spokenNameIncludes,
  parseSeekPosition,
  parseSeekSeconds,
  previousTrack,
  clearQueue,
  setQueueLoop,
  syncQueueFromToken,
} from '../services/playback.js';
import { getAlexaSkillId, getPublicSettings, getPlexCredentials } from '../services/settings.js';
import {
  audioStopResponse,
  emptyAudioResponse,
  playQueueItem,
  speech,
  type AudioPlayOptions,
} from './playback.js';

function requestLocale(input: HandlerInput): string | undefined {
  return (input.requestEnvelope.request as { locale?: string }).locale;
}

function messagesFor(input: HandlerInput): AlexaMessages {
  return resolveAlexaMessages(requestLocale(input));
}

function playbackOptions(input: HandlerInput, extra: AudioPlayOptions = {}): AudioPlayOptions {
  return { unknownTitle: messagesFor(input).unknownTitle(), ...extra };
}

function getIntent(input: HandlerInput) {
  const request = input.requestEnvelope.request;
  if (request.type !== 'IntentRequest') return null;
  return request.intent;
}

function getUserContext(handlerInput: HandlerInput): {
  userId: string;
  deviceId?: string;
} {
  const request = handlerInput.requestEnvelope.request as {
    deviceId?: string;
  };
  const context = handlerInput.requestEnvelope.context;
  const userId =
    handlerInput.requestEnvelope.session?.user?.userId ??
    handlerInput.requestEnvelope.context?.System?.user?.userId ??
    'anonymous';
  const deviceId = context?.System?.device?.deviceId ?? request.deviceId;
  return { userId, deviceId };
}

function getAudioPlayerContext(handlerInput: HandlerInput): {
  token?: string;
  offsetInMilliseconds: number;
} {
  const audioPlayer = handlerInput.requestEnvelope.context?.AudioPlayer as {
    token?: string;
    offsetInMilliseconds?: number;
  } | undefined;
  return {
    token: audioPlayer?.token,
    offsetInMilliseconds: audioPlayer?.offsetInMilliseconds ?? 0,
  };
}

function getRequestToken(handlerInput: HandlerInput): string | undefined {
  const request = handlerInput.requestEnvelope.request as { token?: string };
  return request.token;
}

async function ensurePlex(): Promise<string> {
  const creds = getPlexCredentials();
  if (!creds) throw new Error('Plex not configured');
  await plexAdapter.connect(creds.url, creds.token);
  const settings = getPublicSettings();
  if (!settings.musicLibraryId) throw new Error('Music library not configured');
  return settings.musicLibraryId;
}

function playCurrentOrSpeech(
  item: ReturnType<typeof getCurrentTrack>,
  fallback: string,
  options: Parameters<typeof playQueueItem>[1] = {},
): SkillResponse {
  if (!item?.streamUrl) return speech(fallback, true);
  return playQueueItem(item, options) ?? speech(fallback, true);
}

const LaunchRequestHandler: RequestHandler = {
  canHandle: (input) => input.requestEnvelope.request.type === 'LaunchRequest',
  handle: async (input) => {
    logAlexaEvent({ type: AlexaEventType.LaunchRequest, summary: summarizeLaunch() });
    const settings = getPublicSettings();
    return speech(messagesFor(input).launchWelcome(settings.invocationName), false);
  },
};

const HelpIntentHandler: RequestHandler = {
  canHandle: (input) => input.requestEnvelope.request.type === 'IntentRequest' &&
    input.requestEnvelope.request.intent.name === 'AMAZON.HelpIntent',
  handle: async (input) => {
    logAlexaEvent({ type: AlexaEventType.HelpIntent, summary: summarizeHelp() });
    console.log('HelpIntentHandler', input);
    return speech(messagesFor(input).help(), false);
  },
};

const CancelAndStopIntentHandler: RequestHandler = {
  canHandle: (input) =>
    input.requestEnvelope.request.type === 'IntentRequest' &&
    (input.requestEnvelope.request.intent.name === 'AMAZON.CancelIntent' ||
      input.requestEnvelope.request.intent.name === 'AMAZON.StopIntent'),
  handle: async (input) => {
    logAlexaEvent({ type: AlexaEventType.StopIntent, summary: summarizeStop() });
    const { userId, deviceId } = getUserContext(input);
    clearQueue(userId, deviceId);
    return {
      ...audioStopResponse(),
      outputSpeech: { type: 'PlainText', text: messagesFor(input).stopping() },
    };
  },
};

const PlayPlaylistIntentHandler: RequestHandler = {
  canHandle: (input) =>
    input.requestEnvelope.request.type === 'IntentRequest' &&
    (input.requestEnvelope.request.intent.name === 'PlayPlaylistIntent' ||
      input.requestEnvelope.request.intent.name === 'ShufflePlaylistIntent'),
  handle: async (input) => {
    const t = messagesFor(input);
    const locale = requestLocale(input);
    const intent = getIntent(input);
    const slot = intent?.slots?.playlist?.value;
    if (!slot) {
      logAlexaEvent({
        type: AlexaEventType.PlayPlaylistIntent,
        summary: summarizePlayPrompt('playlist'),
      });
      return speech(t.whichPlaylist(), false);
    }

    try {
      await ensurePlex();
      const playlists = await plexAdapter.listPlaylists();
      const match = bestMatch(slot, playlists, locale);
      if (!match) {
        logAlexaEvent({
          type: AlexaEventType.PlayPlaylistIntent,
          summary: summarizePlayNotFound('playlist', slot),
        });
        return speech(t.playlistNotFound(slot), true);
      }

      const tracks = await plexAdapter.getPlaylistTracks(match.ratingKey);
      if (tracks.length === 0) {
        logAlexaEvent({
          type: AlexaEventType.PlayPlaylistIntent,
          summary: summarizePlayEmpty('playlist', match.title),
        });
        return speech(t.playlistEmpty(), true);
      }

      const { userId, deviceId } = getUserContext(input);
      const shuffle = intent?.name === 'ShufflePlaylistIntent';
      const queue = createQueueFromTracks(userId, tracks, { shuffle, deviceId, loop: false });
      const current = getCurrentTrack(queue);
      const response = playCurrentOrSpeech(current, t.playlistStreamFailed(), playbackOptions(input));
      if (response.outputSpeech) {
        logAlexaEvent({
          type: AlexaEventType.PlayPlaylistIntent,
          summary: summarizePlayStreamFailed('playlist'),
        });
      } else {
        logAlexaEvent({
          type: AlexaEventType.PlayPlaylistIntent,
          summary: summarizePlaySuccess({
            kind: 'playlist',
            matched: match.title,
            trackCount: tracks.length,
            shuffle,
          }),
        });
      }
      return response;
    } catch {
      logAlexaEvent({
        type: AlexaEventType.PlayPlaylistIntent,
        summary: summarizePlexNotConfigured(),
      });
      return speech(t.plexNotConfiguredSetup(), true);
    }
  },
};

const PlayArtistIntentHandler: RequestHandler = {
  canHandle: (input) =>
    input.requestEnvelope.request.type === 'IntentRequest' &&
    (input.requestEnvelope.request.intent.name === 'PlayArtistIntent' ||
      input.requestEnvelope.request.intent.name === 'ShuffleArtistIntent'),
  handle: async (input) => {
    const t = messagesFor(input);
    const locale = requestLocale(input);
    const intent = getIntent(input);
    const slot = intent?.slots?.artist?.value;
    if (!slot) {
      logAlexaEvent({
        type: AlexaEventType.PlayArtistIntent,
        summary: summarizePlayPrompt('artist'),
      });
      return speech(t.whichArtist(), false);
    }

    try {
      const sectionKey = await ensurePlex();
      const result = await plexAdapter.searchMusic(sectionKey, slot, 10);
      const match = bestMatch(slot, result.artists, locale);
      if (!match) {
        logAlexaEvent({
          type: AlexaEventType.PlayArtistIntent,
          summary: summarizePlayNotFound('artist', slot),
        });
        return speech(t.notFound(slot), true);
      }

      const tracks = await plexAdapter.getArtistTracks(match.ratingKey);
      if (tracks.length === 0) {
        logAlexaEvent({
          type: AlexaEventType.PlayArtistIntent,
          summary: summarizePlayEmpty('artist', match.title),
        });
        return speech(t.artistEmpty(), true);
      }

      const { userId, deviceId } = getUserContext(input);
      const shuffle = intent?.name === 'ShuffleArtistIntent';
      const queue = createQueueFromTracks(userId, tracks, { shuffle, deviceId, loop: false });
      const current = getCurrentTrack(queue);
      const response = playCurrentOrSpeech(current, t.artistStreamFailed(), playbackOptions(input));
      if (response.outputSpeech) {
        logAlexaEvent({
          type: AlexaEventType.PlayArtistIntent,
          summary: summarizePlayStreamFailed('artist'),
        });
      } else {
        logAlexaEvent({
          type: AlexaEventType.PlayArtistIntent,
          summary: summarizePlaySuccess({
            kind: 'artist',
            matched: match.title,
            trackCount: tracks.length,
            shuffle,
          }),
        });
      }
      return response;
    } catch {
      logAlexaEvent({
        type: AlexaEventType.PlayArtistIntent,
        summary: summarizePlexNotConfigured(),
      });
      return speech(t.plexNotConfigured(), true);
    }
  },
};

const PlayAlbumIntentHandler: RequestHandler = {
  canHandle: (input) =>
    input.requestEnvelope.request.type === 'IntentRequest' &&
    (input.requestEnvelope.request.intent.name === 'PlayAlbumIntent' ||
      input.requestEnvelope.request.intent.name === 'ShuffleAlbumIntent'),
  handle: async (input) => {
    const t = messagesFor(input);
    const locale = requestLocale(input);
    const intent = getIntent(input);
    const slot = intent?.slots?.album?.value;
    if (!slot) {
      logAlexaEvent({
        type: AlexaEventType.PlayAlbumIntent,
        summary: summarizePlayPrompt('album'),
      });
      return speech(t.whichAlbum(), false);
    }

    try {
      const sectionKey = await ensurePlex();
      const result = await plexAdapter.searchMusic(sectionKey, slot, 10);
      const match = bestMatch(slot, result.albums, locale);
      if (!match) {
        logAlexaEvent({
          type: AlexaEventType.PlayAlbumIntent,
          summary: summarizePlayNotFound('album', slot),
        });
        return speech(t.albumNotFound(slot), true);
      }

      const tracks = await plexAdapter.getAlbumTracks(match.ratingKey);
      if (tracks.length === 0) {
        logAlexaEvent({
          type: AlexaEventType.PlayAlbumIntent,
          summary: summarizePlayEmpty('album', match.title),
        });
        return speech(t.albumEmpty(), true);
      }

      const { userId, deviceId } = getUserContext(input);
      const shuffle = intent?.name === 'ShuffleAlbumIntent';
      const queue = createQueueFromTracks(userId, tracks, { shuffle, deviceId, loop: false });
      const current = getCurrentTrack(queue);
      const response = playCurrentOrSpeech(current, t.albumStreamFailed(), playbackOptions(input));
      if (response.outputSpeech) {
        logAlexaEvent({
          type: AlexaEventType.PlayAlbumIntent,
          summary: summarizePlayStreamFailed('album'),
        });
      } else {
        logAlexaEvent({
          type: AlexaEventType.PlayAlbumIntent,
          summary: summarizePlaySuccess({
            kind: 'album',
            matched: match.title,
            trackCount: tracks.length,
            shuffle,
          }),
        });
      }
      return response;
    } catch {
      logAlexaEvent({
        type: AlexaEventType.PlayAlbumIntent,
        summary: summarizePlexNotConfigured(),
      });
      return speech(t.plexNotConfigured(), true);
    }
  },
};

const PlayTrackIntentHandler: RequestHandler = {
  canHandle: (input) =>
    input.requestEnvelope.request.type === 'IntentRequest' &&
    (input.requestEnvelope.request.intent.name === 'PlayTrackIntent' ||
      input.requestEnvelope.request.intent.name === 'PlayTrackByArtistIntent'),
  handle: async (input) => {
    const t = messagesFor(input);
    const locale = requestLocale(input);
    const intent = getIntent(input);
    const trackSlot = intent?.slots?.track?.value;
    const artistSlot = intent?.slots?.artist?.value;
    if (!trackSlot) {
      logAlexaEvent({
        type: AlexaEventType.PlayTrackIntent,
        summary: summarizePlayPrompt('track'),
      });
      return speech(t.whichSong(), false);
    }

    try {
      const sectionKey = await ensurePlex();
      const result = await plexAdapter.searchMusic(sectionKey, trackSlot, 20);
      let tracks = result.tracks;
      if (artistSlot) {
        tracks = tracks.filter((track) => spokenNameIncludes(track.artist, artistSlot, locale));
      }
      const match = bestMatch(trackSlot, tracks, locale);
      if (!match) {
        logAlexaEvent({
          type: AlexaEventType.PlayTrackIntent,
          summary: summarizePlayNotFound('track', trackSlot),
        });
        return speech(t.notFound(trackSlot), true);
      }

      const { userId, deviceId } = getUserContext(input);
      const queue = createQueueFromTracks(userId, [match], { deviceId, loop: false });
      const current = getCurrentTrack(queue);
      const response = playCurrentOrSpeech(current, t.trackStreamFailed(), playbackOptions(input));
      if (response.outputSpeech) {
        logAlexaEvent({
          type: AlexaEventType.PlayTrackIntent,
          summary: summarizePlayStreamFailed('track'),
        });
      } else {
        logAlexaEvent({
          type: AlexaEventType.PlayTrackIntent,
          summary: summarizePlaySuccess({
            kind: 'track',
            matched: match.title,
            trackCount: 1,
            shuffle: false,
            artist: match.artist ?? artistSlot,
          }),
        });
      }
      return response;
    } catch {
      logAlexaEvent({
        type: AlexaEventType.PlayTrackIntent,
        summary: summarizePlexNotConfigured(),
      });
      return speech(t.plexNotConfigured(), true);
    }
  },
};

const LoopIntentHandler: RequestHandler = {
  canHandle: (input) =>
    input.requestEnvelope.request.type === 'IntentRequest' &&
    (input.requestEnvelope.request.intent.name === 'AMAZON.LoopOnIntent' ||
      input.requestEnvelope.request.intent.name === 'AMAZON.LoopOffIntent'),
  handle: async (input) => {
    const intent = getIntent(input);
    const name = intent?.name ?? '';
    const loop = name === 'AMAZON.LoopOnIntent';
    const eventType = loop ? AlexaEventType.LoopOnIntent : AlexaEventType.LoopOffIntent;
    const t = messagesFor(input);
    const { userId, deviceId } = getUserContext(input);
    const queue = loadQueue(userId, deviceId);
    if (!queue || queue.items.length === 0) {
      logAlexaEvent({ type: eventType, summary: summarizeLoopNoPlayback() });
      return speech(t.nothingPlaying(), true);
    }
    setQueueLoop(queue, loop);
    logAlexaEvent({ type: eventType, summary: summarizeLoop(loop) });
    return speech(loop ? t.loopOn() : t.loopOff(), true);
  },
};

const SeekIntentHandler: RequestHandler = {
  canHandle: (input) =>
    input.requestEnvelope.request.type === 'IntentRequest' &&
    (input.requestEnvelope.request.intent.name === 'SeekForwardIntent' ||
      input.requestEnvelope.request.intent.name === 'SeekBackwardIntent' ||
      input.requestEnvelope.request.intent.name === 'SeekToIntent' ||
      input.requestEnvelope.request.intent.name === 'AMAZON.StartOverIntent'),
  handle: async (input) => {
    const intent = getIntent(input);
    const name = intent?.name ?? '';
    const eventType =
      name === 'SeekForwardIntent'
        ? AlexaEventType.SeekForwardIntent
        : name === 'SeekBackwardIntent'
          ? AlexaEventType.SeekBackwardIntent
          : name === 'SeekToIntent'
            ? AlexaEventType.SeekToIntent
            : AlexaEventType.StartOverIntent;
    const t = messagesFor(input);
    const { userId, deviceId } = getUserContext(input);
    const queue = loadQueue(userId, deviceId);
    if (!queue) {
      logAlexaEvent({ type: eventType, summary: summarizeSeekNoPlayback() });
      return speech(t.nothingPlaying(), true);
    }

    const { token, offsetInMilliseconds } = getAudioPlayerContext(input);
    const activeToken = token ?? getRequestToken(input);
    let current = activeToken ? findQueueItemByToken(queue, activeToken) : getCurrentTrack(queue);
    if (activeToken && current) syncQueueFromToken(queue, activeToken);
    if (!current) current = getCurrentTrack(queue);
    if (!current?.streamUrl) {
      logAlexaEvent({ type: eventType, summary: summarizeSeekNoPlayback() });
      return speech(t.nothingPlaying(), true);
    }

    if (
      (name === 'SeekBackwardIntent' || name === 'SeekForwardIntent') &&
      !intent?.slots?.seconds?.value
    ) {
      logAlexaEvent({
        type: AlexaEventType.Fallback,
        summary: summarizeFallback(name),
      });
      return speech(t.seekUsage(), false);
    }
    if (
      name === 'SeekToIntent' &&
      !intent?.slots?.minutes?.value &&
      !intent?.slots?.seconds?.value
    ) {
      logAlexaEvent({
        type: AlexaEventType.Fallback,
        summary: summarizeFallback(name),
      });
      return speech(t.seekToUsage(), false);
    }

    let offsetMs = offsetInMilliseconds;
    if (name === 'AMAZON.StartOverIntent') {
      logAlexaEvent({ type: eventType, summary: summarizeStartOver() });
      offsetMs = 0;
    } else if (name === 'SeekToIntent') {
      offsetMs =
        parseSeekPosition(
          intent?.slots?.minutes?.value,
          intent?.slots?.seconds?.value,
          current.durationMs,
        ) ?? 0;
      logAlexaEvent({ type: eventType, summary: summarizeSeekTo(offsetMs) });
    } else {
      const seconds = parseSeekSeconds(intent?.slots?.seconds?.value);
      const direction = name === 'SeekForwardIntent' ? 'forward' : 'backward';
      logAlexaEvent({ type: eventType, summary: summarizeSeek(direction, seconds) });
      const deltaMs = seconds * 1000;
      offsetMs = clampSeekOffset(
        offsetInMilliseconds,
        name === 'SeekForwardIntent' ? deltaMs : -deltaMs,
        current.durationMs,
      );
    }

    return playQueueItem(current, playbackOptions(input, { offsetMs })) ?? speech(t.seekFailed(), true);
  },
};

const AudioPlayerHandler: RequestHandler = {
  canHandle: (input) => {
    const type = input.requestEnvelope.request.type;
    return type.startsWith('AudioPlayer.');
  },
  handle: async (input) => {
    const type = input.requestEnvelope.request.type;
    const { userId, deviceId } = getUserContext(input);
    const queue = loadQueue(userId, deviceId);
    const eventToken = getRequestToken(input);

    if (type === 'AudioPlayer.PlaybackStarted' && queue && eventToken) {
      syncQueueFromToken(queue, eventToken);
      const track = findQueueItemByToken(queue, eventToken);
      if (track) {
        logAlexaEvent({
          type: AlexaEventType.PlaybackStarted,
          summary: summarizePlaybackStarted(track.title, track.artist),
        });
      }
      return emptyAudioResponse();
    }

    if (type === 'AudioPlayer.PlaybackNearlyFinished' && queue) {
      const current = getCurrentTrack(queue);
      const next = getNextTrack(queue);
      if (next?.streamUrl && current) {
        return (
          playQueueItem(next, playbackOptions(input, {
            playBehavior: 'ENQUEUE',
            expectedPreviousToken: current.streamToken,
          })) ?? emptyAudioResponse()
        );
      }
      return emptyAudioResponse();
    }

    if (type === 'AudioPlayer.PlaybackFinished' && queue && eventToken) {
      const track = findQueueItemByToken(queue, eventToken);
      if (track) {
        logAlexaEvent({
          type: AlexaEventType.PlaybackFinished,
          summary: summarizePlaybackFinished(track.title, track.artist),
        });
      }
      advanceIndexOnPlaybackFinished(queue, eventToken);
      return emptyAudioResponse();
    }

    return emptyAudioResponse();
  },
};

const PlaybackControllerHandler: RequestHandler = {
  canHandle: (input) => {
    const type = input.requestEnvelope.request.type;
    return type.startsWith('PlaybackController.');
  },
  handle: async (input) => {
    const type = input.requestEnvelope.request.type;
    const { userId, deviceId } = getUserContext(input);
    const queue = loadQueue(userId, deviceId);
    const { token, offsetInMilliseconds } = getAudioPlayerContext(input);

    if (type === 'PlaybackController.NextCommandIssued' && queue) {
      const next = advanceQueue(queue);
      if (next?.streamUrl) {
        logAlexaEvent({
          type: AlexaEventType.NextCommand,
          summary: summarizeTransport('next', next.title),
        });
        return playQueueItem(next, playbackOptions(input)) ?? emptyAudioResponse();
      }
      return emptyAudioResponse();
    }

    if (type === 'PlaybackController.PreviousCommandIssued' && queue) {
      const prev = previousTrack(queue);
      if (prev?.streamUrl) {
        logAlexaEvent({
          type: AlexaEventType.PreviousCommand,
          summary: summarizeTransport('previous', prev.title),
        });
        return playQueueItem(prev, playbackOptions(input)) ?? emptyAudioResponse();
      }
      return emptyAudioResponse();
    }

    if (type === 'PlaybackController.PauseCommandIssued') {
      logAlexaEvent({
        type: AlexaEventType.PauseCommand,
        summary: summarizeTransport('pause'),
      });
      return audioStopResponse();
    }

    if (type === 'PlaybackController.PlayCommandIssued' && queue) {
      let current = token ? findQueueItemByToken(queue, token) : getCurrentTrack(queue);
      if (token && current) syncQueueFromToken(queue, token);
      if (!current) current = getCurrentTrack(queue);
      if (current?.streamUrl) {
        logAlexaEvent({
          type: AlexaEventType.PlayCommand,
          summary: summarizeTransport('resume', current.title),
        });
        return playQueueItem(current, playbackOptions(input, { offsetMs: offsetInMilliseconds })) ?? emptyAudioResponse();
      }
      return emptyAudioResponse();
    }

    return emptyAudioResponse();
  },
};

const TransportIntentHandler: RequestHandler = {
  canHandle: (input) => {
    if (input.requestEnvelope.request.type !== 'IntentRequest') return false;
    const name = input.requestEnvelope.request.intent.name;
    return [
      'AMAZON.PauseIntent',
      'AMAZON.ResumeIntent',
      'AMAZON.NextIntent',
      'AMAZON.PreviousIntent',
    ].includes(name);
  },
  handle: async (input) => {
    const intent = getIntent(input);
    const name = intent?.name ?? 'UnknownIntent';
    const eventType =
      name === 'AMAZON.PauseIntent'
        ? AlexaEventType.PauseIntent
        : name === 'AMAZON.ResumeIntent'
          ? AlexaEventType.ResumeIntent
          : name === 'AMAZON.NextIntent'
            ? AlexaEventType.NextIntent
            : AlexaEventType.PreviousIntent;
    const t = messagesFor(input);
    const { userId, deviceId } = getUserContext(input);
    const queue = loadQueue(userId, deviceId);
    const { offsetInMilliseconds } = getAudioPlayerContext(input);

    if (name === 'AMAZON.NextIntent' && queue) {
      const next = advanceQueue(queue);
      if (next?.streamUrl) {
        logAlexaEvent({
          type: eventType,
          summary: summarizeTransport('next', next.title),
        });
        return playQueueItem(next, playbackOptions(input)) ?? speech(t.streamFailed(), true);
      }
      logAlexaEvent({ type: eventType, summary: summarizeQueueEnd() });
      return speech(t.queueEnd(), true);
    }
    if (name === 'AMAZON.PreviousIntent' && queue) {
      const prev = previousTrack(queue);
      if (prev?.streamUrl) {
        logAlexaEvent({
          type: eventType,
          summary: summarizeTransport('previous', prev.title),
        });
        return playQueueItem(prev, playbackOptions(input)) ?? speech(t.streamFailed(), true);
      }
      logAlexaEvent({ type: eventType, summary: summarizeQueueStart() });
      return speech(t.queueStart(), true);
    }

    if (name === 'AMAZON.PauseIntent') {
      logAlexaEvent({ type: eventType, summary: summarizeTransport('pause') });
      return audioStopResponse();
    }

    if (name === 'AMAZON.ResumeIntent' && queue) {
      const current = getCurrentTrack(queue);
      if (current?.streamUrl) {
        logAlexaEvent({
          type: eventType,
          summary: summarizeTransport('resume', current.title),
        });
        return (
          playQueueItem(current, playbackOptions(input, { offsetMs: offsetInMilliseconds })) ??
          speech(t.streamFailed(), true)
        );
      }
    }

    logAlexaEvent({ type: eventType, summary: summarizeNothingPlaying() });
    return speech(t.nothingPlaying(), true);
  },
};

const FallbackHandler: RequestHandler = {
  canHandle: () => true,
  handle: async (input) => {
    const request = input.requestEnvelope.request;
    const intentName =
      request.type === 'IntentRequest' ? request.intent.name : undefined;
    logAlexaEvent({
      type: AlexaEventType.Fallback,
      summary: summarizeFallback(intentName),
    });
    return speech(messagesFor(input).fallback(), false);
  },
};

export function buildAlexaSkill() {
  const skillId = getAlexaSkillId();
  const builder = SkillBuilders.custom()
    .addRequestHandlers(
      LaunchRequestHandler,
      HelpIntentHandler,
      CancelAndStopIntentHandler,
      PlayPlaylistIntentHandler,
      PlayArtistIntentHandler,
      PlayAlbumIntentHandler,
      PlayTrackIntentHandler,
      LoopIntentHandler,
      SeekIntentHandler,
      AudioPlayerHandler,
      PlaybackControllerHandler,
      TransportIntentHandler,
      FallbackHandler,
    );

  if (skillId) {
    builder.withCustomUserAgent('plexa');
  }

  return builder.create();
}

export function validateApplicationId(applicationId: string | undefined): boolean {
  const expected = getAlexaSkillId();
  if (!expected) return true;
  return applicationId === expected;
}
