import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink, RouterLinkActive } from '@angular/router';

/**
 * The three-tab navigation shared by every mesh dashboard page. Links are
 * RELATIVE to the route the remote is mounted on (`route.parent ?? route`), so
 * they resolve to `/user-mesh/...` under the host shell and to `/...` in the
 * standalone dev shell without either host hard-coding the other's prefix.
 * (An absolute `['/devices']` would miss under the host, whose router owns `/`.)
 */
@Component({
  selector: 'hug-mesh-nav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav class="mesh-nav" aria-label="Mesh dashboard sections" data-testid="mesh-nav">
      <a class="nav-link" routerLink="./" [relativeTo]="mount" routerLinkActive="active"
         [routerLinkActiveOptions]="{ exact: true }" ariaCurrentWhenActive="page"
         data-testid="mesh-nav-nodes">Nodes</a>
      <a class="nav-link" routerLink="devices" [relativeTo]="mount" routerLinkActive="active"
         ariaCurrentWhenActive="page" data-testid="mesh-nav-devices">My devices</a>
      <a class="nav-link" routerLink="channels" [relativeTo]="mount" routerLinkActive="active"
         ariaCurrentWhenActive="page" data-testid="mesh-nav-channels">Channels</a>
    </nav>
  `,
  styles: `
    :host {
      display: block;
    }

    .mesh-nav {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-bottom: 1rem;
      border-bottom: 1px solid var(--hug-border);
      padding-bottom: 0.5rem;
    }

    .nav-link {
      display: inline-flex;
      align-items: center;
      min-height: 2.75rem;
      padding: 0 1rem;
      border-radius: 0.5rem;
      border: 1px solid transparent;
      color: var(--hug-text);
      text-decoration-line: underline;

      &.active {
        border-color: var(--hug-accent);
        background: var(--hug-bg-1);
        text-decoration-line: none;
        font-weight: 700;
      }

      &:hover {
        border-color: var(--hug-accent);
      }
    }
  `,
})
export class MeshNavComponent {
  private readonly route = inject(ActivatedRoute);
  /** The route the remote's routes hang off — the mount point in both hosts. */
  readonly mount: ActivatedRoute = this.route.parent ?? this.route;
}
