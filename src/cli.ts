import { startWebServer } from "./web/server.js";

const filePath = process.argv[2];

const web = await startWebServer({
  port: 3457,
  initialSessionPath: filePath,
});

console.log(`Web explorer running at ${web.baseUrl} (Ctrl+C to stop)`);
