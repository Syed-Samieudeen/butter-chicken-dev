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
  Send,
  Check,
  Clock3,
  X,
  Eye,
  EyeOff,
  Trash2,
  AlertTriangle,
  Heart,
  KeyRound,
  LoaderCircle,
  Users,
} from "./icons";
import { ClientApi } from "./api";
import { ChatEngine, IDLE_LOCK_MS, type Snapshot } from "./engine";
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
function useCountdown(expires?: number): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!expires) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expires]);
  if (!expires) return "";
  const left = Math.max(0, Math.ceil((expires - now) / 1000));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
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
  const [fatal, setFatal] = useState("");
  const [confirm, setConfirm] = useState<ConfirmKind>();
  const [toast, setToast] = useState("");
  const [showGroup, setShowGroup] = useState(false);
  const [showRecoverySetup, setShowRecoverySetup] = useState(false);
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
    if (s.mode === "ready" && pairingStarted.current && !s.pending && !s.invitation && s.friend) {
      pairingStarted.current = false;
      navigate("/thank-you");
    } else if (s.mode === "ready" && !s.friends.length && !s.groups.length && path === "/")
      navigate("/pair");
  }, [s.mode, s.friend?.public.id, s.friends.length, s.groups.length, s.pending, s.invitation, path, navigate]);
  useEffect(() => {
    if (s.mode !== "ready") return;
    const touch = () => engine.touch();
    const events = ["pointerdown", "keydown", "touchstart", "wheel"] as const;
    for (const name of events)
      window.addEventListener(name, touch, { passive: true });
    return () => {
      for (const name of events) window.removeEventListener(name, touch);
    };
  }, [s.mode]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (s.mode === "ready" && !s.locked && s.recoverySetupNeeded)
      setShowRecoverySetup(true);
  }, [s.mode, s.locked, s.recoverySetupNeeded]);
  const navigation: {
    view: View;
    label: string;
    icon: typeof MessageCircle;
  }[] = [
    { view: "chat", label: "Chat", icon: MessageCircle },
    { view: "pair", label: "Pair with a code", icon: UserPlus },
    { view: "security", label: "Security", icon: ShieldCheck },
    { view: "settings", label: "Settings", icon: Settings },
  ];
  const connected = s.state === "CONNECTED";
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
          {s.mode === "ready" && !s.locked ? (
            <button
              className="nav-button"
              aria-label="Lock screen"
              title="Lock screen (connection stays on)"
              onClick={() => engine.lockScreen()}
            >
              <LockKeyhole size={21} />
            </button>
          ) : null}
          <Avatar name={s.self?.displayName} />
        </div>
      </nav>
      <aside className="sidebar">
        <div className="wordmark">
          Butter<br />Chicken<span className="wordmark-dot">.</span>
          <span className="edition">Private encrypted chat</span>
        </div>
        <div className="sidebar-label"><span>Conversations</span><LockKeyhole size={14} /></div>
        {s.friends.map((f) => (
          <button key={f.public.id} className={`friend-row ${s.selected?.type === 'friend' && s.selected.id === f.public.id ? 'selected' : ''}`} onClick={() => { engine.selectConversation({ type: 'friend', id: f.public.id }); setView('chat'); }}>
            <Avatar name={f.displayName} />
            <span><strong>{f.displayName}</strong><small>{f.lastSeen ? 'Last seen ' + date(f.lastSeen) : 'Contact'}</small></span>
            <span className={`presence ${connected && s.selected?.type === 'friend' && s.selected.id === f.public.id ? 'online' : ''}`} />
          </button>
        ))}
        {s.groups.map((g) => (
          <button key={g.id} className={`friend-row ${s.selected?.type === 'group' && s.selected.id === g.id ? 'selected' : ''}`} onClick={() => { engine.selectConversation({ type: 'group', id: g.id }); setView('chat'); }}>
            <span className="avatar" aria-hidden="true"><Users size={16} /></span>
            <span><strong>{g.name}</strong><small>{g.members.length + 1} people</small></span>
          </button>
        ))}
        <button className="friend-row add-friend" onClick={() => setView('pair')}><span className="add-avatar"><UserPlus size={22} /></span><span><strong>Add contact</strong><small>Pair with a 6-digit code.</small></span></button>
        {s.friends.length >= 2 ? <button className="friend-row add-friend" onClick={() => setShowGroup(true)}><span className="add-avatar"><Users size={22} /></span><span><strong>New group</strong><small>Chat with 3+ people.</small></span></button> : null}
        <div className="sidebar-note"><ShieldCheck size={18} /><p>Contacts are saved by identity.<br />Connections stay on through the relay.</p></div>
        <div className="sidebar-help"><InternalLink href="/help" navigate={navigate}>Help &amp; setup</InternalLink> <InternalLink href="/privacy" navigate={navigate}>Privacy</InternalLink> <InternalLink href="/terms" navigate={navigate}>Terms</InternalLink></div>
        <div className="sidebar-bottom">
          <div className="network-card"><div className="network-title"><Wifi size={18} /><strong>Connection</strong></div><div className="network-line"><span className={`presence ${s.relayConnected ? 'online' : ''}`} /><span>{s.relayUrl ? (s.relayConnected ? 'Relay connected' : 'Reconnecting to relay...') : 'Starting...'}</span></div><hr /><span className="network-foot">Relay: Cloudflare<br />{s.friends.length ? `${s.friends.length} contact(s)` : 'No contacts paired'}</span></div>
          <div className="self-row"><Avatar name={s.self?.displayName} /><span><strong>{s.self?.displayName ?? 'This device'}</strong><small>{s.mode === 'ready' ? (s.locked ? 'Screen locked' : 'Unlocked') : s.mode === 'new' ? 'Create your identity' : 'Vault locked'}</small></span><LockKeyhole size={16} /></div>
        </div>
      </aside>
      <main className="main-panel">
        <header className="main-header">
          <div className="room-heading">
            {s.selected?.type === "group" ? (
              <span className="room-icon"><Users size={23} /></span>
            ) : s.friend ? (
              <Avatar name={s.friend.displayName} />
            ) : (
              <span className="room-icon"><MessageCircle size={23} /></span>
            )}
            <div>
              <h1>
                {s.selected?.type === "group"
                  ? (s.groups.find((g) => g.id === s.selected?.id)?.name ?? "Group")
                  : s.friend?.displayName ?? "Conversations"}
              </h1>
              <span>
                {s.selected?.type === "group"
                  ? `${(s.groups.find((g) => g.id === s.selected?.id)?.members.length ?? 0) + 1} people · encrypted`
                  : s.friend
                    ? `${connected ? "Connected" : "Waiting"} · Trusted conversation`
                    : "Add a contact or create a group"}
              </span>
            </div>
          </div>
          <button
            className={`security-status ${connected ? "secure" : s.state === "IDENTITY_CHANGED" ? "danger" : ""}`}
            onClick={() => setView("security")}
            disabled={s.mode !== "ready" || s.locked}
          >
            <ShieldCheck size={17} />
            <span>{s.mode === "ready" && !s.locked ? stateLabels[s.state] : "Encrypted"}</span>
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
            <h2>Start Butter Chicken</h2>
            <p>{fatal}</p>
            <button className="button primary" onClick={() => location.reload()}>
              Reload
            </button>
          </div>
        ) : s.mode === "loading" ? (
          <LoadingSkeleton />
        ) : s.mode !== "ready" ? (
          <AuthGate
            mode={s.mode}
            reset={() => setConfirm("reset")}
            recover={(code, passphrase) =>
              engine.recoverWithKey(code, passphrase)
            }
            onCreated={() => setShowRecoverySetup(true)}
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
            confirm={setConfirm}
            navigate={navigate}
          />
        )}
      </main>
      {s.mode === "ready" && s.locked ? (
        <LockScreen friendName={undefined} />
      ) : null}
      {toast ? (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
        </div>
      ) : null}
      {showGroup ? (
        <GroupDialog friends={s.friends} onClose={() => setShowGroup(false)} onCreate={async (name, members) => { await engine.createGroup(name, members); setShowGroup(false); setView("chat"); setToast("Group created."); }} />
      ) : null}
      {showRecoverySetup && s.mode === "ready" && !s.locked ? (
        <RecoveryKeyDialog
          onClose={() => {
            engine.dismissRecoverySetup();
            setShowRecoverySetup(false);
          }}
        />
      ) : null}
      {confirm ? (
        <ConfirmDialog kind={confirm} close={() => setConfirm(undefined)} selectedPeerId={s.selected?.type === "friend" ? s.selected.id : undefined} />
      ) : null}
    </div>
  );
}

function LockScreen({ friendName }: { friendName?: string }) {
  const [passphrase, setPassphrase] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await engine.unlock(passphrase);
      setPassphrase("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not unlock.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="lock-overlay" role="dialog" aria-modal="true" aria-labelledby="lock-title">
      <form className="lock-card card" onSubmit={submit}>
        <div className="card-icon">
          <LockKeyhole size={25} />
        </div>
        <h3 id="lock-title">Screen locked</h3>
        <p>
          You were away for 10 minutes. Your connection is still on
          {friendName ? ` and ${friendName} can still reach you` : ""}. Enter
          your passphrase to see your conversation again.
        </p>
        <label>
          Passphrase
          <div className="password-field">
            <input
              type={show ? "text" : "password"}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoComplete="current-password"
              maxLength={512}
              required
              autoFocus
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
        <ActionError message={error} />
        <button type="submit" className="button primary full" disabled={busy}>
          {busy ? <LoaderCircle className="spin" size={18} /> : <LockKeyhole size={18} />}
          {busy ? "Checking…" : "Unlock"}
        </button>
        <button
          type="button"
          className="text-button"
          onClick={() => engine.lock()}
        >
          Forgot it? Sign out and use recovery key
        </button>
      </form>
    </div>
  );
}

function AuthGate({
  mode,
  reset,
  recover,
  onCreated,
  navigate,
}: {
  mode: "new" | "locked";
  reset: () => void;
  recover: (code: string, passphrase: string) => Promise<void>;
  onCreated: () => void;
  navigate: Navigate;
}) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [show, setShow] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if ((mode === "new" || recovering) && password !== repeat)
      return setError("The passphrases don’t match.");
    setBusy(true);
    try {
      if (mode === "new") {
        await engine.create(name, password);
        onCreated();
      }
      else if (recovering) await recover(recoveryCode, password);
      else await engine.unlock(password);
      setPassword("");
      setRepeat("");
      setRecoveryCode("");
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
          Welcome to Butter Chicken
        </div>
        <h2>
          A little space.
          <br />
          <em>Just for you two.</em>
        </h2>
        <p>
          Pair with a 6-digit code. Chat from any network, from anywhere.
          <br />
          Your messages are encrypted before they leave your computer.
        </p>
        <div className="hero-actions">
          <InternalLink
            className="button primary"
            href="#identity-form"
            navigate={navigate}
          >
            {mode === "new" ? "Create your identity" : "Unlock this device"}
          </InternalLink>
          <InternalLink className="text-button" href="/help" navigate={navigate}>
            Read the setup guide
          </InternalLink>
        </div>
        <div className="intro-features">
          <span>
            <Wifi size={18} />
            Any network
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
            : recovering
              ? "Use your saved recovery key to set a new passphrase. Your identity and local history will be preserved."
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
        {mode === "locked" && recovering ? (
          <label>
            Recovery key
            <input
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value)}
              placeholder="Paste your saved recovery key"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              required
            />
            <small className="field-hint">
              This is different from your passphrase. Save it separately from this device.
            </small>
          </label>
        ) : null}
        {!recovering ? (
        <label>
          Passphrase
          <div className="password-field">
            <input
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={
                mode === "new" ? "A few unrelated words" : "Enter your passphrase"
              }
              minLength={mode === "new" ? 12 : undefined}
              maxLength={512}
              autoComplete={mode === "new" ? "new-password" : "current-password"}
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
        ) : null}
        {mode === "new" ? (
          <>
            <small className="field-hint">
              At least 12 characters. Save the recovery key shown after setup.
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
        {mode === "locked" && recovering ? (
          <>
            <label>
              New passphrase
              <input
                type={show ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={12}
                maxLength={512}
                autoComplete="new-password"
                required
              />
            </label>
            <label>
              Confirm new passphrase
              <input
                type={show ? "text" : "password"}
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
                maxLength={512}
                autoComplete="new-password"
                required
              />
            </label>
          </>
        ) : null}
        <ActionError message={error} />
        <button type="submit" className="button primary full" disabled={busy}>
          {busy ? <LoaderCircle className="spin" size={18} /> : <LockKeyhole size={18} />}
          {busy
            ? recovering ? "Recovering your vault..." : "Opening your vault…"
            : mode === "new"
              ? "Create identity"
              : recovering ? "Recover and set passphrase" : "Unlock your space"}
        </button>
        <div className="auth-foot">
          {mode === "new" ? (
            <>
              <ShieldCheck size={15} />
              <span>No account. No sign-up. Your keys stay on this device.</span>
            </>
          ) : (
            <>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setRecovering((value) => !value);
                  setError("");
                  setPassword("");
                  setRepeat("");
                }}
              >
                {recovering ? "Back to unlock" : "Forgot passphrase? Use recovery key"}
              </button>
              {!recovering ? (
                <button type="button" className="text-button" onClick={reset}>
                  No recovery key? Reset this device
                </button>
              ) : null}
            </>
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
  const [reply, setReply] = useState<
    { id: string; text: string; from: "me" | "friend" } | undefined
  >();
  const bottom = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isGroup = s.selected?.type === "group";
  const canSend = isGroup ? s.groups.some((g) => g.id === s.selected?.id) : Boolean(s.friend) && (s.state === "CONNECTED" || Boolean(s.relayConnected));
  useEffect(() => {
    if (document.visibilityState === "visible" && document.hasFocus())
      engine.markRead();
  }, [s.messages.length, s.relayConnected, s.state]);
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
  }, []);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [s.messages.length]);
  const send = async () => {
    if (sending || !draft.trim()) return;
    setSending(true);
    setError("");
    try {
      await engine.sendMessage(
        draft,
        reply ? { id: reply.id, text: reply.text } : undefined,
      );
      setDraft("");
      setReply(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to send");
    } finally {
      setSending(false);
    }
  };
  const startReply = (m: (typeof s.messages)[number]) => {
    setReply({ id: m.id, text: m.text, from: m.from });
    setError("");
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  return (
    <div className="chat-view">
      <div className="conversation-banner">
        <LockKeyhole size={14} />
        <span>
          {isGroup
            ? "Group messages are encrypted and sent to each member through the relay."
            : s.friend
            ? "Messages are encrypted on this device. They reach your contact through the relay."
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
                date(s.messages[i - 1].receivedAt ?? s.messages[i - 1].sentAt) ? (
                <div className="date-divider">
                  <span>{date(m.receivedAt ?? m.sentAt)}</span>
                </div>
              ) : null}
              <div
                id={`msg-${m.id}`}
                className={`message-row ${m.from === "me" ? "mine" : "theirs"}`}
                title="Double-click to reply"
                onDoubleClick={() => startReply(m)}
              >
                {m.from === "friend" ? (
                  <Avatar name={isGroup ? (s.friends.find((f) => f.public.id === m.peerId)?.displayName ?? "Contact") : s.friend?.displayName} />
                ) : null}
                <div className="message-bubble">
                  <span className="sr-only">
                    {m.from === "me" ? "You" : (isGroup ? (s.friends.find((f) => f.public.id === m.peerId)?.displayName ?? "Contact") : s.friend?.displayName)}:{" "}
                  </span>
                  {m.replyTo && m.replyPreview ? (
                    <button
                      type="button"
                      className="reply-quote"
                      aria-label="Go to replied message"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!m.replyTo) return;
                        const el = document.getElementById(`msg-${m.replyTo}`);
                        if (!el) return;
                        el.scrollIntoView({ block: "center", behavior: "smooth" });
                        el.classList.add("reply-target");
                        window.setTimeout(() => el.classList.remove("reply-target"), 1200);
                      }}
                      onDoubleClick={(e) => e.stopPropagation()}
                    >
                      <p>{m.replyPreview}</p>
                    </button>
                  ) : null}
                  <p>{m.text}</p>
                  <div className="message-meta">
                    <time
                      dateTime={m.receivedAt ?? m.sentAt}
                      title={
                        m.from === "friend"
                          ? `Received. Sender’s time: ${m.sentAt}`
                          : m.sentAt
                      }
                    >
                      {time(m.receivedAt ?? m.sentAt)}
                    </time>
                    {m.from === "me" ? (
                      <span
                        aria-label={
                          m.state === "READ"
                            ? "Read by your friend"
                            : m.delivered
                              ? "Delivered"
                              : "Waiting for delivery"
                        }
                      >
                        {(
                          {
                            QUEUED: "Queued",
                            SENDING: "Sending",
                            SENT: "Sent",
                            DELIVERED: "Delivered",
                            READ: "Read",
                            FAILED: "Failed",
                          } as Record<string, string>
                        )[m.state ?? (m.delivered ? "DELIVERED" : "QUEUED")] ??
                          "Queued"}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="chat-empty">
            <div className="empty-icon"><MessageCircle size={38} /></div>
            <h2>{isGroup ? "Start the group conversation" : s.friend ? "Your first hello starts here" : "Start a conversation"}</h2>
            <p>{isGroup ? "Messages you send are encrypted and delivered to each member of this group." : s.friend ? `You are paired with ${s.friend.displayName}. Messages you send while they are offline wait here, encrypted, and arrive when they reconnect.` : "Add a contact with a 6-digit code, or create a group with 3+ people."}</p>
            {!s.friend && !isGroup ? (<button className="button primary" onClick={pair}><UserPlus size={18} />Add a contact</button>) : null}
          </div>
        )}
                <div ref={bottom} />
      </div>
                  <div className="composer-area">
        <ActionError message={error} />
        {reply ? (
          <div className="reply-bar" role="status">
            <div className="reply-bar-body">
              <span className="reply-bar-label">
                Replying to{" "}
                {reply.from === "me" ? "you" : (isGroup ? "contact" : (s.friend?.displayName ?? "contact"))}
              </span>
              <p>{reply.text}</p>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="Cancel reply"
              onClick={() => setReply(undefined)}
            >
              <X size={16} />
            </button>
          </div>
        ) : null}
        <div className="composer">
          <textarea
            ref={inputRef}
            aria-label="Message"
            placeholder={
              !s.friend && !isGroup
                ? "Add a contact or select a conversation to start chatting"
                : canSend
                  ? "Write a message..."
                  : "Connecting to the relay. Messages are kept and sent when it is ready."
            }
            value={draft}
            maxLength={8000}
            disabled={!s.friend && !isGroup}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
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
            disabled={(!s.friend && !isGroup) || !draft.trim() || sending}
          >
            <Send size={20} />
          </button>
        </div>
        <div className="composer-foot">
          <span>
            <LockKeyhole size={12} />
            Encrypted on this device
          </span>
          <span>Enter to send · Shift + Enter for a new line</span>
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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  const countdown = useCountdown(s.invitation?.expires);
  useEffect(() => {
    setChecked(false);
  }, [s.pending?.identity.id]);
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
  return (
    <section className="page-scroll">
      <div className="page-heading">
        <span className="eyebrow">Pair with a code</span>
        <h2>Add a contact</h2>
        <p>
          One person creates a 6-digit code. The other enters it. Then you both
          confirm a short security code together. You can pair with multiple contacts.
        </p>
        {s.friends.length ? (
          <div className="inline-actions" style={{marginTop: "12px"}}>
            <button className="button secondary" onClick={chat}>Back to conversations</button>
          </div>
        ) : null}
      </div>
      {s.pending ? (
        <div className="card verification-card">
          <div className="card-icon">
            <ShieldCheck size={28} />
          </div>
          <span className="eyebrow">Confirm the security code</span>
          <h3>Is this really {s.pending.displayName}?</h3>
          <p>
            Read every group below to your friend on a call or in person. Both
            screens must show exactly the same code before you confirm.
          </p>
          <Code value={s.pending.code} />
          <div className="verify-progress">
            <span>
              <Check size={16} />
              Connection encrypted
            </span>
            <span className={s.pending.remoteVerified ? "done" : ""}>
              {s.pending.remoteVerified ? <Check size={16} /> : <Clock3 size={16} />}
              {s.pending.remoteVerified
                ? "Friend confirmed"
                : "Waiting for your friend to confirm"}
            </span>
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              disabled={s.pending.localVerified}
            />
            The code matches what my friend sees.
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
                Waiting for your friend
              </>
            ) : (
              <>
                <ShieldCheck size={18} />
                Confirm
              </>
            )}
          </button>
          <button className="text-button cancel-pair" onClick={() => engine.cancelPairing()}>
            The codes don’t match? Cancel pairing
          </button>
        </div>
      ) : (
        <div className="pair-grid">
          <div className="card invite-card">
            <div className="step-label">
              <span>01</span>Create a code
            </div>
            <h3>Show a code to your friend</h3>
            <p>Share this 6-digit code only with the person you want to connect with. It works once and expires in 10 minutes.</p>
            {s.invitation?.code ? (
              <>
                <div className="pair-code" aria-label="Your 6-digit pairing code">
                  {s.invitation.code.split("").map((d, i) => (
                    <span key={i}>{d}</span>
                  ))}
                </div>
                <div className="invitation-line">
                  <span>
                    <Clock3 size={14} />
                    Expires in {countdown}
                  </span>
                </div>
                <div className="waiting">
                  <span className="waiting-dot" />
                  Waiting for your friend to enter the code…
                </div>
                <button className="text-button" onClick={() => engine.cancelPairing()}>
                  Cancel code
                </button>
              </>
            ) : (
              <div className="invite-empty">
                <ActionError message={error} />
                <button
                  className="button primary"
                  disabled={busy || !s.relayConnected}
                  onClick={() => void action(() => engine.invite())}
                >
                  {busy ? <LoaderCircle className="spin" size={18} /> : <UserPlus size={18} />}
                  Create a code
                </button>
                {!s.relayConnected ? (
                  <small>Connecting to the relay…</small>
                ) : (
                  <small>You’ll see the code here.</small>
                )}
              </div>
            )}
          </div>
          <form
            className="card join-card"
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                await engine.join(code);
                setCode("");
                toast("Code sent. Waiting for your friend to confirm.");
              });
            }}
          >
            <div className="step-label">
              <span>02</span>Enter a friend’s code
            </div>
            <h3>Have a code?</h3>
            <p>Type the 6 digits your friend shows you.</p>
            <label>
              Friend’s 6-digit code
              <input
                className="code-input"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                pattern="[0-9]{6}"
                maxLength={6}
                aria-describedby="code-help"
                required
              />
            </label>
            <small id="code-help" className="field-hint">
              Codes expire after 10 minutes and work only once.
            </small>
            <ActionError message={error} />
            <button
              className="button primary full"
              type="submit"
              disabled={code.length !== 6 || busy || !s.relayConnected || s.joining}
            >
              {busy || s.joining ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <ShieldCheck size={18} />
              )}
              {s.joining ? "Connecting…" : "Connect"}
            </button>
            <div className="small-note">
              <LockKeyhole size={14} />
              A code connects you. The security code confirms it’s really your friend.
            </div>
          </form>
        </div>
      )}
    </section>
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
        <span className="eyebrow">Know who’s on the other side</span>
        <h2>Your connection, verified</h2>
        <p>
          Your friend is recognised by their saved identity, even when their network or device changes.
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
                <dt>Security code confirmed</dt>
                <dd>{date(s.friend.verifiedAt)}</dd>
              </div>
            </dl>
            <label className="fingerprint-label">Contact's identity fingerprint</label>
            <p className="fingerprint">{fingerprint(s.friend.public)}</p>
            <p className="field-hint">This is public. Their private key never leaves their device.</p>
            <div className="trust-actions">
              <button className="button danger-button" onClick={remove}>
                <Trash2 size={17} />
                Remove this contact
              </button>
              <button className="text-button" onClick={pair}>
                Pair again
              </button>
            </div>
          </div>
          <div className="card code-card">
            <div className="card-icon green">
              <ShieldCheck size={26} />
            </div>
            <h3>Your shared security code</h3>
            <p>Both devices show this same code. Compare it any time you want to check the connection.</p>
            <Code value={securityCode(s.self!.public, s.friend.public)} />
            <ul className="security-facts">
              <li>Keys were confirmed by both of you.</li>
              <li>Every connection proves possession of those keys.</li>
              <li>A changed identity cannot replace this trust.</li>
            </ul>
          </div>
        </div>
      ) : (
        <div className="card paired-card">
          <div className="card-icon">
            <ShieldCheck size={26} />
          </div>
          <h3>No trusted contacts yet</h3>
          <p>Pair with a 6-digit code and a security-code check to create trust.</p>
          <button className="button primary" onClick={pair}>
            Pair with a code
          </button>
        </div>
      )}
      <div className="card own-identity">
        <div className="panel-title">
          <h3>Your public identity</h3>
          <LockKeyhole size={19} />
        </div>
        <p className="fingerprint">{fingerprint(s.self!.public)}</p>
        <p>Your private keys are encrypted in the local vault. They are never displayed or sent to your friend.</p>
      </div>
      <div className="honesty-note">
        <AlertTriangle size={19} />
        <p>
          Encryption protects messages in transit. A compromised or unlocked computer, malware, or a modified app can still expose them. This version has no message ratchet or forward secrecy.
        </p>
      </div>
    </section>
  );
}

function SettingsView({
  s,
  theme,
  setTheme,
  confirm,
  navigate,
}: {
  s: Snapshot;
  theme: string;
  setTheme: (value: string) => void;
  confirm: (kind: ConfirmKind) => void;
  navigate: Navigate;
}) {
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [changingPassphrase, setChangingPassphrase] = useState(false);
  const [currentPassphrase, setCurrentPassphrase] = useState("");
  const [newPassphrase, setNewPassphrase] = useState("");
  const [repeatPassphrase, setRepeatPassphrase] = useState("");
  const [passphraseError, setPassphraseError] = useState("");
  const [passphraseNotice, setPassphraseNotice] = useState("");
  const [savingPassphrase, setSavingPassphrase] = useState(false);
  const showRecoveryKey = () => {
    try {
      setRecoveryCode(engine.recoveryCode());
      setShowRecovery(true);
    } catch (error) {
      setPassphraseError(
        error instanceof Error ? error.message : "Could not show recovery key.",
      );
    }
  };
  const saveNewPassphrase = async (event: FormEvent) => {
    event.preventDefault();
    setPassphraseError("");
    setPassphraseNotice("");
    if (newPassphrase !== repeatPassphrase) {
      setPassphraseError("The new passphrases don't match.");
      return;
    }
    setSavingPassphrase(true);
    try {
      await engine.changePassphrase(currentPassphrase, newPassphrase);
      setCurrentPassphrase("");
      setNewPassphrase("");
      setRepeatPassphrase("");
      setChangingPassphrase(false);
      setPassphraseNotice("Passphrase changed. Your identity and history are unchanged.");
    } catch (error) {
      setPassphraseError(
        error instanceof Error ? error.message : "Could not change passphrase.",
      );
    } finally {
      setSavingPassphrase(false);
    }
  };
  return (
    <section className="page-scroll settings-page">
      <div className="page-heading">
        <span className="eyebrow">On your terms</span>
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
          <select aria-label="Theme" value={theme} onChange={(e) => setTheme(e.target.value)}>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </div>
        <div className="setting-row">
          <div>
            <strong>Screen lock</strong>
            <p>
              After {IDLE_LOCK_MS / 60_000} minutes without activity, your screen asks for your passphrase. Your connection stays on.
            </p>
          </div>
          <button className="button secondary" onClick={() => engine.lockScreen()}>
            <LockKeyhole size={16} />
            Lock now
          </button>
        </div>
      </div>
      <div className="card">
        <div className="panel-title">
          <h3>Passphrase &amp; recovery</h3>
          <KeyRound size={20} />
        </div>
        <p>
          Change your passphrase while you are unlocked. The recovery key lets
          you set a new passphrase if you forget this one; it cannot be
          regenerated after you lose access to both.
        </p>
        <div className="setting-row">
          <div>
            <strong>Recovery key</strong>
            <p>Keep a separate copy somewhere private and offline.</p>
          </div>
          <button className="button secondary" onClick={showRecoveryKey}>
            Show recovery key
          </button>
        </div>
        {showRecovery ? (
          <div className="recovery-key-box">
            <strong>Save this key somewhere separate from your device</strong>
            <code>{recoveryCode}</code>
            <div className="inline-actions">
              <button
                className="button secondary"
                onClick={() => {
                  if (!navigator.clipboard?.writeText) {
                    setPassphraseError(
                      "Clipboard unavailable. Select and copy the key manually.",
                    );
                    return;
                  }
                  void navigator.clipboard
                    .writeText(recoveryCode)
                    .then(() => setPassphraseNotice("Recovery key copied. Store it safely."))
                    .catch(() =>
                      setPassphraseError("Copy failed. Select and copy the key manually."),
                    );
                }}
              >
                Copy recovery key
              </button>
              <button
                className="text-button"
                onClick={() => setShowRecovery(false)}
              >
                Hide
              </button>
            </div>
          </div>
        ) : null}
        <div className="setting-row">
          <div>
            <strong>Change passphrase</strong>
            <p>Keep it private and use at least 12 characters.</p>
          </div>
          <button
            className="button secondary"
            onClick={() => {
              setChangingPassphrase((value) => !value);
              setPassphraseError("");
              setPassphraseNotice("");
            }}
          >
            {changingPassphrase ? "Cancel" : "Change passphrase"}
          </button>
        </div>
        {changingPassphrase ? (
          <form className="passphrase-change-form" onSubmit={saveNewPassphrase}>
            <label>
              Current passphrase
              <input
                type="password"
                value={currentPassphrase}
                onChange={(e) => setCurrentPassphrase(e.target.value)}
                autoComplete="current-password"
                maxLength={512}
                required
              />
            </label>
            <label>
              New passphrase
              <input
                type="password"
                value={newPassphrase}
                onChange={(e) => setNewPassphrase(e.target.value)}
                autoComplete="new-password"
                minLength={12}
                maxLength={512}
                required
              />
            </label>
            <label>
              Confirm new passphrase
              <input
                type="password"
                value={repeatPassphrase}
                onChange={(e) => setRepeatPassphrase(e.target.value)}
                autoComplete="new-password"
                maxLength={512}
                required
              />
            </label>
            <ActionError message={passphraseError} />
            <button
              className="button primary"
              type="submit"
              disabled={savingPassphrase}
            >
              {savingPassphrase ? "Saving..." : "Save new passphrase"}
            </button>
          </form>
        ) : null}
        {passphraseNotice ? <p className="success-note">{passphraseNotice}</p> : null}
        {!changingPassphrase ? <ActionError message={passphraseError} /> : null}
      </div>
      <div className="card">
        <div className="panel-title">
          <h3>Connection</h3>
          <Wifi size={20} />
        </div>
        <dl className="info-list">
          <div>
            <dt>Relay</dt>
            <dd>
              <code>{s.relayUrl ?? "Starting…"}</code>
            </dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{s.relayConnected ? "Connected" : "Reconnecting automatically"}</dd>
          </div>
        </dl>
        <p className="field-hint">
          Keep this browser tab and the Butter Chicken terminal open to stay connected. Closing the tab disconnects; reopening it asks for your passphrase.
        </p>
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
          <button className="button secondary" onClick={() => confirm("history")}>
            Delete history
          </button>
        </div>
        <div className="setting-row">
          <div>
            <strong>Reset identity</strong>
            <p>Delete local keys, history and trust. Your friend must pair again.</p>
          </div>
          <button className="button danger-button" onClick={() => confirm("reset")}>
            Reset this device
          </button>
        </div>
      </div>
      <div className="small-note">
        <ShieldCheck size={15} />
        No recovery account. Keep your passphrase safe; a reset cannot recover an old conversation.
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

function RecoveryKeyDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  let code = "";
  try {
    code = engine.recoveryCode();
  } catch {
    // The parent hides this dialog while locked.
  }
  return (
    <dialog
      className="confirm-dialog card recovery-dialog"
      ref={ref}
      aria-labelledby="recovery-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="card-icon">
        <KeyRound size={24} />
      </div>
      <h3 id="recovery-title">Save your recovery key</h3>
      <p>
        If you forget your passphrase, this key can set a new one without
        deleting your identity or history. It is shown only on this device.
        Store it somewhere private and separate from this computer.
      </p>
      <code className="recovery-code">{code}</code>
      <ActionError message={error} />
      <div className="inline-actions">
        <button
          className="button secondary"
          onClick={() => {
            if (!navigator.clipboard?.writeText) {
              setError("Clipboard unavailable. Select and copy the key manually.");
              return;
            }
            void navigator.clipboard
              .writeText(code)
              .then(() => setError(""))
              .catch(() => setError("Copy failed. Select and copy the key manually."));
          }}
        >
          Copy key
        </button>
        <button className="button primary" onClick={onClose}>
          Continue
        </button>
      </div>
    </dialog>
  );
}

function GroupDialog({ friends, onClose, onCreate }: { friends: { public: { id: string }; displayName: string }[]; onClose: () => void; onCreate: (name: string, members: string[]) => Promise<void>; }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { ref.current?.showModal(); return () => ref.current?.close(); }, []);
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <dialog className="confirm-dialog card" ref={ref} aria-labelledby="group-title" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <h3 id="group-title">Create a group</h3>
      <p>Create a group chat with 3+ people total. Select at least two contacts. For a shared room, all members should pair with each other.</p>
      <label>Group name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Weekend plans" /></label>
      <div style={{marginTop: "12px"}}><strong>Members</strong>
        {friends.map((f) => (
          <label key={f.public.id} className="checkbox-label" style={{margin: "8px 0"}}>
            <input type="checkbox" checked={selected.includes(f.public.id)} onChange={() => toggle(f.public.id)} />{f.displayName}
          </label>
        ))}
      </div>
      <ActionError message={error} />
      <div className="inline-actions">
        <button onClick={onClose} disabled={busy}>Cancel</button>
        <button className="button primary" disabled={busy || !name.trim() || selected.length < 2} onClick={async () => { setBusy(true); setError(""); try { await onCreate(name, selected); } catch (e) { setError(e instanceof Error ? e.message : "Could not create group"); setBusy(false); } }}>{busy ? "Creating..." : "Create group"}</button>
      </div>
    </dialog>
  );
}

function ConfirmDialog({
  kind,
  close,
  selectedPeerId,
}: {
  kind: ConfirmKind;
  close: () => void;
  selectedPeerId?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const expected = kind === "reset" ? "RESET" : kind === "unpair" ? "REMOVE" : "";
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
      "Remove this contact?",
      "This removes the contact and deletes this device's conversation with them. Pair again with a new code to chat.",
    ],
    reset: [
      "Reset this device’s identity?",
      "This permanently deletes the local vault, private keys, conversation and pairing. Your friend will see a different identity. Create a new identity and pair again.",
    ],
  };
  const apply = async () => {
    setBusy(true);
    try {
      if (kind === "reset") await engine.resetIdentity();
      else if (kind === "unpair") await engine.removeFriend(selectedPeerId);
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
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <h3 id="confirm-title">{descriptions[kind][0]}</h3>
      <p>{descriptions[kind][1]}</p>
      {expected ? (
        <label>
          Type {expected} to confirm
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </label>
      ) : null}
      <ActionError message={error} />
      <div className="inline-actions">
        <button onClick={close} disabled={busy}>
          Cancel
        </button>
        <button
          className="danger-button"
          disabled={busy || (expected !== "" && typed !== expected)}
          onClick={() => void apply()}
        >
          {busy ? "Working…" : "Confirm"}
        </button>
      </div>
    </dialog>
  );
}
