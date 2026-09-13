// [private fork] Multi-character inventory/equipment view - replaces the
// actual Inventory key/button (see functions.js's "toggle_inventory"
// action) with one window per owned character (Kingmartell, Burt, Healz,
// ...), each showing that character's equipped gear above its inventory
// grid, side by side. Drag an item icon from one character's window and
// drop it in another's to move it there - a silent trade, no popup.
//
// Item/equipment icons are drawn with the game's own item_container()
// (js/html.js) - the same function every real inventory/shop/equip-slot
// icon uses - so items look and badge (level/quantity/lock) exactly like
// they do everywhere else. Deliberately NOT reusing item_container's own
// draggable/ondragstart wiring (that assumes the CURRENT character's own
// inventory) or render_slots() (writes into cache_slots/cache_sid, module
// state the currently-playing character's own live equipment panel
// depends on) - icons here are rendered read-only (draggable:false) and
// wrapped in this file's own plain HTML5 drag handlers instead, which know
// which character's window an icon came from and call
// /admin/party/transfer directly.
//
// Equipped gear is read-only here (viewing only, not draggable) - moving
// an equipped item safely would mean recalculating stats on both sides,
// kept out of scope for now; only loose inventory items are tradeable.
(function () {
	var panel = null;
	var open = false;

	function esc(v) {
		return ("" + v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
	}

	// Mirrors the skin/def resolution html.js's render_slot() and
	// update_inventory() do before calling item_container.
	function item_icon_html(actual, extra) {
		if (!actual) return item_container(Object.assign({ size: 34, draggable: false }, extra || {}));
		var def = G.items[actual.name] || G.items.placeholder_m;
		var skin = actual.skin || def.skin;
		if (actual.expires) skin = def.skin_a;
		return item_container(Object.assign({ skin: skin, def: def, size: 34, draggable: false }, extra || {}), actual);
	}

	function ensure_panel() {
		if (panel) return panel;
		panel = document.createElement("div");
		panel.id = "party-command-center";
		panel.style.cssText =
			"position:fixed; left:0; right:0; bottom:0; top:64px; z-index:151;" +
			"background:rgba(8,8,8,0.97); color:#ddd; font-family:monospace; font-size:12px;" +
			"display:none; overflow-x:auto; overflow-y:hidden; padding:12px;";
		document.body.appendChild(panel);
		return panel;
	}

	function close_panel() {
		open = false;
		if (panel) panel.style.display = "none";
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

	async function play_as(name) {
		add_log("Switching to " + name + "...", "gray");
		await post_json("/admin/party/manual", { character: name, enabled: "0" });
		for (var i = 0; i < 15; i++) {
			var data = await fetch_data();
			var c =
				data &&
				data.characters &&
				data.characters.find(function (x) {
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

	// Drag payload is just {character, index} - "index" is an inventory
	// slot number, meaningful only together with the character it came
	// from. Any window's drop zone accepts it and asks the server to move
	// the whole stack (a "silent trade", no quantity prompt) unless it was
	// dropped back on its own character's window.
	var DRAG_MIME = "application/x-party-command-center-item";

	function build_character_window(c) {
		var win = document.createElement("div");
		win.style.cssText =
			"display:inline-block; vertical-align:top; width:230px; margin-right:12px; border:1px solid #444; border-radius:6px; padding:8px; white-space:normal;";

		var pct = c.max_xp ? Math.min(100, Math.round((c.xp / c.max_xp) * 100)) : 0;
		var header = document.createElement("div");
		header.innerHTML =
			"<b>" +
			esc(c.display_name) +
			"</b><br>" +
			esc(c.ctype) +
			", Lv." +
			esc(c.level) +
			' <span style="font-size:10px; padding:1px 5px; border-radius:3px; background:' +
			(c.connected ? "#274; color:#9f9" : "#432; color:#ca9") +
			'">' +
			(c.connected ? "connected" : "offline") +
			"</span>";
		win.appendChild(header);

		var xpbar = document.createElement("div");
		xpbar.style.cssText = "background:#222; border-radius:4px; height:6px; overflow:hidden; margin:4px 0;";
		xpbar.innerHTML = '<div style="background:#4a8; height:100%; width:' + pct + '%"></div>';
		win.appendChild(xpbar);

		var button_row = document.createElement("div");
		button_row.style.cssText = "display:flex; gap:4px; margin-bottom:6px; flex-wrap:wrap;";
		var play_btn = document.createElement("button");
		play_btn.textContent = "Play as";
		play_btn.style.cssText = "background:#357; color:#fff; border:none; border-radius:4px; padding:2px 6px; cursor:pointer; font-size:10px;";
		play_btn.onclick = function () {
			play_as(c.name);
		};
		button_row.appendChild(play_btn);
		var manual_btn = document.createElement("button");
		manual_btn.textContent = c.bot_enabled ? "Stop bot" : "Enable bot";
		manual_btn.style.cssText = "background:#2a6; color:#fff; border:none; border-radius:4px; padding:2px 6px; cursor:pointer; font-size:10px;";
		manual_btn.onclick = function () {
			set_manual(c.name, !c.bot_enabled);
		};
		button_row.appendChild(manual_btn);
		win.appendChild(button_row);

		// Equipment - read-only loadout view, same slot set/order the real
		// equip screen uses (window.PARTY_SLOT_ORDER, from /admin/party/data).
		var slots_row = document.createElement("div");
		slots_row.style.cssText = "display:flex; flex-wrap:wrap; gap:3px; margin-bottom:8px; padding-bottom:8px; border-bottom:1px solid #333;";
		(window.PARTY_SLOT_ORDER || []).forEach(function (slot) {
			var item = c.slots[slot];
			var cell = document.createElement("div");
			cell.style.cssText = "text-align:center;";
			cell.innerHTML = item_icon_html(item, { cid: "pcc_slot_" + c.name + "_" + slot });
			cell.title = item ? item.name + (item.level ? " +" + item.level : "") : slot + " (empty)";
			var label = document.createElement("div");
			label.style.cssText = "font-size:8px; color:#777;";
			label.textContent = slot;
			cell.appendChild(label);
			slots_row.appendChild(cell);
		});
		win.appendChild(slots_row);

		// Inventory - draggable source AND drop target, so items can move
		// both out of and into this character's window.
		var inv_row = document.createElement("div");
		inv_row.style.cssText = "display:flex; flex-wrap:wrap; gap:3px; min-height:40px;";
		inv_row.ondragover = function (e) {
			e.preventDefault();
		};
		inv_row.ondrop = function (e) {
			e.preventDefault();
			var raw = e.dataTransfer.getData(DRAG_MIME) || e.dataTransfer.getData("text/plain");
			var payload;
			try {
				payload = JSON.parse(raw);
			} catch (err) {
				return;
			}
			if (!payload || payload.character === c.name) return;
			send_item(payload.character, payload.index, c.name, payload.quantity);
		};
		c.items.forEach(function (item, i) {
			if (!item) return;
			var cell = document.createElement("div");
			cell.innerHTML = item_icon_html(item, { cid: "pcc_item_" + c.name + "_" + i });
			cell.title = item.name + (item.level ? " +" + item.level : "") + (item.q > 1 ? " x" + item.q : "");
			cell.draggable = true;
			cell.style.cursor = "grab";
			cell.ondragstart = function (e) {
				var payload = JSON.stringify({ character: c.name, index: i, quantity: item.q || 1 });
				e.dataTransfer.setData(DRAG_MIME, payload);
				e.dataTransfer.setData("text/plain", payload);
				e.dataTransfer.effectAllowed = "move";
			};
			inv_row.appendChild(cell);
		});
		win.appendChild(inv_row);

		return win;
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
		title.innerHTML =
			'<b>Inventory - all characters</b> <span style="float:right; cursor:pointer; color:#888;" title="Close">&times;</span>' +
			'<div style="color:#888; font-size:10px; margin-top:2px;">Drag an item between windows to send it. Equipment is view-only here.</div>';
		title.style.cssText = "margin-bottom:10px;";
		title.querySelector("span").onclick = close_panel;
		p.appendChild(title);
		var row = document.createElement("div");
		row.style.cssText = "white-space:nowrap;";
		data.characters.forEach(function (c) {
			row.appendChild(build_character_window(c));
		});
		p.appendChild(row);
	}

	function toggle() {
		if (open) {
			close_panel();
			return;
		}
		open = true;
		ensure_panel().style.display = "block";
		render();
	}

	window.party_toggle_inventory = toggle;
	window.open_party_command_center = toggle;
})();
