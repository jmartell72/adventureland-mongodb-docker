/**
 * Verify that every user and character has at least one backup.
 *
 * Usage: node agentic/verify_backups.js
 */

const { MongoClient } = require("mongodb");
const keys = require("../secretsandconfig/keys");

async function main() {
	const client = new MongoClient(keys.mongodb_uri, { ...keys.mongodb_config, serverSelectionTimeoutMS: 10000 });
	try {
		await client.connect();
		const db = client.db(keys.mongodb_name);

		const backup = db.collection("backup");
		const userCol = db.collection("user");
		const charCol = db.collection("character");

		const [backedUpUserIds, backedUpCharIds, allUserIds, allCharIds] = await Promise.all([
			backup.distinct("original_id", { model: "user" }),
			backup.distinct("original_id", { model: "character" }),
			userCol.find({}, { projection: { _id: 1 } }).map((d) => d._id).toArray(),
			charCol.find({}, { projection: { _id: 1 } }).map((d) => d._id).toArray(),
		]);

		const backedUpUsers = new Set(backedUpUserIds);
		const backedUpChars = new Set(backedUpCharIds);

		const missingUsers = allUserIds.filter((id) => !backedUpUsers.has(id));
		const missingChars = allCharIds.filter((id) => !backedUpChars.has(id));

		console.log("=== Backup Coverage Report ===");
		console.log(`Users:      ${allUserIds.length} total, ${backedUpUsers.size} backed up, ${missingUsers.length} missing`);
		console.log(`Characters: ${allCharIds.length} total, ${backedUpChars.size} backed up, ${missingChars.length} missing`);

		if (missingUsers.length) {
			console.log("\nMissing user backups:");
			missingUsers.forEach((id) => console.log(`  ${id}`));
		}
		if (missingChars.length) {
			console.log("\nMissing character backups:");
			missingChars.forEach((id) => console.log(`  ${id}`));
		}

		if (!missingUsers.length && !missingChars.length) {
			console.log("\nAll users and characters have backups!");
		}
	} finally {
		await client.close();
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
