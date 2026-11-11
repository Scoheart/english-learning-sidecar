# Always-on local service (macOS)

Running `npm start` in an open Terminal is enough for the MVP. For a companion that starts at login and restarts after a crash, macOS `launchd` is a straightforward choice.

> This is a *local* always-available service, not a cloud daemon. It runs while your Mac/user session is active and stops when your machine is off. Model calls happen **only** for captured events.

1. Determine absolute paths with `which node` and `pwd` from the project directory.
2. Create `~/Library/LaunchAgents/app.english-sidecar.plist` with your paths:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>app.english-sidecar</string>
  <key>ProgramArguments</key>
  <array>
    <string>/absolute/path/to/node</string>
    <string>/absolute/path/to/english-learning-sidecar/src/index.js</string>
  </array>
  <key>WorkingDirectory</key><string>/absolute/path/to/english-learning-sidecar</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>/absolute/path/to/sidecar-stdout.log</string>
  <key>StandardErrorPath</key><string>/absolute/path/to/sidecar-stderr.log</string>
</dict>
</plist>
```

3. Start it:

```bash
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/app.english-sidecar.plist"
```

4. Stop it if needed:

```bash
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/app.english-sidecar.plist"
```

Avoid running both the LaunchAgent and `npm start` on the same port. Keep logs inside a protected local directory and rotate them if necessary. If you use another OS, configure an equivalent per-user service manager; a Windows integration is not yet included.
