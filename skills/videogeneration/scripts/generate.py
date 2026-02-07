#!/usr/bin/env python3
"""
Video Generation Script - Verso Skill

Generates short videos from topics using MoneyPrinterTurbo.
Reads configuration from ~/.verso/verso.json.
"""

import argparse
import json
import os
import shutil
import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path


def load_verso_config():
    """Load videoGeneration config from verso.json."""
    config_path = Path.home() / ".verso" / "verso.json"
    if not config_path.exists():
        return {}
    
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            config = json.load(f)
        return config.get("videoGeneration", {})
    except Exception as e:
        print(f"Warning: Could not load verso config: {e}")
        return {}


def cleanup_old_videos(output_base: Path, retention_days: int):
    """Delete video directories older than retention_days."""
    if retention_days <= 0:
        return
    
    cutoff = datetime.now() - timedelta(days=retention_days)
    
    if not output_base.exists():
        return
    
    for item in output_base.iterdir():
        if not item.is_dir() or not item.name.startswith("videogeneration-"):
            continue
        
        # Parse timestamp from directory name
        try:
            # Format: videogeneration-YYYYMMDD-HHMMSS
            parts = item.name.split("-")
            if len(parts) >= 3:
                date_str = parts[1]
                time_str = parts[2]
                dir_time = datetime.strptime(f"{date_str}-{time_str}", "%Y%m%d-%H%M%S")
                if dir_time < cutoff:
                    print(f"🗑️  Cleaning up old directory: {item.name}")
                    shutil.rmtree(item)
        except ValueError:
            continue


def get_default_output_dir(config: dict):
    """Get the output directory from config or default."""
    if config.get("outputPath"):
        base = Path(config["outputPath"]).expanduser()
    else:
        projects_tmp = Path.home() / "Projects" / "tmp"
        if projects_tmp.exists():
            base = projects_tmp
        else:
            base = Path("./tmp")
    
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return base, base / f"videogeneration-{timestamp}"


def main():
    # Load config first
    config = load_verso_config()
    
    # Determine MoneyPrinterTurbo path
    money_printer_path = config.get("moneyPrinterPath", "/Users/veso/Documents/MoneyPrinterTurbo")
    
    if not Path(money_printer_path).exists():
        print(f"❌ MoneyPrinterTurbo not found at: {money_printer_path}")
        print("   Please set videoGeneration.moneyPrinterPath in ~/.verso/verso.json")
        sys.exit(1)
    
    # Add MoneyPrinterTurbo to path
    sys.path.insert(0, money_printer_path)
    
    # Change working directory to MoneyPrinterTurbo (required for config loading)
    os.chdir(money_printer_path)
    
    # Set environment variables from config
    if config.get("pexelsApiKey"):
        os.environ.setdefault("PEXELS_API_KEY", config["pexelsApiKey"])
    if config.get("pixabayApiKey"):
        os.environ.setdefault("PIXABAY_API_KEY", config["pixabayApiKey"])
    
    # Import MoneyPrinterTurbo modules (after path setup)
    from app.models.schema import VideoParams, VideoAspect, VideoConcatMode
    from app.services import task as video_task
    from app.utils import utils
    
    parser = argparse.ArgumentParser(
        description="Generate short videos from topics using MoneyPrinterTurbo"
    )
    parser.add_argument(
        "--topic",
        required=True,
        help="Video topic/subject"
    )
    parser.add_argument(
        "--language",
        default="en-US",
        help="Language code (e.g., en-US, zh-CN). Default: en-US"
    )
    parser.add_argument(
        "--voice",
        default="en-US-JennyNeural",
        help="Voice name for TTS. Default: en-US-JennyNeural"
    )
    parser.add_argument(
        "--aspect",
        choices=["portrait", "landscape"],
        default="portrait",
        help="Video aspect ratio. Default: portrait (9:16)"
    )
    parser.add_argument(
        "--out-dir",
        type=str,
        default=None,
        help="Output directory. Default: from config or ~/Projects/tmp"
    )
    parser.add_argument(
        "--count",
        type=int,
        default=1,
        help="Number of videos to generate. Default: 1"
    )
    parser.add_argument(
        "--cleanup",
        action="store_true",
        help="Run cleanup of old videos based on retentionDays config"
    )
    
    args = parser.parse_args()
    
    # Determine output directory
    output_base, output_dir = get_default_output_dir(config)
    if args.out_dir:
        output_dir = Path(args.out_dir)
        output_base = output_dir.parent
    
    # Run cleanup if configured
    retention_days = config.get("retentionDays", 7)
    if args.cleanup or retention_days > 0:
        cleanup_old_videos(output_base, retention_days)
    
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Create task ID
    task_id = str(uuid.uuid4())
    
    # Create task directory in the standard location
    task_dir = utils.task_dir(task_id)
    os.makedirs(task_dir, exist_ok=True)
    
    print(f"🎬 Video Generation")
    print(f"   Topic: {args.topic}")
    print(f"   Language: {args.language}")
    print(f"   Voice: {args.voice}")
    print(f"   Aspect: {args.aspect}")
    print(f"   Output: {output_dir}")
    print()
    
    # Map aspect to VideoAspect
    aspect_map = {
        "portrait": VideoAspect.portrait,
        "landscape": VideoAspect.landscape
    }
    
    # Configure video parameters
    params = VideoParams(
        video_subject=args.topic,
        video_language=args.language,
        voice_name=args.voice,
        video_aspect=aspect_map[args.aspect],
        video_concat_mode=VideoConcatMode.random,
        video_count=args.count,
        subtitle_enabled=True,
    )
    
    print("📝 Generating script...")
    
    # Start the video generation task
    result = video_task.start(task_id, params, stop_at="video")
    
    if result and "videos" in result:
        print()
        print("✅ Video generation complete!")
        
        # Copy videos to output directory
        for i, video_path in enumerate(result["videos"], 1):
            if os.path.exists(video_path):
                dest = output_dir / f"video-{i}.mp4"
                shutil.copy(video_path, dest)
                print(f"   📹 {dest}")
        
        # Copy other artifacts
        if result.get("audio_file") and os.path.exists(result["audio_file"]):
            shutil.copy(result["audio_file"], output_dir / "audio.mp3")
        
        if result.get("subtitle_path") and os.path.exists(result["subtitle_path"]):
            shutil.copy(result["subtitle_path"], output_dir / "subtitle.srt")
        
        # Save script info
        script_info = {
            "topic": args.topic,
            "script": result.get("script", ""),
            "terms": result.get("terms", []),
        }
        with open(output_dir / "script.json", "w", encoding="utf-8") as f:
            json.dump(script_info, f, ensure_ascii=False, indent=2)
        
        print()
        print(f"📁 All files saved to: {output_dir}")
    else:
        print("❌ Video generation failed. Check logs for details.")
        sys.exit(1)


if __name__ == "__main__":
    main()
