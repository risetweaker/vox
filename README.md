# VOX

VOX is a cross-platform desktop utility with a responsive companion web interface. Its interface is designed for Windows, macOS, and Linux; system changes are implemented in isolated native platform modules.

## What is implemented

- Free and Premium catalog import, search, category/risk filters, and metadata display.
- Strict catalog parsing. The only imported fields used are `id`, `name`, `category`, and `risk`; extra fields such as scripts or commands are ignored.
- A review-and-confirm Apply All flow that identifies supported work, requires confirmation, reports per-item outcomes, and explicitly skips unsupported catalog items.
- Eight exact Free/Premium catalog mappings on Windows: IDs 176, 177, 185, 201, 202, 204, 205, and 206. These are current-user visual and Explorer preferences with local rollback records; all other catalog rows remain unsupported.
- One standalone, reviewed Reduce UI Motion action for Windows, macOS, and GNOME/Linux. It is separate from the catalog Apply All allowlist and backs up the previous setting before changing it.
- Platform-specific Windows, macOS, and GNOME/Linux implementations under `src-tauri/src/platform/`.
- Supabase Google OAuth entry point and server-controlled Premium access check.
- In-app FAQ and dark blue responsive interface.

The supplied JSON files contain metadata rather than apply/undo recipes. They are intentionally imported by the user instead of being presented as an embedded, executable catalog. The current catalog parser accepts the supplied `{ "app", "count", "tweaks": [...] }` shape. The supplied Free file has 274 entries; the file named `vox_tweaks_600.json` has 842. The interface compares the declared count with actual records rather than trusting its filename.

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

## Catalog import

Use the **Import Free JSON** or **Import Premium JSON** control and select the corresponding supplied file. Parsing is local to the browser. Files have a 2 MB limit, a 2,000-record limit, duplicate IDs and invalid metadata are rejected, and unknown fields are discarded. Catalog names, categories, and risks are displayed as text only.

Catalog presence and an entry's low/medium/high risk label do not make a tweak safe. The exact ID/name/category/risk tuples for IDs 176, 177, 185, 201, 202, 204, 205, and 206 are the only imported mappings; they are available on Windows only. Each action uses fixed registry paths and value names, validates prior values, and stores its rollback data locally. Showing hidden files does not change Windows' separate protected-operating-system-files setting. The standalone Reduce UI Motion control remains separate; on Windows it uses the reversible `MinAnimate` preference, which is also the mechanism used by catalog ID 177. Other catalog records remain unsupported. VOX does not disable antivirus, firewall, UAC, security updates, or other security protections.

## Authentication and Premium

Real sign-in is optional and disabled until configured:

1. Create a Supabase project and enable Google OAuth in its Authentication provider settings.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in a local `.env` file (copy `.env.example`).
3. Configure the OAuth redirect URL for every deployed origin, including `/auth/callback`.
4. Assign `app_metadata.tier = "premium"` or include `"premium"` in `app_metadata.roles` from a trusted server/admin process. Never grant Premium from client-editable user metadata.

The public Supabase anon key is intended for client use; never put a service-role key or OAuth client secret in Vite environment variables. VOX does not include billing, account provisioning, or any secret credentials.
The web OAuth callback route is included. For a production Tauri desktop release, configure and test a native deep-link callback and external-browser OAuth flow for each target OS; the starter does not ship a custom URL scheme or claim that desktop OAuth has been deployed.

The existing URL https://vox-tweaking-utility.netlify.app/ is linked as the product site. Its source is not part of this repository, and this project neither modifies nor deploys it. Deploying the new web UI or configuring that Netlify site requires access to the relevant hosting project and its environment settings.

## Platform action details

- **Windows standalone Reduce UI Motion / catalog ID 177:** updates `HKCU\Control Panel\Desktop\WindowMetrics\MinAnimate`; no elevation is requested.
- **Windows catalog IDs 176, 185, 201, 202, 204, 205, and 206:** update only the current user's Personalize or Explorer Advanced preferences (transparency, light/dark theme, extension visibility, hidden-file visibility, Explorer start location, and Quick Access recent/frequent lists). They do not clear file history or change system-wide policy. Each action saves and validates its old value before writing; use the per-item Undo control to restore it.
- **macOS:** sets `com.apple.universalaccess reduceMotion` with `defaults`.
- **Linux:** on GNOME sessions, changes `org.gnome.desktop.interface enable-animations` with `gsettings`; other desktop environments are reported unsupported.
- Each implementation reads and stores the pre-change value locally before applying. Undo restores that value. If a preference cannot be read, written, or restored, VOX shows an error rather than claiming success. The imported catalog mappings are Windows-only; macOS/Linux catalog rows stay visibly unsupported.

The desktop application has no shell plugin and does not execute catalog text. Native calls accept only fixed action identifiers, and platform-specific implementations are isolated under `src-tauri/src/platform/`.
