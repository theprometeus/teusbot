const BotAuthenticator					= require.main.require("../socket/core/auth");
const BotClient 						= require.main.require("../socket/index");
const BotDatabase 						= require.main.require("../socket/core/database");
const BotStreamlabs 					= require.main.require("../socket/core/streamlabs");

const BotModules 						= [];

const glob 								= require("glob");
const path 								= require("path");

// Load all modules
glob(path.join(__dirname, "modules", "**/*.js"), function(err, files) {
	// Check if any error ocurred
	if (err) {
		return reject(err);
	}

	// Iterate over modules
	files.forEach(function(file) {
		try {
			const currentModule 		= require(file);

			// Load the module
			BotModules.push(currentModule);

			// Check if module has preload
			if (currentModule.preload instanceof Function) {
				currentModule.preload.call(currentModule);
			}
		} catch(e) {
			throw new Error("Error enabling module " + path.basename(file) + ": " + e);
		}
	});
});

class BotApp {
	constructor(io) {
		// Save socket.io instance
		this.io 						= io;

		// Create new authenticator instance
		this.auth 						= new BotAuthenticator();

		// Create a new database instance
		this.database 					= new BotDatabase();

		// Bot clients handler
		this.clients 					= [];

		// Streamlabs config
		const slConfig 					= {
			id: 						process.env.STREAMLABS_ID,
			secret: 					process.env.STREAMLABS_SECRET,
			url: 						process.env.NODE_ENV === "production" ? "https://teus.herokuapp.com" : "http://127.0.0.1:3200",
			scopes: 					"donations.create alerts.create"
		};

		// Create a new streamlabs instance
		this.streamlabs 				= new BotStreamlabs(slConfig.id, slConfig.secret, slConfig.url, slConfig.scopes);
	}

	init() {
		return new Promise((resolve, reject) => {
			// Startup the database
			this.database.start()
			.then(() => {
				// Get all channels that need auto enter
				return this.database.Configs.findAll({
					where: 				{
						key: 			"autoEnter",
						value: 			"1"
					},
					attributes: 		["channel"]
				});
			})
			.then((channels) => {
				// Iterate over all auto enter channels
				channels.forEach((channel) => {
					// Create the client
					this.createBotClient(channel.channel)
					.then((client) => {
						// Start the client
						return this.startBotClient(client);
					})
					.catch((err) => {
						err.message 	= "Error creating the bot client: " + err.message;
						reject(err);
					});
				});

				resolve();
			})
			.catch((err) => {
				err.message 			= "Error starting the database: " + err.message;
				reject(err);
			});
		});
	}

	createBotClient(channel) {
		// Create a new bot client
		const botClient 				= new BotClient(null, this);			

		return new Promise((resolve, reject) => {
			// Get bot config
			return this.database.getConfig(channel)
			.then((config) => {
				// Save bot config
				botClient.config  		= config;

				// Put bot client into memory
				const instance 			= this.clients.push(botClient);

				// Set instance
				botClient.instance 		= instance;

				resolve(botClient);
			})
			.catch(reject);
		});
	}

	startBotClient(client) {
		return new Promise((resolve, reject) => {
			// Get all channel custom active commands
			this.database.BotCommands.findAll({
				where: 					{
					channel: 			client.config.channel,
					active: 			true
				},
				attributes: 			["name", "type", "content"]
			})
			.then((commands) => {
				// Register all commands
				commands.forEach((command) => client.registerCommand(command));

				// Load and handler custom commands
				const BotTimers 		= require.main.require("../data/timers.json");

				// Iterate over timers
				BotTimers.forEach((timer) => {
					// Register timer
					client.registerTimer(timer);
				});

				// Register all modules
				BotModules.forEach((module) => client.registerCommand(module));

				// Start the client
				client.start()
				.then(resolve)
				.catch(reject);
			});
		});
	}

	getClient(channel) {
		return this.clients.find((client) => client.config.channel === channel);
	}
}

module.exports 				= BotApp;