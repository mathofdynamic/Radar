import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const start = "2026-08-13T20:37:52.000Z";
const end = "2026-08-14T07:55:01.000Z";
const outputPath = path.resolve(process.cwd(), "scripts", "fixtures", "v8-baseline-500.json");
const rows = queryD1(`
  SELECT id, COALESCE(published_at, observed_at) AS observed_at
    FROM raw_posts
   WHERE is_deleted = 0
     AND is_noise = 0
     AND COALESCE(published_at, observed_at) >= '${start}'
     AND COALESCE(published_at, observed_at) <= '${end}'
   ORDER BY COALESCE(published_at, observed_at) DESC, id DESC
   LIMIT 500
`);
const postIds = rows.map((row) => Number(row.id));
if (postIds.length !== 500 || new Set(postIds).size !== 500 || postIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
  throw new Error(`manifest_source_invalid:rows=${postIds.length}:unique=${new Set(postIds).size}`);
}

const windows = new Map();
for (const row of rows) {
  const observedAt = new Date(String(row.observed_at));
  observedAt.setUTCSeconds(0, 0);
  observedAt.setUTCMinutes(Math.floor(observedAt.getUTCMinutes() / 5) * 5);
  const windowEnd = observedAt.toISOString();
  const entry = windows.get(windowEnd) || { window_end: windowEnd, post_ids: [] };
  entry.post_ids.push(Number(row.id));
  windows.set(windowEnd, entry);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify({ version: 1, sample: "baseline-v8-500", start, end, post_ids: postIds, windows: [...windows.values()] }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ file: path.relative(process.cwd(), outputPath), reports: postIds.length, unique: new Set(postIds).size, windows: windows.size, start, end }));

function queryD1(command) {
  const binary = path.resolve(process.cwd(), "node_modules/.bin", process.platform === "win32" ? "wrangler.cmd" : "wrangler");
  const normalizedCommand = process.platform === "win32" ? command.replace(/\r?\n/gu, " ").trim() : command;
  const commandArgument = process.platform === "win32" ? `\"${normalizedCommand.replaceAll('"', '\\\"')}\"` : normalizedCommand;
  const result = spawnSync(binary, ["d1", "execute", "radar-db", "--remote", "--json", "--command", commandArgument], {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : false,
    maxBuffer: 10 * 1024 * 1024
  });
  if (result.status !== 0) throw new Error(`d1_read_failed:${String(result.stderr || result.stdout).slice(0, 500)}`);
  const parsed = JSON.parse(result.stdout);
  const response = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!response?.success) throw new Error("d1_read_unsuccessful");
  return response.results || [];
}
