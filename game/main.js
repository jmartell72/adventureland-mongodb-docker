var fs = require("fs"),
	path = require("path");
var keys = require("./secretsandconfig/keys");
var options = require("./secretsandconfig/options");
var settings = require("./settings.js"); // [private fork] see settings.js
var bots = require("./bots.js"); // [private fork] see bots.js
var { get_seo_paths } = require("./seo_paths.js");

eval("" + fs.readFileSync(path.resolve(__dirname, "common/init.js")));
reinit_from_options();

app.use("/sounds", express.static("./sounds", { maxAge: "30d" }));

// Override MongoDB connection from common/init.js with keys.mongodb_uri
if (keys.mongodb_uri) {
	client = new MongoClient(keys.mongodb_uri, keys.mongodb_config);
	client.connect();
	db = client.db(keys.mongodb_name);
}

eval("" + fs.readFileSync(path.resolve(__dirname, "version.js")));
var update_notes = require("./update_notes.js");
var latest_steam_news = require("./steam_news.js").create_news_loader();
if (Local) {
	const filePath = path.join(__dirname, "version.js");
	let lines = fs.readFileSync(filePath, "utf-8").split("\n");
	lines[0] = lines[0].replace(/Version\s*=\s*(\d+);/, (match, p1) => {
		const newVersion = parseInt(p1, 10) + 1;
		return `Version = ${newVersion};`;
	});
	fs.writeFileSync(filePath, lines.join("\n"), "utf-8");
}

eval("" + fs.readFileSync(path.resolve(__dirname, "common/js/common_functions.js")));
eval("" + fs.readFileSync(path.resolve(__dirname, "common/mongodb_functions.js")));
eval("" + fs.readFileSync(path.resolve(__dirname, "common/handlers.js")));

// Stub post-init functions so models.js can reference them (full definitions in adventure_functions.js)
function post_get_init_user(entity) {}
function post_get_init_character(entity) {}

eval("" + fs.readFileSync(path.resolve(__dirname, "models.js")));

// /design — order follows Python config.py import order (dependencies must load first)
eval("" + fs.readFileSync(path.resolve(__dirname, "design/projectiles.js")));
eval("" + fs.readFileSync(path.resolve(__dirname, "design/animations.js"))); // needs projectiles
eval("" + fs.readFileSync(path.resolve(__dirname, "design/achievements.js")));
eval("" + fs.readFileSync(path.resolve(__dirname, "design/game_design.js")));
eval("" + fs.readFileSync(path.resolve(__dirname, "design/games.js")));
eval("" + fs.readFileSync(path.resolve(__dirname, "design/conditions.js")));
eval("" + fs.readFileSync(path.resolve(__dirname, "design/sprites.js")));
eval("" + fs.readFileSync(path.resolve(__dirname, "design/dimensions.js")));
eval("" + fs.readFileSync(path.resolve(__dirname, "design/monsters.js")));
eval("" + fs.readFileSync(path.resolve(__dirname, "design/maps.js")));
eval("" + fs.readFileSync(path.resolve(__dirname, "design/npcs.js")));
eval("" + fs.readFileSync(path.resolve(__dirname, "design/multipliers.js")));
eval("" + fs.readFileSync(path.resolve(__dirname, "design/items.js")));
eval("" + fs.readFileSync(path.resolve(__dirname, "design/classes.js")));
eval("" + fs.readFileSync(path.resolve(__dirname, "design/levels.js")));
eval("" + fs.readFileSync(path.resolve(__dirname, "design/upgrades.js")));
eval("" + fs.readFileSync(path.resolve(__dirname, "design/drops.js"))); // needs items
eval("" + fs.readFileSync(path.resolve(__dirname, "design/skills.js"))); // needs conditions
eval("" + fs.readFileSync(path.resolve(__dirname, "design/events.js")));
eval("" + fs.readFileSync(path.resolve(__dirname, "design/recipes.js")));
eval("" + fs.readFileSync(path.resolve(__dirname, "design/titles.js")));
eval("" + fs.readFileSync(path.resolve(__dirname, "design/tokens.js")));
eval("" + fs.readFileSync(path.resolve(__dirname, "design/cosmetics.js")));
eval("" + fs.readFileSync(path.resolve(__dirname, "design/precomputed_images.js")));

// docs
eval("" + fs.readFileSync(path.resolve(__dirname, "docs/directory.js")));

eval("" + fs.readFileSync(path.resolve(__dirname, "adventure_functions.js")));
eval("" + fs.readFileSync(path.resolve(__dirname, "filters.js")));
eval("" + fs.readFileSync(path.resolve(__dirname, "api.js")));
eval("" + fs.readFileSync(path.resolve(__dirname, "mainframe.js")));
eval("" + fs.readFileSync(path.resolve(__dirname, "admin_bots.js")));
eval("" + fs.readFileSync(path.resolve(__dirname, "mcp_api.js")));
eval("" + fs.readFileSync(path.resolve(__dirname, "crons.js")));
eval("" + fs.readFileSync(path.resolve(__dirname, "common/admin.js")));
eval("" + fs.readFileSync(path.resolve(__dirname, "admin_dashboard.js")));

// [private fork] Bot connectors - see bots.js. Character docs store the
// name twice with different casing: the top-level "name" is a lowercase
// index field (what settings.json's bot keys use), while "info.name" keeps
// the original casing and is the actual key node/server.js's live
// name_to_id map uses - the tick needs the latter.
bots.start_ticking(async function (stored_name) {
	var character = await db.collection("character").findOne({ name: stored_name }, { projection: { "info.name": 1 } });
	return character && character.info && character.info.name;
});
bots.sync_with_settings(db).catch(function (e) {
	console.error("[bots] initial sync failed", e);
});
settings.onChange(function () {
	bots.sync_with_settings(db).catch(function (e) {
		console.error("[bots] settings-triggered sync failed", e);
	});
});

// ==================== [private fork] Admin settings panel ====================
// Single-admin settings UI - gated by the same is_admin() check as
// /admin/executor etc. Reads/writes settings.js, which persists to
// secretsandconfig/settings.json (hand-editable, hot-reloaded, no restart
// needed except where noted below).

function admin_list_backups() {
	var dir = "/backups";
	try {
		return fs
			.readdirSync(dir)
			.filter(function (f) {
				return f.endsWith(".archive.gz");
			})
			.map(function (f) {
				var stat = fs.statSync(path.join(dir, f));
				return { name: f, size: stat.size, mtime: stat.mtime };
			})
			.sort(function (a, b) {
				return b.mtime - a.mtime;
			});
	} catch (e) {
		return [];
	}
}

function admin_panel_html(s, saved, backup_status, characters) {
	function esc(v) {
		return ("" + v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
	}
	function human_size(bytes) {
		if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MB";
		return Math.round(bytes / 1024) + " KB";
	}
	var backups = admin_list_backups();
	characters = characters || [];
	return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Server Settings</title>
<style>
	body { background:#111; color:#ddd; font-family:monospace; padding:24px; max-width:640px; margin:0 auto; }
	h1 { color:#fff; font-size:20px; }
	fieldset { border:1px solid #444; border-radius:6px; margin-bottom:16px; padding:12px 16px; }
	legend { color:#9cf; padding:0 6px; }
	label { display:block; margin:10px 0 4px; color:#ccc; }
	input[type=text], input[type=number] { width:100%; box-sizing:border-box; background:#000; color:#eee; border:1px solid #555; border-radius:4px; padding:6px 8px; font-family:monospace; }
	.hint { color:#888; font-size:12px; margin-top:2px; }
	button { background:#2a6; color:#fff; border:none; border-radius:4px; padding:10px 20px; font-size:14px; cursor:pointer; margin-top:12px; }
	button:hover { background:#3b7; }
	.saved { color:#7d7; margin-bottom:12px; }
	.path { color:#666; font-size:12px; }
</style></head>
<body>
	<h1>Server Settings</h1>
	${saved ? '<div class="saved">Saved.</div>' : ""}
	<form method="post" action="/admin/panel/save">
		<fieldset>
			<legend>Progression pacing</legend>
			<label>XP multiplier<input type="number" step="0.1" min="0" name="xp_multiplier" value="${esc(s.xp_multiplier)}"></label>
			<label>Gold multiplier<input type="number" step="0.1" min="0" name="gold_multiplier" value="${esc(s.gold_multiplier)}"></label>
			<label>Luck multiplier<input type="number" step="0.1" min="0" name="luck_multiplier" value="${esc(s.luck_multiplier)}"></label>
			<div class="hint">Takes effect immediately, no restart.</div>
		</fieldset>
		<fieldset>
			<legend>Account limits</legend>
			<label>Character limit<input type="number" step="1" min="1" name="character_limit" value="${esc(s.character_limit)}"></label>
			<label>IP limit<input type="number" step="1" min="1" name="ip_limit" value="${esc(s.ip_limit)}"></label>
			<label>Inventory size<input type="number" step="1" min="9" max="500" name="inventory_size" value="${esc(s.inventory_size)}"></label>
			<div class="hint">Takes effect immediately, no restart. Inventory size: vanilla default is 42; the client's inventory grid sizes itself to this automatically.</div>
		</fieldset>
		<fieldset>
			<legend>Ambient monster difficulty</legend>
			<label>Respawn speed multiplier<input type="number" step="0.1" min="0.05" name="monster_respawn_multiplier" value="${esc(s.monster_respawn_multiplier)}"></label>
			<div class="hint">Below 1 = monsters respawn faster (more effective density with one player). Above 1 = slower.</div>
			<label>Aggro multiplier<input type="number" step="0.1" min="0" max="10" name="monster_aggro_multiplier" value="${esc(s.monster_aggro_multiplier)}"></label>
			<div class="hint">Scales how often monsters attack on sight. Doesn't affect the scheduled event bosses. New spawns only, no restart.</div>
		</fieldset>
		<fieldset>
			<legend>Discord relay</legend>
			<label>Bot token<input type="text" name="discord_token" value="${esc(s.discord_token)}" placeholder="leave blank to stay dormant"></label>
			<label>Chat channel ID<input type="text" name="discord_chat_channel" value="${esc(s.discord_chat_channel)}"></label>
			<div class="hint">Dormant with no token set. Changing the token requires a container restart to take effect.</div>
		</fieldset>
		<button type="submit">Save</button>
	</form>
	<p class="path">Also hand-editable at ${esc(settings.path)} - changes there are picked up automatically within a couple seconds.</p>

	<form method="post" action="/admin/panel/bots">
		<fieldset>
			<legend>Bots</legend>
			<div class="hint">Farm mode: conservative AI, attacks nearby monsters up to character level + 3, disengages below 40% HP. Merchant mode: no combat, keeps the selected mluck targets buffed on a timer.</div>
			${
				characters.length
					? characters
							.map(function (c) {
								var cfg = s.bots[c.name] || {};
								var enabled = !!cfg.enabled;
								var mode = cfg.mode === "merchant" ? "merchant" : "farm";
								var live = bots.is_connected(c.name);
								var other_names = characters.filter(function (o) {
									return o.name !== c.name;
								});
								var select_size = Math.min(4, Math.max(2, other_names.length || 1));
								return (
									'<div style="border:1px solid #444; border-radius:6px; padding:8px; margin-bottom:8px;">' +
									'<label style="display:flex; align-items:center; gap:8px;">' +
									'<input type="checkbox" name="bot_' +
									esc(c.name) +
									'" ' +
									(enabled ? "checked" : "") +
									">" +
									"<b>" +
									esc(c.name) +
									"</b>" +
									" (Lv." +
									esc(c.level || 1) +
									")" +
									(enabled ? (live ? ' <span style="color:#7d7">connected</span>' : ' <span style="color:#dd7">connecting...</span>') : "") +
									"</label>" +
									'<div style="display:flex; flex-wrap:wrap; gap:12px; margin-top:6px;">' +
									'<label>Mode<br><select name="mode_' +
									esc(c.name) +
									'"><option value="farm"' +
									(mode === "farm" ? " selected" : "") +
									'>Farm</option><option value="merchant"' +
									(mode === "merchant" ? " selected" : "") +
									">Merchant</option></select></label>" +
									'<label>Farm-zone map<br><input type="text" name="map_' +
									esc(c.name) +
									'" value="' +
									esc(cfg.map || "") +
									'" placeholder="e.g. main"></label>' +
									'<label>Party with<br><select name="party_' +
									esc(c.name) +
									'"><option value="">(none)</option>' +
									other_names
										.map(function (o) {
											return (
												'<option value="' +
												esc(o.name) +
												'"' +
												(cfg.party_with === o.name ? " selected" : "") +
												">" +
												esc(o.name) +
												"</option>"
											);
										})
										.join("") +
									"</select></label>" +
									'<label style="display:flex; align-items:center; gap:6px;"><input type="checkbox" name="autosell_' +
									esc(c.name) +
									'" ' +
									(cfg.auto_sell ? "checked" : "") +
									"> Auto-sell when inventory nearly full</label>" +
									'<label>Mluck targets (merchant mode)<br><select name="mlucktargets_' +
									esc(c.name) +
									'" multiple size="' +
									select_size +
									'" style="min-width:140px">' +
									other_names
										.map(function (o) {
											var selected = (cfg.mluck_targets || []).indexOf(o.name) !== -1;
											return '<option value="' + esc(o.name) + '"' + (selected ? " selected" : "") + ">" + esc(o.name) + "</option>";
										})
										.join("") +
									"</select></label>" +
									"</div></div>"
								);
							})
							.join("")
					: '<div class="hint">No characters on this account yet.</div>'
			}
			<button type="submit" style="margin-top:12px">Save bots</button>
		</fieldset>
	</form>

	<fieldset>
		<legend>World data backups</legend>
		${backup_status ? `<div class="saved">${esc(backup_status)}</div>` : ""}
		<div class="hint">Automatic backup every ${esc(process.env.BACKUP_INTERVAL_HOURS || 6)}h to /backups, keeping the newest ${esc(process.env.BACKUP_KEEP || 14)}. Safe to run on demand too.</div>
		<form method="post" action="/admin/panel/backup"><button type="submit">Backup now</button></form>
		${
			backups.length
				? "<ul>" +
					backups
						.slice(0, 10)
						.map(function (b) {
							return "<li>" + esc(b.name) + " — " + human_size(b.size) + " — " + esc(new Date(b.mtime).toISOString()) + "</li>";
						})
						.join("") +
					"</ul>"
				: '<div class="hint">No backups yet.</div>'
		}
	</fieldset>
</body></html>`;
}

app.get("/admin/panel", async (req, res) => {
	var user = await get_user(req);
	if (!is_admin(user)) return res.status(403).send("Forbidden");
	var backup_status = req.query.backup === "1" ? "Backup started." : req.query.backup === "0" ? "Backup failed - check container logs." : "";
	var characters = await db.collection("character").find({}, { projection: { name: 1, level: 1 } }).toArray();
	res.send(admin_panel_html(settings.get(), req.query.saved === "1", backup_status, characters));
});

app.post("/admin/panel/bots", async (req, res) => {
	var user = await get_user(req);
	if (!is_admin(user)) return res.status(403).send("Forbidden");
	var body = req.body || {};
	var characters = await db.collection("character").find({}, { projection: { name: 1 } }).toArray();
	var bots_config = {};
	characters.forEach(function (c) {
		var mlucktargets_raw = body["mlucktargets_" + c.name];
		var mluck_targets = Array.isArray(mlucktargets_raw) ? mlucktargets_raw : mlucktargets_raw ? [mlucktargets_raw] : [];
		bots_config[c.name] = {
			enabled: !!body["bot_" + c.name],
			mode: body["mode_" + c.name] === "merchant" ? "merchant" : "farm",
			map: (body["map_" + c.name] || "").trim(),
			party_with: body["party_" + c.name] || "",
			auto_sell: !!body["autosell_" + c.name],
			mluck_targets: mluck_targets,
		};
	});
	settings.update({ bots: bots_config });
	res.redirect("/admin/panel");
});

app.post("/admin/panel/backup", async (req, res) => {
	var user = await get_user(req);
	if (!is_admin(user)) return res.status(403).send("Forbidden");
	var { execFile } = require("child_process");
	execFile("/app/scripts/backup.sh", function (err, stdout, stderr) {
		if (err) console.error("[admin panel] backup failed", err, stderr);
	});
	// Don't block the response on the full dump - report "started" and let
	// the backup list on the next page load reflect it once done.
	res.redirect("/admin/panel?backup=1");
});

app.post("/admin/panel/save", async (req, res) => {
	var user = await get_user(req);
	if (!is_admin(user)) return res.status(403).send("Forbidden");
	var body = req.body || {};
	function num(value, fallback) {
		var n = Number(value);
		return Number.isFinite(n) ? n : fallback;
	}
	var current = settings.get();
	settings.update({
		xp_multiplier: num(body.xp_multiplier, current.xp_multiplier),
		gold_multiplier: num(body.gold_multiplier, current.gold_multiplier),
		luck_multiplier: num(body.luck_multiplier, current.luck_multiplier),
		character_limit: Math.max(1, Math.round(num(body.character_limit, current.character_limit))),
		ip_limit: Math.max(1, Math.round(num(body.ip_limit, current.ip_limit))),
		inventory_size: Math.max(9, Math.min(500, Math.round(num(body.inventory_size, current.inventory_size)))),
		monster_respawn_multiplier: Math.max(0.05, num(body.monster_respawn_multiplier, current.monster_respawn_multiplier)),
		monster_aggro_multiplier: Math.max(0, num(body.monster_aggro_multiplier, current.monster_aggro_multiplier)),
		discord_token: "" + (body.discord_token || ""),
		discord_chat_channel: "" + (body.discord_chat_channel || ""),
	});
	res.redirect("/admin/panel?saved=1");
});

// Stripe
try {
	var stripe = require("stripe")(Dev ? keys.stripe_test_api_key : keys.stripe_api_key);
} catch (e) {
	console.error("Stripe not loaded", e.message);
}

// ==================== ROUTES ====================

// [private fork] Event timer HUD data - public, read-only, same-origin (so
// game/js/event_hud.js can just fetch() this with no CORS setup). Reads the
// game server's own event/schedule state, which it saves to its Server doc
// roughly every 15s (see node/server.js's server_loop) - not truly live,
// but plenty fresh for a "next event in" style display.
app.get("/events_status", async (req, res) => {
	var server = await db.collection("server").findOne({}, { projection: { "info.events": 1, "info.event_schedule": 1 } });
	res.set("Cache-Control", "no-store");
	res.json({
		events: (server && server.info && server.info.events) || {},
		schedule: (server && server.info && server.info.event_schedule) || {},
		now: Date.now(),
	});
});

// Main page / Selection
app.get("/", async (req, res, next) => {
	var user = await get_user(req),
		domain = await get_domain(req, user);
	await render_selection(req, res, user, domain);
});

// Communication page
app.get("/comm", async (req, res, next) => {
	var user = await get_user(req),
		domain = await get_domain(req, user);
	var servers = await get_servers();
	var server = select_server(req, user, servers);
	var total = 0,
		characters = [],
		data = null;
	for (var i = 0; i < servers.length; i++) total += gf(servers[i], "players", 0);
	if (user) {
		characters = await get_characters(user);
		domain.characters = characters_to_client(characters);
		data = await get_user_data(user);
	}
	domain.servers = servers_to_client(domain, servers);
	res.status(200).send(
		nunjucks.render("htmls/comm.html", {
			domain: domain,
			user: user,
			user_data: data,
			server: server,
			servers: servers,
			total: total,
			characters: characters,
		}),
	);
});

// Mainframe character control
app.get("/mainframe", async (req, res) => {
	var user = await get_user(req),
		domain = await get_domain(req, user);
	domain.title = "Adventure Land Mainframe";
	return res
		.status(200)
		.set("Cache-Control", "no-store")
		.send(nunjucks.render("htmls/mainframe.html", { domain: domain, user: user }));
});

function get_vscode_extension_info() {
	var extension_dir = path.resolve(__dirname, "utility/vscode-adventureland");
	var info = {
		id: "adventureland.adventure-land-code-sync",
		name: "Adventure Land CODE Sync",
		version: "0.2.0",
		file: "adventure-land-code-sync-0.2.0.vsix",
		marketplace_url: "https://marketplace.visualstudio.com/items?itemName=adventureland.adventure-land-code-sync",
		marketplace_available: false,
		vscode_url: "vscode:extension/adventureland.adventure-land-code-sync",
		download_url: "",
		download_available: false,
	};
	try {
		var pkg = JSON.parse(fs.readFileSync(path.join(extension_dir, "package.json"), "utf8"));
		info.name = pkg.displayName || info.name;
		info.version = pkg.version || info.version;
		info.id = (pkg.publisher || "adventureland") + "." + (pkg.name || "adventure-land-code-sync");
		info.file = (pkg.name || "adventure-land-code-sync") + "-" + info.version + ".vsix";
		info.marketplace_url = "https://marketplace.visualstudio.com/items?itemName=" + info.id;
		info.vscode_url = "vscode:extension/" + info.id;
	} catch (e) {}
	var vsix_path = path.join(extension_dir, info.file);
	if (fs.existsSync(vsix_path)) {
		info.download_url = "/vscode/" + info.file;
		info.download_available = true;
		info.vsix_path = vsix_path;
	}
	return info;
}

app.get("/codes", async (req, res) => {
	return res.redirect(302, "/vscode");
});

app.get("/vscode", async (req, res) => {
	var user = await get_user(req),
		domain = await get_domain(req, user);
	domain.title = "Adventure Land for VS Code";
	return res
		.status(200)
		.set("Cache-Control", "no-store")
		.send(nunjucks.render("htmls/vscode.html", { domain: domain, user: user, extension: get_vscode_extension_info() }));
});

app.get("/vscode/:file", async (req, res, next) => {
	var extension = get_vscode_extension_info();
	if (!extension.download_available || req.params.file !== extension.file) return next();
	return res.download(extension.vsix_path, extension.file);
});

// Character profile page
app.get("/character/:name", async (req, res, next) => {
	var user = await get_user(req),
		domain = await get_domain(req, user);
	var character = await get_character(req.params.name);
	if (!character) return res.status(200).send(nunjucks.render("htmls/simple_message.html", { domain: domain, message: "Not Found" }));
	if (!user) {
		var ref = character.private ? req.params.name : character.owner;
		set_cookie(res, "referrer", ref, domain.domain);
		var ip = await get_ip_info(req);
		ip.referrer = ref;
		await put_ip_info(ip);
	}
	domain.title = character.info.name || character.name;
	res.status(200).send(nunjucks.render("htmls/character.html", { domain: domain, character: character }));
});

// All characters listing
app.get("/characters", async (req, res, next) => {
	var user = await get_user(req),
		domain = await get_domain(req, user);
	var characters = await db.collection("character").find({}).sort({ level: -1 }).limit(500).toArray();
	domain.title = "Characters";
	res.status(200).send(nunjucks.render("htmls/player.html", { domain: domain, characters: characters }));
});

// Player profile page
app.get("/player/:name", async (req, res, next) => {
	var user = await get_user(req),
		domain = await get_domain(req, user);
	var character = await get_character(req.params.name);
	if (!character) return res.status(200).send(nunjucks.render("htmls/simple_message.html", { domain: domain, message: "Not Found" }));
	var player = await get(character.owner);
	if (!player) return res.status(200).send(nunjucks.render("htmls/simple_message.html", { domain: domain, message: "Not Found" }));
	if (!user) {
		var ref = character.private ? req.params.name : get_id(player);
		set_cookie(res, "referrer", ref, domain.domain);
		var ip = await get_ip_info(req);
		ip.referrer = ref;
		await put_ip_info(ip);
	}
	domain.title = player.name;
	var characters = [];
	var entities;
	if (character.private) {
		entities = [character];
		domain.title = character.info.name || character.name;
	} else {
		entities = await db
			.collection("character")
			.find({ owner: character.owner, private: { $ne: true } })
			.toArray();
	}
	if (!entities.length) {
		entities = [character];
		domain.title = character.info.name || character.name;
	}
	var player_chars = gf(player, "characters", []);
	for (var i = 0; i < player_chars.length; i++) {
		for (var j = 0; j < entities.length; j++) {
			if (simplify_name(entities[j].name) === simplify_name(player_chars[i].name)) {
				characters.push(entities[j]);
			}
		}
	}
	res.status(200).send(nunjucks.render("htmls/player.html", { domain: domain, characters: characters }));
});

// Merchants listing
app.get("/merchants", async (req, res, next) => {
	var user = await get_user(req),
		domain = await get_domain(req, user);
	domain.title = "All Online Merchants!";
	var entities = await db.collection("character").find({ online: true, type: "merchant" }).toArray();
	res.status(200).send(nunjucks.render("htmls/player.html", { domain: domain, characters: entities, merchants: true }));
});

// Character + server selection (enter game)
app.get("/character/:name/in/:region/:sname", async (req, res, next) => {
	var user = await get_user(req);
	var domain = await get_domain(req, user),
		level = 80;
	var servers = await get_servers();
	var code = req.query.code;
	if (code) domain.explicit_slot = code;
	var user_chars = gf(user, "characters", []);
	for (var i = 0; i < user_chars.length; i++) {
		if (simplify_name(user_chars[i].name) === simplify_name(req.params.name)) {
			domain.character_name = user_chars[i].name;
			domain.url_character = user_chars[i].id;
			level = user_chars[i].level;
		}
	}
	for (var i = 0; i < servers.length; i++) {
		if (servers[i].region === req.params.region && servers[i].name === req.params.sname) {
			domain.url_address = servers[i].address;
			domain.url_path = servers[i].path;
		}
	}
	await render_selection(req, res, user, domain, level);
});

// Server selection
app.get("/server/:region/:sname", async (req, res, next) => {
	var user = await get_user(req);
	var domain = await get_domain(req, user);
	var servers = await get_servers();
	var S = null;
	for (var i = 0; i < servers.length; i++) {
		if (servers[i].region === req.params.region && servers[i].name === req.params.sname) S = servers[i];
	}
	await render_selection(req, res, user, domain, 80, S);
});

// Email verification
app.get("/ev/:uid/:v", async (req, res, next) => {
	var domain = await get_domain(req);
	var user = await get(normalize_user_id(req.params.uid));
	var message = "Email Verification Failed";
	if (user && !gf(user, "verified")) {
		if (gf(user, "everification") === req.params.v) {
			var R = await tx(
				async () => {
					R.element = await tx_get(A.user);
					R.element.info.verified = true;
					await tx_save(R.element);
				},
				{ user: user },
			);
			if (!R.failed) message = "Your Email Is Now Verified";
		}
	} else if (user) {
		message = "Your Email Is Already Verified";
	}
	res.status(200).send(nunjucks.render("htmls/simple_message.html", { domain: domain, message: message }));
});

// Password reset page
app.get("/reset/:uid/:key", async (req, res, next) => {
	var domain = await get_domain(req);
	var user = await get(normalize_user_id(req.params.uid));
	if (user && gf(user, "password_key", "123") === req.params.key) {
		res.status(200).send(nunjucks.render("htmls/contents/password_reset.html", { domain: domain, user: user, id: req.params.uid, key: req.params.key }));
	} else {
		res.status(200).send(nunjucks.render("htmls/simple_message.html", { domain: domain, message: "Invalid Password Reset URL" }));
	}
});

// User code serving
app.all("/code.js", async (req, res, next) => {
	var user = await get_user(req),
		domain = await get_domain(req, user);
	var name = req.query.name || req.body.name;
	if (user) {
		var data = await get_user_data(user);
		var code_list = gf(data, "code_list", {});
		var slot = find_code_slot(code_list, name);
		if (slot !== null) {
			var code = await get("IE_USERCODE-" + get_id(user) + "-" + slot);
			if (code)
				return res
					.status(200)
					.set("Content-Type", "application/javascript")
					.send("" + code.info.code);
		}
	}
	if (req.query.xrequire) res.status(200).set("Content-Type", "application/javascript").send("throw('xrequire: Code not found')");
	else res.status(200).set("Content-Type", "application/javascript").send("game_log('load_code: Code not found',colors.code_error)");
});

// Game data serving
app.all("/data.js", async (req, res, next) => {
	var domain = await get_domain(req),
		additional = "",
		geometry = {},
		rpc = {};
	for (var id in maps) {
		if (maps[id].ignore) continue;
		rpc[id] = get("MP_" + maps[id].key);
	}
	for (var id in maps) {
		if (maps[id].ignore) continue;
		var map = await rpc[id];
		if (map) geometry[id] = map.info.data;
	}
	var G = {
		version: Version,
		achievements: achievements,
		animations: animations,
		monsters: monsters,
		sprites: sprites,
		maps: maps,
		geometry: geometry,
		npcs: npcs,
		tilesets: tilesets,
		imagesets: imagesets,
		items: items,
		sets: sets,
		craft: craft,
		titles: titles,
		tokens: tokens,
		dismantle: dismantle,
		conditions: conditions,
		cosmetics: cosmetics,
		projectiles: projectiles,
		classes: classes,
		dimensions: dimensions,
		levels: levels,
		positions: positions,
		skills: skills,
		games: games,
		events: events,
		images: precomputed.images,
		multipliers: multipliers,
		docs: docs,
		drops: drops,
	};
	if (req.query.reload || (req.body && req.body.reload)) additional = "add_log('Game data reloaded','#32A3B0');\napply_backup()\n";
	res
		.status(200)
		.set("Content-Type", "application/javascript")
		.set("Cache-Control", "public, max-age=2592000")
		.send("var G=" + JSON.stringify(G) + ";\n" + additional);
});

// Shells / Payment page
app.get("/shells", async (req, res, next) => {
	var user = await get_user(req),
		domain = await get_domain(req, user);
	var servers = await get_servers();
	var server = select_server(req, user, servers);
	domain.stripe_enabled = true;
	res.status(200).send(nunjucks.render("htmls/payments.html", { domain: domain, user: user, server: server, extra_shells: extra_shells }));
});

app.get("/steam-purchase", async (req, res, next) => {
	var domain = await get_domain(req);
	res.set("Cache-Control", "no-store");
	res.set("X-Robots-Tag", "noindex, nofollow");
	res.status(200).send(nunjucks.render("htmls/steam_purchase.html", { domain: domain }));
});

app.get("/steam-purchase-status", async (req, res, next) => {
	var order_id = "" + (req.query.order_id || ""),
		return_token = "" + (req.query.token || "");
	res.set("Cache-Control", "no-store");
	if (!/^[0-9]{1,20}$/.test(order_id) || !/^[a-f0-9]{48}$/.test(return_token)) return res.status(404).send({ state: "invalid" });

	var purchase = await db.collection(STEAM_PURCHASE_COLLECTION).findOne({ _id: order_id, return_token: return_token });
	if (!purchase) return res.status(404).send({ state: "invalid" });
	if (purchase.state === "delivered") return res.status(200).send({ state: "complete", shells: purchase.shells });
	if (["declined", "init_failed", "checkout_unavailable", "failed"].indexOf(purchase.state) !== -1) return res.status(200).send({ state: "failed" });
	return res.status(200).send({ state: "processing" });
});

// Resort Map Editor - GET
app.get("/map/:name/:suffix?", async (req, res, next) => {
	var name = req.params.name;
	if (!name) return res.status(404).send("");
	name = name.split("/")[0];
	var user = await get_user(req),
		domain = await get_domain(req, user);
	if (security_threat(req, domain)) return res.status(403).send("security_threat");
	if (!user || (!name.startsWith(get_id(user) + "_") && !gf(user, "map_editor"))) return res.status(403).send("");
	var number = name.split("_")[1];
	if (["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].indexOf(number) === -1) return res.status(400).send("");
	var map = await get("MP_" + name);
	var mtilesets = JSON.parse(JSON.stringify(tilesets));
	if (!mtilesets.this_map) mtilesets.this_map = { file: "/images/tiles/map/resort_default.png" };
	if (!mtilesets.this_map_a) mtilesets.this_map_a = { file: "/images/tiles/map/resort_default_a.png" };
	res.status(200).send(nunjucks.render("utility/htmls/map_editor.html", { domain: domain, name: name, map: map, tilesets: mtilesets, community: 1, resort: 1 }));
});

// Resort Map Editor - POST
app.post("/map/:name/:suffix?", async (req, res, next) => {
	var data = req.body.data;
	var name = req.params.name;
	if (!name) return res.status(404).send("");
	name = name.split("/")[0];
	var user = await get_user(req),
		domain = await get_domain(req, user);
	if (!user || !name.startsWith(get_id(user) + "_")) return res.status(403).send("");
	var number = name.split("_")[1];
	if (["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].indexOf(number) === -1) return res.status(400).send("");
	var map = await get("MP_" + name);
	if (!map) map = { _id: "MP_" + name, created: new Date(), info: {}, blobs: ["info"] };
	if (typeof data === "string") data = JSON.parse(data);
	map.info.data = data;
	process_map(map);
	map.player = true;
	map.updated = new Date();
	await save(map);
	res.status(200).send("" + to_pretty_num(JSON.stringify(map.info.data).length));
});

// Community map viewer (public, read-only) — mirrors Flask /communitymaps/<name> GET.
// No POST handler intentionally: writes are not exposed here.
app.get("/communitymaps/:name", async (req, res, next) => {
	var name = req.params.name;
	if (!name) return res.status(404).send("no map");
	name = name.split("/")[0];
	var user = await get_user(req),
		domain = await get_domain(req, user);
	var map = await get("MP_" + name);
	res.status(200).send(
		nunjucks.render("utility/htmls/map_editor.html", {
			domain: domain,
			name: "main",
			map: map,
			tilesets: tilesets,
			community: 1,
		}),
	);
});

// Artist / admin map editor — mirrors Flask /editmap and /editmap/<name>.
// Requires user with map_editor flag or admin.
app.get("/editmap", async (req, res, next) => {
	res.redirect("/editmap/main");
});

app.get("/editmap/:name", async (req, res, next) => {
	var name = req.params.name;
	if (!name) return res.status(404).send("no map");
	name = name.split("/")[0];
	var user = await get_user(req),
		domain = await get_domain(req, user);
	if (!user || (!gf(user, "map_editor") && !is_admin(user))) return res.status(403).send("Not Permitted!");
	var map = await get("MP_" + name);
	res.status(200).send(
		nunjucks.render("utility/htmls/map_editor.html", {
			domain: domain,
			name: name,
			map: map,
			tilesets: tilesets,
			community: 1,
		}),
	);
});

app.post("/editmap/:name", async (req, res, next) => {
	var data = req.body.data;
	var name = req.params.name;
	if (!name) return res.status(404).send("no map");
	name = name.split("/")[0];
	var user = await get_user(req);
	if (!user || (!gf(user, "map_editor") && !is_admin(user))) return res.status(403).send("Not Permitted!");
	var map = await get("MP_" + name);
	if (!map) map = { _id: "MP_" + name, created: new Date(), info: {}, blobs: ["info"] };
	if (typeof data === "string") data = JSON.parse(data);
	map.info.data = data;
	process_map(map);
	map.updated = new Date();
	await save(map);
	// Mirror Flask copy_map(name, "test"): push saved data to MP_test for in-game testing.
	// Intentionally bypasses copy_map_api's in-use guard — this is the artist test loop.
	var test_map = await get("MP_test");
	if (!test_map) test_map = { _id: "MP_test", name: "test", created: new Date(), info: {}, blobs: ["info"] };
	test_map.info = JSON.parse(JSON.stringify(map.info));
	test_map.updated = new Date();
	await save(test_map);
	res.status(200).send("" + to_pretty_num(JSON.stringify(map.info.data).length));
});

// Maps listing
app.get("/maps/:order?", async (req, res, next) => {
	var domain = await get_domain(req);
	var order = req.params.order || "";
	var url = Dev ? domain.base_url + "/editmap" : domain.base_url + "/communitymaps";
	var html = "<style> html{background-color:gray}</style>";
	var query = order === "key" ? {} : {};
	var sort = order === "key" ? { _id: 1 } : { updated: -1 };
	var maps_list = await db.collection("map").find(query).sort(sort).limit(5000).toArray();
	for (var i = 0; i < maps_list.length; i++) {
		var m = maps_list[i];
		html +=
			"<div style='margin-bottom: 2px'><a href='" +
			url +
			"/" +
			get_id(m).replace("MP_", "") +
			"' target='_blank' style='color: white; font-weight: bold; text-decoration:none'>" +
			get_id(m).replace("MP_", "") +
			"</a></div>";
	}
	res.status(200).send(html);
});

// Community sprite-sheet selector (public — mirrors Flask /communityselector)
// Renders only imagesets pre-defined in design/sprites.js — no filesystem access,
// no user-controlled paths reach nunjucks or any IO.
app.get("/communityselector", async (req, res, next) => {
	var user = await get_user(req),
		domain = await get_domain(req, user);
	res.status(200).send(nunjucks.render("utility/htmls/imagesets/select-imageset.html", { domain: domain, imagesets: imagesets }));
});

app.get("/communityselector/:name", async (req, res, next) => {
	var name = req.params.name;
	if (!name) return res.status(404).send("");
	name = name.split("/")[0];
	if (!Object.prototype.hasOwnProperty.call(imagesets, name)) return res.status(404).send("");
	var imageset = imagesets[name];
	var size = imageset.size,
		width = imageset.columns * size,
		height = imageset.rows * size,
		xs = [],
		ys = [];
	for (var i = 0; i < imageset.columns; i++) xs.push(i);
	for (var j = 0; j < imageset.rows; j++) ys.push(j);
	var user = await get_user(req),
		domain = await get_domain(req, user);
	res.status(200).send(
		nunjucks.render("utility/htmls/imagesets/selector.html", {
			domain: domain,
			name: name,
			file: imageset.file,
			size: size,
			width: width,
			height: height,
			xs: xs,
			ys: ys,
			scale: 3,
		}),
	);
});

// Static pages
app.get("/privacy", async (req, res, next) => {
	var user = await get_user(req),
		domain = await get_domain(req, user);
	res.status(200).send(nunjucks.render("htmls/page.html", { domain: domain, user: user, content: "privacy" }));
});
app.get("/terms", async (req, res, next) => {
	var user = await get_user(req),
		domain = await get_domain(req, user);
	res.status(200).send(nunjucks.render("htmls/page.html", { domain: domain, user: user, content: "terms" }));
});
app.get("/contact", async (req, res, next) => {
	var user = await get_user(req),
		domain = await get_domain(req, user);
	res.status(200).send(nunjucks.render("htmls/page.html", { domain: domain, user: user, content: "contact" }));
});
app.get("/credits", async (req, res, next) => {
	var user = await get_user(req),
		domain = await get_domain(req, user);
	res.status(200).send(nunjucks.render("htmls/page.html", { domain: domain, user: user, content: "credits" }));
});

// Docs
app.get("/docs/:path0?/:path1?/:path2?/:path3?", async (req, res, next) => {
	var user = await get_user(req),
		domain = await get_domain(req, user);
	var p = [req.params.path0, req.params.path1, req.params.path2, req.params.path3];
	set_docs_seo(domain, p);
	res.status(200).send(nunjucks.render("htmls/docs.html", { domain: domain, user: user, content: "docs", dpath: p, extras: true }));
});

app.get("/robots.txt", function (req, res) {
	res.type("text/plain").send("User-agent: *\nAllow: /\nSitemap: " + SEO_ORIGIN + "/sitemap.xml\n");
});

app.get("/sitemap.xml", function (req, res) {
	var guide_articles = fs
		.readdirSync(path.resolve(__dirname, "docs/guide"))
		.filter(function (file) {
			return file.endsWith(".html");
		})
		.map(function (file) {
			return file.slice(0, -5);
		});
	var code_articles = fs
		.readdirSync(path.resolve(__dirname, "docs/articles"))
		.filter(function (file) {
			return file.endsWith(".html");
		})
		.map(function (file) {
			return file.slice(0, -5);
		});
	var paths = get_seo_paths({ docs: docs, guide_articles: guide_articles, code_articles: code_articles, items: items, monsters: monsters });
	var urls = paths
		.map(function (seo_path) {
			return "\t<url><loc>" + SEO_ORIGIN + seo_path + "</loc></url>";
		})
		.join("\n");
	res.type("application/xml").send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + "\n</urlset>\n");
});

// Runner, executor, logs pages
app.get("/runner", async (req, res, next) => {
	var domain = await get_domain(req);
	res.status(200).send(nunjucks.render("htmls/runner.html", { domain: domain }));
});
app.get("/executor", async (req, res, next) => {
	var domain = await get_domain(req);
	res.status(200).send(nunjucks.render("htmls/executor.html", { domain: domain }));
});
app.get("/logs", async (req, res, next) => {
	var user = await get_user(req),
		domain = await get_domain(req, user);
	res.status(200).send(nunjucks.render("htmls/logs.html", { domain: domain, user: user }));
});
app.get("/linux", async (req, res, next) => {
	var user = await get_user(req),
		domain = await get_domain(req, user);
	res.status(200).send(nunjucks.render("htmls/linux.html", { domain: domain, user: user }));
});
app.get("/macos", async (req, res, next) => {
	var user = await get_user(req),
		domain = await get_domain(req, user);
	res.status(200).send(nunjucks.render("htmls/macos.html", { domain: domain, user: user }));
});
app.get("/allnotes", async (req, res, next) => {
	var user = await get_user(req),
		domain = await get_domain(req, user);
	res.status(200).send(nunjucks.render("htmls/allnotes.html", { domain: domain, user: user, update_notes: update_notes }));
});
app.get("/update-notes", function (req, res) {
	var page_size = 20,
		offset = Math.max(0, parseInt(req.query.offset, 10) || 0),
		notes = update_notes.slice(offset, offset + page_size);
	res.status(200).send({ notes: notes, more: offset + notes.length < update_notes.length });
});
app.get("/steam-news", async function (req, res) {
	var post = await latest_steam_news();
	res.set("Cache-Control", "public, max-age=60");
	res.status(post ? 200 : 503).send(post || { error: "Steam news unavailable" });
});
app.get("/roadmap", async (req, res, next) => {
	var user = await get_user(req),
		domain = await get_domain(req, user);
	res.status(200).send(nunjucks.render("htmls/roadmap.html", { domain: domain, user: user }));
});
app.get("/realm/:map?", async (req, res, next) => {
	if (req.params.map && (!Object.prototype.hasOwnProperty.call(maps, req.params.map) || maps[req.params.map].ignore)) return next();
	var user = await get_user(req),
		domain = await get_domain(req, user);
	domain.title = "Realm Atlas | Adventure Land";
	res.set("Cache-Control", "no-store");
	res.set("X-Robots-Tag", "noindex, nofollow");
	res.status(200).send(nunjucks.render("htmls/realm.html", { domain: domain, user: user }));
});
app.get("/drm-free", async (req, res, next) => {
	var user = await get_user(req),
		domain = await get_domain(req, user);
	res.status(200).send(nunjucks.render("htmls/drmfree.html", { domain: domain, user: user }));
});
app.get("/it-is-what-it-is", async (req, res, next) => {
	var user = await get_user(req),
		domain = await get_domain(req, user);
	res.status(200).send(nunjucks.render("htmls/disclaimers.html", { domain: domain, user: user }));
});

// Dev rearm
app.get("/rearm", async (req, res, next) => {
	if (!Dev) return res.status(403).send("");
	// Free all servers and unlock all
	await db.collection("server").updateMany({}, { $set: { online: false } });
	await db.collection("character").updateMany({ online: true }, { $set: { online: false, server: "" } });
	res.status(200).send("done!");
});

// Referrer redirect
app.get("/r/:ref", async (req, res, next) => {
	var referrer = await get(normalize_user_id(req.params.ref));
	if (referrer) {
		var domain = await get_domain(req);
		set_cookie(res, "referrer", get_id(referrer), domain.domain);
		var ip = await get_ip_info(req);
		ip.referrer = get_id(referrer);
		await put_ip_info(ip);
	}
	res.redirect("/");
});

// ==================== API (backward compat for /api with method in body) ====================

app.all("/api", async (req, res, next) => {
	var method = req.body.method || req.query.method;
	if (method) {
		req.params.method = method;
		var args = req.body.arguments || req.query.arguments;
		if (args && typeof args === "string") {
			try {
				req.body = JSON.parse(args);
			} catch (e) {}
		}
		return handle_api_call(req, res, next);
	}
	res.status(400).send({ failed: true, reason: "no_method" });
});

// ==================== START ====================

const PORT = process.env.PORT || options.port;
app.listen(PORT, () => {
	console.log(`\x1b[32mAdventure Land\x1b[0m listening on port ${PORT}`);
});

process.on("uncaughtException", function (err) {
	console.error("#EXC Caught exception:", err);
});

process.on("unhandledRejection", function (err) {
	console.error("#EXC Unhandled rejection:", err);
});

module.exports = app;
