/**
 * PURE presentation + untrusted-input helpers for the mesh dashboard. Every
 * function here is side-effect free, clock-injectable where time matters, and
 * has NO Angular dependency, so the whole presentation contract is unit-testable
 * on its own (`mesh-format.spec.ts`) without a TestBed.
 *
 * <p>Two things live here:
 *
 * <ol>
 *   <li><b>Presentation</b> — the avatar badge, the display-name fallback, the
 *       hop/last-heard/battery/SNR labels + their quality buckets. These are a
 *       deliberate re-implementation of the OFFICIAL Meshtastic web client's
 *       node-list presentation (the node-number→RGB avatar, the 101 = "powered"
 *       battery convention, the SNR→quality-percent mapping) in Angular + house
 *       SCSS. Nothing is imported from that project; only the conventions are
 *       matched so a Meshtastic user recognises their own mesh here.</li>
 *   <li><b>Tolerant parsing</b> — the clamps/caps every wire field goes through
 *       before it reaches a template. The node/room rows carry RADIO-REPORTED
 *       telemetry relayed by a bridge: it is best-effort, frequently absent, and
 *       never cryptographically authenticated, so every field is treated as
 *       untrusted (see the module's `mesh*` parsers below).</li>
 * </ol>
 *
 * <p>The same normalization also exists server-side (user-bff-api's
 * {@code MeshDeviceService} canonicalizes a claimed node id, and its 019
 * {@code ck_mesh_device_node_id} CHECK is the DB backstop) and in
 * hugmesh-matrix-ui's mesh-devices settings section. Native federation forbids a
 * shared runtime import across remote boundaries and these are separate repos, so
 * the logic is RE-DERIVED here rather than cross-imported — the specs in this
 * repo pin the behaviour so a drift is caught locally.
 */

// ── Limits + wire conventions ───────────────────────────────────────────────

/** LIMIT: longest device label accepted (matches user-bff's `label` column cap). */
export const MAX_MESH_LABEL_LENGTH = 64;

/** LIMIT: longest radio-reported long/short name rendered (guards a hostile row). */
export const MAX_MESH_NAME_LENGTH = 64;

/** LIMIT: longest revoke reason surfaced (guards a hostile/buggy row). */
export const MAX_REVOKE_REASON_LENGTH = 200;

/** LIMIT: longest owner localpart rendered in the "registered to" chip. */
export const MAX_MESH_OWNER_LENGTH = 128;

/** LIMIT: longest Matrix room id rendered on the channels page. */
export const MAX_MESH_ROOM_ID_LENGTH = 255;

/** Battery cap: 0..100 are percentages; 101 is Meshtastic's "on external power" marker. */
export const MAX_BATTERY_PCT = 101;

/** Bridge device ids are hostname-ish tokens, capped at 64 chars. */
export const MESH_VIA_DEVICE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/** A node id in the CANONICAL wire form: `!` + exactly 8 lowercase hex digits. */
export const MESH_NODE_ID_PATTERN = /^![0-9a-f]{8}$/;

/**
 * A radio counts as ONLINE when it was last heard within this window. 5 minutes
 * matches mesh-bff-api's own derivation (`app.mesh.node-online-window-seconds`,
 * default 300) so the dot this UI paints agrees with the `online` flag the BFF
 * sends; the UI derives it locally as well so a row from a mocked/older BFF that
 * omits the flag still gets an honest dot.
 */
export const MESH_ONLINE_WINDOW_MS = 5 * 60_000;

/** SNR at or above this many dB is a GOOD link (Meshtastic's own bucketing). */
export const MESH_SNR_GOOD_DB = -7;
/** SNR at or above this many dB (but below {@link MESH_SNR_GOOD_DB}) is a FAIR link. */
export const MESH_SNR_FAIR_DB = -15;

/** Battery percent strictly above this is a GOOD (green) charge. */
export const MESH_BATTERY_GOOD_PCT = 80;
/** Battery percent strictly above this (but not GOOD) is a FAIR (yellow) charge. */
export const MESH_BATTERY_FAIR_PCT = 20;

// ── Small shared numeric/string guards ──────────────────────────────────────

/** Clamp `v` into the inclusive range [`lo`, `hi`]. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * A non-blank string capped at `max` chars, else `null` (fail-soft). Whitespace
 * is trimmed first so a row whose field is `"   "` reads as absent rather than
 * rendering an empty chip.
 */
export function meshString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, max) : null;
}

/**
 * A battery percent from the wire: any finite number, ROUNDED and clamped into
 * 0..101 (101 = externally powered, per Meshtastic). Anything non-numeric — or
 * `NaN`/`Infinity` — is `null` (absent), which the UI renders as no battery cell
 * at all rather than a misleading 0%.
 */
export function meshBatteryPct(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(clamp(value, 0, MAX_BATTERY_PCT));
}

/**
 * An SNR reading from the wire: a FINITE number clamped into a sane ±100 dB.
 * `null`/`NaN`/`Infinity` are `null` (absent) — the brief's "require finite snr"
 * rule, so a broken radio can never drive the quality bar off its track.
 */
export function meshSnr(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return clamp(value, -100, 100);
}

/** A hop count from the wire: a non-negative INTEGER clamped into 0..64. */
export function meshHops(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return clamp(value, 0, 64);
}

/** A timestamp from the wire: an ISO-8601 string the platform can parse, else `null`. */
export function meshTimestamp(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

/** The relaying bridge device id from the wire — a hostname-ish token, else `null`. */
export function meshViaDevice(value: unknown): string | null {
  return typeof value === 'string' && MESH_VIA_DEVICE_PATTERN.test(value) ? value : null;
}

// ── Node ids ────────────────────────────────────────────────────────────────

/**
 * Normalize a user-typed Meshtastic node id to the canonical
 * `"!"+8 lowercase hex` form: surrounding whitespace is trimmed, an optional
 * leading `!` is stripped, and the hex case is folded. Anything that is not
 * EXACTLY 8 hex digits after that is rejected as `null` — never a guess, never a
 * pad, never a truncation.
 *
 * <p>This is the same accepted-input rule user-bff-api's
 * {@code ValidationPatterns.MESH_NODE_ID} enforces on the claim body, so the
 * form can reject locally instead of round-tripping a request the API would 400.
 *
 * @param input whatever the user typed, e.g. `a1b2c3d4` or `!A1B2C3D4`
 * @returns the canonical `!a1b2c3d4` form, or `null` when the input is not a node id
 */
export function normalizeMeshNodeId(input: string): string | null {
  const trimmed = (input ?? '').trim();
  const bare = trimmed.startsWith('!') ? trimmed.slice(1) : trimmed;
  if (!/^[0-9a-fA-F]{8}$/.test(bare)) {
    return null;
  }
  return `!${bare.toLowerCase()}`;
}

/**
 * The NUMERIC Meshtastic node number behind a node id — the 32-bit value the
 * radio broadcasts, parsed out of the `!hex8` id. `null` when the id is not a
 * node id at all (so callers never colour a badge off a garbage row).
 */
export function meshNodeNumber(nodeId: string): number | null {
  const canonical = normalizeMeshNodeId(nodeId);
  return canonical === null ? null : Number.parseInt(canonical.slice(1), 16);
}

/**
 * The last four hex digits of a node id, UPPERCASED — the short human handle a
 * Meshtastic operator reads off the radio's screen. Used as the display-name
 * fallback for a node that reports no long name (including a row the BFF
 * visibility-gated down to a bare id). `null` for a non-node-id.
 */
export function meshNodeIdSuffix(nodeId: string): string | null {
  const canonical = normalizeMeshNodeId(nodeId);
  return canonical === null ? null : canonical.slice(-4).toUpperCase();
}

/**
 * The name to SHOW for a node: its radio-reported long name when it has one,
 * else the uppercased last-four-hex of its id (`meshNodeIdSuffix`), else — for a
 * row whose id is itself unusable — the literal `unknown node`. Never blank, so
 * a row always has something focusable/announceable.
 */
export function meshNodeDisplayName(longName: string | null | undefined, nodeId: string): string {
  const named = meshString(longName, MAX_MESH_NAME_LENGTH);
  if (named !== null) return named;
  return meshNodeIdSuffix(nodeId) ?? 'unknown node';
}

// ── Avatar badge (Meshtastic's node-number → colour convention) ─────────────

/** The two colours of a node's avatar badge: its derived background + a readable text colour. */
export interface MeshAvatarColors {
  /** `#rrggbb` derived from the low 24 bits of the node number. */
  background: string;
  /** `#000000` or `#ffffff`, whichever is readable on {@link background}. */
  foreground: string;
}

/** Format one 0..255 channel as two lowercase hex digits. */
function hexByte(v: number): string {
  return v.toString(16).padStart(2, '0');
}

/**
 * The avatar badge colours for a node, derived from its node NUMBER exactly the
 * way the official Meshtastic web client does it: the low 24 bits of the number
 * are read as an RGB triple, and the text colour is picked by the classic
 * weighted-luminance test `(r*299 + g*587 + b*114) / 1000 > 127.5` — black text
 * on a light badge, white on a dark one. The result is stable per radio, so a
 * user recognises their own node by colour across pages and sessions.
 *
 * <p>Returns `null` for a row whose node id is not a node id at all; callers
 * render an un-tinted placeholder badge in that case rather than an invalid
 * `#NaN` style.
 */
export function meshAvatarColors(nodeId: string): MeshAvatarColors | null {
  const n = meshNodeNumber(nodeId);
  if (n === null) return null;
  const r = (n & 0xff0000) >> 16;
  const g = (n & 0x00ff00) >> 8;
  const b = n & 0x0000ff;
  // ITU-R BT.601 luma weights — the same perceived-brightness test the Meshtastic
  // client uses to decide black-vs-white text on the generated badge colour.
  const luminance = (r * 299 + g * 587 + b * 114) / 1000;
  return {
    background: `#${hexByte(r)}${hexByte(g)}${hexByte(b)}`,
    foreground: luminance > 127.5 ? '#000000' : '#ffffff',
  };
}

/**
 * The (up to) four characters printed inside the avatar badge: the radio's SHORT
 * name when it has one, else the first four characters of its long name, else
 * the id-derived fallback name — so the badge is never empty. Whitespace-only
 * names are treated as absent (see {@link meshString}).
 */
export function meshAvatarText(
  shortName: string | null | undefined,
  longName: string | null | undefined,
  nodeId: string,
): string {
  const source =
    meshString(shortName, MAX_MESH_NAME_LENGTH) ??
    meshString(longName, MAX_MESH_NAME_LENGTH) ??
    meshNodeDisplayName(longName, nodeId);
  return source.slice(0, 4);
}

// ── Last heard / online ─────────────────────────────────────────────────────

/**
 * Render a timestamp as a coarse relative time ("just now", "5m ago", "3h ago",
 * "2d ago"). Fail-soft: a null/malformed timestamp yields `null` (the caller
 * decides what absence looks like — see {@link meshLastHeardLabel}); a FUTURE
 * timestamp (clock skew between the radio, the bridge and the browser) reads
 * "just now" rather than a negative age.
 *
 * @param iso   the wire timestamp, or null/undefined when the radio was never heard
 * @param nowMs injectable clock, so the formatting is unit-testable
 */
export function meshRelativeTime(iso: string | null | undefined, nowMs: number = Date.now()): string | null {
  if (typeof iso !== 'string') return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const deltaMs = nowMs - t;
  if (deltaMs < 60_000) return 'just now';
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * The "last heard" cell of the node directory: {@link meshRelativeTime}, or the
 * literal `unknown` when the radio has never been heard (or reported an
 * unparseable timestamp). Always a string — the column is never blank, because a
 * blank cell reads as "0 seconds ago" to a screen-reader user.
 */
export function meshLastHeardLabel(iso: string | null | undefined, nowMs: number = Date.now()): string {
  return meshRelativeTime(iso, nowMs) ?? 'unknown';
}

/**
 * Whether a radio counts as ONLINE — last heard within
 * {@link MESH_ONLINE_WINDOW_MS} (5 minutes, matching the BFF's own window). A
 * never-heard / unparseable timestamp is OFFLINE; a future timestamp (clock
 * skew) is ONLINE rather than an absurd age.
 */
export function meshIsOnline(iso: string | null | undefined, nowMs: number = Date.now()): boolean {
  if (typeof iso !== 'string') return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return nowMs - t < MESH_ONLINE_WINDOW_MS;
}

// ── Hops / route ────────────────────────────────────────────────────────────

/**
 * How the radio reached us: its hop count when the bridge reported one
 * (`"0 hops"`, `"1 hop"`, `"3 hops"`), else the relaying device (`"via
 * gateway-01"`) when only that is known, else `null` (the cell renders an
 * em-dash). Hops win over `via` because a hop count is the more precise fact.
 */
export function meshHopLabel(hopsAway: number | null | undefined, viaDevice: string | null | undefined): string | null {
  if (typeof hopsAway === 'number' && Number.isFinite(hopsAway)) {
    return `${hopsAway} hop${hopsAway === 1 ? '' : 's'}`;
  }
  const via = meshString(viaDevice, MAX_MESH_NAME_LENGTH);
  return via === null ? null : `via ${via}`;
}

// ── Battery ─────────────────────────────────────────────────────────────────

/**
 * The battery bucket a percent falls into: `powered` (Meshtastic's 101 = mains /
 * solar marker), `good` (> 80), `fair` (> 20) or `poor` (<= 20). `null` when the
 * radio reported no battery at all — the UI HIDES the battery cell in that case
 * rather than implying an empty battery.
 */
export type MeshLevel = 'powered' | 'good' | 'fair' | 'poor';

/** {@link MeshLevel} for a battery percent; `null` when absent. See the type doc. */
export function meshBatteryLevel(pct: number | null | undefined): MeshLevel | null {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return null;
  if (pct > 100) return 'powered';
  if (pct > MESH_BATTERY_GOOD_PCT) return 'good';
  if (pct > MESH_BATTERY_FAIR_PCT) return 'fair';
  return 'poor';
}

/**
 * The battery cell's text: `powered` for the 101 marker, else `82%`. `null` when
 * the radio reported no battery (the cell is hidden entirely).
 */
export function meshBatteryLabel(pct: number | null | undefined): string | null {
  const level = meshBatteryLevel(pct);
  if (level === null) return null;
  return level === 'powered' ? 'powered' : `${pct as number}%`;
}

/**
 * The SPOKEN battery description, for the screen-reader text that accompanies
 * the coloured cell (WCAG 1.4.1 — never colour alone). `null` when absent.
 */
export function meshBatteryScreenReaderLabel(pct: number | null | undefined): string | null {
  const level = meshBatteryLevel(pct);
  if (level === null) return null;
  if (level === 'powered') return 'externally powered';
  return `battery ${pct as number}%, ${level}`;
}

// ── Signal (SNR) ────────────────────────────────────────────────────────────

/**
 * The link-quality bucket for an SNR reading, using Meshtastic's own thresholds:
 * `good` above -7 dB, `fair` above -15 dB, `poor` below that. `null` when the
 * radio reported no SNR.
 */
export function meshSignalLevel(snr: number | null | undefined): Exclude<MeshLevel, 'powered'> | null {
  if (typeof snr !== 'number' || !Number.isFinite(snr)) return null;
  if (snr > MESH_SNR_GOOD_DB) return 'good';
  if (snr > MESH_SNR_FAIR_DB) return 'fair';
  return 'poor';
}

/**
 * The 0..100 quality percent derived from an SNR reading —
 * `clamp(round((snr + 10) * 5), 0, 100)` — the mapping the Meshtastic web client
 * uses to drive its signal meter. `null` when the radio reported no SNR, so the
 * meter is HIDDEN rather than pinned at 0 (which would read as "no link" for a
 * radio that simply never reported).
 */
export function meshSignalPercent(snr: number | null | undefined): number | null {
  if (typeof snr !== 'number' || !Number.isFinite(snr)) return null;
  return clamp(Math.round((snr + 10) * 5), 0, 100);
}

/**
 * The SPOKEN signal description for the screen-reader text beside the coloured
 * meter (WCAG 1.4.1 — never colour alone), e.g. `SNR 4.5 dB, 73 percent, good`.
 * `null` when absent.
 */
export function meshSignalScreenReaderLabel(snr: number | null | undefined): string | null {
  const level = meshSignalLevel(snr);
  if (level === null) return null;
  return `SNR ${snr as number} dB, ${meshSignalPercent(snr)} percent, ${level}`;
}

// ── Filtering ───────────────────────────────────────────────────────────────

/**
 * Whether ANY of `fields` contains `query` as a case-insensitive substring. A
 * blank/whitespace query matches EVERYTHING (an empty filter box is not a
 * filter), and null/undefined fields simply never match. Pure, so the node
 * directory's client-side filter is unit-testable without a fixture.
 */
export function meshTextMatches(query: string, ...fields: (string | null | undefined)[]): boolean {
  const needle = (query ?? '').trim().toLowerCase();
  if (needle.length === 0) return true;
  return fields.some((f) => typeof f === 'string' && f.toLowerCase().includes(needle));
}
