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
            Butter Chicken runs on your own computer. Your identity keys and saved
            friend are inside an encrypted local vault. Conversation contents are
            stored as encrypted records in your data directory. The project has no
            hosted account, analytics, advertising or telemetry service.
          </p>
          <h3>What the relay and your friend receive</h3>
          <p>
            Pairing sends your public identity, a signed invitation and a one-time
            token through the relay, which holds it behind the 6-digit code for ten
            minutes. Messages are encrypted in your browser before they leave your
            computer. The relay forwards and temporarily stores ciphertext.
          </p>
          <h3>Visible metadata</h3>
          <p>
            The relay can see public identifiers, IP addresses, message IDs,
            timestamps, traffic timing and sizes, and the pairing token. It cannot
            read messages or private keys. Your local SQLite database also stores
            message IDs, peer IDs, direction and delivery state.
          </p>
          <h3>Browser storage and sessions</h3>
          <p>
            A temporary HttpOnly session cookie authorizes the local service.
            Browser storage holds only theme preferences and, for the current tab,
            the session key that lets a reload skip the passphrase.
          </p>
          <h3>Retention and deletion</h3>
          <p>
            History stays on your device until you delete it. Deleting history
            keeps replay-prevention IDs. Removing a friend deletes the saved trust
            and conversation on this device. Resetting the identity deletes the
            vault, messages and replay IDs. Backups and your friend's copies are
            outside this deletion operation.
          </p>
          <h3>Relay and third parties</h3>
          <p>
            The relay runs on Cloudflare Workers and Durable Objects. Cloudflare
            sees network metadata under its own terms. Relay storage keeps offline
            ciphertext for up to 24 hours. Installing dependencies and browser
            updates may contact their suppliers. Malware, browser extensions and
            modified versions of this software can affect these protections.
          </p>
          <p>
            You control your data directory and passphrase. No account operator can
            recover your vault or delete your friend's copy.
          </p>
        </>
      ) : (
        <>
          <h3>What these terms cover</h3>
          <p>
            These terms describe the intended use of the supplied Butter Chicken
            application. It runs on your computer and provides a two-person
            conversation through a configured relay. The relay operator provides
            hosting. It is not an emergency communication service or a staffed
            support service.
          </p>
          <h3>Use devices you are allowed to use</h3>
          <p>
            Install and use the app only on devices and networks you are authorized
            to use. Get your friend's agreement before pairing. Follow applicable
            laws. Do not use the app to interfere with someone else's device or
            service.
          </p>
          <h3>Your responsibilities</h3>
          <p>
            Keep your passphrase and pairing codes private. Compare the full
            security code before you confirm. Maintain your computer and decide
            whether backups are appropriate. You are responsible for messages you
            send and for your local data. Removing a friend does not delete your
            friend's history.
          </p>
          <h3>Security and availability</h3>
          <p>
            The app has not been independently audited. It has no forward secrecy
            or message ratchet, and it cannot protect an unlocked or compromised
            computer. Network availability and delivery times vary. Do not rely on
            it as your only way to communicate in an emergency.
          </p>
          <h3>No recovery or service guarantee</h3>
          <p>
            There is no account recovery, guaranteed delivery time or uptime
            commitment. Lost keys or passphrases may make history unrecoverable.
            The software is provided as available. Nothing in these terms changes
            rights that applicable law does not allow to be changed.
          </p>
          <h3>Dependencies and modified versions</h3>
          <p>
            Third-party packages keep their own license terms. If you distribute or
            modify the app, review those licenses and provide accurate terms and
            privacy information for your version.
          </p>
        </>
      )}
      <p className="policy-date">Version 1.0 · Updated 20 November 2026</p>
      <InternalLink
        href={kind === "terms" ? "/privacy" : "/terms"}
        navigate={navigate}
      >
        {kind === "terms" ? "Read the privacy policy" : "Read the terms of use"}
      </InternalLink>
    </article>
  );
}
