// [private fork] Server-side bot connector for alt characters. Deliberately
// does NOT reimplement the client's movement/entity-parsing protocol — a
// bot's socket.io-client connection only exists to give the character a
// live session (players[socket.id] on the game server). All decisions and
// actions run through the game server's own internal /eval endpoint
// (server_api.post("/eval", ...) in node/server.js - the same mechanism
// adventure_functions.js's character_eval uses for admin/cron tooling, but
// called directly at 127.0.0.1 here rather than through character_eval's
// public-address round trip - see local_eval() below). Code eval'd there
// runs directly in node/server.js's own scope, so player.socket.fs.skill(...)
// reuses the real attack/target validation, not a reimplementation of it.
//
// Conservative by design: only engages monsters at or below the
// character's level + 3, disengages below 40% HP, and does a plain
// HP/rip reset on death rather than a full respawn-with-teleport (fine for
// a private single-player instance; no PvP penalty to avoid here).
var crypto = require("crypto");
var { io } = require("socket.io-client");
var options = require("./secretsandconfig/options");
var settings = require("./settings.js");

var connections = {}; // character_name -> { socket, connected }

function server_def() {
	return options.servers[process.env.GAME_SERVER_KEY || "local"];
}

async function mint_session(db, character_name) {
	var character = await db.collection("character").findOne({ name: character_name });
	if (!character) throw new Error("no such character: " + character_name);
	var token = crypto.randomBytes(10).toString("hex");
	await db.collection("user").updateOne({ _id: character.owner }, { $push: { "info.auths": token } });
	return { character_id: character._id, user_id: character.owner, auth: token };
}

async function connect_bot(db, character_name) {
	if (connections[character_name]) return;
	var session = await mint_session(db, character_name);
	var def = server_def();
	var socket = io("http://127.0.0.1:" + def.local_port, {
		path: def.path,
		transports: ["websocket"],
		reconnection: true,
		reconnectionDelay: 5000,
	});
	connections[character_name] = { socket: socket, connected: false };

	// The server only accepts "auth" once this socket is a registered
	// observer, which only happens after it emits "loaded" - and both must
	// wait for the server's own per-connection setup (registered right
	// before it sends the first "welcome") or they're silently dropped.
	// This mirrors exactly what the real client does in response to its own
	// "welcome" handler (see js/game.js's launch_game()), not on "connect".
	var authed_once = false;
	socket.on("welcome", function () {
		if (authed_once) return;
		authed_once = true;
		socket.emit("loaded", { success: 1, width: 1280, height: 720, scale: 2 });
		setTimeout(function () {
			socket.emit("auth", {
				user: session.user_id,
				character: session.character_id,
				auth: session.auth,
				code_slot: 0,
				width: 1280,
				height: 720,
				scale: 2,
				passphrase: "",
				no_html: false,
				no_graphics: true,
			});
			// Optimistic: the server doesn't emit a distinct confirmation
			// event on successful auth (only "entities" starts flowing).
			// character_eval's own `if (player)` guard is what actually
			// keeps the AI tick safe if auth is still in flight or failed -
			// this flag only gates whether we bother ticking at all.
			if (connections[character_name]) {
				connections[character_name].connected = true;
				console.log("[bots] " + character_name + " authenticated");
			}
		}, 500);
	});
	socket.on("game_error", function (msg) {
		console.error("[bots] " + character_name + " game_error: " + JSON.stringify(msg));
	});
	socket.on("game_log", function (msg) {
		console.log("[bots] " + character_name + " game_log: " + JSON.stringify(msg));
	});
	socket.on("disconnect", function () {
		if (connections[character_name]) connections[character_name].connected = false;
		console.log("[bots] " + character_name + " disconnected");
	});
	socket.on("connect_error", function (err) {
		console.error("[bots] " + character_name + " connect_error: " + err.message);
	});
}

function disconnect_bot(character_name) {
	var c = connections[character_name];
	if (!c) return;
	try {
		c.socket.disconnect();
	} catch (e) {}
	delete connections[character_name];
}

function is_connected(character_name) {
	return !!(connections[character_name] && connections[character_name].connected);
}

var AI_CODE = [
	"if (player.rip) {",
	"  player.hp = player.max_hp; player.mp = player.max_mp; player.rip = false;",
	"} else {",
	"  var pool = (instances[player.in] && instances[player.in].monsters) || {};",
	"  var nearby = Object.values(pool).filter(function(m){",
	"    return m && !m.dead && simple_distance(player, m) < 320 && (m.level || 1) <= (player.level || 1) + 3;",
	"  });",
	"  nearby.sort(function(a, b){ return simple_distance(player, a) - simple_distance(player, b); });",
	"  if (player.hp > player.max_hp * 0.4) {",
	"    if (!player.target || !pool[player.target]) { if (nearby[0]) player.target = nearby[0].id; }",
	"    if (player.target && pool[player.target]) {",
	"      try { player.socket.fs.skill({ name: 'attack', id: player.target }); } catch (e) {}",
	"    }",
	"  }",
	"}",
	"output = { hp: player.hp, max_hp: player.max_hp, rip: player.rip, target: player.target };",
].join("\n");

// NOT using adventure_functions.js's character_eval here: it builds its eval
// URL from the server's *public* address (server.address/api_path in
// MongoDB) - correct for the original multi-server architecture where the
// web backend and a game server can be different machines, but wrong for a
// bot that already lives in the same container as the game server it's
// controlling. Using it would mean every AI tick round-trips out through
// the public domain/Traefik back to itself - fragile (depends on the
// public address always being reachable from inside its own container) and
// pointlessly slow. Call the local eval endpoint directly instead.
async function local_eval(character_name, code) {
	var def = server_def();
	var keys = require("./secretsandconfig/keys");
	var url = "http://127.0.0.1:" + def.local_port + def.api_path + "eval";
	var wrapped = "var player = players[name_to_id['" + character_name + "']]; if (player) { " + code + " }";
	var response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ spass: keys.ACCESS_MASTER, code: wrapped, data: "{}" }).toString(),
	});
	return JSON.parse(await response.text());
}

// get_display_name(stored_name) resolves settings.json's lowercase key
// (character.name) to the live name_to_id lookup key (character.info.name,
// original casing) - see the [private fork] note on start_ticking's caller
// in main.js for why these two differ.
function start_ticking(get_display_name) {
	setInterval(async function () {
		for (var name in connections) {
			if (!is_connected(name)) continue;
			try {
				var display_name = await get_display_name(name);
				if (display_name) await local_eval(display_name, AI_CODE);
			} catch (e) {
				console.error("[bots] tick error for " + name, e.message);
			}
		}
	}, 2000);
}

async function sync_with_settings(db) {
	var desired = settings.get().bots || {};
	for (var name in desired) {
		if (desired[name] && desired[name].enabled && !connections[name]) {
			try {
				await connect_bot(db, name);
			} catch (e) {
				console.error("[bots] connect failed for " + name, e.message);
			}
		}
	}
	for (var name in connections) {
		if (!desired[name] || !desired[name].enabled) disconnect_bot(name);
	}
}

module.exports = {
	connect_bot: connect_bot,
	disconnect_bot: disconnect_bot,
	is_connected: is_connected,
	start_ticking: start_ticking,
	sync_with_settings: sync_with_settings,
	connections: connections,
};
