name: ghost
description: Manage Ghost.io blog content. Supports diagnostic tests and file-based publishing (HTML via @prefix).
metadata: {"verso":{"emoji":"👻","features":["file-based-publishing","test-command"],"requires":{"env":["GHOST_API_URL","GHOST_CONTENT_API_KEY","GHOST_ADMIN_API_KEY"]}}}

---

# Ghost.io Management Skill

This skill allows you to manage your Ghost.io blog, including reading content and performing administrative actions via the Content and Admin APIs.

## Configuration

To use this skill, you need to configure your Ghost API credentials. Run:

```bash
verso configure
```

Then provide the following when prompted for the `ghost` skill:

### Required Config

- `apiUrl` - The base URL of your Ghost site (e.g., `https://my-blog.ghost.io`)
- `contentApiKey` - Your Ghost Content API Key
- `adminApiKey` - Your Ghost Admin API Key

### Getting Ghost API Credentials

1. Go to your Ghost Admin panel (`/ghost/`)
2. Navigate to **Settings > Integrations**
3. Create a new **Custom Integration**
4. Copy your **API URL**, **Content API Key**, and **Admin API Key**

## Usage

The `ghost_manager.py` script is organized by **Functional Modules**.

### 0. Diagnostics & Testing

Before managing content, verify your connection and credentials:

```bash
# Test API connection and site info
python3 skills/ghost/scripts/ghost_manager.py test
```

### 1. Posts & Pages (Content Management)

**Publish a Post (Shorthand)**

```bash
# Direct HTML string
python3 skills/ghost/scripts/ghost_manager.py posts publish "My Title" "<h1>Body Content</h1>"

# From a file (using @ prefix)
python3 skills/ghost/scripts/ghost_manager.py posts publish "My Title" @article.html
```

**Post Field Reference (for `add` command)**

| Field Name      | Type    | Required | Description                                                |
| :-------------- | :------ | :------- | :--------------------------------------------------------- |
| `title`         | String  | **Yes**  | Post Title                                                 |
| `html`          | String  | No       | Post content in HTML (auto-converted to Mobiledoc)         |
| `status`        | String  | No       | `published`, `draft`, `scheduled` (default is `draft`)     |
| `feature_image` | String  | No       | URL of the feature image                                   |
| `featured`      | Boolean | No       | Whether it's a "featured" post                             |
| `tags`          | Array   | No       | `[{"name": "News"}]` (automatically links or creates tags) |
| `published_at`  | Date    | No       | ISO 8601 timestamp (for scheduling or backdating)          |
| `slug`          | String  | No       | Custom URL slug                                            |

**Custom Post/Page Creation (Full Control)**

```bash
# Add a page with full data
python3 skills/ghost/scripts/ghost_manager.py pages add '{"title": "Contact", "html": "...", "status": "published", "tags": [{"name": "Support"}]}'
```

### 2. Tags & Authors

```bash
# List all tags
python3 skills/ghost/scripts/ghost_manager.py tags browse

# Browse authors
python3 skills/ghost/scripts/ghost_manager.py authors browse
```

### 3. Members (Admin Only)

Newsletter and subscription management.

```bash
# Add a new member
python3 skills/ghost/scripts/ghost_manager.py members add '{"email": "user@example.com", "name": "John Doe", "labels": ["vip"]}'
```

### 4. Images & Media (Admin Only)

Upload files. Fields: `file` (path). Optional `params`: `purpose`, `ref`.

```bash
# Upload image
python3 skills/ghost/scripts/ghost_manager.py images upload path/to/image.png

# Upload media (video/audio)
python3 skills/ghost/scripts/ghost_manager.py media upload path/to/video.mp4
```

### 5. Settings

Manage site-wide configuration.

```bash
# Change site title
python3 skills/ghost/scripts/ghost_manager.py settings edit '[{"key": "title", "value": "New Blog Title"}]'
```

### 6. Themes (Admin Only)

```bash
# Upload theme
python3 skills/ghost/scripts/ghost_manager.py themes upload path/to/theme.zip

# Activate theme
python3 skills/ghost/scripts/ghost_manager.py themes activate "my-theme"
```

### 7. Webhooks (Admin Only)

```bash
# Create a webhook for post publishing
python3 skills/ghost/scripts/ghost_manager.py webhooks add '{"event": "post.published", "target_url": "https://callback.com", "name": "Auto Post"}'
```

### 8. Site Info

```bash
# Read public site info (title, logo, etc.)
python3 skills/ghost/scripts/ghost_manager.py site read
```

### 9. Image + Text Publishing Guide

Publishing content with images requires two steps:

**Step 1: Upload Image to Get URL**

```bash
python3 skills/ghost/scripts/ghost_manager.py images upload path/to/my_photo.png
```

_The `url` in the returned JSON will look like: `https://your-blog.com/content/images/2024/02/my_photo.png`_

**Step 2: Reference the URL in the Post's HTML**

```bash
python3 skills/ghost/scripts/ghost_manager.py posts publish "Post with Image" "<h1>Look at this image</h1><img src='[URL_FROM_PREVIOUS_STEP]'><p>This is the text description.</p>"
```

## Troubleshooting

### "Authentication failed"

- Verify your API credentials are correct in `~/.verso/verso.json`
- **Clock Skew**: The script automatically adjusts for 30s of clock skew. Ensure your system time is accurate.
- Check that your API key contains the `:` separator and is correctly copied.

### "Required bin not found"

- Ensure `python3` is in your PATH.
- Install dependencies: `pip install requests PyJWT`

## Dependencies

Install the required Python packages:

```bash
pip install requests PyJWT
```
