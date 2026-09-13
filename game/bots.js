// [private fork] Server-side bot connector for alt characters. Deliberately
// does NOT reimplement the client's movement/entity-parsing protocol — a
// bot's socket.io-client connection only exists to give the character a
// live session (players[socket.id] on the game server). All decisions and
// actions run through the game server's own internal /eval endpoint
// (server_api.post("/eval", ...) in node/server.js - the same mechanism
// adventure_functions.js's character_eval uses for admin/cron tooling, but
// called directly at 127.0.0.1 here rather than through character_eval's
// public-address round trip - see local_eval() below). Code eval'd there
// runs directly in node/server.js's own scope, so player.socket.fs.X(...)
// (every socket.on(...) handler is mirrored there) reuses the real
// attack/sell/party validation, not a reimplementation of it.
//
// Conservative by design: only engages monsters at or below the
// character's level + 3, disengages below 40% HP, and does a plain
// HP/rip reset on death rather than a full respawn-with-teleport (fine for
// a private single-player instance; no PvP penalty to avoid here).
//
// Per-bot config (settings.json "bots" section):
//   enabled     - connect/disconnect
//   map         - farm-zone: teleport here once, right after connecting
//                 (via the real transport_player_to(), not raw x/y)
//   party_with  - stored (lowercase) character name to auto-party with,
//                 checked/re-attempted every tick so it self-heals if that
//                 character logs in later or the party gets disbanded.
//                 Party XP-sharing is proportional to each member's own
//                 damage output plus a flat bonus that scales with party
//                 size (10-40%) - it doesn't grant passive income to a
//                 member who isn't also fighting.
//   auto_sell   - opt-in (default off): sell an item when inventory is
//                 nearly full, using the game's own "computer" flag (see
//                 below) to sell from anywhere rather than requiring the
//                 bot to be standing at a shop. Off by default because it
//                 sells indiscriminately (first unlocked, unblocked item),
//                 not by any notion of "junk" - fine for a farming
//                 character you don't care about, risky for one you do.
//   mode        - "farm" (default): the combat AI below, camps and attacks
//                 whatever wanders into range. "companion": follows
//                 party_with (teleporting to their map if they're
//                 elsewhere, then nudging position toward them - no real
//                 pathfinding, same crude-but-functional level as the rest
//                 of this bot) and assists by copying their live .target
//                 when they have one, falling back to the normal nearby-
//                 monster attack otherwise. "merchant": skips combat
//                 entirely and instead keeps mluck_targets buffed with
//                 Merchant's Luck (+luck, 1hr duration - see
//                 design/conditions.js). Real mluck normally requires
//                 merchant level 40 and 320-range proximity to the target
//                 (design/skills.js); a private-server merchant bot exists
//                 specifically to auto-refresh this on alts you never
//                 actively play, so instead of walking it to each target
//                 (impractical - they may be on any map, mid-fight) this
//                 writes the exact same target.s.mluck condition object
//                 the server itself writes on a normal, in-range cast
//                 (node/server.js's "mluck" skill handler) - not a
//                 reimplementation, a direct copy of that authoritative
//                 shape, just without the range/level gate. `strong:true`
//                 mirrors what the server sets when caster and target
//                 share an account owner (skill handler's `target.owner ==
//                 player.owner` branch) - true for any two of your own
//                 characters, and it just means only you can overwrite it.
//                 "custom": runs custom_code (a raw code string, same
//                 scope as the admin executor's local_eval snippets - see
//                 main.js) every tick instead of any of the above, with
//                 rip-recovery still handled automatically first. "idle":
//                 just stays connected and safe (teleports once to the
//                 "main" map's default spawn, then does nothing) - for a
//                 character you're not actively running but still want
//                 reachable for the party command center's item/equipment
//                 management, which needs a live player object to do
//                 anything (see build_idle_code below).
//   combat_mode - "assist" (default) or "passive". Only meaningful when
//                 mode is "companion": passive still follows but never
//                 targets or attacks (see build_ai_code's
//                 passive_companion check) - set via the in-game party
//                 right-click menu (js/party_control.js) or this panel.
//   mluck_targets - array of stored (lowercase) character names to keep
//                 mluck'd. Only meaningful when mode is "merchant".
//   custom_code - raw code string run every tick when mode is "custom".
//                 `player` is already resolved (this character's own live
//                 state) and the rip-recovery branch has already run, same
//                 as every other mode.
var crypto = require("crypto");
var { io } = require("socket.io-client");
var options = require("./secretsandconfig/options");
var settings = require("./settings.js");

var connections = {}; // character_name -> { socket, connected, config }

function server_def() {
	return options.servers[process.env.GAME_SERVER_KEY || "local"];
}

async function mint_session(db, character_name) {
	var character = await db.collection("character").findOne({ name: character_name });
	if (!character) throw new Error("no such character: " + character_name);
	var token = crypto.randomBytes(10).toString("hex");
	await db.collection("user").updateOne({ _id: character.owner }, { $push: { "info.auths": token } });
	return { character_id: character._id, user_id: character.owner, auth: token, display_name: character.info.name };
}

async function connect_bot(db, character_name, config) {
	if (connections[character_name]) return;
	var session = await mint_session(db, character_name);
	var def = server_def();
	var socket = io("http://127.0.0.1:" + def.local_port, {
		path: def.path,
		transports: ["websocket"],
		reconnection: true,
		reconnectionDelay: 5000,
	});
	connections[character_name] = { socket: socket, connected: false, display_name: session.display_name, config: config || {} };

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
			// The eval calls below (and the tick's own `if (player)` guard)
			// are what actually keep this safe if auth is still in flight -
			// this flag only gates whether we bother ticking at all.
			if (connections[character_name]) {
				connections[character_name].connected = true;
				console.log("[bots] " + character_name + " authenticated");
			}
			// One-time setup: give the character a "computer" item if it
			// doesn't already have one. player.computer is NOT a persistent
			// flag - it's recomputed from inventory contents on every stat
			// refresh (node/server.js's per-tick recalculation scans
			// player.items for a "computer"/"supercomputer" item and sets
			// player.computer accordingly), so directly assigning
			// `player.computer = true` gets silently overwritten within
			// seconds. The real item is what actually persists, is what a
			// human player would use for the same purpose, and is what
			// lets shops/crafting/etc. work from anywhere on the map
			// instead of requiring the bot to walk to one. Locked (l: "l")
			// so auto_sell's "first unlocked item" scan can never sell it.
			// Also does the farm-zone teleport, if configured - once, not
			// every tick, so it doesn't fight the bot's own movement.
			// calculate_player_stats() (which derives player.computer from
			// inventory) only runs on specific triggers - login, level up,
			// equip change - not every tick. It already ran once during
			// this connection's own auth a moment ago, before the item
			// existed, so without forcing it again here player.computer
			// would stay stale (false) for the rest of the session.
			var setup = [
				"var has_computer = player.items.some(function(it){ return it && (it.name === 'computer' || it.name === 'supercomputer'); });",
				"if (!has_computer && player.esize > 0) { add_item(player, { name: 'computer', l: 'l' }, {}); }",
				"calculate_player_stats(player);",
			];
			if (config && config.map) {
				setup.push("try { transport_player_to(player, " + JSON.stringify(config.map) + "); } catch (e) {}");
			}
			setup.push("output = { ok: true };");
			local_eval(session.display_name, setup.join("\n")).catch(function (e) {
				console.error("[bots] " + character_name + " setup eval failed: " + e.message);
			});
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

// Merchant mode: no combat, just keep the configured targets mluck'd. See
// the "mode" doc comment above for why this writes the condition object
// directly instead of calling the mluck skill handler.
function build_merchant_code(target_display_names) {
	var lines = [
		"if (player.rip) {",
		"  player.hp = player.max_hp; player.mp = player.max_mp; player.rip = false;",
		"} else {",
		"  var targets = " + JSON.stringify(target_display_names) + ";",
		"  for (var i = 0; i < targets.length; i++) {",
		"    var t = players[name_to_id[targets[i]]];",
		"    if (!t || t === player) continue;",
		"    var cond = t.s && t.s.mluck;",
		// Refresh once under 5 minutes remain, rather than every tick -
		// mirrors the skill handler's own "already strong from me" no-op
		// check (node/server.js) so this doesn't fight a real player-cast
		// mluck from someone else.
		"    if (!cond || cond.ms < 5 * 60 * 1000 || cond.f === player.name) {",
		"      t.s = t.s || {};",
		"      t.s.mluck = { ms: G.conditions.mluck.duration, f: player.name, strong: true };",
		"    }",
		"  }",
		"}",
		"output = { hp: player.hp, max_hp: player.max_hp, rip: player.rip };",
	];
	return lines.join("\n");
}

// Runs instead of build_ai_code/build_merchant_code when mode is "idle" -
// stays connected (so the party command center can move/equip items on it
// any time) without farming, fighting, or otherwise acting. Safety over
// realism: teleports once to the "main" map's own default spawn point (no
// explicit point argument - transport_player_to falls back to
// new_map.spawns[0], node/server.js:4328 - the same monster-free spot
// every new character and fast-traveler already lands on) and then just
// sits there - never picks a target, never walks toward anything, so it
// can't wander into a monster spawn on its own. rip-recovery still
// applies since aggro could theoretically still catch it during the one
// tick before its first teleport lands.
function build_idle_code() {
	return [
		"if (player.rip) {",
		"  player.hp = player.max_hp; player.mp = player.max_mp; player.rip = false;",
		"} else if (player.in !== 'main') {",
		"  try { transport_player_to(player, 'main'); } catch (e) {}",
		"}",
		"output = { hp: player.hp, max_hp: player.max_hp, rip: player.rip, in: player.in };",
	].join("\n");
}

// Runs instead of build_ai_code/build_merchant_code when mode is "custom" -
// full user control, same eval scope every other bot mode already uses.
function build_custom_code(config) {
	return [
		"if (player.rip) {",
		"  player.hp = player.max_hp; player.mp = player.max_mp; player.rip = false;",
		"} else {",
		config && config.custom_code ? config.custom_code : "",
		"}",
		"output = { hp: player.hp, max_hp: player.max_hp, rip: player.rip, target: player.target };",
	].join("\n");
}

// Built per-bot (not a single shared constant) since party_with/auto_sell
// differ per character. partner_display_name is resolved to the live
// name_to_id key (info.name) ahead of time, same reason local_eval's own
// character_name argument has to be - see the note on start_ticking's
// caller in main.js.
function build_ai_code(config, partner_display_name) {
	var lines = [
		"if (player.rip) {",
		"  player.hp = player.max_hp; player.mp = player.max_mp; player.rip = false;",
		"} else {",
	];
	if (partner_display_name) {
		lines.push(
			"  var partner = players[name_to_id[" + JSON.stringify(partner_display_name) + "]];",
			"  if (partner && (!player.party || player.party !== partner.party)) {",
			"    try {",
			"      partner.socket.fs.party({ event: 'invite', name: player.name });",
			"      player.socket.fs.party({ event: 'accept', name: partner.name });",
			"    } catch (e) {}",
			"  }",
		);
		if (config && config.mode === "companion") {
			lines.push(
				// Different map/instance entirely - catch up before trying to
				// do anything else. transport_player_to is the same real
				// function the farm-zone teleport and fast_travel already use.
				"  if (partner && player.in !== partner.in) {",
				"    try { transport_player_to(player, instances[partner.in].map); } catch (e) {}",
				"  } else if (partner) {",
				// No real pathfinding (same crude level as the rest of this
				// bot) - just nudge straight-line toward the leader, capped
				// per tick so it reads as walking rather than teleporting.
				"    var pdx = partner.x - player.x, pdy = partner.y - player.y;",
				"    var pdist = Math.sqrt(pdx * pdx + pdy * pdy);",
				"    if (pdist > 60) {",
				"      var pstep = Math.min(150, pdist - 40);",
				"      if (pstep > 0) {",
				"        player.x += (pdx / pdist) * pstep;",
				"        player.y += (pdy / pdist) * pstep;",
				"        player.going_x = player.x; player.going_y = player.y; player.moving = false;",
				"      }",
				"    }",
				"  }",
			);
		}
	}
	if (config && config.auto_sell) {
		lines.push(
			"  var free_slots = 0;",
			"  for (var i = 0; i < player.items.length; i++) if (!player.items[i]) free_slots++;",
			"  if (free_slots <= 2) {",
			"    for (var i = 0; i < player.items.length; i++) {",
			"      var it = player.items[i];",
			"      if (it && !it.l && !it.b) {",
			"        try { player.socket.fs.sell({ num: i, quantity: it.q || 1 }); } catch (e) {}",
			"        break;",
			"      }",
			"    }",
			"  }",
		);
	}
	// Passive companions (config.combat_mode === "passive") skip this whole
	// block: they still follow/teleport via the movement branch above, but
	// never pick a target or attack - for a companion you just want tagging
	// along without dragging you into fights you didn't ask for.
	var passive_companion = config && config.mode === "companion" && config.combat_mode === "passive";
	if (!passive_companion) {
		lines.push(
			"  var pool = (instances[player.in] && instances[player.in].monsters) || {};",
			"  var nearby = Object.values(pool).filter(function(m){",
			"    return m && !m.dead && simple_distance(player, m) < 320 && (m.level || 1) <= (player.level || 1) + 3;",
			"  });",
			"  nearby.sort(function(a, b){ return simple_distance(player, a) - simple_distance(player, b); });",
			"  if (player.hp > player.max_hp * 0.4) {",
		);
		if (config && config.mode === "companion") {
			// "partner" (declared above, in scope by var hoisting even if this
			// exact tick's party-sync branch didn't run) is the leader here -
			// copy their live target if it's a real, alive monster in this same
			// instance, before falling back to picking one nearby ourselves.
			lines.push(
				"    if (typeof partner !== 'undefined' && partner && partner.target && pool[partner.target] && !pool[partner.target].dead) {",
				"      player.target = partner.target;",
				"    }",
			);
		}
		lines.push(
			"    if (!player.target || !pool[player.target]) { if (nearby[0]) player.target = nearby[0].id; }",
			"    if (player.target && pool[player.target]) {",
			// A target (especially one copied from a companion's partner) can
			// easily be further away than the character's actual attack range
			// (player.range, from equipped weapon/skills) - the server's own
			// "attack" handler silently rejects an out-of-range attempt, which
			// with no movement step at all reads as "the bot just stands there
			// doing nothing." Close the distance first, same crude
			// straight-line nudge as the companion-follow logic above, and
			// only attack once actually in range.
			"      var tgt = pool[player.target];",
			"      var tdist = simple_distance(player, tgt);",
			"      var range = (player.range || 100) - 10;",
			"      if (tdist > range) {",
			"        var tdx = tgt.x - player.x, tdy = tgt.y - player.y;",
			"        var tstep = Math.min(150, tdist - range);",
			"        if (tstep > 0) {",
			"          player.x += (tdx / tdist) * tstep;",
			"          player.y += (tdy / tdist) * tstep;",
			"          player.going_x = player.x; player.going_y = player.y; player.moving = false;",
			"        }",
			"      } else {",
			"        try { player.socket.fs.skill({ name: 'attack', id: player.target }); } catch (e) {}",
			"      }",
			"    }",
			"  }",
		);
	}
	lines.push(
		"}",
		"output = { hp: player.hp, max_hp: player.max_hp, rip: player.rip, target: player.target };",
	);
	return lines.join("\n");
}

// NOT using adventure_functions.js's character_eval here: it builds its eval
// URL from the server's *public* address (server.address/api_path in
// MongoDB) - correct for the original multi-server architecture where the
// web backend and a game server can be different machines, but wrong for a
// bot that already lives in the same container as the game server it's
// controlling. Using it would mean every AI tick round-trips out through
// the public domain/Traefik back to itself - fragile (depends on the
// public address always being reachable from inside its own container) and
// pointlessly slow. Call the local eval endpoint directly instead.
// Also exported directly (not just via local_eval below): main.js's
// /admin/executor snippets run in the WEB process (main.js's own eval
// scope), a separate Node process from node/server.js - players, name_to_id,
// G, instances, add_item, transport_player_to, etc. only exist over there.
// raw_eval/local_eval are the only bridge between the two; a snippet that
// references those names directly, without going through one of these,
// silently no-ops (ReferenceError inside node/server.js's own try/catch).
async function raw_eval(code) {
	var def = server_def();
	var keys = require("./secretsandconfig/keys");
	var url = "http://127.0.0.1:" + def.local_port + def.api_path + "eval";
	var response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ spass: keys.ACCESS_MASTER, code: code, data: "{}" }).toString(),
	});
	return JSON.parse(await response.text());
}

async function local_eval(character_name, code) {
	var wrapped = "var player = players[name_to_id['" + character_name + "']]; if (player) { " + code + " }";
	return raw_eval(wrapped);
}

// True liveness check - is this display name a real player in node/server.js
// right now - as opposed to is_connected(), which only reflects bots.js's
// OWN connection pool and says nothing about a character the user is
// currently playing themselves (e.g. after switch_character's "Play as").
// A single raw_eval covering every character at once, not a call per name.
async function live_display_names() {
	var result = await raw_eval("output = Object.keys(name_to_id).filter(function(n){ return !!players[name_to_id[n]]; });");
	return Array.isArray(result) ? result : [];
}

// Party command center's item transfer: same core logic as node/server.js's
// real socket.on("send", ...) handler (create_new_sitem/can_add_item/
// add_item/add_to_history/resend - not a reimplementation, the exact same
// calls in the exact same order), minus the distance/same-map requirement
// that's meaningless from an out-of-game admin panel. Both characters must
// already be live player objects (bot-connected, in any mode including
// "idle") - there's no offline path, since add_item/calculate_player_stats
// assume a real connected player (socket, s, esize, etc.), and getting that
// wrong risks silently corrupting saved state. from/to_display_name are
// the original-cased name_to_id keys (see get_display_name in main.js),
// from_index is the inventory slot on the source character, quantity is
// optional (defaults to the whole stack).
async function transfer_item(from_display_name, from_index, to_display_name, quantity) {
	var code = [
		"var from_player = players[name_to_id[" + JSON.stringify(from_display_name) + "]];",
		"var to_player = players[name_to_id[" + JSON.stringify(to_display_name) + "]];",
		"if (!from_player || !to_player) { output = { failed: true, reason: 'not_connected' }; } else {",
		"  var num = " + JSON.stringify(from_index) + ";",
		"  var item = from_player.items[num];",
		"  if (!item) { output = { failed: true, reason: 'no_item' }; }",
		"  else if (item.l) { output = { failed: true, reason: 'item_locked' }; }",
		"  else {",
		"    var q = Math.max(1, Math.min(item.q || 1, " + JSON.stringify(quantity || null) + " || (item.q || 1)));",
		"    var candidate = item.q ? create_new_sitem(item, q) : item;",
		"    if (!can_add_item(to_player, candidate)) { output = { failed: true, reason: 'no_space' }; }",
		"    else {",
		"      if ((item.q || 1) == q) {",
		"        from_player.items[num] = from_player.citems[num] = null;",
		"        from_player.esize++;",
		"      } else {",
		"        from_player.items[num].q -= q;",
		"        from_player.citems[num] = cache_item(from_player.items[num]);",
		"      }",
		"      var dest_num = add_item(to_player, candidate, { announce: false });",
		"      add_to_history(from_player, { name: 'item', to: to_player.name, item: item.name, q: q, level: item.level });",
		"      add_to_history(to_player, { name: 'item', from: from_player.name, item: item.name, q: q, level: item.level });",
		"      resend(from_player, 'reopen+nc+inv');",
		"      resend(to_player, 'reopen+nc+inv');",
		"      output = { ok: true, dest_num: dest_num };",
		"    }",
		"  }",
		"}",
	].join("\n");
	return raw_eval(code);
}

// get_display_name(stored_name) resolves settings.json's lowercase key
// (character.name) to the live name_to_id lookup key (character.info.name,
// original casing) - works for any stored name, not just the bot's own, so
// it also resolves party_with/mluck_targets entries (which are stored the
// same way).
function start_ticking(get_display_name) {
	setInterval(async function () {
		for (var name in connections) {
			if (!is_connected(name)) continue;
			try {
				var display_name = await get_display_name(name);
				if (!display_name) continue;
				var config = connections[name].config || {};
				if (config.mode === "idle") {
					await local_eval(display_name, build_idle_code());
					continue;
				}
				if (config.mode === "merchant") {
					var target_names = [];
					for (var t = 0; t < (config.mluck_targets || []).length; t++) {
						var target_display_name = await get_display_name(config.mluck_targets[t]);
						if (target_display_name) target_names.push(target_display_name);
					}
					await local_eval(display_name, build_merchant_code(target_names));
					continue;
				}
				if (config.mode === "custom") {
					await local_eval(display_name, build_custom_code(config));
					continue;
				}
				var partner_display_name = config.party_with ? await get_display_name(config.party_with) : null;
				await local_eval(display_name, build_ai_code(config, partner_display_name));
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
				await connect_bot(db, name, desired[name]);
			} catch (e) {
				console.error("[bots] connect failed for " + name, e.message);
			}
		} else if (desired[name] && connections[name]) {
			connections[name].config = desired[name]; // pick up map/party_with/auto_sell edits live
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
	raw_eval: raw_eval,
	local_eval: local_eval,
	transfer_item: transfer_item,
	live_display_names: live_display_names,
};
