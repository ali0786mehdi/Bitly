// Drop-in replacement for the Claude-artifact "window.storage" API,
// backed by the browser's localStorage instead. Same async shape
// (get/set/delete/list), so App.jsx barely has to change.

const ROOT_KEY = "snip:kv-store";

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(ROOT_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeAll(data) {
  localStorage.setItem(ROOT_KEY, JSON.stringify(data));
}

export const storage = {
  async get(key) {
    const data = readAll();
    if (!(key in data)) {
      throw new Error(`key not found: ${key}`);
    }
    return { key, value: data[key] };
  },

  async set(key, value) {
    const data = readAll();
    data[key] = value;
    writeAll(data);
    return { key, value };
  },

  async delete(key) {
    const data = readAll();
    const existed = key in data;
    delete data[key];
    writeAll(data);
    return { key, deleted: existed };
  },

  async list(prefix = "") {
    const data = readAll();
    return { keys: Object.keys(data).filter((k) => k.startsWith(prefix)) };
  },
};
