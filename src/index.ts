import express, { Express, Request, Response, NextFunction } from 'express'
import cors from 'cors'
import multer from 'multer'
import path from 'path'
import fs from 'fs/promises'
import { fileURLToPath } from 'url'

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
    const allowedMimes = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/aac']
    if (allowedMimes.includes(file.mimetype)) {
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

// ============ YOUTUBE SERVICE (Simple Version) ============
class YoutubeService {
  private validateYoutubeUrl(url: string): boolean {
    try {
      const videoMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/)
      const playlistMatch = url.match(/youtube\.com\/playlist\?list=([^&\n?#]+)/)
      return !!(videoMatch || playlistMatch)
    } catch {
      return false
    }
  }

  async importPlaylist(youtubeUrl: string): Promise<Song[]> {
    try {
      console.log(`\n📥 YouTube Import Started: ${youtubeUrl}`)

      if (!this.validateYoutubeUrl(youtubeUrl)) {
        throw new Error('Invalid YouTube URL format')
      }

      // Simple: create single entry for the URL
      const songs: Song[] = [
        {
          title: 'YouTube Music',
          artist: 'YouTube',
          duration: '00:00',
          pitch: 1.0,
          audio_url: youtubeUrl,
        },
      ]

      console.log(`✓ Total songs added: ${songs.length}\n`)
      return songs
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
        throw new Error('Invalid YouTube URL format')
      }

      const song: Song = {
        title: 'YouTube Music',
        artist: 'YouTube',
        duration: '00:00',
        pitch: 1.0,
        audio_url: youtubeUrl,
      }

      console.log(`✓ Added song: ${song.title}\n`)
      return song
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error(`❌ Song import error: ${msg}\n`)
      throw new Error(`Failed to add song: ${msg}`)
    }
  }
}

// ============ INITIALIZE SERVICES ============
const playlistService = new PlaylistService()
const youtubeService = new YoutubeService()

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

// Load playlists on startup
await playlistService.loadPlaylists()

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
    songs.forEach(song => playlistService.addSongToPlaylist(name, song))
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
      audio_url: `${file.filename}`,
    }))

    res.json({
      message: `Successfully uploaded ${songs.length} file(s)`,
      songs_added: songs.length,
      songs,
    })
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    res.status(500).json({ detail: errorMsg })
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
