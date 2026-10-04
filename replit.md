# Discord IWARA Video Bot

Discord bot that searches IWARA with `/embed video query:<words>` and replies with a video link served through the existing Cloudflare Worker.

## Run & Operate

- `pnpm --filter @workspace/discord-bot run dev` — run the Discord bot
- `pnpm --filter @workspace/discord-bot run typecheck` — type-check the bot
- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- Required secret: `DISCORD_BOT_TOKEN`
- Optional environment variable: `IWARA_PROXY_BASE_URL`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Bot: discord.js with a gateway connection and global slash-command registration
- IWARA lookup: public video search and detail endpoints
- Video preview: existing Cloudflare Worker; the bot passes through the signed URL without downloading the media

## Where things live

- `artifacts/discord-bot/src/iwara.ts` — IWARA search, detail lookup, and Worker-link construction
- `artifacts/discord-bot/src/index.ts` — Discord client and `/embed video` command
- `artifacts/discord-bot/README.md` — Discord application setup and run instructions

## Architecture decisions

- The bot runs as its own workflow, separate from the API server.
- Slash-command registration only creates `/embed` when it does not already exist; a conflicting command is left untouched.
- Signed URLs are passed through the Worker and are not logged or persisted.

## Product

- Search IWARA and post the first result as a Discord video preview through the existing Cloudflare Worker.

## User preferences

Keep the existing Cloudflare Worker behavior unchanged; its range streaming and Discord playback are already confirmed to work.

## Gotchas

- Discord global slash commands can take some time to become available after registration.
- Install the bot with both `bot` and `applications.commands` scopes and permission to send messages.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
