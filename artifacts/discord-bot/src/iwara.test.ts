import assert from "node:assert/strict";
import test from "node:test";
import { findNextVideo, refreshVideoLink } from "./iwara.js";

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
  const fetchJsonForLookup = async (url: URL): Promise<unknown> => {
    if (url.pathname === "/search") {
      const page = Number(url.searchParams.get("page"));
      requestedPages.push(page);
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

  const first = await findNextVideo("test", 0, 0, fetchJsonForLookup);
  const second = await findNextVideo(
    "test",
    first.page,
    first.nextResultIndex,
    fetchJsonForLookup,
  );
  const third = await findNextVideo(
    "test",
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
