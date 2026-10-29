import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import {
  MAX_MESH_NAME_LENGTH,
  MAX_MESH_OWNER_LENGTH,
  MAX_MESH_ROOM_ID_LENGTH,
  meshBatteryPct,
  meshDeniedNote,
  meshHops,
  meshIsOnline,
  meshSnr,
  meshString,
  meshTimestamp,
  meshViaDevice,
  normalizeMeshNodeId,
} from './mesh-format';

/** Override hook mirroring admin-ui's `__SNAP_BFF_URL__`; same-origin by default
 *  (the fe-gateway proxies `/bff/mesh/**` to hugmesh-mesh-bff-api). */
const BFF_BASE: string = (typeof __SNAP_BFF_URL__ !== 'undefined' && __SNAP_BFF_URL__) ? __SNAP_BFF_URL__ : '';

/**
 * One row of the mesh node directory — matched field-for-field to
 * hugmesh-mesh-bff-api's {@code MeshNodeView} record (the shape of both
 * {@code GET /bff/mesh/nodes} and {@code GET /bff/mesh/status/{nodeId}}).
 *
 * <p>Every field except {@code nodeId} is nullable and RADIO-REPORTED: it is
 * relayed by the mesh↔Matrix bridge, is best-effort, and is NOT cryptographically
 * authenticated. `registeredTo` is the owner's Matrix localpart and is
 * VISIBILITY-GATED server-side — a registered node whose owner's visibility does
 * not permit this caller comes back as a bare id with every other field nulled,
 * so an absent field here never means "the server leaked less than it should".
 */
export interface MeshNode {
  /** The canonical `!`+8-lowercase-hex node id. Always present (the row key). */
  nodeId: string;
  longName: string | null;
  shortName: string | null;
  lastSeenAt: string | null;
  batteryPct: number | null;
  snr: number | null;
  hopsAway: number | null;
  viaDevice: string | null;
  /** Server-derived "heard within the online window"; re-derived locally when absent. */
  online: boolean;
  /** The owner's localpart when attribution is permitted, else `null` (anonymous or gated). */
  registeredTo: string | null;
}

/**
 * One mesh-enabled chat room — matched to mesh-bff-api's {@code MeshRoomView}
 * ({@code GET /bff/mesh/rooms}, domain-scoped server-side). {@code meshChannel}
 * is the LoRa channel index the room bridges; {@code device} is the bridge radio
 * carrying it.
 */
export interface MeshRoom {
  roomId: string;
  device: string | null;
  meshChannel: number | null;
}

/**
 * Parse one raw node row into a {@link MeshNode}. Tolerant/fail-soft — the row
 * carries radio-reported telemetry, so every field is untrusted: a row without a
 * canonical-izable node id is DROPPED (`null`), string fields are trimmed +
 * capped, `batteryPct` is clamped into 0..101, `snr` must be finite, `hopsAway`
 * must be a non-negative integer, and a malformed timestamp becomes `null`.
 *
 * <p>`online` prefers the server's own boolean (mesh-bff derives it from its
 * configured window) and falls back to the local 5-minute derivation when the
 * field is missing or not a boolean — so a mocked or older BFF still shows an
 * accurate online state instead of marking every radio offline.
 *
 * @param raw   one element of the wire array
 * @param nowMs injectable clock for the `online` fallback, so the parse is unit-testable
 */
export function parseMeshNode(raw: unknown, nowMs: number = Date.now()): MeshNode | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const nodeId = typeof o['nodeId'] === 'string' ? normalizeMeshNodeId(o['nodeId']) : null;
  if (nodeId === null) {
    return null;
  }
  const lastSeenAt = meshTimestamp(o['lastSeenAt']);
  return {
    nodeId,
    longName: meshString(o['longName'], MAX_MESH_NAME_LENGTH),
    shortName: meshString(o['shortName'], MAX_MESH_NAME_LENGTH),
    lastSeenAt,
    batteryPct: meshBatteryPct(o['batteryPct']),
    snr: meshSnr(o['snr']),
    hopsAway: meshHops(o['hopsAway']),
    viaDevice: meshViaDevice(o['viaDevice']),
    online: typeof o['online'] === 'boolean' ? o['online'] : meshIsOnline(lastSeenAt, nowMs),
    registeredTo: meshString(o['registeredTo'], MAX_MESH_OWNER_LENGTH),
  };
}

/**
 * Parse one raw room row into a {@link MeshRoom}. A row without a usable
 * `roomId` is DROPPED; `meshChannel` must be a non-negative integer (the LoRa
 * channel index) or it is treated as unknown.
 */
export function parseMeshRoom(raw: unknown): MeshRoom | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const roomId = meshString(o['roomId'], MAX_MESH_ROOM_ID_LENGTH);
  if (roomId === null) {
    return null;
  }
  const channel = o['meshChannel'];
  return {
    roomId,
    device: meshViaDevice(o['device']),
    meshChannel: typeof channel === 'number' && Number.isInteger(channel) && channel >= 0 ? channel : null,
  };
}

/**
 * The human label for a LoRa channel index: index 0 is the mesh's
 * `Primary/Broadcast` channel (every Meshtastic radio joins it by default);
 * every other index is `Channel N`. An unknown index reads `Unknown channel` —
 * never a bare number, which would be meaningless next to the named primary.
 */
export function meshChannelLabel(meshChannel: number | null | undefined): string {
  if (typeof meshChannel !== 'number' || !Number.isInteger(meshChannel) || meshChannel < 0) {
    return 'Unknown channel';
  }
  return meshChannel === 0 ? 'Primary/Broadcast' : `Channel ${meshChannel}`;
}

/**
 * Pull the row array out of a directory response body. The live mesh-bff-api
 * answers an ENVELOPE — `{nodes: [...], source: "..."}` / `{rooms: [...]}` —
 * while the published contract (and every hand-rolled mock) is often a BARE
 * array, so both are accepted and anything else degrades to an empty list rather
 * than throwing inside a template.
 */
function rowsOf(body: unknown, key: 'nodes' | 'rooms'): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object') {
    const wrapped = (body as Record<string, unknown>)[key];
    if (Array.isArray(wrapped)) return wrapped;
  }
  return [];
}

/** 403: the session is fine but the caller lacks ROLE_MESH (a 401 reads as "sign in" via {@link meshDeniedNote}). */
const FORBIDDEN_NOTE =
  'Your account does not have mesh access yet — ask an administrator for the mesh role.';

/**
 * Talks to the mesh BFF (hugmesh-mesh-bff-api, behind the fe-gateway at
 * `/bff/mesh/**`) — the read-only, cache-backed directory of every LoRa radio
 * and mesh-enabled room the bridge knows about.
 *
 * <p>RxJS {@link BehaviorSubject}-backed (the house datastore mandate): the node
 * directory and the room list are cached in subjects so multiple views observe
 * ONE source of truth. The HTTP transport is the platform `fetch` with
 * `credentials: 'include'` (admin-ui's `BffService` convention), so the HttpOnly
 * `bff_` session cookie rides every request and the gateway's
 * `BffCookieToBearerWebFilter` mints the upstream bearer server-side — the
 * browser never holds a bearer of its own.
 *
 * <p><b>FAIL-SOFT CONTRACT.</b> No method here ever throws or rejects. A
 * non-2xx, a network error or an unparseable body leaves the LAST GOOD list in
 * place and publishes a human note on the matching `*Note` observable, which the
 * page renders as a degraded banner. That is why the reads do NOT simply resolve
 * to `[]` the way a stateless wrapper would: an empty list and an unreachable
 * BFF are different facts and the UI must be able to say which one it is.
 *
 * <p>Endpoints (mesh-bff-api {@code MeshDirectoryController} @ `/bff/mesh`,
 * {@code @PreAuthorize hasAnyRole('MESH','ADMIN','SUPERADMIN')}):
 * <pre>
 *   GET /bff/mesh/nodes            → loadNodes()
 *   GET /bff/mesh/rooms            → loadRooms()
 *   GET /bff/mesh/status/{nodeId}  → refreshNode(nodeId)
 * </pre>
 */
@Injectable({ providedIn: 'root' })
export class MeshBffService {
  private readonly base = `${BFF_BASE}/bff/mesh`;

  private readonly nodesSubject = new BehaviorSubject<MeshNode[]>([]);
  private readonly nodesNoteSubject = new BehaviorSubject<string>('');
  private readonly nodeStatusNoteSubject = new BehaviorSubject<string>('');
  private readonly roomsSubject = new BehaviorSubject<MeshRoom[]>([]);
  private readonly roomsNoteSubject = new BehaviorSubject<string>('');

  /** The cached mesh node directory (latest successful read). */
  readonly nodes: Observable<MeshNode[]> = this.nodesSubject.asObservable();
  /** Degradation note for the node directory; `''` when the last read succeeded. */
  readonly nodesNote: Observable<string> = this.nodesNoteSubject.asObservable();
  /**
   * Degradation note for the LAST per-row status read ({@link refreshNode});
   * `''` when it succeeded. Deliberately separate from {@link nodesNote}: one
   * row refreshing fine says nothing about the directory read, and one row
   * answering 404 is not a directory outage.
   */
  readonly nodeStatusNote: Observable<string> = this.nodeStatusNoteSubject.asObservable();
  /** The cached mesh-enabled room list (latest successful read). */
  readonly rooms: Observable<MeshRoom[]> = this.roomsSubject.asObservable();
  /** Degradation note for the room list; `''` when the last read succeeded. */
  readonly roomsNote: Observable<string> = this.roomsNoteSubject.asObservable();

  /**
   * GET `/bff/mesh/nodes` — load the node directory and push it onto
   * {@link nodes}. On any failure the cached list is left untouched and
   * {@link nodesNote} carries the reason; the resolved value is then whatever is
   * currently cached, so a caller can always `await` this without a try/catch.
   */
  async loadNodes(): Promise<MeshNode[]> {
    const body = await this.read(`${this.base}/nodes`, this.nodesNoteSubject, 'mesh node directory');
    if (body === undefined) {
      return this.nodesSubject.value;
    }
    const now = Date.now();
    const nodes = rowsOf(body, 'nodes')
      .map((row) => parseMeshNode(row, now))
      .filter((n): n is MeshNode => n !== null);
    this.nodesSubject.next(nodes);
    // A fresh directory supersedes whatever one row last said.
    this.nodeStatusNoteSubject.next('');
    return nodes;
  }

  /**
   * GET `/bff/mesh/rooms` — load the mesh-enabled room list and push it onto
   * {@link rooms}. Same fail-soft contract as {@link loadNodes}.
   */
  async loadRooms(): Promise<MeshRoom[]> {
    const body = await this.read(`${this.base}/rooms`, this.roomsNoteSubject, 'mesh channel list');
    if (body === undefined) {
      return this.roomsSubject.value;
    }
    const rooms = rowsOf(body, 'rooms')
      .map(parseMeshRoom)
      .filter((r): r is MeshRoom => r !== null);
    this.roomsSubject.next(rooms);
    return rooms;
  }

  /**
   * GET `/bff/mesh/status/{nodeId}` — re-read ONE node and splice it into the
   * cached directory, so a per-row "refresh" costs one small request instead of
   * a whole directory reload. Returns the refreshed row, or `null` when the node
   * is unknown (404), the read failed, or the body did not parse — in which case
   * the cached row is left exactly as it was. The outcome is reported on
   * {@link nodeStatusNote}, never on {@link nodesNote}.
   *
   * <p>A node id that is not a node id at all is rejected locally (no request is
   * made): the path variable is never built from unvalidated user input.
   */
  async refreshNode(nodeId: string): Promise<MeshNode | null> {
    const canonical = normalizeMeshNodeId(nodeId);
    if (canonical === null) {
      return null;
    }
    const body = await this.read(
      `${this.base}/status/${encodeURIComponent(canonical)}`,
      this.nodeStatusNoteSubject,
      'node status',
    );
    if (body === undefined) {
      return null;
    }
    const node = parseMeshNode(body);
    if (node === null) {
      return null;
    }
    const current = this.nodesSubject.value;
    const index = current.findIndex((n) => n.nodeId === node.nodeId);
    // An unknown node id is APPENDED rather than dropped: the directory snapshot
    // this UI holds may predate the row the status endpoint just resolved.
    this.nodesSubject.next(
      index === -1 ? [...current, node] : current.map((n, i) => (i === index ? node : n)),
    );
    return node;
  }

  /**
   * Shared fail-soft read. Resolves to the parsed JSON body on a 2xx, or
   * `undefined` on ANY failure (non-2xx, network error, unparseable body) after
   * publishing a human note on `noteSubject`. Never throws — a dead BFF degrades
   * a section, it does not produce an unhandled rejection.
   *
   * @param url         the same-origin BFF URL to read
   * @param noteSubject where the degradation note is published (cleared on success)
   * @param surface     the human name of the surface, woven into the note
   */
  private async read(
    url: string,
    noteSubject: BehaviorSubject<string>,
    surface: string,
  ): Promise<unknown | undefined> {
    let response: Response;
    try {
      response = await fetch(url, { credentials: 'include' });
    } catch {
      // Network-level failure (offline, DNS, TLS, aborted) — never a rejection.
      noteSubject.next(`Could not reach the ${surface} — check your connection and try again.`);
      return undefined;
    }
    if (!response.ok) {
      noteSubject.next(
        response.status === 401 || response.status === 403
          ? meshDeniedNote(response.status, FORBIDDEN_NOTE)
          : `The ${surface} is unavailable right now (server said ${response.status}) — anything shown may be out of date.`,
      );
      return undefined;
    }
    try {
      const body: unknown = await response.json();
      noteSubject.next('');
      return body;
    } catch {
      noteSubject.next(`The ${surface} returned something this page could not read — try again later.`);
      return undefined;
    }
  }
}
