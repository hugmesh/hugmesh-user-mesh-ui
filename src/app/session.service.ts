import { Injectable, signal, computed } from '@angular/core';

/**
 * The deserialized shape of the `hug.session` localStorage entry. Written by
 * the login remote once native login completes and the BFF has set the
 * HttpOnly `bff_` session cookie; read by every federated remote via this
 * service. This record itself carries no token (see the class doc below) —
 * only non-secret metadata. `roles` are lowercase Casdoor role slugs
 * (`'user'`, `'mesh'`, `'admin'`, etc.).
 */
export interface SnapSession {
  /** Casdoor identity key, e.g. `google:alice@gmail.com`. */
  id: string;
  /** Human-readable display label (email or Discord handle). */
  label: string;
  /** The upstream identity provider (proxied through Casdoor) that authenticated this session. */
  provider: 'google' | 'discord';
  /** Lowercase Casdoor role slugs granted to this user. */
  roles: string[];
  /** Whether the user has completed the post-login registration flow. */
  registrationComplete: boolean;
}

/**
 * Holds the logged-in session (persisted to `localStorage` under `hug.session`)
 * and derives the Casdoor-style role-tier signals used by the mesh remote's
 * route guard ({@link meshGuard}) and its pages.
 *
 * Holds only non-secret metadata: the BFF session token is server-held and
 * injected by the gateway (`/bff/mesh/**`, `/bff/user/**`) keyed off the
 * HttpOnly `bff_` cookie — it never reaches the browser. Every fetch in this
 * remote sends `credentials: 'include'` so that cookie rides the request; the
 * gateway's `BffCookieToBearerWebFilter` mints the upstream bearer server-side.
 *
 * This is the canonical HugMesh SessionService (copied verbatim in each
 * native-federation remote because the federation runtime forbids shared singletons
 * across remote boundaries). Every copy reads/writes the SAME `hug.session`
 * localStorage key and dispatches/listens for the SAME `hug-session-change`
 * broadcast so all in-page instances (host shell + every loaded remote) stay in
 * sync without a round-trip to the server. The only mesh-specific addition is
 * {@link isMesh}.
 *
 * @see {@link meshGuard} — uses {@link isMesh} to gate the `/user-mesh` routes.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly key = 'hug.session';
  private readonly channel = 'hug-session-change';

  /** Reactive signal over the current session; `null` when logged out. */
  readonly session = signal<SnapSession | null>(this.load());

  /** `true` when a session is present (any role). */
  readonly loggedIn = computed(() => this.session() !== null);

  /**
   * ADMIN tier — Casdoor `'admin'` role. Not a gate in this remote (the mesh
   * surfaces are owner-scoped, not admin-scoped); kept for parity with the
   * canonical copy so a future admin-only affordance has the same signal name.
   */
  readonly isAdmin = computed(() => (this.session()?.roles ?? []).includes('admin'));

  /**
   * MESH tier — a Casdoor `'mesh'`, `'admin'` OR `'superadmin'` role. Unlocks
   * this entire remote; mirrors the mesh-bff-api's
   * `hasAnyRole('MESH','ADMIN','SUPERADMIN')` on every `/bff/mesh/**` endpoint.
   * Used by {@link meshGuard} to allow/deny entry.
   *
   * <p>NOTE the platform role FLOOR for this remote is ROLE_MESH: the
   * `gateway_route_access` row for `/bff/mesh/**` gates on it (the row for the
   * `/user-mesh/**` page path is still to be seeded with the host-side wiring),
   * and the capabilities projection advertises `requiresRole: "ROLE_MESH"`. Admin and
   * superadmin are accepted here only because the BFF accepts them (they are a
   * superset), never as a substitute for the row.
   */
  readonly isMesh = computed(() => {
    const roles = this.session()?.roles ?? [];
    return roles.includes('mesh') || roles.includes('admin') || roles.includes('superadmin');
  });

  /**
   * Whether the user has completed the post-login registration flow. Claiming a
   * radio writes into the caller's own user-bff rows, so the host keeps this
   * remote behind the same registration gate as the other user-tier surfaces.
   */
  readonly fullyRegistered = computed(() => this.session()?.registrationComplete === true);

  constructor() {
    // Each native-federation remote and the host shell get their OWN Angular
    // injector, so each holds its OWN SessionService instance. We keep them in
    // sync by:
    //  1. Listening for `hug-session-change` (same-document custom event, fired by
    //     whichever instance last called set/patch/clear) so in-page remotes stay
    //     current without a storage event.
    //  2. Listening for the `storage` event so cross-tab writes (e.g. logging in a
    //     second tab) propagate here too.
    if (typeof window !== 'undefined') {
      window.addEventListener(this.channel, () => this.session.set(this.load()));
      window.addEventListener('storage', (e) => {
        if (e.key === this.key) this.session.set(this.load());
      });
    }
  }

  /**
   * Replace the stored session with `s`, persist to `localStorage`, and broadcast
   * to the other in-page service instances.
   *
   * @param s The new session to store.
   */
  set(s: SnapSession): void {
    localStorage.setItem(this.key, JSON.stringify(s));
    this.session.set(s);
    this.broadcast();
  }

  /**
   * Apply a partial update to the current session (no-op when logged out).
   *
   * @param p Partial session fields to merge.
   */
  patch(p: Partial<SnapSession>): void {
    const s = this.session();
    if (s) this.set({ ...s, ...p });
  }

  /**
   * Log out: remove the stored session from `localStorage`, reset the signal to
   * `null`, and broadcast to the other in-page instances.
   */
  clear(): void {
    localStorage.removeItem(this.key);
    this.session.set(null);
    this.broadcast();
  }

  /**
   * Read and parse the stored session from `localStorage`. Returns `null` when
   * absent or on parse error (e.g. corrupted storage value).
   */
  private load(): SnapSession | null {
    try {
      const raw = localStorage.getItem(this.key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /**
   * Dispatch a same-document `hug-session-change` event so the other in-page
   * SessionService instances (host shell + other loaded remotes) re-read from
   * `localStorage` without waiting for a cross-tab `storage` event.
   */
  private broadcast(): void {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(this.channel));
  }
}
