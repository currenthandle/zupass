async function getFile(url: string, filename: string) {
  const resp = await fetch(url + filename);
  if (!resp.ok) {
    throw new Error(`Failed to fetch ${url} ${filename}`);
  }
  const buf = await resp.arrayBuffer();
  const arr = new Uint8ClampedArray(buf);
  return arr;
}

export async function getVK(url: string) {
  return await getFile(url, "test.vk");
}

export async function getPK(url: string) {
  return await getFile(url, "test.pk");
}

export async function getSRS(url: string) {
  return await getFile(url, "kzg.srs");
}

export async function getSettings(url: string) {
  return await getFile(url, "settings.json");
}
