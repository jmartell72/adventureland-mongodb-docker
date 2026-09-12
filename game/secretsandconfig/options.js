const path = require("node:path");

machines = {
	local: {
		key: "",
		ip: "0.0.0.0",
		user: "",
	},
};

servers = {
	local: {
		region: "US",
		name: "I",
		path: "/socket.io/",
		api_path: "/server.api/",
		local_ip: "0.0.0.0",
		local_port: 7192,
		address: "localhost:7192",
		machine: "local",
		db: "dev",
		secure: false,
		nginx: false,
		Dev: true,
	},
};

module.exports = {
	project_name: "adventureland",
	name: "Adventure Land",
	base_url: "http://localhost",
	Dev: true,
	Local: true,
	Prod: false,
	Staging: false,
	Engine: "mongodb",
	observer_map: "main",
	merchant_map: "main",
	port: 8090,
	close_timeout: 4000,
	ip_limit: 3,
	character_limit: 3,
	fast_sdk: 0,
	machines: machines,
	servers: servers,
	cookie_key: "auth",
	unsecure_admin: true,
};
