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

## Publishing a New Version

There are two ways to publish a new version:

### Method 1: Using Git Tags (Recommended)

1. Update the version in `package.json`
2. Commit the changes: `git commit -am "Bump version to x.y.z"`
3. Create a git tag: `git tag vx.y.z` (e.g., `git tag v0.1.1`)
4. Push the tag: `git push origin vx.y.z`

This will automatically trigger the GitHub Actions workflow, which will:

- Build the native binaries for all platforms and architectures
- Package them together
- Publish to npm

### Method 2: Using Manual Workflow Dispatch

1. Go to your GitHub repository
2. Navigate to Actions > "Build and Publish" workflow
3. Click "Run workflow"
4. Enter the version number (e.g., `0.1.1`)
5. Click "Run workflow"

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

3. Publishes the package to npm

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
