import type {
  Archive,
  DiscoveryDevice,
  Endpoint,
  ServerEvent,
  Vault,
} from "../shared/protocol.js";
export interface Bootstrap {
  csrf: string;
  dataEpoch: string;
  endpoint: Endpoint;
  hasVault: boolean;
  discoveryEnabled: boolean;
  lanBind: string;
  relayUrl?: string;
}
export interface LocalSocket {
  readyState: number;
  send(data: string): void;
  close(code?: number): void;
  addEventListener(type: string, listener: (event: any) => void): void;
}
export interface Backend {
  bootstrap(): Promise<Bootstrap>;
  vault(): Promise<Vault | null>;
  saveVault(vault: Vault, create?: boolean): Promise<void>;
  history(): Promise<Archive[]>;
  outgoing(row: Archive): Promise<void>;
  receive(row: Archive): Promise<boolean>;
  delivered(id: string): Promise<void>;
  receipt?(id: string, state: "SENT" | "DELIVERED" | "READ"): Promise<void>;
  clearHistory(): Promise<void>;
  reset(): Promise<void>;
  socket(
    onEvent: (event: ServerEvent) => void,
    onClose: (code: number) => void,
  ): Promise<LocalSocket>;
}
export class ClientApi implements Backend {
  private csrf = "";
  private cookie = "";
  private dataEpoch = "";
  private writes: Promise<unknown> = Promise.resolve();
  constructor(
    private base = typeof location === "undefined" ? "" : location.origin,
    private factory?: (url: string, cookie: string) => LocalSocket,
  ) {}
  private async request(
    path: string,
    method = "GET",
    data?: unknown,
  ): Promise<any> {
    if (method === "GET") return this.rawRequest(path, method, data);
    // Preserve mutation order across reset, trust updates, ACKs and history deletion.
    const result = this.writes.then(() => this.rawRequest(path, method, data));
    this.writes = result.catch(() => undefined);
    return result;
  }
  private async rawRequest(
    path: string,
    method: string,
    data?: unknown,
  ): Promise<any> {
    const response = await fetch(this.base + path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(method !== "GET"
          ? {
              "X-BC-CSRF": this.csrf,
              "X-BC-DATA-EPOCH": this.dataEpoch,
              "Content-Type": "application/json",
            }
          : {}),
      },
      ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
    });
    // HttpOnly cookies are invisible in browsers. Node's integration test uses the same HTTP API.
    if (typeof window === "undefined")
      this.cookie =
        response.headers.get("set-cookie")?.split(";")[0] ?? this.cookie;
    if (!response.ok)
      throw new Error(
        "The local service could not save or load this operation",
      );
    const value = await response.json();
    if (value.dataEpoch) this.dataEpoch = value.dataEpoch;
    return value;
  }
  async bootstrap(): Promise<Bootstrap> {
    const value = await this.request("/api/bootstrap");
    this.csrf = value.csrf;
    this.dataEpoch = value.dataEpoch;
    return value;
  }
  async vault(): Promise<Vault | null> {
    return (await this.request("/api/vault")).vault;
  }
  async saveVault(vault: Vault, create = false): Promise<void> {
    await this.request("/api/vault", "POST", { vault, create });
  }
  async history(): Promise<Archive[]> {
    return (await this.request("/api/history")).messages;
  }
  async outgoing(row: Archive): Promise<void> {
    await this.request("/api/outgoing", "POST", row);
  }
  async receive(row: Archive): Promise<boolean> {
    return (await this.request("/api/receive", "POST", row)).inserted;
  }
  async delivered(messageId: string): Promise<void> {
    await this.request("/api/delivered", "POST", { messageId });
  }
  async receipt(
    messageId: string,
    state: "SENT" | "DELIVERED" | "READ",
  ): Promise<void> {
    await this.request("/api/receipt", "POST", { messageId, state });
  }
  async clearHistory(): Promise<void> {
    await this.request("/api/history", "DELETE");
  }
  async reset(): Promise<void> {
    await this.request("/api/reset", "POST", {});
  }
  socket(
    onEvent: (event: ServerEvent) => void,
    onClose: (code: number) => void,
  ): Promise<LocalSocket> {
    const url = this.base.replace(/^http/, "ws") + "/local";
    const socket = this.factory
      ? this.factory(url, this.cookie)
      : new WebSocket(url);
    return new Promise((resolve, reject) => {
      let opened = false;
      socket.addEventListener("open", () => {
        opened = true;
        resolve(socket);
      });
      socket.addEventListener("message", (event) => {
        try {
          onEvent(JSON.parse(String(event.data)));
        } catch {
          socket.close(1008);
        }
      });
      socket.addEventListener("close", (event) => {
        onClose(event.code);
        if (!opened)
          reject(new Error("Could not connect to the local service"));
      });
      socket.addEventListener("error", () => {
        if (!opened)
          reject(new Error("Could not connect to the local service"));
      });
    });
  }
}
