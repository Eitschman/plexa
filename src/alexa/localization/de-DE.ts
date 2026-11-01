import type { AlexaMessages } from './messages.js';

export const deDE: AlexaMessages = {
  launchWelcome: (invocationName) =>
    `Willkommen bei ${invocationName}. Du kannst mich bitten, eine Playlist, einen Künstler, ein Album oder einen Titel abzuspielen.`,
  help: () =>
    'Versuch zum Beispiel: starte meine Autofahrt-Playlist, starte Orden Ogan, spiele das Album Final Days oder spiele Gunman. Du kannst auch sagen Wiederholung an, springe 30 Sekunden vor, spule 15 Sekunden zurück oder springe zu Minute zwei.',
  stopping: () => 'Die Wiedergabe wird gestoppt.',
  whichPlaylist: () => 'Welche Playlist möchtest du hören?',
  playlistNotFound: (name) => `Ich konnte keine Playlist namens ${name} finden.`,
  playlistEmpty: () => 'Diese Playlist ist leer.',
  playlistStreamFailed: () => 'Diese Playlist kann momentan nicht wiedergegeben werden.',
  plexNotConfiguredSetup: () =>
    'Plex ist nicht konfiguriert. Bitte richte es auf der Plexa-Einstellungsseite ein.',
  whichArtist: () => 'Welchen Künstler möchtest du hören?',
  notFound: (name) => `Ich konnte ${name} nicht finden.`,
  artistEmpty: () => 'Für diesen Künstler wurden keine Titel gefunden.',
  artistStreamFailed: () => 'Dieser Künstler kann momentan nicht wiedergegeben werden.',
  plexNotConfigured: () => 'Plex ist nicht konfiguriert.',
  whichAlbum: () => 'Welches Album möchtest du hören?',
  albumNotFound: (name) => `Ich konnte das Album ${name} nicht finden.`,
  albumEmpty: () => 'Dieses Album enthält keine Titel.',
  albumStreamFailed: () => 'Dieses Album kann momentan nicht wiedergegeben werden.',
  whichSong: () => 'Welchen Titel möchtest du hören?',
  trackStreamFailed: () => 'Dieser Titel kann momentan nicht wiedergegeben werden.',
  nothingPlaying: () => 'Momentan wird nichts wiedergegeben.',
  loopOn: () => 'Die Wiederholung ist an.',
  loopOff: () => 'Die Wiederholung ist aus.',
  seekUsage: () =>
    'Um innerhalb eines Titels zu springen, sage spule 30 Sekunden zurück oder springe 30 Sekunden vor. Um einen Titel abzuspielen, sage spiele den Titel und den Namen.',
  seekToUsage: () =>
    'Um zu einer Stelle im Titel zu springen, sage springe zu Minute zwei oder springe zu einer Minute 30 Sekunden.',
  seekFailed: () => 'Springen ist momentan nicht möglich.',
  streamFailed: () => 'Die Wiedergabe ist momentan nicht möglich.',
  queueEnd: () => 'Du bist am Ende der Warteschlange.',
  queueStart: () => 'Du bist am Anfang der Warteschlange.',
  fallback: () =>
    'Das habe ich nicht verstanden. Bitte mich, eine Playlist, einen Künstler, ein Album oder einen Titel abzuspielen.',
  unknownTitle: () => 'Unbekannt',
};
