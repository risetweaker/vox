# VOX

VOX is a cross-platform desktop utility with a responsive companion web interface. Its interface is designed for Windows, macOS, and Linux; system changes are implemented in isolated native platform modules.

## What is implemented

- Free and Premium catalog import, search, category/risk filters, and metadata display.
- Strict catalog parsing. The only imported fields used are `id`, `name`, `category`, and `risk`; extra fields such as scripts or commands are ignored.
- A review-and-confirm Apply All flow that identifies supported work, requires confirmation, reports per-item outcomes, and explicitly skips unsupported catalog items.
- Eight exact Free/Premium catalog mappings on Windows: IDs 176, 177, 185, 201, 202, 204, 205, and 206. These are current-user visual and Explorer preferences with local rollback records; all other catalog rows remain unsupported.
- One standalone, reviewed Reduce UI Motion action for Windows, macOS, and GNOME/Linux. It is separate from the catalog Apply All allowlist and backs up the previous setting before changing it.
- Platform-specific Windows, macOS, and GNOME/Linux implementations under `src-tauri/src/platform/`.
- Email/password sign-in through the existing VOX website's Netlify Identity service.
- In-app FAQ and dark blue responsive interface.

The supplied JSON files contain metadata rather than apply/undo recipes. Both are bundled in `public/catalogs/` and loaded automatically: Free has 274 entries and Premium has 842, despite the Premium file's `600` filename. The current catalog parser accepts the supplied `{ "app", "count", "tweaks": [...] }` shape and compares the declared count with actual records rather than trusting its filename. Users can still import an updated JSON file from the Optimize screen.

## Requirements and development

- Node.js 20.19+ (or 22.12+) and npm
- Rust stable and the platform prerequisites for Tauri 2
- On Linux, Tauri's WebKitGTK/build dependencies; the verified system action currently requires GNOME with `gsettings`

```sh
npm install
npm run dev
npm test
npm run build
```

To run the desktop application, use `npm run tauri -- dev`. Build a desktop bundle with `npm run tauri -- build`. Tauri's target toolchains must be installed on each target OS; this project does not claim that a build made on one OS can directly produce native installers for every other OS.

The web build is a preview and catalog browser. System settings can only be changed from the native desktop build.

## Windows executable

The **Build Windows executable** GitHub Actions workflow produces an x64 `vox.exe` artifact when manually run from the repository's Actions tab. Download the `vox-windows-exe` artifact and launch `vox.exe` on Windows. The executable is unsigned, so Windows may display a SmartScreen warning; no installer or code-signing certificate is currently provided.

## Catalog import

The bundled Free and Premium catalogs appear automatically in the Optimize screen. Use **Import Free JSON** or **Import Premium JSON** to replace a bundled catalog with an updated file. Parsing is local to the app. Files have a 2 MB limit, a 2,000-record limit, duplicate IDs and invalid metadata are rejected, and unknown fields are discarded. Catalog names, categories, and risks are displayed as text only.

Catalog presence and an entry's low/medium/high risk label do not make a tweak safe. The exact ID/name/category/risk tuples for IDs 176, 177, 185, 201, 202, 204, 205, and 206 are the only imported mappings; they are available on Windows only. Each action uses fixed registry paths and value names, validates prior values, and stores its rollback data locally. Showing hidden files does not change Windows' separate protected-operating-system-files setting. The standalone Reduce UI Motion control remains separate; on Windows it uses the reversible `MinAnimate` preference, which is also the mechanism used by catalog ID 177. Other catalog records remain unsupported. VOX does not disable antivirus, firewall, UAC, security updates, or other security protections.

## Authentication and Premium

The sign-in screen uses the existing site's Netlify Identity service at `https://vox-tweaking-utility.netlify.app/`. In the desktop app, a fixed native HTTP bridge makes HTTPS requests to that host; it accepts only the login, refresh, profile, and logout operations and never accepts arbitrary URLs. A browser build can sign in only when served from the same origin as the Identity service; other browser previews show an explanatory message instead of a broken form.

**Create one** opens `https://vox-tweaking-utility.netlify.app/login`, where account registration is handled. The live Identity settings currently enable email/password sign-in and require email confirmation; sign in using the account email after confirming it. The site source and Netlify deployment are not part of this repository, and this project neither modifies nor deploys the site. No Supabase credentials, Google provider, or deployment secrets are required or included.

Premium access is displayed only when the Identity profile's server-managed `app_metadata` contains `tier: "premium"` or a `roles` entry of `"premium"`. Never grant Premium from client-editable metadata. VOX does not include billing or account provisioning.

The existing URL https://vox-tweaking-utility.netlify.app/ is linked as the product site. Its source is not part of this repository, and this project neither modifies nor deploys it. Deploying the new web UI or configuring that Netlify site requires access to the relevant hosting project and its environment settings.

## Platform action details

- **Windows standalone Reduce UI Motion / catalog ID 177:** updates `HKCU\Control Panel\Desktop\WindowMetrics\MinAnimate`; no elevation is requested.
- **Windows catalog IDs 176, 185, 201, 202, 204, 205, and 206:** update only the current user's Personalize or Explorer Advanced preferences (transparency, light/dark theme, extension visibility, hidden-file visibility, Explorer start location, and Quick Access recent/frequent lists). They do not clear file history or change system-wide policy. Each action saves and validates its old value before writing; use the per-item Undo control to restore it.
- **macOS:** sets `com.apple.universalaccess reduceMotion` with `defaults`.
- **Linux:** on GNOME sessions, changes `org.gnome.desktop.interface enable-animations` with `gsettings`; other desktop environments are reported unsupported.
- Each implementation reads and stores the pre-change value locally before applying. Undo restores that value. If a preference cannot be read, written, or restored, VOX shows an error rather than claiming success. The imported catalog mappings are Windows-only; macOS/Linux catalog rows stay visibly unsupported.

The desktop application has no shell plugin and does not execute catalog text. Native calls accept only fixed action identifiers, and platform-specific implementations are isolated under `src-tauri/src/platform/`.
