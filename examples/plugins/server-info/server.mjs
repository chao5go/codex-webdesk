import os from "node:os";
export default function createPlugin({ apiBase }) {
  return {
    async handle({ req, res, route, json }) {
      if (req.method !== "GET" || route !== "/info") return false;
      json(res, 200, {
        hostname: os.hostname(),
        platform: os.platform(),
        uptime: os.uptime(),
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
        apiBase,
      });
      return true;
    },
  };
}
