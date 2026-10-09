const crypto = require("node:crypto");
const path = require("node:path");

// Generate random keys for development — override with real values in production.
// [private fork] With AL_DEV_SECRET set (scripts/dev-up.sh does this), keys are
// derived from it instead, so main.js and node/server.js - separate processes
// that each require this file - agree on ACCESS_MASTER etc. without
// patch-config.js freezing them to disk. The Docker image never sets it.
const rk = (n, label) =>
	process.env.AL_DEV_SECRET
		? crypto.createHmac("sha256", process.env.AL_DEV_SECRET).update(label).digest("hex").slice(0, n * 2)
		: crypto.randomBytes(n).toString("hex");

module.exports = {
	server_keyword: rk(16, "server_keyword"),
	mongodb_uri: "mongodb://localhost:27017/adventureland",
	mongodb_name: "adventureland",
	mongodb_config: {}, // e.g. { tlsCAFile: path.resolve(__dirname, "your-ca.crt") }
	stripe_test_api_key: "",
	stripe_test_pkey: "",
	stripe_api_key: "",
	stripe_pkey: "",
	steam_web_apikey: "",
	steam_publisher_web_apikey: "",
	sdk_password: rk(16, "sdk_password"),
	amazon_ses_user: "",
	amazon_ses_key: "",
	ACCESS_MASTER: rk(20, "ACCESS_MASTER"),
	BOT_MASTER: rk(20, "BOT_MASTER"),
	SERVER_MASTER: rk(16, "SERVER_MASTER"),
	discord_token: "",
	apple_token: "",
	steam_key: "",
};
