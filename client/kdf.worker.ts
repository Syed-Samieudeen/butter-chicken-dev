import { cryptoReady, derivePasswordKey } from "./crypto";
self.onmessage = async (event) => {
  try {
    await cryptoReady;
    const key = derivePasswordKey(event.data.passphrase, event.data.salt);
    self.postMessage(
      { key: key.buffer },
      { transfer: [key.buffer as ArrayBuffer] },
    );
  } catch {
    self.postMessage({ error: true });
  }
};
