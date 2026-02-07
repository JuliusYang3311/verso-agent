---
name: videogeneration
description: Generate short videos from topics or keywords using MoneyPrinterTurbo. Automatically creates script, audio, subtitles, and video.
homepage: https://github.com/harry0703/MoneyPrinterTurbo
metadata: {"verso":{"emoji":"🎬","requires":{"bins":["python3"]}}}
---

# Video Generation

Generate short videos based on a topic or keyword. Powered by [MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo).

## Configuration

Run `verso configure` to set up video generation settings, or add to `~/.verso/verso.json`:

```json
{
  "videoGeneration": {
    "enabled": true,
    "moneyPrinterPath": "/path/to/MoneyPrinterTurbo",
    "outputPath": "~/Projects/tmp",
    "retentionDays": 7,
    "pexelsApiKey": "your-pexels-api-key",
    "pixabayApiKey": "your-pixabay-api-key",
    "pythonPath": "python3.11"
  }
}
```

### Required Setup

1. **Python 3.10+**: `brew install python@3.11`
2. **MoneyPrinterTurbo**: Clone and install dependencies:
   ```bash
   git clone https://github.com/harry0703/MoneyPrinterTurbo.git
   cd MoneyPrinterTurbo
   pip3.11 install -r requirements.txt
   ```
3. **ImageMagick**: `brew install imagemagick`
4. **API Keys**: Get free API keys from [Pexels](https://www.pexels.com/api/) and/or [Pixabay](https://pixabay.com/api/docs/)

## Usage

```bash
# Basic - generate a video about a topic
python3.11 {baseDir}/scripts/generate.py --topic "The future of AI"

# Custom voice and aspect
python3.11 {baseDir}/scripts/generate.py --topic "Life hacks" --voice "en-US-GuyNeural" --aspect landscape

# Chinese video
python3.11 {baseDir}/scripts/generate.py --topic "人工智能的未来" --language zh-CN --voice "zh-CN-XiaoxiaoNeural"

# Force cleanup of old files
python3.11 {baseDir}/scripts/generate.py --topic "test" --cleanup
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--topic` | Video topic (required) | - |
| `--language` | Language code | `en-US` |
| `--voice` | TTS voice name | `en-US-JennyNeural` |
| `--aspect` | `portrait` or `landscape` | `portrait` |
| `--out-dir` | Output directory | from config |
| `--cleanup` | Force cleanup old files | false |

## Auto-Cleanup

Old video directories are automatically deleted based on `retentionDays` config (default: 7 days).

## Output Files

- `video-1.mp4` - Generated video
- `audio.mp3` - Voiceover
- `subtitle.srt` - Subtitles
- `script.json` - Script metadata
