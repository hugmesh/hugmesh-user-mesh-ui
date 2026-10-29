import {
  MESH_ONLINE_WINDOW_MS,
  meshAvatarColors,
  meshAvatarText,
  meshBatteryLabel,
  meshBatteryLevel,
  meshBatteryPct,
  meshBatteryScreenReaderLabel,
  meshHopLabel,
  meshHops,
  meshIsOnline,
  meshLastHeardLabel,
  meshNodeDisplayName,
  meshNodeIdSuffix,
  meshNodeNumber,
  meshRelativeTime,
  meshSignalLevel,
  meshSignalPercent,
  meshSignalScreenReaderLabel,
  meshSnr,
  meshString,
  meshTextMatches,
  meshTimestamp,
  meshViaDevice,
  normalizeMeshNodeId,
} from './mesh-format';
import { meshChannelLabel } from './mesh-bff.service';

/**
 * Pure-function specs for the presentation/validation helpers. No TestBed: every
 * function is side-effect free and clock-injectable, so these run as plain
 * Jasmine. The fixed clock keeps the relative-time cases deterministic.
 */
describe('mesh-format', () => {
  const NOW = Date.parse('2026-10-28T12:00:00Z');
  const ago = (ms: number): string => new Date(NOW - ms).toISOString();

  describe('normalizeMeshNodeId', () => {
    it('accepts 8 hex digits with or without the ! prefix and folds case', () => {
      expect(normalizeMeshNodeId('a1b2c3d4')).toBe('!a1b2c3d4');
      expect(normalizeMeshNodeId('!A1B2C3D4')).toBe('!a1b2c3d4');
      expect(normalizeMeshNodeId('  !a1B2c3D4 ')).toBe('!a1b2c3d4');
    });

    it('rejects anything that is not exactly 8 hex digits', () => {
      expect(normalizeMeshNodeId('')).toBeNull();
      expect(normalizeMeshNodeId('a1b2c3d')).toBeNull();
      expect(normalizeMeshNodeId('a1b2c3d4e')).toBeNull();
      expect(normalizeMeshNodeId('g1b2c3d4')).toBeNull();
      expect(normalizeMeshNodeId('!!a1b2c3d4')).toBeNull();
    });
  });

  describe('node number, suffix and display name', () => {
    it('parses the node number out of the hex id', () => {
      expect(meshNodeNumber('!00000010')).toBe(16);
      expect(meshNodeNumber('!ffffffff')).toBe(0xffffffff);
      expect(meshNodeNumber('nope')).toBeNull();
    });

    it('uses the uppercased last four hex digits as the short handle', () => {
      expect(meshNodeIdSuffix('!a1b2c3d4')).toBe('C3D4');
      expect(meshNodeIdSuffix('bad')).toBeNull();
    });

    it('prefers the long name, then the suffix, then a literal fallback', () => {
      expect(meshNodeDisplayName('Ridge repeater', '!a1b2c3d4')).toBe('Ridge repeater');
      expect(meshNodeDisplayName('   ', '!a1b2c3d4')).toBe('C3D4');
      expect(meshNodeDisplayName(null, 'garbage')).toBe('unknown node');
    });
  });

  describe('avatar badge', () => {
    it('derives the badge colour from the low 24 bits and picks readable text', () => {
      expect(meshAvatarColors('!00ffffff')).toEqual({ background: '#ffffff', foreground: '#000000' });
      expect(meshAvatarColors('!00000000')).toEqual({ background: '#000000', foreground: '#ffffff' });
      expect(meshAvatarColors('!ff123456')).toEqual({ background: '#123456', foreground: '#ffffff' });
    });

    it('returns null for a non-node-id so the caller renders an untinted badge', () => {
      expect(meshAvatarColors('zzz')).toBeNull();
    });

    it('prints at most four characters, short name first', () => {
      expect(meshAvatarText('RDG1', 'Ridge repeater', '!a1b2c3d4')).toBe('RDG1');
      expect(meshAvatarText(null, 'Ridge repeater', '!a1b2c3d4')).toBe('Ridg');
      expect(meshAvatarText(' ', null, '!a1b2c3d4')).toBe('C3D4');
    });
  });

  describe('wire guards', () => {
    it('trims, caps and nulls blank strings', () => {
      expect(meshString('  hi  ', 10)).toBe('hi');
      expect(meshString('abcdefgh', 3)).toBe('abc');
      expect(meshString('   ', 10)).toBeNull();
      expect(meshString(42, 10)).toBeNull();
    });

    it('clamps battery into 0..101 and rejects non-finite values', () => {
      expect(meshBatteryPct(82.4)).toBe(82);
      expect(meshBatteryPct(250)).toBe(101);
      expect(meshBatteryPct(-5)).toBe(0);
      expect(meshBatteryPct(Number.NaN)).toBeNull();
      expect(meshBatteryPct('82')).toBeNull();
    });

    it('requires a finite SNR and an integer hop count', () => {
      expect(meshSnr(4.5)).toBe(4.5);
      expect(meshSnr(Number.POSITIVE_INFINITY)).toBeNull();
      expect(meshHops(2)).toBe(2);
      expect(meshHops(2.5)).toBeNull();
      expect(meshHops(-1)).toBe(0);
    });

    it('keeps only parseable timestamps and hostname-ish device ids', () => {
      expect(meshTimestamp('2026-10-28T12:00:00Z')).toBe('2026-10-28T12:00:00Z');
      expect(meshTimestamp('yesterday')).toBeNull();
      expect(meshViaDevice('gateway-01')).toBe('gateway-01');
      expect(meshViaDevice('gate way')).toBeNull();
    });
  });

  describe('last heard and online', () => {
    it('renders coarse relative ages and treats clock skew as just now', () => {
      expect(meshRelativeTime(ago(10_000), NOW)).toBe('just now');
      expect(meshRelativeTime(ago(5 * 60_000), NOW)).toBe('5m ago');
      expect(meshRelativeTime(ago(3 * 3_600_000), NOW)).toBe('3h ago');
      expect(meshRelativeTime(ago(2 * 86_400_000), NOW)).toBe('2d ago');
      expect(meshRelativeTime(new Date(NOW + 60_000).toISOString(), NOW)).toBe('just now');
      expect(meshRelativeTime(null, NOW)).toBeNull();
    });

    it('never leaves the last-heard cell blank', () => {
      expect(meshLastHeardLabel(undefined, NOW)).toBe('unknown');
      expect(meshLastHeardLabel(ago(60_000), NOW)).toBe('1m ago');
    });

    it('is online only inside the window', () => {
      expect(meshIsOnline(ago(MESH_ONLINE_WINDOW_MS - 1), NOW)).toBeTrue();
      expect(meshIsOnline(ago(MESH_ONLINE_WINDOW_MS), NOW)).toBeFalse();
      expect(meshIsOnline(null, NOW)).toBeFalse();
    });
  });

  describe('hops, battery and signal labels', () => {
    it('prefers the hop count over the relaying device', () => {
      expect(meshHopLabel(1, 'gateway-01')).toBe('1 hop');
      expect(meshHopLabel(3, null)).toBe('3 hops');
      expect(meshHopLabel(null, 'gateway-01')).toBe('via gateway-01');
      expect(meshHopLabel(null, null)).toBeNull();
    });

    it('buckets battery with the 101 = powered marker', () => {
      expect(meshBatteryLevel(101)).toBe('powered');
      expect(meshBatteryLevel(90)).toBe('good');
      expect(meshBatteryLevel(50)).toBe('fair');
      expect(meshBatteryLevel(20)).toBe('poor');
      expect(meshBatteryLevel(null)).toBeNull();
      expect(meshBatteryLabel(101)).toBe('powered');
      expect(meshBatteryLabel(82)).toBe('82%');
      expect(meshBatteryScreenReaderLabel(101)).toBe('externally powered');
      expect(meshBatteryScreenReaderLabel(15)).toBe('battery 15%, poor');
    });

    it('buckets SNR with the Meshtastic thresholds and meter mapping', () => {
      expect(meshSignalLevel(0)).toBe('good');
      expect(meshSignalLevel(-10)).toBe('fair');
      expect(meshSignalLevel(-20)).toBe('poor');
      expect(meshSignalLevel(null)).toBeNull();
      expect(meshSignalPercent(4.5)).toBe(73);
      expect(meshSignalPercent(-30)).toBe(0);
      expect(meshSignalPercent(40)).toBe(100);
      expect(meshSignalScreenReaderLabel(4.5)).toBe('SNR 4.5 dB, 73 percent, good');
    });
  });

  describe('meshChannelLabel', () => {
    it('names the primary channel and numbers the rest', () => {
      expect(meshChannelLabel(0)).toBe('Primary/Broadcast');
      expect(meshChannelLabel(3)).toBe('Channel 3');
      expect(meshChannelLabel(null)).toBe('Unknown channel');
      expect(meshChannelLabel(-1)).toBe('Unknown channel');
    });
  });

  describe('meshTextMatches', () => {
    it('matches case-insensitively across fields and treats a blank query as match-all', () => {
      expect(meshTextMatches('ridge', 'Ridge repeater', null)).toBeTrue();
      expect(meshTextMatches('C3D4', '!a1b2c3d4')).toBeTrue();
      expect(meshTextMatches('   ', null, undefined)).toBeTrue();
      expect(meshTextMatches('zzz', 'Ridge repeater', '!a1b2c3d4')).toBeFalse();
    });
  });
});
