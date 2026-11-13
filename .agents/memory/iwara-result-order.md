---
name: IWARA result order
description: The Discord bot's expected cursor behavior when repeating the same search.
---

Repeated identical searches or sorted-feed commands should return each playable result on the current numbered IWARA page in order. Advance to the next numbered page only after exhausting the current page. Keep cursors separate by query and sort.

Each result also gets a refresh control that resolves a fresh signed URL for that same video. It must not advance the search cursor.

**Why:** The user clarified that returning only the first video from each page skips the other results on that page, and that expired proxy links need a way to be refreshed for the same video.

**How to apply:** Persist the request identity, current zero-based page, and next result index for each user's context. Skip private or unplayable items without advancing the page until that page has been exhausted. Refresh using the selected video's ID and resolve its current signed media URL again.
