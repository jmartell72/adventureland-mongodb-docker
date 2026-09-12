// [private fork] Personal fast travel - a small dropdown that emits the
// "fast_travel" socket event added in node/server.js, which reuses the real
// Transporter NPC's destination list (G.npcs.transporter.places) and the
// same transport_player_to() the game itself uses, just without needing to
// walk to Alia first. Standalone widget (own DOM, own polling for
// readiness) rather than touching game.js's UI code - easy to verify, zero
// risk to existing UI if something about it is wrong.
(function () {
	var FRIENDLY_NAMES = {
		main: "Main",
		winterland: "Winterland",
		desertland: "Desert Land",
		cyberland: "Cyber Land",
		halloween: "Halloween",
		test: "Test",
		d_e: "Doorland",
	};

	var el = null;
	function ensure_element() {
		if (el) return el;
		el = document.createElement("div");
		el.id = "fast-travel-hud";
		el.style.cssText =
			"position:fixed; top:36px; left:50%; transform:translateX(-50%); z-index:150;" +
			"background:rgba(0,0,0,0.7); color:#fff; font-family:monospace; font-size:12px;" +
			"padding:3px 8px; border-radius:6px; white-space:nowrap;" +
			"border:1px solid rgba(255,255,255,0.15); display:none;";
		var select = document.createElement("select");
		select.id = "fast-travel-select";
		select.style.cssText = "font-family:monospace; font-size:12px; margin-right:4px;";
		var go = document.createElement("button");
		go.textContent = "Travel";
		go.style.cssText = "font-family:monospace; font-size:12px; cursor:pointer;";
		go.onclick = function () {
			if (typeof socket !== "undefined" && socket && select.value) {
				socket.emit("fast_travel", { to: select.value });
			}
		};
		el.appendChild(select);
		el.appendChild(go);
		document.body.appendChild(el);
		return el;
	}

	function populate(select) {
		if (select.dataset.populated || typeof G === "undefined" || !G.npcs || !G.npcs.transporter) return;
		Object.keys(G.npcs.transporter.places).forEach(function (map_name) {
			var option = document.createElement("option");
			option.value = map_name;
			option.textContent = FRIENDLY_NAMES[map_name] || map_name;
			select.appendChild(option);
		});
		select.dataset.populated = "1";
	}

	function poll() {
		if (typeof character === "undefined" || !character || typeof socket === "undefined" || !socket) return;
		var node = ensure_element();
		populate(document.getElementById("fast-travel-select"));
		node.style.display = "block";
	}

	setInterval(poll, 3000);
})();
