---
name: IWARA API and media URL resolution
description: IWARA blocks Node fetch and returns a resolver endpoint instead of a playable video URL.
---

IWARA API requests made with Node's built-in `fetch` can receive Cloudflare's HTTP 403 challenge page even when browser-like request headers are supplied. The system `curl` executable returned the expected JSON with the same headers in this environment.

The site's Videos search uses `GET /search` with `query=<text>` and `type=videos`; `/videos?keyword=...` is not equivalent to the search box and can return unrelated results.

Search results can include private videos before playable ones. Skip entries marked private, and continue past detail responses with `errors.privateVideo` while preserving the site's relevance order.

The video's `fileUrl` may point to `files*.iwara.tv/file/<id>`. That endpoint returns a list of quality options with playable URLs in `src.view`; it is not itself a video stream. The playable `src.view` URLs use `/view` and carry signed query parameters. Choose the best available quality and pass that URL through the Worker.

**Why:** This distinguished the bot's API client from the separate Cloudflare video proxy, which already works and supports Discord's Range requests.

**How to apply:** Use `curl` through a subprocess argument array for IWARA API JSON requests; do not shell-interpolate user input, and do not log signed media URLs. Wrap the resolved `/view` URL—not the `/file/<id>` resolver—in the Worker URL. Leave the existing Worker Range behavior unchanged unless its own trace shows a failure.