import { startProxy } from "./dist/index.js";

console.log("Starting proxy...");

const proxy = await startProxy({
  port: 8402,
  onReady: (port) => console.log("Proxy on port", port),
  onError: (err) => console.error("Error:", err),
});

console.log("Ready");
setTimeout(() => {}, 3600000);
