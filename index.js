const { Client, Events, GatewayIntentBits } = require("discord.js");
// Use .env to store environment variables
require("dotenv").config();
const commandHandler = require("./commands");

// Create a new client instance
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

// When the client is ready, run this code (only once).
// The distinction between `client: Client<boolean>` and `readyClient: Client<true>` is important for TypeScript developers.
// It makes some properties non-nullable.
client.once(Events.ClientReady, (readyClient) => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

// Bot Leaves Voice Channel when it's left alone
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    // Get the voice channel the bot is in
    const voiceChannel = oldState.channel || newState.channel;

    // If no channel involved, exit early
    if (!voiceChannel) return;

    // Check if the bot is in the channel
    const botMember = voiceChannel.members.get(client.user.id);
    if (!botMember) return;

    // Count non-bot members in the channel
    const nonBotMembers = voiceChannel.members.filter(
        (member) => !member.user.bot
    );

    if (nonBotMembers.size === 0) {
        // No human users left — bot should leave
        const connection = require("@discordjs/voice").getVoiceConnection(
            voiceChannel.guild.id
        );
        if (connection) {
            connection.destroy();
            console.log(`👋 Left ${voiceChannel.name} because bot was alone.`);
        }
    }
});

client.on("messageCreate", (message) => {
    commandHandler(client, message);
});

// Log in to Discord with your client's token
client.login(process.env.BOT_TOKEN);
