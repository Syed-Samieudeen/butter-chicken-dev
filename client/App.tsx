import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import {
  MessageCircle,
  UserPlus,
  ShieldCheck,
  Settings,
  Wifi,
  LockKeyhole,
  Sun,
  Moon,
  LogOut,
  Send,
  Check,
  CheckCheck,
  Clock3,
  Copy,
  ScanLine,
  ImagePlus,
  X,
  Eye,
  EyeOff,
  Trash2,
  RefreshCw,
  AlertTriangle,
  Heart,
  KeyRound,
  Laptop,
  LoaderCircle,
} from "./icons";
import { ClientApi } from "./api";
import { ChatEngine, type Snapshot } from "./engine";
import { fingerprint, securityCode } from "./crypto";
import {
  Breadcrumbs,
  InfoPage,
  InternalLink,
  useLocalRoutes,
  type Navigate,
} from "./pages";
import { pageMetadata } from "../shared/pages";
import LoadingSkeleton from "./LoadingSkeleton";

const engine = new ChatEngine(new ClientApi());
const initials = (name?: string) =>
  name
    ? name
        .trim()
        .split(/\s+/)
        .map((x) => x[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "BC";
const time = (value: string) =>
  new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
const date = (value?: string) =>
  value
    ? new Date(value).toLocaleDateString([], {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Not yet";
const readPreference = (key: string, fallback: string) => {
  try {
    return localStorage.getItem(`bc:v1:${key}`) ?? fallback;
  } catch {
    return fallback;
  }
};
const preference = (key: string, value: string) => {
  try {
    localStorage.setItem(`bc:v1:${key}`, value);
  } catch {}
};
type View = "chat" | "pair" | "security" | "settings";
type ConfirmKind = "history" | "unpair" | "reset";
const stateLabels: Record<string, string> = {
  CONNECTED: "Connected securely",
  CONNECTING: "Connecting…",
  AUTHENTICATING: "Verifying connection…",
  DISCOVERING: "Looking for your friend",
  DISCONNECTED: "Friend offline",
  PAIRING_REQUIRED: "Ready to pair",
  IDENTITY_CHANGED: "Identity changed",
};
function Avatar({ name, large = false }: { name?: string; large?: boolean }) {
  return (
    <span className={`avatar${large ? " large" : ""}`} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
function Code({ value }: { value: string }) {
  return (
    <div className="security-code" aria-label="Security code">
      {value.split(" ").map((part, i) => (
        <span key={i}>{part}</span>
      ))}
    </div>
  );
}
function ActionError({ message }: { message?: string }) {
  return message ? (
    <p className="form-error" role="alert">
      <AlertTriangle size={17} />
      {message}
    </p>
  ) : null;
}

export default function App() {
  const s = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const { path, navigate } = useLocalRoutes();
  const view: View =
    path === "/pair"
      ? "pair"
      : path === "/security"
        ? "security"
        : path === "/settings"
          ? "settings"
          : "chat";
  const setView = (next: View) => navigate(next === "chat" ? "/" : "/" + next);
  const infoPage =
    path.startsWith("/help") ||
    ["/thank-you", "/terms", "/privacy"].includes(path) ||
    !pageMetadata[path];
  const pairingStarted = useRef(false);
  const [theme, setTheme] = useState(() =>
    readPreference("theme", "dark") === "light" ? "light" : "dark",
  );
  const [autoLock, setAutoLock] = useState(() => {
    const n = Number(readPreference("lock-minutes", "15"));
    return [5, 15, 30].includes(n) ? n : 15;
  });
  const [fatal, setFatal] = useState("");
  const [confirm, setConfirm] = useState<ConfirmKind>();
  const [toast, setToast] = useState("");
  useEffect(() => {
    engine
      .init()
      .catch(() =>
        setFatal(
          "The local service is unavailable. Start Butter Chicken, then reload this page.",
        ),
      );
    return () => engine.dispose();
  }, []);
  useEffect(() => {
    preference("theme", theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    if (s.pending) pairingStarted.current = true;
    if (s.mode !== "ready") pairingStarted.current = false;
    if (s.mode === "ready" && s.friend && pairingStarted.current) {
      pairingStarted.current = false;
      navigate("/thank-you");
    } else if (s.mode === "ready" && !s.friend && path === "/")
      navigate("/pair");
  }, [s.mode, s.friend?.public.id, s.pending, navigate]);
  useEffect(() => {
    preference("lock-minutes", String(autoLock));
    if (s.mode !== "ready") return;
    let lastActivity = Date.now();
    const touch = () => {
      lastActivity = Date.now();
    };
    window.addEventListener("pointerdown", touch, { passive: true });
    window.addEventListener("keydown", touch);
    const timer = setInterval(() => {
      if (Date.now() - lastActivity > autoLock * 60_000) engine.lock();
    }, 10_000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("keydown", touch);
    };
  }, [autoLock, s.mode]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  const navigation: {
    view: View;
    label: string;
    icon: typeof MessageCircle;
  }[] = [
    { view: "chat", label: "Chat", icon: MessageCircle },
    { view: "pair", label: "Pair devices", icon: UserPlus },
    { view: "security", label: "Security", icon: ShieldCheck },
    { view: "settings", label: "Settings", icon: Settings },
  ];
  return (
    <div className="app-shell">
      <nav className="rail" aria-label="Main navigation">
        <div className="rail-logo" aria-label="Butter Chicken">
          <span className="brand-stamp">bc</span>
        </div>
        <div className="rail-nav">
          {navigation.map(({ view: v, label, icon: Icon }) => (
            <button
              key={v}
              className={`nav-button ${view === v ? "active" : ""}`}
              title={label}
              aria-label={label}
              aria-current={view === v ? "page" : undefined}
              onClick={() => setView(v)}
            >
              <Icon size={22} />
            </button>
          ))}
        </div>
        <div className="rail-bottom">
          <button
            className="nav-button"
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            title="Change theme"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun size={21} /> : <Moon size={21} />}
          </button>
          {s.mode === "ready" ? (
            <button
              className="nav-button"
              aria-label="Lock this device"
              title="Lock this device"
              onClick={() => engine.lock()}
            >
              <LogOut size={21} />
            </button>
          ) : null}
          <Avatar name={s.self?.displayName} />
        </div>
      </nav>
      <aside className="sidebar">
        <div className="wordmark">
          Butter
          <br />
          Chicken<span className="wordmark-dot">.</span>
          <span className="edition">LOCAL, TWO-PERSON CHAT</span>
        </div>
        <div className="sidebar-label">
          <span>YOUR CONVERSATION</span>
          <LockKeyhole size={14} />
        </div>
        {s.friend ? (
          <button
            className={`friend-row ${view === "chat" ? "selected" : ""}`}
            onClick={() => setView("chat")}
          >
            <Avatar name={s.friend.displayName} />
            <span>
              <strong>{s.friend.displayName}</strong>
              <small>
                {s.state === "CONNECTED"
                  ? "Your private conversation"
                  : "Last seen " + date(s.friend.lastSeen)}
              </small>
            </span>
            <span
              className={`presence ${s.state === "CONNECTED" ? "online" : ""}`}
            />
          </button>
        ) : (
          <button
            className="friend-row add-friend"
            onClick={() => setView("pair")}
          >
            <span className="add-avatar">
              <UserPlus size={22} />
            </span>
            <span>
              <strong>Pair your person</strong>
              <small>One friend. One trusted device.</small>
            </span>
          </button>
        )}
        <div className="sidebar-note">
          <ShieldCheck size={18} />
          <p>
            Trust belongs to a device’s identity.
            <br />
            It stays when the Wi-Fi changes.
          </p>
        </div>
        <div className="sidebar-help">
          <InternalLink href="/help" navigate={navigate}>
            Help &amp; setup
          </InternalLink>
          <InternalLink href="/privacy" navigate={navigate}>
            Privacy
          </InternalLink>
          <InternalLink href="/terms" navigate={navigate}>
            Terms
          </InternalLink>
        </div>
        <div className="sidebar-bottom">
          <div className="network-card">
            <div className="network-title">
              <Wifi size={18} />
              <strong>Your local network</strong>
            </div>
            <p className="network-address">
              {s.network
                ? `${s.network.endpoint.host}:${s.network.endpoint.port}`
                : "Starting local service…"}
            </p>
            <div className="network-line">
              <span className={`presence ${s.network ? "online" : ""}`} />
              <span>
                {s.network?.endpoint.host.startsWith("127.")
                  ? "This computer only"
                  : s.network
                    ? "LAN service ready"
                    : "Not connected"}
              </span>
            </div>
            <hr />
            <span className="network-foot">
              Internet:{" "}
              {s.network?.relayUrl
                ? s.relayConnected
                  ? "relay connected"
                  : "relay offline"
                : "relay not configured"}
              <br />
              Path: {s.path ?? (s.state === "CONNECTED" ? "LOCAL" : "OFFLINE")}
            </span>
          </div>
          <div className="self-row">
            <Avatar name={s.self?.displayName} />
            <span>
              <strong>{s.self?.displayName ?? "This device"}</strong>
              <small>
                {s.mode === "ready"
                  ? "Identity unlocked"
                  : s.mode === "new"
                    ? "Create your identity"
                    : "Vault locked"}
              </small>
            </span>
            <LockKeyhole size={16} />
          </div>
        </div>
      </aside>
      <main className="main-panel">
        <header className="main-header">
          <div className="room-heading">
            {s.friend ? (
              <Avatar name={s.friend.displayName} />
            ) : (
              <span className="room-icon">
                <MessageCircle size={23} />
              </span>
            )}
            <div>
              <h1>{s.friend?.displayName ?? "Just you two"}</h1>
              <span>
                {s.friend
                  ? `${s.path ?? "OFFLINE"} · Your trusted conversation`
                  : "A private space for your friend"}
              </span>
            </div>
          </div>
          <button
            className={`security-status ${s.state === "CONNECTED" ? "secure" : s.state === "IDENTITY_CHANGED" ? "danger" : ""}`}
            onClick={() => setView("security")}
            disabled={s.mode !== "ready"}
          >
            <ShieldCheck size={17} />
            <span>
              {s.mode === "ready"
                ? stateLabels[s.state]
                : "Encrypted local vault"}
            </span>
          </button>
        </header>
        <Breadcrumbs path={path} navigate={navigate} />
        {s.warning ? (
          <div className="security-warning" role="alert">
            <AlertTriangle size={22} />
            <div>
              <strong>Security warning · identity changed</strong>
              <p>{s.warning}</p>
              <div className="inline-actions">
                <button
                  onClick={() => {
                    engine.disconnect();
                    setView("security");
                  }}
                >
                  Disconnect &amp; inspect identity
                </button>
                <button onClick={() => setConfirm("unpair")}>
                  Reset pairing
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {s.notice ? (
          <div className="notice" role="status">
            <ShieldCheck size={17} />
            <span>{s.notice}</span>
            <button
              className="icon-button"
              aria-label="Dismiss notice"
              onClick={() => engine.dismissNotice()}
            >
              <X size={16} />
            </button>
          </div>
        ) : null}
        {infoPage ? (
          <InfoPage
            path={path}
            navigate={navigate}
            friendName={s.friend?.displayName}
          />
        ) : fatal ? (
          <div className="fatal-state">
            <AlertTriangle size={36} />
            <h2>Start your local service</h2>
            <p>{fatal}</p>
            <button
              className="button primary"
              onClick={() => location.reload()}
            >
              Reload
            </button>
          </div>
        ) : s.mode === "loading" ? (
          <LoadingSkeleton />
        ) : s.mode !== "ready" ? (
          <AuthGate
            mode={s.mode}
            reset={() => setConfirm("reset")}
            navigate={navigate}
          />
        ) : view === "chat" ? (
          <ChatView
            s={s}
            pair={() => setView("pair")}
            security={() => setView("security")}
          />
        ) : view === "pair" ? (
          <PairView
            s={s}
            toast={setToast}
            security={() => setView("security")}
            chat={() => setView("chat")}
          />
        ) : view === "security" ? (
          <SecurityView
            s={s}
            remove={() => setConfirm("unpair")}
            pair={() => setView("pair")}
          />
        ) : (
          <SettingsView
            s={s}
            theme={theme}
            setTheme={setTheme}
            autoLock={autoLock}
            setAutoLock={setAutoLock}
            confirm={setConfirm}
            navigate={navigate}
          />
        )}
      </main>
      {toast ? (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
        </div>
      ) : null}
      {confirm ? (
        <ConfirmDialog kind={confirm} close={() => setConfirm(undefined)} />
      ) : null}
    </div>
  );
}

function AuthGate({
  mode,
  reset,
  navigate,
}: {
  mode: "new" | "locked";
  reset: () => void;
  navigate: Navigate;
}) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (mode === "new" && password !== repeat)
      return setError("The passphrases don’t match.");
    setBusy(true);
    try {
      if (mode === "new") await engine.create(name, password);
      else await engine.unlock(password);
      setPassword("");
      setRepeat("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open your identity");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="auth-page">
      <div className="auth-intro">
        <div className="eyebrow">
          <span />
          WELCOME TO BUTTER CHICKEN
        </div>
        <h2>
          A little space.
          <br />
          <em>Just for you two.</em>
        </h2>
        <p>
          Pair once. Recognize each other by identity.
          <br />
          Chat together over Wi-Fi or the internet.
        </p>
        <div className="hero-actions">
          <InternalLink
            className="button primary"
            href="#identity-form"
            navigate={navigate}
          >
            {mode === "new" ? "Create your identity" : "Unlock this device"}
          </InternalLink>
          <InternalLink
            className="text-button"
            href="/help"
            navigate={navigate}
          >
            Read the setup guide
          </InternalLink>
        </div>
        <div className="intro-features">
          <span>
            <Wifi size={18} />
            LAN or internet
          </span>
          <span>
            <ShieldCheck size={18} />
            Encrypted before it leaves
          </span>
          <span>
            <Heart size={18} />
            No accounts. Just your person.
          </span>
        </div>
        <div className="intro-bottom">
          <LockKeyhole size={15} />
          <span>Your conversation stays on your devices.</span>
        </div>
      </div>
      <form id="identity-form" className="auth-card card" onSubmit={submit}>
        <div className="card-icon">
          <KeyRound size={25} />
        </div>
        <h3>{mode === "new" ? "Make this space yours" : "Welcome back"}</h3>
        <p>
          {mode === "new"
            ? "Create your identity on this device. A passphrase locks your keys and conversation."
            : "Unlock your identity and local conversation. Your passphrase stays in this browser."}
        </p>
        {mode === "new" ? (
          <label>
            Your name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="What should your friend call you?"
              maxLength={40}
              autoComplete="nickname"
              required
            />
          </label>
        ) : null}
        <label>
          Vault passphrase
          <div className="password-field">
            <input
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={
                mode === "new"
                  ? "A few unrelated words"
                  : "Enter your passphrase"
              }
              minLength={mode === "new" ? 12 : undefined}
              maxLength={512}
              autoComplete={
                mode === "new" ? "new-password" : "current-password"
              }
              required
            />
            <button
              className="icon-button"
              type="button"
              aria-label={show ? "Hide passphrase" : "Show passphrase"}
              onClick={() => setShow(!show)}
            >
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </label>
        {mode === "new" ? (
          <>
            <small className="field-hint">
              At least 12 characters. Keep it somewhere safe.
            </small>
            <label>
              Confirm passphrase
              <input
                type={show ? "text" : "password"}
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
                placeholder="Enter it once more"
                maxLength={512}
                autoComplete="new-password"
                required
              />
            </label>
          </>
        ) : null}
        <ActionError message={error} />
        <button type="submit" className="button primary full" disabled={busy}>
          {busy ? (
            <LoaderCircle className="spin" size={18} />
          ) : (
            <LockKeyhole size={18} />
          )}
          {busy
            ? "Opening your vault…"
            : mode === "new"
              ? "Create identity"
              : "Unlock your space"}
        </button>
        <div className="auth-foot">
          {mode === "new" ? (
            <>
              <ShieldCheck size={15} />
              <span>No cloud signup. No message server account.</span>
            </>
          ) : (
            <button type="button" className="text-button" onClick={reset}>
              Lost your passphrase? Reset this device
            </button>
          )}
        </div>
        <div className="policy-links">
          <InternalLink href="/terms" navigate={navigate}>
            Terms of use
          </InternalLink>
          <InternalLink href="/privacy" navigate={navigate}>
            Privacy policy
          </InternalLink>
        </div>
      </form>
      <InternalLink
        className="button primary mobile-cta"
        href="#identity-form"
        navigate={navigate}
      >
        {mode === "new" ? "Create your identity" : "Unlock this device"}
      </InternalLink>
    </section>
  );
}

function ChatView({
  s,
  pair,
  security,
}: {
  s: Snapshot;
  pair: () => void;
  security: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (document.visibilityState === "visible" && document.hasFocus())
      engine.markRead();
  }, [engine, s.messages.length, s.relayConnected, s.state]);
  useEffect(() => {
    const read = () => {
      if (document.visibilityState === "visible" && document.hasFocus())
        engine.markRead();
    };
    window.addEventListener("focus", read);
    document.addEventListener("visibilitychange", read);
    return () => {
      window.removeEventListener("focus", read);
      document.removeEventListener("visibilitychange", read);
    };
  }, [engine]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [s.messages.length]);
  const send = async () => {
    if (sending || !draft.trim()) return;
    setSending(true);
    setError("");
    try {
      await engine.sendMessage(draft);
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to send");
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="chat-view">
      <div className="conversation-banner">
        <LockKeyhole size={14} />
        <span>
          {s.friend
            ? "Paired devices. Encrypted messages. Your own Wi-Fi."
            : "Your conversation begins with a verified pairing."}
        </span>
        {s.friend ? (
          <button className="text-button" onClick={security}>
            View security
          </button>
        ) : null}
      </div>
      <div
        className="message-list"
        role="log"
        aria-label="Conversation"
        aria-live="polite"
      >
        {s.messages.length ? (
          s.messages.map((m, i) => (
            <div key={m.id}>
              {i === 0 ||
              date(m.receivedAt ?? m.sentAt) !==
                date(
                  s.messages[i - 1].receivedAt ?? s.messages[i - 1].sentAt,
                ) ? (
                <div className="date-divider">
                  <span>{date(m.receivedAt ?? m.sentAt)}</span>
                </div>
              ) : null}
              <div
                className={`message-row ${m.from === "me" ? "mine" : "theirs"}`}
              >
                {m.from === "friend" ? (
                  <Avatar name={s.friend?.displayName} />
                ) : null}
                <div className="message-bubble">
                  <span className="sr-only">
                    {m.from === "me" ? "You" : s.friend?.displayName}:{" "}
                  </span>
                  <p>{m.text}</p>
                  <div className="message-meta">
                    <time
                      dateTime={m.receivedAt ?? m.sentAt}
                      title={
                        m.from === "friend"
                          ? `Received locally. Sender’s reported time: ${m.sentAt}`
                          : m.sentAt
                      }
                    >
                      {time(m.receivedAt ?? m.sentAt)}
                    </time>
                    {m.from === "me" ? (
                      <span
                        aria-label={
                          m.state === "READ"
                            ? "Read in active conversation"
                            : m.delivered
                              ? "Delivered to device"
                              : "Waiting for delivery"
                        }
                        title={
                          m.delivered
                            ? "Saved on your friend’s device"
                            : "Waiting for acknowledgement"
                        }
                      >
                        {m.state ?? (m.delivered ? "DELIVERED" : "QUEUED")}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="chat-empty">
            <div className="empty-icon">
              <MessageCircle size={38} />
            </div>
            <h2>
              {s.friend
                ? "Your first hello starts here"
                : "A conversation for two"}
            </h2>
            <p>
              {s.friend
                ? `You’re paired with ${s.friend.displayName}. Open and unlock Butter Chicken on both devices to start chatting.`
                : "Add your person with a one-time invitation. You’ll both verify the connection before a message can be sent."}
            </p>
            {!s.friend ? (
              <button className="button primary" onClick={pair}>
                <UserPlus size={18} />
                Pair with your friend
              </button>
            ) : s.state !== "CONNECTED" ? (
              <button
                className="button secondary"
                onClick={() => engine.reconnect()}
              >
                <RefreshCw size={17} />
                Reconnect
              </button>
            ) : null}
          </div>
        )}
        <div ref={bottom} />
      </div>
      <div className="composer-area">
        <ActionError message={error} />
        <div className="composer">
          <textarea
            aria-label="Message"
            placeholder={
              s.state === "CONNECTED"
                ? "Write a message…"
                : s.friend
                  ? s.network?.relayUrl
                    ? "Write a message. Offline messages queue locally."
                    : `Waiting for ${s.friend.displayName} to connect…`
                  : "Pair your devices to start chatting"
            }
            value={draft}
            maxLength={8000}
            disabled={!s.friend}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
          />
          <button
            className="send-button"
            aria-label="Send message"
            onClick={() => void send()}
            disabled={
              !s.friend ||
              (!s.network?.relayUrl && s.state !== "CONNECTED") ||
              !draft.trim() ||
              sending
            }
          >
            <Send size={20} />
          </button>
        </div>
        <div className="composer-foot">
          <span>
            <LockKeyhole size={12} />
            Encrypted on this device
          </span>
          <span>
            {draft ? "COMPOSING · " : ""}Enter to send · Shift + Enter for a new
            line
          </span>
        </div>
      </div>
    </div>
  );
}

function PairView({
  s,
  toast,
  chat,
  security,
}: {
  s: Snapshot;
  toast: (value: string) => void;
  chat: () => void;
  security: () => void;
}) {
  const [code, setCode] = useState("");
  const [qr, setQr] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("4455");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  const [camera, setCamera] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setChecked(false);
  }, [s.pending?.identity.id]);
  useEffect(() => {
    let disposed = false;
    setQr("");
    if (s.invitation)
      import("qrcode")
        .then(({ default: QRCode }) =>
          QRCode.toDataURL(s.invitation!.code, {
            scale: 8,
            margin: 4,
            errorCorrectionLevel: "M",
            color: { dark: "#242725", light: "#f3f1ed" },
          }),
        )
        .then((value) => {
          if (!disposed) setQr(value);
        })
        .catch(() =>
          setError("QR rendering unavailable. Use the text invitation."),
        );
    return () => {
      disposed = true;
    };
  }, [s.invitation?.code]);
  const action = async (fn: () => Promise<void>) => {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Pairing failed");
    } finally {
      setBusy(false);
    }
  };
  const scanImage = async (file?: File) => {
    if (!file) return;
    if (file.size > 5_000_000) return setError("Choose an image under 5 MB.");
    const url = URL.createObjectURL(file);
    setBusy(true);
    setError("");
    try {
      const [{ BrowserQRCodeReader }, { DecodeHintType }] = await Promise.all([
        import("@zxing/browser"),
        import("@zxing/library"),
      ]);
      const hints = new Map([[DecodeHintType.TRY_HARDER, true]]);
      // Photos need detection; clean exported images can use the standard pure-barcode reader.
      const result = await new BrowserQRCodeReader(hints)
        .decodeFromImageUrl(url)
        .catch(() =>
          new BrowserQRCodeReader(
            new Map([...hints, [DecodeHintType.PURE_BARCODE, true]]),
          ).decodeFromImageUrl(url),
        );
      setCode(result.getText());
      toast("Invitation scanned. Connect, then compare the security code.");
    } catch {
      setError(
        "No readable QR found. Try a clearer image or paste the invitation.",
      );
    } finally {
      URL.revokeObjectURL(url);
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  return (
    <section className="page-scroll">
      <div className="page-heading">
        <span className="eyebrow">MAKE IT YOURS</span>
        <h2>Pair with your friend</h2>
        <p>One invitation. A code you both check. A connection you keep.</p>
      </div>
      {s.friend ? (
        <div className="card paired-card">
          <div className="card-icon green">
            <ShieldCheck size={28} />
          </div>
          <h3>You’re paired with {s.friend.displayName}</h3>
          <p>
            This identity is saved on your device. To pair a different device,
            remove the current trust in Security first.
          </p>
          <div className="inline-actions">
            <button className="button primary" onClick={chat}>
              Open conversation
            </button>
            <button className="button secondary" onClick={security}>
              View security
            </button>
          </div>
        </div>
      ) : s.pending ? (
        <div className="card verification-card">
          <div className="card-icon">
            <ShieldCheck size={28} />
          </div>
          <span className="eyebrow">CHECK BEFORE YOU TRUST</span>
          <h3>Is this really {s.pending.displayName}?</h3>
          <p>
            Compare every group below with your friend, in person or on a call
            you already trust. Both screens must show the same code.
          </p>
          <Code value={s.pending.code} />
          <div className="verify-progress">
            <span>
              <Check size={16} />
              Connection encrypted
            </span>
            <span className={s.pending.remoteVerified ? "done" : ""}>
              {s.pending.remoteVerified ? (
                <Check size={16} />
              ) : (
                <Clock3 size={16} />
              )}
              {s.pending.remoteVerified
                ? "Friend verified"
                : "Friend hasn’t verified yet"}
            </span>
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              disabled={s.pending.localVerified}
            />
            I compared this code with my friend and it matches.
          </label>
          <ActionError message={error} />
          <button
            className="button primary full"
            disabled={!checked || busy || s.pending.localVerified}
            onClick={() => void action(() => engine.verifyPairing())}
          >
            {s.pending.localVerified ? (
              <>
                <Clock3 size={18} />
                Waiting for your friend to verify
              </>
            ) : (
              <>
                <ShieldCheck size={18} />I verified the code
              </>
            )}
          </button>
          <button
            className="text-button cancel-pair"
            onClick={() => engine.cancelPairing()}
          >
            Codes differ? Cancel pairing
          </button>
        </div>
      ) : (
        <>
          <div className="pair-grid">
            <div className="card invite-card">
              <div className="step-label">
                <span>01</span>ON THIS DEVICE
              </div>
              <h3>Invite your person</h3>
              <p>
                Share this invitation only with your friend. It expires after 10
                minutes and can be used once.
              </p>
              {s.invitation ? (
                <>
                  <div className="qr-box">
                    {qr ? (
                      <img
                        src={qr}
                        width="240"
                        height="240"
                        alt="One-time pairing invitation QR code"
                      />
                    ) : (
                      <div
                        className="skeleton qr-skeleton"
                        aria-label="Generating invitation QR"
                      />
                    )}
                  </div>
                  <div className="invitation-line">
                    <span>
                      <Clock3 size={14} />
                      Expires{" "}
                      {time(new Date(s.invitation.expires).toISOString())}
                    </span>
                    <button
                      className="text-button"
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(s.invitation!.code)
                          .then(() =>
                            toast(
                              "Invitation copied. Share it privately with your friend.",
                            ),
                          )
                          .catch(() =>
                            setError(
                              "Select the invitation below and copy it manually.",
                            ),
                          )
                      }
                    >
                      <Copy size={15} />
                      Copy invitation
                    </button>
                  </div>
                  <textarea
                    className="invitation-code"
                    aria-label="Your invitation"
                    value={s.invitation.code}
                    readOnly
                    rows={3}
                    spellCheck={false}
                  />
                  <div className="waiting">
                    <span className="waiting-dot" />
                    Waiting for your friend…
                  </div>
                  <button
                    className="text-button"
                    onClick={() => engine.cancelPairing()}
                  >
                    Cancel invitation
                  </button>
                </>
              ) : (
                <div className="invite-empty">
                  <div className="qr-placeholder">
                    <ScanLine size={51} />
                  </div>
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => void action(() => engine.invite())}
                  >
                    <UserPlus size={18} />
                    Create invitation
                  </button>
                  <small>Your identity: {s.self!.displayName}</small>
                </div>
              )}
            </div>
            <form
              className="card join-card"
              onSubmit={(e) => {
                e.preventDefault();
                void action(() =>
                  engine.join(
                    code,
                    host.trim()
                      ? { host: host.trim(), port: Number(port) }
                      : undefined,
                  ),
                );
              }}
            >
              <div className="step-label">
                <span>02</span>ON YOUR FRIEND’S DEVICE
              </div>
              <h3>Have an invitation?</h3>
              <p>
                Paste your friend’s invitation, or scan their QR code. You’ll
                verify a security code together next.
              </p>
              <label>
                Friend’s invitation
                <textarea
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Paste the complete BC1… invitation"
                  rows={4}
                  spellCheck={false}
                  maxLength={3000}
                  required
                />
              </label>
              <div className="scan-actions">
                <button
                  className="button secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => setCamera(true)}
                >
                  <ScanLine size={17} />
                  Scan QR
                </button>
                <button
                  className="button secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => fileInput.current?.click()}
                >
                  <ImagePlus size={17} />
                  Use QR image
                </button>
                <input
                  className="sr-only"
                  type="file"
                  ref={fileInput}
                  accept="image/png,image/jpeg,image/webp"
                  aria-label="QR code image"
                  onChange={(e) => void scanImage(e.target.files?.[0])}
                />
              </div>
              <details className="manual-details">
                <summary>Use a different LAN address</summary>
                <p>
                  Use this if your friend’s IP changed after they created the
                  invitation.
                </p>
                <div className="endpoint-inputs">
                  <label>
                    Friend’s IPv4
                    <input
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                      placeholder="192.168.1.25"
                      spellCheck={false}
                    />
                  </label>
                  <label>
                    LAN port
                    <input
                      value={port}
                      type="number"
                      min={1}
                      max={65535}
                      onChange={(e) => setPort(e.target.value)}
                    />
                  </label>
                </div>
              </details>
              <ActionError message={error} />
              <button
                className="button primary full"
                type="submit"
                disabled={!code.trim() || busy}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={18} />
                ) : (
                  <ShieldCheck size={18} />
                )}
                Connect to friend
              </button>
              <div className="small-note">
                <LockKeyhole size={14} />
                An invitation connects you. Verification establishes trust.
              </div>
            </form>
          </div>
          <div className="nearby-panel">
            <div>
              <Wifi size={20} />
              <h3>Nearby devices</h3>
              <span className="badge">
                {s.network?.discoveryEnabled ? "LAN DISCOVERY" : "MANUAL MODE"}
              </span>
            </div>
            {s.devices.length ? (
              <ul>
                {s.devices.map((device) => (
                  <li key={device.nodeId}>
                    <Laptop size={21} />
                    <span>
                      <strong>{device.label}</strong>
                      <small>
                        {device.host}:{device.port} · unverified
                      </small>
                    </span>
                    <button
                      className="button secondary"
                      onClick={() => {
                        setHost(device.host);
                        setPort(String(device.port));
                        toast(
                          "Address selected. You still need this device’s invitation.",
                        );
                      }}
                    >
                      Use address
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                {s.network?.discoveryEnabled
                  ? "Searching your Wi-Fi. You can still pair using an invitation and a manual address."
                  : "Automatic discovery is off on this interface. Pair using the invitation’s LAN address."}
              </p>
            )}
          </div>
        </>
      )}
      {camera ? (
        <CameraScanner
          close={() => setCamera(false)}
          onCode={(value) => {
            setCode(value);
            setCamera(false);
            toast("QR scanned. Connect, then compare the security code.");
          }}
        />
      ) : null}
    </section>
  );
}

function CameraScanner({
  close,
  onCode,
}: {
  close: () => void;
  onCode: (code: string) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
    let stopped = false;
    let stop: (() => void) | undefined;
    import("@zxing/browser")
      .then(({ BrowserQRCodeReader }) =>
        new BrowserQRCodeReader().decodeFromVideoDevice(
          undefined,
          ref.current!,
          (result, _error, controls) => {
            if (result && !stopped) {
              stopped = true;
              controls.stop();
              onCode(result.getText());
            }
          },
        ),
      )
      .then((controls) => {
        if (stopped) controls.stop();
        else stop = () => controls.stop();
      })
      .catch(() =>
        setError(
          "Camera unavailable or permission denied. Use a QR image or paste the invitation.",
        ),
      );
    return () => {
      stopped = true;
      stop?.();
      dialog.current?.close();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="card camera-dialog"
      onCancel={close}
      aria-label="Scan pairing QR"
    >
      <div className="panel-title">
        <h3>Scan your friend’s QR</h3>
        <button
          className="icon-button"
          aria-label="Close scanner"
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      <video ref={ref} muted playsInline />
      <ActionError message={error} />
      <p>Keep the QR code inside the camera view.</p>
      <button className="button secondary full" onClick={close}>
        Cancel scan
      </button>
    </dialog>
  );
}

function SecurityView({
  s,
  remove,
  pair,
}: {
  s: Snapshot;
  remove: () => void;
  pair: () => void;
}) {
  return (
    <section className="page-scroll">
      <div className="page-heading">
        <span className="eyebrow">KNOW WHO’S ON THE OTHER SIDE</span>
        <h2>Your connection, verified</h2>
        <p>
          A saved identity recognizes your friend, even when their IP address
          changes.
        </p>
      </div>
      {s.friend ? (
        <div className="security-grid">
          <div className="card trust-card">
            <div className="profile-heading">
              <Avatar name={s.friend.displayName} large />
              <div>
                <h3>{s.friend.displayName}</h3>
                <span className="verified-badge">
                  <ShieldCheck size={16} />
                  Verified by both devices
                </span>
              </div>
            </div>
            <dl className="info-list">
              <div>
                <dt>Connection</dt>
                <dd>{stateLabels[s.state]}</dd>
              </div>
              <div>
                <dt>Trusted since</dt>
                <dd>{date(s.friend.trustedSince)}</dd>
              </div>
              <div>
                <dt>Code verified</dt>
                <dd>{date(s.friend.verifiedAt)}</dd>
              </div>
              <div>
                <dt>Last seen locally</dt>
                <dd>
                  {s.friend.lastSeen
                    ? `${date(s.friend.lastSeen)} · ${time(s.friend.lastSeen)}`
                    : "Not yet"}
                </dd>
              </div>
            </dl>
            <label className="fingerprint-label">
              Friend’s public identity fingerprint
            </label>
            <p className="fingerprint">{fingerprint(s.friend.public)}</p>
            <p className="field-hint">
              This is public. The private key stays on your friend’s device.
            </p>
            <div className="trust-actions">
              <button className="button danger-button" onClick={remove}>
                <UserPlus size={17} />
                Remove trusted device
              </button>
              <button className="text-button" onClick={remove}>
                Re-pair this device
              </button>
            </div>
          </div>
          <div className="card code-card">
            <div className="card-icon green">
              <ShieldCheck size={26} />
            </div>
            <h3>Your shared security code</h3>
            <p>
              Both paired devices show this same code. Compare it again whenever
              you want to check the saved identities.
            </p>
            <Code value={securityCode(s.self!.public, s.friend.public)} />
            <ul className="security-facts">
              <li>Keys are pinned after your verification.</li>
              <li>Each connection proves key possession.</li>
              <li>A changed identity cannot replace this trust.</li>
            </ul>
          </div>
        </div>
      ) : (
        <div className="card paired-card">
          <div className="card-icon">
            <ShieldCheck size={26} />
          </div>
          <h3>No trusted device yet</h3>
          <p>
            Discovery only finds devices. Pairing and your security-code check
            establish trust.
          </p>
          <button className="button primary" onClick={pair}>
            Pair with your friend
          </button>
        </div>
      )}
      <div className="card own-identity">
        <div className="panel-title">
          <h3>Your public identity</h3>
          <LockKeyhole size={19} />
        </div>
        <p className="fingerprint">{fingerprint(s.self!.public)}</p>
        <p>
          Your private keys are encrypted in the local vault. They are never
          displayed or sent to your friend.
        </p>
      </div>
      <div className="honesty-note">
        <AlertTriangle size={19} />
        <p>
          Encryption protects the network path. An unlocked device, malicious
          software or a compromised operating system can still expose your
          messages. This version has no message ratchet or forward secrecy.
        </p>
      </div>
    </section>
  );
}

function SettingsView({
  s,
  theme,
  setTheme,
  autoLock,
  setAutoLock,
  confirm,
  navigate,
}: {
  s: Snapshot;
  theme: string;
  setTheme: (value: string) => void;
  autoLock: number;
  setAutoLock: (value: number) => void;
  confirm: (kind: ConfirmKind) => void;
  navigate: Navigate;
}) {
  const [host, setHost] = useState(s.friend?.endpoint.host ?? "");
  const [port, setPort] = useState(String(s.friend?.endpoint.port ?? 4455));
  const [error, setError] = useState("");
  return (
    <section className="page-scroll settings-page">
      <div className="page-heading">
        <span className="eyebrow">ON YOUR TERMS</span>
        <h2>Make yourself at home</h2>
        <p>Your device. Your identity. Your conversation.</p>
      </div>
      <div className="card">
        <div className="panel-title">
          <h3>Appearance &amp; privacy</h3>
          <Settings size={20} />
        </div>
        <div className="setting-row">
          <div>
            <strong>Theme</strong>
            <p>Choose a comfortable light or dark space.</p>
          </div>
          <select
            aria-label="Theme"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </div>
        <div className="setting-row">
          <div>
            <strong>Auto-lock</strong>
            <p>Lock your vault after no keyboard or mouse activity.</p>
          </div>
          <select
            aria-label="Auto-lock"
            value={autoLock}
            onChange={(e) => setAutoLock(Number(e.target.value))}
          >
            <option value={5}>5 minutes</option>
            <option value={15}>15 minutes</option>
            <option value={30}>30 minutes</option>
          </select>
        </div>
        <div className="setting-row">
          <div>
            <strong>Lock this device</strong>
            <p>Clear decrypted messages and keys from the active session.</p>
          </div>
          <button className="button secondary" onClick={() => engine.lock()}>
            <LockKeyhole size={16} />
            Lock now
          </button>
        </div>
      </div>
      <div className="card">
        <div className="panel-title">
          <h3>Local connection</h3>
          <Wifi size={20} />
        </div>
        <dl className="info-list">
          <div>
            <dt>Browser UI</dt>
            <dd>
              <code>{location.origin}</code>
            </dd>
          </div>
          <div>
            <dt>LAN listener</dt>
            <dd>
              <code>
                {s.network!.endpoint.host}:{s.network!.endpoint.port}
              </code>
            </dd>
          </div>
          <div>
            <dt>Discovery</dt>
            <dd>
              {s.network!.discoveryEnabled
                ? "mDNS on local Wi-Fi"
                : "Manual connection"}
            </dd>
          </div>
          <div>
            <dt>Internet</dt>
            <dd>
              {s.network?.relayUrl
                ? s.relayConnected
                  ? "Relay connected"
                  : "Relay offline"
                : "Relay not configured"}
            </dd>
          </div>
        </dl>
        <p className="field-hint">
          Localhost is this computer. With the same configured relay, your
          friend can connect from any network. LAN discovery can use a direct
          path.
        </p>
        {s.friend ? (
          <>
            <div className="endpoint-inputs">
              <label>
                Friend’s LAN IPv4
                <input
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  spellCheck={false}
                />
              </label>
              <label>
                LAN port
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                />
              </label>
            </div>
            <ActionError message={error} />
            <button
              className="button secondary"
              onClick={() => {
                try {
                  engine.reconnect(host.trim(), Number(port));
                  setError("");
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "Could not reconnect",
                  );
                }
              }}
            >
              <RefreshCw size={17} />
              Reconnect to trusted device
            </button>
          </>
        ) : null}
      </div>
      <div className="card danger-zone">
        <div className="panel-title">
          <h3>Manage your local data</h3>
          <Trash2 size={20} />
        </div>
        <div className="setting-row">
          <div>
            <strong>Delete conversation</strong>
            <p>Remove this device’s history. Keep your identity and pairing.</p>
          </div>
          <button
            className="button secondary"
            onClick={() => confirm("history")}
          >
            Delete history
          </button>
        </div>
        <div className="setting-row">
          <div>
            <strong>Reset identity</strong>
            <p>
              Delete local keys, history and trust. Your friend must re-pair.
            </p>
          </div>
          <button
            className="button danger-button"
            onClick={() => confirm("reset")}
          >
            Reset this device
          </button>
        </div>
      </div>
      <div className="small-note">
        <ShieldCheck size={15} />
        No recovery account. Keep your passphrase safe; a reset cannot recover
        an old conversation.
      </div>
      <div className="policy-links">
        <InternalLink href="/help" navigate={navigate}>
          Help &amp; setup
        </InternalLink>
        <InternalLink href="/terms" navigate={navigate}>
          Terms of use
        </InternalLink>
        <InternalLink href="/privacy" navigate={navigate}>
          Privacy policy
        </InternalLink>
      </div>
    </section>
  );
}

function ConfirmDialog({
  kind,
  close,
}: {
  kind: ConfirmKind;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const expected =
    kind === "reset" ? "RESET" : kind === "unpair" ? "REMOVE" : "";
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  const descriptions = {
    history: [
      "Delete this conversation?",
      "This deletes the encrypted history on this device. Your saved identity and pairing remain. Your friend’s copy is unchanged.",
    ],
    unpair: [
      "Remove your trusted device?",
      "This disconnects your friend and deletes this device’s conversation and saved trust. Your identity stays. Both people must verify a new pairing before chatting again.",
    ],
    reset: [
      "Reset this device’s identity?",
      "This permanently deletes the local vault, private keys, conversation and pairing. Your friend will see a different identity. Create a new identity and verify a new pairing on both devices.",
    ],
  };
  const apply = async () => {
    setBusy(true);
    try {
      if (kind === "reset") await engine.resetIdentity();
      else if (kind === "unpair") await engine.removeFriend();
      else await engine.clearHistory();
      close();
    } catch {
      setError("The local operation failed. Try again before continuing.");
      setBusy(false);
    }
  };
  return (
    <dialog
      className="confirm-dialog card"
      ref={ref}
      aria-labelledby="confirm-title"
      onCancel={close}
    >
      <div className="card-icon red">
        <AlertTriangle size={27} />
      </div>
      <h3 id="confirm-title">{descriptions[kind][0]}</h3>
      <p>{descriptions[kind][1]}</p>
      {expected ? (
        <label>
          Type {expected} to confirm
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      ) : null}
      <ActionError message={error} />
      <div className="inline-actions">
        <button className="button secondary" onClick={close} disabled={busy}>
          Cancel
        </button>
        <button
          className="button danger-button"
          onClick={() => void apply()}
          disabled={busy || (expected !== "" && typed !== expected)}
        >
          {busy
            ? "Working…"
            : kind === "history"
              ? "Delete history"
              : kind === "unpair"
                ? "Remove trust"
                : "Reset identity"}
        </button>
      </div>
    </dialog>
  );
}
