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
  summarizeStartOver,
  summarizeStop,
  summarizeTransport,
} from './eventLog.js';
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
  normalizeSpokenName,
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
} from './playback.js';

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
  handle: async (_input) => {
    logAlexaEvent({ type: AlexaEventType.LaunchRequest, summary: summarizeLaunch() });
    const settings = getPublicSettings();
    return speech(
      `Welcome to ${settings.invocationName}. You can ask me to play a playlist, artist, album, or song.`,
      false,
    );
  },
};

const HelpIntentHandler: RequestHandler = {
  canHandle: (input) => input.requestEnvelope.request.type === 'IntentRequest' &&
    input.requestEnvelope.request.intent.name === 'AMAZON.HelpIntent',
  handle: async () => {
    logAlexaEvent({ type: AlexaEventType.HelpIntent, summary: summarizeHelp() });
    return speech(
      'Try: start my road trip playlist, start Fleetwood Mac, play the album Rumours, or play Dreams by Fleetwood Mac. You can also say loop on, loop off, skip forward 30 seconds, or go back 15 seconds.',
      false,
    );
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
      outputSpeech: { type: 'PlainText', text: 'Stopping playback.' },
    };
  },
};

const PlayPlaylistIntentHandler: RequestHandler = {
  canHandle: (input) =>
    input.requestEnvelope.request.type === 'IntentRequest' &&
    (input.requestEnvelope.request.intent.name === 'PlayPlaylistIntent' ||
      input.requestEnvelope.request.intent.name === 'ShufflePlaylistIntent'),
  handle: async (input) => {
    const intent = getIntent(input);
    const slot = intent?.slots?.playlist?.value;
    const playlistSlot = intent?.slots?.playlist;

    if (!slot) {
      logAlexaEvent({
        type: AlexaEventType.PlayPlaylistIntent,
        summary: summarizePlayPrompt('playlist'),
      });
      return speech('Which playlist would you like to play?', false);
    }

    try {
      await ensurePlex();
      const playlists = await plexAdapter.listPlaylists();

      const match = bestMatch(slot, playlists);

      if (!match) {
        logAlexaEvent({
          type: AlexaEventType.PlayPlaylistIntent,
          summary: summarizePlayNotFound('playlist', slot),
        });
        return speech(`I couldn't find a playlist called ${slot}.`, true);
      }

      const tracks = await plexAdapter.getPlaylistTracks(match.ratingKey);
      if (tracks.length === 0) {
        logAlexaEvent({
          type: AlexaEventType.PlayPlaylistIntent,
          summary: summarizePlayEmpty('playlist', match.title),
        });
        return speech('That playlist is empty.', true);
      }

      const { userId, deviceId } = getUserContext(input);
      const shuffle = intent?.name === 'ShufflePlaylistIntent';
      const queue = createQueueFromTracks(userId, tracks, { shuffle, deviceId, loop: false });
      const current = getCurrentTrack(queue);
      const response = playCurrentOrSpeech(current, 'Unable to stream that playlist right now.');
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
    } catch (err) {

      logAlexaEvent({
        type: AlexaEventType.PlayPlaylistIntent,
        summary: summarizePlexNotConfigured(),
      });
      return speech('Plex is not configured. Please set it up in the Plexa settings page.', true);
    }
  },
};

const PlayArtistIntentHandler: RequestHandler = {
  canHandle: (input) =>
    input.requestEnvelope.request.type === 'IntentRequest' &&
    (input.requestEnvelope.request.intent.name === 'PlayArtistIntent' ||
      input.requestEnvelope.request.intent.name === 'ShuffleArtistIntent'),
  handle: async (input) => {
    const intent = getIntent(input);
    const slot = intent?.slots?.artist?.value;
    if (!slot) {
      logAlexaEvent({
        type: AlexaEventType.PlayArtistIntent,
        summary: summarizePlayPrompt('artist'),
      });
      return speech('Which artist?', false);
    }

    try {
      const sectionKey = await ensurePlex();
      const result = await plexAdapter.searchMusic(sectionKey, slot, 10);
      const match = bestMatch(slot, result.artists);
      if (!match) {
        logAlexaEvent({
          type: AlexaEventType.PlayArtistIntent,
          summary: summarizePlayNotFound('artist', slot),
        });
        return speech(`I couldn't find ${slot}.`, true);
      }

      const tracks = await plexAdapter.getArtistTracks(match.ratingKey);
      if (tracks.length === 0) {
        logAlexaEvent({
          type: AlexaEventType.PlayArtistIntent,
          summary: summarizePlayEmpty('artist', match.title),
        });
        return speech('No tracks found for that artist.', true);
      }

      const { userId, deviceId } = getUserContext(input);
      const shuffle = intent?.name === 'ShuffleArtistIntent';
      const queue = createQueueFromTracks(userId, tracks, { shuffle, deviceId, loop: false });
      const current = getCurrentTrack(queue);
      const response = playCurrentOrSpeech(current, 'Unable to stream that artist right now.');
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
      return speech('Plex is not configured.', true);
    }
  },
};

const PlayAlbumIntentHandler: RequestHandler = {
  canHandle: (input) =>
    input.requestEnvelope.request.type === 'IntentRequest' &&
    (input.requestEnvelope.request.intent.name === 'PlayAlbumIntent' ||
      input.requestEnvelope.request.intent.name === 'ShuffleAlbumIntent'),
  handle: async (input) => {
    const intent = getIntent(input);
    const slot = intent?.slots?.album?.value;
    if (!slot) {
      logAlexaEvent({
        type: AlexaEventType.PlayAlbumIntent,
        summary: summarizePlayPrompt('album'),
      });
      return speech('Which album?', false);
    }

    try {
      const sectionKey = await ensurePlex();
      const result = await plexAdapter.searchMusic(sectionKey, slot, 10);
      const match = bestMatch(slot, result.albums);
      if (!match) {
        logAlexaEvent({
          type: AlexaEventType.PlayAlbumIntent,
          summary: summarizePlayNotFound('album', slot),
        });
        return speech(`I couldn't find the album ${slot}.`, true);
      }

      const tracks = await plexAdapter.getAlbumTracks(match.ratingKey);
      if (tracks.length === 0) {
        logAlexaEvent({
          type: AlexaEventType.PlayAlbumIntent,
          summary: summarizePlayEmpty('album', match.title),
        });
        return speech('That album has no tracks.', true);
      }

      const { userId, deviceId } = getUserContext(input);
      const shuffle = intent?.name === 'ShuffleAlbumIntent';
      const queue = createQueueFromTracks(userId, tracks, { shuffle, deviceId, loop: false });
      const current = getCurrentTrack(queue);
      const response = playCurrentOrSpeech(current, 'Unable to stream that album right now.');
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
      return speech('Plex is not configured.', true);
    }
  },
};

const PlayTrackIntentHandler: RequestHandler = {
  canHandle: (input) =>
    input.requestEnvelope.request.type === 'IntentRequest' &&
    (input.requestEnvelope.request.intent.name === 'PlayTrackIntent' ||
      input.requestEnvelope.request.intent.name === 'PlayTrackByArtistIntent'),
  handle: async (input) => {
    const intent = getIntent(input);
    const trackSlot = intent?.slots?.track?.value;
    const artistSlot = intent?.slots?.artist?.value;
    if (!trackSlot) {
      logAlexaEvent({
        type: AlexaEventType.PlayTrackIntent,
        summary: summarizePlayPrompt('track'),
      });
      return speech('Which song?', false);
    }

    try {
      const sectionKey = await ensurePlex();
      const result = await plexAdapter.searchMusic(sectionKey, trackSlot, 20);
      let tracks = result.tracks;
      if (artistSlot) {
        const artistNorm = normalizeSpokenName(artistSlot);
        tracks = tracks.filter(
          (t) => t.artist?.toLowerCase().includes(artistNorm) ?? false,
        );
      }
      const match = bestMatch(trackSlot, tracks) ?? tracks[0];
      if (!match) {
        logAlexaEvent({
          type: AlexaEventType.PlayTrackIntent,
          summary: summarizePlayNotFound('track', trackSlot),
        });
        return speech(`I couldn't find ${trackSlot}.`, true);
      }

      const { userId, deviceId } = getUserContext(input);
      const queue = createQueueFromTracks(userId, [match], { deviceId, loop: false });
      const current = getCurrentTrack(queue);
      const response = playCurrentOrSpeech(current, 'Unable to stream that track right now.');
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
      return speech('Plex is not configured.', true);
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
    const { userId, deviceId } = getUserContext(input);
    const queue = loadQueue(userId, deviceId);
    if (!queue || queue.items.length === 0) {
      logAlexaEvent({ type: eventType, summary: summarizeLoopNoPlayback() });
      return speech('Nothing is playing right now.', true);
    }
    setQueueLoop(queue, loop);
    logAlexaEvent({ type: eventType, summary: summarizeLoop(loop) });
    return speech(loop ? 'Loop is on.' : 'Loop is off.', true);
  },
};

const SeekIntentHandler: RequestHandler = {
  canHandle: (input) =>
    input.requestEnvelope.request.type === 'IntentRequest' &&
    (input.requestEnvelope.request.intent.name === 'SeekForwardIntent' ||
      input.requestEnvelope.request.intent.name === 'SeekBackwardIntent' ||
      input.requestEnvelope.request.intent.name === 'AMAZON.StartOverIntent'),
  handle: async (input) => {
    const intent = getIntent(input);
    const name = intent?.name ?? '';
    const eventType =
      name === 'SeekForwardIntent'
        ? AlexaEventType.SeekForwardIntent
        : name === 'SeekBackwardIntent'
          ? AlexaEventType.SeekBackwardIntent
          : AlexaEventType.StartOverIntent;
    const { userId, deviceId } = getUserContext(input);
    const queue = loadQueue(userId, deviceId);
    if (!queue) {
      logAlexaEvent({ type: eventType, summary: summarizeSeekNoPlayback() });
      return speech('Nothing is playing right now.', true);
    }

    const { token, offsetInMilliseconds } = getAudioPlayerContext(input);
    const activeToken = token ?? getRequestToken(input);
    let current = activeToken ? findQueueItemByToken(queue, activeToken) : getCurrentTrack(queue);
    if (activeToken && current) syncQueueFromToken(queue, activeToken);
    if (!current) current = getCurrentTrack(queue);
    if (!current?.streamUrl) {
      logAlexaEvent({ type: eventType, summary: summarizeSeekNoPlayback() });
      return speech('Nothing is playing right now.', true);
    }

    let offsetMs = offsetInMilliseconds;
    if (name === 'AMAZON.StartOverIntent') {
      logAlexaEvent({ type: eventType, summary: summarizeStartOver() });
      offsetMs = 0;
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

    return playQueueItem(current, { offsetMs }) ?? speech('Unable to seek right now.', true);
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
          playQueueItem(next, {
            playBehavior: 'ENQUEUE',
            expectedPreviousToken: current.streamToken,
          }) ?? emptyAudioResponse()
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
        return playQueueItem(next) ?? emptyAudioResponse();
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
        return playQueueItem(prev) ?? emptyAudioResponse();
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
        return playQueueItem(current, { offsetMs: offsetInMilliseconds }) ?? emptyAudioResponse();
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
        return playQueueItem(next) ?? speech('Unable to stream right now.', true);
      }
      logAlexaEvent({ type: eventType, summary: summarizeQueueEnd() });
      return speech('You are at the end of the queue.', true);
    }
    if (name === 'AMAZON.PreviousIntent' && queue) {
      const prev = previousTrack(queue);
      if (prev?.streamUrl) {
        logAlexaEvent({
          type: eventType,
          summary: summarizeTransport('previous', prev.title),
        });
        return playQueueItem(prev) ?? speech('Unable to stream right now.', true);
      }
      logAlexaEvent({ type: eventType, summary: summarizeQueueStart() });
      return speech('You are at the beginning of the queue.', true);
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
          playQueueItem(current, { offsetMs: offsetInMilliseconds }) ??
          speech('Unable to stream right now.', true)
        );
      }
    }

    logAlexaEvent({ type: eventType, summary: summarizeNothingPlaying() });
    return speech('Nothing is playing right now.', true);
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
    return speech("I didn't understand that. Try asking me to play a playlist, artist, album, or song.", false);
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
