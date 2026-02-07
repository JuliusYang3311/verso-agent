---
name: videogeneration
description: Generate short videos from topics or keywords using MoneyPrinterTurbo. Automatically creates script, audio, subtitles, and video.
homepage: https://github.com/harry0703/MoneyPrinterTurbo
metadata: {"verso":{"emoji":"🎬","requires":{"bins":["python3"]}}}
---

# Video Generation

Generate short videos based on a topic or keyword. Powered by [MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo).

## Configuration

Add to `~/.verso/verso.json`:

```json
{
  "videoGeneration": {
    "enabled": true,
    "moneyPrinterPath": "/path/to/MoneyPrinterTurbo",
    "outputPath": "~/Projects/tmp",
    "retentionDays": 7,
    "pexelsApiKey": "your-pexels-api-key",
    "pixabayApiKey": "your-pixabay-api-key"
  }
}
```

### Required Setup

1. **Python 3.10+**: `brew install python@3.11`
2. **MoneyPrinterTurbo**: Clone and install:
   ```bash
   git clone https://github.com/harry0703/MoneyPrinterTurbo.git
   cd MoneyPrinterTurbo && pip3.11 install -r requirements.txt
   ```
3. **ImageMagick**: `brew install imagemagick`
4. **API Keys**: [Pexels](https://www.pexels.com/api/) and/or [Pixabay](https://pixabay.com/api/docs/)

## Usage Examples

```bash
# Basic - AI generates script
python3.11 {baseDir}/scripts/generate.py --topic "The future of AI"

# Custom script text (bypasses AI)
python3.11 {baseDir}/scripts/generate.py --topic "AI" \
  --script "AI正在改变世界。从手机到汽车，无处不在。未来充满无限可能。"

# Script from file
python3.11 {baseDir}/scripts/generate.py --topic "旅行" --script-file ~/scripts/travel.txt

# Custom search terms for video materials
python3.11 {baseDir}/scripts/generate.py --topic "Technology" \
  --terms "robot,computer,innovation,future,science"

# Use local video/image materials
python3.11 {baseDir}/scripts/generate.py --topic "My Trip" \
  --source local --materials "~/videos/*.mp4,~/images/*.jpg"

# Chinese video with custom voice
python3.11 {baseDir}/scripts/generate.py --topic "人工智能" \
  --language zh-CN --voice "zh-CN-YunxiNeural"

# Landscape video with background music
python3.11 {baseDir}/scripts/generate.py --topic "Nature" \
  --aspect landscape --bgm ~/music/ambient.mp3
```

## Options

### Basic Options
| Option | Description | Default |
|--------|-------------|---------|
| `--topic` | Video topic (required) | - |
| `--language` | Language code | `en-US` |
| `--voice` | TTS voice name | `en-US-JennyNeural` |
| `--aspect` | `portrait` or `landscape` | `portrait` |
| `--out-dir` | Output directory | from config |
| `--count` | Number of videos | 1 |

### Content Options
| Option | Description | Default |
|--------|-------------|---------|
| `--script` | Custom script text | AI-generated |
| `--script-file` | Path to script file | - |
| `--terms` | Comma-separated search terms | AI-generated |
| `--source` | `pexels`, `pixabay`, or `local` | `pexels` |
| `--materials` | Local material paths (with --source local) | - |

### Other Options
| Option | Description | Default |
|--------|-------------|---------|
| `--bgm` | Background music file | none |
| `--no-subtitle` | Disable subtitles | false |
| `--cleanup` | Force cleanup old files | auto |

## Popular Voices

**English**:
- `en-US-JennyNeural` (Female)
- `en-US-GuyNeural` (Male)
- `en-US-AriaNeural` (Female)

**Chinese**:
- `zh-CN-XiaoxiaoNeural` (Female)
- `zh-CN-YunxiNeural` (Male)
- `zh-CN-XiaoyiNeural` (Female)

## Output Files

- `video-{n}.mp4` - Generated video(s)
- `audio.mp3` - Voiceover
- `subtitle.srt` - Subtitles
- `script.json` - Script metadata
