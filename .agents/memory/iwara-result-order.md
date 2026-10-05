---
name: IWARA result order
description: The Discord bot's expected cursor behavior when repeating the same search.
---

Repeated identical searches should return each playable result on the current numbered IWARA page in order. Advance to the next numbered page only after exhausting the current page.

**Why:** The user clarified that returning only the first video from each page skips the other results on that page.

**How to apply:** Persist both the current zero-based page and the next result index for each user's search context. Skip private or unplayable items without advancing the page until that page has been exhausted.
