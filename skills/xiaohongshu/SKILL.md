---
name: xiaohongshu
description: Manage XiaoHongShu (小红书) via a local Python Playwright automation tool (login, publish, search, comments, like/favorite).
metadata: { "verso": { "emoji": "📕", "requires": { "bins": ["python3"] } } }
---

# XiaoHongShu Skill (Python)

This skill implements the XiaoHongShu workflow locally using Playwright. It supports:

- Login status check + QR login
- Publish image posts
- Publish video posts
- List feeds
- Search feeds (with filters)
- Feed detail
- User profile
- Comment, reply, like, favorite

## Cookie storage

Cookies are stored and updated at:

`/Users/veso/Documents/verso/skills/xiaohongshu/.state/storage.json`

## Setup

Install dependencies:

```bash
pip3 install -r /Users/veso/Documents/verso/skills/xiaohongshu/requirements.txt
python3 -m playwright install chromium
```

## Usage

All commands output JSON to stdout.

```bash
python3 /Users/veso/Documents/verso/skills/xiaohongshu/scripts/xhs.py check_login
python3 /Users/veso/Documents/verso/skills/xiaohongshu/scripts/xhs.py get_login_qrcode --wait 120
python3 /Users/veso/Documents/verso/skills/xiaohongshu/scripts/xhs.py wait_for_login --timeout 120

# Default geo mode is deny to avoid system popups. Override with XHS_GEO=allow if needed.
# You can tune waits with XHS_UPLOAD_WAIT, XHS_BUTTON_WAIT, XHS_PUBLISH_WAIT, XHS_TAG_WAIT (seconds).
XHS_HEADLESS=0 XHS_UPLOAD_WAIT=360 XHS_BUTTON_WAIT=1200 XHS_PUBLISH_WAIT=360 XHS_TAG_WAIT=60 \\
python3 /Users/veso/Documents/verso/skills/xiaohongshu/scripts/xhs.py publish_content \\
  --title "标题(<=20字符)" \\
  --content "正文" \\
  --images /abs/path/1.jpg /abs/path/2.jpg \\
  --tags 标签1 标签2

# Default geo mode is deny to avoid system popups. Override with XHS_GEO=allow if needed.
# You can tune waits with XHS_UPLOAD_WAIT, XHS_BUTTON_WAIT, XHS_PUBLISH_WAIT, XHS_TAG_WAIT (seconds).
XHS_HEADLESS=0 XHS_UPLOAD_WAIT=360 XHS_BUTTON_WAIT=1200 XHS_PUBLISH_WAIT=360 XHS_TAG_WAIT=60 \\
python3 /Users/veso/Documents/verso/skills/xiaohongshu/scripts/xhs.py publish_video \\
  --title "标题(<=20字符)" \\
  --content "正文" \\
  --video /abs/path/video.mp4 \\
  --tags 标签1 标签2

python3 /Users/veso/Documents/verso/skills/xiaohongshu/scripts/xhs.py list_feeds
python3 /Users/veso/Documents/verso/skills/xiaohongshu/scripts/xhs.py search_feeds --keyword 关键词
python3 /Users/veso/Documents/verso/skills/xiaohongshu/scripts/xhs.py get_feed_detail --feed_id <id> [--xsec_token <token>]
python3 /Users/veso/Documents/verso/skills/xiaohongshu/scripts/xhs.py get_feed_detail --feed_id <id> [--xsec_token <token>] --load_all_comments --click_more_replies --max_replies_threshold 10 --max_comment_items 200 --scroll_speed normal
python3 /Users/veso/Documents/verso/skills/xiaohongshu/scripts/xhs.py user_profile --user_id <id> --xsec_token <token>

python3 /Users/veso/Documents/verso/skills/xiaohongshu/scripts/xhs.py post_comment \\
  --feed_id <id> --xsec_token <token> --content "评论内容"

python3 /Users/veso/Documents/verso/skills/xiaohongshu/scripts/xhs.py reply_comment \\
  --feed_id <id> --xsec_token <token> --comment_id <cid> --user_id <uid> --content "回复内容"

python3 /Users/veso/Documents/verso/skills/xiaohongshu/scripts/xhs.py like_feed --feed_id <id> --xsec_token <token>
python3 /Users/veso/Documents/verso/skills/xiaohongshu/scripts/xhs.py unlike_feed --feed_id <id> --xsec_token <token>
python3 /Users/veso/Documents/verso/skills/xiaohongshu/scripts/xhs.py favorite_feed --feed_id <id> --xsec_token <token>
python3 /Users/veso/Documents/verso/skills/xiaohongshu/scripts/xhs.py unfavorite_feed --feed_id <id> --xsec_token <token>
```

## Notes

- QR login requires a visible browser; the script automatically uses headful mode for QR commands.
- XiaoHongShu does not allow multiple simultaneous web logins for the same account.
- If selectors change, update the script accordingly.
- Title length must be 20 characters or fewer.
- If tag auto-complete causes stalls, set `XHS_SKIP_TAGS=1` to skip tag entry.
- The script waits 10 seconds before clicking Publish to allow uploads to finish.
