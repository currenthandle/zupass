const isProd = process.env.NODE_ENV === "production";

export const SET_SERVER_DOMAIN = isProd
  ? "https://set-membership-server.onrender.com"
  : "http://127.0.0.1:8000";

export const PASSPORT_SERVER_DOMAIN = isProd
  ? "https://passport-server-rygt.onrender.com"
  : "http://localhost:3002";

console.log("PASSPORT_SERVER_DOMAIN", PASSPORT_SERVER_DOMAIN);
console.log("SET_SERVER_DOMAIN", SET_SERVER_DOMAIN);

export const WASM_PATH = "/ezkl-artifacts/ezkl_bg.wasm";
export const CHUNK_SIZE = 400; // The max length for each chunk
export const FRAME_RATE = 200;
