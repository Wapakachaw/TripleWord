// Room storage. Uses Upstash Redis when its environment variables are set (Vercel's Redis
// integration adds them); otherwise falls back to memory, which is fine for local testing only.
const TTL_SECONDS = 60 * 60 * 24 * 7; // rooms expire after a week of inactivity

let redis = null;
const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const tokenEnv = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
if (url && tokenEnv) {
  const { Redis } = require("@upstash/redis");
  redis = new Redis({ url, token: tokenEnv });
}

const memory = globalThis.__wordRooms || (globalThis.__wordRooms = new Map());
const memLocks = new Set();
const sleep = ms => new Promise(r => setTimeout(r, ms));

const key = code => `room:${code}`;

async function get(code) {
  if (!redis) {
    const raw = memory.get(key(code));
    return raw ? JSON.parse(raw) : null;
  }
  const raw = await redis.get(key(code));
  if (!raw) return null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function put(room) {
  const raw = JSON.stringify(room);
  if (!redis) { memory.set(key(room.code), raw); return; }
  await redis.set(key(room.code), raw, { ex: TTL_SECONDS });
}

/** Create only if the code is unused. Returns false on collision. */
async function create(room) {
  const raw = JSON.stringify(room);
  if (!redis) {
    if (memory.has(key(room.code))) return false;
    memory.set(key(room.code), raw);
    return true;
  }
  const ok = await redis.set(key(room.code), raw, { nx: true, ex: TTL_SECONDS });
  return ok === "OK";
}

/** Run fn(room) under a short lock so two players can't change the room at the same moment. */
async function update(code, fn) {
  const lockKey = `lock:${code}`;
  const id = "lock-" + Math.random().toString(36).slice(2);
  for (let attempt = 0; attempt < 40; attempt++) {
    const got = redis
      ? (await redis.set(lockKey, id, { nx: true, px: 5000 })) === "OK"
      : !memLocks.has(lockKey) && memLocks.add(lockKey);
    if (got) {
      try {
        const room = await get(code);
        if (!room) return { room: null };
        const out = await fn(room);
        room.version++;
        room.updatedAt = Date.now();
        await put(room);
        return { room, out };
      } finally {
        if (redis) {
          const holder = await redis.get(lockKey);
          if (holder === id) await redis.del(lockKey);
        } else memLocks.delete(lockKey);
      }
    }
    await sleep(75);
  }
  const err = new Error("The room is busy. Try again.");
  err.status = 503;
  throw err;
}

module.exports = { get, create, update, usingRedis: () => !!redis };
