# Discord IWARA video bot

The bot adds the global `/embed video query:<search words>` slash command. It
searches IWARA, loads the first video's details, and posts the signed file URL
through the existing Cloudflare Worker. The bot does not download or store video
files.

## Setup

1. In Discord Developer Portal, create or select the bot application and add a
   bot user.
2. Add its bot token to this Replit project's Secrets as `DISCORD_BOT_TOKEN`.
   Never put the token in chat or source files.
3. In the Developer Portal's Installation settings, enable the `bot` and
   `applications.commands` scopes. Grant the bot permission to send messages,
   then install it in the target server.
4. Start the `Discord IWARA Bot` workflow in Replit.
5. Use `/embed video` and enter a search phrase in `query`.

The bot registers one global command and does not overwrite other commands. If
the application already has a different global `/embed` command, the bot leaves
it untouched and reports the conflict in its workflow log. New global commands
can take some time to appear in Discord.

## Configuration

- Required secret: `DISCORD_BOT_TOKEN`
- Optional environment variable: `IWARA_PROXY_BASE_URL` (defaults to
  `https://iwara-proxy.steam8632.workers.dev`)

Search queries and signed IWARA URLs are not written to logs. Signed URLs are
short-lived and should not be shared separately from the proxy link.

## Run locally

```sh
pnpm --filter @workspace/discord-bot run dev
```

Type-check the bot with:

```sh
pnpm --filter @workspace/discord-bot run typecheck
```