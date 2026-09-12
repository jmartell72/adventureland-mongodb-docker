const path = require("node:path");

machines = {
	server1: {
		key: "~/.ssh/your_server_key",
		ip: "0.0.0.0",
		deploy_to_folder: "adventureland",
		user: "root",
	},
};

servers = {
	staging: {
		region: "EU",
		name: "I",
		path: "/ws/",
		api_path: "/api/",
		local_ip: "0.0.0.0",
		local_port: 9001,
		address: "your-staging-domain.example.com",
		secure: false,
		ssl_key: "/etc/letsencrypt/live/your-domain/privkey.pem",
		ssl_cert: "/etc/letsencrypt/live/your-domain/fullchain.pem",
		machine: "server1",
		db: "dev",
		nginx: false,
		Staging: true,
	},
};

module.exports = {
	project_name: "adventureland",
	name: "Adventure Land",
	base_url: "https://your-staging-domain.example.com",
	Dev: false,
	Local: false,
	Prod: false,
	Staging: true,
	Engine: "mongodb",
	observer_map: "main",
	merchant_map: "main",
	port: 9000,
	machines: machines,
	servers: servers,
	cookie_key: "auth_staging",
};
