[🇮🇹 **Leggi in Italiano**](README.it.md)

# WiFi Drop

WiFi Drop is a lightweight Windows app for sending text, photos, and files between an iPhone and a PC over the same local Wi-Fi network.

No iPhone app, no account, no cloud. Open WiFi Drop on Windows, scan the QR code with the iPhone camera, and transfer from Safari.

![WiFi Drop desktop screenshot](docs/screenshots/desktop.png)

![WiFi Drop iPhone screenshot](docs/screenshots/iphone.png)

## Features

- Send text from iPhone Safari to a Windows PC.
- Send photos and files through the browser file picker.
- Send text and files back from the Windows dashboard to the iPhone.
- Scan a temporary QR code generated at app launch.
- Use the UI in Italian, English, Spanish, French, German, Portuguese, Chinese, Japanese, and Korean.
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
- a Send to iPhone section for preparing text and files from the PC

The iPhone opens the drop link in Safari. The mobile page has two separate modes:

- `Text`: sends only the text field.
- `File`: sends only selected files. Text left in the text tab is not included.

The same mobile page also shows a `From PC` section. Text prepared on Windows can be copied on the iPhone, and files prepared on Windows can be opened or downloaded from Safari.

The interface follows the browser or system language automatically, and both the Windows dashboard and iPhone page include a compact language selector.

## Download & Installation

### 1. Download
Go to the **[Releases](../../releases)** section on GitHub and download the latest installer:

```text
WiFi Drop_0.1.0_x64-setup.exe
```

### 2. Windows SmartScreen Notice
Since WiFi Drop is an open-source tool without an expensive corporate code-signing certificate, Windows Defender SmartScreen may display an alert on first launch (*"Windows protected your PC"* / *"Unknown publisher"*):
1. Click **More info**.
2. Click **Run anyway**.

> The app is completely open source and local — you can inspect the full source code directly in this repository.

### 3. Windows Firewall Prompt
When starting WiFi Drop for the first time, Windows may ask for network permissions:
- Check **Private networks (home or work networks)**.
- Click **Allow access**.
- Both your PC and your iPhone must be connected to the same local Wi-Fi network.

### 4. How to Use
1. Launch **WiFi Drop** on Windows.
2. Open the **Camera app** on your iPhone and point it at the QR code on your PC screen.
3. Tap the yellow link that appears in the camera viewfinder to open WiFi Drop in Safari.
4. Start sending or receiving text and files immediately!

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
