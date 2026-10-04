# Discord IWARA video bot

The bot watches ordinary Discord messages for `/embed video [search words]`.
It searches IWARA, loads the first video's details, and posts the signed file
URL through the existing Cloudflare Worker. The bot does not download or store
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
6. Send a message such as `/embed video mmd` or `/embed video [mmd]`.

The bot does not register slash commands. On startup, it removes the matching
global `/embed video` slash command previously created by this bot, if present.
Other application commands are left unchanged.

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