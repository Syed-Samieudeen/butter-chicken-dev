import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
  type MouseEvent,
} from "react";
import {
  ArrowRight,
  Check,
  ChevronRight,
  HelpCircle,
  Heart,
  Laptop,
  LockKeyhole,
  MessageCircle,
  ShieldCheck,
  Wifi,
} from "./icons";
import Policy from "./policies";
import { metadataForPath, normalizePath, pageMetadata } from "../shared/pages";

export function useLocalRoutes() {
  const [path, setPath] = useState(() => normalizePath(location.pathname));
  const navigate = useCallback((to: string) => {
    if (to.startsWith("#")) {
      document.querySelector(to)?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    if (location.pathname !== to) history.pushState(null, "", to);
    setPath(normalizePath(to));
  }, []);
  useEffect(() => {
    const back = () => setPath(normalizePath(location.pathname));
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);
  useEffect(() => {
    const { title, description } = metadataForPath(path);
    document.title = title;
    for (const selector of [
      'meta[name="description"]',
      'meta[property="og:description"]',
      'meta[name="twitter:description"]',
    ])
      document.querySelector(selector)?.setAttribute("content", description);
    for (const selector of [
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
    ])
      document.querySelector(selector)?.setAttribute("content", title);
  }, [path]);
  return { path, navigate };
}
export type Navigate = (to: string) => void;
export function InternalLink({
  href,
  navigate,
  children,
  className,
}: {
  href: string;
  navigate: Navigate;
  children: ReactNode;
  className?: string;
}) {
  const click = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    navigate(href);
  };
  return (
    <a href={href} onClick={click} className={className}>
      {children}
    </a>
  );
}
const labels: Record<string, string> = {
  "/pair": "Pair devices",
  "/security": "Security",
  "/settings": "Settings",
  "/help": "Help",
  "/help/faq": "FAQs",
  "/help/two-computers": "Pairing guide",
  "/help/use-cases": "Example use cases",
  "/help/security": "Encryption and limits",
  "/help/demo": "Product demo",
  "/terms": "Terms of use",
  "/privacy": "Privacy policy",
  "/thank-you": "Pairing confirmation",
};
export function Breadcrumbs({
  path,
  navigate,
}: {
  path: string;
  navigate: Navigate;
}) {
  if (path === "/") return null;
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <InternalLink href="/" navigate={navigate}>
        Home
      </InternalLink>
      <ChevronRight size={13} />
      {path.startsWith("/help/") ? (
        <>
          <InternalLink href="/help" navigate={navigate}>
            Help
          </InternalLink>
          <ChevronRight size={13} />
        </>
      ) : null}
      <span aria-current="page">{labels[path] ?? "Page not found"}</span>
    </nav>
  );
}
const faqs = [
  [
    "Do I need my friend's network?",
    "No. Both computers connect outbound to the Butter Chicken relay, so you can be on different Wi-Fi, mobile data or other countries. You never share IP addresses.",
  ],
  [
    "How do I pair with my friend?",
    "One person chooses Create a code and shares the 6-digit code privately. The other enters it and connects. Then you both compare the short security code on a call or in person. Only confirm when both screens match.",
  ],
  [
    "What happens when I go away?",
    "After 10 minutes without activity the screen locks and asks for your passphrase. Your connection stays on, so messages keep arriving. Keep this tab open to stay connected.",
  ],
  [
    "Are messages and private keys stored safely?",
    "Messages and keys are encrypted on your computer. A passphrase protects the vault, and each conversation record is encrypted with its own key. Use a strong passphrase and disk encryption.",
  ],
  [
    "What does resetting or removing a friend do?",
    "Removing a friend deletes this device's conversation and trust. Resetting the identity also deletes your keys. Your friend's copy is unchanged, and both of you must pair again.",
  ],
] as const;
function FAQs() {
  return (
    <div className="faq-list">
      {faqs.map(([question, answer]) => (
        <details key={question}>
          <summary>{question}</summary>
          <p>{answer}</p>
        </details>
      ))}
    </div>
  );
}
export function InfoPage({
  path,
  navigate,
  friendName,
}: {
  path: string;
  navigate: Navigate;
  friendName?: string;
}) {
  const known = Boolean(pageMetadata[path]);
  const headline = !known
    ? "This page wandered off."
    : path === "/help/faq"
      ? "Five questions. Clear answers."
      : path === "/help/two-computers"
        ? "Two computers. One conversation."
        : path === "/help/use-cases"
          ? "A little space in everyday life."
          : path === "/help/security"
            ? "Know what protects your chat."
            : path === "/help/demo"
              ? "The product, running."
              : path === "/terms"
                ? "Terms of use"
                : path === "/privacy"
                  ? "Privacy policy"
                  : path === "/thank-you"
                    ? friendName
                      ? "You’re paired. Thank you for checking."
                      : "Your pairing confirmation belongs here."
                    : "A good place to start.";
  return (
    <section className="page-scroll info-page">
      <div className="page-heading">
        <span className="eyebrow">
          {!known
            ? "404 · Page not found"
            : path === "/thank-you"
              ? "Pairing confirmation"
              : "Butter Chicken guide"}
        </span>
        <h2>{headline}</h2>
        <p>
          {!known
            ? "Use one of the links below to get back to your local space."
            : path === "/thank-you"
              ? friendName
                ? `Your device saved ${friendName}’s public identity after both people verified the code.`
                : "This screen confirms a pairing only after both devices have verified their shared code."
              : "Simple steps, useful answers and a clear picture of your device’s security."}
        </p>
        <div className="inline-actions hero-actions">
          <InternalLink
            className="button primary"
            href={friendName ? "/" : "/pair"}
            navigate={navigate}
          >
            {path === "/thank-you" && friendName
              ? "Start chatting"
              : friendName
                ? "Open your conversation"
                : "Open Butter Chicken"}
            <ArrowRight size={17} />
          </InternalLink>
          <InternalLink
            className="button secondary"
            href={path === "/thank-you" ? "/security" : "/help/two-computers"}
            navigate={navigate}
          >
            {path === "/thank-you" ? "Review security" : "Two-computer guide"}
          </InternalLink>
        </div>
      </div>
      {!known ? (
        <div className="card recovery-card">
          <HelpCircle size={34} />
          <h3>Everything you need is still here.</h3>
          <p>
            Try the{" "}
            <InternalLink href="/" navigate={navigate}>
              app home
            </InternalLink>
            ,{" "}
            <InternalLink href="/help" navigate={navigate}>
              getting-started guide
            </InternalLink>{" "}
            or{" "}
            <InternalLink href="/help/faq" navigate={navigate}>
              five common questions
            </InternalLink>
            .
          </p>
        </div>
      ) : path === "/terms" || path === "/privacy" ? (
        <Policy
          kind={path === "/terms" ? "terms" : "privacy"}
          navigate={navigate}
        />
      ) : path === "/help/demo" ? (
        <article className="reading-card">
          <h3>Captured from a working conversation</h3>
          <p>
            This screenshot comes from the automated browser test: two separate
            local services created identities, entered a 6-digit code, verified
            the code and exchanged encrypted messages.
          </p>
          <img
            className="demo-image"
            src="/demo-chat.png"
            width="1440"
            height="950"
            alt="The running Butter Chicken chat showing a verified connection between Alex and Sam, two test messages and delivery receipts"
          />
          <p className="demo-note">
            Synthetic test names and messages. The actual app opens with an
            empty conversation.
          </p>
          <InternalLink href="/help/two-computers" navigate={navigate}>
            Set up your own conversation
          </InternalLink>
        </article>
      ) : path === "/thank-you" ? (
        <div className="card success-card">
          <div className={`card-icon${friendName ? " green" : ""}`}>
            {friendName ? <ShieldCheck size={29} /> : <LockKeyhole size={29} />}
          </div>
          <h3>
            {friendName
              ? "Trust saved on this device"
              : "Verify before you trust"}
          </h3>
          <p>
            {friendName
              ? "Your friend will be authenticated against these saved keys on each connection. You can compare the same shared code again in Security."
              : "Open the app on both computers, create a 6-digit code, enter it on the other computer, and compare the security code. Then each person confirms the match."}
          </p>
          <div className="small-note">
            <Check size={16} />
            {friendName
              ? "Both devices confirmed the pairing code."
              : "A code and names alone do not establish trust."}
          </div>
          <InternalLink href="/help/security" navigate={navigate}>
            Read about encryption and its limits <ArrowRight size={14} />
          </InternalLink>
        </div>
      ) : path === "/help/faq" ? (
        <div className="card">
          <FAQs />
          <InternalLink href="/help/two-computers" navigate={navigate}>
            Need the setup steps? Open the guide <ArrowRight size={14} />
          </InternalLink>
        </div>
      ) : path === "/help/two-computers" ? (
        <>
          <div className="guide-grid">
            <article className="card">
              <div className="card-icon">
                <Laptop size={26} />
              </div>
              <h3>Person A · create a code</h3>
              <ol>
                <li>Install Butter Chicken and run <code>butter-chicken</code>.</li>
                <li>Open <code>http://localhost:3000</code> and create your identity.</li>
                <li>Choose <strong>Pair</strong>, then <strong>Create a code</strong>.</li>
                <li>Share the 6-digit code privately. It expires in 10 minutes.</li>
              </ol>
            </article>
            <article className="card">
              <div className="card-icon">
                <Wifi size={26} />
              </div>
              <h3>Person B · enter the code</h3>
              <ol>
                <li>Install and run Butter Chicken on your own computer.</li>
                <li>Open <code>http://localhost:3000</code> and create your identity.</li>
                <li>Choose <strong>Pair</strong>, enter the 6 digits, then <strong>Connect</strong>.</li>
                <li>Both of you compare every group of the security code and confirm.</li>
              </ol>
            </article>
          </div>
          <div className="card guide-note">
            <h3>Keep the app open to stay connected.</h3>
            <p>
              Your connection runs through the relay, so friends on different networks can chat. Keep the browser tab and the terminal open. After 10 minutes without activity the screen asks for your passphrase, but the connection stays on.
            </p>
            <InternalLink href="/help/faq" navigate={navigate}>
              Connection or reset questions? <ArrowRight size={14} />
            </InternalLink>
          </div>
        </>
      ) : path === "/help/use-cases" ? (
        <>
          <p className="example-label">
            Illustrative examples, not customer testimonials or measured case studies.
          </p>
          <div className="guide-grid">
            <article className="card">
              <div className="card-icon">
                <Heart size={26} />
              </div>
              <h3>Friends in different cities</h3>
              <p>
                Alex and Sam each run the app at home. They pair once with a 6-digit code and a security-code check. After that, messages reach each other from any network.
              </p>
            </article>
            <article className="card">
              <div className="card-icon">
                <MessageCircle size={26} />
              </div>
              <h3>Messages while someone is away</h3>
              <p>
                If one of them is offline, messages wait encrypted on the sender's computer and are delivered when the other person reconnects.
              </p>
            </article>
          </div>
          <div className="guide-note">
            <InternalLink href="/help/two-computers" navigate={navigate}>
              Try it with your friend <ArrowRight size={14} />
            </InternalLink>
          </div>
        </>
      ) : path === "/help/security" ? (
        <div className="card reading-card">
          <h3>Your browser encrypts first</h3>
          <p>
            Libsodium provides X25519 public-key boxes with XSalsa20-Poly1305
            authentication and Ed25519 signatures. The Node transport forwards
            encrypted payloads and stores encrypted records. It has no message
            decryption keys in normal operation.
          </p>
          <h3>A passphrase locks local keys</h3>
          <p>
            Argon2id derives a vault key with 64 MiB of memory and two passes.
            XChaCha20-Poly1305 encrypts the vault and conversation records.
            Public IDs, connection addresses, traffic timing and lengths remain
            visible.
          </p>
          <h3>Your verification establishes trust</h3>
          <p>
            A 6-digit code expires after ten minutes and works once. Both people compare
            a shared code before trust is saved. Later connections prove
            possession of the pinned keys; an unexpected identity change
            produces a warning.
          </p>
          <h3>Be clear about the limits</h3>
          <p>
            This application has not been independently audited. Its application
            protocol is new, even though its cryptographic primitives come from
            an established library. It has no forward secrecy or message
            ratchet. Malware, an unlocked endpoint, a compromised OS or a
            modified local app can expose messages.
          </p>
          <p>
            Read <code>SECURITY.md</code> in the project for the full threat
            model.
          </p>
          <InternalLink href="/security" navigate={navigate}>
            Inspect this device’s saved trust <ArrowRight size={14} />
          </InternalLink>
        </div>
      ) : (
        <>
          <div className="guide-grid guide-links">
            <InternalLink
              className="card"
              href="/help/two-computers"
              navigate={navigate}
            >
              <Laptop size={25} />
              <h3>Pair with a code</h3>
              <p>Create a code, enter it, and compare the security code.</p>
              <span>
                Read the guide <ArrowRight size={14} />
              </span>
            </InternalLink>
            <InternalLink className="card" href="/help/faq" navigate={navigate}>
              <HelpCircle size={25} />
              <h3>Five common questions</h3>
              <p>Offline messages, the 10-minute lock and resets.</p>
              <span>
                Find your answer <ArrowRight size={14} />
              </span>
            </InternalLink>
            <InternalLink
              className="card"
              href="/help/security"
              navigate={navigate}
            >
              <ShieldCheck size={25} />
              <h3>Encryption and limits</h3>
              <p>Understand the protection you’re using.</p>
              <span>
                Read the security guide <ArrowRight size={14} />
              </span>
            </InternalLink>
            <InternalLink
              className="card"
              href="/help/use-cases"
              navigate={navigate}
            >
              <Heart size={25} />
              <h3>Example use cases</h3>
              <p>How a conversation fits everyday life.</p>
              <span>
                Explore the examples <ArrowRight size={14} />
              </span>
            </InternalLink>
          </div>
          <div className="card guide-note">
            <h3>Know when a message arrived.</h3>
            <p>
              A delivery check means your friend’s device saved the message.
              Pending messages retry every five seconds while securely
              connected. Connection attempts have a five-second transport
              timeout; an unfinished authentication is abandoned after roughly
              15–20 seconds.
            </p>
            <p>
              Delivery time and human replies depend on the network and your
              friend. This local app has no staffed support service or
              guaranteed response-time SLA.
            </p>
          </div>
        </>
      )}
      <footer className="guide-footer">
        <InternalLink href="/help/demo" navigate={navigate}>
          Product demo
        </InternalLink>
        <InternalLink href="/terms" navigate={navigate}>
          Terms
        </InternalLink>
        <InternalLink href="/privacy" navigate={navigate}>
          Privacy
        </InternalLink>
        <InternalLink href="/help" navigate={navigate}>
          Help
        </InternalLink>
        <InternalLink href="/help/faq" navigate={navigate}>
          FAQs
        </InternalLink>
        <InternalLink href="/help/use-cases" navigate={navigate}>
          Example use cases
        </InternalLink>
        <InternalLink href="/help/security" navigate={navigate}>
          Encryption and limits
        </InternalLink>
      </footer>
      <InternalLink
        className="button primary mobile-cta"
        href="/"
        navigate={navigate}
      >
        Open Butter Chicken <ArrowRight size={17} />
      </InternalLink>
    </section>
  );
}
