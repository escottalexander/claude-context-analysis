import { cp, mkdir } from "node:fs/promises";

const sourceDir = new URL("../src/web/public", import.meta.url);
const targetDir = new URL("../dist/web/public", import.meta.url);

await mkdir(targetDir, { recursive: true });
await cp(sourceDir, targetDir, { recursive: true });

console.log("Copied web assets to dist/web/public");
