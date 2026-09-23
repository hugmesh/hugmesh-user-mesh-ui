import { Routes } from '@angular/router';
import { NodesComponent } from './nodes.component';
import { MyDevicesComponent } from './my-devices.component';
import { ChannelsComponent } from './channels.component';
import { meshGuard } from './mesh.guard';

/**
 * Routes exposed by the Mesh dashboard native-federation remote (`./routes`).
 * The hugmesh.net host mounts these at `/user-mesh`, giving:
 *
 * - `/user-mesh`          → {@link NodesComponent}     — the mesh node directory
 *   (every LoRa radio the bridge has heard), the default landing view.
 * - `/user-mesh/devices`  → {@link MyDevicesComponent} — the caller's OWN claimed
 *   radios: claim / release / per-device visibility / live status.
 * - `/user-mesh/channels` → {@link ChannelsComponent}  — the mesh-enabled chat
 *   rooms and which LoRa channel each one bridges.
 *
 * ROLE_MESH is enforced upstream by the `gateway_route_access` row on
 * `/user-mesh/**` and again server-side by the mesh-bff-api
 * (`hasAnyRole('MESH','ADMIN','SUPERADMIN')`) and user-bff-api
 * (`hasRole('USER')`). {@link meshGuard} is applied here as `canActivate` for
 * defence-in-depth: it prevents loading the mesh UI for callers who cannot use
 * it, for both the host-mounted and standalone / dev-shell builds.
 */
export const USER_MESH_ROUTES: Routes = [
  { path: '', component: NodesComponent, canActivate: [meshGuard] },
  { path: 'devices', component: MyDevicesComponent, canActivate: [meshGuard] },
  { path: 'channels', component: ChannelsComponent, canActivate: [meshGuard] },
];
