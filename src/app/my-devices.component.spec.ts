import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MyDevicesComponent } from './my-devices.component';
import { MESH_DEVICE_VISIBILITIES } from './user-mesh-bff.service';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const DEVICES = [
  {
    id: 'dev-1', nodeId: '!a1b2c3d4', label: 'Backpack radio', visibility: 'channels', state: 'active',
    revokeReason: null, lastSeenAt: new Date(Date.now() - 20_000).toISOString(),
    batteryPct: 82, snr: 4.5, hopsAway: 0, viaDevice: null,
  },
  {
    id: 'dev-2', nodeId: '!deadbeef', label: null, visibility: 'friends', state: 'revoked',
    revokeReason: 'spoofing report', lastSeenAt: null,
    batteryPct: null, snr: null, hopsAway: null, viaDevice: null,
  },
];

describe('MyDevicesComponent', () => {
  let fixture: ComponentFixture<MyDevicesComponent>;
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

  /** Calls made with a given method, as [url, init] pairs. */
  const calls = (method: string): [string, RequestInit][] =>
    fetchSpy.calls.allArgs()
      .filter(([, init]) => ((init as RequestInit | undefined)?.method ?? 'GET') === method)
      .map(([url, init]) => [url as string, init as RequestInit]);

  beforeEach(async () => {
    fetchSpy = spyOn(window, 'fetch');
    await TestBed.configureTestingModule({
      imports: [MyDevicesComponent],
      providers: [provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(MyDevicesComponent);
  });

  it('lists my devices from GET /bff/user/mesh-devices, revoked rows included', async () => {
    fetchSpy.and.resolveTo(jsonResponse(DEVICES));
    fixture.detectChanges();
    await settle();

    expect(fetchSpy).toHaveBeenCalledWith('/bff/user/mesh-devices', { credentials: 'include' });
    const el: HTMLElement = fixture.nativeElement;
    const active = el.querySelector('[data-testid="mesh-device-dev-1"]') as HTMLElement;
    expect(active.textContent).toContain('Backpack radio');
    expect(active.textContent).toContain('!a1b2c3d4');
    expect(active.textContent).toContain('Online');
    expect(active.textContent).toContain('82%');
    expect(active.textContent).toContain('0 hops');
    const select = active.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('channels');
    expect(select.disabled).toBeFalse();

    const revoked = el.querySelector('[data-testid="mesh-device-dev-2"]') as HTMLElement;
    expect(revoked.classList).toContain('revoked');
    expect(revoked.textContent).toContain('Revoked — spoofing report');
    expect(revoked.textContent).toContain('last heard unknown');
    expect((revoked.querySelector('select') as HTMLSelectElement).disabled).toBeTrue();
    // Release stays available on a revoked row.
    expect(revoked.querySelector('[data-testid="mesh-device-release-dev-2"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="mesh-devices-empty"]')).toBeNull();
  });

  it('shows the empty state and the claim form when I own nothing', async () => {
    fetchSpy.and.resolveTo(jsonResponse([]));
    fixture.detectChanges();
    await settle();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="mesh-devices-empty"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="mesh-claim-form"]')).not.toBeNull();
  });

  it('refuses a malformed node id locally without a request', async () => {
    fetchSpy.and.resolveTo(jsonResponse([]));
    fixture.detectChanges();
    await settle();

    fixture.componentInstance.nodeIdInput = 'not-a-node';
    await fixture.componentInstance.claim();
    fixture.detectChanges();

    expect(calls('POST').length).toBe(0);
    expect(fixture.nativeElement.querySelector('[data-testid="mesh-devices-error"]')?.textContent)
      .toContain('exactly 8 hex digits');
  });

  it('claims through POST with the canonical id and reloads the list', async () => {
    fetchSpy.and.resolveTo(jsonResponse([]));
    fixture.detectChanges();
    await settle();

    fetchSpy.and.callFake((input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(init?.method === 'POST' ? jsonResponse(DEVICES[0], 201) : jsonResponse([DEVICES[0]])));
    fixture.componentInstance.nodeIdInput = ' A1B2C3D4 ';
    fixture.componentInstance.labelInput = 'Backpack radio';
    await fixture.componentInstance.claim();
    await settle();

    const [[url, init]] = calls('POST');
    expect(url).toBe('/bff/user/mesh-devices');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body as string)).toEqual({ nodeId: '!a1b2c3d4', label: 'Backpack radio' });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="mesh-device-dev-1"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="mesh-devices-status"]')?.textContent).toContain('Device registered');
    expect(fixture.componentInstance.nodeIdInput).toBe('');
  });

  it('reads a 409 on claim as "already claimed"', async () => {
    fetchSpy.and.resolveTo(jsonResponse([]));
    fixture.detectChanges();
    await settle();

    fetchSpy.and.resolveTo(jsonResponse({ error: 'conflict' }, 409));
    fixture.componentInstance.nodeIdInput = 'a1b2c3d4';
    await fixture.componentInstance.claim();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="mesh-devices-error"]')?.textContent)
      .toContain('already claimed');
  });

  it('reads a 403 on claim as "not allowed", never as "sign in" (capability gate)', async () => {
    fetchSpy.and.resolveTo(jsonResponse([]));
    fixture.detectChanges();
    await settle();

    fetchSpy.and.resolveTo(jsonResponse({ error: 'forbidden' }, 403));
    fixture.componentInstance.nodeIdInput = 'a1b2c3d4';
    await fixture.componentInstance.claim();
    fixture.detectChanges();

    const text = fixture.nativeElement.querySelector('[data-testid="mesh-devices-error"]')?.textContent ?? '';
    expect(text).toContain('not allowed for your account or domain');
    expect(text).not.toContain('signed in');
  });

  it('releases through DELETE /bff/user/mesh-devices/{id}', async () => {
    fetchSpy.and.resolveTo(jsonResponse(DEVICES));
    fixture.detectChanges();
    await settle();

    fetchSpy.and.callFake((input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(init?.method === 'DELETE' ? new Response(null, { status: 204 }) : jsonResponse([DEVICES[0]])));
    (fixture.nativeElement.querySelector('[data-testid="mesh-device-release-dev-2"]') as HTMLButtonElement).click();
    await settle();

    expect(calls('DELETE')[0][0]).toBe('/bff/user/mesh-devices/dev-2');
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="mesh-device-dev-2"]')).toBeNull();
    expect(el.querySelector('[data-testid="mesh-devices-status"]')?.textContent).toContain('Released !deadbeef');
  });

  it('changes visibility optimistically and rolls back when the server refuses', async () => {
    fetchSpy.and.resolveTo(jsonResponse(DEVICES));
    fixture.detectChanges();
    await settle();

    const select = fixture.nativeElement.querySelector('[data-testid="mesh-device-visibility-dev-1"]') as HTMLSelectElement;

    // Accepted: PUT with the new value, list refreshed from the server.
    fetchSpy.and.callFake((input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(init?.method === 'PUT'
        ? jsonResponse({ ...DEVICES[0], visibility: 'private' })
        : jsonResponse([{ ...DEVICES[0], visibility: 'private' }, DEVICES[1]])));
    select.value = 'private';
    select.dispatchEvent(new Event('change'));
    await settle();
    const [[putUrl, putInit]] = calls('PUT');
    expect(putUrl).toBe('/bff/user/mesh-devices/dev-1/visibility');
    expect(JSON.parse(putInit.body as string)).toEqual({ visibility: 'private' });
    expect(fixture.componentInstance.devices()[0].visibility).toBe('private');

    // Refused (404): the signal AND the native control go back to the stored value.
    fetchSpy.and.resolveTo(jsonResponse({}, 404));
    select.value = 'friends';
    select.dispatchEvent(new Event('change'));
    await settle();
    expect(fixture.componentInstance.devices()[0].visibility).toBe('private');
    expect(select.value).toBe('private');
    expect(fixture.nativeElement.querySelector('[data-testid="mesh-devices-error"]')?.textContent)
      .toContain('not in your list');
  });

  it('shows the degraded banner when the list read fails', async () => {
    fetchSpy.and.resolveTo(jsonResponse({}, 401));
    fixture.detectChanges();
    await settle();

    expect(fixture.nativeElement.querySelector('[data-testid="mesh-devices-note"]')?.textContent)
      .toContain('signed in');
  });

  it('does not claim I own nothing when the list read failed', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ error: 'down' }, 500));
    fixture.detectChanges();
    await settle();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="mesh-devices-note"]')?.textContent).toContain('server said 500');
    expect(el.querySelector('[data-testid="mesh-devices-empty"]')).toBeNull();
    // The claim form is still there — registering does not depend on the list.
    expect(el.querySelector('[data-testid="mesh-claim-form"]')).not.toBeNull();
  });

  it('sends one DELETE for a double-clicked Release and disables the button meanwhile', async () => {
    fetchSpy.and.resolveTo(jsonResponse(DEVICES));
    fixture.detectChanges();
    await settle();

    let resolveDelete!: (r: Response) => void;
    fetchSpy.and.callFake((input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'DELETE'
        ? new Promise<Response>((resolve) => (resolveDelete = resolve))
        : Promise.resolve(jsonResponse([DEVICES[0]])));
    const button = fixture.nativeElement.querySelector('[data-testid="mesh-device-release-dev-2"]') as HTMLButtonElement;
    button.click();
    button.click();
    fixture.detectChanges();
    expect(button.disabled).toBeTrue();
    expect(calls('DELETE').length).toBe(1);

    resolveDelete(new Response(null, { status: 204 }));
    await settle();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="mesh-device-dev-2"]')).toBeNull();
    expect(el.querySelector('[data-testid="mesh-devices-status"]')?.textContent).toContain('Released !deadbeef');
    expect(el.querySelector('[data-testid="mesh-devices-error"]')).toBeNull();
  });

  it('disables the visibility select while its change is in flight', async () => {
    fetchSpy.and.resolveTo(jsonResponse(DEVICES));
    fixture.detectChanges();
    await settle();

    let resolvePut!: (r: Response) => void;
    fetchSpy.and.callFake((input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'PUT'
        ? new Promise<Response>((resolve) => (resolvePut = resolve))
        : Promise.resolve(jsonResponse([{ ...DEVICES[0], visibility: 'private' }, DEVICES[1]])));
    const select = fixture.nativeElement.querySelector('[data-testid="mesh-device-visibility-dev-1"]') as HTMLSelectElement;
    select.value = 'private';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(select.disabled).toBeTrue();
    expect(calls('PUT').length).toBe(1);

    resolvePut(jsonResponse({ ...DEVICES[0], visibility: 'private' }));
    await settle();
    expect(select.disabled).toBeFalse();
    expect(select.value).toBe('private');
  });

  it('rolls back only the refused row, never a device released in the meantime', async () => {
    fetchSpy.and.resolveTo(jsonResponse(DEVICES));
    fixture.detectChanges();
    await settle();

    // PUT for dev-1 is held; the DELETE of dev-2 and the reload it triggers
    // complete first, so the list no longer has dev-2.
    let resolvePut!: (r: Response) => void;
    fetchSpy.and.callFake((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') return new Promise<Response>((resolve) => (resolvePut = resolve));
      if (init?.method === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(jsonResponse([DEVICES[0]]));
    });
    const el: HTMLElement = fixture.nativeElement;
    const select = el.querySelector('[data-testid="mesh-device-visibility-dev-1"]') as HTMLSelectElement;
    select.value = 'private';
    select.dispatchEvent(new Event('change'));
    (el.querySelector('[data-testid="mesh-device-release-dev-2"]') as HTMLButtonElement).click();
    await settle();
    expect(el.querySelector('[data-testid="mesh-device-dev-2"]')).toBeNull();

    // Now the server refuses the visibility change.
    resolvePut(jsonResponse({}, 404));
    await settle();
    expect(fixture.componentInstance.devices().map((d) => d.id)).toEqual(['dev-1']);
    expect(fixture.componentInstance.devices()[0].visibility).toBe('channels');
    expect(select.value).toBe('channels');
    expect(el.querySelector('[data-testid="mesh-device-dev-2"]')).toBeNull();
  });

  it('offers exactly the visibilities the service exports', async () => {
    fetchSpy.and.resolveTo(jsonResponse(DEVICES));
    fixture.detectChanges();
    await settle();

    expect(fixture.componentInstance.visibilities).toBe(MESH_DEVICE_VISIBILITIES);
    const options = [...fixture.nativeElement.querySelectorAll('[data-testid="mesh-device-visibility-dev-1"] option')]
      .map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual([...MESH_DEVICE_VISIBILITIES]);
  });
});
