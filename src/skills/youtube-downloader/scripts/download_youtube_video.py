#!/usr/bin/env python3
"""Download videos or audio from YouTube using yt-dlp.

This script intentionally exposes the most common knobs needed when using yt-dlp inside
the agent environment so you don't have to remember long command strings.

Basic usage:
    python download_youtube_video.py "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

Run ``python download_youtube_video.py --help`` for all options.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any, Dict, List


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download a single video, playlist, or audio track from YouTube using yt-dlp",
    )
    parser.add_argument("url", help="YouTube video/short/playlist URL to download")
    parser.add_argument(
        "--output-dir",
        default="downloads/youtube",
        help="Directory where downloaded files will be stored (created if missing)",
    )
    parser.add_argument(
        "--filename-template",
        default="%(upload_date>%Y-%m-%d)s_%(title).200B_%(id)s.%(ext)s",
        help="yt-dlp output template (default keeps upload date, safe title, id)",
    )
    parser.add_argument(
        "--format",
        default="bv*+ba/best",
        help="Format selector passed to yt-dlp (default grabs best video+audio)",
    )
    parser.add_argument(
        "--audio-only",
        action="store_true",
        help="Download audio only and convert to the format specified by --audio-format",
    )
    parser.add_argument(
        "--audio-format",
        default="mp3",
        help="Audio format when --audio-only is set (mp3, m4a, opus, flac, ...)",
    )
    parser.add_argument(
        "--write-subs",
        action="store_true",
        help="Download subtitles/captions as .vtt alongside the media",
    )
    parser.add_argument(
        "--sub-langs",
        default="en.*",
        help="Comma-separated subtitle language patterns (default: en.* for English variants)",
    )
    parser.add_argument(
        "--no-playlist",
        action="store_true",
        help="Only download the first video even if the URL is a playlist",
    )
    parser.add_argument(
        "--cookies",
        help="Path to cookies.txt file for authenticated downloads",
    )
    parser.add_argument(
        "--proxy",
        help="Proxy URL passed to yt-dlp (e.g. socks5://127.0.0.1:7890)",
    )
    parser.add_argument(
        "--rate-limit",
        help="Maximum download rate (e.g. 1M, 500K) to avoid throttling",
    )
    parser.add_argument(
        "--write-thumbnail",
        action="store_true",
        help="Download the highest quality thumbnail alongside the media",
    )
    parser.add_argument(
        "--add-metadata",
        action="store_true",
        help="Embed metadata (title, artist) into the media file",
    )
    parser.add_argument(
        "--retries",
        default=5,
        type=int,
        help="Number of retries for network errors (default: 5)",
    )
    parser.add_argument(
        "--wait-between-retries",
        default=3.0,
        type=float,
        help="Seconds to wait between retries (default: 3)",
    )
    parser.add_argument(
        "--trim-filenames",
        action="store_true",
        help="Remove upload date prefix from filenames after download",
    )
    return parser.parse_args()


def ensure_yt_dlp() -> Any:
    try:
        from yt_dlp import YoutubeDL  # type: ignore
    except Exception:  # pragma: no cover
        print(
            "yt-dlp is not installed in this environment.\n"
            "Install it with: pip install --upgrade yt-dlp",
            file=sys.stderr,
        )
        raise
    else:
        return YoutubeDL


def build_options(args: argparse.Namespace, destination: Path) -> Dict[str, Any]:
    ydl_opts: Dict[str, Any] = {
        "outtmpl": str(destination / args.filename_template),
        "format": "bestaudio/best" if args.audio_only else args.format,
        "concurrent_fragment_downloads": 5,
        "noplaylist": args.no_playlist,
        "retries": args.retries,
        "fragment_retries": args.retries,
        "retry_sleep_functions": lambda *_: args.wait_between_retries,
        "ratelimit": args.rate_limit,
        "overwrites": False,
        "progress_hooks": [],
    }

    if args.proxy:
        ydl_opts["proxy"] = args.proxy
    if args.cookies:
        ydl_opts["cookiefile"] = args.cookies

    if args.audio_only:
        ydl_opts.setdefault("postprocessors", []).append(
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": args.audio_format,
                "preferredquality": "192",
            }
        )

    if args.add_metadata:
        ydl_opts.setdefault("postprocessors", []).append({"key": "FFmpegMetadata"})

    if args.write_thumbnail:
        ydl_opts.setdefault("writethumbnail", True)

    if args.write_subs:
        ydl_opts.update(
            {
                "writesubtitles": True,
                "subtitleslangs": [lang.strip() for lang in args.sub_langs.split(",") if lang.strip()],
                "subtitlesformat": "vtt",
            }
        )

    return ydl_opts


def summarize_download(hook_log: List[str]) -> None:
    if not hook_log:
        print("Download finished but no file notifications were received. Check yt-dlp logs.")
        return
    print("\n✅ Download complete. Files written:")
    for path in hook_log:
        print(f"  - {path}")


def maybe_trim_prefix(hook_log: List[str], destination: Path) -> None:
    for original in hook_log:
        original_path = Path(original)
        if not original_path.exists():
            continue
        # Remove the upload date prefix (YYYY-MM-DD_) if present
        name = original_path.name
        if len(name) > 11 and name[4] == "-" and name[7] == "-" and name[10] == "_":
            new_name = name[11:]
            new_path = original_path.with_name(new_name)
            if new_path.exists():
                continue
            original_path.rename(new_path)
            print(f"Trimmed date prefix: {original_path.name} -> {new_name}")


def main() -> int:
    args = parse_args()
    destination = Path(args.output_dir).expanduser().resolve()
    destination.mkdir(parents=True, exist_ok=True)

    YoutubeDL = ensure_yt_dlp()

    hook_log: List[str] = []

    def hook(status: Dict[str, Any]) -> None:  # type: ignore[type-arg]
        if status.get("status") == "finished":
            hook_log.append(status.get("filename", ""))

    ydl_opts = build_options(args, destination)
    ydl_opts["progress_hooks"].append(hook)

    try:
        with YoutubeDL(ydl_opts) as ydl:
            ydl.download([args.url])
    except Exception as exc:  # pragma: no cover - yt-dlp handles logging
        print(f"❌ Download failed: {exc}", file=sys.stderr)
        return 1

    summarize_download(hook_log)

    if args.trim_filenames and hook_log:
        maybe_trim_prefix(hook_log, destination)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
