/** Literal private, link-local or loopback IPv4 only. Never resolve untrusted hostnames. */
export function isLocalIPv4(host: string): boolean {
  if (!/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(host))
    return false;
  const octets = host.split(".").map(Number);
  if (octets.some((value) => value > 255)) return false;
  const [a, b] = octets;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}
