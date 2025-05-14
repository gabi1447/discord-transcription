const {
    joinVoiceChannel,
    EndBehaviorType,
    entersState,
    VoiceConnectionStatus,
} = require("@discordjs/voice");
const { opus } = require("prism-media");
const { Transform } = require("stream");
const WebSocket = require("ws");
const waveResampler = require("wave-resampler");

// WebSocket URL
const wsUrl = "ws://localhost:8000/transcribe";

let webSocketConnections = {};

module.exports = async function execute(client, interaction) {
    const voiceChannel = interaction.member.voice.channel;
    let connection;

    let pcm_48 = 0;
    let pcm_16 = 0;

    if (!voiceChannel) {
        return interaction.channel.send(
            "❌ You must be in a voice channel first."
        );
    } else {
        try {
            // Join the voice channel
            connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: interaction.guild.id,
                adapterCreator: interaction.guild.voiceAdapterCreator,
                selfDeaf: false, // set to true if bot shouldn't hear audio
            });

            // Wait until bot joins voice channel
            await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
            interaction.channel.send(`✅ Joined **${voiceChannel.name}**!`);
        } catch (error) {
            console.error(error);
            await interaction.channel.send(
                "❌ Failed to join the voice channel."
            );
        }
    }

    // Set up audio receiver
    const receiver = connection.receiver;

    // Subscribe to receiver when users speak
    receiver.speaking.on("start", (userId) => {
        // Establish websocket connection for user once they start speaking only if they don't have one already
        /* if (!webSocketConnections[userId]) {
            webSocketConnections[userId] = new WebSocket(wsUrl);
        }

        const ws = webSocketConnections[userId]; */

        // Connection opened
        /* ws.onopen = () => {
            console.log(`The ${username} has connected to the FastApi Server`);
        }; */

        /* ws.onmessage = (event) => {
            console.log(`Message from FastApi server: ${event.data}`);
        }; */

        const user = voiceChannel.members.get(userId);
        if (!user) return;

        const username = user.user.globalName;
        console.log(`${username} is speaking`);

        const decoder = new opus.Decoder({
            rate: 48000,
            channels: 1,
            frameSize: 960,
        });

        // Create a Transform that processes 20 ms @48 kHz → 20 ms @16 kHz
        class Resample48to16 extends Transform {
            constructor() {
                super();
                this.inRate = 48000;
                this.outRate = 16000;
                this.method = "sinc"; // highest quality
            }

            _transform(chunk, encoding, cb) {
                // chunk: Buffer of PCM16LE @48 kHz (960 samples = 1920 bytes)
                // Convert to Int16 array
                const inSamples = new Int16Array(
                    chunk.buffer,
                    chunk.byteOffset,
                    chunk.length / 2
                );
                // Resample to 16 kHz (returns Int16Array)
                const outSamples = waveResampler.resample(
                    inSamples,
                    this.inRate,
                    this.outRate,
                    { method: this.method }
                );
                // Push back as Buffer (320 samples = 640 bytes)
                this.push(Buffer.from(outSamples.buffer));
                cb();
            }
        }

        // Subscribe speaker to audio stream to register their audio
        const audioStream = connection.receiver.subscribe(userId, {
            end: {
                behavior: EndBehaviorType.AfterSilence,
                duration: 1000,
            },
        });

        // Turning compressed opus audio into uncompressed raw 48khz PCM chunks
        const pcmStream = audioStream.pipe(decoder);

        pcmStream.on("data", (chunk) => {
            pcm_48 += 1;
            console.log(`🔵 [48kHz PCM]: ${chunk.length} bytes`);
        });

        const resampler = new Resample48to16();

        const pcm48Topcm16 = pcmStream.pipe(resampler);

        pcm48Topcm16.on("data", (chunk) => {
            pcm_16 += 1;
            console.log(`🟢 [16kHz PCM]: ${chunk.length} bytes`);
        });

        /* resampler.stdout.on("data", (chunk) => {
            pcm_16 += 1;
            console.log(`🟢 [16kHz PCM]: ${chunk.length} bytes`);

            if (ws && ws.readyState === ws.OPEN) {
                // Check if the WebSocket connection is open before sending
                ws.send(chunk, { binary: true }, (err) => {
                    if (err) {
                        console.error(
                            "Error sending audio chunk over WebSocket"
                        );
                    }
                });
            } else {
                console.warn(
                    "WebSocket connection not open. Dropping audio chunk."
                );
            }
        }); */

        audioStream.on("end", () => {
            console.log(`PCM 16khz: ${pcm_16}`);
            console.log(`PCM 48khz: ${pcm_48}`);
            console.log(`PCM 16khz: ${pcm_16 * 640} bytes`);
            console.log(`PCM 48khz: ${pcm_48 * 1920} bytes`);

            console.log(`🛑 ${username} stopped speaking`);
        });
    });
};
