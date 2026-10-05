import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  Client,
  Events,
  GatewayIntentBits,
  type Message,
} from "discord.js";
import { findNextVideo, IwaraLookupError } from "./iwara.js";

const token = process.env["DISCORD_BOT_TOKEN"];
if (!token) {
  throw new Error("DISCORD_BOT_TOKEN is missing from Replit Secrets.");
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

interface SearchProgress {
  query: string;
  page: number;
  nextResultIndex: number;
  hasMoreResults: boolean;
  updatedAt: number;
}

const searchProgress = new Map<string, SearchProgress>();
const searchQueues = new Map<string, Promise<void>>();
const SEARCH_PROGRESS_TTL_MS = 60 * 60 * 1000;

function hasExpectedCommandShape(
  options: readonly {
    name: string;
    type: ApplicationCommandOptionType;
    options?: readonly {
      name: string;
      type: ApplicationCommandOptionType;
      required?: boolean;
    }[];
  }[],
): boolean {
  const videoOption = options.find(
    (option) =>
      option.name === "video" &&
      option.type === ApplicationCommandOptionType.Subcommand,
  );
  return Boolean(
    videoOption?.options?.some(
      (option) =>
        option.name === "query" &&
        option.type === ApplicationCommandOptionType.String &&
        option.required,
    ),
  );
}

async function removeLegacySlashCommand(
  readyClient: Client<true>,
): Promise<void> {
  const commands = await readyClient.application.commands.fetch();
  const existingEmbed = commands.find(
    (command) =>
      command.name === "embed" &&
      command.type === ApplicationCommandType.ChatInput,
  );

  if (existingEmbed) {
    if (hasExpectedCommandShape(existingEmbed.options)) {
      await readyClient.application.commands.delete(existingEmbed.id);
      console.info("Removed the old global /embed video slash command.");
      return;
    }

    console.info(
      "Found a different global /embed command and left it untouched.",
    );
    return;
  }

  console.info("No old global /embed video slash command was found.");
}

client.once(Events.ClientReady, (readyClient) => {
  console.info(`Connected to Discord as ${readyClient.user.tag}.`);
  void removeLegacySlashCommand(readyClient).catch(() => {
    console.error(
      "Could not remove the old slash command. Plain-text recognition is still active.",
    );
  });
});

function getEmbedVideoQuery(content: string): string | null {
  const match = content.trim().match(/^\/embed\s+video(?:\s+([\s\S]*))?$/i);
  if (!match) {
    return null;
  }

  let query = (match[1] ?? "").trim();
  if (query.startsWith("[") && query.endsWith("]")) {
    query = query.slice(1, -1).trim();
  }
  return query;
}

function normalizeSearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

function getSearchProgressKey(message: Message): string {
  return `${message.channelId}:${message.author.id}`;
}

function pruneExpiredSearchProgress(): void {
  const expiry = Date.now() - SEARCH_PROGRESS_TTL_MS;
  for (const [key, progress] of searchProgress) {
    if (progress.updatedAt < expiry) {
      searchProgress.delete(key);
    }
  }
}

async function runInSearchOrder(
  key: string,
  action: () => Promise<void>,
): Promise<void> {
  const previous = searchQueues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(action);
  searchQueues.set(key, current);

  try {
    await current;
  } finally {
    if (searchQueues.get(key) === current) {
      searchQueues.delete(key);
    }
  }
}

async function handleMessage(message: Message): Promise<void> {
  if (message.author.bot || message.webhookId || !message.inGuild()) {
    return;
  }

  const query = getEmbedVideoQuery(message.content);
  if (query === null) {
    return;
  }

  if (!query) {
    await message.reply({
      content: "Použi: `/embed video [vyhľadávanie]`.",
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }

  if (query.length > 100) {
    await message.reply({
      content: "Vyhľadávanie môže mať najviac 100 znakov.",
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }

  const reply = await message.reply({
    content: "Hľadám na IWARA…",
    allowedMentions: { parse: [], repliedUser: false },
  });

  const progressKey = getSearchProgressKey(message);
  const normalizedQuery = normalizeSearchQuery(query);

  await runInSearchOrder(progressKey, async () => {
    pruneExpiredSearchProgress();
    const previousProgress = searchProgress.get(progressKey);
    const sameQuery = previousProgress?.query === normalizedQuery;

    if (sameQuery && previousProgress && !previousProgress.hasMoreResults) {
      searchProgress.delete(progressKey);
      await reply.edit(
        "Prešiel som všetky výsledky tohto vyhľadávania. Ďalší príkaz začne znova od prvej.",
      );
      return;
    }

    if (!sameQuery) {
      searchProgress.delete(progressKey);
    }

    const page = sameQuery && previousProgress ? previousProgress.page : 0;
    const resultIndex =
      sameQuery && previousProgress
        ? previousProgress.nextResultIndex
        : 0;

    try {
      const {
        video,
        page: resultPage,
        nextResultIndex,
        hasMoreResults,
      } = await findNextVideo(query, page, resultIndex);

      if (video) {
        searchProgress.set(progressKey, {
          query: normalizedQuery,
          page: resultPage,
          nextResultIndex,
          hasMoreResults,
          updatedAt: Date.now(),
        });
        await reply.edit({
          content: video.proxyUrl,
          allowedMentions: { parse: [] },
        });
        return;
      }

      searchProgress.delete(progressKey);

      await reply.edit(
        sameQuery
          ? "Nenašiel som ďalšie verejne prehrateľné video v tomto vyhľadávaní."
          : "Nenašiel som verejne prehrateľné video v tomto vyhľadávaní.",
      );
    } catch (error) {
      if (error instanceof IwaraLookupError) {
        await reply.edit(error.message);
        return;
      }

      console.error("The IWARA video lookup failed.");
      await reply.edit("IWARA sa teraz nepodarilo načítať. Skús to o chvíľu.");
    }
  });
}

client.on(Events.MessageCreate, (message) => {
  void handleMessage(message).catch(() => {
    console.error("Could not handle a Discord message.");
  });
});

client.on(Events.Error, () => {
  console.error("The Discord gateway reported a client error.");
});

console.info("Starting the Discord IWARA text-command bot.");
void client.login(token).catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown Discord login error.";
  console.error(`Could not connect to Discord: ${message}`);
  process.exitCode = 1;
});