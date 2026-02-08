---
name: videogeneration
description: Generate short videos from topics or keywords. Automatically creates script, audio, subtitles, and video using Verso LLM and free TTS.
metadata: {"verso":{"emoji":"🎬","requires":{"bins":["python3","ffmpeg"]}}}
---

# Video Generation

Generate short videos from a topic using Verso's integrated LLM and free edge-tts for narration.

## Features

- **Verso LLM Integration**: Uses your configured Verso model provider for script/terms generation
- **Free TTS**: Uses edge-tts (Microsoft Edge voices) - no API key required
- **Stock Video**: Downloads from Pexels/Pixabay (API keys needed)
- **Local Materials**: Use your own video/image files
- **Automatic Subtitles**: SRT subtitle generation
- **Quality Filtering**: Enhanced material selection for better visual quality
- **Cinematic Style**: Generate atmospheric, professional-looking videos
- **Diversity Scoring**: Avoid repetitive footage

## Configuration

Add to `~/.verso/verso.json`:

```json
{
  "videoGeneration": {
    "enabled": true,
    "outputPath": "~/Projects/tmp",
    "retentionDays": 7,
    "pexelsApiKey": "your-pexels-api-key",
    "pixabayApiKey": "your-pixabay-api-key",
    "qualityFilter": true,
    "diversityThreshold": 0.3,
    "minClipDuration": 8
  }
}
```

## Setup

```bash
# Install Python dependencies
cd {baseDir} && pip3 install -r requirements.txt

# Install ffmpeg (required for video processing)
brew install ffmpeg
```

## Usage

```bash
# Basic - AI generates script
python3 {baseDir}/scripts/generate.py --topic "The future of AI"

# Enhanced with cinematic style (recommended for best quality)
python3 {baseDir}/scripts/generate.py \
  --topic "Studying in a cozy library" \
  --cinematic-style \
  --quality-filter \
  --diversity-threshold 0.4

# Custom script text
python3 {baseDir}/scripts/generate.py --topic "AI" \
  --script "AI正在改变世界。未来充满无限可能。"

# Custom search terms
python3 {baseDir}/scripts/generate.py --topic "Technology" \
  --terms "robot,computer,future"

# Use local video materials
python3 {baseDir}/scripts/generate.py --topic "My Trip" \
  --source local --materials "~/videos/*.mp4"

# Chinese video
python3 {baseDir}/scripts/generate.py --topic "人工智能" \
  --language zh-CN --voice "zh-CN-YunxiNeural"

# Landscape format
python3 {baseDir}/scripts/generate.py --topic "Nature" \
  --aspect landscape
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--topic` | Video topic (required) | - |
| `--language` | Language code | `en-US` |
| `--voice` | TTS voice name | `en-US-JennyNeural` |
| `--aspect` | `portrait` (9:16) or `landscape` (16:9) | `portrait` |
| `--out-dir` | Output directory | from config |
| `--script` | Custom script text | AI-generated |
| `--script-file` | Path to script file | - |
| `--terms` | Comma-separated search terms | AI-generated |
| `--source` | `pexels`, `pixabay`, or `local` | `pexels` |
| `--materials` | Local material paths (for --source local) | - |
| `--bgm` | Background music file | none |
| `--no-subtitle` | Disable subtitles | false |
| **`--cinematic-style`** | Add cinematic descriptors for better aesthetics | `false` |
| **`--quality-filter`** | Enable enhanced quality filtering | `true` |
| **`--no-quality-filter`** | Disable quality filtering | - |
| **`--diversity-threshold`** | How different videos should be (0-1) | `0.3` |
| **`--min-clip-duration`** | Minimum clip duration in seconds | `8` |

## Popular Voices

**English**: `en-US-JennyNeural`, `en-US-GuyNeural`, `en-US-AriaNeural`

**Chinese**: `zh-CN-XiaoxiaoNeural`, `zh-CN-YunxiNeural`, `zh-CN-XiaoyiNeural`

## Output

The generated files are organized for clarity:

**In the base output directory:**
- `final-{topic}-{timestamp}-1.mp4`: The final polished video ready for use.

**In the task subfolder (`task-{topic}-{timestamp}/`):**
- `audio.mp3`: The generated voice narration.
- `subtitle.srt`: The generated subtitles.
- `metadata.json`: Full task metadata including script, search terms, and timestamp.
- `Final.mp4` / `combined.mp4`: Temporary intermediate video files.
- `[timestamp].mp4`: Raw downloaded video materials.

## Tips for Best Results

- **Use `--cinematic-style`** for more visually appealing, atmospheric footage
- **Increase `--diversity-threshold`** (e.g., 0.4-0.5) to avoid similar-looking clips
- **Set `--min-clip-duration`** higher (10-15s) for more professional footage
- Provide specific, descriptive topics for better material matching
- Use custom scripts to control pacing and content precisely
