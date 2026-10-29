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
});
