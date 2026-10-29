import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MeshNavComponent } from './mesh-nav.component';
import {
  MAX_MESH_LABEL_LENGTH,
  meshBatteryLabel,
  meshBatteryLevel,
  meshBatteryScreenReaderLabel,
  meshHopLabel,
  meshIsOnline,
  meshLastHeardLabel,
  meshSignalLevel,
  meshSignalScreenReaderLabel,
} from './mesh-format';
import {
  MeshDevice,
  MeshDeviceVisibility,
  UserMeshBffService,
  isMeshDeviceVisibility,
} from './user-mesh-bff.service';

/**
 * The caller's OWN claimed radios (`/user-mesh/devices`): claim a node id,
 * release one, change who may see each radio's status, and read its live
 * status. Backed by {@link UserMeshBffService} (user-bff-api
 * `/bff/user/mesh-devices`), the service that owns claiming — the shared
 * directory on the Nodes page comes from the mesh BFF instead.
 *
 * Mirrors the mesh-devices section of matrix-ui's user settings, which talks
 * to the same endpoints: the same validation (node id normalised locally, a
 * non-id never leaves the browser), the same 409 reading ("already claimed" /
 * "revoked, visibility frozen"), and the same rule that a revoked row stays
 * listed and can still be released.
 */
@Component({
  selector: 'hug-mesh-my-devices',
  standalone: true,
  imports: [FormsModule, MeshNavComponent],
  templateUrl: './my-devices.component.html',
  styleUrl: './my-devices.component.scss',
})
export class MyDevicesComponent implements OnInit {
  private readonly bff = inject(UserMeshBffService);
  private readonly destroyRef = inject(DestroyRef);

  readonly maxLabelLength = MAX_MESH_LABEL_LENGTH;
  readonly visibilities: readonly MeshDeviceVisibility[] = ['private', 'friends', 'channels'];

  /** My devices, mirrored from the service (with an optimistic overlay during a visibility change). */
  readonly devices = signal<MeshDevice[]>([]);
  /** Degradation note for the list ('' = the last read succeeded). */
  readonly note = signal('');
  /** `true` while the first list read is in flight. */
  readonly loading = signal(true);
  /** Non-blocking error from the last write ('' = none). */
  readonly error = signal('');
  /** Non-blocking confirmation from the last write ('' = none). */
  readonly status = signal('');
  /** `true` while a claim is in flight (the form is disabled meanwhile). */
  readonly claiming = signal(false);

  nodeIdInput = '';
  labelInput = '';

  ngOnInit(): void {
    const devicesSub = this.bff.devices.subscribe((rows) => this.devices.set(rows));
    const noteSub = this.bff.devicesNote.subscribe((note) => this.note.set(note));
    this.destroyRef.onDestroy(() => {
      devicesSub.unsubscribe();
      noteSub.unsubscribe();
    });
    void this.reload();
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    try {
      await this.bff.loadDevices();
    } finally {
      this.loading.set(false);
    }
  }

  /** Claim the typed node id. The service refuses a non-id locally (no request). */
  async claim(): Promise<void> {
    this.error.set('');
    this.status.set('');
    this.claiming.set(true);
    try {
      const result = await this.bff.claim(this.nodeIdInput, this.labelInput);
      if (result.ok) {
        this.nodeIdInput = '';
        this.labelInput = '';
        this.status.set('Device registered.');
      } else {
        this.error.set(result.note);
      }
    } finally {
      this.claiming.set(false);
    }
  }

  /** Release one of my devices (works on revoked rows too). */
  async release(device: MeshDevice): Promise<void> {
    this.error.set('');
    this.status.set('');
    const result = await this.bff.release(device.id);
    if (result.ok) {
      this.status.set(`Released ${this.deviceName(device)}.`);
    } else {
      this.error.set(result.note);
    }
  }

  /**
   * Change a device's visibility OPTIMISTICALLY: the select reflects the choice
   * at once and is rolled back (list and control both) if the server refuses.
   */
  async onVisibilityChange(device: MeshDevice, event: Event): Promise<void> {
    const select = event.target as HTMLSelectElement;
    const value = select.value;
    if (!isMeshDeviceVisibility(value) || value === device.visibility) return;
    const before = this.devices();
    this.devices.set(before.map((d) => (d.id === device.id ? { ...d, visibility: value } : d)));
    this.error.set('');
    this.status.set('');
    const result = await this.bff.setVisibility(device.id, value);
    if (result.ok) {
      this.status.set(`${this.deviceName(device)} is now ${value}.`);
    } else {
      this.devices.set(before);
      // The native control keeps the user's pick even after the signal reverts;
      // put it back explicitly so what is shown matches what is stored.
      select.value = device.visibility;
      this.error.set(result.note);
    }
  }

  // ── Presentation helpers ──

  /** The row label: the user's own label, else the node id. */
  deviceName(device: MeshDevice): string {
    return device.label ?? device.nodeId;
  }

  online(device: MeshDevice): boolean {
    return meshIsOnline(device.lastSeenAt);
  }

  lastHeard(device: MeshDevice): string {
    return meshLastHeardLabel(device.lastSeenAt);
  }

  hops(device: MeshDevice): string | null {
    return meshHopLabel(device.hopsAway, device.viaDevice);
  }

  batteryLevel(device: MeshDevice): string | null {
    return meshBatteryLevel(device.batteryPct);
  }

  batteryLabel(device: MeshDevice): string | null {
    return meshBatteryLabel(device.batteryPct);
  }

  batterySr(device: MeshDevice): string {
    return meshBatteryScreenReaderLabel(device.batteryPct) ?? '';
  }

  signalLevel(device: MeshDevice): string | null {
    return meshSignalLevel(device.snr);
  }

  signalSr(device: MeshDevice): string {
    return meshSignalScreenReaderLabel(device.snr) ?? '';
  }

  visibilityLabel(v: MeshDeviceVisibility): string {
    return v.charAt(0).toUpperCase() + v.slice(1);
  }
}
