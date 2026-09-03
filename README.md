# WiFi Drop

WiFi Drop is a lightweight Windows app for sending text, photos, and files from an iPhone to a PC over the same local Wi-Fi network.

No iPhone app, no account, no cloud. Open WiFi Drop on Windows, scan the QR code with the iPhone camera, and send from Safari.

![WiFi Drop desktop screenshot](docs/screenshots/desktop.png)

![WiFi Drop iPhone screenshot](docs/screenshots/iphone.png)

## Features

- Send text from iPhone Safari to a Windows PC.
- Send photos and files through the browser file picker.
- Scan a temporary QR code generated at app launch.
- Keep transfers on the local network.
- Save received files in `Documents\WiFi Drop`.
- Open the received folder from the desktop app.
- Regenerate the QR code to invalidate the previous drop link.

## How It Works

WiFi Drop starts a local HTTP server on the Windows PC, usually on port `8787`.

The desktop app shows:

- a private dashboard link for the PC
- a QR code containing a temporary drop link
- a list of received text snippets and files

The iPhone opens the drop link in Safari. The mobile page has two separate modes:

- `Text`: sends only the text field.
- `File`: sends only selected files. Text left in the text tab is not included.

## Install

Download the latest Windows installer from the Releases page and run:

```text
WiFi Drop_0.1.0_x64-setup.exe
```

Windows may show a SmartScreen warning until the app is code-signed.

## Development

Requirements:

- Windows 10 or later
- Node.js
- Rust via rustup
- Microsoft Visual Studio Build Tools with the C++ workload
- WebView2 Runtime

Install dependencies:

```powershell
npm install
```

Run in development:

```powershell
npm run dev
```

Build the Windows installer:

```powershell
npm run build
```

The installer is generated in:

```text
src-tauri\target\release\bundle\nsis\
```

## Security Notes

WiFi Drop is designed for trusted local networks.

- The QR code contains a random token generated at launch.
- Regenerating the QR invalidates the previous drop link.
- The app does not upload files to external servers.
- Anyone on the same Wi-Fi with the active QR link can send files while the app is running.

## License

MIT
