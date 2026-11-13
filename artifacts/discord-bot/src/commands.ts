import type {
  IwaraSearchSort,
  IwaraVideoRequest,
} from "./iwara.js";

const SEARCH_SORTS: Record<string, IwaraSearchSort> = {
  relevance: "relevance",
  recent: "date",
  views: "views",
  likes: "likes",
};

function getSearchSort(filter: string | undefined): IwaraSearchSort | undefined {
  const normalized = filter?.match(/^\[([^\]]+)\]$/)?.[1] ?? filter;
  return normalized ? SEARCH_SORTS[normalized.toLowerCase()] : undefined;
}

function parseVideoSearch(argumentsText: string): IwaraVideoRequest {
  let query = argumentsText.trim();
  let sort: IwaraSearchSort = "relevance";
  const bracketed = query.match(/^\[([\s\S]*?)\](?:\s+(\S+))?$/);

  if (bracketed) {
    query = bracketed[1]?.trim() ?? "";
    const filterSort = getSearchSort(bracketed[2]);
    if (filterSort) {
      sort = filterSort;
    } else if (bracketed[2]) {
      query = `${query} ${bracketed[2]}`.trim();
    }
    return { kind: "search", query, sort };
  }

  const words = query.split(/\s+/);
  const filterSort = getSearchSort(words.at(-1));
  if (filterSort) {
    sort = filterSort;
    words.pop();
    query = words.join(" ");
  }

  return { kind: "search", query, sort };
}

export function parseEmbedCommand(content: string): IwaraVideoRequest | null {
  const match = content
    .trim()
    .match(/^\/embed\s+(video|trending|popularity)(?:\s+([\s\S]*))?$/i);
  if (!match?.[1]) {
    return null;
  }

  const command = match[1].toLowerCase();
  const argumentsText = (match[2] ?? "").trim();

  if (command === "trending" || command === "popularity") {
    if (argumentsText) {
      return null;
    }
    return { kind: "feed", sort: command };
  }

  return parseVideoSearch(argumentsText);
}

export function getEmbedRequestKey(request: IwaraVideoRequest): string {
  if (request.kind === "feed") {
    return `feed:${request.sort}`;
  }

  const normalizedQuery = request.query.trim().replace(/\s+/g, " ").toLowerCase();
  return `search:${request.sort}:${normalizedQuery}`;
}
