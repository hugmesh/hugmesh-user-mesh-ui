import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NodesComponent } from './nodes.component';

/** A JSON `Response` the platform `fetch` would resolve with. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const NODES_BODY = {
  nodes: [
    {
      nodeId: '!a1b2c3d4', longName: 'Ridge repeater', shortName: 'RDG1',
      lastSeenAt: new Date(Date.now() - 30_000).toISOString(),
      batteryPct: 101, snr: 4.5, hopsAway: 1, viaDevice: 'gateway-01', online: true, registeredTo: 'alice',
    },
    {
      nodeId: '!00ffee11', longName: null, shortName: null,
      lastSeenAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
      batteryPct: 15, snr: -20, hopsAway: null, viaDevice: null, online: false, registeredTo: null,
    },
    // Dropped by the parser: no usable node id.
    { nodeId: 'garbage', longName: 'ghost' },
  ],
  source: 'test',
};

describe('NodesComponent', () => {
  let fixture: ComponentFixture<NodesComponent>;
  let fetchSpy: jasmine.Spy;

  // `Response.json()` reads a native stream that zone.js does not track, so
  // `whenStable()` alone resolves before the body has been parsed: flush a few
  // real macrotask turns and then render.
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    fixture.detectChanges();
  };

  beforeEach(async () => {
    fetchSpy = spyOn(window, 'fetch');
    await TestBed.configureTestingModule({
      imports: [NodesComponent],
      providers: [provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(NodesComponent);
  });

  it('renders the directory from GET /bff/mesh/nodes with online radios first', async () => {
    fetchSpy.and.resolveTo(jsonResponse(NODES_BODY));
    fixture.detectChanges();
    await settle();

    expect(fetchSpy).toHaveBeenCalledWith('/bff/mesh/nodes', { credentials: 'include' });
    const el: HTMLElement = fixture.nativeElement;
    const rows = el.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    expect(rows[0].getAttribute('data-testid')).toBe('mesh-node-a1b2c3d4');
    expect(rows[0].textContent).toContain('Ridge repeater');
    expect(rows[0].textContent).toContain('online');
    expect(rows[0].textContent).toContain('powered');
    expect(rows[0].textContent).toContain('1 hop');
    expect(rows[0].textContent).toContain('alice');
    // The unnamed radio falls back to its id suffix and reads as anonymous.
    expect(rows[1].textContent).toContain('EE11');
    expect(rows[1].textContent).toContain('offline');
    expect(rows[1].textContent).toContain('anonymous');
    expect(el.querySelector('[data-testid="mesh-nodes-count"]')?.textContent).toContain('2 of 2 nodes shown · 1 online');
    expect(el.querySelector('[data-testid="mesh-nodes-note"]')).toBeNull();
  });

  it('filters client-side by name, id or owner', async () => {
    fetchSpy.and.resolveTo(jsonResponse(NODES_BODY));
    fixture.detectChanges();
    await settle();

    fixture.componentInstance.query.set('ee11');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('tbody tr').length).toBe(1);
    expect(el.querySelector('tbody tr')?.getAttribute('data-testid')).toBe('mesh-node-00ffee11');

    fixture.componentInstance.query.set('nobody');
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="mesh-nodes-no-match"]')).not.toBeNull();
    expect(el.querySelector('table')).toBeNull();
  });

  it('shows the empty state when the bridge has heard nothing', async () => {
    fetchSpy.and.resolveTo(jsonResponse([]));
    fixture.detectChanges();
    await settle();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="mesh-nodes-empty"]')).not.toBeNull();
    expect(el.querySelector('table')).toBeNull();
  });

  it('shows the degraded banner, not the empty state, when the BFF fails', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ error: 'down' }, 503));
    fixture.detectChanges();
    await settle();

    const el: HTMLElement = fixture.nativeElement;
    const note = el.querySelector('[data-testid="mesh-nodes-note"]');
    expect(note?.textContent).toContain('server said 503');
    expect(el.querySelector('[data-testid="mesh-nodes-empty"]')).toBeNull();
  });

  it('names the missing role on a 403', async () => {
    fetchSpy.and.resolveTo(jsonResponse({}, 403));
    fixture.detectChanges();
    await settle();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="mesh-nodes-note"]')?.textContent).toContain('mesh role');
  });

  it('keeps the hidden spoken labels inside the table clip on a 390px-wide screen', async () => {
    fetchSpy.and.resolveTo(jsonResponse(NODES_BODY));
    const host: HTMLElement = fixture.nativeElement;
    host.style.width = '390px';
    host.style.display = 'block';
    fixture.detectChanges();
    await settle();

    const wrap = host.querySelector('.table-wrap') as HTMLElement;
    // The global `.sr` util is position:absolute; the wrap must be its
    // containing block or the labels widen the document sideways.
    expect(getComputedStyle(wrap).position).toBe('relative');
    const table = wrap.querySelector('table') as HTMLElement;
    expect(table.getBoundingClientRect().width).toBeGreaterThan(390);
    const wrapRect = wrap.getBoundingClientRect();
    expect(wrapRect.width).toBeLessThanOrEqual(390);
    // Each hidden label sits inside the wrap's own scrollable box (its layout
    // position is beyond the visible edge, which is fine: the wrap clips it)
    // and, decisively, nothing widens the host beyond the screen.
    const srs = [...wrap.querySelectorAll('.sr')] as HTMLElement[];
    expect(srs.length).toBeGreaterThan(0);
    for (const sr of srs) {
      expect(sr.getBoundingClientRect().right).toBeLessThanOrEqual(wrapRect.left + wrap.scrollWidth + 1);
    }
    expect(host.scrollWidth).toBeLessThanOrEqual(391);
  });

  it('refreshes one row through GET /bff/mesh/status/{nodeId}', async () => {
    fetchSpy.and.resolveTo(jsonResponse(NODES_BODY));
    fixture.detectChanges();
    await settle();

    fetchSpy.and.resolveTo(jsonResponse({ ...NODES_BODY.nodes[1], longName: 'Valley node', online: true }));
    const button = fixture.nativeElement.querySelector('[data-testid="mesh-node-refresh-00ffee11"]') as HTMLButtonElement;
    button.click();
    await settle();

    expect(fetchSpy).toHaveBeenCalledWith('/bff/mesh/status/!00ffee11', { credentials: 'include' });
    const row = fixture.nativeElement.querySelector('[data-testid="mesh-node-00ffee11"]') as HTMLElement;
    expect(row.textContent).toContain('Valley node');
    expect(row.textContent).toContain('online');
  });

  it('keeps the directory banner up when a single row refresh succeeds', async () => {
    fetchSpy.and.resolveTo(jsonResponse(NODES_BODY));
    fixture.detectChanges();
    await settle();

    // The directory reload fails: the last good rows stay under a banner.
    fetchSpy.and.resolveTo(jsonResponse({ error: 'down' }, 503));
    await fixture.componentInstance.reload();
    await settle();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="mesh-nodes-note"]')?.textContent).toContain('server said 503');
    expect(el.querySelectorAll('tbody tr').length).toBe(2);

    // One row refreshes fine — that says nothing about the directory.
    fetchSpy.and.resolveTo(jsonResponse(NODES_BODY.nodes[1]));
    (el.querySelector('[data-testid="mesh-node-refresh-00ffee11"]') as HTMLButtonElement).click();
    await settle();
    expect(el.querySelector('[data-testid="mesh-nodes-note"]')?.textContent).toContain('server said 503');
  });

  it('reports a failed row refresh beside the row, not as a directory-wide banner', async () => {
    fetchSpy.and.resolveTo(jsonResponse(NODES_BODY));
    fixture.detectChanges();
    await settle();

    fetchSpy.and.resolveTo(jsonResponse({}, 404));
    const el: HTMLElement = fixture.nativeElement;
    (el.querySelector('[data-testid="mesh-node-refresh-00ffee11"]') as HTMLButtonElement).click();
    await settle();

    expect(el.querySelector('[data-testid="mesh-nodes-note"]')).toBeNull();
    expect(el.querySelector('[data-testid="mesh-nodes-refresh-note"]')?.textContent).toContain('server said 404');
    // The next successful refresh clears it again.
    fetchSpy.and.resolveTo(jsonResponse(NODES_BODY.nodes[1]));
    (el.querySelector('[data-testid="mesh-node-refresh-00ffee11"]') as HTMLButtonElement).click();
    await settle();
    expect(el.querySelector('[data-testid="mesh-nodes-refresh-note"]')).toBeNull();
  });

  it('keeps a second row marked as refreshing after the first row finishes', async () => {
    fetchSpy.and.resolveTo(jsonResponse(NODES_BODY));
    fixture.detectChanges();
    await settle();

    const pending = new Map<string, (r: Response) => void>();
    fetchSpy.and.callFake((input: RequestInfo | URL) =>
      new Promise<Response>((resolve) => pending.set(String(input), resolve)));
    const el: HTMLElement = fixture.nativeElement;
    const buttonA = el.querySelector('[data-testid="mesh-node-refresh-a1b2c3d4"]') as HTMLButtonElement;
    const buttonB = el.querySelector('[data-testid="mesh-node-refresh-00ffee11"]') as HTMLButtonElement;
    buttonA.click();
    buttonB.click();
    fixture.detectChanges();
    expect(buttonA.disabled).toBeTrue();
    expect(buttonB.disabled).toBeTrue();

    pending.get('/bff/mesh/status/!a1b2c3d4')!(jsonResponse(NODES_BODY.nodes[0]));
    await settle();
    expect(buttonA.disabled).toBeFalse();
    expect(buttonB.disabled).toBeTrue();
    expect(buttonB.textContent).toContain('Refreshing');

    pending.get('/bff/mesh/status/!00ffee11')!(jsonResponse(NODES_BODY.nodes[1]));
    await settle();
    expect(buttonB.disabled).toBeFalse();
    expect(buttonB.textContent).toContain('Refresh');
    expect(buttonB.textContent).not.toContain('Refreshing');
  });

  it('reads a 401 as "signed out", not as a missing mesh role', async () => {
    fetchSpy.and.resolveTo(jsonResponse({}, 401));
    fixture.detectChanges();
    await settle();

    const text = fixture.nativeElement.querySelector('[data-testid="mesh-nodes-note"]')?.textContent ?? '';
    expect(text).toContain('signed in');
    expect(text).not.toContain('mesh role');
  });

  it('gives an unknown battery or signal a spoken label, not an aria-label on a span', async () => {
    fetchSpy.and.resolveTo(jsonResponse([
      { nodeId: '!0badcafe', longName: 'Quiet node', batteryPct: null, snr: null, online: false },
    ]));
    fixture.detectChanges();
    await settle();

    const row = fixture.nativeElement.querySelector('[data-testid="mesh-node-0badcafe"]') as HTMLElement;
    const cells = row.querySelectorAll('td');
    // Battery is the 3rd cell, signal the 4th (Status, Last heard, Battery, Signal, …).
    const battery = cells[2];
    const signal = cells[3];
    expect(battery.querySelector('.sr')?.textContent).toContain('battery unknown');
    expect(signal.querySelector('.sr')?.textContent).toContain('signal unknown');
    // The dash itself is decoration: hidden from the accessibility tree, never named.
    expect(row.querySelector('[aria-label="battery unknown"]')).toBeNull();
    expect(row.querySelector('[aria-label="signal unknown"]')).toBeNull();
    expect(battery.querySelector('[aria-hidden="true"]')?.textContent).toContain('—');
    expect(signal.querySelector('[aria-hidden="true"]')?.textContent).toContain('—');
  });
});
