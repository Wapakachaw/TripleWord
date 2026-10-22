// Single endpoint for the whole game.
//   GET  /api/game?code=ABCDE&token=...&v=12   -> room state for that player (or {unchanged:true})
//   POST /api/game { action, code, token, ... } -> create | join | start | play | exchange | pass | rematch | leave
const store = require("../lib/store");
const G = require("../lib/game");

function readBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  if (typeof req.body === "string") return Promise.resolve(JSON.parse(req.body || "{}"));
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => { data += c; if (data.length > 1e5) req.destroy(); });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

const normCode = c => String(c || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5);

module.exports = async function handler(req, res) {
  if (process.env.VERCEL && !store.usingRedis()) {
    return send(res, 500, { error: "Game storage isn't set up yet. In Vercel, open this project's Storage tab, add an Upstash Redis database, then redeploy." });
  }
  try {
    if (req.method === "GET") {
      const q = req.query || Object.fromEntries(new URL(req.url, "http://x").searchParams);
      const code = normCode(q.code);
      const room = await store.get(code);
      if (!room) return send(res, 404, { error: "That room doesn't exist or has expired. Check the code." });
      const who = room.players.findIndex(p => p.token === q.token);
      if (q.v && Number(q.v) === room.version) return send(res, 200, { unchanged: true, version: room.version });
      return send(res, 200, G.view(room, who));
    }

    if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
    const body = await readBody(req);
    const action = body.action;

    if (action === "create") {
      for (let i = 0; i < 8; i++) {
        const { room, playerIndex, token } = G.createRoom(G.newCode(), body.name);
        if (await store.create(room)) {
          return send(res, 200, { code: room.code, token, playerIndex, state: G.view(room, playerIndex) });
        }
      }
      return send(res, 503, { error: "Couldn't create a room. Try again." });
    }

    const code = normCode(body.code);
    let joined = null;
    const { room } = await store.update(code, room => {
      if (action === "join") { joined = G.joinRoom(room, body.name); return; }
      const who = G.playerByToken(room, body.token);
      switch (action) {
        case "start": return G.startGame(room, who, body.settings);
        case "play": return G.play(room, who, body.placements);
        case "exchange": return G.exchange(room, who, body.letters);
        case "pass": return G.pass(room, who);
        case "rematch": return G.rematch(room, who);
        case "leave": return G.leaveLobby(room, who);
        default: throw new G.GameError("Unknown action.");
      }
    });
    if (!room) return send(res, 404, { error: "That room doesn't exist or has expired. Check the code." });

    const token = joined ? joined.token : body.token;
    const who = room.players.findIndex(p => p.token === token);
    return send(res, 200, { code: room.code, token, playerIndex: who, state: G.view(room, who) });
  } catch (err) {
    const status = err.status || (err instanceof SyntaxError ? 400 : 500);
    if (status >= 500) console.error(err);
    return send(res, status, { error: status >= 500 && !err.status ? "Something went wrong on the server. Try again." : err.message });
  }
};
