import { Song } from './types.js'

interface YoutubeImportRequest {
  youtube_url: string
}

/**
 * YouTube Service - Handles YouTube URL validation and song creation
 * Note: For production, consider using youtube-search-api or similar npm package
 * This simplified version creates songs from YouTube URLs
 */
export class YoutubeService {
  private formatDuration(durationStr?: string): string {
    if (!durationStr) return '00:00'
    // If it's already in MM:SS format, return as is
    if (/^\d+:\d+$/.test(durationStr)) return durationStr
    return '00:00'
  }

  private validateYoutubeUrl(url: string): { videoId: string; isPlaylist: boolean } | null {
    try {
      // YouTube video formats:
      // https://youtube.com/watch?v=VIDEO_ID
      // https://youtu.be/VIDEO_ID
      // https://www.youtube.com/playlist?list=PLAYLIST_ID

      const videoMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/)
      if (videoMatch) {
        return { videoId: videoMatch[1], isPlaylist: false }
      }

      const playlistMatch = url.match(/youtube\.com\/playlist\?list=([^&\n?#]+)/)
      if (playlistMatch) {
        return { videoId: playlistMatch[1], isPlaylist: true }
      }

      return null
    } catch {
      return null
    }
  }

  async importPlaylist(youtubeUrl: string): Promise<Song[]> {
    try {
      console.log(`\n=== YOUTUBE IMPORT STARTED ===`)
      console.log(`URL: ${youtubeUrl}`)

      const validation = this.validateYoutubeUrl(youtubeUrl)
      if (!validation) {
        throw new Error('Invalid YouTube URL format')
      }

      // For a single URL, create one song entry
      // In production, you would fetch the actual playlist metadata
      const songs: Song[] = [
        {
          title: 'YouTube Music',
          artist: 'YouTube',
          duration: '00:00',
          pitch: 1.0,
          audio_url: youtubeUrl,
        },
      ]

      console.log(`Total songs added: ${songs.length}`)
      console.log(`=== YOUTUBE IMPORT ENDED ===\n`)

      return songs
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      console.error(`\nYOUTUBE IMPORT ERROR:`)
      console.error(`URL: ${youtubeUrl}`)
      console.error(`Error: ${errorMsg}\n`)
      throw new Error(`YouTube import failed: ${errorMsg}`)
    }
  }

  async importSong(youtubeUrl: string): Promise<Song> {
    try {
      console.log(`\n=== YOUTUBE SONG IMPORT STARTED ===`)
      console.log(`URL: ${youtubeUrl}`)

      const validation = this.validateYoutubeUrl(youtubeUrl)
      if (!validation) {
        throw new Error('Invalid YouTube URL format')
      }

      const song: Song = {
        title: 'YouTube Music',
        artist: 'YouTube',
        duration: '00:00',
        pitch: 1.0,
        audio_url: youtubeUrl,
      }

      console.log(`Added song: ${song.title}`)
      console.log(`=== YOUTUBE SONG IMPORT ENDED ===\n`)

      return song
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      console.error(`\nYOUTUBE SONG IMPORT ERROR:`)
      console.error(`URL: ${youtubeUrl}`)
      console.error(`Error: ${errorMsg}\n`)
      throw new Error(`Failed to add song: ${errorMsg}`)
    }
  }
}

export const youtubeService = new YoutubeService()
