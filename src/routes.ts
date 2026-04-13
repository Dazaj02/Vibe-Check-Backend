import { Router, Request, Response } from 'express'
import { playlistService } from './playlistService.js'
import { youtubeService } from './youtubeService.js'
import { YoutubeImportRequest } from './types.js'

const router = Router()

// Get all playlists
router.get('/playlists', (req: Request, res: Response) => {
  const playlists = playlistService.getPlaylists()
  res.json({ playlists })
})

// Create a new playlist
router.post('/playlists/create', (req: Request, res: Response) => {
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

// Get a specific playlist
router.get('/playlists/:name', (req: Request, res: Response) => {
  const name = decodeURIComponent(req.params.name)
  const songs = playlistService.getPlaylist(name)

  if (!songs) {
    res.status(404).json({ detail: `Playlist '${name}' not found` })
    return
  }

  res.json({ name, songs, total: songs.length })
})

// Delete a playlist
router.delete('/playlists/:name', (req: Request, res: Response) => {
  const name = decodeURIComponent(req.params.name)

  if (playlistService.deletePlaylist(name)) {
    res.json({ message: `Playlist '${name}' deleted successfully` })
  } else {
    res.status(404).json({ detail: `Playlist '${name}' not found` })
  }
})

// Add YouTube playlist to a specific playlist
router.post('/playlists/:name/add-youtube', async (req: Request, res: Response) => {
  const name = decodeURIComponent(req.params.name)
  const payload = req.body as YoutubeImportRequest

  const playlist = playlistService.getPlaylist(name)
  if (!playlist) {
    res.status(404).json({ detail: `Playlist '${name}' not found` })
    return
  }

  try {
    const songs = await youtubeService.importPlaylist(payload.youtube_url)
    songs.forEach(song => playlistService.addSongToPlaylist(name, song))
    res.json({
      message: `Successfully imported ${songs.length} songs from YouTube Music`,
      name,
      songs_added: songs.length,
      total_songs: playlistService.getPlaylist(name)?.length || 0,
    })
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    console.error('YouTube import error:', errorMsg)
    res.status(500).json({ detail: errorMsg })
  }
})

// Add a single YouTube song to a specific playlist
router.post('/playlists/:name/add-youtube-song', async (req: Request, res: Response) => {
  const name = decodeURIComponent(req.params.name)
  const payload = req.body as YoutubeImportRequest

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
    console.error('YouTube song add error:', errorMsg)
    res.status(500).json({ detail: errorMsg })
  }
})

export default router
