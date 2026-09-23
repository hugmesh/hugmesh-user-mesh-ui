import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';

// Bootstrap the standalone dev-shell application. This file is only executed when
// the remote is served standalone (`ng serve user-mesh`); in production the host
// shell bootstraps its own Angular app and federates `./routes` (USER_MESH_ROUTES)
// directly — this bootstrap is not involved. Session state is read from
// `localStorage` via SessionService (no provider needed — it is
// `providedIn: 'root'`).
//
// There is deliberately NO provideHttpClient() here: BFF services in this
// remote use the platform `fetch` with `credentials: 'include'` — matching
// admin-ui's pattern — so the HttpOnly `bff_` session cookie rides every
// request without an interceptor. The gateway's BffCookieToBearerWebFilter
// mints the upstream bearer server-side. Providing an unused HttpClient would be
// a dead provider in both the dev shell and the federated build.
bootstrapApplication(AppComponent, {
  providers: [provideRouter(routes)],
}).catch((err) => console.error(err));
