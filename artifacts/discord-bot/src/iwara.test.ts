import assert from "node:assert/strict";
import test from "node:test";
import { getEmbedRequestKey, parseEmbedCommand } from "./commands.js";
import { findNextVideo, refreshVideoLink } from "./iwara.js";

test("parses feed commands and short search sort aliases", () => {
  assert.deepEqual(parseEmbedCommand("/embed trending"), {
    kind: "feed",
    sort: "trending",
  });
  assert.deepEqual(parseEmbedCommand("/embed popularity"), {
    kind: "feed",
    sort: "popularity",
  });
  assert.deepEqual(parseEmbedCommand("/embed video wuwa"), {
    kind: "search",
    query: "wuwa",
    sort: "relevance",
  });
  assert.deepEqual(parseEmbedCommand("/embed video wuwa recent"), {
    kind: "search",
    query: "wuwa",
    sort: "date",
  });
  assert.deepEqual(parseEmbedCommand("/embed video [wuwa] views"), {
    kind: "search",
    query: "wuwa",
    sort: "views",
  });
  assert.deepEqual(parseEmbedCommand("/embed video [wuwa] [recent]"), {
    kind: "search",
    query: "wuwa",
    sort: "date",
  });
  assert.deepEqual(parseEmbedCommand("/embed video wuwa [likes]"), {
    kind: "search",
    query: "wuwa",
    sort: "likes",
  });
  assert.deepEqual(parseEmbedCommand("/embed video wuwa likes"), {
    kind: "search",
    query: "wuwa",
    sort: "likes",
  });
  assert.equal(
    getEmbedRequestKey(parseEmbedCommand("/embed video wuwa recent")!),
    "search:date:wuwa",
  );
  assert.equal(parseEmbedCommand("/embed other"), null);
});

test("returns each result on a page before advancing to the next page", async () => {
  const pages = [
    {
      results: [
        { id: "private", title: "Private result", private: true },
        { id: "first", title: "First video" },
        { id: "second", title: "Second video" },
      ],
      page: 0,
      limit: 3,
      count: 6,
    },
    {
      results: [{ id: "third", title: "Third video" }],
      page: 1,
      limit: 3,
      count: 6,
    },
  ];
  const requestedPages: number[] = [];
  const requestedSorts: string[] = [];
  const fetchJsonForLookup = async (url: URL): Promise<unknown> => {
    if (url.pathname === "/search") {
      const page = Number(url.searchParams.get("page"));
      requestedPages.push(page);
      requestedSorts.push(url.searchParams.get("sort") ?? "");
      return pages[page];
    }

    const id = url.pathname.split("/").at(-1);
    if (!id) {
      throw new Error("Expected a video ID.");
    }
    return {
      id,
      title: `${id} video`,
      fileUrl: `https://files.iwara.tv/${id}.mp4`,
    };
  };

  const request = { kind: "search", query: "test", sort: "views" } as const;
  const first = await findNextVideo(request, 0, 0, fetchJsonForLookup);
  const second = await findNextVideo(
    request,
    first.page,
    first.nextResultIndex,
    fetchJsonForLookup,
  );
  const third = await findNextVideo(
    request,
    second.page,
    second.nextResultIndex,
    fetchJsonForLookup,
  );

  assert.equal(first.video?.sourceUrl.includes("/video/first"), true);
  assert.equal(first.page, 0);
  assert.equal(first.nextResultIndex, 2);
  assert.equal(first.hasMoreResults, true);

  assert.equal(second.video?.sourceUrl.includes("/video/second"), true);
  assert.equal(second.page, 0);
  assert.equal(second.nextResultIndex, 3);
  assert.equal(second.hasMoreResults, true);

  assert.equal(third.video?.sourceUrl.includes("/video/third"), true);
  assert.equal(third.page, 1);
  assert.equal(third.nextResultIndex, 1);
  assert.equal(third.hasMoreResults, false);
  assert.deepEqual(requestedPages, [0, 0, 0, 1]);
  assert.deepEqual(requestedSorts, ["views", "views", "views", "views"]);
});

test("loads trending and popularity from the IWARA videos feed", async () => {
  for (const sort of ["trending", "popularity"] as const) {
    const requestedUrls: URL[] = [];
    const fetchJsonForLookup = async (url: URL): Promise<unknown> => {
      if (url.pathname === "/videos") {
        requestedUrls.push(url);
        return {
          results: [{ id: `video-${sort}`, title: `${sort} video` }],
          page: 0,
          limit: 32,
          count: 1,
        };
      }

      const id = url.pathname.split("/").at(-1);
      if (!id) {
        throw new Error("Expected a video ID.");
      }
      return {
        id,
        title: `${sort} video`,
        fileUrl: `https://files.iwara.tv/${id}.mp4`,
      };
    };

    const result = await findNextVideo(
      { kind: "feed", sort },
      0,
      0,
      fetchJsonForLookup,
    );

    const requestedUrl = requestedUrls[0];
    assert.equal(result.video?.videoId, `video-${sort}`);
    assert.ok(requestedUrl);
    assert.equal(requestedUrl.pathname, "/videos");
    assert.equal(requestedUrl.searchParams.get("sort"), sort);
    assert.equal(requestedUrl.searchParams.has("query"), false);
  }
});

test("refreshes the same video with a newly resolved proxy URL", async () => {
  let tokenNumber = 0;
  const requestedVideoIds: string[] = [];
  const fetchJsonForLookup = async (url: URL): Promise<unknown> => {
    if (url.pathname.startsWith("/video/")) {
      const id = url.pathname.split("/").at(-1);
      if (!id) {
        throw new Error("Expected a video ID.");
      }
      requestedVideoIds.push(id);
      return {
        id,
        title: "Same video",
        fileUrl: `https://files.iwara.tv/file/${id}`,
      };
    }

    if (url.pathname.startsWith("/file/")) {
      tokenNumber += 1;
      return [
        {
          name: "720p",
          src: {
            view: `https://files.iwara.tv/view/same-video.mp4?token=${tokenNumber}`,
          },
        },
      ];
    }

    throw new Error(`Unexpected IWARA path: ${url.pathname}`);
  };

  const first = await refreshVideoLink("same-video", fetchJsonForLookup);
  const second = await refreshVideoLink("same-video", fetchJsonForLookup);

  assert.equal(first.videoId, "same-video");
  assert.equal(second.videoId, "same-video");
  assert.deepEqual(requestedVideoIds, ["same-video", "same-video"]);
  assert.equal(
    new URL(first.proxyUrl).searchParams.get("url"),
    "https://files.iwara.tv/view/same-video.mp4?token=1",
  );
  assert.equal(
    new URL(second.proxyUrl).searchParams.get("url"),
    "https://files.iwara.tv/view/same-video.mp4?token=2",
  );
});
