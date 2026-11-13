import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ApplicationCommandType,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type ButtonInteraction,
  type Message,
} from "discord.js";
import {
  findNextVideo,
  IwaraLookupError,
  refreshVideoLink,
} from "./iwara.js";
import { getEmbedRequestKey, parseEmbedCommand } from "./commands.js";

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
  requestKey: string;
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

function buildRefreshCustomId(videoId: string, userId: string): string {
  const customId = `iwara:refresh:${encodeURIComponent(videoId)}:${userId}`;
  if (customId.length > 100) {
    throw new Error("The IWARA video ID is too long for a refresh button.");
  }
  return customId;
}

function parseRefreshCustomId(
  customId: string,
): { videoId: string; userId: string } | null {
  const match = customId.match(/^iwara:refresh:([^:]+):(\d+)$/);
  if (!match?.[1] || !match[2]) {
    return null;
  }

  try {
    return {
      videoId: decodeURIComponent(match[1]),
      userId: match[2],
    };
  } catch {
    return null;
  }
}

async function sendRefreshButton(
  message: Message,
  videoId: string,
): Promise<void> {
  try {
    const button = new ButtonBuilder()
      .setCustomId(buildRefreshCustomId(videoId, message.author.id))
      .setLabel("Refresh")
      .setStyle(ButtonStyle.Secondary);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);
    const channel = message.channel;
    if (!("send" in channel) || typeof channel.send !== "function") {
      console.error("Could not send the IWARA refresh button.");
      return;
    }

    await channel.send({
      content: "Obnoviť odkaz na toto video:",
      components: [row],
      allowedMentions: { parse: [] },
    });
  } catch {
    console.error("Could not send the IWARA refresh button.");
  }
}

async function handleRefreshButton(
  interaction: ButtonInteraction,
  videoId: string,
  ownerId: string,
): Promise<void> {
  if (interaction.user.id !== ownerId) {
    await interaction.reply({
      content: "Toto tlačidlo môže použiť iba autor pôvodného vyhľadávania.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply();
  try {
    const video = await refreshVideoLink(videoId);
    await interaction.editReply({
      content: video.proxyUrl,
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    if (error instanceof IwaraLookupError) {
      await interaction.editReply(error.message);
      return;
    }

    console.error("Could not refresh the IWARA video link.");
    await interaction.editReply("IWARA sa teraz nepodarilo načítať. Skús to o chvíľu.");
  }
}

async function handleMessage(message: Message): Promise<void> {
  if (message.author.bot || message.webhookId || !message.inGuild()) {
    return;
  }

  const request = parseEmbedCommand(message.content);
  if (!request) {
    return;
  }

  if (request.kind === "search" && !request.query) {
    await message.reply({
      content:
        "Použi: `/embed video [vyhľadávanie] [relevance|recent|views|likes]`, `/embed trending` alebo `/embed popularity`.",
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }

  if (request.kind === "search" && request.query.length > 100) {
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
  const requestKey = getEmbedRequestKey(request);

  await runInSearchOrder(progressKey, async () => {
    pruneExpiredSearchProgress();
    const previousProgress = searchProgress.get(progressKey);
    const sameRequest = previousProgress?.requestKey === requestKey;

    if (sameRequest && previousProgress && !previousProgress.hasMoreResults) {
      searchProgress.delete(progressKey);
      await reply.edit(
        "Prešiel som všetky výsledky. Ďalší príkaz začne znova od prvej.",
      );
      return;
    }

    if (!sameRequest) {
      searchProgress.delete(progressKey);
    }

    const page = sameRequest && previousProgress ? previousProgress.page : 0;
    const resultIndex =
      sameRequest && previousProgress
        ? previousProgress.nextResultIndex
        : 0;

    try {
      const {
        video,
        page: resultPage,
        nextResultIndex,
        hasMoreResults,
      } = await findNextVideo(request, page, resultIndex);

      if (video) {
        searchProgress.set(progressKey, {
          requestKey,
          page: resultPage,
          nextResultIndex,
          hasMoreResults,
          updatedAt: Date.now(),
        });
        await reply.edit({
          content: video.proxyUrl,
          allowedMentions: { parse: [] },
        });
        await sendRefreshButton(message, video.videoId);
        return;
      }

      searchProgress.delete(progressKey);

      await reply.edit(
        sameRequest
          ? "Nenašiel som ďalšie verejne prehrateľné video v tomto zozname."
          : "Nenašiel som verejne prehrateľné video v tomto zozname.",
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

client.on(Events.InteractionCreate, (interaction) => {
  if (!interaction.isButton()) {
    return;
  }

  const refresh = parseRefreshCustomId(interaction.customId);
  if (!refresh) {
    return;
  }

  void handleRefreshButton(
    interaction,
    refresh.videoId,
    refresh.userId,
  ).catch(() => {
    console.error("Could not handle an IWARA refresh interaction.");
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