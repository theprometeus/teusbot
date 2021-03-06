const $ 					= require("jquery");

require("popper.js");
require("bootstrap");
require("ejs");

const io 					= require("socket.io-client");
const gifffer 				= require("gifffer/lib/gifffer");

const query 				= new URLSearchParams(window.location.search);

const app 					= {
	template: 				null,
	token: 					query.get("token"),
	module: 				query.get("module"),
	event: 					query.has("event") ? query.get("event") : query.get("module"),
	test: 					(query.get("test") === "true" || query.get("test") === "1"),
	isQueue: 				(query.get("queue") === "true" || query.get("queue") === "1"),
	append: 				query.has("append") ? (query.get("append") === "true" || query.get("append") === "1") : true,
	queue: 					[],
	testData: 				{
		name: 				"Teste Aposta",
		sender: 			{
			id: 			1,
			nickname: 		"Test",
			picture: 		"https://via.placeholder.com/150",
			tag: 			"Test"
		},
		message: 			"test message",
		emote: 				{
			amount: 		1,
			emote: 			{
				name: 		"Test Emote",
				animation: 	"https://media2.giphy.com/media/nNxT5qXR02FOM/giphy.gif"
			}
		},
		options: 			["teste1", "teste2"]
	}
};

// Check if token or module is set
if (app.token === null || app.module === null) {
	return alert("No token or module inserted.");
}

if (!app.token.length) {
	app.token 				= null;
}

/**
 * -----------------------------------------------------------------
 * Socket initialization
 * -----------------------------------------------------------------
 */

// Create socket.io instance
const socket 				= io("/obs", {
	autoConnect: 			false,
	transports: 			["websocket"]
});

// On socket connect
socket.on("connect", () => {
	console.info("[socket] connected");

	// Emit authentication
	socket.emit("auth", app.token);
});

// On socket authenticate
socket.on("auth", (success) => {
	console.info("[socket] authentication", success);

	// Check if authentication succeeded
	!success && alert("Authentication failed.");

	socket.emit("obs.listen", app.event);
});

/**
 * -----------------------------------------------------------------
 * Module initialization
 * -----------------------------------------------------------------
 */

const $parent 				= $("<div id='" + app.module.replace(/\./g, "-") + "-parent'/>").appendTo(document.body);

const duration 				= query.has("duration") ? parseInt(query.get("duration"), 10) : (5000);
const animateDuration 		= query.has("aduration") ? parseInt(query.get("aduration"), 10) : 1000;
const animateIn 			= query.has("in") ? query.get("in") : "fadeInLeft";
const animateOut 				= query.has("out") ? query.get("out") : "fadeOutLeft";

app.container 					= $parent;

function appPrepareNotification($element, callback) {
	const $preload 				= $element.find("img, audio");
	const count 				= $preload.length;

	let actual 					= 0;
	let cancelled 				= false;

	if ($preload.length === 0) {
		callback();
	}

	// Preloader images
	$preload.each(function() {
		const src 				= $(this).attr("src");
		const element 			= $(this).is("audio") ? new Audio() : new Image();

		element.src 			= src;

		$(element).on("load canplaythrough", function() {
			actual++;

			if (actual === count && !cancelled) {
				callback();
			}
		});

		$(element).on("error stalled", function() {
			if (!cancelled) {
				cancelled 	= true;
				appPrepareNotification($element, callback);
			}
		});
	});

	// Replace animated images with gifffer attributes
	$element.find("img[animated]").each(function() {
		$(this).attr("data-gifffer", $(this).attr("src")).removeAttr("src");
	});
}

/**
 * Create a module notification in the screen
 * @param  {Object} data Notification data
 * @returns {Boolean} Success
 */
function appNotificate(data, callback) {
	// Check if template is loaded
	if (app.template === null) {
		return false;
	}

	const content 				= ejs.render(app.template, data);
	const $element 				= $(content);

	// Prepare element
	appPrepareNotification($element, () => {
		if (!app.append) {
			$parent.html("");
		}

		$element.prependTo($parent);

		let fDuration 			= duration;

		// Check if data contains emote
		if (data.emote) {
			fDuration 			= data.emote.emote.duration < 10000 ? 1000 : data.emote.emote.duration * 2;
		}

		$element.find("audio").each(function() {
			this.play();
		});

		$element.addClass("animated " + animateIn);
		$element.css("animation-duration", animateDuration + "ms");

		// Check if is to get out
		if (animateOut !== "0" && animateOut !== "false") {
			// Wait for notification duration
			setTimeout(() => {
				$element
					.removeClass(animateIn)
					.addClass(animateOut);

				// Wait for out animation end
				setTimeout(() => {
					$element.remove();

					if (callback) {
						callback();
					}
				}, animateDuration);
			}, fDuration);
		}

		// Process notification gifs
		const gifs 				= gifffer({
			playButtonStyles: {
				width: 			0,
				height: 		0
			}
		});

		// Play gifs after in animation complete
		setTimeout(() => {
			gifs.forEach((gif) => gif.click());
		}, animateDuration);
	});

	return true;
}

function appProcessQueue() {
	let notification 			= app.queue.shift();

	appNotificate(notification, function() {
		if (app.queue.length) {
			appProcessQueue();
		}
	});
}

if (app.module === "bet") {
	app.module 					= "bet.start";
}

// Get module app.template
$.get("inc/tpl/" + app.module + ".ejs", (tpl) => {
	app.template 				= tpl;

	// Check if test
	if (app.test) {
		// Create a test notification
		appNotificate(app.testData);
	}

	if (app.module === "bet.start") {
		require("./bet")(socket, app);
	} else
	if (app.module === "chat.firework") {
		require("./firework")(socket, app);
	} else {
		// Add event listener to module
		socket.on("obs.data", (type, data) => {
			// Check if is queue
			if (!app.isQueue) {
				// Show notification imediately
				appNotificate(data);
			} else {
				// Add notificationt to queue
				app.queue.push(data);

				if (app.queue.length === 1) {
					appProcessQueue();
				}
			}
		});
	}

	// Open socket connection
	socket.connect();
});