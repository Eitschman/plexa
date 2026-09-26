import { recordAlexaEvent as persistAlexaEvent } from '../db/index.js';

export const AlexaEventType = {
  LaunchRequest: 'LaunchRequest',
  HelpIntent: 'HelpIntent',
  StopIntent: 'StopIntent',
  PlayPlaylistIntent: 'PlayPlaylistIntent',
  PlayArtistIntent: 'PlayArtistIntent',
  PlayAlbumIntent: 'PlayAlbumIntent',
  PlayTrackIntent: 'PlayTrackIntent',
  LoopOnIntent: 'AMAZON.LoopOnIntent',
  LoopOffIntent: 'AMAZON.LoopOffIntent',
  SeekForwardIntent: 'SeekForwardIntent',
  SeekBackwardIntent: 'SeekBackwardIntent',
  SeekToIntent: 'SeekToIntent',
  StartOverIntent: 'AMAZON.StartOverIntent',
  PauseIntent: 'AMAZON.PauseIntent',
  ResumeIntent: 'AMAZON.ResumeIntent',
  NextIntent: 'AMAZON.NextIntent',
  PreviousIntent: 'AMAZON.PreviousIntent',
  PlaybackStarted: 'AudioPlayer.PlaybackStarted',
  PlaybackFinished: 'AudioPlayer.PlaybackFinished',
  NextCommand: 'PlaybackController.NextCommandIssued',
  PreviousCommand: 'PlaybackController.PreviousCommandIssued',
  PauseCommand: 'PlaybackController.PauseCommandIssued',
  PlayCommand: 'PlaybackController.PlayCommandIssued',
  Fallback: 'Fallback',
} as const;

export type PlayKind = 'playlist' | 'artist' | 'album' | 'track';

const PLAY_KIND_LABEL: Record<PlayKind, string> = {
  playlist: 'playlist',
  artist: 'artist',
  album: 'album',
  track: 'song',
};

export function logAlexaEvent(event: { type: string; summary: string }): void {
  persistAlexaEvent(event);
}

export function summarizeLaunch(): string {
  return 'Opened Plexa';
}

export function summarizeHelp(): string {
  return 'Asked for help';
}

export function summarizeStop(): string {
  return 'Stopped playback';
}

export function summarizePlayPrompt(kind: PlayKind): string {
  return `Asked which ${PLAY_KIND_LABEL[kind]} to play`;
}

export function summarizePlayNotFound(kind: PlayKind, spoken: string): string {
  return `Couldn't find ${PLAY_KIND_LABEL[kind]} "${spoken}"`;
}

export function summarizePlayEmpty(kind: PlayKind, matched: string): string {
  if (kind === 'playlist') return `Playlist "${matched}" is empty`;
  if (kind === 'album') return `Album "${matched}" has no tracks`;
  if (kind === 'artist') return `No tracks found for artist "${matched}"`;
  return `No tracks found for "${matched}"`;
}

export function summarizePlaySuccess(opts: {
  kind: PlayKind;
  matched: string;
  trackCount: number;
  shuffle: boolean;
  artist?: string;
}): string {
  const { kind, matched, trackCount, shuffle, artist } = opts;
  const verb = shuffle ? 'Shuffling' : 'Playing';

  if (kind === 'track') {
    if (artist) return `${verb} "${matched}" by ${artist}`;
    return `${verb} "${matched}"`;
  }

  const countSuffix = trackCount === 1 ? '1 track' : `${trackCount} tracks`;
  return `${verb} ${PLAY_KIND_LABEL[kind]} "${matched}" (${countSuffix})`;
}

export function summarizePlexNotConfigured(): string {
  return 'Playback failed — Plex not configured';
}

export function summarizePlayStreamFailed(kind: PlayKind): string {
  const label = kind === 'track' ? 'song' : PLAY_KIND_LABEL[kind];
  return `Unable to stream that ${label} right now`;
}

export function summarizeLoop(enabled: boolean): string {
  return enabled ? 'Loop enabled' : 'Loop disabled';
}

export function summarizeLoopNoPlayback(): string {
  return 'Loop toggle ignored — nothing is playing';
}

export function summarizeSeek(direction: 'forward' | 'backward', seconds: number): string {
  const dir = direction === 'forward' ? 'forward' : 'back';
  return `Skipped ${dir} ${seconds} seconds`;
}

export function summarizeSeekTo(offsetMs: number): string {
  const totalSeconds = Math.floor(offsetMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `Jumped to ${minutes}:${seconds}`;
}

export function summarizeStartOver(): string {
  return 'Restarted track';
}

export function summarizeSeekNoPlayback(): string {
  return 'Seek ignored — nothing is playing';
}

export function summarizeTransport(
  action: 'pause' | 'resume' | 'next' | 'previous',
  trackTitle?: string,
): string {
  switch (action) {
    case 'pause':
      return 'Paused';
    case 'resume':
      return trackTitle ? `Resumed "${trackTitle}"` : 'Resumed playback';
    case 'next':
      return trackTitle ? `Skipped to "${trackTitle}"` : 'Skipped to next track';
    case 'previous':
      return trackTitle ? `Went back to "${trackTitle}"` : 'Went to previous track';
  }
}

export function summarizeQueueEnd(): string {
  return 'Already at the end of the queue';
}

export function summarizeQueueStart(): string {
  return 'Already at the beginning of the queue';
}

export function summarizeNothingPlaying(): string {
  return 'Nothing is playing right now';
}

export function summarizePlaybackStarted(title: string, artist?: string): string {
  if (artist) return `Now playing "${title}" by ${artist}`;
  return `Now playing "${title}"`;
}

export function summarizePlaybackFinished(title: string, artist?: string): string {
  if (artist) return `Finished "${title}" by ${artist}`;
  return `Finished "${title}"`;
}

export function summarizeFallback(intentName?: string): string {
  if (intentName) return `Didn't understand (${intentName})`;
  return "Didn't understand that request";
}
