const crypto = require("node:crypto");
const path = require("node:path");

// Production keys — fill in with your real credentials
const rk = (n) => crypto.randomBytes(n).toString("hex");

module.exports = {
	server_keyword: rk(16),
	mongodb_uri: "mongodb://user:password@host:port/adventureland?authSource=adventureland&tls=true",
	mongodb_name: "adventureland",
	mongodb_config: { tlsCAFile: path.resolve(__dirname, "your-ca.crt") },
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
