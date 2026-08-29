# Optional backend package manifests

These manifests define the separately published node-cpal variants. Release automation copies the root JavaScript facade, declarations, documentation, examples, and the matching feature-enabled native binaries into each package before running `npm pack`.

| Directory | Cargo feature | Published package |
| --- | --- | --- |
| `backend-jack` | `backend-jack` | `@node-cpal/backend-jack` |
| `backend-pipewire` | `backend-pipewire` | `@node-cpal/backend-pipewire` |
| `backend-pulseaudio` | `backend-pulseaudio` | `@node-cpal/backend-pulseaudio` |
| `backend-asio` | `backend-asio` | `@node-cpal/backend-asio` |

The directories intentionally contain manifests rather than checked-in native artifacts. `index.node`, `target/`, and assembled package directories remain generated release outputs.
