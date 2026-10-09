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
	const db = client.db("adventureland");
	await db.collection("user").updateOne({ username: "tester" }, { $set: { admin: true } });
	// Finish the tutorial so its lesson modal doesn't cover the game on every
	// login. Progress lives in IE_userdata-<user> (see process_user_data in
	// adventure_functions.js): every task of every lesson has to be marked
	// complete, or calculate_tutorial_step() rewinds tutorial_step.
	const docs = new Function(require("fs").readFileSync(__dirname + "/../../game/docs/directory.js", "utf8") + "\nreturn docs;")();
	const user = await db.collection("user").findOne({ username: "tester" });
	// Level 1 characters always get the tutorial or the Guide menu on login
	// (js/game.js, after "welcome"), so start the party past it, with spare
	// gear in their bags for testing equip/transfer.
	const spare = {
		kingmartell: ["wcap", "wattire", "wbreeches", "wgloves", "wshoes", "ringsj", "hpamulet", "hpbelt"],
		burt: ["bow", "helmet", "coat"],
		healz: ["staff", "pants", "gloves", "shoes"],
	};
	for (const [name, items] of Object.entries(spare)) {
		const character = await db.collection("character").findOne({ name });
		if (!character || character.level > 1) continue;
		await db.collection("character").updateOne(
			{ _id: character._id },
			{ $set: { level: 20, "info.xp": 0, "info.items": character.info.items.concat(items.map((n) => ({ name: n, level: 0 }))) } },
		);
	}
	await db.collection("infoelement").updateOne(
		{ _id: "IE_userdata-" + user._id },
		{
			$set: {
				"info.completed_tasks": docs.tutorial.flatMap((lesson) => lesson.tasks),
				"info.tutorial_step": docs.tutorial.length,
				"info.tutorial_version": 2,
			},
			$setOnInsert: { created: new Date() },
		},
		{ upsert: true },
	);
	await client.close();
	console.log("cookie:", cookie);
})();
