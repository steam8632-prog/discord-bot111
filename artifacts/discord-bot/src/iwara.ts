import { execFile } from "node:child_process";
import { promisify } from "node:util";

const IWARA_API_BASE = "https://api.iwara.tv";
const IWARA_SITE_BASE = "https://www.iwara.tv";
const DEFAULT_PROXY_BASE = "https://iwara-proxy.steam8632.workers.dev";
const execFileAsync = promisify(execFile);

const API_HEADERS = {
  Accept: "application/json",
  Origin: IWARA_SITE_BASE,
  Referer: `${IWARA_SITE_BASE}/search`,
  "X-Site": new URL(IWARA_SITE_BASE).hostname,
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
};

interface IwaraSearchItem {
  id: string;
  slug?: string | null;
  title: string;
  private: boolean;
}

interface IwaraSearchResponse {
  results: IwaraSearchItem[];
  page: number;
  limit: number;
  count: number;
}

interface IwaraVideoDetails {
  id: string;
  slug?: string | null;
  title?: string;
  fileUrl?: string | null;
}

interface IwaraPlayableSource {
  name: string;
  viewUrl: string;
}

export interface IwaraVideoLink {
  videoId: string;
  title: string;
  sourceUrl: string;
  proxyUrl: string;
}

export interface IwaraVideoPageResult {
  video: IwaraVideoLink | null;
  page: number;
  nextResultIndex: number;
  hasMoreResults: boolean;
}

export class IwaraLookupError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "IwaraLookupError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function fetchJson(url: URL): Promise<unknown> {
  let output: string;
  try {
    const result = await execFileAsync(
      "curl",
      [
        "--silent",
        "--show-error",
        "--connect-timeout",
        "5",
        "--max-time",
        "12",
        "--user-agent",
        API_HEADERS["User-Agent"],
        "--header",
        `Accept: ${API_HEADERS.Accept}`,
        "--header",
        `Origin: ${API_HEADERS.Origin}`,
        "--header",
        `Referer: ${API_HEADERS.Referer}`,
        "--header",
        `X-Site: ${API_HEADERS["X-Site"]}`,
        "--write-out",
        "\n__IWARA_HTTP_STATUS__:%{http_code}",
        "--url",
        url.toString(),
      ],
      {
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    output = result.stdout;
  } catch {
    throw new IwaraLookupError("IWARA is not responding right now.");
  }

  const statusMatch = output.match(/\n__IWARA_HTTP_STATUS__:(\d{3})\s*$/);
  if (!statusMatch || statusMatch.index === undefined) {
    throw new IwaraLookupError("IWARA returned an unreadable response.");
  }

  const status = Number(statusMatch[1]);
  const body = output.slice(0, statusMatch.index);
  if (status < 200 || status >= 300) {
    let code: string | undefined;
    try {
      const payload: unknown = JSON.parse(body);
      if (isRecord(payload) && typeof payload["message"] === "string") {
        code = payload["message"];
      }
    } catch {
      // The response can be an HTML challenge page rather than JSON.
    }

    if (code === "errors.privateVideo") {
      throw new IwaraLookupError("IWARA result is private.", code);
    }
    if (status === 403) {
      throw new IwaraLookupError(
        "IWARA zablokovala API požiadavku (HTTP 403).",
        code,
      );
    }
    throw new IwaraLookupError(
      `IWARA returned an error (HTTP ${status}).`,
      code,
    );
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new IwaraLookupError("IWARA returned an unreadable response.");
  }
}

function parseSearchResponse(payload: unknown): IwaraSearchResponse {
  if (
    !isRecord(payload) ||
    !Array.isArray(payload["results"]) ||
    !Number.isInteger(payload["page"]) ||
    !Number.isInteger(payload["limit"]) ||
    !Number.isInteger(payload["count"]) ||
    (payload["page"] as number) < 0 ||
    (payload["limit"] as number) <= 0 ||
    (payload["count"] as number) < 0
  ) {
    throw new IwaraLookupError("IWARA returned an unexpected search response.");
  }

  const results: IwaraSearchItem[] = [];
  for (const entry of payload["results"]) {
    if (
      !isRecord(entry) ||
      typeof entry["id"] !== "string" ||
      typeof entry["title"] !== "string"
    ) {
      continue;
    }

    results.push({
      id: entry["id"],
      title: entry["title"],
      slug: typeof entry["slug"] === "string" ? entry["slug"] : null,
      private: entry["private"] === true,
    });
  }

  return {
    results,
    page: payload["page"] as number,
    limit: payload["limit"] as number,
    count: payload["count"] as number,
  };
}

function parseVideoDetails(payload: unknown): IwaraVideoDetails {
  if (
    !isRecord(payload) ||
    typeof payload["id"] !== "string" ||
    (typeof payload["fileUrl"] !== "string" &&
      payload["fileUrl"] !== null &&
      payload["fileUrl"] !== undefined)
  ) {
    throw new IwaraLookupError("IWARA returned unexpected video details.");
  }

  return {
    id: payload["id"],
    title: typeof payload["title"] === "string" ? payload["title"] : undefined,
    slug: typeof payload["slug"] === "string" ? payload["slug"] : null,
    fileUrl:
      typeof payload["fileUrl"] === "string" ? payload["fileUrl"] : null,
  };
}

function parsePlayableSources(payload: unknown): IwaraPlayableSource[] {
  if (!Array.isArray(payload)) {
    throw new IwaraLookupError("IWARA returned unexpected video sources.");
  }

  return payload.flatMap((entry): IwaraPlayableSource[] => {
    if (!isRecord(entry) || !isRecord(entry["src"])) {
      return [];
    }

    const viewUrl = entry["src"]["view"];
    if (typeof viewUrl !== "string") {
      return [];
    }

    return [
      {
        name: typeof entry["name"] === "string" ? entry["name"] : "",
        viewUrl,
      },
    ];
  });
}

function getSourcePriority(name: string): number {
  const normalized = name.trim().toLowerCase();
  if (normalized === "source") {
    return 0;
  }

  const resolution = normalized.match(/(\d{3,4})p?/);
  if (resolution) {
    return 10_000 - Number(resolution[1]);
  }

  return normalized.includes("preview") ? 20_000 : 15_000;
}

function validateIwaraUrl(url: URL): URL {
  if (
    url.protocol !== "https:" ||
    !url.hostname.toLowerCase().endsWith(".iwara.tv")
  ) {
    throw new IwaraLookupError(
      "IWARA returned a video link from an unexpected host.",
    );
  }
  return url;
}

async function getSignedVideoUrl(
  value: string | null | undefined,
  fetchJsonForLookup: (url: URL) => Promise<unknown> = fetchJson,
): Promise<string> {
  if (!value) {
    throw new IwaraLookupError(
      "The first result does not have a public video link.",
    );
  }

  let fileUrl: URL;
  try {
    fileUrl = validateIwaraUrl(new URL(value, IWARA_SITE_BASE));
  } catch {
    throw new IwaraLookupError("IWARA returned an invalid video link.");
  }

  if (fileUrl.pathname !== "/file" && !fileUrl.pathname.startsWith("/file/")) {
    return fileUrl.toString();
  }

  const sources = parsePlayableSources(await fetchJsonForLookup(fileUrl));
  const selectedSource = sources
    .sort((left, right) => getSourcePriority(left.name) - getSourcePriority(right.name))[0];

  if (!selectedSource) {
    throw new IwaraLookupError(
      "IWARA did not provide a playable source for this video.",
    );
  }

  try {
    return validateIwaraUrl(
      new URL(selectedSource.viewUrl, IWARA_SITE_BASE),
    ).toString();
  } catch {
    throw new IwaraLookupError("IWARA returned an invalid video link.");
  }
}

function buildProxyUrl(signedUrl: string): string {
  const proxyBase = process.env["IWARA_PROXY_BASE_URL"] ?? DEFAULT_PROXY_BASE;
  let proxyUrl: URL;
  try {
    proxyUrl = new URL(proxyBase);
  } catch {
    throw new IwaraLookupError("The configured video proxy URL is invalid.");
  }

  if (proxyUrl.protocol !== "https:") {
    throw new IwaraLookupError("The video proxy URL must use HTTPS.");
  }

  proxyUrl.pathname = "/video.mp4";
  proxyUrl.search = "";
  proxyUrl.hash = "";
  proxyUrl.searchParams.set("url", signedUrl);
  return proxyUrl.toString();
}

function buildSourceUrl(id: string, slug?: string | null): string {
  const suffix = slug ? `/${encodeURIComponent(slug)}` : "";
  return `${IWARA_SITE_BASE}/video/${encodeURIComponent(id)}${suffix}`;
}

async function resolveVideoLink(
  videoId: string,
  fallbackTitle?: string,
  fallbackSlug?: string | null,
  fetchJsonForLookup: (url: URL) => Promise<unknown> = fetchJson,
): Promise<IwaraVideoLink> {
  const detailUrl = new URL(
    `/video/${encodeURIComponent(videoId)}`,
    IWARA_API_BASE,
  );
  const details = parseVideoDetails(await fetchJsonForLookup(detailUrl));
  const signedUrl = await getSignedVideoUrl(
    details.fileUrl,
    fetchJsonForLookup,
  );
  const id = details.id || videoId;
  const title = details.title || fallbackTitle || "";
  const slug = details.slug || fallbackSlug;

  return {
    videoId: id,
    title,
    sourceUrl: buildSourceUrl(id, slug),
    proxyUrl: buildProxyUrl(signedUrl),
  };
}

export async function refreshVideoLink(
  videoId: string,
  fetchJsonForLookup: (url: URL) => Promise<unknown> = fetchJson,
): Promise<IwaraVideoLink> {
  if (!videoId || videoId.length > 80) {
    throw new IwaraLookupError("Invalid IWARA video ID.");
  }

  return resolveVideoLink(videoId, undefined, null, fetchJsonForLookup);
}

export async function findNextVideo(
  query: string,
  page: number,
  resultIndex: number,
  fetchJsonForLookup: (url: URL) => Promise<unknown> = fetchJson,
): Promise<IwaraVideoPageResult> {
  if (
    !Number.isInteger(page) ||
    page < 0 ||
    !Number.isInteger(resultIndex) ||
    resultIndex < 0
  ) {
    throw new IwaraLookupError("Invalid IWARA search page.");
  }

  let currentPage = page;
  let currentResultIndex = resultIndex;

  while (true) {
    const searchUrl = new URL("/search", IWARA_API_BASE);
    searchUrl.searchParams.set("query", query);
    searchUrl.searchParams.set("type", "videos");
    searchUrl.searchParams.set("sort", "relevance");
    searchUrl.searchParams.set("page", String(currentPage));
    searchUrl.searchParams.set("limit", "32");

    const search = parseSearchResponse(await fetchJsonForLookup(searchUrl));
    if (search.page !== currentPage) {
      throw new IwaraLookupError("IWARA returned an unexpected search page.");
    }

    const hasNextPage =
      (search.page + 1) * search.limit < search.count;

    for (
      let index = currentResultIndex;
      index < search.results.length;
      index += 1
    ) {
      const result = search.results[index];
      if (!result || result.private) {
        continue;
      }

      try {
        const video = await resolveVideoLink(
          result.id,
          result.title,
          result.slug,
          fetchJsonForLookup,
        );
        const nextResultIndex = index + 1;

        return {
          video,
          page: currentPage,
          nextResultIndex,
          hasMoreResults:
            nextResultIndex < search.results.length || hasNextPage,
        };
      } catch (error) {
        if (
          error instanceof IwaraLookupError &&
          error.code === "errors.privateVideo"
        ) {
          continue;
        }
        throw error;
      }
    }

    if (!hasNextPage) {
      return {
        video: null,
        page: currentPage,
        nextResultIndex: search.results.length,
        hasMoreResults: false,
      };
    }

    currentPage += 1;
    currentResultIndex = 0;
  }
}