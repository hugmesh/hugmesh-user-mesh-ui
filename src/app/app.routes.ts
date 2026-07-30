import { Routes } from '@angular/router';
import { USER_MESH_ROUTES } from './user-mesh.routes';

/**
 * Dev-shell routes for standalone development (`ng serve user-mesh`). Mounts the
 * federated {@link USER_MESH_ROUTES} at the root so the mesh dashboard is fully
 * browsable without the host shell. The host shell ignores this file and loads
 * `./routes` (USER_MESH_ROUTES) directly via the native-federation manifest.
 */
export const routes: Routes = [{ path: '', children: USER_MESH_ROUTES }];
