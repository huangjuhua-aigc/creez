---
name: youtube-downloader
description: Reliable YouTube/yt-dlp workflow for downloading videos or audio to the local workspace. Trigger whenever a user asks to download a YouTube (or YT Shorts/playlist) link, extract audio, save captions, or otherwise fetch media files for offline use.
---

# YouTube Download Skill

## Overview

Use this skill to fetch YouTube media (videos, Shorts, playlists, audio tracks, thumbnails, or subtitles) onto the local filesystem using `yt-dlp`. The bundled automation script standardizes filenames, output folders, retries, and post-processing so every download follows the same pattern.

## Quick Start Workflow

1. **Capture the request**
   - Confirm the URL(s) the user wants downloaded.
   - Clarify whether they want full video, audio-only, subtitles, or thumbnails.

2. **Choose destination + options**
   - Default destination is `downloads/youtube/` (auto-created). Override with `--output-dir` as needed (e.g., `outputs/youtube/2026-01-30`).
   - Decide if filename trimming (removing upload date prefix) is desired via `--trim-filenames`.

3. **Run the helper script**
   ```bash
   python .pi/skills/youtube-downloader/scripts/download_youtube_video.py "<VIDEO_URL>"
   ```
   - Add switches like `--audio-only`, `--write-subs`, `--no-playlist`, etc. (see options below).

4. **Report results**
   - Mention the saved file paths (script prints them). Provide relative paths from repo root.
   - If multiple files (playlist/subtitles) were produced, enumerate them clearly.

## Common Scenarios

### 1. Highest-quality video with audio (default)
```bash
python scripts/download_youtube_video.py "URL"
```
- Uses yt-dlp format selector `bv*+ba/best` to pick best muxable video/audio.
- Produces filename like `20260130_Title_Id.mp4` in `downloads/youtube/`.

### 2. Audio-only extraction
```bash
python scripts/download_youtube_video.py "URL" --audio-only --audio-format mp3 --trim-filenames
```
- Adds FFmpeg post-processor to convert best audio stream into MP3 (change to `m4a`, `opus`, etc. as needed).

### 3. Playlist download with subtitles
```bash
python scripts/download_youtube_video.py "PLAYLIST_URL" --write-subs --sub-langs "en.*,zh.*" --output-dir outputs/youtube/playlist_name
```
- Removes `--no-playlist` default behavior; downloads all entries, captions saved as `.vtt`.

### 4. Authenticated / region-locked content
```bash
python scripts/download_youtube_video.py "URL" --cookies cookies.txt --proxy socks5://127.0.0.1:7890
```
- Requires `cookies.txt` exported from a logged-in browser session. Keep file outside repo if it contains secrets.

## Script Reference: `download_youtube_video.py`

Path: `.pi/skills/youtube-downloader/scripts/download_youtube_video.py`

Key options:
| Flag | Purpose |
|------|---------|
| `--output-dir PATH` | Target directory (created automatically).
| `--filename-template` | yt-dlp template (defaults to `%(upload_date>%Y-%m-%d)s_%(title).200B_%(id)s.%(ext)s`).
| `--format` | Custom format selector (default best video+audio). Ignored when `--audio-only` is set.
| `--audio-only` / `--audio-format` | Convert to chosen audio codec via FFmpeg.
| `--write-subs` / `--sub-langs` | Save subtitles in `.vtt` format.
| `--no-playlist` | Download only the first item (default True). Omit flag to download all.
| `--cookies FILE` | Use cookie file for gated content.
| `--proxy URL` | Route traffic through proxy (e.g., `socks5://127.0.0.1:1080`).
| `--rate-limit VALUE` | Throttle download speed (e.g., `1M`, `500K`).
| `--write-thumbnail` | Save the best thumbnail next to the media file.
| `--add-metadata` | Embed metadata tags using FFmpeg.
| `--trim-filenames` | Removes the leading `YYYY-MM-DD_` prefix after download.

Implementation highlights:
- Automatically creates destination folder, configures retries, and hooks into yt-dlp progress to list final file paths.
- Uses FFmpeg post-processors when audio extraction/metadata embedding is requested (ensure FFmpeg installed).
- Maintains sanitized filenames via yt-dlp templating to avoid illegal characters.

## Reference Material

- `references/yt_dlp_cheatsheet.md`: Expanded list of yt-dlp flags, installation commands, troubleshooting steps, and automation tips. Read this if you need less-common options (geo-bypass, embedding subs, advanced templates).
- yt-dlp upstream documentation: https://github.com/yt-dlp/yt-dlp#readme

## Troubleshooting & Tips

- **yt-dlp not installed**: `pip install --upgrade yt-dlp`. Make sure `.venv` Python uses the updated package.
- **FFmpeg missing**: Install platform package (`sudo apt install ffmpeg` or download static build) so yt-dlp can mux streams or extract audio.
- **Throttled or failing downloads**: set `--rate-limit`, reduce fragment concurrency, or add `--wait-between-retries` (already exposed via script).
- **Live streams**: add `--format best` plus `--match-filter "!is_live"` if you only want on-demand videos.
- **Output organization**: create dated subfolders (`--output-dir outputs/youtube/2026-01-30`) so multiple downloads stay tidy.
- **Multiple requests**: run script once per URL or provide a playlist link; document each resulting file path to the user.

Always verify downloads complete successfully before responding. Provide the relative path(s) so the user or downstream automations can access the files immediately.
