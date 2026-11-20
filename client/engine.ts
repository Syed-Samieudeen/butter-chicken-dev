import sodium from "libsodium-wrappers-sumo";
import { authInput, pinInput, signed } from "../shared/relay.js";
import { z } from "zod";
import {
  FrameSchema,
  type ConnectionState,
  type Envelope,
  type Frame,
  type Hello,
  type PublicIdentity,
  type ServerEvent,
} from "../shared/protocol.js";
import type { Backend, Bootstrap, LocalSocket } from "./api";
import {
  archiveMessage,
  bytes,
  base64,
  cryptoReady,
  createVault,
  makeHello,
  makeInvitation,
  openArchive,
  openEnvelope,
  openLocal,
  parseInvitation,
  PrivatePayloadSchema,
  randomChallenge,
  randomId,
  sameIdentity,
  sealEnvelope,
  sealVault,
  securityCode,
  tokenMatches,
  unlockVault,
  validateIdentity,
  vaultAAD,
  verifyHello,
  verifyPassphrase,
  wipe,
  type ChatMessage,
  type Friend,
  type Invitation,
  type UnlockedVault,
} from "./crypto";

/** The screen locks after this much inactivity. Connections stay up while locked. */
export const IDLE_LOCK_MS = 10 * 60_000;

let audioCtx: AudioContext | undefined;
function notifyIncoming(): void {
  try {
    if (typeof window === "undefined") return;
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    audioCtx ??= new Ctx();
    if (audioCtx.state === "suspended") void audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.06, audioCtx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.22);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.24);
  } catch {
    // Notification sound is best-effort.
  }
}

const MailPayload = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("mail-chat"),
      pairId: z.string().regex(/^[a-f0-9]{32}$/),
      sequence: z.number().int().positive().safe(),
      text: z.string().min(1).max(8000),
      replyTo: z.string().regex(/^[a-f0-9]{32}$/).optional(),
      replyPreview: z.string().min(1).max(200).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("mail-receipt"),
      pairId: z.string().regex(/^[a-f0-9]{32}$/),
      messageId: z.string().regex(/^[a-f0-9]{32}$/),
      state: z.enum(["DELIVERED", "READ"]),
    })
    .strict(),
]);
const context = {
  senderChallenge: z.string().length(43),
  recipientChallenge: z.string().length(43),
};
const Payload = z.discriminatedUnion("type", [
  z
    .object({
      ...context,
      type: z.literal("auth"),
      name: z
        .string()
        .min(1)
        .max(40)
        .regex(/^[^\u0000-\u001f\u007f]+$/u),
      inviteId: z
        .string()
        .regex(/^[a-f0-9]{32}$/)
        .optional(),
      token: z.string().length(43).optional(),
    })
    .strict(),
  z.object({ ...context, type: z.literal("ready") }).strict(),
  z
    .object({
      ...context,
      type: z.literal("verify"),
      inviteId: z.string().regex(/^[a-f0-9]{32}$/),
    })
    .strict(),
  z
    .object({
      ...context,
      type: z.literal("chat"),
      text: z.string().min(1).max(8000),
      replyTo: z.string().regex(/^[a-f0-9]{32}$/).optional(),
      replyPreview: z.string().min(1).max(200).optional(),
    })
    .strict(),
  z
    .object({
      ...context,
      type: z.literal("ack"),
      messageId: z.string().regex(/^[a-f0-9]{32}$/),
    })
    .strict(),
  z.object({ ...context, type: z.literal("ping") }).strict(),
  z.object({ ...context, type: z.literal("pong") }).strict(),
]);
type Session = {
  id: string;
  challenge: string;
  hello?: Hello;
  expected?: PublicIdentity;
  invitation?: Invitation;
  outbound: boolean;
  remoteName?: string;
  auth: boolean;
  ready: boolean;
  localVerified: boolean;
  remoteVerified: boolean;
  inviteId?: string;
  expires?: number;
  opened: number;
  lastAuthenticated: number;
  controls: Set<string>;
};
export interface PendingPair {
  displayName: string;
  identity: PublicIdentity;
  code: string;
  localVerified: boolean;
  remoteVerified: boolean;
}
export interface Snapshot {
  mode: "loading" | "new" | "locked" | "ready";
  /** The screen is locked after inactivity. The relay connection is still active. */
  locked: boolean;
  state: ConnectionState;
  self?: { displayName: string; public: PublicIdentity };
  friend?: Friend;
  messages: ChatMessage[];
  relayUrl?: string;
  relayConnected?: boolean;
  path?: "INTERNET" | "OFFLINE";
  invitation?: { code?: string; expires: number };
  joining?: boolean;
  pending?: PendingPair;
  notice?: string;
  warning?: string;
  lastSeen?: string;
}

/** All encryption, key possession checks and trust decisions happen in this browser module. */
export class ChatEngine {
  private relayUrl = "";
  private relayReady = false;
  private relayPaired = false;
  private relayFailures = 0;
  private relayNext = 0;
  private relaySessions = new Set<string>();
  private relayPolling = 0;
  private readSent = new Map<string, number>();
  private unlocked?: UnlockedVault;
  private transport?: LocalSocket;
  private sessions = new Map<string, Session>();
  private requests = new Map<
    string,
    { expected?: PublicIdentity; invitation?: Invitation; at: number }
  >();
  private active?: string;
  private candidate?: string;
  private invitation?: { invitation: Invitation; code?: string };
  private invitationUsed = false;
  private history: ChatMessage[] = [];
  private uiLocked = false;
  private lastActivity = Date.now();
  private listeners = new Set<() => void>();
  private queue: Promise<void> = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private idleTimer?: ReturnType<typeof setInterval>;
  private lastConnect = 0;
  private lastPing = 0;
  private epoch = 0;
  private snapshot: Snapshot = {
    mode: "loading",
    locked: false,
    state: "DISCONNECTED",
    messages: [],
  };
  constructor(readonly api: Backend) {}

  getSnapshot = (): Snapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(patch: Partial<Snapshot> = {}): void {
    const next = { ...this.snapshot, ...patch };
    if (this.uiLocked) {
      // Message text and codes stay hidden while the screen is locked. Names and connection state remain for navigation.
      next.messages = [];
      next.invitation = undefined;
      next.pending = undefined;
    }
    next.locked = this.uiLocked;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
  private visibleMessages(): ChatMessage[] {
    return this.uiLocked ? [] : this.history;
  }
  private pendingFromCandidate(): PendingPair | undefined {
    const session = this.candidate ? this.sessions.get(this.candidate) : undefined;
    if (!session?.hello || !session.remoteName || !this.unlocked) return undefined;
    return {
      identity: session.hello.identity,
      displayName: session.remoteName,
      code: securityCode(this.unlocked.identity.public, session.hello.identity),
      localVerified: session.localVerified,
      remoteVerified: session.remoteVerified,
    };
  }
  private showFullView(): void {
    const u = this.unlocked;
    if (!u) return;
    this.publish({
      locked: false,
      self: { displayName: u.identity.displayName, public: u.identity.public },
      friend: u.friend,
      messages: this.history,
      invitation: this.invitation
        ? { code: this.invitation.code, expires: this.invitation.invitation.expires }
        : undefined,
      pending: this.pendingFromCandidate(),
    });
  }

  async init(): Promise<void> {
    await cryptoReady;
    const boot: Bootstrap = await this.api.bootstrap();
    this.relayUrl = boot.relayUrl;
    if (boot.hasVault) {
      try {
        const sessionKeyB64 =
          typeof sessionStorage !== "undefined"
            ? sessionStorage.getItem("bc:v1:sessionKey")
            : null;
        const sessionSalt =
          typeof sessionStorage !== "undefined"
            ? sessionStorage.getItem("bc:v1:salt")
            : null;
        if (sessionKeyB64 && sessionSalt) {
          const key = bytes(sessionKeyB64);
          const vault = await this.api.vault();
          if (vault && vault.salt === sessionSalt) {
            const payload = PrivatePayloadSchema.parse(
              openLocal(key, vault.data, vaultAAD(vault.salt)),
            );
            const publicIdentity = validateIdentity(payload.identity.public);
            const boxSecret = bytes(payload.identity.boxSecret, 32);
            const signSecret = bytes(payload.identity.signSecret, 64);
            const archiveKey = bytes(payload.identity.archiveKey, 32);
            if (
              base64(sodium.crypto_scalarmult_base(boxSecret)) ===
                publicIdentity.boxKey &&
              base64(sodium.crypto_sign_ed25519_sk_to_pk(signSecret)) ===
                publicIdentity.signKey
            ) {
              if (payload.friend) validateIdentity(payload.friend.public);
              this.unlocked = {
                identity: {
                  public: publicIdentity,
                  displayName: payload.identity.displayName,
                  boxSecret,
                  signSecret,
                  archiveKey,
                  sequence: payload.identity.sequence ?? 0,
                },
                key,
                salt: vault.salt,
                friend: payload.friend,
              };
              this.publish({ mode: "ready", relayUrl: this.relayUrl });
              await this.activate();
              return;
            }
          }
        }
      } catch {
        try {
          sessionStorage.removeItem("bc:v1:sessionKey");
          sessionStorage.removeItem("bc:v1:salt");
        } catch {}
      }
    }
    this.publish({
      mode: boot.hasVault ? "locked" : "new",
      state: "DISCONNECTED",
      relayUrl: this.relayUrl,
    });
  }
  async create(name: string, passphrase: string): Promise<void> {
    if (this.unlocked || this.snapshot.mode !== "new")
      throw new Error("An identity already exists");
    const epoch = this.epoch;
    const { unlocked, vault } = await createVault(name, passphrase);
    if (epoch !== this.epoch) {
      wipe(unlocked);
      throw new Error("Session changed. Unlock again.");
    }
    try {
      await this.api.saveVault(vault, true);
    } catch (error) {
      wipe(unlocked);
      throw error;
    }
    if (epoch !== this.epoch) {
      wipe(unlocked);
      throw new Error("Session changed. Unlock again.");
    }
    this.unlocked = unlocked;
    try {
      sessionStorage.setItem("bc:v1:sessionKey", base64(unlocked.key));
      sessionStorage.setItem("bc:v1:salt", unlocked.salt);
    } catch {}
    await this.activate();
  }
  async unlock(passphrase: string): Promise<void> {
    if (this.unlocked && this.uiLocked) return this.unlockScreen(passphrase);
    if (this.unlocked) throw new Error("Identity already unlocked");
    const epoch = this.epoch;
    const vault = await this.api.vault();
    if (!vault) throw new Error("No identity found");
    const unlocked = await unlockVault(vault, passphrase);
    if (epoch !== this.epoch) {
      wipe(unlocked);
      throw new Error("Session changed. Unlock again.");
    }
    this.unlocked = unlocked;
    try {
      sessionStorage.setItem("bc:v1:sessionKey", base64(unlocked.key));
      sessionStorage.setItem("bc:v1:salt", unlocked.salt);
    } catch {}
    try {
      await this.activate();
    } catch (error) {
      this.lock();
      throw error;
    }
  }
  /** Re-checks the passphrase after the idle lock. Keys already in memory keep the connection alive. */
  async unlockScreen(passphrase: string): Promise<void> {
    const u = this.unlocked;
    if (!u) throw new Error("No identity found");
    if (!(await verifyPassphrase(u, passphrase)))
      throw new Error("That passphrase is not correct.");
    if (this.unlocked !== u) throw new Error("Session changed. Unlock again.");
    this.uiLocked = false;
    this.lastActivity = Date.now();
    this.showFullView();
    this.publish({ notice: undefined });
  }
  /** Locks the screen only. Messages stay encrypted in memory and the relay connection stays up. */
  lockScreen(): void {
    if (!this.unlocked || this.uiLocked) return;
    this.uiLocked = true;
    this.publish({});
  }
  touch(): void {
    this.lastActivity = Date.now();
  }
  private async activate(): Promise<void> {
    const u = this.unlocked!;
    const rows = await this.api.history();
    if (this.unlocked !== u) throw new Error("Vault locked");
    this.history = rows
      .map((row) => openArchive(u.identity, row))
      .filter((m) => !u.friend || m.peerId === u.friend.public.id);
    this.uiLocked = false;
    this.lastActivity = Date.now();
    this.publish({
      mode: "ready",
      relayUrl: this.relayUrl,
      state: u.friend ? "DISCONNECTED" : "PAIRING_REQUIRED",
      notice: undefined,
      warning: undefined,
    });
    this.showFullView();
    const epoch = this.epoch;
    let queuedEvents = 0;
    const transport = await this.api.socket(
      (event) => {
        if (this.epoch !== epoch) return;
        if (queuedEvents >= 128) {
          this.lock();
          this.publish({
            notice:
              "Network processing limit reached. This vault was locked to protect local resources. Unlock to reconnect.",
          });
          return;
        }
        queuedEvents++;
        this.queue = this.queue
          .then(() => {
            if (this.epoch === epoch) return this.handleEvent(event);
          })
          .catch(() => {
            if (this.epoch === epoch)
              this.publish({
                notice: "An invalid or unauthenticated packet was rejected.",
              });
          })
          .finally(() => {
            queuedEvents--;
          });
      },
      () => {
        if (this.unlocked === u && this.epoch === epoch) {
          this.active = undefined;
          this.sessions.clear();
          this.requests.clear();
          this.publish({
            state: "DISCONNECTED",
            relayConnected: false,
            path: "OFFLINE",
            notice:
              "The local service stopped. Keep the Butter Chicken terminal running, then reload this page.",
          });
        }
      },
    );
    if (this.unlocked !== u || this.epoch !== epoch) {
      transport.close();
      throw new Error("Vault locked");
    }
    this.transport = transport;
    this.openRelay();
    let tickPending = false;
    this.timer = setInterval(() => {
      if (tickPending || this.epoch !== epoch) return;
      tickPending = true;
      this.queue = this.queue
        .then(() => {
          if (this.epoch === epoch) return this.tick();
        })
        .catch(() =>
          this.publish({
            notice: "The connection could not be refreshed. Trying again.",
          }),
        )
        .finally(() => {
          tickPending = false;
        });
    }, 5000);
    this.timer.unref?.();
    clearInterval(this.idleTimer);
    this.idleTimer = setInterval(() => {
      if (this.epoch !== epoch) return;
      if (!this.uiLocked && Date.now() - this.lastActivity > IDLE_LOCK_MS)
        this.lockScreen();
    }, 15_000);
    this.idleTimer.unref?.();
  }
  /** Full sign-out for this browser: wipes keys from memory and closes the relay connection. */
  lock(): void {
    this.epoch++;
    this.relayReady = false;
    this.relayPaired = false;
    this.relaySessions.clear();
    this.readSent.clear();
    clearInterval(this.timer);
    clearInterval(this.idleTimer);
    this.timer = undefined;
    this.idleTimer = undefined;
    if (this.unlocked) wipe(this.unlocked);
    this.unlocked = undefined;
    this.transport?.close();
    this.transport = undefined;
    this.sessions.clear();
    this.requests.clear();
    this.history = [];
    this.active = undefined;
    this.candidate = undefined;
    this.invitation = undefined;
    this.uiLocked = false;
    this.publish({
      mode: "locked",
      path: "OFFLINE",
      relayConnected: false,
      self: undefined,
      friend: undefined,
      messages: [],
      pending: undefined,
      invitation: undefined,
      state: "DISCONNECTED",
      warning: undefined,
      notice: undefined,
    });
  }
  private command(value: unknown): void {
    if (this.transport?.readyState !== 1)
      throw new Error("The local service is not running.");
    this.transport.send(JSON.stringify(value));
  }
  private relayCommand(packet: unknown): void {
    this.command({ type: "relay-send", packet });
  }
  private sendFrame(id: string, frame: Frame): void {
    this.relayCommand({ type: "frame", connectionId: id, frame });
  }
  private send(
    session: Session,
    payload: Record<string, unknown>,
    id?: string,
    timestamp?: string,
  ): void {
    if (!this.unlocked || !session.hello) throw new Error("Not authenticated");
    this.sendFrame(
      session.id,
      sealEnvelope(
        this.unlocked.identity,
        session.hello.identity,
        {
          ...payload,
          senderChallenge: session.challenge,
          recipientChallenge: session.hello.challenge,
        },
        id,
        timestamp,
      ),
    );
  }
  private drop(id: string): void {
    try {
      this.relayCommand({ type: "drop", connectionId: id });
    } catch {}
    this.endSession(id);
  }
  private endSession(id: string): void {
    this.relaySessions.delete(id);
    this.sessions.delete(id);
    if (this.candidate === id) {
      this.candidate = undefined;
      this.publish({
        pending: undefined,
        notice:
          "Pairing disconnected. Create a new code and try again.",
      });
    }
    if (this.active === id) {
      this.active = undefined;
      this.publish({
        state: this.snapshot.warning ? "IDENTITY_CHANGED" : "DISCONNECTED",
        path: "OFFLINE",
      });
    }
  }
  /** Creates a 6-digit pairing code for this identity. The relay stores the signed invitation for ten minutes. */
  async invite(): Promise<void> {
    if (!this.unlocked || this.unlocked.friend)
      throw new Error("Remove the existing trusted device before pairing again.");
    if (!this.relayReady)
      throw new Error("Connecting to the relay. Try again in a moment.");
    this.cancelPairing();
    const { invitation, text } = makeInvitation(
      this.unlocked.identity,
      this.relayUrl,
    );
    this.invitation = { invitation };
    this.invitationUsed = false;
    this.relayCommand({ type: "pair-create", invitation: text });
    this.publish({
      invitation: { expires: invitation.expires },
      state: "PAIRING_REQUIRED",
      notice: undefined,
    });
  }
  /** Joins a friend's pairing with the 6-digit code. Trust still needs the safety-code check. */
  async join(code: string): Promise<void> {
    if (!this.unlocked || this.unlocked.friend)
      throw new Error("Remove the existing trusted device before pairing again.");
    const digits = code.trim();
    if (!/^\d{6}$/.test(digits))
      throw new Error("Enter the 6-digit code from your friend.");
    if (!this.relayReady)
      throw new Error("Connecting to the relay. Try again in a moment.");
    this.cancelPairing();
    this.publish({ joining: true, notice: undefined });
    this.relayCommand({ type: "pair-join", code: digits });
  }
  private async onPairOffer(text: string): Promise<void> {
    this.publish({ joining: false });
    const invitation = parseInvitation(text);
    if (invitation.relayUrl !== this.relayUrl)
      throw new Error(
        "Your friend is using a different relay. Both computers must use the same relay.",
      );
    if (sameIdentity(invitation.identity, this.unlocked!.identity.public))
      throw new Error("Use the code from your friend’s device.");
    this.connectInternal(invitation.identity, invitation);
  }
  cancelPairing(): void {
    for (const session of this.sessions.values())
      if (session.id !== this.active) this.drop(session.id);
    if (this.invitation && this.relayReady) {
      try {
        this.relayCommand({ type: "pair-cancel" });
      } catch {}
    }
    this.requests.clear();
    this.invitation = undefined;
    this.invitationUsed = false;
    this.candidate = undefined;
    this.publish({
      invitation: undefined,
      pending: undefined,
      joining: false,
      state: this.active
        ? "CONNECTED"
        : this.unlocked?.friend
          ? "DISCONNECTED"
          : "PAIRING_REQUIRED",
    });
  }
  private connectInternal(
    expected: PublicIdentity,
    invitation?: Invitation,
  ): void {
    const requestId = randomId();
    this.requests.set(requestId, { expected, invitation, at: Date.now() });
    this.lastConnect = Date.now();
    this.relayCommand({ type: "link", peerId: expected.id, requestId });
    this.publish({ state: "CONNECTING", notice: undefined });
  }
  private async handleEvent(event: ServerEvent): Promise<void> {
    if (!this.unlocked) return;
    if (event.type === "relay") return this.handleRelay(event.packet);
    if (event.type === "relay-close") return this.onRelayClosed();
    if (event.type === "error")
      this.publish({ notice: "The local service rejected a request." });
  }
  private onRelayClosed(): void {
    this.relayReady = false;
    this.relayPaired = false;
    this.relayFailures = Math.min(this.relayFailures + 1, 6);
    this.relayNext =
      Date.now() +
      Math.min(60000, 1000 * 2 ** this.relayFailures) +
      Math.random() * 1000;
    for (const id of [...this.relaySessions]) this.endSession(id);
    this.relaySessions.clear();
    this.publish({ relayConnected: false, path: "OFFLINE" });
  }
  private onHello(session: Session, input: Hello): void {
    const hello = verifyHello(input);
    if (session.hello || hello.identity.id === this.unlocked!.identity.public.id)
      throw new Error("Unexpected identity");
    const expected = session.expected ?? this.unlocked!.friend?.public;
    if (expected && !sameIdentity(expected, hello.identity)) {
      if (session.outbound)
        this.publish({
          state: "IDENTITY_CHANGED",
          warning:
            "The device at this code has a different identity from your trusted friend. Disconnect and verify with your friend before removing the existing pairing.",
        });
      else
        this.publish({
          notice: "An unknown device tried to connect. It was not trusted.",
        });
      this.drop(session.id);
      return;
    }
    if (
      !this.unlocked!.friend &&
      !session.invitation &&
      (!this.invitation ||
        this.invitationUsed ||
        this.invitation.invitation.expires < Date.now())
    ) {
      this.publish({
        notice:
          "Unknown device ignored. Create a code if you want to pair.",
      });
      this.drop(session.id);
      return;
    }
    session.hello = hello;
    if (this.unlocked!.friend || session.invitation) this.sendAuth(session);
  }
  private sendAuth(session: Session): void {
    const invite = session.invitation;
    this.send(session, {
      type: "auth",
      name: this.unlocked!.identity.displayName,
      ...(invite
        ? { inviteId: invite.inviteId, token: invite.token }
        : session.inviteId
          ? { inviteId: session.inviteId }
          : {}),
    });
  }
  private async onBox(session: Session, frame: Envelope): Promise<void> {
    const u = this.unlocked!;
    if (!session.hello) throw new Error("Handshake required");
    const opened = openEnvelope(u.identity, session.hello.identity, frame);
    if (
      this.active === session.id &&
      u.friend &&
      MailPayload.safeParse(opened.payload).success
    ) {
      await this.receiveMail(frame);
      return;
    }
    const payload = Payload.parse(opened.payload);
    if (
      payload.recipientChallenge !== session.challenge ||
      payload.senderChallenge !== session.hello.challenge
    )
      throw new Error("Replayed connection");
    session.lastAuthenticated = Date.now();
    if (payload.type !== "chat") {
      if (session.controls.has(frame.messageId)) return;
      if (session.controls.size >= 20_000) throw new Error("Reconnect required");
      session.controls.add(frame.messageId);
    }
    if (payload.type === "auth") {
      if (session.auth) throw new Error("Repeated authentication");
      if (!u.friend) {
        if (session.invitation) {
          if (payload.inviteId !== session.invitation.inviteId || payload.token)
            throw new Error("Unexpected pairing response");
          session.inviteId = session.invitation.inviteId;
          session.expires = session.invitation.expires;
        } else {
          const invite = this.invitation?.invitation;
          if (
            !invite ||
            this.invitationUsed ||
            invite.expires < Date.now() ||
            payload.inviteId !== invite.inviteId ||
            !payload.token ||
            !tokenMatches(payload.token, invite.token)
          )
            throw new Error("Wrong or reused code");
          this.invitationUsed = true;
          session.inviteId = invite.inviteId;
          session.expires = invite.expires;
          this.publish({ invitation: undefined });
          this.sendAuth(session);
        }
      } else if (payload.token || payload.inviteId)
        throw new Error("Unexpected pairing");
      session.auth = true;
      session.remoteName = payload.name;
      this.send(session, { type: "ready" });
      return;
    }
    if (!session.auth) throw new Error("Authentication required");
    if (payload.type === "ready") {
      session.ready = true;
      if (u.friend) await this.connected(session);
      else {
        if (this.candidate && this.candidate !== session.id)
          throw new Error("Pairing already in progress");
        this.candidate = session.id;
        this.publishPending(session);
      }
      return;
    }
    if (!session.ready) throw new Error("Mutual authentication required");
    if (payload.type === "verify") {
      if (
        !session.inviteId ||
        session.inviteId !== payload.inviteId ||
        (session.expires ?? 0) < Date.now()
      )
        throw new Error("Pairing expired");
      session.remoteVerified = true;
      this.publishPending(session);
      await this.completePair(session);
      return;
    }
    if (this.active !== session.id || !u.friend)
      throw new Error("Trust required");
    if (payload.type === "chat") {
      if (new TextEncoder().encode(payload.text).length > 32_000)
        throw new Error("Message too large");
      const message = {
        id: frame.messageId,
        peerId: session.hello.identity.id,
        from: "friend" as const,
        text: payload.text,
        sentAt: frame.timestamp,
        receivedAt: new Date().toISOString(),
        ...(payload.replyTo && payload.replyPreview
          ? { replyTo: payload.replyTo, replyPreview: payload.replyPreview }
          : {}),
      };
      const inserted = await this.api.receive(
        archiveMessage(u.identity, message.peerId, message, true),
      );
      if (this.unlocked !== u || this.sessions.get(session.id) !== session)
        return;
      if (inserted) {
        this.history = [...this.history, { ...message, delivered: true }];
        this.publish({ messages: this.visibleMessages() });
        notifyIncoming();
      }
      // Duplicate retransmissions are acknowledged, but never inserted or displayed twice.
      this.send(session, { type: "ack", messageId: frame.messageId });
    } else if (payload.type === "ack") {
      const message = this.history.find(
        (x) =>
          x.id === payload.messageId &&
          x.from === "me" &&
          x.peerId === session.hello!.identity.id,
      );
      if (message && !message.delivered) {
        await this.api.delivered(message.id);
        if (this.unlocked !== u || this.sessions.get(session.id) !== session)
          return;
        this.history = this.history.map((x) =>
          x.id === message.id ? { ...x, delivered: true } : x,
        );
        this.publish({ messages: this.visibleMessages() });
      }
    } else if (payload.type === "ping") this.send(session, { type: "pong" });
  }
  private publishPending(session: Session): void {
    this.publish({
      pending: {
        identity: session.hello!.identity,
        displayName: session.remoteName!,
        code: securityCode(this.unlocked!.identity.public, session.hello!.identity),
        localVerified: session.localVerified,
        remoteVerified: session.remoteVerified,
      },
      state: "AUTHENTICATING",
    });
  }
  async verifyPairing(): Promise<void> {
    const session = this.candidate ? this.sessions.get(this.candidate) : undefined;
    if (!session?.auth || !session.ready || (session.expires ?? 0) < Date.now())
      throw new Error("No active pairing. Create a new code.");
    if (session.localVerified) return;
    session.localVerified = true;
    this.send(session, { type: "verify", inviteId: session.inviteId });
    this.publishPending(session);
    await this.completePair(session);
  }
  private async completePair(session: Session): Promise<void> {
    if (!session.localVerified || !session.remoteVerified || this.unlocked!.friend)
      return;
    const u = this.unlocked!;
    const now = new Date().toISOString();
    u.friend = {
      public: session.hello!.identity,
      displayName: session.remoteName!,
      trustedSince: now,
      verifiedAt: now,
      pairId: session.inviteId,
      lastSeen: now,
    };
    try {
      await this.api.saveVault(sealVault(u));
    } catch (error) {
      if (this.unlocked === u) u.friend = undefined;
      throw error;
    }
    if (this.unlocked !== u || this.sessions.get(session.id) !== session) return;
    this.invitation = undefined;
    this.candidate = undefined;
    this.publish({
      invitation: undefined,
      pending: undefined,
      friend: u.friend,
    });
    this.pinRelay();
    await this.connected(session);
  }
  private async connected(session: Session): Promise<void> {
    const u = this.unlocked!;
    if (this.active && this.active !== session.id) {
      this.drop(session.id);
      return;
    }
    this.active = session.id;
    const friend = u.friend!;
    u.friend = { ...friend, lastSeen: new Date().toISOString() };
    await this.api.saveVault(sealVault(u));
    if (this.unlocked !== u || this.sessions.get(session.id) !== session) return;
    this.publish({
      state: "CONNECTED",
      path: "INTERNET",
      friend: u.friend,
      notice: undefined,
      warning: undefined,
    });
    this.flushPending(session);
  }
  async sendMessage(
    text: string,
    reply?: { id: string; text: string },
  ): Promise<void> {
    const u = this.unlocked;
    const session = this.active ? this.sessions.get(this.active) : undefined;
    const value = text.trim();
    if (!u?.friend)
      throw new Error("Pair with your friend before sending messages.");
    if (!u.friend.pairId)
      throw new Error("Pair again with the new 6-digit code to enable messaging.");
    if (!value || value.length > 8000 || new TextEncoder().encode(value).length > 32_000)
      throw new Error("Use 1 to 8000 characters, within 32 KB.");
    const replyTo = reply?.id?.match(/^[a-f0-9]{32}$/) ? reply.id : undefined;
    const replyPreview = replyTo
      ? reply!.text.replace(/\s+/g, " ").trim().slice(0, 200) || undefined
      : undefined;
    const id = randomId();
    const sentAt = new Date().toISOString();
    u.identity.sequence = (u.identity.sequence ?? 0) + 1;
    const sequence = u.identity.sequence;
    await this.api.saveVault(sealVault(u));
    const wire = sealEnvelope(
      u.identity,
      u.friend.public,
      {
        type: "mail-chat",
        pairId: u.friend.pairId,
        sequence,
        text: value,
        ...(replyTo && replyPreview ? { replyTo, replyPreview } : {}),
      },
      id,
      sentAt,
    );
    const message = {
      id,
      wire,
      sequence,
      peerId: u.friend.public.id,
      from: "me" as const,
      text: value,
      sentAt,
      ...(replyTo && replyPreview ? { replyTo, replyPreview } : {}),
    };
    await this.api.outgoing(
      archiveMessage(u.identity, message.peerId, message, false),
    );
    if (this.unlocked !== u)
      throw new Error(
        "The vault locked before sending. The encrypted pending message is retained locally.",
      );
    this.history = [...this.history, { ...message, delivered: false }];
    this.publish({ messages: this.visibleMessages() });
    this.transmitMail(wire);
  }
  private flushPending(session: Session): void {
    for (const message of this.history
      .filter(
        (x) =>
          x.from === "me" &&
          !x.delivered &&
          x.peerId === session.hello!.identity.id,
      )
      .slice(0, 50))
      if (message.wire) this.transmitMail(message.wire);
  }
  private openRelay(): void {
    this.relayNext = Date.now() + 10000;
    this.command({ type: "relay-open" });
  }
  private pinRelay(): void {
    const u = this.unlocked;
    if (!u || !this.relayReady || !u.friend?.pairId) return;
    this.relayCommand({
      type: "pin",
      peer: u.friend.public,
      pairId: u.friend.pairId,
      signature: signed(
        pinInput(u.identity.public, u.friend.public, u.friend.pairId),
        u.identity.signSecret,
      ),
    });
  }
  private async handleRelay(raw: unknown): Promise<void> {
    const p = z.object({ type: z.string() }).passthrough().parse(raw) as any;
    if (p.type === "challenge") {
      const challenge = z
        .string()
        .length(43)
        .regex(/^[A-Za-z0-9_-]+$/)
        .parse(p.challenge);
      this.relayCommand({
        type: "auth",
        identity: this.unlocked!.identity.public,
        signature: signed(
          authInput(challenge, this.unlocked!.identity.public, this.relayUrl),
          this.unlocked!.identity.signSecret,
        ),
      });
    } else if (p.type === "ready") {
      this.relayReady = true;
      this.relayFailures = 0;
      this.readSent.clear();
      this.publish({ relayConnected: true, path: this.active ? "INTERNET" : "OFFLINE" });
      if (!this.unlocked?.friend) this.relayCommand({ type: "unpin" });
      else this.pinRelay();
      if (this.unlocked?.friend && !this.active) this.reconnectFriend();
    } else if (p.type === "pair-code") {
      const code = z.string().regex(/^\d{6}$/).parse(p.code);
      if (this.invitation) this.invitation.code = code;
      this.publish({
        invitation: { code, expires: Number(p.expires) },
        notice: undefined,
      });
    } else if (p.type === "pair-offer") {
      await this.onPairOffer(z.string().max(3000).parse(p.invitation));
    } else if (p.type === "paired") {
      if (p.pairId !== this.unlocked?.friend?.pairId)
        throw Error("Wrong relay pairing");
      this.relayPaired = true;
      this.flushRelay();
    } else if (p.type === "peer-open") {
      const e = z
        .object({
          type: z.literal("peer-open"),
          connectionId: z.string().uuid(),
          outbound: z.boolean(),
          requestId: z
            .string()
            .regex(/^[a-f0-9]{32}$/)
            .optional(),
          address: z.literal("relay"),
          port: z.literal(0),
        })
        .strict()
        .parse(p);
      this.onPeerOpen(e);
    } else if (p.type === "frame") {
      const e = z
        .object({
          type: z.literal("frame"),
          connectionId: z.string().uuid(),
          frame: FrameSchema,
        })
        .strict()
        .parse(p);
      await this.onFrame(e.connectionId, e.frame);
    } else if (p.type === "peer-close") {
      this.endSession(z.string().uuid().parse(p.connectionId));
    } else if (p.type === "mail") {
      if (!this.relayPaired) return;
      await this.receiveMail(p.envelope);
    } else if (p.type === "accepted") {
      await this.updateReceipt(
        z.string().regex(/^[a-f0-9]{32}$/).parse(p.messageId),
        "SENT",
      );
    } else if (p.type === "rejected") {
      this.history = this.history.map((x) =>
        x.id === p.messageId && !x.delivered ? { ...x, state: "FAILED" } : x,
      );
      this.publish({
        messages: this.visibleMessages(),
        notice:
          "The relay queue is full. Your encrypted message stays on this computer and will retry.",
      });
    } else if (p.type === "error") {
      const requestId = typeof p.requestId === "string" ? p.requestId : undefined;
      if (requestId) this.requests.delete(requestId);
      if (p.code === "PAIR_NOT_FOUND")
        this.publish({
          joining: false,
          notice:
            "That 6-digit code is not valid or has expired. Check it with your friend and try again.",
        });
      else if (p.code === "PAIR_RATE_LIMITED")
        this.publish({
          joining: false,
          notice: "Too many wrong codes. Wait a minute, then try again.",
        });
      else if (p.code === "PEER_OFFLINE")
        this.publish({
          state: this.active ? this.snapshot.state : "DISCONNECTED",
          notice: this.active
            ? undefined
            : "Your friend is offline. Messages will be sent when they reconnect.",
        });
      else this.publish({ notice: "The relay could not complete that request." });
    }
  }
  private onPeerOpen(e: {
    connectionId: string;
    outbound: boolean;
    requestId?: string;
  }): void {
    if (this.relaySessions.size >= 8) throw Error("Relay link capacity");
    this.relaySessions.add(e.connectionId);
    const request = e.requestId ? this.requests.get(e.requestId) : undefined;
    if (e.requestId) this.requests.delete(e.requestId);
    const session: Session = {
      id: e.connectionId,
      outbound: e.outbound,
      expected: request?.expected,
      invitation: request?.invitation,
      challenge: randomChallenge(),
      auth: false,
      ready: false,
      localVerified: false,
      remoteVerified: false,
      opened: Date.now(),
      lastAuthenticated: Date.now(),
      controls: new Set(),
    };
    this.sessions.set(session.id, session);
    this.sendFrame(session.id, makeHello(this.unlocked!.identity, session.challenge));
    if (!this.active) this.publish({ state: "AUTHENTICATING" });
  }
  private async onFrame(connectionId: string, frame: Frame): Promise<void> {
    const session = this.sessions.get(connectionId);
    if (!session) return;
    try {
      if (frame.kind === "hello") return this.onHello(session, frame);
      await this.onBox(session, frame);
    } catch {
      this.drop(session.id);
      this.publish({
        notice:
          "This connection failed cryptographic verification. No message or trust change was accepted.",
      });
    }
  }
  private reconnectFriend(): void {
    const friend = this.unlocked?.friend;
    if (!friend) return;
    this.connectInternal(friend.public);
  }
  private flushRelay(): void {
    for (const m of this.history
      .filter((x) => x.from === "me" && !x.delivered && x.wire)
      .slice(0, 8))
      this.transmitMail(m.wire!);
  }
  private transmitMail(envelope: Envelope): void {
    if (!this.relayReady) return;
    const m = this.history.find((x) => x.id === envelope.messageId && x.from === "me");
    if (m && !m.delivered && (!m.state || ["QUEUED", "FAILED"].includes(m.state))) {
      this.history = this.history.map((x) =>
        x.id === m.id ? { ...x, state: "SENDING" as const } : x,
      );
      this.publish({ messages: this.visibleMessages() });
    }
    if (this.relayPaired)
      this.relayCommand({
        type: "mail",
        envelope,
        pairId: this.unlocked!.friend!.pairId,
      });
  }
  private async updateReceipt(
    id: string,
    state: "SENT" | "DELIVERED" | "READ",
  ): Promise<void> {
    const u = this.unlocked;
    const m = this.history.find((x) => x.id === id && x.from === "me");
    if (!m) return;
    const rank = {
      QUEUED: 0,
      SENDING: 1,
      SENT: 2,
      DELIVERED: 3,
      READ: 4,
      FAILED: -1,
    };
    if (rank[m.state ?? (m.delivered ? "DELIVERED" : "QUEUED")] >= rank[state])
      return;
    if (this.api.receipt) await this.api.receipt(id, state);
    else if (state !== "SENT") await this.api.delivered(id);
    if (this.unlocked !== u) return;
    this.history = this.history.map((x) =>
      x.id === id
        ? { ...x, state, delivered: state === "SENT" ? x.delivered : true }
        : x,
    );
    this.publish({ messages: this.visibleMessages() });
  }
  private async receiveMail(input: unknown): Promise<void> {
    const u = this.unlocked;
    if (!u?.friend?.pairId) return;
    const { envelope: e, payload: raw } = openEnvelope(u.identity, u.friend.public, input);
    const p = MailPayload.parse(raw);
    if (p.pairId !== u.friend.pairId) throw Error("Wrong pairing epoch");
    if (p.type === "mail-chat") {
      if (new TextEncoder().encode(p.text).length > 32000)
        throw Error("Message too large");
      const message = {
        id: e.messageId,
        peerId: u.friend.public.id,
        from: "friend" as const,
        text: p.text,
        sentAt: e.timestamp,
        receivedAt: new Date().toISOString(),
        sequence: p.sequence,
        ...(p.replyTo && p.replyPreview
          ? { replyTo: p.replyTo, replyPreview: p.replyPreview }
          : {}),
      };
      const inserted = await this.api.receive(
        archiveMessage(u.identity, message.peerId, message, true),
      );
      if (this.unlocked !== u) return;
      if (inserted) {
        const highest = this.history.reduce(
          (n, x) => (x.from === "friend" ? Math.max(n, x.sequence ?? 0) : n),
          u.friend.receivedSequence ?? 0,
        );
        u.friend.receivedSequence = Math.max(highest, p.sequence);
        await this.api.saveVault(sealVault(u));
        if (this.unlocked !== u) return;
        this.history = [...this.history, { ...message, delivered: true }];
        this.publish({
          messages: this.visibleMessages(),
          ...(p.sequence <= highest
            ? {
                notice:
                  "A delayed message arrived out of sequence. Its authenticated sequence is retained.",
              }
            : {}),
        });
        notifyIncoming();
      }
      this.sendMailReceipt(e.messageId, "DELIVERED");
    } else await this.updateReceipt(p.messageId, p.state);
    if (this.unlocked === u && this.relayPaired)
      this.relayCommand({
        type: "consume",
        senderId: e.senderId,
        messageId: e.messageId,
      });
  }
  private sendMailReceipt(messageId: string, state: "DELIVERED" | "READ"): void {
    const u = this.unlocked;
    if (!u?.friend?.pairId) return;
    this.transmitMail(
      sealEnvelope(u.identity, u.friend.public, {
        type: "mail-receipt",
        pairId: u.friend.pairId,
        messageId,
        state,
      }),
    );
  }
  /** Read receipts are sent only while the screen is unlocked and the window has focus. */
  markRead(): void {
    if (!this.unlocked?.friend || this.uiLocked || (!this.relayPaired && !this.active))
      return;
    for (const m of this.history
      .filter((x) => x.from === "friend" && x.sequence)
      .slice(-20)) {
      if (Date.now() - (this.readSent.get(m.id) ?? 0) < 30000) continue;
      this.sendMailReceipt(m.id, "READ");
      this.readSent.set(m.id, Date.now());
    }
    while (this.readSent.size > 128)
      this.readSent.delete(this.readSent.keys().next().value!);
  }
  private async tick(): Promise<void> {
    if (!this.unlocked || this.transport?.readyState !== 1) return;
    const now = Date.now();
    if (!this.relayReady && now >= this.relayNext) this.openRelay();
    if (this.relayPaired && now - this.relayPolling > 10000) {
      this.relayPolling = now;
      this.relayCommand({ type: "poll" });
      this.flushRelay();
    }
    for (const [id, request] of this.requests)
      if (now - request.at > 10_000) this.requests.delete(id);
    for (const session of this.sessions.values()) {
      if (
        (!session.ready && now - session.opened > 15_000) ||
        (session.id !== this.active && session.expires && session.expires < now)
      )
        this.drop(session.id);
    }
    if (this.invitation && this.invitation.invitation.expires < now) {
      this.cancelPairing();
      this.publish({ notice: "This code expired. Create a new code." });
    }
    const session = this.active ? this.sessions.get(this.active) : undefined;
    if (session) {
      if (now - session.lastAuthenticated > 35_000) {
        this.drop(session.id);
        return;
      }
      if (now - this.lastPing > 10_000) {
        this.send(session, { type: "ping" });
        this.lastPing = now;
      }
      this.flushPending(session);
    } else if (
      this.relayReady &&
      this.unlocked.friend &&
      !this.requests.size &&
      !this.sessions.size &&
      now - this.lastConnect > 8000
    ) {
      this.reconnectFriend();
    }
  }
  async clearHistory(): Promise<void> {
    const epoch = this.epoch;
    await this.api.clearHistory();
    if (this.epoch === epoch) {
      this.history = [];
      this.publish({
        messages: [],
        notice: "Local conversation deleted. Your friend’s copy is unchanged.",
      });
    }
  }
  async removeFriend(): Promise<void> {
    if (!this.unlocked) return;
    const u = this.unlocked;
    if (this.relayReady) this.relayCommand({ type: "unpin" });
    this.relayPaired = false;
    this.active = undefined;
    this.candidate = undefined;
    for (const id of [...this.sessions.keys()]) this.drop(id);
    this.sessions.clear();
    this.requests.clear();
    u.friend = undefined;
    await this.api.saveVault(sealVault(u));
    await this.api.clearHistory();
    if (this.unlocked !== u) return;
    this.history = [];
    this.publish({
      friend: undefined,
      pending: undefined,
      invitation: undefined,
      messages: [],
      warning: undefined,
      state: "PAIRING_REQUIRED",
      notice:
        "Trust and local conversation removed. Pair again with a new 6-digit code.",
    });
  }
  async resetIdentity(): Promise<void> {
    this.lock();
    await this.api.reset();
    this.publish({
      mode: "new",
      state: "PAIRING_REQUIRED",
    });
  }
  dismissNotice(): void {
    this.publish({ notice: undefined });
  }
  disconnect(): void {
    if (this.active) this.drop(this.active);
    for (const session of this.sessions.values()) this.drop(session.id);
  }
  dispose(): void {
    this.lock();
    this.listeners.clear();
  }
}
