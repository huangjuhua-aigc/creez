# Creez Sandbox Resources

This directory is packaged into the Electron app as `resources/sandbox`.

The current implementation installs the Creez sandbox policy layer with the app.
Platform-native runners can be added under:

- `win32/` for Windows native sandboxing
- `darwin/` for macOS Seatbelt sandboxing
- `linux/` for Linux bubblewrap/Landlock sandboxing

