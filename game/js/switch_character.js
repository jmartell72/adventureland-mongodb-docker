// [private fork] Switch which owned character is the foreground (top-level)
// view, without dropping whichever one you were just playing if it has
// CODE:ACTIVE. Standalone widget (own DOM, own polling), same pattern as
// event_hud.js/fast_travel.js.
//
// How it actually works, reusing real primitives (nothing new server-side):
//   - log_in(user, character_id, auth) (js/game.js) re-authenticates the
//     SAME already-open socket as a different owned character - it's a
//     same-page transition, not a navigation (checked: it only requires an
//     existing `socket`, then emits "auth"; no window.location write
//     anywhere in it). That's what makes backgrounding-then-switching work
//     at all: nothing in the DOM gets torn down.
//   - start_character_runner(name, code_slot) (js/functions.js) is the
//     same function the game's own "control up to 4 characters" feature
//     uses to run an owned character in a hidden background iframe
//     (appended to #iframelist, which log_in's same-page transition never
//     touches). Called on the character you're LEAVING, before switching,
//     it keeps that character's CODE running exactly the way running it
//     as an extra background character normally does.
//   - owned_character(name)/window.X.characters is the same account-wide
//     character list start_character_runner itself reads from.
(function () {
	function switch_character(target_name) {
		if (typeof owned_character !== "function" || typeof log_in !== "function") return;
		var owned = owned_character(target_name);
		if (!owned) return add_log && add_log("No such character: " + target_name, "gray");
		if (typeof character !== "undefined" && character && character.code && character.name.toLowerCase() !== owned.name.toLowerCase()) {
			try {
				start_character_runner(character.name, typeof code_slot !== "undefined" ? code_slot : "");
			} catch (e) {
				console.error("[switch_character] failed to background " + character.name, e);
			}
		}
		log_in(user_id, owned.id, user_auth);
	}
	window.switch_character = switch_character;

	var el = null;
	function ensure_element() {
		if (el) return el;
		el = document.createElement("div");
		el.id = "switch-character-hud";
		el.style.cssText =
			"position:fixed; top:64px; left:50%; transform:translateX(-50%); z-index:150;" +
			"background:rgba(0,0,0,0.7); color:#fff; font-family:monospace; font-size:12px;" +
			"padding:3px 8px; border-radius:6px; white-space:nowrap;" +
			"border:1px solid rgba(255,255,255,0.15); display:none;";
		var select = document.createElement("select");
		select.id = "switch-character-select";
		select.style.cssText = "font-family:monospace; font-size:12px; margin-right:4px; max-width:160px;";
		var go = document.createElement("button");
		go.textContent = "Switch";
		go.style.cssText = "font-family:monospace; font-size:12px; cursor:pointer;";
		go.onclick = function () {
			if (select.value) switch_character(select.value);
		};
		el.appendChild(select);
		el.appendChild(go);
		document.body.appendChild(el);
		return el;
	}

	function populate(select) {
		if (typeof X === "undefined" || !X || !is_array(X.characters)) return;
		var present = {};
		for (var i = 0; i < select.options.length; i++) present[select.options[i].value] = true;
		X.characters.forEach(function (c) {
			if (character && c.name.toLowerCase() === character.name.toLowerCase()) return;
			if (present[c.name]) return;
			var option = document.createElement("option");
			option.value = c.name;
			option.textContent = c.name + " (Lv." + c.level + ")";
			select.appendChild(option);
		});
	}

	function poll() {
		if (typeof character === "undefined" || !character || typeof X === "undefined" || !X) return;
		var node = ensure_element();
		var select = document.getElementById("switch-character-select");
		populate(select);
		node.style.display = select.options.length ? "block" : "none";
	}

	setInterval(poll, 3000);
})();
