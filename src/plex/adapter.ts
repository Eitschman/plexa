import {
  PlexServer,
  Playlist,
  Track,
  Album,
  Artist,
  MusicSection,
} from '@ctrl/plex';
import { fetchItem, fetchItems } from '@ctrl/plex/dist/src/baseFunctionality.js';

export interface PlexTrackSummary {
  ratingKey: string;
  title: string;
  artist?: string;
  album?: string;
  durationMs?: number;
  thumb?: string;
  playlistItemId?: string;
}

export interface PlexAlbumSummary {
  ratingKey: string;
  title: string;
  artist?: string;
  thumb?: string;
  year?: number;
}

export interface PlexArtistSummary {
  ratingKey: string;
  title: string;
  thumb?: string;
}

export interface PlexPlaylistSummary {
  ratingKey: string;
  title: string;
  leafCount?: number;
  duration?: number;
  thumb?: string;
}

export interface PlexLibrarySection {
  key: string;
  title: string;
  type: string;
}

export interface PlexConnectionInfo {
  name: string;
  version?: string;
  platform?: string;
}

export interface PageOptions {
  start?: number;
  size?: number;
  sort?: string;
}

export interface PageResult<T> {
  items: T[];
  nextStart: number;
  hasMore: boolean;
}

export type LibrarySort = 'title' | 'titleDesc' | 'addedAt' | 'year' | 'yearDesc';
export type SearchMediaType = 'tracks' | 'albums' | 'artists' | 'playlists';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

/** Prefer track art, then album, then artist — Plex tracks often omit thumb. */
export function resolveTrackThumb(track: {
  thumb?: string;
  parentThumb?: string;
  grandparentThumb?: string;
}): string | undefined {
  return track.thumb ?? track.parentThumb ?? track.grandparentThumb;
}

/**
 * Plex sometimes returns absolute thumb URLs (plex.direct) with an embedded token.
 * Always reduce to a library pathname so we can proxy via our baseUrl + token.
 */
export function normalizeThumbPath(thumbPath: string): string {
  const trimmed = thumbPath.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      return new URL(trimmed).pathname;
    } catch {
      // fall through
    }
  }
  const withoutQuery = trimmed.split('?')[0] ?? trimmed;
  return withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
}

export function clampPageOptions(options: PageOptions = {}): { start: number; size: number; sort?: string } {
  const start = Number.isFinite(options.start) ? Math.max(0, Math.floor(options.start ?? 0)) : 0;
  const rawSize = Number.isFinite(options.size) ? Math.floor(options.size ?? DEFAULT_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, rawSize || DEFAULT_PAGE_SIZE));
  return { start, size, sort: options.sort };
}

export function mapLibrarySort(sort?: string, libtype: 'artist' | 'album' | 'track' = 'artist'): string | undefined {
  switch (sort) {
    case 'title':
      return 'titleSort';
    case 'titleDesc':
      return 'titleSort:desc';
    case 'addedAt':
      return 'addedAt:desc';
    case 'year':
      return libtype === 'album' ? 'year' : undefined;
    case 'yearDesc':
      return libtype === 'album' ? 'year:desc' : undefined;
    default:
      return undefined;
  }
}

function toPageResult<T>(fetched: T[], start: number, size: number): PageResult<T> {
  const hasMore = fetched.length > size;
  const items = hasMore ? fetched.slice(0, size) : fetched;
  return {
    items,
    nextStart: start + items.length,
    hasMore,
  };
}

function mapTrack(track: Track): PlexTrackSummary {
  return {
    ratingKey: String(track.ratingKey),
    title: track.title ?? 'Unknown',
    artist: track.grandparentTitle,
    album: track.parentTitle,
    durationMs: track.duration,
    thumb: resolveTrackThumb(track),
    playlistItemId: track.playlistItemID ? String(track.playlistItemID) : undefined,
  };
}

function mapAlbum(album: Album): PlexAlbumSummary {
  return {
    ratingKey: String(album.ratingKey),
    title: album.title ?? 'Unknown',
    artist: album.parentTitle,
    thumb: album.thumb,
    year: album.year,
  };
}

function mapArtist(artist: Artist): PlexArtistSummary {
  return {
    ratingKey: String(artist.ratingKey),
    title: artist.title ?? 'Unknown',
    thumb: artist.thumb,
  };
}

function mapPlaylist(playlist: Playlist): PlexPlaylistSummary {
  return {
    ratingKey: String(playlist.ratingKey),
    title: playlist.title ?? 'Unknown',
    leafCount: playlist.leafCount,
    duration: playlist.duration,
    thumb: playlist.composite,
  };
}

function playlistPath(playlistKey: string): string {
  return playlistKey.startsWith('/') ? playlistKey : `/playlists/${playlistKey}`;
}

/** @ctrl/plex only prefixes /library/metadata/ for numeric keys; we always use strings. */
export function metadataPath(ratingKey: string): string {
  return ratingKey.startsWith('/') ? ratingKey : `/library/metadata/${ratingKey}`;
}

export class PlexAdapter {
  private server: PlexServer | null = null;
  private baseUrl: string | null = null;
  private token: string | null = null;

  async connect(url: string, token: string): Promise<PlexConnectionInfo> {
    this.baseUrl = url.replace(/\/$/, '');
    this.token = token;
    this.server = new PlexServer(this.baseUrl, token);
    await this.server.connect();
    return {
      name: this.server.friendlyName ?? 'Plex Server',
      version: this.server.version,
      platform: this.server.platform,
    };
  }

  private ensureConnected(): PlexServer {
    if (!this.server || !this.baseUrl || !this.token) {
      throw new Error('Plex not configured');
    }
    return this.server;
  }

  getCredentials(): { baseUrl: string; token: string } {
    if (!this.baseUrl || !this.token) throw new Error('Plex not configured');
    return { baseUrl: this.baseUrl, token: this.token };
  }

  async listLibraries(): Promise<PlexLibrarySection[]> {
    const server = this.ensureConnected();
    const library = await server.library();
    const sections = await library.sections();
    return sections.map((s) => ({
      key: String(s.key),
      title: s.title ?? 'Library',
      type: String(s.type),
    }));
  }

  async getMusicSection(sectionKey: string): Promise<MusicSection> {
    const server = this.ensureConnected();
    const library = await server.library();
    const section = await library.sectionByID(sectionKey);
    if (!(section instanceof MusicSection)) {
      throw new Error('Selected library is not a music section');
    }
    return section;
  }

  private async pageSection<T>(
    section: MusicSection,
    libtype: 'artist' | 'album' | 'track',
    options: PageOptions,
    mapFn: (item: Artist | Album | Track) => T,
  ): Promise<PageResult<T>> {
    const { start, size, sort } = clampPageOptions(options);
    const plexSort = mapLibrarySort(sort, libtype);
    const window = size + 1;
    const items = await section.all({
      libtype,
      container_start: start,
      container_size: window,
      maxResults: window,
      ...(plexSort ? { sort: plexSort } : {}),
    });
    return toPageResult(items.map((item) => mapFn(item as Artist | Album | Track)), start, size);
  }

  async searchMusic(sectionKey: string, query: string, limit = 8): Promise<{
    tracks: PlexTrackSummary[];
    albums: PlexAlbumSummary[];
    artists: PlexArtistSummary[];
    playlists: PlexPlaylistSummary[];
  }> {
    const section = await this.getMusicSection(sectionKey);
    const tracks = (await section.searchTracks({
      title: query,
      limit,
      maxresults: limit,
      container_start: 0,
      container_size: limit,
    })).map(mapTrack);
    const albums = (await section.searchAlbums({
      title: query,
      limit,
      maxresults: limit,
      container_start: 0,
      container_size: limit,
    })).map(mapAlbum);
    const artists = (await section.searchArtists({
      title: query,
      limit,
      maxresults: limit,
      container_start: 0,
      container_size: limit,
    })).map(mapArtist);

    const playlistsPage = await this.listPlaylistsPage({ start: 0, size: 200 });
    const q = query.toLowerCase();
    const matchedPlaylists = playlistsPage.items
      .filter((p) => p.title.toLowerCase().includes(q))
      .slice(0, limit);

    return { tracks, albums, artists, playlists: matchedPlaylists };
  }

  async searchMusicType(
    sectionKey: string,
    query: string,
    type: SearchMediaType,
    options: PageOptions = {},
  ): Promise<PageResult<PlexTrackSummary | PlexAlbumSummary | PlexArtistSummary | PlexPlaylistSummary>> {
    const { start, size } = clampPageOptions(options);
    const window = size + 1;
    const section = await this.getMusicSection(sectionKey);

    if (type === 'playlists') {
      const all = await this.listPlaylists();
      const q = query.toLowerCase();
      const matched = all.filter((p) => p.title.toLowerCase().includes(q));
      const page = matched.slice(start, start + window);
      return toPageResult(page, start, size);
    }

    if (type === 'tracks') {
      const items = await section.searchTracks({
        title: query,
        container_start: start,
        container_size: window,
        maxresults: window,
      });
      return toPageResult(items.map(mapTrack), start, size);
    }

    if (type === 'albums') {
      const items = await section.searchAlbums({
        title: query,
        container_start: start,
        container_size: window,
        maxresults: window,
      });
      return toPageResult(items.map(mapAlbum), start, size);
    }

    const items = await section.searchArtists({
      title: query,
      container_start: start,
      container_size: window,
      maxresults: window,
    });
    return toPageResult(items.map(mapArtist), start, size);
  }

  async listArtists(sectionKey: string, start = 0, size = 50, sort?: string): Promise<PlexArtistSummary[]> {
    const page = await this.listArtistsPage(sectionKey, { start, size, sort });
    return page.items;
  }

  async listArtistsPage(sectionKey: string, options: PageOptions = {}): Promise<PageResult<PlexArtistSummary>> {
    const section = await this.getMusicSection(sectionKey);
    return this.pageSection(section, 'artist', options, (item) => mapArtist(item as Artist));
  }

  async listAlbums(sectionKey: string, start = 0, size = 50, sort?: string): Promise<PlexAlbumSummary[]> {
    const page = await this.listAlbumsPage(sectionKey, { start, size, sort });
    return page.items;
  }

  async listAlbumsPage(sectionKey: string, options: PageOptions = {}): Promise<PageResult<PlexAlbumSummary>> {
    const section = await this.getMusicSection(sectionKey);
    return this.pageSection(section, 'album', options, (item) => mapAlbum(item as Album));
  }

  async listTracks(sectionKey: string, start = 0, size = 50, sort?: string): Promise<PlexTrackSummary[]> {
    const page = await this.listTracksPage(sectionKey, { start, size, sort });
    return page.items;
  }

  async listTracksPage(sectionKey: string, options: PageOptions = {}): Promise<PageResult<PlexTrackSummary>> {
    const section = await this.getMusicSection(sectionKey);
    return this.pageSection(section, 'track', options, (item) => mapTrack(item as Track));
  }

  async getAlbumTracks(albumKey: string): Promise<PlexTrackSummary[]> {
    const page = await this.getAlbumTracksPage(albumKey, { start: 0, size: MAX_PAGE_SIZE });
    if (!page.hasMore) return page.items;
    const all: PlexTrackSummary[] = [...page.items];
    let start = page.nextStart;
    while (true) {
      const next = await this.getAlbumTracksPage(albumKey, { start, size: MAX_PAGE_SIZE });
      all.push(...next.items);
      if (!next.hasMore) break;
      start = next.nextStart;
    }
    return all;
  }

  async getAlbumTracksPage(albumKey: string, options: PageOptions = {}): Promise<PageResult<PlexTrackSummary>> {
    const server = this.ensureConnected();
    const { start, size } = clampPageOptions(options);
    const window = size + 1;
    const items = await fetchItems(
      server,
      `${metadataPath(albumKey)}/children`,
      undefined,
      Track,
      undefined,
      { containerStart: start, containerSize: window, maxResults: window },
    );
    return toPageResult(items.map(mapTrack), start, size);
  }

  async getArtistAlbums(artistKey: string): Promise<PlexAlbumSummary[]> {
    const page = await this.getArtistAlbumsPage(artistKey, { start: 0, size: MAX_PAGE_SIZE });
    if (!page.hasMore) return page.items;
    const all: PlexAlbumSummary[] = [...page.items];
    let start = page.nextStart;
    while (true) {
      const next = await this.getArtistAlbumsPage(artistKey, { start, size: MAX_PAGE_SIZE });
      all.push(...next.items);
      if (!next.hasMore) break;
      start = next.nextStart;
    }
    return all;
  }

  async getArtistAlbumsPage(artistKey: string, options: PageOptions = {}): Promise<PageResult<PlexAlbumSummary>> {
    const server = this.ensureConnected();
    const artist = await fetchItem(server, metadataPath(artistKey), undefined, Artist);
    const { start, size, sort } = clampPageOptions(options);
    const window = size + 1;
    const plexSort = mapLibrarySort(sort, 'album');
    const albums = await artist.albums({
      container_start: start,
      container_size: window,
      maxresults: window,
      ...(plexSort ? { sort: plexSort } : {}),
    });
    return toPageResult(albums.map(mapAlbum), start, size);
  }

  async listPlaylists(): Promise<PlexPlaylistSummary[]> {
    const page = await this.listPlaylistsPage({ start: 0, size: MAX_PAGE_SIZE });
    if (!page.hasMore) return page.items;
    const all: PlexPlaylistSummary[] = [...page.items];
    let start = page.nextStart;
    while (true) {
      const next = await this.listPlaylistsPage({ start, size: MAX_PAGE_SIZE });
      all.push(...next.items);
      if (!next.hasMore) break;
      start = next.nextStart;
    }
    return all;
  }

  async listPlaylistsPage(options: PageOptions = {}): Promise<PageResult<PlexPlaylistSummary>> {
    const server = this.ensureConnected();
    const { start, size } = clampPageOptions(options);
    const window = size + 1;
    let items: Playlist[];
    try {
      items = await fetchItems(
        server,
        '/playlists?playlistType=audio',
        undefined,
        Playlist,
        server,
        { containerStart: start, containerSize: window, maxResults: window },
      );
    } catch (err) {

      throw err;
    }

    return toPageResult(items.map(mapPlaylist), start, size);
  }

  async getPlaylistTracks(playlistKey: string): Promise<PlexTrackSummary[]> {
    const page = await this.getPlaylistTracksPage(playlistKey, { start: 0, size: MAX_PAGE_SIZE });
    if (!page.hasMore) return page.items;
    const all: PlexTrackSummary[] = [...page.items];
    let start = page.nextStart;
    while (true) {
      const next = await this.getPlaylistTracksPage(playlistKey, { start, size: MAX_PAGE_SIZE });
      all.push(...next.items);
      if (!next.hasMore) break;
      start = next.nextStart;
    }
    return all;
  }

  async getPlaylistTracksPage(playlistKey: string, options: PageOptions = {}): Promise<PageResult<PlexTrackSummary>> {
    const server = this.ensureConnected();
    const { start, size } = clampPageOptions(options);
    const window = size + 1;
    const key = `${playlistPath(playlistKey)}/items`;
    const items = await fetchItems(
      server,
      key,
      undefined,
      Track,
      undefined,
      { containerStart: start, containerSize: window, maxResults: window },
    );
    return toPageResult(items.map(mapTrack), start, size);
  }

  async getArtist(artistKey: string): Promise<PlexArtistSummary | null> {
    const server = this.ensureConnected();
    try {
      const artist = await fetchItem(server, metadataPath(artistKey), undefined, Artist);
      return mapArtist(artist);
    } catch {
      return null;
    }
  }

  async getAlbum(albumKey: string): Promise<PlexAlbumSummary | null> {
    const server = this.ensureConnected();
    try {
      const album = await fetchItem(server, metadataPath(albumKey), undefined, Album);
      return mapAlbum(album);
    } catch {
      return null;
    }
  }

  async getArtistTracks(artistKey: string): Promise<PlexTrackSummary[]> {
    const page = await this.getArtistTracksPage(artistKey, { start: 0, size: MAX_PAGE_SIZE });
    if (!page.hasMore) return page.items;
    const all: PlexTrackSummary[] = [...page.items];
    let start = page.nextStart;
    while (true) {
      const next = await this.getArtistTracksPage(artistKey, { start, size: MAX_PAGE_SIZE });
      all.push(...next.items);
      if (!next.hasMore) break;
      start = next.nextStart;
    }
    return all;
  }

  async getArtistTracksPage(artistKey: string, options: PageOptions = {}): Promise<PageResult<PlexTrackSummary>> {
    const server = this.ensureConnected();
    const { start, size } = clampPageOptions(options);
    const window = size + 1;
    const items = await fetchItems(
      server,
      `${metadataPath(artistKey)}/allLeaves`,
      undefined,
      Track,
      undefined,
      { containerStart: start, containerSize: window, maxResults: window },
    );
    return toPageResult(items.map(mapTrack), start, size);
  }

  async createPlaylist(title: string, trackKeys: string[]): Promise<PlexPlaylistSummary> {
    const server = this.ensureConnected();
    const tracks = await Promise.all(
      trackKeys.map((key) => fetchItem(server, metadataPath(key), undefined, Track)),
    );
    const playlist = await Playlist.create(server, title, { items: tracks });
    return mapPlaylist(playlist);
  }

  async renamePlaylist(playlistKey: string, title: string): Promise<void> {
    const server = this.ensureConnected();
    await Playlist.update(server, playlistKey, { title });
  }

  async deletePlaylist(playlistKey: string): Promise<void> {
    const server = this.ensureConnected();
    const playlist = await fetchItem(server, playlistPath(playlistKey), undefined, Playlist);
    await playlist.delete();
  }

  async addTracksToPlaylist(playlistKey: string, trackKeys: string[]): Promise<void> {
    const server = this.ensureConnected();
    const playlist = await fetchItem(server, playlistPath(playlistKey), undefined, Playlist);
    const tracks = await Promise.all(
      trackKeys.map((key) => fetchItem(server, metadataPath(key), undefined, Track)),
    );
    await playlist.addItems(tracks);
  }

  async removePlaylistItem(playlistKey: string, playlistItemId: string): Promise<void> {
    const server = this.ensureConnected();
    const playlist = await fetchItem(server, playlistPath(playlistKey), undefined, Playlist);
    const items = await playlist.items({ libtype: 'track' });
    const match = items.find((item) => String((item as Track).playlistItemID) === playlistItemId);
    if (match) await playlist.removeItems([match]);
  }

  async reorderPlaylistItem(
    playlistKey: string,
    playlistItemId: string,
    afterPlaylistItemId?: string,
  ): Promise<void> {
    const server = this.ensureConnected();
    const playlist = await fetchItem(server, playlistPath(playlistKey), undefined, Playlist);
    const items = await playlist.items({ libtype: 'track' });
    const item = items.find((entry) => String((entry as Track).playlistItemID) === playlistItemId);
    if (!item) throw new Error('Playlist item not found');
    const after = afterPlaylistItemId
      ? items.find((entry) => String((entry as Track).playlistItemID) === afterPlaylistItemId)
      : undefined;
    await playlist.moveItem(item, after ? { after } : undefined);
  }

  async getTrack(ratingKey: string): Promise<PlexTrackSummary | null> {
    const server = this.ensureConnected();
    try {
      const track = await fetchItem(server, metadataPath(ratingKey), undefined, Track);
      return mapTrack(track);
    } catch {
      return null;
    }
  }

  async getMediaParts(ratingKey: string): Promise<{ key: string; file?: string }[]> {
    const server = this.ensureConnected();
    const track = await fetchItem(server, metadataPath(ratingKey), undefined, Track);
    const parts: { key: string; file?: string }[] = [];
    for (const media of track.media ?? []) {
      for (const part of media.parts ?? []) {
        if (part.key) parts.push({ key: part.key, file: part.file });
      }
    }
    return parts;
  }

  buildDirectStreamUrl(partKey: string): string {
    const { baseUrl, token } = this.getCredentials();
    return `${baseUrl}${partKey}?X-Plex-Token=${encodeURIComponent(token)}`;
  }

  buildTranscodeUrl(ratingKey: string, sessionId: string): string {
    const { baseUrl, token } = this.getCredentials();
    const path = `/library/metadata/${ratingKey}`;
    const params = new URLSearchParams({
      path,
      directStreamAudio: '1',
      protocol: 'hls',
      directPlay: '1',
      hasMDE: '1',
      'X-Plex-Token': token,
      'X-Plex-Client-Identifier': 'plexa',
      'X-Plex-Device': 'Plexa',
      'X-Plex-Session-Identifier': sessionId,
    });
    return `${baseUrl}/music/:/transcode/universal/start.m3u8?${params.toString()}`;
  }

  buildArtworkUrl(thumbPath: string): string {
    const { baseUrl, token } = this.getCredentials();
    const path = normalizeThumbPath(thumbPath);
    return `${baseUrl}${path}?X-Plex-Token=${encodeURIComponent(token)}`;
  }
}

export const plexAdapter = new PlexAdapter();
