---
name: xiaohongshu-mcp
description: Run the local Xiaohongshu MCP server and call its tools via mcporter.
metadata: { "verso": { "emoji": "📕", "requires": { "bins": ["docker", "mcporter"] } } }
---

# xiaohongshu-mcp (local MCP server)

This skill wraps the local `xiaohongshu-mcp` server and exposes quick commands to start/stop the service and call MCP tools.

Repository location (default):

`/Users/veso/Documents/xiaohongshu-mcp`

You can override with `XHS_MCP_DIR` when running scripts.

## Start the MCP server (Docker Compose)

```bash
bash /Users/veso/Documents/verso/skills/xiaohongshu-mcp/scripts/start.sh
```

The MCP endpoint will be:

`http://localhost:18060/mcp`

## Stop the MCP server

```bash
bash /Users/veso/Documents/verso/skills/xiaohongshu-mcp/scripts/stop.sh
```

## Follow logs

```bash
bash /Users/veso/Documents/verso/skills/xiaohongshu-mcp/scripts/logs.sh
```

## Call MCP tools (mcporter)

Example tool calls (server must be running):

```bash
# List tools
mcporter list http://localhost:18060/mcp --schema

# Check login status
mcporter call http://localhost:18060/mcp.check_login_status

# Get login QR code (returns image + text)
mcporter call http://localhost:18060/mcp.get_login_qrcode

# Publish content (images are local absolute paths)
mcporter call http://localhost:18060/mcp.publish_content --args '{
  "title": "标题",
  "content": "内容",
  "images": ["/Users/veso/Pictures/img1.jpg"],
  "tags": ["标签1", "标签2"]
}'
```

## Tools provided by this MCP server

- `check_login_status`
- `get_login_qrcode`
- `delete_cookies`
- `publish_content`
- `publish_with_video`
- `list_feeds`
- `search_feeds`
- `get_feed_detail`
- `user_profile`
- `post_comment_to_feed`
- `reply_comment_in_feed`
- `like_feed`
- `favorite_feed`

## Notes

- The server is a local MCP HTTP service at `http://localhost:18060/mcp`.
- XiaoHongShu does not allow multiple web logins for the same account. Keep only one active web login at a time.
- Login is required before publishing or commenting.
