# hugmesh-user-mesh-ui — builds the Mesh dashboard native-federation REMOTE
# (src → dist/user-mesh) and serves it via nginx with CORS so the
# hugmesh.systems host can fetch its remoteEntry.json cross-origin.
# Deployed to the hugmesh-frontend namespace, fronted by the fe-gateway at
# /user-mesh (StripPrefix=1). Casdoor ROLE_MESH-gated by the host + the
# gateway_route_access row; the mesh-bff/user-bff re-check server-side.
# Angular CLI 22 requires Node >= 24.15.
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:user-mesh

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/user-mesh/browser /usr/share/nginx/html
EXPOSE 80
