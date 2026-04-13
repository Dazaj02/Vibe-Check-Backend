export interface Song {
  title: string
  artist: string
  duration: string
  pitch: number
  audio_url: string
}

export interface Playlist {
  name: string
  songs: Song[]
}

export interface PlaylistState {
  songs: Song[]
  current: Song | null
}

export interface YoutubeImportRequest {
  youtube_url: string
}
