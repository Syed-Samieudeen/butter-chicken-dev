import { authInput, pinInput, signed } from "../shared/relay.js";
import { z } from "zod";
import {
  FrameSchema,
  EndpointSchema,
  type ConnectionState,
  type DiscoveryDevice,
  type Endpoint,
  type Envelope,
  type Frame,
  type Hello,
  type PublicIdentity,
  type ServerEvent,
} from "../shared/protocol.js";
import type { Backend, Bootstrap, LocalSocket } from "./api";
import {
  archiveMessage,
  cryptoReady,
  createVault,
  makeHello,
  makeInvitation,
  openArchive,
  openEnvelope,
  parseInvitation,
  randomChallenge,
  randomId,
  sameIdentity,
  sealEnvelope,
  sealVault,
  securityCode,
  tokenMatches,
  unlockVault,
  verifyHello,
  wipe,
  type ChatMessage,
  type Friend,
  type Invitation,
  type UnlockedVault,
} from "./crypto";

const MailPayload = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("mail-chat"),
      pairId: z.string().regex(/^[a-f0-9]{32}$/),
      sequence: z.number().int().positive().safe(),
      text: z.string().min(1).max(8000),
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
      endpoint: EndpointSchema,
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
  address: string;
  remoteEndpoint?: Endpoint;
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
  state: ConnectionState;
  self?: { displayName: string; public: PublicIdentity };
  friend?: Friend;
  messages: ChatMessage[];
  network?: Bootstrap;
  devices: DiscoveryDevice[];
  invitation?: { code: string; expires: number };
  pending?: PendingPair;
  notice?: string;
  warning?: string;
  lastSeen?: string;
  path?: "LOCAL" | "INTERNET" | "OFFLINE";
  relayConnected?: boolean;
}

/** All encryption, key possession checks and trust decisions happen in this browser module. */
export class ChatEngine {
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
  private invitation?: Invitation;
  private invitationUsed = false;
  private listeners = new Set<() => void>();
  private queue: Promise<void> = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private lastConnect = 0;
  private lastPing = 0;
  private epoch = 0;
  private snapshot: Snapshot = {
    mode: "loading",
    state: "DISCOVERING",
    devices: [],
    messages: [],
  };
  constructor(readonly api: Backend) {}
  getSnapshot = (): Snapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(patch: Partial<Snapshot> = {}): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  async init(): Promise<void> {
    await cryptoReady;
    const network = await this.api.bootstrap();
    this.publish({
      mode: network.hasVault ? "locked" : "new",
      state: "PAIRING_REQUIRED",
      network,
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
    await this.activate();
  }
  async unlock(passphrase: string): Promise<void> {
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
      await this.activate();
    } catch (error) {
      this.lock();
      throw error;
    }
  }
  private async activate(): Promise<void> {
    const u = this.unlocked!;
    const rows = await this.api.history();
    if (this.unlocked !== u) throw new Error("Vault locked");
    const history = rows
      .map((row) => openArchive(u.identity, row))
      .filter((m) => !u.friend || m.peerId === u.friend.public.id);
    this.publish({
      mode: "ready",
      self: { displayName: u.identity.displayName, public: u.identity.public },
      friend: u.friend,
      messages: history,
      state: u.friend ? "DISCOVERING" : "PAIRING_REQUIRED",
      notice: undefined,
      warning: undefined,
    });
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
            if (this.epoch === epoch) return this.handle(event);
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
      (code) => {
        if (this.unlocked === u && this.epoch === epoch) {
          this.active = undefined;
          this.sessions.clear();
          this.requests.clear();
          this.publish({
            state: "DISCONNECTED",
            notice:
              code === 4009
                ? "This identity is already open in another tab. Close that tab, then unlock here."
                : "Local service disconnected. Restart it and reload this page.",
          });
        }
      },
    );
    if (this.unlocked !== u || this.epoch !== epoch) {
      transport.close();
      throw new Error("Vault locked");
    }
    this.transport = transport;
    if (this.snapshot.network?.relayUrl) this.openRelay();
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
            notice: "The connection could not be refreshed. Try reconnecting.",
          }),
        )
        .finally(() => {
          tickPending = false;
        });
    }, 5000);
    this.timer.unref?.();
  }
  lock(): void {
    this.epoch++;
    this.relayReady = false;
    this.relayPaired = false;
    this.relaySessions.clear();
    this.readSent.clear();
    clearInterval(this.timer);
    this.timer = undefined;
    if (this.unlocked) wipe(this.unlocked);
    this.unlocked = undefined;
    this.transport?.close();
    this.transport = undefined;
    this.sessions.clear();
    this.requests.clear();
    this.active = undefined;
    this.candidate = undefined;
    this.invitation = undefined;
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
      throw new Error("Local service is disconnected");
    this.transport.send(JSON.stringify(value));
  }
  private sendFrame(id: string, frame: Frame): void {
    this.command({ type: "send", connectionId: id, frame });
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
      this.command({ type: "disconnect", connectionId: id });
    } catch {}
    this.sessions.delete(id);
    if (this.candidate === id) {
      this.candidate = undefined;
      this.publish({ pending: undefined });
    }
    if (this.active === id) {
      this.active = undefined;
      this.publish({ state: "DISCONNECTED" });
    }
  }
  async invite(): Promise<void> {
    if (!this.unlocked || this.unlocked.friend)
      throw new Error(
        "Remove the existing trusted device before pairing again",
      );
    this.cancelPairing();
    const { invitation, code } = makeInvitation(
      this.unlocked.identity,
      this.snapshot.network!.endpoint,
      Date.now(),
      this.snapshot.network?.relayUrl,
    );
    this.invitation = invitation;
    this.invitationUsed = false;
    this.publish({
      invitation: { code, expires: invitation.expires },
      state: "PAIRING_REQUIRED",
      notice: undefined,
    });
  }
  async join(
    code: string,
    override?: { host: string; port: number },
  ): Promise<void> {
    if (!this.unlocked || this.unlocked.friend)
      throw new Error(
        "Remove the existing trusted device before pairing again",
      );
    const invitation = parseInvitation(code);
    if (
      invitation.relayUrl &&
      invitation.relayUrl !== this.snapshot.network?.relayUrl
    )
      throw new Error(
        "Configure the same relay URL as your friend before pairing. The signed invitation names a different relay.",
      );
    if (sameIdentity(invitation.identity, this.unlocked.identity.public))
      throw new Error("Use the invitation from your friend’s device");
    this.cancelPairing();
    this.connectInternal(
      {
        ...(override ?? invitation.endpoint),
        nodeId: invitation.endpoint.nodeId,
      },
      invitation.identity,
      invitation,
    );
  }
  cancelPairing(): void {
    for (const session of this.sessions.values())
      if (session.id !== this.active) this.drop(session.id);
    this.requests.clear();
    this.invitation = undefined;
    this.invitationUsed = false;
    this.candidate = undefined;
    this.publish({
      invitation: undefined,
      pending: undefined,
      state: this.active
        ? "CONNECTED"
        : this.unlocked?.friend
          ? "DISCONNECTED"
          : "PAIRING_REQUIRED",
    });
  }
  reconnect(host?: string, port?: number): void {
    if (!this.unlocked?.friend) throw new Error("Pair a trusted device first");
    if (this.active) this.drop(this.active);
    this.publish({ warning: undefined });
    const friend = this.unlocked.friend;
    const found = this.snapshot.devices.find(
      (x) => x.nodeId === friend.endpoint.nodeId,
    );
    this.connectInternal(
      {
        ...(found ?? friend.endpoint),
        ...(host ? { host, port: port ?? 4455 } : {}),
      },
      friend.public,
    );
  }
  private connectInternal(
    endpoint: Endpoint,
    expected?: PublicIdentity,
    invitation?: Invitation,
  ): void {
    const requestId = randomId();
    this.requests.set(requestId, { expected, invitation, at: Date.now() });
    this.lastConnect = Date.now();
    if (
      this.snapshot.network?.relayUrl &&
      this.relayReady &&
      expected &&
      !this.snapshot.devices.some((d) => d.nodeId === endpoint.nodeId)
    ) {
      this.relayCommand({ type: "link", peerId: expected.id, requestId });
      this.publish({ state: "CONNECTING" });
      return;
    }
    this.command({
      type: "connect",
      host: endpoint.host,
      port: endpoint.port,
      requestId,
    });
    this.publish({ state: "CONNECTING", notice: undefined });
  }
  private async handle(event: ServerEvent): Promise<void> {
    if (!this.unlocked) return;
    if (event.type === "relay-close") {
      this.relayReady = false;
      this.relayPaired = false;
      this.relayFailures = Math.min(this.relayFailures + 1, 6);
      this.relayNext =
        Date.now() +
        Math.min(60000, 1000 * 2 ** this.relayFailures) +
        Math.random() * 1000;
      for (const id of [...this.relaySessions])
        await this.handle({ type: "peer-close", connectionId: id });
      this.relaySessions.clear();
      this.publish({
        relayConnected: false,
        path: this.active ? "LOCAL" : "OFFLINE",
      });
      return;
    }
    if (event.type === "relay") {
      await this.handleRelay(event.packet);
      return;
    }
    if (event.type === "network") {
      const endpoint = EndpointSchema.parse(event.endpoint);
      this.publish({
        network: { ...this.snapshot.network!, endpoint },
        devices: event.devices.slice(0, 64).map((x) => ({
          ...EndpointSchema.parse(x),
          label: String(x.label).slice(0, 80),
        })),
      });
      return;
    }
    if (event.type === "error") {
      const failed = event.requestId
        ? this.requests.get(event.requestId)
        : undefined;
      if (failed?.expected && this.relayReady && event.requestId) {
        this.relayCommand({
          type: "link",
          peerId: failed.expected.id,
          requestId: event.requestId,
        });
        return;
      }
      if (event.requestId) this.requests.delete(event.requestId);
      if (!this.active)
        this.publish({
          state: this.unlocked.friend ? "DISCONNECTED" : "PAIRING_REQUIRED",
          notice:
            event.code === "LAN_ENDPOINT_REQUIRED"
              ? "Use a private LAN IPv4 address and the LAN port. Public internet connections are disabled."
              : "Could not reach that device. Check its address, LAN port, firewall and unlocked app.",
        });
      return;
    }
    if (event.type === "peer-close") {
      const wasActive = this.active === event.connectionId;
      this.relaySessions.delete(event.connectionId);
      this.sessions.delete(event.connectionId);
      if (this.candidate === event.connectionId) {
        this.candidate = undefined;
        this.publish({
          pending: undefined,
          notice:
            "Pairing disconnected. Create a new invitation and try again.",
        });
      }
      if (wasActive) {
        this.active = undefined;
        this.publish({
          state: this.snapshot.warning ? "IDENTITY_CHANGED" : "DISCONNECTED",
          path: this.relayReady ? "INTERNET" : "OFFLINE",
        });
      } else if (
        !this.active &&
        !this.candidate &&
        this.snapshot.state !== "IDENTITY_CHANGED"
      )
        this.publish({
          state: this.unlocked.friend ? "DISCONNECTED" : "PAIRING_REQUIRED",
        });
      return;
    }
    if (event.type === "peer-open") {
      const request = event.requestId
        ? this.requests.get(event.requestId)
        : undefined;
      if (event.requestId) this.requests.delete(event.requestId);
      const session: Session = {
        id: event.connectionId,
        outbound: event.outbound,
        address: event.address,
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
      this.sendFrame(
        session.id,
        makeHello(this.unlocked.identity, session.challenge),
      );
      if (!this.active) this.publish({ state: "AUTHENTICATING" });
      return;
    }
    const session = this.sessions.get(event.connectionId);
    if (!session) return;
    try {
      if (event.frame.kind === "hello")
        return this.onHello(session, event.frame);
      await this.onBox(session, event.frame);
    } catch {
      this.drop(session.id);
      this.publish({
        notice:
          "This connection failed cryptographic verification. No message or trust change was accepted.",
      });
    }
  }
  private onHello(session: Session, input: Hello): void {
    const hello = verifyHello(input);
    if (
      session.hello ||
      hello.identity.id === this.unlocked!.identity.public.id
    )
      throw new Error("Unexpected identity");
    const expected = session.expected ?? this.unlocked!.friend?.public;
    if (expected && !sameIdentity(expected, hello.identity)) {
      if (session.outbound)
        this.publish({
          state: "IDENTITY_CHANGED",
          warning:
            "The device at this address has a different identity from your trusted friend. Disconnect and verify with your friend before removing the existing pairing.",
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
        this.invitation.expires < Date.now())
    ) {
      this.publish({
        notice:
          "Unknown device ignored. Generate an invitation if you want to pair.",
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
      endpoint: this.snapshot.network!.endpoint,
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
    const opened = openEnvelope(
      this.unlocked!.identity,
      session.hello.identity,
      frame,
    );
    if (
      this.active === session.id &&
      this.unlocked?.friend &&
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
      if (session.controls.size >= 20_000)
        throw new Error("Reconnect required");
      session.controls.add(frame.messageId);
    }
    if (payload.type === "auth") {
      if (session.auth) throw new Error("Repeated authentication");
      if (!this.unlocked!.friend) {
        if (session.invitation) {
          if (payload.inviteId !== session.invitation.inviteId || payload.token)
            throw new Error("Unexpected pairing response");
          session.inviteId = session.invitation.inviteId;
          session.expires = session.invitation.expires;
        } else {
          const invite = this.invitation;
          if (
            !invite ||
            this.invitationUsed ||
            invite.expires < Date.now() ||
            payload.inviteId !== invite.inviteId ||
            !payload.token ||
            !tokenMatches(payload.token, invite.token)
          )
            throw new Error("Wrong or reused invitation");
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
      session.remoteEndpoint = payload.endpoint;
      this.send(session, { type: "ready" });
      return;
    }
    if (!session.auth) throw new Error("Authentication required");
    if (payload.type === "ready") {
      session.ready = true;
      if (this.unlocked!.friend) await this.connected(session);
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
    if (this.active !== session.id || !this.unlocked!.friend)
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
      };
      const inserted = await this.api.receive(
        archiveMessage(this.unlocked!.identity, message.peerId, message, true),
      );
      if (this.unlocked !== u || this.sessions.get(session.id) !== session)
        return;
      if (inserted)
        this.publish({
          messages: [
            ...this.snapshot.messages,
            { ...message, delivered: true },
          ],
        });
      // Duplicate retransmissions are acknowledged, but never inserted or displayed twice.
      this.send(session, { type: "ack", messageId: frame.messageId });
    } else if (payload.type === "ack") {
      const message = this.snapshot.messages.find(
        (x) =>
          x.id === payload.messageId &&
          x.from === "me" &&
          x.peerId === session.hello!.identity.id,
      );
      if (message && !message.delivered) {
        await this.api.delivered(message.id);
        if (this.unlocked !== u || this.sessions.get(session.id) !== session)
          return;
        this.publish({
          messages: this.snapshot.messages.map((x) =>
            x.id === message.id ? { ...x, delivered: true } : x,
          ),
        });
      }
    } else if (payload.type === "ping") this.send(session, { type: "pong" });
  }
  private publishPending(session: Session): void {
    this.publish({
      pending: {
        identity: session.hello!.identity,
        displayName: session.remoteName!,
        code: securityCode(
          this.unlocked!.identity.public,
          session.hello!.identity,
        ),
        localVerified: session.localVerified,
        remoteVerified: session.remoteVerified,
      },
      state: "AUTHENTICATING",
    });
  }
  async verifyPairing(): Promise<void> {
    const session = this.candidate
      ? this.sessions.get(this.candidate)
      : undefined;
    if (!session?.auth || !session.ready || (session.expires ?? 0) < Date.now())
      throw new Error("No active pairing. Create a new invitation.");
    if (session.localVerified) return;
    session.localVerified = true;
    this.send(session, { type: "verify", inviteId: session.inviteId });
    this.publishPending(session);
    await this.completePair(session);
  }
  private async completePair(session: Session): Promise<void> {
    if (
      !session.localVerified ||
      !session.remoteVerified ||
      this.unlocked!.friend
    )
      return;
    const u = this.unlocked!;
    const now = new Date().toISOString();
    this.unlocked!.friend = {
      public: session.hello!.identity,
      displayName: session.remoteName!,
      endpoint: session.remoteEndpoint!,
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
    if (this.unlocked !== u || this.sessions.get(session.id) !== session)
      return;
    this.invitation = undefined;
    this.candidate = undefined;
    this.publish({
      invitation: undefined,
      pending: undefined,
      friend: this.unlocked!.friend,
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
    const friend = this.unlocked!.friend!;
    this.unlocked!.friend = {
      ...friend,
      lastSeen: new Date().toISOString(),
      endpoint: {
        ...session.remoteEndpoint!,
        host:
          session.outbound && session.address !== "relay"
            ? session.address
            : session.remoteEndpoint!.host,
      },
    };
    await this.api.saveVault(sealVault(this.unlocked!));
    if (this.unlocked !== u || this.sessions.get(session.id) !== session)
      return;
    this.publish({
      state: "CONNECTED",
      path: this.relaySessions.has(session.id) ? "INTERNET" : "LOCAL",
      friend: this.unlocked!.friend,
      notice: undefined,
      warning: undefined,
    });
    this.flushPending(session);
  }
  async sendMessage(text: string): Promise<void> {
    const u = this.unlocked;
    const session = this.active ? this.sessions.get(this.active) : undefined;
    const value = text.trim();
    if (
      !this.unlocked?.friend ||
      (!session && !this.snapshot.network?.relayUrl)
    )
      throw new Error("Reconnect securely before sending");
    if (
      !value ||
      value.length > 8000 ||
      new TextEncoder().encode(value).length > 32_000
    )
      throw new Error("Use 1 to 8000 characters, within 32 KB");
    const id = randomId();
    const sentAt = new Date().toISOString();
    let wire: Envelope | undefined;
    let sequence: number | undefined;
    if (this.snapshot.network?.relayUrl && this.unlocked.friend.pairId) {
      sequence = (this.unlocked.identity.sequence ?? 0) + 1;
      this.unlocked.identity.sequence = sequence;
      await this.api.saveVault(sealVault(this.unlocked));
      wire = sealEnvelope(
        this.unlocked.identity,
        this.unlocked.friend.public,
        {
          type: "mail-chat",
          pairId: this.unlocked.friend.pairId,
          sequence,
          text: value,
        },
        id,
        sentAt,
      );
    }
    if (!session && !wire)
      throw new Error(
        "Re-pair once to enable internet offline delivery for a legacy pairing",
      );
    const message = {
      id,
      ...(wire ? { wire, sequence } : {}),
      peerId: this.unlocked.friend.public.id,
      from: "me" as const,
      text: value,
      sentAt,
    };
    await this.api.outgoing(
      archiveMessage(this.unlocked.identity, message.peerId, message, false),
    );
    if (this.unlocked !== u)
      throw new Error(
        "The vault locked before sending. The encrypted pending message is retained locally.",
      );
    this.publish({
      messages: [...this.snapshot.messages, { ...message, delivered: false }],
    });
    if (wire) {
      this.transmitMail(wire);
      return;
    }
    this.send(
      session!,
      { type: "chat", text: value },
      message.id,
      message.sentAt,
    );
  }
  private flushPending(session: Session): void {
    for (const message of this.snapshot.messages
      .filter(
        (x) =>
          x.from === "me" &&
          !x.delivered &&
          x.peerId === session.hello!.identity.id,
      )
      .slice(0, 50))
      if (message.wire) this.transmitMail(message.wire);
      else
        this.send(
          session,
          { type: "chat", text: message.text },
          message.id,
          message.sentAt,
        );
  }
  private relayCommand(packet: unknown): void {
    this.command({ type: "relay-send", packet });
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
          authInput(
            challenge,
            this.unlocked!.identity.public,
            this.snapshot.network!.relayUrl!,
          ),
          this.unlocked!.identity.signSecret,
        ),
      });
    } else if (p.type === "ready") {
      this.relayReady = true;
      this.relayFailures = 0;
      this.readSent.clear();
      this.publish({
        relayConnected: true,
        path: this.active ? this.snapshot.path : "INTERNET",
      });
      if (!this.unlocked?.friend) this.relayCommand({ type: "unpin" });
      else this.pinRelay();
      if (this.unlocked?.friend && !this.active) this.reconnect();
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
      if (this.relaySessions.size >= 8) throw Error("Relay link capacity");
      this.relaySessions.add(e.connectionId);
      await this.handle(e);
    } else if (p.type === "frame") {
      const e = z
        .object({
          type: z.literal("frame"),
          connectionId: z.string().uuid(),
          frame: FrameSchema,
        })
        .strict()
        .parse(p);
      await this.handle(e);
    } else if (p.type === "peer-close")
      await this.handle({
        type: "peer-close",
        connectionId: z.string().uuid().parse(p.connectionId),
      });
    else if (p.type === "mail") {
      if (!this.relayPaired) return;
      await this.receiveMail(p.envelope);
    } else if (p.type === "accepted")
      await this.updateReceipt(
        z
          .string()
          .regex(/^[a-f0-9]{32}$/)
          .parse(p.messageId),
        "SENT",
      );
    else if (p.type === "rejected")
      this.publish({
        messages: this.snapshot.messages.map((x) =>
          x.id === p.messageId && !x.delivered ? { ...x, state: "FAILED" } : x,
        ),
        notice:
          "Relay queue is full. Your encrypted message remains on this computer and will retry.",
      });
    else if (p.type === "error" && p.requestId) {
      this.requests.delete(p.requestId);
      if (!this.active)
        this.publish({
          state: "DISCONNECTED",
          path: this.relayReady ? "INTERNET" : "OFFLINE",
        });
    }
  }
  private transmitMail(envelope: Envelope): void {
    if (!this.relayPaired && !this.active) return;
    const m = this.snapshot.messages.find(
      (x) => x.id === envelope.messageId && x.from === "me",
    );
    if (
      m &&
      !m.delivered &&
      (!m.state || ["QUEUED", "FAILED"].includes(m.state))
    )
      this.publish({
        messages: this.snapshot.messages.map((x) =>
          x.id === m.id ? { ...x, state: "SENDING" as const } : x,
        ),
      });
    const session = this.active ? this.sessions.get(this.active) : undefined;
    if (session && !this.relaySessions.has(session.id)) {
      this.sendFrame(session.id, envelope);
      return;
    }
    if (this.relayPaired)
      this.relayCommand({
        type: "mail",
        envelope,
        pairId: this.unlocked!.friend!.pairId,
      });
  }
  private flushRelay(): void {
    for (const m of this.snapshot.messages
      .filter((x) => x.from === "me" && !x.delivered && x.wire)
      .slice(0, 8))
      this.transmitMail(m.wire!);
  }
  private async updateReceipt(
    id: string,
    state: "SENT" | "DELIVERED" | "READ",
  ): Promise<void> {
    const u = this.unlocked;
    const m = this.snapshot.messages.find(
      (x) => x.id === id && x.from === "me",
    );
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
    if (this.unlocked === u)
      this.publish({
        messages: this.snapshot.messages.map((x) =>
          x.id === id
            ? { ...x, state, delivered: state === "SENT" ? x.delivered : true }
            : x,
        ),
      });
  }
  private async receiveMail(input: unknown): Promise<void> {
    const u = this.unlocked;
    if (!u?.friend?.pairId) return;
    const { envelope: e, payload: raw } = openEnvelope(
      u.identity,
      u.friend.public,
      input,
    );
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
      };
      const inserted = await this.api.receive(
        archiveMessage(u.identity, message.peerId, message, true),
      );
      if (this.unlocked !== u) return;
      if (inserted) {
        const highest = this.snapshot.messages.reduce(
          (n, x) => (x.from === "friend" ? Math.max(n, x.sequence ?? 0) : n),
          u.friend.receivedSequence ?? 0,
        );
        u.friend.receivedSequence = Math.max(highest, p.sequence);
        await this.api.saveVault(sealVault(u));
        if (this.unlocked !== u) return;
        this.publish({
          messages: [
            ...this.snapshot.messages,
            { ...message, delivered: true },
          ],
          ...(p.sequence <= highest
            ? {
                notice:
                  "A delayed message arrived out of sequence. Its authenticated sequence is retained.",
              }
            : {}),
        });
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
  private sendMailReceipt(
    messageId: string,
    state: "DELIVERED" | "READ",
  ): void {
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
  markRead(): void {
    if (!this.unlocked?.friend || (!this.relayPaired && !this.active)) return;
    for (const m of this.snapshot.messages
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
    if (
      this.snapshot.network?.relayUrl &&
      !this.relayReady &&
      now >= this.relayNext
    )
      this.openRelay();
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
    if (this.invitation && this.invitation.expires < now) {
      this.cancelPairing();
      this.publish({ notice: "Invitation expired. Create a new invitation." });
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
      this.unlocked.friend &&
      !this.snapshot.warning &&
      !this.requests.size &&
      !this.sessions.size &&
      now - this.lastConnect > 8000
    ) {
      const found = this.snapshot.devices.find(
        (x) => x.nodeId === this.unlocked!.friend!.endpoint.nodeId,
      );
      this.connectInternal(
        found ?? this.unlocked.friend.endpoint,
        this.unlocked.friend.public,
      );
    }
  }
  async clearHistory(): Promise<void> {
    const epoch = this.epoch;
    await this.api.clearHistory();
    if (this.epoch === epoch)
      this.publish({
        messages: [],
        notice: "Local conversation deleted. Your friend’s copy is unchanged.",
      });
  }
  async removeFriend(): Promise<void> {
    if (!this.unlocked) return;
    const u = this.unlocked;
    if (this.relayReady) this.relayCommand({ type: "unpin" });
    this.relayPaired = false;
    this.command({ type: "disconnect-all" });
    this.sessions.clear();
    this.requests.clear();
    this.active = undefined;
    this.candidate = undefined;
    this.unlocked.friend = undefined;
    await this.api.saveVault(sealVault(this.unlocked));
    await this.api.clearHistory();
    if (this.unlocked !== u) return;
    this.publish({
      friend: undefined,
      pending: undefined,
      invitation: undefined,
      messages: [],
      warning: undefined,
      state: "PAIRING_REQUIRED",
      notice:
        "Trust and local conversation removed. Both devices must verify a new pairing.",
    });
  }
  async resetIdentity(): Promise<void> {
    this.lock();
    await this.api.reset();
    this.publish({
      mode: "new",
      state: "PAIRING_REQUIRED",
      network: { ...this.snapshot.network!, hasVault: false },
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
