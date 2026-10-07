import { InternalLink, type Navigate } from "./pages";

export default function Policy({
  kind,
  navigate,
}: {
  kind: "terms" | "privacy";
  navigate: Navigate;
}) {
  return (
    <article className="card reading-card">
      {kind === "privacy" ? (
        <>
          <h3>Where your data lives</h3>
          <p>
            Butter Chicken is software you run on your own computer. It has no
            hosted account, analytics, advertising or telemetry service. Your
            display name, device keys and saved trust are inside an encrypted
            local vault. Conversation contents are stored as encrypted SQLite
            records in the configured data directory.
          </p>
          <h3>What the other device receives</h3>
          <p>
            Pairing exchanges public identity keys, connection details and an
            encrypted display name. The invitation contains a one-time pairing
            token. Share it only with your intended friend. Messages are
            encrypted in the browser before passing through either Node service.
          </p>
          <h3>Visible metadata</h3>
          <p>
            The local transport and network observers can see public device IDs,
            IP addresses, message IDs, timestamps, traffic timing and lengths.
            SQLite also stores message IDs, peer IDs, direction and delivery
            state. Encryption does not hide this metadata.
          </p>
          <h3>Browser storage and permissions</h3>
          <p>
            A temporary HttpOnly session cookie authorizes the local service.
            Browser local storage holds only theme and auto-lock preferences.
            The QR camera is used only when you request a scan; you can use a QR
            image or pasted invitation instead. Camera frames are processed
            locally and are not uploaded by this app.
          </p>
          <h3>Retention and deletion</h3>
          <p>
            History remains on your device until you delete it. Delete history
            removes this device’s messages while retaining replay-prevention
            IDs. Remove trust also removes the saved friend. Reset identity
            removes the vault, messages and replay IDs, while retaining a random
            discovery identifier. Backups, filesystem snapshots and your
            friend’s copies are outside this deletion operation.
          </p>
          <h3>Third-party software and your control</h3>
          <p>
            Installing dependencies and browser updates may contact their
            suppliers. Normal app operation uses LAN and, when configured, an
            internet relay. The relay forwards encrypted messages, retains
            offline ciphertext for up to 24 hours, and observes identity,
            routing, IP, timing and size metadata. It does not receive private
            keys or pairing tokens. Third-party browser extensions, malware and
            changes to this software can affect these protections. Anyone
            publishing a modified or hosted version must provide a privacy
            policy that accurately describes that version.
          </p>
          <p>
            You control the local data directory and passphrase. There is no
            external account operator who can recover the vault or delete the
            other person’s copy.
          </p>
        </>
      ) : (
        <>
          <h3>What these terms cover</h3>
          <p>
            These terms describe the intended use of the supplied Butter Chicken
            application. The app runs locally and provides a two-device
            conversation over LAN or a configured internet relay. A relay
            operator provides the transport hosting. It does not provide an
            emergency communication service or staffed support service.
          </p>
          <h3>Use devices and networks you are allowed to use</h3>
          <p>
            Install and connect the app only on devices and networks you are
            authorized to use. Obtain the other person’s agreement before
            pairing. Follow applicable laws and the rules of your network. Do
            not use the app to interfere with someone else’s device or service.
          </p>
          <h3>Your responsibilities</h3>
          <p>
            Keep the passphrase and invitation private, compare the full
            security code, maintain your computer and decide whether backups are
            appropriate. You are responsible for messages you send and for
            managing your local data. Removing a pairing does not delete the
            other person’s history.
          </p>
          <h3>Security and availability</h3>
          <p>
            The app has not been independently audited. It has no forward
            secrecy or message ratchet and cannot protect an unlocked or
            compromised endpoint. Network availability and delivery times vary.
            Do not rely on it as your only way to communicate in an emergency.
          </p>
          <h3>No recovery or service guarantee</h3>
          <p>
            There is no account recovery, guaranteed delivery time, guaranteed
            human response time or uptime commitment. Lost keys or passphrases
            may make history unrecoverable. The software is supplied as
            available; evaluate it for your own circumstances. Nothing in these
            terms changes rights or obligations that applicable law does not
            allow to be changed.
          </p>
          <h3>Dependencies and modified versions</h3>
          <p>
            Third-party packages retain their respective license terms. If you
            distribute or modify the app, review those licenses and provide
            accurate terms and privacy information for your version.
          </p>
        </>
      )}
      <p className="policy-date">
        Version 1.0 internet upgrade · Updated 7 October 2026
      </p>
      <InternalLink
        href={kind === "terms" ? "/privacy" : "/terms"}
        navigate={navigate}
      >
        {kind === "terms" ? "Read the privacy policy" : "Read the terms of use"}
      </InternalLink>
    </article>
  );
}
