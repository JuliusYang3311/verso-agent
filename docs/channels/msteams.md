---
summary: "Microsoft Teams bot support status, capabilities, and configuration"
read_when:
  - Working on MS Teams channel features
title: "Microsoft Teams"
---

# Microsoft Teams (plugin)

> "Abandon all hope, ye who enter here."

Updated: 2026-01-21

Status: text + DM attachments are supported; channel/group file sending requires `sharePointSiteId` + Graph permissions (see [Sending files in group chats](#sending-files-in-group-chats)). Polls are sent via Adaptive Cards.

## Plugin required

Microsoft Teams ships as a plugin and is not bundled with the core install.

**Breaking change (2026.1.15):** MS Teams moved out of core. If you use it, you must install the plugin.

Explainable: keeps core installs lighter and lets MS Teams dependencies update independently.

Install via CLI (npm registry):

```bash
verso plugins install @verso/msteams
```

Local checkout (when running from a git repo):

```bash
verso plugins install ./extensions/msteams
```

If you choose Teams during configure/onboarding and a git checkout is detected,
Verso will offer the local install path automatically.

Details: [Plugins](/tools/plugin)

## Quick setup (beginner)

1. Install the Microsoft Teams plugin.
2. Create an **Azure Bot** (App ID + client secret + tenant ID).
3. Configure Verso with those credentials.
4. Expose `/api/messages` (port 3978 by default) via a public URL or tunnel.
5. # Install the Teams app package and start the gateway.

1) Install the Microsoft Teams plugin.
2) Create an **Azure Bot** (App ID + client secret + tenant ID).
3) Configure Verso with those credentials.
4) Expose `/api/messages` (port 3978 by default) via a public URL or tunnel.
5) Install the Teams app package and start the gateway.
   > > > > > > > upstream/main

Minimal config:

```json5
{
  channels: {
    msteams: {
      enabled: true,
      appId: "<APP_ID>",
      appPassword: "<APP_PASSWORD>",
      tenantId: "<TENANT_ID>",
      webhook: { port: 3978, path: "/api/messages" },
    },
  },
}
```

Note: group chats are blocked by default (`channels.msteams.groupPolicy: "allowlist"`). To allow group replies, set `channels.msteams.groupAllowFrom` (or use `groupPolicy: "open"` to allow any member, mention-gated).

## Goals

- # Talk to Verso via Teams DMs, group chats, or channels.

- Talk to Verso via Teams DMs, group chats, or channels.
  > > > > > > > upstream/main
- Keep routing deterministic: replies always go back to the channel they arrived on.
- Default to safe channel behavior (mentions required unless configured otherwise).

## Config writes

By default, Microsoft Teams is allowed to write config updates triggered by `/config set|unset` (requires `commands.config: true`).

Disable with:

```json5
{
  channels: { msteams: { configWrites: false } },
}
```

## Access control (DMs + groups)

**DM access**

- Default: `channels.msteams.dmPolicy = "pairing"`. Unknown senders are ignored until approved.
- `channels.msteams.allowFrom` accepts AAD object IDs, UPNs, or display names. The wizard resolves names to IDs via Microsoft Graph when credentials allow.

**Group access**

- Default: `channels.msteams.groupPolicy = "allowlist"` (blocked unless you add `groupAllowFrom`). Use `channels.defaults.groupPolicy` to override the default when unset.
- `channels.msteams.groupAllowFrom` controls which senders can trigger in group chats/channels (falls back to `channels.msteams.allowFrom`).
- Set `groupPolicy: "open"` to allow any member (still mention‑gated by default).
- To allow **no channels**, set `channels.msteams.groupPolicy: "disabled"`.

Example:

```json5
{
  channels: {
    msteams: {
      groupPolicy: "allowlist",
      groupAllowFrom: ["user@org.com"],
    },
  },
}
```

**Teams + channel allowlist**

- Scope group/channel replies by listing teams and channels under `channels.msteams.teams`.
- Keys can be team IDs or names; channel keys can be conversation IDs or names.
- When `groupPolicy="allowlist"` and a teams allowlist is present, only listed teams/channels are accepted (mention‑gated).
- The configure wizard accepts `Team/Channel` entries and stores them for you.
- On startup, Verso resolves team/channel and user allowlist names to IDs (when Graph permissions allow)
  and logs the mapping; unresolved entries are kept as typed.

Example:

```json5
{
  channels: {
    msteams: {
      groupPolicy: "allowlist",
      teams: {
        "My Team": {
          channels: {
            General: { requireMention: true },
          },
        },
      },
    },
  },
}
```

## How it works

1. Install the Microsoft Teams plugin.
2. Create an **Azure Bot** (App ID + secret + tenant ID).
3. Build a **Teams app package** that references the bot and includes the RSC permissions below.
4. Upload/install the Teams app into a team (or personal scope for DMs).
5. Configure `msteams` in `~/.verso/verso.json` (or env vars) and start the gateway.
6. The gateway listens for Bot Framework webhook traffic on `/api/messages` by default.

## Azure Bot Setup (Prerequisites)

Before configuring Verso, you need to create an Azure Bot resource.

### Step 1: Create Azure Bot

1. Go to [Create Azure Bot](https://portal.azure.com/#create/Microsoft.AzureBot)
2. Fill in the **Basics** tab:

   | Field              | Value                                                 |
   | ------------------ | ----------------------------------------------------- |
   | **Bot handle**     | Your bot name, e.g., `verso-msteams` (must be unique) |
   | **Subscription**   | Select your Azure subscription                        |
   | **Resource group** | Create new or use existing                            |
   | **Pricing tier**   | **Free** for dev/testing                              |
   | **Type of App**    | **Single Tenant** (recommended - see note below)      |
   | **Creation type**  | **Create new Microsoft App ID**                       |

> **Deprecation notice:** Creation of new multi-tenant bots was deprecated after 2025-07-31. Use **Single Tenant** for new bots.

3. Click **Review + create** → **Create** (wait ~1-2 minutes)

### Step 2: Get Credentials

1. Go to your Azure Bot resource → **Configuration**
2. Copy **Microsoft App ID** → this is your `appId`
3. Click **Manage Password** → go to the App Registration
4. Under **Certificates & secrets** → **New client secret** → copy the **Value** → this is your `appPassword`
5. Go to **Overview** → copy **Directory (tenant) ID** → this is your `tenantId`

### Step 3: Configure Messaging Endpoint

1. In Azure Bot → **Configuration**
2. Set **Messaging endpoint** to your webhook URL:
   - Production: `https://your-domain.com/api/messages`
   - Local dev: Use a tunnel (see [Local Development](#local-development-tunneling) below)

### Step 4: Enable Teams Channel

1. In Azure Bot → **Channels**
2. Click **Microsoft Teams** → Configure → Save
3. Accept the Terms of Service

## Local Development (Tunneling)

Teams can't reach `localhost`. Use a tunnel for local development:

**Option A: ngrok**

```bash
ngrok http 3978
# Copy the https URL, e.g., https://abc123.ngrok.io
# Set messaging endpoint to: https://abc123.ngrok.io/api/messages
```

**Option B: Tailscale Funnel**

```bash
tailscale funnel 3978
# Use your Tailscale funnel URL as the messaging endpoint
```

## Teams Developer Portal (Alternative)

Instead of manually creating a manifest ZIP, you can use the [Teams Developer Portal](https://dev.teams.microsoft.com/apps):

1. Click **+ New app**
2. Fill in basic info (name, description, developer info)
3. Go to **App features** → **Bot**
4. Select **Enter a bot ID manually** and paste your Azure Bot App ID
5. Check scopes: **Personal**, **Team**, **Group Chat**
6. Click **Distribute** → **Download app package**
7. In Teams: **Apps** → **Manage your apps** → **Upload a custom app** → select the ZIP

This is often easier than hand-editing JSON manifests.

## Testing the Bot

**Option A: Azure Web Chat (verify webhook first)**

1. In Azure Portal → your Azure Bot resource → **Test in Web Chat**
2. Send a message - you should see a response
3. This confirms your webhook endpoint works before Teams setup

**Option B: Teams (after app installation)**

1. Install the Teams app (sideload or org catalog)
2. Find the bot in Teams and send a DM
3. Check gateway logs for incoming activity

## Setup (minimal text-only)

1. **Install the Microsoft Teams plugin**
   - From npm: `verso plugins install @verso/msteams`
   - From a local checkout: `verso plugins install ./extensions/msteams`

2. **Bot registration**
   - Create an Azure Bot (see above) and note:
     - App ID
     - Client secret (App password)
     - Tenant ID (single-tenant)

3. **Teams app manifest**
   - Include a `bot` entry with `botId = <App ID>`.
   - Scopes: `personal`, `team`, `groupChat`.
   - `supportsFiles: true` (required for personal scope file handling).
   - Add RSC permissions (below).
   - Create icons: `outline.png` (32x32) and `color.png` (192x192).
   - Zip all three files together: `manifest.json`, `outline.png`, `color.png`.

<<<<<<< HEAD 4. **Configure Verso**
