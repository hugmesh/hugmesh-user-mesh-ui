import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ChannelsComponent } from './channels.component';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('ChannelsComponent', () => {
  let fixture: ComponentFixture<ChannelsComponent>;
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
      imports: [ChannelsComponent],
      providers: [provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(ChannelsComponent);
  });

  it('groups rooms by LoRa channel, primary first, unknown last', async () => {
    fetchSpy.and.resolveTo(jsonResponse({
      rooms: [
        { roomId: '!zeta:example.org', device: 'gateway-02', meshChannel: 2 },
        { roomId: '!alpha:example.org', device: 'gateway-01', meshChannel: 0 },
        { roomId: '!beta:example.org', device: null, meshChannel: 0 },
        { roomId: '!orphan:example.org', device: 'gateway-01', meshChannel: null },
        { roomId: '', device: 'dropped', meshChannel: 1 },
      ],
    }));
    fixture.detectChanges();
    await settle();

    expect(fetchSpy).toHaveBeenCalledWith('/bff/mesh/rooms', { credentials: 'include' });
    const el: HTMLElement = fixture.nativeElement;
    const groups = [...el.querySelectorAll('section.channel')].map((s) => s.getAttribute('data-testid'));
    expect(groups).toEqual(['mesh-channel-0', 'mesh-channel-2', 'mesh-channel-unknown']);
    const primary = el.querySelector('[data-testid="mesh-channel-0"]') as HTMLElement;
    expect(primary.querySelector('h3')?.textContent).toContain('Primary/Broadcast');
    const primaryRooms = [...primary.querySelectorAll('li.room')].map((li) => li.getAttribute('data-testid'));
    expect(primaryRooms).toEqual(['mesh-room-!alpha:example.org', 'mesh-room-!beta:example.org']);
    expect(primary.textContent).toContain('bridged by');
    expect(primary.textContent).toContain('bridge radio unknown');
    expect(el.querySelector('[data-testid="mesh-channel-2"] h3')?.textContent).toContain('Channel 2');
    expect(el.querySelector('[data-testid="mesh-channels-count"]')?.textContent).toContain('4 mesh-enabled rooms');
  });

  it('shows the empty state when nothing is bridged', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ rooms: [] }));
    fixture.detectChanges();
    await settle();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="mesh-channels-empty"]')).not.toBeNull();
    expect(el.querySelector('section.channel')).toBeNull();
  });

  it('shows the degraded banner when the read fails at the network level', async () => {
    fetchSpy.and.rejectWith(new TypeError('offline'));
    fixture.detectChanges();
    await settle();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="mesh-channels-note"]')?.textContent).toContain('Could not reach');
    expect(el.querySelector('[data-testid="mesh-channels-empty"]')).toBeNull();
  });
});
