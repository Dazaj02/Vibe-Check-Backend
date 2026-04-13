import express, { Express, Request, Response, NextFunction } from 'express'
import cors from 'cors'
import multer from 'multer'
import path from 'path'
import fs from 'fs/promises'
import { fileURLToPath } from 'url'
import ytdl from 'ytdl-core'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ============ TYPES ============
interface Song {
  title: string
  artist: string
  duration: string
  pitch: number
  audio_url: string
}

interface Playlist {
  name: string
  songs: Song[]
}

interface YoutubeImportRequest {
  youtube_url: string
}

// ============ CONFIGURATION ============
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8000
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads')
const PLAYLISTS_FILE = path.join(__dirname, '..', 'playlists.json')

// CORS Configuration
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:8000',
]

// Ensure uploads directory exists
await fs.mkdir(UPLOADS_DIR, { recursive: true }).catch(() => {})

// ============ MULTER CONFIGURATION ============
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${file.originalname}`)
    },
  }),
  fileFilter: (_req, file, cb) => {
    const allowedMimes = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/aac', 'application/octet-stream']
    const allowedExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.aac']
    const fileExt = file.originalname.toLowerCase().substring(file.originalname.lastIndexOf('.'))
    
    if (allowedMimes.includes(file.mimetype) || allowedExtensions.includes(fileExt)) {
      cb(null, true)
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}`))
    }
  },
})

// ============ PLAYLIST SERVICE ============
class PlaylistService {
  private playlists: Map<string, Song[]> = new Map()
  private currentPlaylist: string | null = null
  private currentIndex: number = -1

  async loadPlaylists(): Promise<void> {
    try {
      const exists = await this.fileExists(PLAYLISTS_FILE)
      if (exists) {
        const data = await fs.readFile(PLAYLISTS_FILE, 'utf-8')
        const parsed = JSON.parse(data) as Record<string, Song[]>
        this.playlists = new Map(Object.entries(parsed))
        console.log(`✓ Loaded ${this.playlists.size} playlists`)
      }
    } catch (error) {
      console.error('❌ Error loading playlists:', error)
      this.playlists = new Map()
    }
  }

  async savePlaylists(): Promise<void> {
    try {
      const data = Object.fromEntries(this.playlists)
      await fs.writeFile(PLAYLISTS_FILE, JSON.stringify(data, null, 2))
    } catch (error) {
      console.error('❌ Error saving playlists:', error)
    }
  }

  private async fileExists(filepath: string): Promise<boolean> {
    try {
      await fs.access(filepath)
      return true
    } catch {
      return false
    }
  }

  // ===== PLAYLIST MANAGEMENT =====
  createPlaylist(name: string): boolean {
    if (this.playlists.has(name)) return false
    this.playlists.set(name, [])
    this.savePlaylists().catch(err => console.error('Save error:', err))
    return true
  }

  getPlaylists(): string[] {
    return Array.from(this.playlists.keys())
  }

  getPlaylist(name: string): Song[] | null {
    return this.playlists.get(name) || null
  }

  addSongToPlaylist(playlistName: string, song: Song): boolean {
    const playlist = this.playlists.get(playlistName)
    if (!playlist) return false
    playlist.push(song)
    this.savePlaylists().catch(err => console.error('Save error:', err))
    return true
  }

  deletePlaylist(name: string): boolean {
    const deleted = this.playlists.delete(name)
    if (deleted) this.savePlaylists().catch(err => console.error('Save error:', err))
    return deleted
  }

  removeSongFromPlaylist(playlistName: string, songTitle: string): boolean {
    const playlist = this.playlists.get(playlistName)
    if (!playlist) return false
    const initialLength = playlist.length
    const filtered = playlist.filter(song => song.title !== songTitle)
    if (filtered.length === initialLength) return false
    this.playlists.set(playlistName, filtered)
    this.savePlaylists().catch(err => console.error('Save error:', err))
    return true
  }

  sortPlaylist(playlistName: string, sortBy: 'title' | 'artist' | 'duration'): boolean {
    const playlist = this.playlists.get(playlistName)
    if (!playlist) return false

    const sorted = [...playlist].sort((a, b) => {
      const aVal = a[sortBy]
      const bVal = b[sortBy]
      if (typeof aVal === 'string') {
        return (aVal as string).localeCompare(bVal as string)
      }
      return 0
    })

    this.playlists.set(playlistName, sorted)
    this.savePlaylists().catch(err => console.error('Save error:', err))
    return true
  }

  moveSong(playlistName: string, fromIndex: number, toIndex: number): boolean {
    const playlist = this.playlists.get(playlistName)
    if (!playlist) return false
    if (fromIndex < 0 || fromIndex >= playlist.length) return false
    if (toIndex < 0 || toIndex >= playlist.length) return false
    if (fromIndex === toIndex) return true

    const song = playlist[fromIndex]
    playlist.splice(fromIndex, 1)
    playlist.splice(toIndex, 0, song)
    
    this.savePlaylists().catch(err => console.error('Save error:', err))
    return true
  }

  // ===== GLOBAL PLAYLIST STATE =====
  setCurrentPlaylist(name: string, index: number = 0): boolean {
    if (!this.playlists.has(name)) return false
    this.currentPlaylist = name
    this.currentIndex = Math.max(0, Math.min(index, this.playlists.get(name)?.length || 1) - 1)
    return true
  }

  getCurrentPlaylistName(): string | null {
    return this.currentPlaylist
  }

  getCurrentSong(): Song | null {
    if (!this.currentPlaylist || this.currentIndex < 0) return null
    const playlist = this.playlists.get(this.currentPlaylist)
    if (!playlist || this.currentIndex >= playlist.length) return null
    return playlist[this.currentIndex]
  }

  getPlaylistState(): { songs: Song[]; current: Song | null } {
    if (!this.currentPlaylist) {
      return { songs: [], current: null }
    }
    const songs = this.playlists.get(this.currentPlaylist) || []
    const current = this.getCurrentSong()
    return { songs, current }
  }

  nextSong(): Song | null {
    if (!this.currentPlaylist) return null
    const playlist = this.playlists.get(this.currentPlaylist)
    if (!playlist) return null
    if (this.currentIndex < playlist.length - 1) {
      this.currentIndex++
    }
    return this.getCurrentSong()
  }

  previousSong(): Song | null {
    if (!this.currentPlaylist) return null
    if (this.currentIndex > 0) {
      this.currentIndex--
    }
    return this.getCurrentSong()
  }

  selectSong(title: string): Song | null {
    if (!this.currentPlaylist) return null
    const playlist = this.playlists.get(this.currentPlaylist)
    if (!playlist) return null
    const index = playlist.findIndex(song => song.title === title)
    if (index >= 0) {
      this.currentIndex = index
    }
    return this.getCurrentSong()
  }

  modifyPitch(delta: number): Song | null {
    const current = this.getCurrentSong()
    if (!current) return null
    current.pitch = Math.max(0.5, Math.min(2.0, current.pitch + delta))
    return current
  }

  resetPitch(): Song | null {
    const current = this.getCurrentSong()
    if (current) {
      current.pitch = 1.0
    }
    return current
  }
}

// ============ YOUTUBE SERVICE (with ytdl-core) ============
class YoutubeService {
  private validateYoutubeUrl(url: string): boolean {
    try {
      // Support: youtube.com, youtu.be, music.youtube.com
      const isYoutubeHost = url.includes('youtube.com') || url.includes('youtu.be') || url.includes('music.youtube.com')
      
      // Check for video ID (v= or /watch?v=)
      const videoMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/.*[\?&]v=)([^&\n?#]+)/)
      // Check for playlist ID (list=)
      const playlistMatch = url.match(/[?&]list=([^&\n?#]+)/)
      
      return isYoutubeHost && !!(videoMatch || playlistMatch)
    } catch {
      return false
    }
  }

  private extractListId(url: string): string | null {
    const match = url.match(/[?&]list=([^&\n?#]+)/)
    return match ? match[1] : null
  }

  private extractVideoId(url: string): string | null {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/.*[\?&]v=)([^&\n?#]+)/)
    return match ? match[1] : null
  }

  private formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60
    
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    }
    return `${minutes}:${String(secs).padStart(2, '0')}`
  }

  async importPlaylist(youtubeUrl: string): Promise<Song[]> {
    try {
      console.log(`\n📥 YouTube Import Started: ${youtubeUrl}`)

      if (!this.validateYoutubeUrl(youtubeUrl)) {
        throw new Error('Invalid YouTube URL format. Please use a valid YouTube or YouTube Music playlist URL.')
      }

      const listId = this.extractListId(youtubeUrl)
      if (!listId) {
        throw new Error('Could not extract playlist ID from URL. Make sure the URL includes a playlist ID (list parameter).')
      }

      const songs: Song[] = []

      try {
        // Use ytdl to get playlist info
        console.log(`🔍 Fetching playlist: ${listId}`)
        
        // Try to get playlist info using ytdl
        let playlistInfo
        try {
          playlistInfo = await (ytdl as any).getPlaylist(youtubeUrl, { limit: Infinity })
        } catch (e) {
          console.log('⚠️  Could not fetch playlist with limit Infinity, trying with limit 100')
          playlistInfo = await (ytdl as any).getPlaylist(youtubeUrl, { limit: 100 })
        }

        if (!playlistInfo || !playlistInfo.videos || playlistInfo.videos.length === 0) {
          console.log('⚠️  Playlist is empty or could not be fetched')
          return [{
            title: 'YouTube Playlist',
            artist: 'YouTube Music',
            duration: '00:00',
            pitch: 1.0,
            audio_url: youtubeUrl,
          }]
        }

        // Extract songs from playlist
        console.log(`📊 Found ${playlistInfo.videos.length} videos in playlist`)
        
        for (const video of playlistInfo.videos) {
          try {
            const song: Song = {
              title: video.title || 'Unknown Title',
              artist: video.author?.name || 'YouTube',
              duration: video.duration ? this.formatDuration(video.duration) : '00:00',
              pitch: 1.0,
              audio_url: `https://www.youtube.com/watch?v=${video.id}`,
            }
            songs.push(song)
            console.log(`  ✓ Added: ${song.title}`)
          } catch (e) {
            console.log(`  ⚠️  Skipped one video due to error`)
          }
        }

        if (songs.length === 0) {
          throw new Error('No videos could be extracted from the playlist')
        }

        console.log(`✓ Playlist imported: ${listId}`)
        console.log(`✓ Total items added: ${songs.length}\n`)
        return songs
      } catch (e) {
        // Fallback: return playlist URL as single entry
        const msg = e instanceof Error ? e.message : String(e)
        console.log(`⚠️  Could not extract individual videos: ${msg}`)
        console.log('ℹ️  Using playlist URL as single entry')
        return [{
          title: 'YouTube Playlist',
          artist: 'YouTube Music',
          duration: '00:00',
          pitch: 1.0,
          audio_url: youtubeUrl,
        }]
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error(`❌ Import error: ${msg}\n`)
      throw new Error(`YouTube import failed: ${msg}`)
    }
  }

  async importSong(youtubeUrl: string): Promise<Song> {
    try {
      console.log(`\n📥 YouTube Song Import: ${youtubeUrl}`)

      if (!this.validateYoutubeUrl(youtubeUrl)) {
        throw new Error('Invalid YouTube URL format. Please use a valid YouTube video URL.')
      }

      const videoId = this.extractVideoId(youtubeUrl)
      if (!videoId) {
        throw new Error('Could not extract video ID from URL.')
      }

      try {
        // Try to get video info
        const info = await ytdl.getBasicInfo(videoId)
        const song: Song = {
          title: info.videoDetails.title || 'YouTube Video',
          artist: info.videoDetails.author?.name || 'YouTube',
          duration: this.formatDuration(parseInt(info.videoDetails.lengthSeconds || '0', 10)),
          pitch: 1.0,
          audio_url: youtubeUrl,
        }

        console.log(`✓ Added song: ${song.title} by ${song.artist}\n`)
        return song
      } catch (e) {
        console.warn(`⚠️  Could not fetch video details: ${e instanceof Error ? e.message : String(e)}`)
        // Fallback to generic placeholder
        return {
          title: 'YouTube Video',
          artist: 'YouTube',
          duration: '00:00',
          pitch: 1.0,
          audio_url: youtubeUrl,
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error(`❌ Song import error: ${msg}\n`)
      throw new Error(`Failed to add song: ${msg}`)
    }
  }
}

// ============ LIBRARY SERVICE ============
class LibraryService {
  private librarySongs: Song[] = []
  private libraryFile = path.join(__dirname, '..', 'library.json')

  async loadLibrary(): Promise<void> {
    try {
      const exists = await this.fileExists(this.libraryFile)
      if (exists) {
        const data = await fs.readFile(this.libraryFile, 'utf-8')
        const parsed = JSON.parse(data) as Song[]
        this.librarySongs = Array.isArray(parsed) ? parsed : []
        console.log(`✓ Loaded ${this.librarySongs.length} songs in library`)
      } else {
        this.librarySongs = []
      }
    } catch (error) {
      console.error('❌ Error loading library:', error)
      this.librarySongs = []
    }
  }

  async saveLibrary(): Promise<void> {
    try {
      await fs.writeFile(this.libraryFile, JSON.stringify(this.librarySongs, null, 2))
    } catch (error) {
      console.error('❌ Error saving library:', error)
    }
  }

  private async fileExists(filepath: string): Promise<boolean> {
    try {
      await fs.access(filepath)
      return true
    } catch {
      return false
    }
  }

  getAllSongs(): Song[] {
    return this.librarySongs
  }

  addSong(song: Song): boolean {
    // Check if song already exists
    const exists = this.librarySongs.some(s => s.audio_url === song.audio_url)
    if (exists) return false

    this.librarySongs.push(song)
    this.saveLibrary().catch(err => console.error('Error saving library:', err))
    return true
  }

  removeSong(audioUrl: string): boolean {
    const index = this.librarySongs.findIndex(s => s.audio_url === audioUrl)
    if (index === -1) return false

    this.librarySongs.splice(index, 1)
    this.saveLibrary().catch(err => console.error('Error saving library:', err))
    return true
  }

  getSongByUrl(audioUrl: string): Song | undefined {
    return this.librarySongs.find(s => s.audio_url === audioUrl)
  }
}

// ============ INITIALIZE SERVICES ============
const playlistService = new PlaylistService()
const youtubeService = new YoutubeService()
const libraryService = new LibraryService()

// ============ CREATE EXPRESS APP ============
const app: Express = express()

// ============ MIDDLEWARE ============
app.use(
  cors({
    origin: ALLOWED_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  })
)
app.use(express.json({ limit: '50mb' }))
app.use(express.static(UPLOADS_DIR))

// Load playlists and library on startup
await playlistService.loadPlaylists()
await libraryService.loadLibrary()

// ============ HEALTH CHECK ============
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ============ PLAYER STATE (Global Playlist) ============
app.get('/api/playlist', (_req, res) => {
  const state = playlistService.getPlaylistState()
  res.json(state)
})

app.post('/api/playlist/select', (req: Request, res: Response) => {
  const { name, index } = req.body as { name: string; index?: number }
  if (!name) {
    res.status(400).json({ detail: 'Playlist name required' })
    return
  }

  if (playlistService.setCurrentPlaylist(name, index)) {
    const state = playlistService.getPlaylistState()
    res.json({ message: `Loaded playlist: ${name}`, ...state })
  } else {
    res.status(404).json({ detail: `Playlist '${name}' not found` })
  }
})

// ============ PLAYER CONTROLS ============
app.post('/api/player/next', (_req, res) => {
  const song = playlistService.nextSong()
  if (song) {
    res.json({ message: 'Playing next', current: song })
  } else {
    res.status(400).json({ detail: 'No playlist loaded' })
  }
})

app.post('/api/player/previous', (_req, res) => {
  const song = playlistService.previousSong()
  if (song) {
    res.json({ message: 'Playing previous', current: song })
  } else {
    res.status(400).json({ detail: 'No playlist loaded' })
  }
})

app.post('/api/player/select/:title', (req: Request, res: Response) => {
  const title = decodeURIComponent(req.params.title)
  const song = playlistService.selectSong(title)
  if (song) {
    res.json({ message: `Selected: ${title}`, current: song })
  } else {
    res.status(404).json({ detail: `Song '${title}' not found` })
  }
})

app.post('/api/player/pitch', (req: Request, res: Response) => {
  const { delta } = req.body as { delta: number }
  const song = playlistService.modifyPitch(delta || 0)
  if (song) {
    res.json({ message: `Pitch: ${song.pitch.toFixed(2)}`, current: song })
  } else {
    res.status(400).json({ detail: 'No song playing' })
  }
})

app.post('/api/player/pitch/reset', (_req, res) => {
  const song = playlistService.resetPitch()
  if (song) {
    res.json({ message: 'Pitch reset', current: song })
  } else {
    res.status(400).json({ detail: 'No song playing' })
  }
})

// ============ PLAYLIST MANAGEMENT ============
app.get('/api/playlists', (_req, res) => {
  const playlists = playlistService.getPlaylists()
  res.json({ playlists })
})

app.post('/api/playlists/create', (req: Request, res: Response) => {
  const name = req.query.name as string
  if (!name || name.trim() === '') {
    res.status(400).json({ detail: 'Playlist name cannot be empty' })
    return
  }

  if (playlistService.createPlaylist(name)) {
    res.json({ message: `Playlist '${name}' created successfully`, name })
  } else {
    res.status(400).json({ detail: `Playlist '${name}' already exists` })
  }
})

app.get('/api/playlists/:name', (req: Request, res: Response) => {
  const name = decodeURIComponent(req.params.name)
  const songs = playlistService.getPlaylist(name)

  if (!songs) {
    res.status(404).json({ detail: `Playlist '${name}' not found` })
    return
  }

  res.json({ name, songs, total: songs.length })
})

app.delete('/api/playlists/:name', (req: Request, res: Response) => {
  const name = decodeURIComponent(req.params.name)

  if (playlistService.deletePlaylist(name)) {
    res.json({ message: `Playlist '${name}' deleted successfully` })
  } else {
    res.status(404).json({ detail: `Playlist '${name}' not found` })
  }
})

app.post('/api/playlists/:name/add-song', (req: Request, res: Response) => {
  const name = decodeURIComponent(req.params.name)
  const song = req.body as Song

  const playlist = playlistService.getPlaylist(name)
  if (!playlist) {
    res.status(404).json({ detail: `Playlist '${name}' not found` })
    return
  }

  if (playlistService.addSongToPlaylist(name, song)) {
    res.json({
      message: `Added song to '${name}'`,
      name,
      total_songs: playlistService.getPlaylist(name)?.length || 0,
    })
  } else {
    res.status(500).json({ detail: 'Failed to add song' })
  }
})

app.delete('/api/playlists/:name/songs/:title', (req: Request, res: Response) => {
  const name = decodeURIComponent(req.params.name)
  const title = decodeURIComponent(req.params.title)

  const playlist = playlistService.getPlaylist(name)
  if (!playlist) {
    res.status(404).json({ detail: `Playlist '${name}' not found` })
    return
  }

  if (playlistService.removeSongFromPlaylist(name, title)) {
    res.json({
      message: `Removed song from '${name}'`,
      name,
      total_songs: playlistService.getPlaylist(name)?.length || 0,
    })
  } else {
    res.status(404).json({ detail: `Song '${title}' not found` })
  }
})

app.post('/api/playlists/:name/sort', (req: Request, res: Response) => {
  const name = decodeURIComponent(req.params.name)
  const { sortBy } = req.body as { sortBy: 'title' | 'artist' | 'duration' }

  if (!['title', 'artist', 'duration'].includes(sortBy)) {
    res.status(400).json({ detail: 'Invalid sortBy value' })
    return
  }

  const playlist = playlistService.getPlaylist(name)
  if (!playlist) {
    res.status(404).json({ detail: `Playlist '${name}' not found` })
    return
  }

  if (playlistService.sortPlaylist(name, sortBy)) {
    const songs = playlistService.getPlaylist(name)
    res.json({
      message: `Sorted by ${sortBy}`,
      name,
      songs,
    })
  } else {
    res.status(500).json({ detail: 'Failed to sort playlist' })
  }
})

app.post('/api/playlists/:name/move-song', (req: Request, res: Response) => {
  const name = decodeURIComponent(req.params.name)
  const { fromIndex, toIndex } = req.body as { fromIndex: number; toIndex: number }

  if (typeof fromIndex !== 'number' || typeof toIndex !== 'number') {
    res.status(400).json({ detail: 'Missing or invalid fromIndex/toIndex' })
    return
  }

  const playlist = playlistService.getPlaylist(name)
  if (!playlist) {
    res.status(404).json({ detail: `Playlist '${name}' not found` })
    return
  }

  if (playlistService.moveSong(name, fromIndex, toIndex)) {
    const updatedPlaylist = playlistService.getPlaylist(name)
    res.json({
      message: `Moved song from index ${fromIndex} to ${toIndex}`,
      name,
      songs: updatedPlaylist,
    })
  } else {
    res.status(400).json({ detail: 'Failed to move song - invalid indices' })
  }
})

// ============ YOUTUBE IMPORT ============
app.post('/api/playlists/:name/add-youtube', async (req: Request, res: Response) => {
  const name = decodeURIComponent(req.params.name)
  const payload = req.body as { youtube_url: string }

   const playlist = playlistService.getPlaylist(name)
   if (!playlist) {
     res.status(404).json({ detail: `Playlist '${name}' not found` })
     return
   }

   try {
     const songs = await youtubeService.importPlaylist(payload.youtube_url)
     songs.forEach(song => {
       playlistService.addSongToPlaylist(name, song)
       libraryService.addSong(song) // Add to library as well
     })
     res.json({
       message: `Successfully imported ${songs.length} songs from YouTube`,
       name,
       songs_added: songs.length,
       total_songs: playlistService.getPlaylist(name)?.length || 0,
     })
   } catch (error) {
     const errorMsg = error instanceof Error ? error.message : 'Unknown error'
     res.status(500).json({ detail: errorMsg })
   }
 })

 app.post('/api/playlists/:name/add-youtube-song', async (req: Request, res: Response) => {
   const name = decodeURIComponent(req.params.name)
   const payload = req.body as { youtube_url: string }

   const playlist = playlistService.getPlaylist(name)
   if (!playlist) {
     res.status(404).json({ detail: `Playlist '${name}' not found` })
     return
   }

   try {
     const song = await youtubeService.importSong(payload.youtube_url)
     playlistService.addSongToPlaylist(name, song)
     libraryService.addSong(song) // Add to library as well
     res.json({
       message: 'Successfully added song from YouTube',
       name,
       song_title: song.title,
       total_songs: playlistService.getPlaylist(name)?.length || 0,
     })
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      res.status(500).json({ detail: errorMsg })
    }
  })

// ============ LIBRARY YOUTUBE IMPORT ============
app.post('/api/library/import-youtube', async (req: Request, res: Response) => {
  const payload = req.body as { youtube_url: string }

  if (!payload.youtube_url) {
    res.status(400).json({ detail: 'Missing youtube_url' })
    return
  }

  try {
    const songs = await youtubeService.importPlaylist(payload.youtube_url)
    songs.forEach(song => libraryService.addSong(song))
    
    res.json({
      message: `Successfully imported ${songs.length} song(s) from YouTube to library`,
      songs_added: songs.length,
      total_library: libraryService.getAllSongs().length,
      songs: libraryService.getAllSongs(),
    })
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    res.status(500).json({ detail: errorMsg })
  }
})

 // ============ FILE UPLOAD ============
app.post('/api/playlist/upload-local', upload.array('files', 50), async (req: Request, res: Response) => {
  if (!req.files || req.files.length === 0) {
    res.status(400).json({ detail: 'No files uploaded' })
    return
  }

  try {
    const uploadedFiles = req.files as Express.Multer.File[]
    const songs: Song[] = uploadedFiles.map(file => ({
      title: path.parse(file.filename).name,
      artist: 'Local File',
      duration: '00:00',
      pitch: 1.0,
      audio_url: `/${file.filename}`,
    }))

    // Add songs to library
    let addedToLibrary = 0
    for (const song of songs) {
      if (libraryService.addSong(song)) {
        addedToLibrary++
      }
    }

    res.json({
      message: `Successfully uploaded ${songs.length} file(s)`,
      songs_added: songs.length,
      songs,
      added_to_library: addedToLibrary,
    })
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    res.status(500).json({ detail: errorMsg })
  }
})

// ============ LIBRARY MANAGEMENT ============
app.get('/api/library', (_req: Request, res: Response) => {
  const songs = libraryService.getAllSongs()
  res.json({
    songs,
    total: songs.length,
    message: `Library contains ${songs.length} song(s)`,
  })
})

app.delete('/api/library/:audioUrl', (req: Request, res: Response) => {
  const audioUrl = decodeURIComponent(req.params.audioUrl)
  
  if (libraryService.removeSong(audioUrl)) {
    res.json({
      message: 'Song removed from library',
      removed: audioUrl,
    })
  } else {
    res.status(404).json({
      detail: 'Song not found in library',
    })
  }
})

app.post('/api/library/add-to-playlist', (req: Request, res: Response) => {
  const { playlistName, audioUrl } = req.body as { playlistName: string; audioUrl: string }
  
  if (!playlistName || !audioUrl) {
    res.status(400).json({ detail: 'Missing playlistName or audioUrl' })
    return
  }

  const song = libraryService.getSongByUrl(audioUrl)
  if (!song) {
    res.status(404).json({ detail: 'Song not found in library' })
    return
  }

  if (playlistService.addSongToPlaylist(playlistName, song)) {
    res.json({
      message: `Added song to playlist '${playlistName}'`,
      playlist: playlistName,
      song: song.title,
    })
  } else {
    res.status(400).json({
      detail: `Could not add song to playlist '${playlistName}'`,
    })
  }
})

// ============ AUDIO STREAMING ============
app.get('/api/stream', async (req: Request, res: Response) => {
  const url = req.query.url as string

  if (!url) {
    res.status(400).json({ error: 'URL parameter required' })
    return
  }

  try {
    // Check if it's a YouTube URL
    if (url.includes('youtube.com') || url.includes('youtu.be') || url.includes('music.youtube.com')) {
      // For YouTube URLs, try to get download info using ytdl-core
      try {
        const info = await ytdl.getInfo(url)
        const formats = info.formats
        
        // Find the best audio format
        const audioFormat = formats.find(f => f.mimeType?.includes('audio')) || formats[formats.length - 1]
        
        if (audioFormat && audioFormat.url) {
          // Redirect to the audio stream
          res.redirect(audioFormat.url)
          return
        }
      } catch (e) {
        console.warn('Could not get YouTube stream info:', e instanceof Error ? e.message : String(e))
        // Fallback to direct URL (won't work for YouTube but worth trying)
        res.redirect(url)
        return
      }
    }

    // For non-YouTube URLs, redirect directly
    res.redirect(url)
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    res.status(500).json({ error: errorMsg })
  }
})

// ============ ERROR HANDLING ============
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('❌ Error:', err.message)
  res.status(500).json({ detail: err.message || 'Internal server error' })
})

// ============ 404 HANDLER ============
app.use((_req, res) => {
  res.status(404).json({ detail: 'Endpoint not found' })
})

// ============ START SERVER ============
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎵 Vibe Check Server v2.0`)
  console.log(`📡 Running on http://localhost:${PORT}`)
  console.log(`✓ API available at http://localhost:${PORT}/api\n`)
})
