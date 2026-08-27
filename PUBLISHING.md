# Publishing node-cpal

This document describes how to publish new versions of the `node-cpal` package to npm using GitHub Actions.

## Prerequisites

Before you can publish, you need to:

1. Have a GitHub repository for the project
2. Have an npm account with publish access to the `node-cpal` package
3. Add your npm token as a GitHub secret named `NPM_TOKEN`

## Adding the NPM_TOKEN Secret

1. Generate an npm access token:

   - Log in to npm: `npm login`
   - Create a new token: `npm token create --read-only=false`
   - Copy the generated token

2. Add the token to GitHub repository secrets:
   - Go to your GitHub repository
   - Navigate to Settings > Secrets and variables > Actions
   - Click "New repository secret"
   - Name: `NPM_TOKEN`
   - Value: Paste your npm token
   - Click "Add secret"

## Preparing a New Version

1. Update the version in `package.json` and `package-lock.json`.
2. Keep the version synchronized in `Cargo.toml`, `Cargo.lock`, and
   `examples/package.json`.
3. Commit the release preparation and ensure CI passes.
4. Run the **Build, Package, and Publish** workflow manually with the intended
   version.
5. Download and inspect the `npm-package` artifact. Manual runs never publish
   to npm.

## Publishing a New Version

1. Create a git tag from the prepared commit: `git tag vx.y.z` (for example,
   `git tag v0.2.0`).
2. Push the tag: `git push origin vx.y.z`.

This will automatically trigger the GitHub Actions workflow, which will:

- Build the native binaries for all platforms and architectures
- Verify that every binary matches its declared platform and architecture
- Package and upload the exact npm tarball
- Publish that tarball to npm

## Running a Dry Run

1. Go to your GitHub repository
2. Navigate to Actions > "Build, Package, and Publish" workflow
3. Click "Run workflow"
4. Enter the intended version or keep `0.0.0-dry-run`
5. Click "Run workflow"

The workflow builds and verifies every native binary, assembles the npm
tarball, and uploads it as the `npm-package` artifact. The publish job is
skipped for manual runs.

## Workflow Details

The GitHub Actions workflow:

1. Builds the native addon on multiple platforms and architectures:

   - Windows (x64)
   - macOS (x64 and ARM64/Apple Silicon)
   - Linux (x64 and ARM64)

2. Creates a package structure that includes:

   - A platform-independent loader (`index.js`)
   - TypeScript definitions (`index.d.ts`)
   - Platform-specific binaries in the `bin` directory

3. Uploads the npm tarball for inspection
4. Publishes only when the workflow was triggered by a `v*` tag

## How It Works

The package uses a simple approach to support multiple platforms:

1. When a user installs the package, they get:

   - The main `index.js` file
   - Pre-built binaries for all supported platforms in the `bin` directory

2. When the package is required, `index.js` automatically:
   - Detects the user's platform and architecture
   - Loads the appropriate binary from the `bin` directory
   - Provides a helpful error message if no compatible binary is found

## Troubleshooting

If the workflow fails:

1. Check the GitHub Actions logs for errors
2. Common issues include:
   - Missing dependencies on build machines
   - Compilation errors on specific platforms
   - npm authentication issues

For npm authentication issues, verify that your `NPM_TOKEN` secret is correctly set and has publish permissions.
