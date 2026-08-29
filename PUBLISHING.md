# Publishing node-cpal

This document describes how to publish `node-cpal` 1.x and its optional backend packages using GitHub Actions.

## Prerequisites

Before you can publish, you need to:

1. Have a GitHub repository for the project
2. Have an npm account with publish access to the `node-cpal` package
3. Configure npm trusted publishing for both release workflows

## Configuring npm Trusted Publishing

1. Log in to npmjs.com and open the `node-cpal` package settings.
2. Under **Trusted publishing**, select **GitHub Actions**.
3. Configure a publisher for the core package with:

   - Organization or user: `saeta-eth`
   - Repository: `node-cpal`
   - Workflow filename: `build-and-publish.yml`
   - Environment: leave empty
   - Allowed action: `npm publish`

4. Save the trusted publisher configuration using interactive 2FA.

Repeat this for each scoped backend package using workflow filename
`build-backends.yml`. The packages are:

- `@node-cpal/backend-jack`
- `@node-cpal/backend-pipewire`
- `@node-cpal/backend-pulseaudio`
- `@node-cpal/backend-asio`

The publish job authenticates with a short-lived GitHub Actions OIDC token. It
does not use an `NPM_TOKEN` repository secret.

## Preparing a New Version

1. Update the version in `package.json` and `package-lock.json`.
2. Keep the version synchronized in `Cargo.toml`, `Cargo.lock`,
   `examples/package.json`, and every `packages/backend-*/package.json`.
3. Commit the release preparation and ensure CI passes.
4. Run both **Build, Package, and Publish** and **Build and Publish Optional
   Backends** manually with the intended version.
5. Download and inspect the `npm-package` and `backend-package-*` artifacts.
   Manual runs never publish to npm.

## Publishing a New Version

1. Create a git tag from the prepared commit: `git tag vx.y.z` (for example,
   `git tag v1.0.0`).
2. Push the tag: `git push origin vx.y.z`.

This triggers both release workflows, which will:

- Build the native binaries for all platforms and architectures
- Verify that every binary matches its declared platform and architecture
- Package and upload the exact npm tarball
- Publish the core tarball and four independently built backend tarballs to npm

## Running a Dry Run

1. Go to your GitHub repository.
2. Run Actions > **Build, Package, and Publish**.
3. Run Actions > **Build and Publish Optional Backends**.
4. Enter the intended version or keep `0.0.0-dry-run` in each workflow.

The workflows build and verify every native binary, assemble the npm tarballs,
and upload them as artifacts. Publish jobs are skipped for manual runs.

## Workflow Details

The GitHub Actions workflow:

1. Builds the native addon on multiple platforms and architectures:

   - Windows (x64)
   - macOS (x64 and ARM64/Apple Silicon)
   - Linux (x64 and ARM64)

2. Creates a core package structure that includes:

   - A platform-independent loader (`index.js`)
   - The platform-independent CPAL value layer (`cpal-values.js`)
   - TypeScript definitions (`index.d.ts`)
   - The CPAL parity audit under `docs/`
   - Platform-specific binaries in the `bin` directory

3. Uploads the npm tarball for inspection
4. Publishes only when the workflow was triggered by a `v*` tag

The optional backend workflow additionally:

1. Builds JACK on macOS, Linux, and Windows.
2. Builds PipeWire and PulseAudio on Linux.
3. Builds ASIO on Windows with the Steinberg SDK and LLVM.
4. Assembles each backend's binaries with the matching manifest under
   `packages/`.
5. Dry-runs all four scoped packages before making their artifacts publishable.

## How It Works

The package uses a simple approach to support multiple platforms:

1. When a user installs a core or backend package, they get:

   - The main `index.js` file
   - Pre-built binaries for all supported platforms in the `bin` directory

2. When that package is required, `index.js` automatically:
   - Detects the user's platform and architecture
   - Loads the appropriate binary from the `bin` directory
   - Provides a structured error if no compatible binary is found

Each companion is a complete node-cpal API build, not a runtime plugin loaded
into the core native module. Applications import the selected package directly.

## Troubleshooting

If the workflow fails:

1. Check the GitHub Actions logs for errors
2. Common issues include:
   - Missing dependencies on build machines
   - Compilation errors on specific platforms
   - npm authentication issues

For npm authentication issues, verify that the trusted publisher values match
the repository and workflow filename exactly and that the publish job has
`id-token: write` permission.
