---
name: twitter
description: Automatically post tweets to Twitter/X with media support
---

# Twitter Auto-Post Skill

This skill allows you to automatically post tweets to Twitter/X (formerly Twitter), including text, images, videos, and threaded tweets.

## Configuration

To use this skill, you need to configure your Twitter API credentials. Run:

```bash
verso configure
```

Then provide the following when prompted:

### Required Credentials

- `TWITTER_API_KEY` - Your Twitter API Key (Consumer Key)
- `TWITTER_API_SECRET` - Your Twitter API Secret (Consumer Secret)
- `TWITTER_ACCESS_TOKEN` - Your Access Token
- `TWITTER_ACCESS_SECRET` - Your Access Token Secret

### Getting Twitter API Credentials

1. Go to [Twitter Developer Portal](https://developer.twitter.com/)
2. Create a new App (or use existing one)
3. Navigate to "Keys and Tokens" tab
4. Copy your API Key, API Secret, Access Token, and Access Token Secret

> [!IMPORTANT]
> Make sure your Twitter App has **Read and Write** permissions enabled.

## Usage

### Post a Simple Tweet

```bash
python3 skills/twitter/scripts/post_tweet.py "Hello from Verso! 🚀"
```

### Post with Image

```bash
python3 skills/twitter/scripts/post_tweet.py "Check out this image!" --media /path/to/image.jpg
```

### Post with Multiple Images (up to 4)

```bash
python3 skills/twitter/scripts/post_tweet.py "Multiple images" \
  --media /path/to/image1.jpg /path/to/image2.jpg /path/to/image3.jpg
```

### Post a Thread

```bash
python3 skills/twitter/scripts/post_tweet.py \
  --thread "First tweet in thread" \
  --thread "Second tweet" \
  --thread "Final tweet!"
```

### Post with Video

Post videos directly to Twitter, including AI-generated videos from the videogeneration skill:

```bash
# Post a video
python3 skills/twitter/scripts/post_tweet.py "Check out this video!" \
  --media /path/to/video.mp4

# Post AI-generated video from videogeneration skill
python3 skills/twitter/scripts/post_tweet.py "AI生成的程序员笑话视频 🎬 #AI #coding" \
  --media /Users/veso/verso/video_generation/final-Programmer_Logic_Joke-*.mp4
```

**Supported Video Formats:**

- MP4 (recommended)
- MOV
- AVI
- Other formats supported by Twitter

**Video Limits:**

- **Standard accounts**: Max 512MB, up to 2:20 duration
- **Twitter Blue/Premium**: Max 512MB, up to 10 minutes
- **Frame rate**: 30fps or 60fps recommended
- **Resolution**: Up to 1920x1200 (landscape), 1200x1900 (portrait)

## Features

- ✅ Post text tweets
- ✅ Upload and post images (up to 4 per tweet)
- ✅ Upload and post videos
- ✅ Create threaded tweets
- ✅ Automatic credential loading from verso.json
- ✅ Rich error handling and validation

## Dependencies

Install the required Python package:

```bash
pip install tweepy
```

## Limits

- **Text**: Maximum 280 characters per tweet (4000 for Twitter Blue/Premium)
- **Images**: Up to 4 images per tweet, max 5MB each
- **Videos**: Max 512MB, up to 2:20 duration (longer for Twitter Blue/Premium)
- **Threads**: No hard limit, but recommended to keep under 25 tweets

## Troubleshooting

### "Authentication failed"

- Verify your API credentials are correct in `~/.verso/verso.json`
- Check that your App has "Read and Write" permissions

### "Tweet too long"

- Standard accounts: 280 characters
- Premium accounts: 4000 characters
- Use `--thread` to split into multiple tweets

### "Media upload failed"

- Check file size (images: max 5MB, videos: max 512MB)
- Verify file format (supported: JPG, PNG, GIF, MP4, MOV)
- Ensure file path is correct

## Examples

```bash
# Simple announcement
python3 skills/twitter/scripts/post_tweet.py "🎉 Excited to announce our new feature!"

# With image and hashtags
python3 skills/twitter/scripts/post_tweet.py \
  "Just deployed! #coding #tech" \
  --media screenshots/deployment.png

# Thread about a topic
python3 skills/twitter/scripts/post_tweet.py \
  --thread "🧵 Thread about AI: 1/4" \
  --thread "AI is transforming how we work... 2/4" \
  --thread "Key benefits include... 3/4" \
  --thread "Looking forward to the future! 4/4"
```
