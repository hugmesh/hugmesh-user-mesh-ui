/**
 * Ambient declarations for the runtime-config globals that native-federation's
 * host shell may inject onto `globalThis` before this remote bootstraps, so
 * each remote can be pointed at a different BFF backend without a rebuild.
 * Shared by every file that reads one of these globals so they don't each need
 * their own `as any` cast or local `declare const`. Mirrors
 * hugmesh-admin-ui/src/app/runtime-config.d.ts.
 */
declare const __SNAP_BFF_URL__: string | undefined;
