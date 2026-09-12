const crypto = require("node:crypto");
const path = require("node:path");

// Generate random keys for development — override with real values in production
const rk = (n) => crypto.randomBytes(n).toString("hex");

module.exports = {
	server_keyword: rk(16),
	mongodb_uri: "mongodb://localhost:27017/adventureland",
	mongodb_name: "adventureland",
	mongodb_config: {}, // e.g. { tlsCAFile: path.resolve(__dirname, "your-ca.crt") }
	stripe_test_api_key: "",
	stripe_test_pkey: "",
	stripe_api_key: "",
	stripe_pkey: "",
	steam_web_apikey: "",
	steam_publisher_web_apikey: "",
	sdk_password: rk(16),
	amazon_ses_user: "",
	amazon_ses_key: "",
	ACCESS_MASTER: rk(20),
	BOT_MASTER: rk(20),
	SERVER_MASTER: rk(16),
	discord_token: "",
	apple_token: "",
	steam_key: "",
};
