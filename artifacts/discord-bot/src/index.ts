import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  Client,
  Events,
  GatewayIntentBits,
  SlashCommandBuilder,
} from "discord.js";
import { findFirstVideo, IwaraLookupError } from "./iwara.js";

const token = process.env["DISCORD_BOT_TOKEN"];
if (!token) {
  throw new Error("DISCORD_BOT_TOKEN is missing from Replit Secrets.");
}

const commandData = new SlashCommandBuilder()
  .setName("embed")
  .setDescription("Find an IWARA video and post its video-proxy link")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("video")
      .setDescription("Search IWARA and post the first result")
      .addStringOption((option) =>
        option
          .setName("query")
          .setDescription("What video should IWARA search for?")
          .setRequired(true)
          .setMaxLength(100),
      ),
  );

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
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

async function registerSlashCommand(readyClient: Client<true>): Promise<void> {
  const commands = await readyClient.application.commands.fetch();
  const existingEmbed = commands.find(
    (command) =>
      command.name === "embed" &&
      command.type === ApplicationCommandType.ChatInput,
  );

  if (existingEmbed) {
    if (hasExpectedCommandShape(existingEmbed.options)) {
      console.info("The /embed video command is already registered.");
      return;
    }

    throw new Error(
      "A different global /embed command already exists. It was left untouched; rename or adjust that command before starting this bot.",
    );
  }

  await readyClient.application.commands.create(commandData);
  console.info("Registered the global /embed video slash command.");
}

client.once(Events.ClientReady, (readyClient) => {
  console.info(`Connected to Discord as ${readyClient.user.tag}.`);
  void registerSlashCommand(readyClient).catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Unknown registration error.";
    console.error(`Could not register /embed video: ${message}`);
    process.exitCode = 1;
    readyClient.destroy();
  });
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (
    !interaction.isChatInputCommand() ||
    interaction.commandName !== "embed" ||
    interaction.options.getSubcommand() !== "video"
  ) {
    return;
  }

  const query = interaction.options.getString("query", true).trim();
  if (!query) {
    await interaction.reply({
      content: "Add search words after `/embed video`.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  try {
    const video = await findFirstVideo(query);
    if (!video) {
      await interaction.editReply("No IWARA videos matched that search.");
      return;
    }

    const safeTitle = video.title
      .replace(/([\\_*~`|])/g, "\\$1")
      .slice(0, 180);

    await interaction.editReply({
      content: `**${safeTitle}**\n${video.proxyUrl}\nSource: <${video.sourceUrl}>`,
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    if (error instanceof IwaraLookupError) {
      await interaction.editReply(error.message);
      return;
    }

    console.error("The IWARA video lookup failed.");
    await interaction.editReply(
      "I couldn't fetch a video just now. Please try again in a moment.",
    );
  }
});

client.on(Events.Error, () => {
  console.error("The Discord gateway reported a client error.");
});

console.info("Starting the Discord IWARA video bot.");
void client.login(token).catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown Discord login error.";
  console.error(`Could not connect to Discord: ${message}`);
  process.exitCode = 1;
});