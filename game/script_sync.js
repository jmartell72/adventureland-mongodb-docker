// [private fork] Syncs externally-edited character scripts (e.g. from a
// real VS Code instance, editing files on the host at character-scripts/src/)
// into the game's own script storage, so you never touch the tiny in-game
// CODE editor. One file per character, named by the character's lowercase
// stored name (e.g. src/kingmartell.js).
//
// Writes to exactly the same two places save_code_api (api.js) writes to:
// the infoelement doc "IE_USERCODE-<owner>-<character_id>" holds the code
// text, and user.info.code_list[<character_id>] names/versions it. Using
// the character's own _id as the slot key (not an arbitrary saved-script
// slot) makes this the character's default code - js/game.js's own login
// logic falls back to `real_id` (the character's own id) as the code slot
// to load when nothing else was explicitly chosen
// (`code_slot = scode_slot || data["slot_"+real_id] || real_id`), so it
// loads automatically on that character's next connect. No live-reload of
// an already-connected session - same as saving from the in-game editor.
var fs = require("fs");
var path = require("path");

var SCRIPTS_DIR = path.resolve(__dirname, "character-scripts/src");
var POLL_MS = 3000;
var last_synced_mtime = {};

function list_script_files() {
	try {
		return fs.readdirSync(SCRIPTS_DIR).filter(function (f) {
			return f.endsWith(".js");
		});
	} catch (e) {
		return [];
	}
}

async function sync_file(db, filename) {
	var char_name = path.basename(filename, ".js").toLowerCase();
	var code = fs.readFileSync(path.join(SCRIPTS_DIR, filename), "utf8");
	var character = await db.collection("character").findOne({ name: char_name });
	if (!character) {
		console.error("[script_sync] no character named '" + char_name + "' (from " + filename + ") - skipping");
		return;
	}
	var character_id = "" + character._id;
	var owner_id = "" + character.owner;
	await db
		.collection("infoelement")
		.updateOne(
			{ _id: "IE_USERCODE-" + owner_id + "-" + character_id },
			{ $set: { info: { code: code } }, $setOnInsert: { created: new Date() } },
			{ upsert: true },
		);
	// code_list lives on a separate per-user "userdata" doc (also in
	// infoelement, "IE_userdata-<owner>"), NOT on the user account document -
	// same doc the tutorial-progress system uses. Missing fields besides
	// code_list (completed_tasks, tutorial_step, ...) are fine to leave
	// unset here: get_user_data()/process_user_data() default them back in
	// on every read regardless (adventure_functions.js).
	var userdata = await db.collection("infoelement").findOne({ _id: "IE_userdata-" + owner_id }, { projection: { "info.code_list": 1 } });
	var code_list = (userdata && userdata.info && userdata.info.code_list) || {};
	var next_version = ((code_list[character_id] || [null, 0])[1] || 0) + 1;
	var set = {};
	set["info.code_list." + character_id] = [character.info.name, next_version];
	await db.collection("infoelement").updateOne({ _id: "IE_userdata-" + owner_id }, { $set: set, $setOnInsert: { created: new Date() } }, { upsert: true });
	console.log("[script_sync] synced " + filename + " -> " + character.info.name + " (v" + next_version + ") - takes effect on that character's next connect");
}

function start(db) {
	if (!fs.existsSync(SCRIPTS_DIR)) {
		console.log("[script_sync] " + SCRIPTS_DIR + " not mounted - dormant");
		return;
	}
	setInterval(function () {
		list_script_files().forEach(function (filename) {
			var full_path = path.join(SCRIPTS_DIR, filename);
			var mtime;
			try {
				mtime = fs.statSync(full_path).mtimeMs;
			} catch (e) {
				return;
			}
			if (last_synced_mtime[filename] === mtime) return;
			last_synced_mtime[filename] = mtime;
			sync_file(db, filename).catch(function (e) {
				console.error("[script_sync] sync failed for " + filename, e.message);
			});
		});
	}, POLL_MS);
}

module.exports = { start: start };
