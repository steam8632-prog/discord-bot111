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
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
};

interface IwaraSearchItem {
  id: string;
  slug?: string | null;
  title: string;
}

interface IwaraSearchResponse {
  results: IwaraSearchItem[];
}

interface IwaraVideoDetails {
  id: string;
  slug?: string | null;
  title?: string;
  fileUrl?: string | null;
}

export interface IwaraVideoLink {
  title: string;
  sourceUrl: string;
  proxyUrl: string;
}

export class IwaraLookupError extends Error {
  constructor(message: string) {
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
    if (status === 403) {
      throw new IwaraLookupError("IWARA zablokovala API požiadavku (HTTP 403).");
    }
    throw new IwaraLookupError(
      `IWARA returned an error (HTTP ${status}).`,
    );
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new IwaraLookupError("IWARA returned an unreadable response.");
  }
}

function parseSearchResponse(payload: unknown): IwaraSearchResponse {
  if (!isRecord(payload) || !Array.isArray(payload["results"])) {
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
    });
  }

  return { results };
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

function getSignedVideoUrl(value: string | null | undefined): string {
  if (!value) {
    throw new IwaraLookupError(
      "The first result does not have a public video link.",
    );
  }

  let signedUrl: URL;
  try {
    signedUrl = new URL(value);
  } catch {
    throw new IwaraLookupError("IWARA returned an invalid video link.");
  }

  if (
    signedUrl.protocol !== "https:" ||
    !signedUrl.hostname.toLowerCase().endsWith(".iwara.tv")
  ) {
    throw new IwaraLookupError(
      "IWARA returned a video link from an unexpected host.",
    );
  }

  return signedUrl.toString();
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

export async function findFirstVideo(query: string): Promise<IwaraVideoLink | null> {
  const searchUrl = new URL("/videos", IWARA_API_BASE);
  searchUrl.searchParams.set("keyword", query);
  searchUrl.searchParams.set("sort", "relevance");
  searchUrl.searchParams.set("page", "0");
  searchUrl.searchParams.set("limit", "1");

  const search = parseSearchResponse(await fetchJson(searchUrl));
  const firstResult = search.results[0];
  if (!firstResult) {
    return null;
  }

  const detailUrl = new URL(
    `/video/${encodeURIComponent(firstResult.id)}`,
    IWARA_API_BASE,
  );
  const details = parseVideoDetails(await fetchJson(detailUrl));
  const signedUrl = getSignedVideoUrl(details.fileUrl);
  const id = details.id || firstResult.id;
  const title = details.title || firstResult.title;
  const slug = details.slug || firstResult.slug;

  return {
    title,
    sourceUrl: buildSourceUrl(id, slug),
    proxyUrl: buildProxyUrl(signedUrl),
  };
}