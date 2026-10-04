import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  Client,
  Events,
  GatewayIntentBits,
  type Message,
} from "discord.js";
import { findFirstVideo, IwaraLookupError } from "./iwara.js";

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
    content: "Hľadám prvý výsledok na IWARA…",
    allowedMentions: { parse: [], repliedUser: false },
  });

  try {
    const video = await findFirstVideo(query);
    if (!video) {
      await reply.edit("Nenašiel som video zodpovedajúce vyhľadávaniu.");
      return;
    }

    const safeTitle = video.title
      .replace(/([\\_*~`|])/g, "\\$1")
      .slice(0, 180);

    await reply.edit({
      content: `**${safeTitle}**\n${video.proxyUrl}\nSource: <${video.sourceUrl}>`,
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    if (error instanceof IwaraLookupError) {
      await reply.edit(error.message);
      return;
    }

    console.error("The IWARA video lookup failed.");
    await reply.edit("IWARA sa teraz nepodarilo načítať. Skús to o chvíľu.");
  }
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