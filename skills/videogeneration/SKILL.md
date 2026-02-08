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

## Configuration

Add to `~/.verso/verso.json`:

```json
{
  "videoGeneration": {
    "enabled": true,
    "outputPath": "~/Projects/tmp",
    "retentionDays": 7,
    "pexelsApiKey": "your-pexels-api-key",
    "pixabayApiKey": "your-pixabay-api-key"
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
/opt/homebrew/bin/python3.11 {baseDir}/scripts/generate.py --topic "The future of AI"

# Custom script text
/opt/homebrew/bin/python3.11 {baseDir}/scripts/generate.py --topic "AI" \
  --script "AI正在改变世界。未来充满无限可能。"

# Custom search terms
/opt/homebrew/bin/python3.11 {baseDir}/scripts/generate.py --topic "Technology" \
  --terms "robot,computer,future"

# Use local video materials
/opt/homebrew/bin/python3.11 {baseDir}/scripts/generate.py --topic "My Trip" \
  --source local --materials "~/videos/*.mp4"

# Chinese video
/opt/homebrew/bin/python3.11 {baseDir}/scripts/generate.py --topic "人工智能" \
  --language zh-CN --voice "zh-CN-YunxiNeural"

# Landscape format
/opt/homebrew/bin/python3.11 {baseDir}/scripts/generate.py --topic "Nature" \
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

