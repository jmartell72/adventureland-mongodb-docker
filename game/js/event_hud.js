// [private fork] Event timer HUD - small always-visible readout of which
// scheduled events (Goo Brawl, Giga Crab, etc.) are active right now, so
// you don't have to check the sidebar. Deliberately a standalone widget
// (its own polling, its own DOM element) rather than touching game.js's
// event handling - self-contained, easy to verify, zero risk to existing
// UI code if something about it is wrong.
(function () {
	var FRIENDLY_NAMES = {
		goobrawl: "Goo Brawl",
		crabxx: "Giga Crab",
		abtesting: "A/B Testing",
		icegolem: "Ice Golem",
		franky: "Franky",
		snowman: "Snowman",
		goldenbat: "Golden Bat",
		cutebee: "Cute Bee",
		hide_and_seek: "Hide and Seek",
	};

	var el = null;
	function ensure_element() {
		if (el) return el;
		el = document.createElement("div");
		el.id = "event-hud";
		el.style.cssText =
			"position:fixed; top:8px; left:50%; transform:translateX(-50%); z-index:150;" +
			"background:rgba(0,0,0,0.7); color:#fff; font-family:monospace; font-size:13px;" +
			"padding:4px 12px; border-radius:6px; pointer-events:none; white-space:nowrap;" +
			"border:1px solid rgba(255,255,255,0.15); display:none;";
		document.body.appendChild(el);
		return el;
	}

	function render(active_names) {
		var node = ensure_element();
		if (!active_names.length) {
			node.style.display = "none";
			return;
		}
		node.style.display = "block";
		node.textContent = "⚔ Active: " + active_names.join(", ");
	}

	function poll() {
		fetch("/events_status", { credentials: "same-origin" })
			.then(function (r) {
				return r.json();
			})
			.then(function (data) {
				var events = data.events || {};
				var active = Object.keys(FRIENDLY_NAMES).filter(function (key) {
					return !!events[key];
				});
				render(
					active.map(function (key) {
						return FRIENDLY_NAMES[key];
					}),
				);
			})
			.catch(function () {
				/* transient fetch failures are fine - just try again next tick */
			});
	}

	poll();
	setInterval(poll, 15000);
})();
