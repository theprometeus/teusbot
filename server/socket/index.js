const EventEmitter 							= require("events");
const m3u8Parser 							= require("m3u8-parser").Parser;

const BotCommand 							= require("./core/command");
const BotActiveSocket 						= require("./core/active");

const botApp 								= Symbol("botApp");
const botLanguage 							= Symbol("botLanguage");

class BotClient extends EventEmitter {
	constructor(app) {
		super();

		this.isDebug 						= true;

		// Save app instance
		this[botApp] 						= app;

		// Save database instance
		this.database 						= app.database;

		// Save Streamlabs instance
		this.streamlabs 					= app.streamlabs;

		// Instance all bot modules
		this.modules 						= {
			emotes: 						require("./modules/emotes"),
			chat: 							require("./modules/chat")
		};

		// Stream data
		this.stream 						= {
			// Stream status
			online: 						false,
			// Stream start date
			started: 						new Date(),
			// Stream title
			title: 							null,
			// Stream viewers
			viewers: 						0,
			// Stream views
			views: 							0
		};

		// Socket handler
		this.sockets 						= {};

		// Config handler
		this.config 						= {};

		// Commands handler
		this.commands 						= [];

		// Timers handlers
		this.timers 						= [];

		// Data handler
		this.data 							= {};

		// Bot member
		this.botMember 						= {};

		// Language handler
		this[botLanguage] 					= [];

		// Client instance id
		this.instance 						= null;
	}

	emit(type, data, endpoint = ["streamer", "obs"]) {
		super.emit(type, data);

		// Check if endpoint is an array
		if (!Array.isArray(endpoint)) {
			// If not, instanciate the endpoint as array
			endpoint 						= [endpoint];
		}

		if (!Array.isArray(data)) {
			data 							= Object.assign({}, data);

			if (type === "chat.command") {
				delete data._botClient;
				delete data.socket;
			}
		}

		if (!this.data.data) {
			return false;
		}

		endpoint.forEach((end) => this[botApp].io.of("/" + end).in(this.data.data.user.uin).emit("obs.data", type, data));
	}

	getLangMessage(index, data) {
		const language 						= this[botLanguage].find((item) => item.key === index);

		if (language === undefined) {
			return "Missing translation for '" + index + "'";
		}

		let message 						= language.value;

		// Check if message contains data
		if (data) {
			message 						= this.getMessage(message, data);
		}

		// Return message
		return message;
	}

	getMessage(message, data) {
		return new Function(...Object.keys(data), "return `" + message + "`;")(...Object.values(data));
	}

	start() {
		return new Promise((resolve, reject) => {
			// Authenticate the bot with given configuration
			this[botApp].auth.login(this.config.email, this.config.password)
			.then(() => {
				// Get bot user info
				return this[botApp].auth.getInfo(this.config.channel);
			})
			.then((data) => {
				// Set channel data
				this.data 					= data;

				// Get language items filtering by language
				this[botLanguage] 			= this[botApp].languages.filter((item) => item.language === this.config.language);

				this.createClient("passive");
				this.createClient("active");
			})
			.catch((err) => {
				console.error("[error] authentication error for", this.config.email, err);
				reject(err);
			});
		});
	}

	/**
	 * End the client
	 */
	end() {
		Object.values(this.sockets).forEach((socket) => socket.close());
		this.stopTimers();
	}

	/**
	 * Create a command handler
	 * @param  {String} command 	Command name
	 * @param  {Array} args			Command arguments
	 * @param  {BotSocket} socket  	Command socket
	 * @param  {Object} sender  	Sender data
	 * @return {BotCommand}
	 */
	createCommand(command, args, socket, sender) {
		return new BotCommand(command, args, socket, sender, this);
	}

	/**
	 * Registers a command
	 * @param  {Object} data    	Command data
	 * @return {Number}
	 */
	registerCommand(data) {
		// Copy command data
		const command 						= Object.assign({}, data);

		// Check if is an addon
		if (command.type === "addon") {
			// Instantiate it
			return command.content.call(this.getCommandContext(command));
		}

		// Check if contains onEnter
		if (command.onEnter !== undefined) {
			command.onEnter.call(this.getCommandContext(command));
		}

		// Create final command
		const finalCommand 					= command.type === "text" || command.type === "alias" ? {
			name: 							command.name ? command.name.toLowerCase() : null,
			type: 							command.type,
			content: 						command.content
		} : command;

		// Check if command has id
		if (command.id) {
			// Add it to final command
			finalCommand.id 				= command.id;
		}

		return this.commands.push(finalCommand);
	}

	/**
	 * Get the command function context
	 * @param  {Object} module [description]
	 * @return {Object}        [description]
	 */
	getCommandContext(module) {
		return {
			client: 						this,
			module: 						module,
			socket: 						this.sockets.passive
		};
	}

	/**
	 * Process a command
	 * @param  {BotCommand} processor Command processor
	 * @return {Boolean}
	 */
	processCommand(processor) {
		if (processor.command === "commands" || processor.command === "comandos") {
			return processor.sendMessage(
				this.commands
				.filter((cmd) => {
					return cmd !== null && cmd.type !== "addon";
				})
				.map((cmd) => {
					return "!" + cmd.name;
				})
				.join(", ")
			);
		}

		// Get all available command handlers
		const handlers 						= this.commands.filter((cmd) => cmd.name === processor.command);

		// Check if command exists
		if (handlers.length === 0) {
			return false;
		}

		// Iterate over all handlers
		handlers.forEach((handler) => {
			// Check if it's a text command
			if (handler.type === "text") {
				// Send the message
				processor.sendMessage(processor.getMessage(handler.content));
			} else 
			// Check if it's an alias command
			if (handler.type === "alias") {
				// Separate command from arguments
				const args 					= handler.content.split(" ");
				const cmd 					= args.shift().replace("!", "");

				// Add current command arguments
				processor.arguments.forEach((arg) => args.push(arg));

				// Create the processor
				const command 				= this.createCommand(cmd, args, this.sockets.passive, processor.sender);

				this.processCommand(command);
			} else
			// Check if it's a module command
			if (handler.type === "module") {
				handler.content.call(this.getCommandContext(handler), processor);
			} else {
				console.error("[bot] unknown command type", handler.type, "for command", processor.command);
			}
		});

		return false;
	}

	/**
	 * Get a module by it's name
	 * @param  {String} name Module name
	 * @return {Object}      Module data
	 */
	getModule(name) {
		return this.commands.find((m) => m.name === name);
	}

	/**
	 * Registers a timer
	 * @param  {Object} data 		Timer data
	 * @return {Object}
	 */
	registerTimer(data) {
		return this.timers.push({
			id: 							data.id || null,
			name: 							data.name || null,
			type: 							data.type || "invalid",
			content: 						data.content || null,
			interval: 						data.interval ? data.interval * 60 * 1000 : Number.MAX_SAFE_INTEGER,
			sequential: 					data.sequential || false,
			instance: 						null
		});
	}

	/**
	 * Start a single timer
	 * @param  {Object} timer Timer object
	 */
	startTimer(timer) {
		if (typeof timer !== "object") {
			timer 							= this.timers[timer];
		}

		if (timer === undefined) {
			throw new Error("Invalid timer");
		}

		// Check if timer type is text
		if (timer.type === "text") {
			// Create a new instance to send 'timer.content' every 'timer.interval'
			timer.instance 					= setInterval(() => this.sockets.passive.sendMessage(timer.content), timer.interval);
		} else
		// Check if timer type is command
		if (timer.type === "command") {
			// Split timer content
			let command 					= timer.content.split(" ");

			// Create the command handler
			command 						= this.createCommand(command.shift().replace("!", ""), command, this.sockets.passive, this.botMember);

			// Create a new instance to run 'command' every 'timer.interval'
			timer.instance 					= setInterval(() => this.processCommand(command), timer.interval);
		}
	}

	/**
	 * Starts all bot timers
	 */
	startTimers() {
		// Iterate over all timers
		this.timers
		.filter((timer) => timer.instance === null)
		.forEach((timer) => this.startTimer(timer));

		return true;
	}

	/**
	 * Stop a single timer
	 * @param  {Object} timer Timer object
	 * @return {Boolean}
	 */
	stopTimer(timer) {
		clearInterval(timer.instance)
		return true;
	}

	/**
	 * Stops all bot timers
	 */
	stopTimers() {
		// Iterate over all timers
		this.timers.forEach((timer) => {
			// Check if timer is active
			if (timer.instance) {
				// Clear timer interval
				this.stopTimer(timer);
			}
		});

		return true;
	}

	/**
	 * Process data message
	 * @param  {Object} message  	StreamCraft message object
	 * @param  {Object} user		Message sender
	 * @param  {Object} data		Message data
	 * @return {Boolean}
	 */
	processDataMessage(message, user, data) {
		// Member enter and member quit
		if (message.MsgType === 20002 || message.MsgType === 20003) {
			// Update current viewers and views
			this.stream.viewers 			= data.RealCount;
			this.stream.views 				= data.TotalViewCount;

			this.emit("stream.update", this.stream);
		}

		switch(message.MsgType) {
			// Unhandled action
			default:
				console.log("[bot] unhandled data message", message.MsgType, data);
			break;

			// Ignore this packets
			case 1: 	// Normal chat message
			case 20003: // Member join
			case 4: 	// Member charm (like)

			break;

			// Mute
			// TODO: handle this packet properly
			case 20005:
				const from 					= data.AdminUin;
				const to 					= data.GagUin;
				const length 				= data.GagTimeLne;
				const expires 				= data.GagExpire;
			break;

			// Authority change
			// TODO: handle this packet properly
			case 20019:
				const level 				= data.Access;
				const admin					= data.AdminUin;
			break;

			// Stream status update
			case 20001:
			case 20000:
				this.stream.online 			= (data.Status === 1);
				this.stream.title 			= data.Title;
				this.stream.started 		= new Date();

				this.emit("stream.update", this.stream);
			break;

			// Member join
			case 20002:
				// Emit chat message
				this.emit("chat.message", {
					sender: 				user,
					message: 				this.getMessage(this.getLangMessage("CHAT_JOIN"), {
						sender: 			user
					}),
					special: 				true
				});

				// Emit chat join
				this.emit("chat.join", {
					sender: 				user
				});
			break;

			// Gift (emote) 
			case 20015:
				// Get emote data
				const emoteData 			= this.config.giftList.find((emote) => emote.id === data.GiftId);

				// Prepare emote data
				const emote 				= {
					id: 					data.GiftId,
					amount: 				data.Nums,
					cost: 					emoteData.coins,
					emote: 					emoteData
				};

				// Call emotes module
				this.modules.emotes.call(this, emote, emoteData);
			break;

			// Channel follow
			case 10004:
				// Emit chat message
				this.emit("chat.message", {
					sender: 				user,
					message: 				this.getMessage(this.getLangMessage("CHAT_SHARE"), {
						sender: 			user
					}),
					special: 				true
				});

				// Emit emote sent
				this.emit("chat.share", {
					sender: 				user
				});
			break;

			// Channel follow
			case 10005:
				// Create a new alert at StreamLabs
				this.config.canReply && this.streamlabs.addAlert(this.config.streamLabsToken, {
					name: 					user.nickname,
					type: 					"subscription",
					message: 				user.nickname + " " + this.getMessage(this.getLangMessage("CHAT_FOLLOW"), { sender: user.nickname })
				});

				// Emit chat message
				this.emit("chat.message", {
					sender: 				user,
					message: 				this.getMessage(this.getLangMessage("CHAT_FOLLOW"), {
						sender: 			user
					}),
					special: 				true
				});

				// Emit emote sent
				this.emit("chat.follow", {
					sender: 				user
				});
			break;
		}

		return true;
	}

	/**
	 * Creates a new WebSocket client
	 * @param  {String}  type   	Client type (active or passive)
	 * @param  {String}  url		Server URL
	 * @param  {Number}  retry 		Retry times
	 * @return {WebSocket}			Client WebSocket
	 */
	createClient(type, url, retry) {
		url									= url || this.data.ws[type];

		const socket 						= new BotActiveSocket(url, type, this);
		this.sockets[type] 					= socket;

		socket.debug("connecting to", url);

		// On socket error, reconnect
		socket.on("error", () => {
			if (retry === 3) {
				console.error("[bot] giving up. Impossible to reconnect to", type, "server!");

				// Check if active server failed
				if (type === "active" && this.sockets.passive) {
					// Pass authority to passive server
					// Maybe this works
					this.sockets.active 	= this.sockets.passive;
					this.sockets.packets.active.getStudioConfig();

					console.info("[bot] active authority is now with passive socket");
				}

				return false;
			}

			console.info("[bot] trying to reconnect in", socket.ReconSec, "seconds");

			const newUrl 					= url.indexOf("1689") > -1 ? url.replace("1689", "1690") : url.replace("1690", "1689");

			setTimeout(() => {
				this.createClient(type, newUrl, retry ? retry + 1 : 1);
			}, socket.ReconSec++ * 1000);
		});

		// On receive gift list
		socket.on("giftList", (list) => {
			this.config 					= this.config || {};

			// Update the gift list
			this.config.giftList 			= list;
		});

		// On receive chat
		socket.on("chat", (message) => this.modules.chat.call(this, message, socket));

		return socket;
	}
}

module.exports 								= BotClient;