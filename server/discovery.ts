import { Bonjour, type Service } from "bonjour-service";
import { networkInterfaces } from "node:os";
import { isLocalIPv4 } from "../shared/address.js";
export { isLocalIPv4 } from "../shared/address.js";
import type { DiscoveryDevice, Endpoint } from "../shared/protocol.js";

export function lanAddresses(): string[] {
  return Object.values(networkInterfaces()).flatMap((entries) =>
    (entries ?? [])
      .filter(
        (x) => x.family === "IPv4" && !x.internal && isLocalIPv4(x.address),
      )
      .map((x) => x.address),
  );
}
export function chooseBind(value = "auto"): string {
  if (value === "auto") return lanAddresses()[0] ?? "127.0.0.1";
  if (value === "0.0.0.0" || isLocalIPv4(value)) return value;
  throw new Error(
    "BC_LAN_HOST must be auto, 127.0.0.1, 0.0.0.0 or a private LAN IPv4 address",
  );
}
export class Discovery {
  devices = new Map<string, DiscoveryDevice>();
  private bonjour?: Bonjour;
  private stopBrowser?: () => void;
  constructor(endpoint: Endpoint, onChange: () => void, enabled: boolean) {
    if (!enabled || endpoint.host.startsWith("127.")) return;
    try {
      this.bonjour = new Bonjour(undefined, () => {});
      this.bonjour.publish({
        name: `Butter Chicken ${endpoint.nodeId.slice(0, 8)}`,
        type: "butterchicken",
        port: endpoint.port,
        txt: { v: "1", node: endpoint.nodeId },
      });
      const browser = this.bonjour.find({ type: "butterchicken" });
      const update = (service: Service) => {
        const id = String(service.txt?.node ?? "");
        if (
          !/^[a-f0-9]{32}$/.test(id) ||
          id === endpoint.nodeId ||
          String(service.txt?.v) !== "1"
        )
          return;
        const host = service.addresses?.find(isLocalIPv4);
        if (
          !host ||
          service.port < 1 ||
          service.port > 65535 ||
          this.devices.size >= 64
        )
          return;
        this.devices.set(id, {
          nodeId: id,
          host,
          port: service.port,
          label: `Device ${id.slice(0, 8)}`,
        });
        onChange();
      };
      browser.on("up", update);
      browser.on("down", (service) => {
        this.devices.delete(String(service.txt?.node ?? ""));
        onChange();
      });
      // A multicast failure does not block manual connections or crash the service.
      this.stopBrowser = () => browser.stop();
    } catch {
      this.bonjour?.destroy();
      this.bonjour = undefined;
    }
  }
  close(): void {
    this.stopBrowser?.();
    this.bonjour?.unpublishAll();
    this.bonjour?.destroy();
  }
}
