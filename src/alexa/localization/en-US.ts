import type { AlexaMessages } from './messages.js';

export const enUS: AlexaMessages = {
  launchWelcome: (invocationName) =>
    `Welcome to ${invocationName}. You can ask me to play a playlist, artist, album, or song.`,
  help: () =>
    'Try: start my road trip playlist, start Fleetwood Mac, play the album Rumours, or play Dreams by Fleetwood Mac. You can also say loop on, skip forward 30 seconds, go back 15 seconds, or skip to two minutes.',
  stopping: () => 'Stopping playback.',
  whichPlaylist: () => 'Which playlist would you like to play?',
  playlistNotFound: (name) => `I couldn't find a playlist called ${name}.`,
  playlistEmpty: () => 'That playlist is empty.',
  playlistStreamFailed: () => 'Unable to stream that playlist right now.',
  plexNotConfiguredSetup: () =>
    'Plex is not configured. Please set it up in the Plexa settings page.',
  whichArtist: () => 'Which artist?',
  notFound: (name) => `I couldn't find ${name}.`,
  artistEmpty: () => 'No tracks found for that artist.',
  artistStreamFailed: () => 'Unable to stream that artist right now.',
  plexNotConfigured: () => 'Plex is not configured.',
  whichAlbum: () => 'Which album?',
  albumNotFound: (name) => `I couldn't find the album ${name}.`,
  albumEmpty: () => 'That album has no tracks.',
  albumStreamFailed: () => 'Unable to stream that album right now.',
  whichSong: () => 'Which song?',
  trackStreamFailed: () => 'Unable to stream that track right now.',
  nothingPlaying: () => 'Nothing is playing right now.',
  loopOn: () => 'Loop is on.',
  loopOff: () => 'Loop is off.',
  seekUsage: () =>
    'To skip within a song, say go back 30 seconds or skip forward 30 seconds. To play a song, say play song and the name.',
  seekToUsage: () =>
    'To jump within a song, say skip to two minutes or jump to one minute 30 seconds.',
  seekFailed: () => 'Unable to seek right now.',
  streamFailed: () => 'Unable to stream right now.',
  queueEnd: () => 'You are at the end of the queue.',
  queueStart: () => 'You are at the beginning of the queue.',
  fallback: () =>
    "I didn't understand that. Try asking me to play a playlist, artist, album, or song.",
  unknownTitle: () => 'Unknown',
};
