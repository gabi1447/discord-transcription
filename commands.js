const commands = {
    hello: require("./commands/hello.js"),
    testing: require("./commands/testing"),
    join: require("./commands/enable-transcription.js"),
};

// Log every message sent in the server
module.exports = function (client, command) {
    if (command.author.bot || !command.content.startsWith(process.env.PREFIX)) {
        return;
    }

    const message = command.content;

    if (message.charAt(0) === "!") {
        const stringCommand = message.slice(1);
        if (stringCommand === "join") {
            commands[stringCommand](client, command);
        } else if (stringCommand in commands) {
            commands[stringCommand](command);
        } else {
            command.channel.send("This command is not available");
        }
    }
};
