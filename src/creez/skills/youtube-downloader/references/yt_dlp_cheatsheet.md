# yt-dlp Quick Reference

This document summarizes the switches and workflows most commonly needed when downloading
YouTube videos inside the agent environment. See the upstream docs for the full matrix:
https://github.com/yt-dlp/yt-dlp#readme

## Installation & Updates

```bash
pip install --upgrade yt-dlp
# or use the binary
python -m pip install -U yt-dlp
```

Keep `ffmpeg` available on PATH for muxing audio/video, extracting audio, generating
thumbnails, etc. On Linux:
```bash
sudo apt update && sudo apt install ffmpeg
```

## Basic Commands

```bash
# Highest quality video + audio and merge into a single file
yt-dlp -f "bv*+ba/b" "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

# Download only the audio track and convert to MP3
yt-dlp -f "bestaudio" --extract-audio --audio-format mp3 URL

# Download a playlist
yt-dlp --yes-playlist PLAYLIST_URL

# Restrict filenames to ASCII and strip unsafe characters
yt-dlp --restrict-filenames URL

# Custom output template
yt-dlp -o "downloads/%(upload_date>%Y-%m-%d)s_%(title).200B.%(ext)s" URL
```

## Helpful Options

| Flag | Purpose |
|------|---------|
| `-N, --concurrent-fragments N` | Parallel fragment downloads (default 1, sweet spot 4-8) |
| `--no-part` | Do not store temporary `.part` files |
| `--write-subs --sub-langs en.*` | Download subtitles matching pattern |
| `--write-thumbnail` | Save preview image |
| `--embed-metadata` | Embed title, uploader, etc. Requires ffmpeg |
| `--embed-subs` | Burn subtitles into container |
| `--limit-rate 1M` | Avoid throttling on fragile networks |
| `--cookies cookies.txt` | Use exported browser cookies for member-only/private videos |
| `--proxy socks5://127.0.0.1:7890` | Route traffic through a proxy |
| `--match-filter "!is_live"` | Skip live streams |

## Output Templates

Use placeholders documented in https://github.com/yt-dlp/yt-dlp#output-template.
Examples:

- `% (title).80B` : sanitized title trimmed to 80 bytes, preserving whole words
- `% (id)s` : 11-character YouTube video id
- `% (upload_date>%Y-%m-%d)s` : upload date formatted as ISO string
- `% (uploader)s/% (title)s` : nested directories per uploader

## Authentication

1. Export cookies from a logged-in browser session using an extension such as
   [Get cookies.txt](https://github.com/k042/Get-cookies.txt-LOCALLY).
2. Save to `cookies.txt` and pass `--cookies cookies.txt`.
3. For OAuth-based flows use `--cookies-from-browser <browser>`.

## Troubleshooting

- **HTTP Error 410 (Gone)** – YouTube changed API; update yt-dlp: `pip install -U yt-dlp`.
- **Sign in required** – Provide cookies or use `--cookies-from-browser`.
- **Throttled downloads** – add `--limit-rate 500K` or `--throttled-rate 100K`.
- **Missing ffmpeg** – install it; yt-dlp needs ffmpeg for muxing/metadata.
- **Geo-restricted content** – use `--proxy` or `--geo-bypass-country US`.

## Automation Tips

- Combine with the provided `download_youtube_video.py` script for consistent naming,
  retry handling, and post-processing.
- Store downloads under `outputs/youtube/YYYY-MM/` to keep workspaces tidy.
- Log requests (URL, timestamp, requester) in a CSV if audits are required.
