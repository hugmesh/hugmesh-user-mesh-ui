import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from './session.service';

/**
 * Route guard that restricts the mesh dashboard micro-frontend (`/user-mesh/**`)
 * to callers holding a Casdoor `'mesh'` (or the superset `'admin'` /
 * `'superadmin'`) role. Unauthenticated or insufficiently privileged callers are
 * redirected to `/login`.
 *
 * The guard uses {@link SessionService.isMesh}, which mirrors the mesh-bff-api's
 * server-side `hasAnyRole('MESH','ADMIN','SUPERADMIN')` check and the
 * `gateway_route_access` ROLE_MESH row on `/bff/mesh/**` (the row for the
 * `/user-mesh/**` page path is part of the host-side wiring and is not seeded
 * yet). This is DEFENCE-IN-DEPTH: the gateway + the BFFs remain the
 * authoritative gates; the guard simply prevents loading the mesh UI bundle for
 * users who cannot use it.
 *
 * @see {@link SessionService.isMesh} — the derived role signal this guard consults.
 * @see {@link USER_MESH_ROUTES}      — where this guard is applied.
 */
export const meshGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  const router = inject(Router);
  if (session.isMesh()) return true;
  return router.parseUrl('/login');
};
