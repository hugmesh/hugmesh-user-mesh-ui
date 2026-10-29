import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import {
  MAX_MESH_LABEL_LENGTH,
  MAX_REVOKE_REASON_LENGTH,
  meshBatteryPct,
  meshHops,
  meshSnr,
  meshString,
  meshTimestamp,
  meshViaDevice,
  normalizeMeshNodeId,
} from './mesh-format';

/** Same override hook as {@link MeshBffService}: same-origin by default. */
const BFF_BASE: string = (typeof __SNAP_BFF_URL__ !== 'undefined' && __SNAP_BFF_URL__) ? __SNAP_BFF_URL__ : '';

/**
 * Who may see a claimed radio's owner attribution and LoRa status. Mirrors the
 * user-bff-api `mesh_device.visibility` vocabulary. Note that `friends` is
 * stored but NOT enforced as designed by the platform yet (no friendship graph
 * exists); for everyone but the owner it behaves as `private`.
 */
export type MeshDeviceVisibility = 'private' | 'friends' | 'channels';
export const MESH_DEVICE_VISIBILITIES: readonly MeshDeviceVisibility[] = ['private', 'friends', 'channels'];

/** Type guard for {@link MeshDeviceVisibility}. */
export function isMeshDeviceVisibility(value: unknown): value is MeshDeviceVisibility {
  return (MESH_DEVICE_VISIBILITIES as readonly unknown[]).includes(value);
}

/**
 * One Meshtastic radio claimed by the caller — matched to user-bff-api's
 * {@code MeshDevice} record ({@code GET /bff/user/mesh-devices}). `id` is the
 * server row id used for the visibility/release calls; `nodeId` is the canonical
 * `!`+8-lowercase-hex radio id. The status fields are bridge-reported telemetry
 * and are untrusted like every other mesh row. A `revoked` device stays listed
 * (with the moderator's reason when one was given) so the owner can see why
 * their radio is no longer attributed — and can still release it.
 */
export interface MeshDevice {
  id: string;
  nodeId: string;
  label: string | null;
  visibility: MeshDeviceVisibility;
  state: 'active' | 'revoked';
  revokeReason: string | null;
  lastSeenAt: string | null;
  batteryPct: number | null;
  snr: number | null;
  hopsAway: number | null;
  viaDevice: string | null;
}

/**
 * Parse one raw device row into a {@link MeshDevice}. Fail-soft: a row without
 * a usable `id` AND canonical `nodeId` is DROPPED (`null`), an unknown
 * visibility reads as `private` (the safest rendering), and any state other
 * than `revoked` reads as `active`.
 */
export function parseMeshDevice(raw: unknown): MeshDevice | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const id = meshString(o['id'], 128);
  const nodeId = typeof o['nodeId'] === 'string' ? normalizeMeshNodeId(o['nodeId']) : null;
  if (id === null || nodeId === null) {
    return null;
  }
  return {
    id,
    nodeId,
    label: meshString(o['label'], MAX_MESH_LABEL_LENGTH),
    visibility: isMeshDeviceVisibility(o['visibility']) ? o['visibility'] : 'private',
    state: o['state'] === 'revoked' ? 'revoked' : 'active',
    revokeReason: meshString(o['revokeReason'], MAX_REVOKE_REASON_LENGTH),
    lastSeenAt: meshTimestamp(o['lastSeenAt']),
    batteryPct: meshBatteryPct(o['batteryPct']),
    snr: meshSnr(o['snr']),
    hopsAway: meshHops(o['hopsAway']),
    viaDevice: meshViaDevice(o['viaDevice']),
  };
}

/**
 * The outcome of a write. Writes never throw: `ok` is `true` on a 2xx, else
 * `note` carries the sentence the page shows. The status code is kept so a
 * caller can distinguish a conflict (409: someone already holds that node id,
 * or the row is revoked) from everything else without re-parsing prose.
 */
export interface MeshWriteResult {
  ok: boolean;
  status: number;
  note: string;
}

/** The note shown when a call fails because the caller is not signed in / lacks ROLE_USER. */
const FORBIDDEN_NOTE = 'You need to be signed in with a registered account to manage mesh devices.';

/**
 * Talks to user-bff-api's mesh-device endpoints (behind the fe-gateway at
 * `/bff/user/mesh-devices`) — the caller's OWN claimed radios. user-bff owns
 * claiming/registration; the mesh BFF ({@link MeshBffService}) owns the shared
 * directory. Same transport convention as the rest of this remote: platform
 * `fetch` with `credentials: 'include'`, no bearer in the browser.
 *
 * <p>Same fail-soft contract as {@link MeshBffService}: the list read leaves the
 * last good list in place and publishes a note on {@link devicesNote}; every
 * write resolves to a {@link MeshWriteResult} and refreshes the list on success.
 *
 * <p>Endpoints (user-bff-api {@code MeshDeviceController} @ `/bff/user`,
 * {@code @PreAuthorize hasRole('USER')}):
 * <pre>
 *   GET    /bff/user/mesh-devices                      → loadDevices()
 *   POST   /bff/user/mesh-devices {nodeId,label?}      → claim()         409 = already claimed
 *   PUT    /bff/user/mesh-devices/{id}/visibility      → setVisibility() 409 = revoked, 404 = not yours
 *   DELETE /bff/user/mesh-devices/{id}                 → release()       404 = not yours
 * </pre>
 */
@Injectable({ providedIn: 'root' })
export class UserMeshBffService {
  private readonly base = `${BFF_BASE}/bff/user/mesh-devices`;

  private readonly devicesSubject = new BehaviorSubject<MeshDevice[]>([]);
  private readonly devicesNoteSubject = new BehaviorSubject<string>('');

  /** The caller's claimed devices (latest successful read). */
  readonly devices: Observable<MeshDevice[]> = this.devicesSubject.asObservable();
  /** Degradation note for the device list; `''` when the last read succeeded. */
  readonly devicesNote: Observable<string> = this.devicesNoteSubject.asObservable();

  /** GET the caller's devices; on failure the cached list stays and the note explains. */
  async loadDevices(): Promise<MeshDevice[]> {
    let response: Response;
    try {
      response = await fetch(this.base, { credentials: 'include' });
    } catch {
      this.devicesNoteSubject.next('Could not reach your device list — check your connection and try again.');
      return this.devicesSubject.value;
    }
    if (!response.ok) {
      this.devicesNoteSubject.next(
        response.status === 401 || response.status === 403
          ? FORBIDDEN_NOTE
          : `Your device list is unavailable right now (server said ${response.status}) — anything shown may be out of date.`,
      );
      return this.devicesSubject.value;
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      this.devicesNoteSubject.next('Your device list returned something this page could not read — try again later.');
      return this.devicesSubject.value;
    }
    const devices = (Array.isArray(body) ? body : [])
      .map(parseMeshDevice)
      .filter((d): d is MeshDevice => d !== null);
    this.devicesSubject.next(devices);
    this.devicesNoteSubject.next('');
    return devices;
  }

  /**
   * POST a claim for `nodeId` (any accepted spelling; canonicalised here, and a
   * non-node-id is refused locally without a request). `label` is optional and
   * capped at {@link MAX_MESH_LABEL_LENGTH}.
   */
  async claim(nodeId: string, label?: string): Promise<MeshWriteResult> {
    const canonical = normalizeMeshNodeId(nodeId);
    if (canonical === null) {
      return { ok: false, status: 0, note: 'Enter a node id of exactly 8 hex digits, like a1b2c3d4 or !A1B2C3D4.' };
    }
    const trimmed = (label ?? '').trim().slice(0, MAX_MESH_LABEL_LENGTH);
    const body: Record<string, string> = trimmed ? { nodeId: canonical, label: trimmed } : { nodeId: canonical };
    return this.write('POST', this.base, body, {
      409: 'That node id is already claimed — if it is your radio, ask an administrator.',
      400: 'The server rejected that node id or label — check them and try again.',
    });
  }

  /** PUT a new visibility for one of the caller's devices. */
  async setVisibility(id: string, visibility: MeshDeviceVisibility): Promise<MeshWriteResult> {
    if (!isMeshDeviceVisibility(visibility)) {
      return { ok: false, status: 0, note: 'Choose Private, Friends or Channels.' };
    }
    return this.write('PUT', `${this.base}/${encodeURIComponent(id)}/visibility`, { visibility }, {
      409: 'This device was revoked — its visibility can no longer be changed.',
      404: 'That device is not in your list any more — reload the page.',
    });
  }

  /** DELETE (release) one of the caller's devices. Works on revoked rows too. */
  async release(id: string): Promise<MeshWriteResult> {
    return this.write('DELETE', `${this.base}/${encodeURIComponent(id)}`, undefined, {
      404: 'That device is not in your list any more — reload the page.',
    });
  }

  /**
   * Shared fail-soft write. A 2xx refreshes the cached list and resolves `ok`;
   * anything else resolves `ok: false` with the mapped note (a code the caller
   * did not map gets a generic sentence). Never throws.
   */
  private async write(
    method: 'POST' | 'PUT' | 'DELETE',
    url: string,
    body: Record<string, string> | undefined,
    notes: Record<number, string>,
  ): Promise<MeshWriteResult> {
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        credentials: 'include',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      return { ok: false, status: 0, note: 'Could not reach the server — check your connection and try again.' };
    }
    if (response.ok) {
      await this.loadDevices();
      return { ok: true, status: response.status, note: '' };
    }
    const note =
      response.status === 401 || response.status === 403
        ? FORBIDDEN_NOTE
        : (notes[response.status] ?? `The server could not complete that (it said ${response.status}) — try again later.`);
    return { ok: false, status: response.status, note };
  }
}
