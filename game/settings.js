// Private-server settings: persisted to secretsandconfig/settings.json (same
// persisted, bind-mountable directory as keys.js/options.js), hand-editable,
// and hot-reloaded via a small watchdog — no restart needed to pick up a
// hand edit or an admin-panel save.
var fs = require("fs");
var path = require("path");
var EventEmitter = require("events");

var SETTINGS_PATH = path.resolve(__dirname, "secretsandconfig/settings.json");

var DEFAULTS = {
	xp_multiplier: 1,
	gold_multiplier: 1,
	luck_multiplier: 1,
	character_limit: 20,
	ip_limit: 20,
	discord_token: "",
	discord_chat_channel: "",
	// Ambient monster difficulty. Lower respawn_multiplier = monsters come back
	// faster (higher effective density with one player); lower
	// aggro_multiplier = fewer monsters attack on sight. Never applied to the
	// hand-tuned event bosses (Goo Brawl etc.) - those are fixed stats in
	// design/monsters.js, not scaled here.
	monster_respawn_multiplier: 1,
	monster_aggro_multiplier: 1,
	bots: {}, // { "CharacterName": { enabled: false, behavior: "farm", map: "main" } } — reserved for the bot runner
};

var emitter = new EventEmitter();
var current = Object.assign({}, DEFAULTS);

function read_from_disk() {
	try {
		var raw = fs.readFileSync(SETTINGS_PATH, "utf8");
		return Object.assign({}, DEFAULTS, JSON.parse(raw));
	} catch (e) {
		return Object.assign({}, DEFAULTS);
	}
}

function write_to_disk(value) {
	fs.writeFileSync(SETTINGS_PATH, JSON.stringify(value, null, 2) + "\n");
}

function reload() {
	var next = read_from_disk();
	current = next;
	emitter.emit("change", current);
}

if (!fs.existsSync(SETTINGS_PATH)) write_to_disk(current);
reload();

// Poll-based (fs.watchFile), not fs.watch: reliable across bind mounts and
// editors that replace-on-save (fs.watch can miss those or double-fire).
fs.watchFile(SETTINGS_PATH, { interval: 2000 }, reload);

module.exports = {
	get: function () {
		return current;
	},
	update: function (partial) {
		current = Object.assign({}, current, partial);
		write_to_disk(current);
		emitter.emit("change", current);
		return current;
	},
	onChange: function (cb) {
		emitter.on("change", cb);
	},
	path: SETTINGS_PATH,
};
