// [private fork] Syncs externally-edited character scripts (e.g. from a
// real VS Code instance, editing files on the host at character-scripts/src/)
// into the game's own script storage, so you never touch the tiny in-game
// CODE editor.
//
// Layout:
//   src/<charactername>/active.js  - that character's default/live code.
//   src/_library/<scriptname>.js   - account-wide saved scripts, not tied
//                                    to any one character (the game itself
//                                    already supports this: up to 100
//                                    named slots per account, loadable into
//                                    any character - this fork already had
//                                    some saved this way before script_sync
//                                    existed, e.g. "Upgrade Equipment").
//                                    Owner account is resolved from
//                                    whichever character folder(s) exist
//                                    alongside it - fine for a private
//                                    single-account server; there's no
//                                    per-account subfolder because there's
//                                    only ever one account here.
//
// Both write to exactly the same two places save_code_api (api.js) writes
// to: an infoelement doc "IE_USERCODE-<owner>-<slot>" holds the code text,
// and the separate per-user "IE_userdata-<owner>" doc's info.code_list
// names/versions it (NOT the user account document - a real mistake caught
// via live testing early on: get_user_data() reads a different document
// than what save_code_api's own variable names suggest). For a character's
// own slot, `slot` is that character's _id - js/game.js's login logic
// falls back to the character's own id as the code slot to load when
// nothing else was explicitly chosen, so it loads automatically on that
// character's next connect. For a library script, `slot` is just the
// filename - find_code_slot() (adventure_functions.js) matches a
// load-by-name request against the slot key OR the stored display name,
// so it doesn't need to be numeric.
//
// No live-reload of an already-connected session - same as saving from the
// in-game editor.
var fs = require("fs");
var path = require("path");

var SCRIPTS_ROOT = path.resolve(__dirname, "character-scripts/src");
var LIBRARY_DIR = "_library";
var POLL_MS = 3000;
var last_synced_mtime = {}; // full path -> mtimeMs

function list_character_dirs() {
	try {
		return fs
			.readdirSync(SCRIPTS_ROOT, { withFileTypes: true })
			.filter(function (d) {
				return d.isDirectory() && d.name !== LIBRARY_DIR;
			})
			.map(function (d) {
				return d.name;
			});
	} catch (e) {
		return [];
	}
}

function list_js_files(dir) {
	try {
		return fs.readdirSync(dir).filter(function (f) {
			return f.endsWith(".js");
		});
	} catch (e) {
		return [];
	}
}

function changed(full_path) {
	var mtime;
	try {
		mtime = fs.statSync(full_path).mtimeMs;
	} catch (e) {
		return false;
	}
	if (last_synced_mtime[full_path] === mtime) return false;
	last_synced_mtime[full_path] = mtime;
	return true;
}

async function write_code_slot(db, owner_id, slot, display_name, code) {
	owner_id = "" + owner_id;
	await db
		.collection("infoelement")
		.updateOne(
			{ _id: "IE_USERCODE-" + owner_id + "-" + slot },
			{ $set: { info: { code: code } }, $setOnInsert: { created: new Date() } },
			{ upsert: true },
		);
	var userdata = await db.collection("infoelement").findOne({ _id: "IE_userdata-" + owner_id }, { projection: { "info.code_list": 1 } });
	var code_list = (userdata && userdata.info && userdata.info.code_list) || {};
	var next_version = ((code_list[slot] || [null, 0])[1] || 0) + 1;
	var set = {};
	set["info.code_list." + slot] = [display_name, next_version];
	await db.collection("infoelement").updateOne({ _id: "IE_userdata-" + owner_id }, { $set: set, $setOnInsert: { created: new Date() } }, { upsert: true });
	return next_version;
}

async function sync_character_active(db, char_dir_name) {
	var full_path = path.join(SCRIPTS_ROOT, char_dir_name, "active.js");
	if (!changed(full_path)) return;
	var char_name = char_dir_name.toLowerCase();
	var character = await db.collection("character").findOne({ name: char_name });
	if (!character) {
		console.error("[script_sync] no character named '" + char_name + "' (from " + char_dir_name + "/active.js) - skipping");
		return;
	}
	var code = fs.readFileSync(full_path, "utf8");
	var version = await write_code_slot(db, character.owner, "" + character._id, character.info.name, code);
	console.log("[script_sync] synced " + char_dir_name + "/active.js -> " + character.info.name + "'s active slot (v" + version + ") - takes effect on next connect");
}

async function find_any_owner(db) {
	var dirs = list_character_dirs();
	for (var i = 0; i < dirs.length; i++) {
		var character = await db.collection("character").findOne({ name: dirs[i].toLowerCase() }, { projection: { owner: 1 } });
		if (character) return character.owner;
	}
	return null;
}

async function sync_library_file(db, owner_id, filename) {
	var full_path = path.join(SCRIPTS_ROOT, LIBRARY_DIR, filename);
	if (!changed(full_path)) return;
	var script_name = path.basename(filename, ".js");
	var code = fs.readFileSync(full_path, "utf8");
	var version = await write_code_slot(db, owner_id, script_name, script_name, code);
	console.log("[script_sync] synced _library/" + filename + " -> saved script '" + script_name + "' (v" + version + ")");
}

function start(db) {
	// Existence checked every tick, not once at boot - the mount can appear
	// after this process started (e.g. the volume was added and the
	// directory created later, without a fresh container restart).
	setInterval(async function () {
		if (!fs.existsSync(SCRIPTS_ROOT)) return;
		var char_dirs = list_character_dirs();
		for (var i = 0; i < char_dirs.length; i++) {
			try {
				await sync_character_active(db, char_dirs[i]);
			} catch (e) {
				console.error("[script_sync] sync failed for " + char_dirs[i], e.message);
			}
		}
		var library_dir = path.join(SCRIPTS_ROOT, LIBRARY_DIR);
		if (fs.existsSync(library_dir)) {
			var owner_id = await find_any_owner(db).catch(function () {
				return null;
			});
			if (owner_id) {
				var files = list_js_files(library_dir);
				for (var j = 0; j < files.length; j++) {
					try {
						await sync_library_file(db, owner_id, files[j]);
					} catch (e) {
						console.error("[script_sync] library sync failed for " + files[j], e.message);
					}
				}
			}
		}
	}, POLL_MS);
}

module.exports = { start: start };
