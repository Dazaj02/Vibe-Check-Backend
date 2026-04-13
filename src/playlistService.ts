import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { Song, Playlist } from './types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PLAYLISTS_FILE = path.join(__dirname, '..', 'playlists.json')

export class PlaylistService {
  private playlists: Map<string, Song[]> = new Map()

  async loadPlaylists(): Promise<void> {
    try {
      if (await this.fileExists(PLAYLISTS_FILE)) {
        const data = await fs.readFile(PLAYLISTS_FILE, 'utf-8')
        const parsed = JSON.parse(data) as Record<string, Song[]>
        this.playlists = new Map(Object.entries(parsed))
        console.log(`Loaded ${this.playlists.size} playlists from file`)
      }
    } catch (error) {
      console.error('Error loading playlists:', error)
      this.playlists = new Map()
    }
  }

  async savePlaylists(): Promise<void> {
    try {
      const data = Object.fromEntries(this.playlists)
      await fs.writeFile(PLAYLISTS_FILE, JSON.stringify(data, null, 2))
    } catch (error) {
      console.error('Error saving playlists:', error)
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

  createPlaylist(name: string): boolean {
    if (this.playlists.has(name)) {
      return false
    }
    this.playlists.set(name, [])
    this.savePlaylists()
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
    if (!playlist) {
      return false
    }
    playlist.push(song)
    this.savePlaylists()
    return true
  }

  deletePlaylist(name: string): boolean {
    const deleted = this.playlists.delete(name)
    if (deleted) {
      this.savePlaylists()
    }
    return deleted
  }
}

export const playlistService = new PlaylistService()
