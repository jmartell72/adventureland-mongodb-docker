// Dev only: creates a test account (username "tester", password "tester")
// with three characters matching the real party, and makes it admin.
// Usage: node scripts/dev/seed-account.js [base_url]
const BASE = process.argv[2] || "http://127.0.0.1:8090";
const { MongoClient } = require(require.resolve("mongodb", { paths: [__dirname + "/../../game"] }));
let cookie = "";

async function api(method, args) {
	const res = await fetch(BASE + "/api/" + method, {
		method: "POST",
		headers: { "content-type": "application/json", cookie },
		body: JSON.stringify(args),
	});
	const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
	for (const c of set) if (c.startsWith("auth=")) cookie = c.split(";")[0];
	const data = await res.json();
	return data;
}

(async () => {
	let r = await api("signup_or_login", { username: "tester", password: "tester" });
	console.log("signup_or_login:", r.failed ? r.reason : "ok");
	const party = [
		["Kingmartell", "warrior"],
		["Burt", "ranger"],
		["Healz", "priest"],
	];
	for (const [name, type] of party) {
		r = await api("create_character", { name, char: type, look: 0 });
		console.log("create", name, r.failed ? r.reason : "ok");
	}
	const client = new MongoClient(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/?replicaSet=rs0");
	await client.connect();
	await client.db("adventureland").collection("user").updateOne({ username: "tester" }, { $set: { admin: true } });
	await client.close();
	console.log("cookie:", cookie);
})();
