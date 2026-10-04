---
name: IWARA API transport
description: Cloudflare's anti-bot behavior differs between Node fetch and curl for the IWARA API.
---

IWARA API requests made with Node's built-in `fetch` can receive Cloudflare's HTTP 403 challenge page even when browser-like request headers are supplied. The system `curl` executable returned the expected JSON with the same headers in this environment.

**Why:** This distinguished the bot's API client from the separate Cloudflare video proxy, which already works and supports Discord's Range requests.

**How to apply:** Use `curl` through a subprocess argument array for IWARA API JSON requests; do not shell-interpolate user input, and do not log signed media URLs. Leave the existing Worker URL construction and Range behavior unchanged unless its own trace shows a failure.