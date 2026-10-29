import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MeshBffService, MeshNode } from './mesh-bff.service';
import { MeshNavComponent } from './mesh-nav.component';
import {
  MeshAvatarColors,
  meshAvatarColors,
  meshAvatarText,
  meshBatteryLabel,
  meshBatteryLevel,
  meshBatteryScreenReaderLabel,
  meshHopLabel,
  meshLastHeardLabel,
  meshNodeDisplayName,
  meshSignalLevel,
  meshSignalPercent,
  meshSignalScreenReaderLabel,
  meshTextMatches,
} from './mesh-format';

/**
 * The mesh node directory — every LoRa radio the mesh↔Matrix bridge has heard —
 * and the default landing view of the dashboard (`/user-mesh`).
 *
 * Data comes from {@link MeshBffService.nodes} (one cached source of truth,
 * `GET /bff/mesh/nodes`); this component only subscribes it into a signal, keeps
 * a client-side text filter, and offers a per-row refresh
 * (`GET /bff/mesh/status/{nodeId}`) plus a whole-directory reload. Every cell is
 * formatted by the pure helpers in `mesh-format.ts`, and every colour-coded cell
 * (online dot, battery, signal) carries a text equivalent for screen readers.
 *
 * FAIL-SOFT: the service never throws; a dead BFF shows the last good directory
 * under a degraded banner ({@link MeshBffService.nodesNote}) rather than an
 * empty page that reads as "no radios".
 */
@Component({
  selector: 'hug-mesh-nodes',
  standalone: true,
  imports: [FormsModule, MeshNavComponent],
  templateUrl: './nodes.component.html',
  styleUrl: './nodes.component.scss',
})
export class NodesComponent implements OnInit {
  private readonly bff = inject(MeshBffService);
  private readonly destroyRef = inject(DestroyRef);

  /** The cached directory, mirrored from the service. */
  readonly nodes = signal<MeshNode[]>([]);
  /** Degradation note for the directory ('' = the last read succeeded). */
  readonly note = signal('');
  /** Note from the last per-row refresh ('' = it succeeded); separate from {@link note}. */
  readonly refreshNote = signal('');
  /** `true` while the first directory read is in flight (drives the "loading" row). */
  readonly loading = signal(true);
  /** The node ids whose per-row refresh is in flight (several rows may refresh at once). */
  readonly refreshing = signal<ReadonlySet<string>>(new Set());
  /** Client-side filter text (name, short name, node id, owner). */
  readonly query = signal('');

  /** The rows matching {@link query}; online radios first, then by name. */
  readonly visible = computed(() => {
    const q = this.query();
    return this.nodes()
      .filter((n) => meshTextMatches(q, n.longName, n.shortName, n.nodeId, n.registeredTo))
      .sort((a, b) => {
        if (a.online !== b.online) return a.online ? -1 : 1;
        return this.displayName(a).localeCompare(this.displayName(b));
      });
  });
  readonly onlineCount = computed(() => this.nodes().filter((n) => n.online).length);

  ngOnInit(): void {
    const nodesSub = this.bff.nodes.subscribe((rows) => this.nodes.set(rows));
    const noteSub = this.bff.nodesNote.subscribe((note) => this.note.set(note));
    const refreshNoteSub = this.bff.nodeStatusNote.subscribe((note) => this.refreshNote.set(note));
    this.destroyRef.onDestroy(() => {
      nodesSub.unsubscribe();
      noteSub.unsubscribe();
      refreshNoteSub.unsubscribe();
    });
    void this.reload();
  }

  /** Re-read the whole directory. */
  async reload(): Promise<void> {
    this.loading.set(true);
    try {
      await this.bff.loadNodes();
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Re-read ONE row (cheap) — the row is spliced into the cache by the service.
   * A row already refreshing is left alone; other rows may refresh meanwhile.
   */
  async refresh(node: MeshNode): Promise<void> {
    if (this.refreshing().has(node.nodeId)) return;
    // Signals compare by identity: always publish a NEW set, never mutate one.
    this.refreshing.update((ids) => new Set(ids).add(node.nodeId));
    try {
      await this.bff.refreshNode(node.nodeId);
    } finally {
      this.refreshing.update((ids) => {
        const next = new Set(ids);
        next.delete(node.nodeId);
        return next;
      });
    }
  }

  // ── Presentation helpers (thin wrappers so the template stays declarative) ──

  displayName(node: MeshNode): string {
    return meshNodeDisplayName(node.longName, node.nodeId);
  }

  avatar(node: MeshNode): MeshAvatarColors | null {
    return meshAvatarColors(node.nodeId);
  }

  avatarText(node: MeshNode): string {
    return meshAvatarText(node.shortName, node.longName, node.nodeId);
  }

  lastHeard(node: MeshNode): string {
    return meshLastHeardLabel(node.lastSeenAt);
  }

  hops(node: MeshNode): string {
    return meshHopLabel(node.hopsAway, node.viaDevice) ?? '—';
  }

  batteryLevel(node: MeshNode): string | null {
    return meshBatteryLevel(node.batteryPct);
  }

  batteryLabel(node: MeshNode): string | null {
    return meshBatteryLabel(node.batteryPct);
  }

  batterySr(node: MeshNode): string {
    return meshBatteryScreenReaderLabel(node.batteryPct) ?? '';
  }

  signalLevel(node: MeshNode): string | null {
    return meshSignalLevel(node.snr);
  }

  signalPercent(node: MeshNode): number {
    return meshSignalPercent(node.snr) ?? 0;
  }

  signalSr(node: MeshNode): string {
    return meshSignalScreenReaderLabel(node.snr) ?? '';
  }
}
