// REMOTE bundle config for the Mesh dashboard micro-frontend (native-federation
// remote name "user-mesh"). The hugmesh.net host consumes the single
// exposed `./routes` module via loadRemoteModule({ remoteName: 'user-mesh',
// exposedModule: './routes' }) and mounts USER_MESH_ROUTES at /user-mesh — so the
// remote name and the exposed module key MUST stay unchanged or the host's mesh
// dashboard breaks.
//
// The shared-deps surface + RxJS skip list live in ./federation-base.js so a
// change to the federation contract lands in one file, consistent with the host
// and every other HugMesh remote (games convention) — this file is the
// user-mesh analog of hugmesh-mod-ui/federation.config.js.
const { hugmeshRemote } = require('./federation-base');

module.exports = hugmeshRemote({
  name: 'user-mesh',
  exposes: {
    './routes': './src/app/user-mesh.routes.ts',
  },
});
