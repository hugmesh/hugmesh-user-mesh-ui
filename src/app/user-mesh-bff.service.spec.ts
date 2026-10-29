import { parseMeshDevice } from './user-mesh-bff.service';

/** Pure-parser specs; the HTTP paths are covered through MyDevicesComponent. */
describe('parseMeshDevice', () => {
  it('canonicalises the node id and defaults unknown vocabulary safely', () => {
    const device = parseMeshDevice({
      id: 'dev-1', nodeId: '!A1B2C3D4', label: '  Backpack  ', visibility: 'everyone', state: 'weird',
      lastSeenAt: '2026-10-28T12:00:00Z', batteryPct: 250.4, snr: 'loud', hopsAway: 2, viaDevice: 'gw 1',
    });
    expect(device).toEqual({
      id: 'dev-1',
      nodeId: '!a1b2c3d4',
      label: 'Backpack',
      visibility: 'private',
      state: 'active',
      revokeReason: null,
      lastSeenAt: '2026-10-28T12:00:00Z',
      batteryPct: 101,
      snr: null,
      hopsAway: 2,
      viaDevice: null,
    });
  });

  it('keeps a revoked row with its reason', () => {
    const device = parseMeshDevice({ id: 'dev-2', nodeId: 'deadbeef', state: 'revoked', revokeReason: 'spoofing' });
    expect(device?.state).toBe('revoked');
    expect(device?.revokeReason).toBe('spoofing');
    expect(device?.label).toBeNull();
  });

  it('drops rows without an id or a node id', () => {
    expect(parseMeshDevice({ nodeId: '!a1b2c3d4' })).toBeNull();
    expect(parseMeshDevice({ id: 'dev-3', nodeId: 'nope' })).toBeNull();
    expect(parseMeshDevice(null)).toBeNull();
    expect(parseMeshDevice('dev-3')).toBeNull();
  });
});
