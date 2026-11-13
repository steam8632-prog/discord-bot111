# Discord IWARA video bot

The bot watches ordinary Discord messages for `/embed video`, `/embed trending`,
and `/embed popularity`. It skips private results, resolves a playable source,
and posts only the Cloudflare Worker link. The bot does not download or store
video files.

## Setup

1. In Discord Developer Portal, create or select the bot application and add a
   bot user.
2. Add its bot token to this Replit project's Secrets as `DISCORD_BOT_TOKEN`.
   Never put the token in chat or source files.
3. In **Bot → Privileged Gateway Intents**, enable **Message Content Intent**.
   The bot needs this to read ordinary messages. Save the setting.
4. Install the bot in the target server with the `bot` scope. Give it permission
   to view the channel and send messages.
5. Start the `Discord IWARA Bot` workflow in Replit.
6. Send a message such as `/embed video mmd`, `/embed video wuwa recent`,
   `/embed trending`, or `/embed popularity`.

The bot does not register slash commands. On startup, it removes the matching
global `/embed video` slash command previously created by this bot, if present.
Other application commands are left unchanged.
Search filters may be added as the final word: `relevance`, `recent`, `views`,
or `likes`. The bot maps `recent` to IWARA's date sort. Repeating the same
search or feed returns the next playable video on its current IWARA results
page; after that page is exhausted, it continues on the next numbered page.
Changing the query or sort starts at the first result.
After each video link, the bot sends a separate **Refresh** button. Pressing it
generates a fresh proxy link for that same video without advancing search
results; only the person who ran the search can use the button.

## Configuration

- Required secret: `DISCORD_BOT_TOKEN`
- Optional environment variable: `IWARA_PROXY_BASE_URL` (defaults to
  `https://iwara-proxy.steam8632.workers.dev`)
- The runtime needs `curl` available on `PATH`; it is used for IWARA API
  requests because Node's built-in HTTP client can receive a Cloudflare
  anti-bot challenge instead of the API response.

The Cloudflare Worker is called by posting its public HTTPS URL with the signed
IWARA URL encoded as the `url` parameter; no Cloudflare credential is required
for the Worker endpoint described in the project notes. Search queries and
signed IWARA URLs are not written to logs. Signed URLs are short-lived and
should not be shared separately from the proxy link.

## Run locally

```sh
pnpm --filter @workspace/discord-bot run dev
```

Type-check the bot with:

```sh
pnpm --filter @workspace/discord-bot run typecheck
```