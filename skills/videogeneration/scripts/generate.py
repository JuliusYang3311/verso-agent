#!/usr/bin/env python3
"""
Video Generation Script - Verso Skill

Generates short videos from topics.
Uses Verso LLM for script/terms generation and edge-tts for voice.

Configuration loaded from ~/.verso/verso.json under videoGeneration key.
"""

import argparse
import glob
import json
import os
import shutil
import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path

# Add scripts directory to path for local imports
script_dir = Path(__file__).parent
sys.path.insert(0, str(script_dir.parent))

# Local module imports
from scripts.verso_llm import generate_script, generate_terms
from scripts.schema import VideoParams, VideoAspect, VideoConcatMode, MaterialInfo
from scripts import utils
from scripts import voice
from scripts import material
from scripts import video


def load_verso_config() -> dict:
    """Load videoGeneration config from verso.json."""
    config_path = Path.home() / ".verso" / "verso.json"
    if not config_path.exists():
        return {}
    
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            config = json.load(f)
        return config.get("videoGeneration", {})
    except Exception as e:
        print(f"⚠️  Could not load verso config: {e}")
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
        
        try:
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


def get_output_dir(config: dict, custom_dir: str = None) -> tuple:
    """Get the output directory from config, custom, or default."""
    if custom_dir:
        output_dir = Path(custom_dir)
        return output_dir.parent, output_dir
    
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


def load_script_from_file(file_path: str) -> str:
    """Load script content from a text file."""
    path = Path(file_path).expanduser()
    if not path.exists():
        print(f"❌ Script file not found: {file_path}")
        sys.exit(1)
    
    with open(path, "r", encoding="utf-8") as f:
        return f.read().strip()


def parse_materials(materials_str: str) -> list:
    """Parse materials string into list of paths, supports glob patterns."""
    paths = []
    for pattern in materials_str.split(","):
        pattern = pattern.strip()
        if "*" in pattern or "?" in pattern:
            matched = glob.glob(os.path.expanduser(pattern))
            paths.extend(matched)
        else:
            path = os.path.expanduser(pattern)
            if os.path.exists(path):
                paths.append(path)
    return paths


def generate_video_from_params(params: VideoParams, task_dir: str, config: dict) -> dict:
    """
    Generate video using local modules.
    
    Returns dict with paths to generated files.
    """
    result = {
        "script": params.video_script,
        "terms": params.video_terms or [],
        "videos": [],
        "audio_file": None,
        "subtitle_path": None,
    }
    
    # Step 1: Generate or use provided script
    if not params.video_script:
        print("📝 Generating script with Verso LLM...")
        params.video_script = generate_script(
            params.video_subject,
            params.video_language or "en",
            paragraph_number=2
        )
        result["script"] = params.video_script
    
    print(f"📜 Script: {params.video_script[:100]}...")
    
    # Step 2: Generate or use provided terms
    if not params.video_terms:
        print("🔍 Generating search terms...")
        params.video_terms = generate_terms(
            params.video_subject,
            params.video_script,
            amount=5
        )
        result["terms"] = params.video_terms
    
    print(f"🏷️  Terms: {', '.join(params.video_terms)}")
    
    # Step 3: Generate TTS audio
    print("🎙️  Generating voice narration...")
    audio_file = os.path.join(task_dir, "audio.mp3")
    sub_maker = voice.tts(
        text=params.video_script,
        voice_name=params.voice_name or "en-US-JennyNeural",
        voice_rate=params.voice_rate or 1.0,
        voice_file=audio_file,
    )
    
    if not sub_maker or not os.path.exists(audio_file):
        print("❌ TTS generation failed")
        return result
    
    result["audio_file"] = audio_file
    audio_duration = voice.get_audio_duration(audio_file)
    print(f"✅ Audio generated: {audio_duration:.1f}s")
    
    # Step 4: Generate subtitles
    subtitle_file = os.path.join(task_dir, "subtitle.srt")
    if params.subtitle_enabled:
        print("📝 Generating subtitles...")
        voice.create_subtitle(sub_maker, params.video_script, subtitle_file)
        if os.path.exists(subtitle_file):
            result["subtitle_path"] = subtitle_file
    
    # Step 5: Get video materials
    print("🎬 Downloading video materials...")
    video_files = []
    
    if params.video_materials:
        # Use provided local materials
        for mat in params.video_materials:
            if mat.url and os.path.exists(mat.url):
                video_files.append(mat.url)
    else:
        # Download from stock video APIs
        pexels_key = config.get("pexelsApiKey") or os.environ.get("PEXELS_API_KEY", "")
        pixabay_key = config.get("pixabayApiKey") or os.environ.get("PIXABAY_API_KEY", "")
        
        for term in params.video_terms[:3]:  # Limit to first 3 terms
            videos = []
            
            if pexels_key and params.video_source != "pixabay":
                videos = material.search_videos_pexels(
                    search_term=term,
                    minimum_duration=5,
                    video_aspect=params.video_aspect,
                )
            elif pixabay_key:
                videos = material.search_videos_pixabay(
                    search_term=term,
                    minimum_duration=5,
                    video_aspect=params.video_aspect,
                )
            
            # Download first matching video
            if videos:
                saved = material.save_video(videos[0].url, task_dir)
                if saved:
                    video_files.append(saved)
    
    if not video_files:
        print("❌ No video materials found")
        return result
    
    print(f"📦 Found {len(video_files)} video clips")
    
    # Step 6: Combine videos with audio
    print("🎥 Combining video clips...")
    combined_video = os.path.join(task_dir, "combined.mp4")
    
    video.combine_videos(
        combined_video_path=combined_video,
        video_paths=video_files,
        audio_file=audio_file,
        video_aspect=params.video_aspect,
        video_concat_mode=params.video_concat_mode,
        video_transition_mode=params.video_transition_mode,
        max_clip_duration=5,
    )
    
    if not os.path.exists(combined_video):
        print("❌ Video combining failed")
        return result
    
    # Step 7: Generate final video with subtitles
    print("✨ Generating final video...")
    final_video = os.path.join(task_dir, "final.mp4")
    
    video.generate_video(
        video_path=combined_video,
        audio_path=audio_file,
        subtitle_path=subtitle_file if params.subtitle_enabled else "",
        output_file=final_video,
        params=params,
    )
    
    if os.path.exists(final_video):
        result["videos"].append(final_video)
    
    return result


def main():
    config = load_verso_config()
    
    parser = argparse.ArgumentParser(
        description="Generate short videos from topics using Verso",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Basic - AI generates script
  python3 generate.py --topic "The future of AI"

  # Custom script text
  python3 generate.py --topic "AI" --script "AI正在改变世界。"

  # Script from file
  python3 generate.py --topic "AI" --script-file ~/scripts/my_script.txt

  # Custom search terms for video materials
  python3 generate.py --topic "AI" --terms "robot,technology,computer,future"

  # Use local video materials
  python3 generate.py --topic "Travel" --source local --materials "~/videos/*.mp4"

  # Chinese video with custom voice
  python3 generate.py --topic "人工智能" --language zh-CN --voice "zh-CN-YunxiNeural"
        """
    )
    
    # Basic options
    parser.add_argument("--topic", required=True, help="Video topic/subject")
    parser.add_argument("--language", default="en-US", help="Language code (e.g., en-US, zh-CN)")
    parser.add_argument("--voice", default="en-US-JennyNeural", help="Voice name for TTS")
    parser.add_argument("--aspect", choices=["portrait", "landscape"], default="portrait",
                       help="Video aspect ratio (portrait=9:16, landscape=16:9)")
    parser.add_argument("--out-dir", type=str, default=None, help="Output directory")
    
    # Content options
    parser.add_argument("--script", type=str, default=None, help="Custom script text")
    parser.add_argument("--script-file", type=str, default=None, help="Path to script file")
    parser.add_argument("--terms", type=str, default=None, help="Comma-separated search terms")
    parser.add_argument("--source", choices=["pexels", "pixabay", "local"], default="pexels",
                       help="Video material source")
    parser.add_argument("--materials", type=str, default=None,
                       help="Local material paths (comma-separated, supports glob)")
    
    # Other options
    parser.add_argument("--cleanup", action="store_true", help="Run cleanup of old videos")
    parser.add_argument("--bgm", type=str, default=None, help="Background music file path")
    parser.add_argument("--no-subtitle", action="store_true", help="Disable subtitles")
    parser.add_argument("--font", type=str, default=None, help="Font name or path")
    
    args = parser.parse_args()
    
    # Validate
    if args.source == "local" and not args.materials:
        parser.error("--materials is required when --source=local")
    
    # Setup directories
    output_base, output_dir = get_output_dir(config, args.out_dir)
    
    # Cleanup old videos
    retention_days = config.get("retentionDays", 7)
    if args.cleanup or retention_days > 0:
        cleanup_old_videos(output_base, retention_days)
    
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Create task directory
    task_id = str(uuid.uuid4())[:8]
    task_dir = str(output_dir / "task")
    os.makedirs(task_dir, exist_ok=True)
    
    # Load script
    script_text = args.script
    if args.script_file:
        script_text = load_script_from_file(args.script_file)
    
    # Parse terms
    video_terms = None
    if args.terms:
        video_terms = [t.strip() for t in args.terms.split(",") if t.strip()]
    
    # Parse local materials
    video_materials = None
    if args.source == "local" and args.materials:
        material_paths = parse_materials(args.materials)
        if not material_paths:
            print(f"❌ No materials found: {args.materials}")
            sys.exit(1)
        video_materials = [MaterialInfo(url=p) for p in material_paths]
        print(f"📁 Found {len(video_materials)} local materials")
    
    # Display config
    print(f"🎬 Video Generation")
    print(f"   Topic: {args.topic}")
    print(f"   Language: {args.language}")
    print(f"   Voice: {args.voice}")
    print(f"   Aspect: {args.aspect}")
    print(f"   Source: {args.source}")
    if script_text:
        preview = script_text[:60] + "..." if len(script_text) > 60 else script_text
        print(f"   Script: {preview}")
    if video_terms:
        print(f"   Terms: {', '.join(video_terms)}")
    print(f"   Output: {output_dir}")
    print()
    
    # Build params
    aspect_map = {"portrait": VideoAspect.portrait, "landscape": VideoAspect.landscape}
    
    params = VideoParams(
        video_subject=args.topic,
        video_script=script_text or "",
        video_terms=video_terms,
        video_language=args.language,
        voice_name=args.voice,
        video_aspect=aspect_map[args.aspect],
        video_concat_mode=VideoConcatMode.random,
        video_source=args.source,
        video_materials=video_materials,
        subtitle_enabled=not args.no_subtitle,
        bgm_file=args.bgm,
        font_name=args.font,
    )
    
    # Generate video
    result = generate_video_from_params(params, task_dir, config)
    
    if result.get("videos"):
        print()
        print("✅ Video generation complete!")
        
        # Copy videos to output
        for i, video_path in enumerate(result["videos"], 1):
            if os.path.exists(video_path):
                dest = output_dir / f"video-{i}.mp4"
                shutil.copy(video_path, dest)
                print(f"   📹 {dest}")
        
        # Copy artifacts
        if result.get("audio_file") and os.path.exists(result["audio_file"]):
            shutil.copy(result["audio_file"], output_dir / "audio.mp3")
        
        if result.get("subtitle_path") and os.path.exists(result["subtitle_path"]):
            shutil.copy(result["subtitle_path"], output_dir / "subtitle.srt")
        
        # Save metadata
        metadata = {
            "topic": args.topic,
            "script": result.get("script", ""),
            "terms": result.get("terms", []),
            "custom_script": bool(script_text),
            "custom_terms": bool(video_terms),
            "source": args.source,
            "generated_at": datetime.now().isoformat(),
        }
        with open(output_dir / "metadata.json", "w", encoding="utf-8") as f:
            json.dump(metadata, f, ensure_ascii=False, indent=2)
        
        print()
        print(f"📁 All files: {output_dir}")
    else:
        print("❌ Video generation failed")
        sys.exit(1)


if __name__ == "__main__":
    main()
