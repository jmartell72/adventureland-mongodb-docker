// [private fork] In-game Party Command Center overlay - the BG3/NWN2-style
// "manage the whole team from one screen" panel, embedded directly in the
// game window instead of the separate /admin/party page (that page still
// exists and works, this is the same data/actions rendered as a floating
// overlay so you never have to leave the game to reorganize gear or hand
// off manual control). Fetches JSON from /admin/party/data and posts
// actions to /admin/party/manual and /admin/party/transfer with json=1 -
// same server-side logic as the standalone page, just no page navigation.
//
// Item/equipment icons are drawn with the game's own item_container()
// (js/html.js) - the same function every inventory/shop/equip-slot icon in
// the real UI uses - so items look and badge (level/quantity/lock) exactly
// like they do everywhere else, instead of a plain-text list. Deliberately
// NOT reusing render_slots() for the equip-slot grid: it writes into
// cache_slots/cache_sid, module-level state the currently-playing
// character's own live equipment panel depends on for its diffing, and
// calling it for another character's data would corrupt that cache. Since
// this panel is read-only for equipped gear anyway (see below), building
// the slot grid directly with item_container sidesteps that risk.
(function () {
	var panel = null;
	var toggle_button = null;
	var refresh_timer = null;

	function esc(v) {
		return ("" + v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
	}

	// Mirrors the skin/def resolution html.js's render_slot() and
	// update_inventory() do before calling item_container - not a
	// reimplementation of item_container itself, just the couple of lines
	// of lookup it expects its caller to have already done.
	function item_icon_html(actual, extra) {
		if (!actual) return item_container(Object.assign({ size: 32, draggable: false }, extra || {}));
		var def = G.items[actual.name] || G.items.placeholder_m;
		var skin = actual.skin || def.skin;
		if (actual.expires) skin = def.skin_a;
		return item_container(Object.assign({ skin: skin, def: def, size: 32, draggable: false }, extra || {}), actual);
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
			"position:fixed; top:64px; right:12px; bottom:12px; width:min(460px, 92vw); z-index:151;" +
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

	async function fetch_data() {
		var response = await fetch("/admin/party/data", { credentials: "same-origin" });
		return response.json();
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

	// Stop this character's bot (freeing the socket slot), wait for the
	// disconnect to actually land server-side, then hand off to
	// switch_character()'s proven background-then-navigate flow - straight
	// to this specific character via /character/<name>/in/<region>/<sname>
	// (the same URL game.js itself writes into the address bar once
	// connected - see js/game.js's page.url assignment) instead of the
	// generic character-select screen.
	async function play_as(name) {
		add_log("Switching to " + name + "...", "gray");
		await post_json("/admin/party/manual", { character: name, enabled: "0" });
		for (var i = 0; i < 15; i++) {
			var data = await fetch_data();
			var c = data && data.characters && data.characters.find(function (x) {
				return x.name === name;
			});
			if (!c || !c.connected) break;
			await new Promise(function (resolve) {
				setTimeout(resolve, 400);
			});
		}
		if (typeof server_region === "undefined" || typeof server_identifier === "undefined") {
			add_log("Couldn't determine the current server - open the character select screen instead.", "gray");
			return;
		}
		window.switch_character("/character/" + encodeURIComponent(name) + "/in/" + server_region + "/" + server_identifier);
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
		var xp_hint = document.createElement("div");
		xp_hint.style.cssText = "color:#888; font-size:10px; margin-bottom:6px;";
		xp_hint.textContent = c.xp + " / " + (c.max_xp || "?") + " XP";
		card.appendChild(xp_hint);

		var button_row = document.createElement("div");
		button_row.style.cssText = "display:flex; gap:6px; margin-bottom:6px; flex-wrap:wrap;";
		var play_btn = document.createElement("button");
		play_btn.textContent = "Play as " + c.display_name;
		play_btn.style.cssText = "background:#357; color:#fff; border:none; border-radius:4px; padding:3px 8px; cursor:pointer; font-size:11px;";
		play_btn.onclick = function () {
			play_as(c.name);
		};
		button_row.appendChild(play_btn);

		var manual_btn = document.createElement("button");
		manual_btn.textContent = c.bot_enabled ? "Take manual control" : "Re-enable bot";
		manual_btn.style.cssText = "background:#2a6; color:#fff; border:none; border-radius:4px; padding:3px 8px; cursor:pointer; font-size:11px;";
		manual_btn.onclick = function () {
			set_manual(c.name, !c.bot_enabled);
		};
		button_row.appendChild(manual_btn);
		card.appendChild(button_row);

		var slots_row = document.createElement("div");
		slots_row.style.cssText = "display:flex; flex-wrap:wrap; gap:6px; margin-bottom:6px;";
		(window.PARTY_SLOT_ORDER || []).forEach(function (slot) {
			var cell = document.createElement("div");
			cell.style.cssText = "text-align:center;";
			var item = c.slots[slot];
			cell.innerHTML = item_icon_html(item, { cid: "pcc_slot_" + c.name + "_" + slot });
			cell.title = item ? item.name + (item.level ? " +" + item.level : "") : slot + " (empty)";
			var label = document.createElement("div");
			label.style.cssText = "font-size:9px; color:#777;";
			label.textContent = slot;
			cell.appendChild(label);
			slots_row.appendChild(cell);
		});
		card.appendChild(slots_row);

		var inv_row = document.createElement("div");
		inv_row.style.cssText = "display:flex; flex-wrap:wrap; gap:3px; margin-bottom:4px;";
		c.items.forEach(function (item, i) {
			if (!item) return;
			var cell = document.createElement("div");
			cell.style.cssText = "position:relative;";
			cell.innerHTML = item_icon_html(item, { cid: "pcc_item_" + c.name + "_" + i });
			cell.title = item.name + (item.level ? " +" + item.level : "");
			cell.onclick = function () {
				open_transfer_popup(cell, c, i, item, other_characters);
			};
			cell.style.cursor = "pointer";
			inv_row.appendChild(cell);
		});
		card.appendChild(inv_row);

		return card;
	}

	// Small "send this item" popup, opened by clicking an inventory icon -
	// keeps the icon grid clean instead of a permanent dropdown+button per
	// item.
	var transfer_popup = null;
	function open_transfer_popup(anchor, c, index, item, other_characters) {
		if (transfer_popup) transfer_popup.remove();
		var rect = anchor.getBoundingClientRect();
		transfer_popup = document.createElement("div");
		transfer_popup.style.cssText =
			"position:fixed; left:" +
			rect.left +
			"px; top:" +
			(rect.bottom + 4) +
			"px; z-index:200; background:rgba(0,0,0,0.9); border:1px solid #555; border-radius:6px; padding:6px; display:flex; gap:4px; align-items:center;";
		var select = document.createElement("select");
		select.style.cssText = "background:#000; color:#eee; border:1px solid #555; font-family:monospace; font-size:11px;";
		other_characters.forEach(function (o) {
			var opt = document.createElement("option");
			opt.value = o.name;
			opt.textContent = o.display_name;
			select.appendChild(opt);
		});
		var qty = document.createElement("input");
		qty.type = "number";
		qty.min = "1";
		qty.max = String(item.q || 1);
		qty.value = String(item.q || 1);
		qty.style.cssText = "width:44px; background:#000; color:#eee; border:1px solid #555;";
		var send_btn = document.createElement("button");
		send_btn.textContent = "Send";
		send_btn.style.cssText = "background:#2a6; color:#fff; border:none; border-radius:3px; padding:2px 8px; cursor:pointer; font-size:11px;";
		send_btn.onclick = function () {
			transfer_popup.remove();
			transfer_popup = null;
			send_item(c.name, index, select.value, qty.value);
		};
		transfer_popup.appendChild(select);
		transfer_popup.appendChild(qty);
		transfer_popup.appendChild(send_btn);
		document.body.appendChild(transfer_popup);
		setTimeout(function () {
			document.addEventListener(
				"click",
				function close_once(e) {
					if (transfer_popup && !transfer_popup.contains(e.target)) {
						transfer_popup.remove();
						transfer_popup = null;
					}
					document.removeEventListener("click", close_once);
				},
				{ once: true },
			);
		}, 0);
	}

	async function render() {
		var p = ensure_panel();
		var data;
		try {
			data = await fetch_data();
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
