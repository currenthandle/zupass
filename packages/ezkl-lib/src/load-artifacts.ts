// LOAD VK
export async function loadVK(url: string) {
  const vkResp = await fetch(url + "test.vk");
  if (!vkResp.ok) {
    throw new Error("Failed to fetch test.vk");
  }
  const vkBuf = await vkResp.arrayBuffer();
  const vk = new Uint8ClampedArray(vkBuf);
  return vk;
}

// LOAD SETTINGS
export async function loadSettings(url: string) {
  const settingsResp = await fetch(url + "settings.json");
  if (!settingsResp.ok) {
    throw new Error("Failed to fetch settings.json");
  }
  const settingsBuf = await settingsResp.arrayBuffer();
  const settings = new Uint8ClampedArray(settingsBuf);
  return settings;
}

// LOAD SRS
export async function loadSRS(url: string) {
  const srsResp = await fetch(url + "kzg.srs");
  if (!srsResp.ok) {
    throw new Error("Failed to fetch kzg.srs");
  }
  const srsBuf = await srsResp.arrayBuffer();
  const srs = new Uint8ClampedArray(srsBuf);
  return srs;
}
