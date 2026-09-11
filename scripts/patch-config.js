#!/usr/bin/env node
// Compat shim: as of writing, every server def shipped in
// adventureland_secretsandconfig's options*.js templates is missing
// msgpack_path, which node/server.js requires to boot (see
// "Missing msgpack_path for server <key>"). Inject a default derived from
// the existing socket.io `path` so the game server can start. Safe to
// remove once upstream ships msgpack_path in its templates.
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "secretsandconfig", "options.js");
let src = fs.readFileSync(file, "utf8");

if (!src.includes("msgpack_path")) {
	src = src.replace(/(\bpath:\s*"([^"]*)",)/, (full, _g, p) => {
		const base = p.replace(/\/$/, "");
		return `${full}\n\t\tmsgpack_path: "${base}.msgpack/",`;
	});
	fs.writeFileSync(file, src);
	console.log("[patch-config] injected default msgpack_path into secretsandconfig/options.js");
}
