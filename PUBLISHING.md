# Publishing node-cpal

This document describes how to publish `node-cpal` 1.x as one npm package. The
root entry point contains CPAL's platform-default build, and optional CPAL
backends are exposed through `node-cpal/backend-*` subpaths in the same tarball.

## Prerequisites

1. Have publish access to the existing `node-cpal` npm package.
2. Configure npm trusted publishing for the GitHub Actions release workflow.
3. Keep the required backend SDKs and system packages in the workflow current.

## Configuring npm trusted publishing

Open the `node-cpal` package settings on npm and configure one GitHub Actions
trusted publisher:

- Organization or user: `saeta-eth`
- Repository: `node-cpal`
- Workflow filename: `build-and-publish.yml`
- Environment: leave empty
- Allowed action: `npm publish`

The publish job receives a short-lived GitHub Actions OIDC token. It does not
use an `NPM_TOKEN` repository secret, and no additional npm packages or trusted
publishers are required for the backend subpaths.

## Preparing a version

1. Synchronize the version in `package.json`, `package-lock.json`, `Cargo.toml`,
   `Cargo.lock`, and `examples/package.json`.
2. Update the migration guide, public declarations, examples, and CPAL parity
   audit when applicable.
3. Commit the release preparation and wait for CI to pass.
4. Manually run **Build, Package, and Publish** with the intended version.
5. Download and inspect the `npm-package` artifact. Manual runs build the exact
   package but never publish it.

The tarball must contain:

- The common JavaScript facade and TypeScript declarations.
- Default binaries for macOS x64/arm64, Linux x64/arm64, and Windows x64.
- JACK binaries for those same five targets.
- PipeWire and PulseAudio binaries for Linux x64/arm64.
- An ASIO binary for Windows x64.
- Documentation, examples, and the CPAL parity audit.

Verify each binary with `scripts/verify-native-binary.js`, inspect the output of
`npm pack --dry-run`, and exercise the root and supported backend entry points
from the extracted tarball.

## Publishing a version

Create and push a `v*` tag from the exact commit whose dry-run artifact passed:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The tag triggers **Build, Package, and Publish** again. The workflow rebuilds
and verifies every binary, assembles one `node-cpal` tarball, dry-runs npm
publication, and publishes only after every preceding job succeeds.

After publication:

1. Confirm `npm view node-cpal@1.0.0` reports the expected metadata.
2. Install the version in a clean temporary project.
3. Require `node-cpal` and every backend subpath supported by that runner.
4. Create the matching GitHub release from the published tag.

## Backend requirements

Backend-specific binaries are isolated behind subpaths so missing optional
libraries do not prevent `require('node-cpal')` from loading.

- JACK builds dynamically load the JACK client library at runtime. Linux builds
  still need JACK development metadata during compilation.
- PipeWire and PulseAudio builds require their Linux development packages and
  corresponding runtime services/libraries.
- ASIO compilation requires the Steinberg ASIO SDK and LLVM/Clang; using the
  backend requires an installed ASIO driver.

The workflow installs build prerequisites. End users remain responsible for
backend runtime libraries, services, and drivers.

## Troubleshooting

If a release fails, inspect the failed matrix job before retrying. Common causes
include unavailable system packages, upstream SDK changes, native linkage
errors, binary architecture mismatches, and npm trusted-publisher settings that
do not exactly match the workflow filename. Never move a tag to bypass a failed
release; fix the cause, increment the version if npm accepted the package, and
run the full validation again.
