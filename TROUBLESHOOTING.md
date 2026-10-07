# Connection troubleshooting

## Internet relay first

For different Wi-Fi/mobile networks, both computers must configure the same real `BC_RELAY_URL=wss://your-domain/relay` and restart. GitHub does not run the relay. Follow [relay deployment/troubleshooting](relay/README.md) and [friend setup](docs/FRIEND_SETUP.md). Internet mode needs outbound WSS, not incoming client ports or router forwarding.

Check the relay HTTPS `/health`, canonical public URL, DNS, TLS certificate and configured client URLs. Never disable TLS verification. A 1008 close can indicate wrong proof/audience, duplicate cloned identity session, mismatched old pin/epoch or resource limit. Logs contain event names only. Remove trust on both clients and re-pair once to upgrade a legacy LAN pairing for durable internet delivery.

Relay unavailable or queue full: encrypted local pending remains and retries. Expired temporary relay mail does not erase the sender's local pending copy. DELIVERED requires the friend's decrypted/local-save receipt; READ requires active visible chat. If the local Node process stopped, relaunch it and reload/unlock the browser. Network changes reconnect through relay automatically; direct LAN listener binding may need a restart.

The remaining firewall/address sections apply to **optional direct LAN**, not to internet-only connectivity. Do not disable firewalls or open a friend's local UI to the internet. Physical different-network verification instructions are in [TWO_COMPUTERS.md](docs/TWO_COMPUTERS.md).

Start with both local services running and both browser vaults unlocked. Open each computer’s own **http://localhost:3000**. The UI port is 3000; the LAN port is normally **4455**. Opening A’s localhost from B does not connect the devices.

## Common symptoms

| Symptom                              | What to check                                                                                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| UI unavailable                       | Run `butter-chicken` from any directory; install Node 24; check startup output; try `http://127.0.0.1:3000` if localhost resolves only to IPv6 |
| Cannot start                         | Another process may use 3000/4455; choose other ports in `.env`; check data-directory permissions and the LAN bind address                     |
| LAN address starts `127.`            | No private interface was selected, or loopback was configured; set `BC_LAN_HOST` to this computer’s current private IPv4 and restart           |
| Nearby list empty                    | mDNS may be blocked; a complete invitation and manual address still work                                                                       |
| Friend offline                       | Both apps must be running/unlocked; check firewall, current IP, port, same reachable subnet, guest isolation and VPN/interface selection       |
| QR scan fails                        | Use the original high-resolution QR image, a clear camera view, or paste the full invitation; camera permission is optional                    |
| Invitation expired                   | Create a new invitation on A; check that both computers’ clocks are reasonably correct                                                         |
| Wrong-token or failed authentication | Use a newly generated complete invitation from the intended person; compare the new security code                                              |
| Pairing saved on only one computer   | Remove any saved trust on both computers and repeat pairing; an interruption or storage failure can leave one side ahead                       |
| Already open in another tab          | Close the other unlocked tab, then unlock here; the service permits one active local UI session                                                |
| Identity changed                     | Stop and verify with your friend; do not replace the pinned identity just because an address or name looks familiar                            |
| Wrong passphrase                     | Use the original passphrase/data backup; there is no account recovery; resetting loses local keys/history                                      |
| Message waiting for delivery         | Keep both devices unlocked; it retries every five seconds while authenticated; a receipt means saved, not read                                 |

After changing Wi-Fi or the LAN bind address, **restart the Node service**. Discovery can find the saved routing identifier at a new IP. If it cannot, use the current address in **Settings → Friend’s LAN IPv4 → Reconnect to trusted device**. A name or discovery result is not identity verification.

If you intentionally reset a device, remove the old trusted device on the other computer and verify a new invitation on both. Ordinary global reinstall preserves the separate user-data folder. Deleting or replacing the original data creates a new identity. A backup containing the original vault preserves the old identity; protect that backup as sensitive material.

## Firewall: Windows

Use a network you trust and the Windows **Private** network profile. In an **Administrator PowerShell**, allow TCP 4455 only from the local subnet and only on the Private profile:

```powershell
New-NetFirewallRule -DisplayName "Butter Chicken LAN" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 4455 -Profile Private -RemoteAddress LocalSubnet
```

If you changed the port, change it in the rule too. Optional discovery uses UDP 5353; if Windows blocks it and you want discovery:

```powershell
New-NetFirewallRule -DisplayName "Butter Chicken discovery" -Direction Inbound -Action Allow -Protocol UDP -LocalPort 5353 -Profile Private -RemoteAddress LocalSubnet
```

You can use manual addresses without the discovery rule. Remove these rules later with:

```powershell
Remove-NetFirewallRule -DisplayName "Butter Chicken LAN"
Remove-NetFirewallRule -DisplayName "Butter Chicken discovery"
```

An organization’s policy may override local rules. Do not select Public-network access or disable the firewall to bypass it. [Microsoft firewall command documentation](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/configure-with-command-line).

## Firewall: macOS

Open **System Settings → Network → Firewall → Options**. Add/allow the Node executable used to run this app if macOS requests permission for incoming connections. Find that executable in Terminal with:

```bash
command -v node
```

The macOS application firewall grants access to the executable, rather than offering the same per-port/subnet rule UI as Windows. Keep `BC_LAN_HOST` on your trusted private interface and use the app only on networks you intend to share. Manual IP entry avoids a dependency on multicast discovery. Consult your administrator for centrally managed policies. [Apple firewall instructions](https://support.apple.com/guide/mac-help/mh34041/mac).

## Firewall: Linux with UFW

Inspect the existing firewall:

```bash
sudo ufw status verbose
```

If it is active, allow the LAN port from your actual local subnet. **The subnet below is an example**; replace it with yours:

```bash
sudo ufw allow proto tcp from 192.168.1.0/24 to any port 4455
```

Optional discovery, if multicast is blocked:

```bash
sudo ufw allow proto udp from 192.168.1.0/24 to any port 5353
```

Remove an added rule with the identical command prefixed by `delete`, for example:

```bash
sudo ufw delete allow proto tcp from 192.168.1.0/24 to any port 4455
```

Other distributions may use firewalld or nftables; use equivalent local-subnet rules for TCP 4455 and optional UDP 5353. This guide does not change your firewall automatically. [Ubuntu firewall documentation](https://ubuntu.com/server/docs/firewalls/).

## Interface selection and networks

If a VPN, Docker interface or second network is selected, copy `.env.example` to the printed user-data `config.env` (or project `.env` for development), set `BC_LAN_HOST` to your Wi-Fi/wired private IPv4 and restart. Windows `ipconfig`, macOS Network details, and Linux `ip -4 address` can show the address. Do not put the friend’s address in your own `BC_LAN_HOST`; that variable is this computer’s listening address.

Guest Wi-Fi, client/AP isolation, separate VLANs, captive portals and some hotspots block direct device traffic. The same SSID does not guarantee reachability. Prefer an ordinary trusted home/office LAN or ask the network owner. Different networks do not work in this initial local-only version. There is no UPnP, internet relay or router port forwarding.

## Safe diagnostics

Startup logs show service addresses, status and local data/config paths, not keys or message contents. Avoid sharing real invitations, screenshots of messages, passphrases, keys or your database while troubleshooting. Reproduce with disposable test identities if possible. `npm run check` and `npm run test:browser` exercise the implementation locally; they do not certify your physical network or firewall.

## Data-directory permission error

Use a dedicated directory owned by the account running Node. On Linux/macOS, its mode must be 0700; run `chmod 700` only on that dedicated directory, not a shared or system folder. Windows users must set private account ACLs. Never make the database world-readable to fix startup. If storage is damaged, stop the service and restore a protected backup; do not delete or edit a real vault as an audit experiment.

## Global command not found

Run `npm prefix --global`. On macOS/Linux the command lives under that prefix's `bin` directory; on Windows it lives in the prefix itself. Add the relevant directory to your user PATH and reopen the terminal. `command -v butter-chicken` (Unix) or `Get-Command butter-chicken` (PowerShell) locates it. Reinstall the actual local `.tgz` bundle if necessary. Use `npm.cmd` / `butter-chicken.cmd` or Command Prompt for a PowerShell script-policy error. README contains exact user-prefix commands; do not change system-folder permissions.

## Dependency or build failure

Check `node --version` is 24.x and npm is available. Initial installation needs internet access to download packages; runtime chat does not. Retry from the trusted source folder with `npm ci`, then `npm run check`. Keep the lockfile; do not fix failures by deleting private data or disabling integrity checks. For a ready ZIP, reinstall `./butter-chicken-1.0.0.tgz` globally. A npm registry outage cannot be fixed by resetting the app identity.

## Status says unavailable / localhost does not open

Run `butter-chicken status`, then read startup output from the original terminal. If another app uses port 3000 or 4455, stop the conflicting app only if it is yours, or configure unused ports in user-data `config.env` and restart. Try the printed URL and `http://127.0.0.1:<printed-port>` for an IPv6-only localhost resolution issue. Do not launch a second copy against the same database. No background daemon exists.

## Crash or damaged database

A new launch normally reopens the same encrypted data. Do not create a replacement identity to hide a load failure. Stop the process, protect the existing directory and restore a known backup while stopped if necessary. A corrupted vault now returns a safe error rather than an unhandled bootstrap exception. There is no automatic key recovery or supported manual database editing. Use the explicit UI reset only if you accept losing local identity/history.

## Update failure

Stop the old process, back up the user-data directory, inspect `git status`, and use `git pull --ff-only`. Resolve local changes rather than forcing a reset. Run `npm ci`, `npm run check`, `npm run audit:security` and `npm run pack:release`, then install the exact generated `.tgz`. If tests fail, do not install that build. Reinstall a previously trusted bundle to recover the command; keep the database intact. A future incompatible schema requires that release's migration guidance.
