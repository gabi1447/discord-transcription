const {
    joinVoiceChannel,
    EndBehaviorType,
    entersState,
    VoiceConnectionStatus,
} = require("@discordjs/voice");
const { opus } = require("prism-media");
const WebSocket = require("ws");
const Resample48to16 = require("../resample48to16");
const fs = require("fs");
const path = require("path");

// WebSocket URL
const wsUrl = "ws://localhost:8000/transcribe";

// Store websocket connections for each user
let webSocketConnections = {};

class WebSocketSenderStream extends require("stream").Writable {
    constructor(ws) {
        super();
        this._ws = ws;
    }

    _write(chunk, encoding, callback) {
        console.log(`16khz chunk length: ${chunk.length}`);
        // This method is called for each chunk of data from the piped stream
        if (this._ws && this._ws.readyState === this._ws.OPEN) {
            this._ws.send(chunk, { binary: true }, (err) => {
                if (err) {
                    console.error(
                        "Error sending audio chunk over WebSocket",
                        err
                    );
                    // Optionally call callback(err) to propagate the error back up the pipe
                    // For this use case, just logging might be sufficient
                }
                // Call the callback when you are ready to receive the next chunk
                callback();
            });
        } else {
            console.warn(
                "WebSocket connection not open. Dropping audio chunk."
            );
            // If the WebSocket isn't open, we still need to call the callback
            // to allow the upstream stream to continue flowing data (which will be dropped)
            callback();
        }
    }

    // You might also want to handle the 'finish' event on the Writable stream
    // This signifies that the piped Readable stream has ended and all data has been processed
    _final(callback) {
        // Optional: Do something when the source stream ends and all buffered data is written
        // console.log("WebSocketSenderStream finished.");
        callback(); // Important to call callback when finished
    }
}

module.exports = async function execute(client, interaction) {
    const voiceChannel = interaction.member.voice.channel;
    let connection;

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
        const user = voiceChannel.members.get(userId);
        if (!user) return;

        const username = user.user.globalName;

        const setupAudioStreams = () => {
            console.log(`🔴${username} is speaking`);

            const startTime = Date.now();

            // Subscribe speaker to audio stream to register their audio
            const audioStream = connection.receiver.subscribe(userId, {
                end: {
                    behavior: EndBehaviorType.AfterSilence,
                    duration: 1000,
                },
            });

            audioStream.on("error", (error) =>
                console.error(`AudioStream Error for ${username}:`, error)
            );

            // Decoder
            const decoder = new opus.Decoder({
                rate: 48000,
                channels: 1,
                frameSize: 960,
            });
            decoder.on("error", (error) =>
                console.error(`Decoder Error for ${username}:`, error)
            );

            // Resampler
            const resampler = new Resample48to16();
            resampler.on("error", (error) =>
                console.error(`Resampler Error for ${username}:`, error)
            );

            const opusToPcm = audioStream.pipe(decoder);

            opusToPcm.on("data", (chunk) => {
                console.log(`🔵48khz PCM chunk size: ${chunk.length}`);
            });

            const pcm48to16 = opusToPcm.pipe(resampler);

            pcm48to16.on("data", (chunk) => {
                console.log(`🟢16khz PCM chunk size: ${chunk.length}`);
            });

            // APPENDING RESAMPLED AUDIO TO .raw FILE
            // directory where audio files are going to be stored
            const audioOutputDir = "./audioFiles";
            if (!fs.existsSync(audioOutputDir)) {
                fs.mkdirSync(audioOutputDir);
            }

            // Generate unique audio file
            const outputFile = `${userId}.raw`;
            const outputPath = path.join(audioOutputDir, outputFile);

            // Write stream to populate .raw audio file
            const writeStream = fs.createWriteStream(outputPath, {
                flags: "a",
            });

            pcm48to16.pipe(writeStream);

            writeStream.on("finish", () => {
                const endTime = Date.now();
                console.log(
                    `🔴 Username: ${username} has finished speaking. Spoke for ${
                        endTime - startTime
                    } seconds.`
                );
                // Cleanup streams
                audioStream.destroy();
                decoder.destroy();
                resampler.destroy();
                writeStream.destroy();
            });

            pcm48to16.on("end", () => {
                writeStream.end();
            });

            /* pipe it to writable stream wsSender to send it
            to the fastapi server for further transcription */

            /* const wsSender = new WebSocketSenderStream(ws);
            wsSender.on("error", (error) =>
                console.error(`WebSocketSender Error for ${username}:`, error)
            );

            audioStream.pipe(decoder).pipe(resampler).pipe(wsSender);

            wsSender.on("finish", () => {
                if (resampler) {
                    resampler.removeAllListeners();
                }

                if (decoder) {
                    decoder.removeAllListeners();
                }

                if (audioStream) {
                    audioStream.removeAllListeners();
                }

                console.log(`🛑 ${username} stopped speaking`);
            }); */
        };

        // Establish websocket connection for user once they start speaking only if they don't have one already
        if (!webSocketConnections[userId]) {
            webSocketConnections[userId] = new WebSocket(wsUrl);
        }

        const ws = webSocketConnections[userId];

        if (ws.readyState === WebSocket.OPEN) {
            setupAudioStreams();
        } else if (ws.readyState === WebSocket.CONNECTING) {
            ws.once("open", () => {
                console.log(
                    `The user ${username} has connected to the FastApi Server`
                );
                setupAudioStreams();
            });
        } else {
            console.warn(
                `WebSocket for user ${userId} is in state ${ws.readyState}. Cannot send audio for this turn.`
            );
        }

        ws.onmessage = (event) => {
            console.log(`Message from FastApi server: ${event.data}`);
        };
    });
};
