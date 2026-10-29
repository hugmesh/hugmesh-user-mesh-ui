import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { MeshBffService, MeshRoom, meshChannelLabel } from './mesh-bff.service';
import { MeshNavComponent } from './mesh-nav.component';

/**
 * The mesh-enabled chat rooms (`/user-mesh/channels`) and which LoRa channel
 * each one bridges. Read-only: a room is made mesh-enabled by its bridge
 * configuration, not from here. Data comes from {@link MeshBffService.rooms}
 * (`GET /bff/mesh/rooms`, domain-scoped server-side), grouped by channel so a
 * user can see at a glance which rooms share the Primary/Broadcast channel.
 */
@Component({
  selector: 'hug-mesh-channels',
  standalone: true,
  imports: [MeshNavComponent],
  templateUrl: './channels.component.html',
  styleUrl: './channels.component.scss',
})
export class ChannelsComponent implements OnInit {
  private readonly bff = inject(MeshBffService);
  private readonly destroyRef = inject(DestroyRef);

  readonly rooms = signal<MeshRoom[]>([]);
  readonly note = signal('');
  readonly loading = signal(true);

  /** Rooms grouped by LoRa channel, primary first, unknown last. */
  readonly groups = computed(() => {
    const byChannel = new Map<number | null, MeshRoom[]>();
    for (const room of this.rooms()) {
      const list = byChannel.get(room.meshChannel) ?? [];
      list.push(room);
      byChannel.set(room.meshChannel, list);
    }
    return [...byChannel.entries()]
      .sort(([a], [b]) => {
        if (a === null) return 1;
        if (b === null) return -1;
        return a - b;
      })
      .map(([channel, rooms]) => ({
        channel,
        label: meshChannelLabel(channel),
        rooms: [...rooms].sort((x, y) => x.roomId.localeCompare(y.roomId)),
      }));
  });

  ngOnInit(): void {
    const roomsSub = this.bff.rooms.subscribe((rows) => this.rooms.set(rows));
    const noteSub = this.bff.roomsNote.subscribe((note) => this.note.set(note));
    this.destroyRef.onDestroy(() => {
      roomsSub.unsubscribe();
      noteSub.unsubscribe();
    });
    void this.reload();
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    try {
      await this.bff.loadRooms();
    } finally {
      this.loading.set(false);
    }
  }

  groupKey(channel: number | null): string {
    return channel === null ? 'unknown' : String(channel);
  }
}
