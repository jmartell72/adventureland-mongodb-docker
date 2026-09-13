// [private fork] In-game Party Command Center overlay - the BG3/NWN2-style
// "manage the whole team from one screen" panel, embedded directly in the
// game window instead of the separate /admin/party page (that page still
// exists and works, this is the same data/actions rendered as a floating
// overlay so you never have to leave the game to reorganize gear or hand
// off manual control). Fetches JSON from /admin/party/data and posts
// actions to /admin/party/manual and /admin/party/transfer with json=1 -
// same server-side logic as the standalone page, just no page navigation.
(function () {
	var panel = null;
	var toggle_button = null;
	var refresh_timer = null;

	function esc(v) {
		return ("" + v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
	}

	function item_label(item) {
		if (!item) return "";
		return esc(item.name) + (item.level ? " +" + esc(item.level) : "") + (item.q > 1 ? " x" + esc(item.q) : "");
	}

	function ensure_toggle_button() {
		if (toggle_button) return toggle_button;
		toggle_button = document.createElement("div");
		toggle_button.id = "party-command-center-toggle";
		toggle_button.textContent = "Party";
		toggle_button.style.cssText =
			"position:fixed; top:64px; right:12px; z-index:150;" +
			"background:rgba(0,0,0,0.7); color:#fff; font-family:monospace; font-size:12px;" +
			"padding:5px 10px; border-radius:6px; border:1px solid rgba(255,255,255,0.15);" +
			"display:none; cursor:pointer;";
		toggle_button.onclick = function () {
			if (panel && panel.style.display !== "none") close_panel();
			else open_panel();
		};
		document.body.appendChild(toggle_button);
		return toggle_button;
	}

	function ensure_panel() {
		if (panel) return panel;
		panel = document.createElement("div");
		panel.id = "party-command-center";
		panel.style.cssText =
			"position:fixed; top:64px; right:12px; bottom:12px; width:min(420px, 92vw); z-index:151;" +
			"background:rgba(10,10,10,0.95); color:#ddd; font-family:monospace; font-size:12px;" +
			"border:1px solid rgba(255,255,255,0.2); border-radius:8px; overflow-y:auto; padding:10px; display:none;";
		document.body.appendChild(panel);
		return panel;
	}

	function close_panel() {
		if (panel) panel.style.display = "none";
		if (refresh_timer) {
			clearInterval(refresh_timer);
			refresh_timer = null;
		}
	}

	async function post_json(url, params) {
		var body = Object.keys(params)
			.map(function (k) {
				return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
			})
			.concat(["json=1"])
			.join("&");
		var response = await fetch(url, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			credentials: "same-origin",
			body: body,
		});
		return response.json();
	}

	async function set_manual(name, enabled) {
		var result = await post_json("/admin/party/manual", { character: name, enabled: enabled ? "1" : "0" });
		if (result && result.ok) add_log(name + (enabled ? " bot re-enabled" : " bot stopped"), "gray");
		render();
	}

	async function send_item(from_name, index, to_name, quantity) {
		var result = await post_json("/admin/party/transfer", { from: from_name, index: index, to: to_name, quantity: quantity });
		if (result && result.ok) add_log("Item sent to " + to_name, "gray");
		else add_log("Transfer failed: " + ((result && result.reason) || "unknown"), "gray");
		render();
	}

	function build_character_card(c, other_characters) {
		var card = document.createElement("div");
		card.style.cssText = "border:1px solid #444; border-radius:6px; padding:8px; margin-bottom:10px;";
		var pct = c.max_xp ? Math.min(100, Math.round((c.xp / c.max_xp) * 100)) : 0;

		var header = document.createElement("div");
		header.innerHTML =
			"<b>" +
			esc(c.display_name) +
			"</b> - " +
			esc(c.ctype) +
			", Lv." +
			esc(c.level) +
			' <span style="font-size:10px; padding:1px 5px; border-radius:3px; background:' +
			(c.connected ? "#274; color:#9f9" : "#432; color:#ca9") +
			'">' +
			(c.connected ? "connected" : "offline") +
			"</span>" +
			' <span style="font-size:10px; padding:1px 5px; border-radius:3px; background:' +
			(c.bot_enabled ? "#274; color:#9f9" : "#432; color:#ca9") +
			'">' +
			esc(c.bot_mode) +
			(c.bot_enabled ? "" : " (disabled)") +
			"</span>";
		card.appendChild(header);

		var xpbar = document.createElement("div");
		xpbar.style.cssText = "background:#222; border-radius:4px; height:8px; overflow:hidden; margin:4px 0 6px;";
		xpbar.innerHTML = '<div style="background:#4a8; height:100%; width:' + pct + '%"></div>';
		card.appendChild(xpbar);

		var manual_btn = document.createElement("button");
		manual_btn.textContent = c.bot_enabled ? "Take manual control" : "Re-enable bot";
		manual_btn.style.cssText = "background:#2a6; color:#fff; border:none; border-radius:4px; padding:3px 8px; cursor:pointer; font-size:11px; margin-bottom:6px;";
		manual_btn.onclick = function () {
			set_manual(c.name, !c.bot_enabled);
		};
		card.appendChild(manual_btn);
		if (!c.bot_enabled) {
			var hint = document.createElement("div");
			hint.style.cssText = "color:#888; font-size:10px; margin-bottom:6px;";
			hint.textContent = "Bot stopped - log in as this character to play it directly.";
			card.appendChild(hint);
		}

		var slots_row = document.createElement("div");
		slots_row.style.cssText = "display:flex; flex-wrap:wrap; gap:4px; margin-bottom:6px;";
		(window.PARTY_SLOT_ORDER || []).forEach(function (slot) {
			var item = c.slots[slot];
			var box = document.createElement("div");
			box.style.cssText = "border:1px solid #555; border-radius:4px; padding:2px 5px; font-size:10px; background:#000;" + (item ? "" : " color:#555;");
			box.textContent = slot + ": " + (item ? item_label(item) : "-");
			slots_row.appendChild(box);
		});
		card.appendChild(slots_row);

		c.items.forEach(function (item, i) {
			if (!item) return;
			var row = document.createElement("div");
			row.style.cssText = "display:flex; align-items:center; gap:4px; font-size:11px; padding:2px 0; border-bottom:1px solid #222;";
			var label = document.createElement("span");
			label.textContent = "[" + i + "] " + item_label(item);
			row.appendChild(label);

			var select = document.createElement("select");
			select.style.cssText = "margin-left:auto; background:#000; color:#eee; border:1px solid #555; font-family:monospace; font-size:10px;";
			other_characters.forEach(function (o) {
				var opt = document.createElement("option");
				opt.value = o.name;
				opt.textContent = o.display_name;
				select.appendChild(opt);
			});
			row.appendChild(select);

			var qty = document.createElement("input");
			qty.type = "number";
			qty.min = "1";
			qty.max = String(item.q || 1);
			qty.value = String(item.q || 1);
			qty.style.cssText = "width:44px; background:#000; color:#eee; border:1px solid #555;";
			row.appendChild(qty);

			var send_btn = document.createElement("button");
			send_btn.textContent = "Send";
			send_btn.style.cssText = "background:#2a6; color:#fff; border:none; border-radius:3px; padding:2px 6px; cursor:pointer; font-size:10px;";
			send_btn.onclick = function () {
				send_item(c.name, i, select.value, qty.value);
			};
			row.appendChild(send_btn);

			card.appendChild(row);
		});

		return card;
	}

	async function render() {
		var p = ensure_panel();
		var data;
		try {
			var response = await fetch("/admin/party/data", { credentials: "same-origin" });
			data = await response.json();
		} catch (e) {
			p.innerHTML = '<div style="color:#d77;">Couldn\'t reach the server.</div>';
			return;
		}
		if (!data || data.failed || !data.characters) {
			p.innerHTML = '<div style="color:#d77;">Not available (are you admin?).</div>';
			return;
		}
		window.PARTY_SLOT_ORDER = data.slot_order || [];
		p.innerHTML = "";
		var title = document.createElement("div");
		title.innerHTML = '<b>Party Command Center</b> <span style="float:right; cursor:pointer; color:#888;" title="Close">&times;</span>';
		title.style.cssText = "margin-bottom:8px;";
		title.querySelector("span").onclick = close_panel;
		p.appendChild(title);
		data.characters.forEach(function (c) {
			var others = data.characters.filter(function (o) {
				return o.name !== c.name;
			});
			p.appendChild(build_character_card(c, others));
		});
	}

	function open_panel() {
		ensure_panel().style.display = "block";
		render();
		if (!refresh_timer) refresh_timer = setInterval(render, 8000);
	}

	window.open_party_command_center = open_panel;

	function poll() {
		if (typeof character === "undefined" || !character) return;
		ensure_toggle_button().style.display = "block";
	}
	setInterval(poll, 3000);
})();
