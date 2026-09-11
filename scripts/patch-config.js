#!/usr/bin/env node
// Rewrites secretsandconfig/options.js and keys.js in place using env vars,
// so the same image works for local dev (docker-compose.yml) and behind a
// reverse proxy in production (docker-compose.prod.yml) without forking the
// config repo. Runs once at container start, before main.js / node/server.js
// (each of which does its own fresh `require` of these files).
//
// Also works around a gap in every secretsandconfig template as of writing:
// server defs ship without msgpack_path, which node/server.js requires to
// boot ("Missing msgpack_path for server <key>"). Safe to remove once
// upstream ships it.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const optionsPath = path.join(root, "secretsandconfig", "options.js");
const keysPath = path.join(root, "secretsandconfig", "keys.js");

function envBool(name) {
	const v = process.env[name];
	if (v === undefined || v === "") return undefined;
	return v === "1" || v.toLowerCase() === "true";
}

function writeModule(file, obj) {
	fs.writeFileSync(file, `module.exports = ${JSON.stringify(obj, null, 2)};\n`);
}

// --- options.js ---
const options = require(optionsPath);
const serverKey = process.env.GAME_SERVER_KEY || "local";
const server = options.servers && options.servers[serverKey];
if (!server) {
	throw new Error(`patch-config: no server "${serverKey}" in secretsandconfig/options.js servers{}`);
}

if (!server.msgpack_path) {
	const base = (server.path || "/socket.io/").replace(/\/$/, "");
	server.msgpack_path = `${base}.msgpack/`;
}

if (process.env.BASE_URL) options.base_url = process.env.BASE_URL;

const secure = envBool("PUBLIC_SECURE");
if (secure !== undefined) {
	options.secure = secure;
	server.secure = secure;
}

if (process.env.GAME_SERVER_ADDRESS) server.address = process.env.GAME_SERVER_ADDRESS;

writeModule(optionsPath, options);
console.log(`[patch-config] options.js: base_url=${options.base_url} servers.${serverKey}.address=${server.address} secure=${options.secure}`);

// --- keys.js ---
if (process.env.MONGODB_URI) {
	const keys = require(keysPath);
	keys.mongodb_uri = process.env.MONGODB_URI;
	writeModule(keysPath, keys);
	console.log(`[patch-config] keys.js: mongodb_uri=${keys.mongodb_uri}`);
}
