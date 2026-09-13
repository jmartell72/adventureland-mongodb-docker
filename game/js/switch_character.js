// [private fork] Leave the current character for the character-selection
// screen, backgrounding it first (if it has CODE:Active) so it keeps
// running instead of disconnecting. Standalone widget, same pattern as
// event_hud.js/fast_travel.js.
//
// Earlier version tried to re-authenticate the existing socket as a
// different character directly via log_in() - looked right from
// js/game.js's own source (log_in only checks `if (!socket)`), but broke
// in real use ("Connecting..." forever). The actual reason, found in
// node/server.js's "auth" handler:
//   if (!server.live || !observers[socket.id] || players[socket.id]) return;
// A socket that's already authenticated as a player (players[socket.id]
// truthy) silently no-ops on a second "auth" - no error, no response,
// nothing. There's no supported way to re-authenticate an already-playing
// socket as someone else; a fresh socket is required, which means a page
// navigation. So: background the outgoing character (start_character_runner
// - the same mechanism the game's own "control up to 4 characters" feature
// uses, appending a hidden iframe to #iframelist), then navigate to
// base_url - the exact same navigation the game's own built-in
// "/disconnect" chat command uses to leave your character for the
// selection screen (js/functions.js: `if (!name) window.location = base_url;`
// under the "disconnect" command). You then pick the next character from
// that normal screen - iframes are children of the page, so a background
// runner never survives a navigation either way; only the fresh page load
// on the OTHER side of it can re-open them, which is what
// restore_pending_runners() below does.
(function () {
	var PENDING_KEY = "aland_switch_pending_runners";

	// destination defaults to base_url (the character-select screen, same as
	// this file's own HUD button). party_command_center.js's "Play as X"
	// action passes a direct /character/<name>/in/<region>/<sname> URL
	// instead, so picking the target character is one click instead of
	// landing on the select screen and clicking it there too.
	function switch_character(destination) {
		var pending = [];
		try {
			pending = JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
		} catch (e) {}
		if (typeof character !== "undefined" && character && character.code) {
			try {
				start_character_runner(character.name, typeof code_slot !== "undefined" ? code_slot : "");
				pending.push({ name: character.name, code_slot: typeof code_slot !== "undefined" ? code_slot : "" });
				localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
			} catch (e) {
				console.error("[switch_character] failed to background " + character.name, e);
			}
		}
		window.location.href = destination || base_url;
	}
	window.switch_character = switch_character;

	function restore_pending_runners() {
		if (typeof character === "undefined" || !character || typeof start_character_runner !== "function") return;
		var pending = [];
		try {
			pending = JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
		} catch (e) {}
		if (!pending.length) return;
		try {
			localStorage.removeItem(PENDING_KEY);
		} catch (e) {}
		pending.forEach(function (p) {
			if (!p || !p.name || p.name.toLowerCase() === character.name.toLowerCase()) return;
			try {
				start_character_runner(p.name, p.code_slot);
			} catch (e) {
				console.error("[switch_character] failed to restore runner " + p.name, e);
			}
		});
	}

	var el = null;
	function ensure_element() {
		if (el) return el;
		el = document.createElement("div");
		el.id = "switch-character-hud";
		el.style.cssText =
			"position:fixed; top:64px; left:50%; transform:translateX(-50%); z-index:150;" +
			"background:rgba(0,0,0,0.7); color:#fff; font-family:monospace; font-size:12px;" +
			"padding:3px 8px; border-radius:6px; white-space:nowrap;" +
			"border:1px solid rgba(255,255,255,0.15); display:none; cursor:pointer;";
		el.textContent = "Switch Character";
		el.onclick = switch_character;
		document.body.appendChild(el);
		return el;
	}

	function poll() {
		restore_pending_runners();
		if (typeof character === "undefined" || !character) return;
		ensure_element().style.display = "block";
	}

	setInterval(poll, 3000);
})();
