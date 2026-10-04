# Discord IWARA Video Bot

Discord bot that recognizes the plain-text message `/embed video [words]`, searches IWARA, and replies with a video link served through the existing Cloudflare Worker.

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
- Bot: discord.js with a gateway connection and plain-text message recognition
- IWARA lookup: public video search and detail endpoints
- Video preview: existing Cloudflare Worker; the bot passes through the signed URL without downloading the media

## Where things live

- `artifacts/discord-bot/src/iwara.ts` — IWARA search, detail lookup, and Worker-link construction
- `artifacts/discord-bot/src/index.ts` — Discord client and plain-text command handler
- `artifacts/discord-bot/README.md` — Discord application setup and run instructions

## Architecture decisions

- The bot runs as its own workflow, separate from the API server.
- Do not register slash commands; the bot recognizes ordinary message text only.
- Discord's Message Content privileged intent must be enabled for the bot application.
- Use `curl` for IWARA API requests; Node's built-in `fetch` receives a Cloudflare challenge (HTTP 403) in this environment.
- Match the site's search field with `GET /search?query=<text>&type=videos`, not `/videos?keyword=<text>`.
- IWARA's `fileUrl` can be a `/file/<id>` resolver returning quality options; use its signed `src.view` URL for the Worker, not the resolver URL.
- Signed URLs are passed through the Worker and are not logged or persisted.

## Product

- Repeated identical searches by the same person in the same channel advance one IWARA results page at a time; a new query starts at page one. Skip private videos and post only the first playable result's Worker link.

## User preferences

Keep the existing Cloudflare Worker behavior unchanged; its range streaming and Discord playback are already confirmed to work. Use a plain-text Discord message, never a slash command. Post only the proxy URL in Discord, with no title or source link.

## Gotchas

- Enable Discord's Message Content Intent in the Developer Portal or the bot cannot see message text.
- Install the bot with the `bot` scope and permission to view channels and send messages.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
