import type { AlexaMessages } from './messages.js';

export const frFR: AlexaMessages = {
  launchWelcome: (invocationName) =>
    `Bienvenue dans ${invocationName}. Vous pouvez me demander de lire une playlist, un artiste, un album ou une chanson.`,
  help: () =>
    "Essayez : lance ma playlist voyage, lance Fleetwood Mac, joue l'album Rumours, ou joue Dreams de Fleetwood Mac. Vous pouvez aussi dire active la répétition, avance de 30 secondes, recule de 15 secondes, ou va à deux minutes.",
  stopping: () => 'Arrêt de la lecture.',
  whichPlaylist: () => 'Quelle playlist voulez-vous écouter ?',
  playlistNotFound: (name) => `Je n’ai trouvé aucune playlist nommée ${name}.`,
  playlistEmpty: () => 'Cette playlist est vide.',
  playlistStreamFailed: () => 'Impossible de lire cette playlist pour le moment.',
  plexNotConfiguredSetup: () =>
    "Plex n'est pas configuré. Veuillez le configurer dans la page des paramètres de Plexa.",
  whichArtist: () => 'Quel artiste ?',
  notFound: (name) => `Je n'ai pas trouvé ${name}.`,
  artistEmpty: () => 'Aucun titre trouvé pour cet artiste.',
  artistStreamFailed: () => 'Impossible de lancer les morceaux de cet artiste pour le moment',
  plexNotConfigured: () => "Plex n'est pas configuré.",
  whichAlbum: () => 'Quel album ?',
  albumNotFound: (name) => `Je n'ai pas trouvé l'album ${name}.`,
  albumEmpty: () => 'Cet album ne contient aucun titre.',
  albumStreamFailed: () => 'Impossible de lire cet album pour le moment.',
  whichSong: () => 'Quelle chanson ?',
  trackStreamFailed: () => 'Impossible de lire ce titre pour le moment.',
  nothingPlaying: () => "Rien n'est en cours de lecture.",
  loopOn: () => 'La répétition est activée.',
  loopOff: () => 'La répétition est désactivée.',
  seekUsage: () =>
    'Pour avancer ou reculer dans une chanson, dites recule de 30 secondes ou avance de 30 secondes. Pour lancer une chanson, dites Joue, suivi du titre de la chanson.',
  seekToUsage: () =>
    'Pour aller à un moment de la chanson, dites va à deux minutes ou saute à une minute 30 secondes.',
  seekFailed: () => 'Impossible de se déplacer dans le titre pour le moment.',
  streamFailed: () => 'Impossible de lire pour le moment.',
  queueEnd: () => "Vous êtes à la fin de la file d'attente.",
  queueStart: () => "Vous êtes au début de la file d'attente.",
  fallback: () =>
    "Je n'ai pas compris. Essayez de me demander de lire une playlist, un artiste, un album ou une chanson.",
  unknownTitle: () => 'Inconnu',
};
