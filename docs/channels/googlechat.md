---
summary: "Google Chat app support status, capabilities, and configuration"
read_when:
  - Working on Google Chat channel features
title: "Google Chat"
---

# Google Chat (Chat API)

Status: ready for DMs + spaces via Google Chat API webhooks (HTTP only).

## Quick setup (beginner)

1. Create a Google Cloud project and enable the **Google Chat API**.
   - Go to: [Google Chat API Credentials](https://console.cloud.google.com/apis/api/chat.googleapis.com/credentials)
   - Enable the API if it is not already enabled.
2. Create a **Service Account**:
   - Press **Create Credentials** > **Service Account**.
   - Name it whatever you want (e.g., `verso-chat`).
   - Leave permissions blank (press **Continue**).
   - Leave principals with access blank (press **Done**).
3. Create and download the **JSON Key**:
   - In the list of service accounts, click on the one you just created.
   - Go to the **Keys** tab.
   - Click **Add Key** > **Create new key**.
   - Select **JSON** and press **Create**.

4) Store the downloaded JSON file on your gateway host (e.g., `~/.verso/googlechat-service-account.json`).
5) Create a Google Chat app in the [Google Cloud Console Chat Configuration](https://console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat):
   - Fill in the **Application info**:
     - **App name**: (e.g. `Verso`)
     - **Avatar URL**: (e.g. `https://molt.bot/logo.png`)
     - **Description**: (e.g. `Personal AI Assistant`)
   - Enable **Interactive features**.
   - Under **Functionality**, check **Join spaces and group conversations**.
   - Under **Connection settings**, select **HTTP endpoint URL**.
   - Under **Triggers**, select **Use a common HTTP endpoint URL for all triggers** and set it to your gateway's public URL followed by `/googlechat`.
     - _Tip: Run `verso status` to find your gateway's public URL._
   - Under **Visibility**, check **Make this Chat app available to specific people and groups in &lt;Your Domain&gt;**.
   - Enter your email address (e.g. `user@example.com`) in the text box.
   - Click **Save** at the bottom.

6. **Enable the app status**:
   - After saving, **refresh the page**.
   - Look for the **App status** section (usually near the top or bottom after saving).
   - Change the status to **Live - available to users**.
   - Click **Save** again.

7) Configure Verso with the service account path + webhook audience:
   - Env: `GOOGLE_CHAT_SERVICE_ACCOUNT_FILE=/path/to/service-account.json`
   - Or config: `channels.googlechat.serviceAccountFile: "/path/to/service-account.json"`.

8. Set the webhook audience type + value (matches your Chat app config).
9. Start the gateway. Google Chat will POST to your webhook path.

## Add to Google Chat

Once the gateway is running and your email is added to the visibility list:

1. Go to [Google Chat](https://chat.google.com/).
2. Click the **+** (plus) icon next to **Direct Messages**.
3. In the search bar (where you usually add people), type the **App name** you configured in the Google Cloud Console.
   - **Note**: The bot will _not_ appear in the "Marketplace" browse list because it is a private app. You must search for it by name.
4. Select your bot from the results.
5. Click **Add** or **Chat** to start a 1:1 conversation.
6. Send "Hello" to trigger the assistant!

## Public URL (Webhook-only)

Google Chat webhooks require a public HTTPS endpoint. For security, **only expose the `/googlechat` path** to the internet. Keep the Verso dashboard and other sensitive endpoints on your private network.
