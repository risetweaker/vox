# VOX

VOX is a cross-platform desktop utility with a responsive companion web interface. Its interface is designed for Windows, macOS, and Linux; system changes are implemented in isolated native platform modules.

## What is implemented

- Free and Premium catalog import, search, category/risk filters, and metadata display.
- Strict catalog parsing. The only imported fields used are `id`, `name`, `category`, and `risk`; extra fields such as scripts or commands are ignored.
- A review-and-confirm Apply All flow that identifies supported work and explicitly skips unsupported catalog items.
- One exact Free/Premium catalog mapping on Windows: ID 177, “Disable Window Animations”, backed by the reversible current-user animation preference. The same row is unsupported on macOS and Linux.
- One reviewed, reversible action: enable the operating system's reduced-motion preference for the current user. VOX backs up the previous setting before changing it.
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

Catalog presence and an entry's low/medium/high risk label do not make a tweak safe. The exact ID/name/category/risk tuple for ID 177 is the only imported mapping; it is available on Windows only and shares the reversible `MinAnimate` preference with the standalone Reduce UI Motion control. Other catalog records remain unavailable. VOX does not disable antivirus, firewall, UAC, security updates, or other security protections.

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

- **Windows:** updates `HKCU\Control Panel\Desktop\WindowMetrics\MinAnimate`; no elevation is requested.
- **macOS:** sets `com.apple.universalaccess reduceMotion` with `defaults`.
- **Linux:** on GNOME sessions, changes `org.gnome.desktop.interface enable-animations` with `gsettings`; other desktop environments are reported unsupported.
- Each implementation reads and stores the pre-change value locally before applying. Undo restores that value. If a preference cannot be read, written, or restored, VOX shows an error rather than claiming success.

The desktop application has no shell plugin and does not execute catalog text. Native calls accept only the fixed `reduce-ui-motion` action identifier.
