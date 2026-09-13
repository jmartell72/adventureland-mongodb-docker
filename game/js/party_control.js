// [private fork] Right-click a party member's icon (render_party() in
// html.js) to open a small "Attacking" / "Passive" menu for that
// character's bots.js companion mode. Left-click keeps the native
// party_click() behavior (target/heal) untouched - this only adds a
// second, right-click-triggered action, same widget pattern as
// switch_character.js/fast_travel.js.
//
// Only meaningful for a character that's already configured as a
// "companion" bot in the admin panel: the server-side check in
// /admin/panel/bots/combat_mode 404s (silently, from this menu's
// perspective) for anything else, since there's no bots.js config to
// toggle. Passive just skips the attack/target-copy block in
// build_ai_code - the companion still follows.
(function () {
	var el = null;
	function ensure_element() {
		if (el) return el;
		el = document.createElement("div");
		el.id = "party-control-menu";
		el.style.cssText =
			"position:fixed; z-index:200; background:rgba(0,0,0,0.85); color:#fff;" +
			"font-family:monospace; font-size:12px; border-radius:6px;" +
			"border:1px solid rgba(255,255,255,0.2); display:none; overflow:hidden;";
		document.body.appendChild(el);
		document.addEventListener("click", function (e) {
			if (el && e.target !== el && !el.contains(e.target)) el.style.display = "none";
		});
		return el;
	}

	function option(label, onclick) {
		var row = document.createElement("div");
		row.textContent = label;
		row.style.cssText = "padding:6px 12px; cursor:pointer; white-space:nowrap;";
		row.onmouseenter = function () {
			row.style.background = "rgba(255,255,255,0.15)";
		};
		row.onmouseleave = function () {
			row.style.background = "transparent";
		};
		row.onclick = function (e) {
			e.stopPropagation();
			ensure_element().style.display = "none";
			onclick();
		};
		return row;
	}

	async function set_combat_mode(name, combat_mode) {
		try {
			var response = await fetch("/admin/panel/bots/combat_mode", {
				method: "POST",
				headers: { "content-type": "application/json" },
				credentials: "same-origin",
				body: JSON.stringify({ character: name, combat_mode: combat_mode }),
			});
			var result = await response.json();
			if (result && result.ok) add_log(name + " set to " + (combat_mode === "passive" ? "Passive" : "Attacking"), "gray");
			else add_log(name + " isn't set up as a companion bot yet (admin panel > Bots)", "gray");
		} catch (e) {
			add_log("Couldn't reach the server to update " + name, "gray");
		}
	}

	window.party_context_menu = function (event, name) {
		event.preventDefault();
		var menu = ensure_element();
		menu.innerHTML = "";
		menu.appendChild(
			option("Attacking", function () {
				set_combat_mode(name, "assist");
			}),
		);
		menu.appendChild(
			option("Passive", function () {
				set_combat_mode(name, "passive");
			}),
		);
		menu.style.left = event.clientX + "px";
		menu.style.top = event.clientY + "px";
		menu.style.display = "block";
		return false;
	};
})();
