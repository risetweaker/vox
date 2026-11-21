import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  ArrowUpRight,
  BadgeCheck,
  Bolt,
  Check,
  ChevronDown,
  CircleHelp,
  CloudUpload,
  Command,
  Eye,
  EyeOff,
  FileJson2,
  Gauge,
  Gamepad2,
  LockKeyhole,
  LogOut,
  Mail,
  Menu,
  Monitor,
  Moon,
  Search,
  Settings2,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Undo2,
  X,
} from "lucide-react";
import {
  canSignInFromCurrentContext,
  clearIdentitySession,
  getCurrentSession,
  isExpiredIdentitySessionError,
  refreshIdentitySession,
  signInWithPassword,
  signOutIdentity,
  type VoxSession,
} from "./auth";
import { buildApplyPlan, executeApplyPlan, type ApplyPlan, type BatchExecution, type BatchItemResult, type BatchItemStatus } from "./batch";
import { formatCount, parseCatalog, type Catalog, type CatalogTier, type Tweak } from "./catalog";

type Page = "overview" | "tweaks" | "faq" | "settings";
type PlatformRuntime = {
  platform: string;
  actionSupported: boolean;
  actionUnavailableReason: string | null;
  actionApplied: boolean;
  appliedActions?: string[];
};
type ApplySummary = { tier: CatalogTier; result: BatchExecution; singleItem?: string };
type PendingApply = { tier: CatalogTier; plan: ApplyPlan; singleItem?: string };

const ACTION_ID = "reduce-ui-motion";
const EXTERNAL_SITE = "https://vox-tweaking-utility.netlify.app/";
const ACCOUNT_SITE = `${EXTERNAL_SITE}login`;
const FAQ_ITEMS = [
  {
    question: "What does VOX actually change?",
    answer:
      "VOX only runs a small, explicit allowlist of reviewed actions. The catalog files describe tweaks but do not include apply or undo instructions. Only exact, reviewed catalog mappings are actionable; the rest are reported as unsupported.",
  },
  {
    question: "Can I undo a change?",
    answer:
      "Each supported catalog action saves its current-user preference before changing it. Use the per-item Undo button to restore that saved value. Backups remain local to this app installation.",
  },
  {
    question: "Why are imported tweaks marked unsupported?",
    answer:
      "Names and risk labels are not enough to safely infer system changes. Unsupported entries are never executed. Each supported tweak needs a reviewed, operating-system-specific implementation and rollback.",
  },
  {
    question: "Does Apply All run every catalog entry?",
    answer:
      "Apply All only runs registered mappings for exact catalog records. If none are supported for your platform, it makes no system changes and reports why. It never runs commands, registry snippets, or scripts from an imported file.",
  },
  {
    question: "What does Premium unlock?",
    answer:
      "The Premium catalog is shown only to an account whose Netlify Identity profile is marked premium by your trusted account service. VOX does not include payment handling or let users grant themselves a Premium role.",
  },
  {
    question: "How do I create a VOX account?",
    answer:
      "Choose Create one on the sign-in screen to open the VOX website's account page. Registration and email confirmation are handled there.",
  },
  {
    question: "Can I sign in with a username?",
    answer:
      "Sign in with the email address used to create your VOX account. The website's Identity service handles account credentials and confirmation.",
  },
  {
    question: "Does VOX disable security features?",
    answer:
      "No. VOX will not disable antivirus, firewall, UAC, security updates, or other security protections. Those catalog rows remain unsupported.",
  },
];

const NAV_ITEMS: { id: Page; label: string; icon: typeof Gauge }[] = [
  { id: "overview", label: "General", icon: Gauge },
  { id: "tweaks", label: "Optimize", icon: SlidersHorizontal },
  { id: "faq", label: "Support", icon: CircleHelp },
  { id: "settings", label: "Settings", icon: Settings2 },
];

function isPremiumSession(session: VoxSession | null): boolean {
  const metadata = session?.user.app_metadata;
  return metadata?.tier === "premium" || (Array.isArray(metadata?.roles) && metadata.roles.includes("premium"));
}

function App() {
  const [page, setPage] = useState<Page>("tweaks");
  const [tier, setTier] = useState<CatalogTier>("free");
  const [catalogs, setCatalogs] = useState<Partial<Record<CatalogTier, Catalog>>>({});
  const [session, setSession] = useState<VoxSession | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [runtime, setRuntime] = useState<PlatformRuntime | null>(null);
  const [lastRun, setLastRun] = useState<ApplySummary | null>(null);
  const [pendingApply, setPendingApply] = useState<PendingApply | null>(null);
  const [isNative, setIsNative] = useState(false);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<"apply" | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All categories");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const freeFile = useRef<HTMLInputElement>(null);
  const premiumFile = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void getCurrentSession().then((nextSession) => {
      if (active) setSession(nextSession);
    }).catch((cause: unknown) => {
      if (active) setError(errorMessage(cause));
    }).finally(() => {
      if (active) setAuthLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    let active = true;
    let timeout = 0;
    const scheduleRefresh = (sessionToRefresh: VoxSession, delay: number) => {
      timeout = window.setTimeout(() => void refreshSession(sessionToRefresh), delay);
    };
    async function refreshSession(sessionToRefresh: VoxSession) {
      try {
        const nextSession = await refreshIdentitySession(sessionToRefresh);
        if (active) setSession(nextSession);
      } catch (cause) {
        if (!active) return;
        if (isExpiredIdentitySessionError(cause)) {
          clearIdentitySession();
          setSession(null);
        } else {
          scheduleRefresh(sessionToRefresh, 30_000);
        }
        setError(errorMessage(cause));
      }
    }
    scheduleRefresh(session, Math.max(1_000, session.expiresAt - Date.now() - 60_000));
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [session]);

  useEffect(() => {
    let active = true;
    async function loadBuiltInCatalogs() {
      const [freeResponse, premiumResponse] = await Promise.all([
        fetch(`${import.meta.env.BASE_URL}catalogs/free.json`),
        fetch(`${import.meta.env.BASE_URL}catalogs/premium.json`),
      ]);
      if (!freeResponse.ok || !premiumResponse.ok) {
        throw new Error("The built-in Free or Premium catalog could not be loaded.");
      }
      const [freeText, premiumText] = await Promise.all([freeResponse.text(), premiumResponse.text()]);
      const freeCatalog = parseCatalog(freeText, "free");
      const premiumCatalog = parseCatalog(premiumText, "premium");
      if (active) {
        setCatalogs((current) => ({
          free: current.free ?? freeCatalog,
          premium: current.premium ?? premiumCatalog,
        }));
      }
    }
    void loadBuiltInCatalogs().catch((cause: unknown) => {
      if (active) setError(`Could not load the bundled tweak catalogs: ${errorMessage(cause)}`);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    function handleSearchShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPage("tweaks");
        window.setTimeout(() => searchInput.current?.focus(), 0);
      }
    }
    window.addEventListener("keydown", handleSearchShortcut);
    return () => window.removeEventListener("keydown", handleSearchShortcut);
  }, []);

  useEffect(() => {
    const native = isTauri();
    setIsNative(native);
    if (!native) {
      const ua = navigator.userAgent;
      const platform = /Windows/i.test(ua)
        ? "Windows"
        : /Macintosh|Mac OS/i.test(ua)
          ? "macOS"
          : /Linux/i.test(ua)
            ? "Linux"
            : "Browser preview";
      setRuntime({
        platform,
        actionSupported: false,
        actionUnavailableReason: "Open the VOX desktop app to apply system-level settings.",
        actionApplied: false,
        appliedActions: [],
      });
      return;
    }
    void invoke<PlatformRuntime>("runtime_info")
      .then(setRuntime)
      .catch((cause: unknown) => setError(errorMessage(cause)));
  }, []);

  const premium = isPremiumSession(session);
  const catalog = catalogs[tier];
  const applyPlan = useMemo(
    () =>
      buildApplyPlan(
        catalog?.tweaks ?? [],
        runtime?.platform ?? "Unknown",
        isNative,
        Boolean(runtime?.actionSupported),
        runtime?.appliedActions ?? (runtime?.actionApplied ? [ACTION_ID] : []),
      ),
    [catalog, isNative, runtime],
  );
  const categories = useMemo(
    () => ["All categories", ...new Set(catalog?.tweaks.map((item) => item.category) ?? [])],
    [catalog],
  );
  const visibleTweaks = useMemo(() => {
    const items = catalog?.tweaks ?? [];
    return items.filter((item) => {
      const matchesSearch = `${item.name} ${item.category}`.toLowerCase().includes(search.toLowerCase());
      return matchesSearch && (category === "All categories" || item.category === category);
    });
  }, [catalog, category, search]);

  async function importCatalog(file: File | undefined, targetTier: CatalogTier) {
    if (!file) return;
    setError("");
    try {
      const parsed = parseCatalog(await file.text(), targetTier);
      setCatalogs((current) => ({ ...current, [targetTier]: parsed }));
      setLastRun(null);
      setTier(targetTier);
      setCategory("All categories");
      setSearch("");
      setNotice(`${targetTier === "free" ? "Free" : "Premium"} catalog imported: ${formatCount(parsed)}.`);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  function openAccountSite() {
    window.open(ACCOUNT_SITE, "_blank", "noopener,noreferrer");
  }

  async function signInWithEmail(email: string, password: string) {
    setError("");
    setBusy(true);
    try {
      setSession(await signInWithPassword(email, password));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    if (!session) return;
    setBusy(true);
    setError("");
    try {
      await signOutIdentity(session);
      setNotice("Signed out.");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSession(null);
      setBusy(false);
    }
  }

  async function refreshRuntime() {
    if (!isNative) return;
    try {
      setRuntime(await invoke<PlatformRuntime>("runtime_info"));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  function requestApplyAll() {
    if (!catalog) {
      setNotice("A catalog must be loaded before Apply All. No system changes were made.");
      return;
    }
    setError("");
    setNotice("");
    if (applyPlan.actionIds.length === 0) {
      setLastRun({ tier, result: { items: applyPlan.items } });
      const alreadyApplied = applyPlan.items.some((item) => item.status === "already-applied");
      const unavailable = applyPlan.items.some((item) => item.status === "unavailable");
      const message = alreadyApplied
        ? "All mapped catalog actions are already applied. No new system changes were made."
        : unavailable
          ? "A verified catalog mapping exists, but system actions are unavailable in this preview or runtime. No system changes were made."
          : `No catalog tweaks have a verified mapping for ${runtime?.platform ?? "this platform"}. No system changes were made.`;
      setNotice(message);
      return;
    }
    setPendingApply({ tier, plan: applyPlan });
    setModal("apply");
  }

  function requestApplyOne(tweak: Tweak) {
    if (!catalog) return;
    setError("");
    setNotice("");
    const plan = buildApplyPlan(
      [tweak],
      runtime?.platform ?? "Unknown",
      isNative,
      Boolean(runtime?.actionSupported),
      runtime?.appliedActions ?? (runtime?.actionApplied ? [ACTION_ID] : []),
    );
    if (plan.actionIds.length === 0) {
      setLastRun({ tier, result: { items: plan.items }, singleItem: tweak.name });
      setNotice("This tweak is unsupported or unavailable here. No system changes were made.");
      return;
    }
    setPendingApply({ tier, plan, singleItem: tweak.name });
    setModal("apply");
  }

  async function confirmApplyAll() {
    const pending = pendingApply;
    if (!pending) return;
    setModal(null);
    setPendingApply(null);
    setBusy(true);
    setError("");
    setNotice("");
    const result = await executeApplyPlan(pending.plan, (actionId) =>
      invoke("apply_action", { actionId }),
    );
    setLastRun({ tier: pending.tier, result, singleItem: pending.singleItem });
    const appliedCount = result.items.filter((item) => item.status === "applied").length;
    const skippedCount = result.items.filter((item) => item.status === "unsupported" || item.status === "unavailable").length;
    if (result.failure) {
      setError(`Could not apply ${result.failure.actionId}: ${errorMessage(result.failure.error)}`);
    } else {
      setNotice(`Applied ${appliedCount} mapped tweak${appliedCount === 1 ? "" : "s"}; skipped ${skippedCount} unsupported catalog item${skippedCount === 1 ? "" : "s"}.`);
    }
    await refreshRuntime();
    setBusy(false);
  }

  async function applyStandalone() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await invoke("apply_action", { actionId: ACTION_ID });
      setNotice("Reduce UI Motion applied. Undo is available in the Tweaks tab.");
      await refreshRuntime();
    } catch (cause) {
      setError(errorMessage(cause));
      await refreshRuntime();
    } finally {
      setBusy(false);
    }
  }

  async function undoAction(actionId: string = ACTION_ID) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await invoke("undo_action", { actionId });
      setLastRun(null);
      setNotice(actionId === ACTION_ID
        ? "The original Reduce UI Motion preference has been restored."
        : "The previous catalog preference has been restored.");
      await refreshRuntime();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  function navigate(nextPage: Page) {
    setPage(nextPage);
    setMenuOpen(false);
    setError("");
  }

  function selectTier(nextTier: CatalogTier) {
    setTier(nextTier);
    setCategory("All categories");
    setSearch("");
  }

  if (authLoading) return <AuthLoading />;
  if (!session) {
    return <LoginScreen
      loginAvailable={canSignInFromCurrentContext()}
      busy={busy}
      error={error}
      onClearError={() => setError("")}
      onSignIn={(email, password) => void signInWithEmail(email, password)}
    />;
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><span>V</span></div>
          <div><strong>VOX</strong><small>OPTIMIZE</small></div>
          <button className="icon-button mobile-close" aria-label="Close menu" onClick={() => setMenuOpen(false)}><X size={18} /></button>
        </div>
        <button className="account-card" onClick={() => session ? void signOut() : openAccountSite()} title={session ? "Sign out" : "Open account page"}>
          <span className="avatar">{session?.user.email?.slice(0, 1).toUpperCase() ?? "V"}</span>
          <span className="account-copy"><strong>{session?.user.email ?? "Guest"}</strong><small>{premium ? "VOX Premium" : "VOX Free"}</small></span>
          <ChevronDown size={16} />
        </button>
        <div className="nav-caption">MENU</div>
        <nav className="nav-list" aria-label="Main navigation">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-item ${page === id ? "active" : ""}`} onClick={() => navigate(id)}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
              {id === "tweaks" && <span className="nav-pulse" />}
            </button>
          ))}
        </nav>
        {page === "tweaks" && categories.length > 1 && <div className="sidebar-categories">
          <div className="nav-caption">CATEGORIES</div>
          {categories.slice(1).map((item) => <button key={item} className={`nav-subitem ${category === item ? "active" : ""}`} onClick={() => setCategory(item)}><span className="category-mini-icon"><SlidersHorizontal size={14} /></span><span>{item}</span></button>)}
        </div>}
        {!premium && <section className="upgrade-card">
          <div className="upgrade-card-art"><Sparkles size={26} /></div>
          <strong>Upgrade to Premium</strong>
          <small>{catalogs.premium?.tweaks.length ?? "Premium"} tweaks require verified access.</small>
          <button className="button button-primary button-small" onClick={() => { selectTier("premium"); navigate("tweaks"); }}><Sparkles size={14} /> View Premium</button>
        </section>}
        <div className="sidebar-bottom">
          <div className="sidebar-status"><span className={`status-dot ${runtime?.actionSupported ? "online" : ""}`} /><span>{runtime?.platform ?? "Detecting system"}</span><span className="status-label">{runtime?.actionSupported ? "READY" : "PREVIEW"}</span></div>
          <a className="external-link" href={EXTERNAL_SITE} target="_blank" rel="noreferrer">vox-tweaking-utility.netlify.app <ArrowUpRight size={14} /></a>
        </div>
      </aside>

      {menuOpen && <button className="scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
      <main className="main-content">
        <header className="topbar">
          <div className="topbar-left"><button className="icon-button mobile-menu" aria-label="Open menu" onClick={() => setMenuOpen(true)}><Menu size={19} /></button><div className="breadcrumb">VOX <span>/</span> {NAV_ITEMS.find((item) => item.id === page)?.label}</div></div>
          <div className="topbar-actions">
            <label className="top-search"><Search size={16} /><input ref={searchInput} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tweaks" /><kbd>Ctrl K</kbd></label>
            <div className="platform-chip"><Monitor size={14} /> {runtime?.platform ?? "Detecting..."}</div>
            {session ? (
              <button className="user-chip" onClick={() => void signOut()} title="Sign out">
                <span className="avatar">{session.user.email?.slice(0, 1).toUpperCase() ?? "V"}</span>
                <span className="user-email">{session.user.email}</span>{premium && <BadgeCheck size={15} className="premium-icon" />}
                <LogOut size={14} className="logout-icon" />
              </button>
            ) : (
              <button className="button button-quiet button-small" onClick={openAccountSite} title="Open the VOX account page">
                <LockKeyhole size={14} /> Account
              </button>
            )}
          </div>
        </header>

        <div className="page-wrap">
          {error && <div className="message message-error" role="alert"><Shield size={17} /><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError("")}><X size={15} /></button></div>}
          {notice && <div className="message message-success" role="status"><Check size={17} /><span>{notice}</span><button aria-label="Dismiss message" onClick={() => setNotice("")}><X size={15} /></button></div>}
          {page === "overview" && <Overview
            runtime={runtime}
            catalogCount={(catalogs.free?.tweaks.length ?? 0) + (premium ? catalogs.premium?.tweaks.length ?? 0 : 0)}
            premium={premium}
            onNavigate={navigate}
            onImport={() => freeFile.current?.click()}
            onApply={() => void applyStandalone()}
            onUndo={() => void undoAction(ACTION_ID)}
            busy={busy}
          />}
          {page === "tweaks" && <Tweaks
            tier={tier}
            setTier={selectTier}
            premium={premium}
            catalog={catalog}
            catalogs={catalogs}
            visibleTweaks={visibleTweaks}
            categories={categories}
            category={category}
            setCategory={setCategory}
            onImportFree={() => freeFile.current?.click()}
            onImportPremium={() => premiumFile.current?.click()}
            onApply={requestApplyAll}
            onApplyOne={requestApplyOne}
            onUndo={() => void undoAction(ACTION_ID)}
            onUndoAction={(actionId) => void undoAction(actionId)}
            onSignIn={openAccountSite}
            lastRun={lastRun?.tier === tier ? lastRun : null}
            applyPlan={applyPlan}
            runtime={runtime}
            busy={busy}
          />}
          {page === "faq" && <Faq />}
          {page === "settings" && <Settings
            session={session}
            premium={premium}
            runtime={runtime}
            onSignIn={openAccountSite}
            onSignOut={() => void signOut()}
          />}
        </div>
      </main>

      <input ref={freeFile} type="file" accept=".json,application/json" hidden onChange={(event) => {
        void importCatalog(event.target.files?.[0], "free");
        event.target.value = "";
      }} />
      <input ref={premiumFile} type="file" accept=".json,application/json" hidden onChange={(event) => {
        void importCatalog(event.target.files?.[0], "premium");
        event.target.value = "";
      }} />

      {modal === "apply" && pendingApply && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) { setModal(null); setPendingApply(null); }
      }}>
        <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="apply-title">
          <button className="icon-button modal-close" aria-label="Close confirmation" onClick={() => { setModal(null); setPendingApply(null); }}><X size={18} /></button>
          <div className="modal-icon"><SlidersHorizontal size={22} /></div>
          <div className="eyebrow">REVIEW BEFORE APPLYING</div>
          <h2 id="apply-title">{pendingApply.singleItem ? `Apply ${pendingApply.singleItem}?` : "Apply all mapped catalog tweaks?"}</h2>
          <p>{pendingApply.singleItem ? "This exact verified action will run for your current user after confirmation." : "Only exact, verified catalog entries will run for your current user. Unsupported entries will be skipped."}</p>
          {pendingApply.plan.items.filter((item) => item.status === "ready").map((item) => <div className="preview-row" key={item.id}><div className="preview-icon"><Eye size={17} /></div><div><strong>{item.name}</strong><small>Catalog ID {item.id} · {pendingApply.tier} · {runtime?.platform} · reversible</small>{item.warning && <small style={{ color: "#e1b466" }}>{item.warning}</small>}</div><span className="eligible-tag">SUPPORTED</span></div>)}
          {!pendingApply.singleItem && <div className="preview-row muted-row"><div className="preview-icon"><FileJson2 size={17} /></div><div><strong>{pendingApply.plan.items.filter((item) => item.status === "unsupported" || item.status === "unavailable").length} unsupported or unavailable records</strong><small>These have no exact mapping here or cannot run in this app context.</small></div><span className="skip-tag">SKIPPED</span></div>}
          <div className="modal-warning"><Shield size={15} /> No administrator permission is requested. No catalog command or script will run. Some visual or Explorer changes may require reopening the affected app.</div>
          <div className="modal-actions"><button className="button button-quiet" onClick={() => { setModal(null); setPendingApply(null); }}>Cancel</button><button className="button button-primary" disabled={busy || pendingApply.plan.actionIds.length === 0} onClick={() => void confirmApplyAll()}><Bolt size={16} /> Confirm &amp; apply</button></div>
        </section>
      </div>}
    </div>
  );
}

function AuthLoading() {
  return <main className="auth-screen auth-loading">
    <div className="auth-loading-card">
      <div className="brand-mark"><span>V</span></div>
      <span className="auth-loading-indicator" />
      <strong>Checking your VOX account</strong>
      <small>Securely restoring your sign-in session…</small>
    </div>
  </main>;
}

function LoginScreen({
  loginAvailable,
  busy: isBusy,
  error: authError,
  onClearError,
  onSignIn,
}: {
  loginAvailable: boolean;
  busy: boolean;
  error: string;
  onClearError: () => void;
  onSignIn: (email: string, password: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onClearError();
    onSignIn(email.trim(), password);
  }

  return <main className="auth-screen">
    <div className="auth-shell">
      <section className="auth-showcase">
        <div className="auth-brand"><div className="brand-mark"><span>V</span></div><div><strong>VOX</strong><small>OPTIMIZE</small></div></div>
        <div className="auth-showcase-copy">
          <div className="eyebrow"><span className="live-dot" /> SYSTEM CONTROL, MADE CLEAR</div>
          <h1>Your system.<br /><span>Your settings.</span></h1>
          <p>Sign in to continue to your VOX workspace, review your tweak catalogs, and apply only the changes you choose.</p>
        </div>
        <div className="auth-feature-card">
          <div className="auth-feature-icon"><Shield size={18} /></div>
          <div><strong>Built for control</strong><small>Reviewed actions, clear previews, and rollback where supported.</small></div>
          <BadgeCheck size={17} />
        </div>
        <div className="auth-orbit" aria-hidden="true"><div className="auth-orbit-ring auth-orbit-ring-one" /><div className="auth-orbit-ring auth-orbit-ring-two" /><div className="auth-orbit-core"><Command size={30} /></div></div>
        <div className="auth-showcase-footer"><span>FREE + PREMIUM CATALOGS</span><span className="auth-footer-line" /><span>WINDOWS · MACOS · LINUX</span></div>
      </section>

      <section className="auth-form-panel">
        <div className="auth-form-heading">
          <div className="auth-kicker">WELCOME BACK</div>
          <h2>Sign in to VOX</h2>
          <p>Use the email address and password linked to your account.</p>
        </div>

        {authError && <div className="auth-error" role="alert"><Shield size={16} /><span>{authError}</span><button type="button" aria-label="Dismiss error" onClick={onClearError}><X size={15} /></button></div>}

        <form className="auth-form" onSubmit={submit}>
          <label className="auth-field">
            <span>Email address</span>
            <span className="auth-input-wrap"><Mail size={16} /><input type="email" autoComplete="username" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></span>
          </label>
          <label className="auth-field">
            <span>Password</span>
            <span className="auth-input-wrap"><LockKeyhole size={16} /><input type={showPassword ? "text" : "password"} autoComplete="current-password" required maxLength={256} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" /><button className="auth-password-toggle" type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></span>
          </label>
          <button className="button button-primary auth-submit" type="submit" disabled={isBusy || !loginAvailable}><LockKeyhole size={16} /> {isBusy ? "Signing in…" : "Sign in"} <ArrowUpRight size={15} /></button>
        </form>

        {!loginAvailable && <div className="auth-setup-note" role="status"><strong>Open the VOX app or website to sign in</strong><span>This browser preview cannot reach the VOX Identity service from its current origin.</span></div>}

        <p className="auth-create">Don’t have an account? <a href={ACCOUNT_SITE} target="_blank" rel="noreferrer">Create one <ArrowUpRight size={13} /></a></p>
        <p className="auth-account-note">Account registration and email confirmation are handled on the VOX website.</p>
      </section>
    </div>
    <div className="auth-site-link"><a href={EXTERNAL_SITE} target="_blank" rel="noreferrer">vox-tweaking-utility.netlify.app <ArrowUpRight size={13} /></a><span>Secure account sign-in by Netlify Identity</span></div>
  </main>;
}

function Overview(props: {
  runtime: PlatformRuntime | null;
  catalogCount: number;
  premium: boolean;
  onNavigate: (page: Page) => void;
  onImport: () => void;
  onApply: () => void;
  onUndo: () => void;
  busy: boolean;
}) {
  const { runtime, catalogCount, premium, onNavigate, onImport, onApply, onUndo, busy } = props;
  return (
    <>
      <section className="hero-panel">
        <div className="hero-copy">
          <div className="eyebrow"><span className="live-dot" /> SYSTEM CONTROL, MADE CLEAR</div>
          <h1>Your system.<br /><span>Your settings.</span></h1>
          <p>A cleaner way to review and tune your system. Every change is transparent, reversible, and built for the OS you run.</p>
          <div className="hero-actions"><button className="button button-primary" onClick={() => onNavigate("tweaks")}><SlidersHorizontal size={16} /> Explore tweaks <ArrowUpRight size={15} /></button><button className="button button-quiet" onClick={onImport}><CloudUpload size={16} /> Import catalog</button></div>
          <div className="hero-note"><Shield size={14} /> No blind scripts. No hidden changes. You stay in control.</div>
        </div>
        <div className="hero-orbit" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit-core"><div className="core-glow" /><Command size={46} strokeWidth={1.25} /></div><div className="orbit-tag tag-one"><span className="tag-dot" /> SAFE BY DESIGN</div><div className="orbit-tag tag-two"><span className="tag-icon"><Undo2 size={14} /></span> ALWAYS REVERSIBLE</div></div>
        <div className="hero-bottom"><span>BUILT FOR WINDOWS, MACOS &amp; LINUX</span><span className="hero-bottom-line" /><span>CONTROL IS THE FEATURE</span></div>
      </section>

      <div className="section-heading"><div><div className="eyebrow">AT A GLANCE</div><h2>System overview</h2></div><span className="subtle-text">A clear view of what VOX can do here.</span></div>
      <section className="stats-grid">
        <StatCard icon={Monitor} label="YOUR PLATFORM" value={runtime?.platform ?? "Checking…"} meta={runtime?.actionSupported ? "Native actions available" : runtime?.actionUnavailableReason ?? "Detecting platform"} accent="blue" />
        <StatCard icon={SlidersHorizontal} label="CATALOG RECORDS" value={String(catalogCount)} meta={catalogCount ? "Bundled metadata · not all executable" : "Loading bundled catalog metadata"} accent="violet" />
        <StatCard icon={Shield} label="VERIFIED ACTIONS" value={runtime?.actionSupported ? runtime.platform === "Windows" ? "8 catalog mappings" : "1 standalone action" : "Preview only"} meta={runtime?.actionApplied ? "Reduce UI Motion is applied" : runtime?.platform === "Windows" ? "Current-user Windows preferences" : "Catalog mappings are Windows only"} accent="mint" />
        <StatCard icon={Sparkles} label="YOUR PLAN" value={premium ? "Premium" : "Free"} meta={premium ? "Premium access verified" : "Upgrade access is server-managed"} accent="gold" />
      </section>

      <section className="action-panel">
        <div className="action-visual"><div className="motion-wave wave-a" /><div className="motion-wave wave-b" /><div className="action-glyph"><Moon size={25} /></div></div>
        <div className="action-copy"><div className="eyebrow"><span className="mini-check"><Check size={11} /></span> VERIFIED FOR THIS DEVICE</div><h3>Reduce UI Motion</h3><p>Use your operating system’s reduced-motion preference. VOX backs up the current user setting and provides a one-click rollback.</p><div className="action-meta"><span><BadgeCheck size={14} /> No admin access</span><span><Undo2 size={14} /> Undo available</span></div></div>
        <div className="action-controls">{runtime?.actionApplied ? <button className="button button-quiet" onClick={onUndo} disabled={busy}><Undo2 size={16} /> Undo change</button> : <button className="button button-primary" onClick={onApply} disabled={busy || !runtime?.actionSupported}><Bolt size={16} /> Review &amp; apply</button>}<small>{runtime?.actionSupported ? "Supported on this device" : runtime?.actionUnavailableReason ?? "Checking support…"}</small></div>
      </section>
      <section className="quick-grid">
        <button className="quick-card" onClick={() => onNavigate("tweaks")}><span className="quick-icon"><Gamepad2 size={19} /></span><span><strong>Browse tweak catalogs</strong><small>Built-in catalogs · verified subset executable</small></span><ArrowUpRight size={16} /></button>
        <button className="quick-card" onClick={() => onNavigate("faq")}><span className="quick-icon quick-icon-soft"><CircleHelp size={19} /></span><span><strong>How VOX works</strong><small>Safety, compatibility, sign-in &amp; more</small></span><ArrowUpRight size={16} /></button>
      </section>
    </>
  );
}

function StatCard({ icon: Icon, label, value, meta, accent }: { icon: typeof Gauge; label: string; value: string; meta: string; accent: string }) {
  return <article className={`stat-card accent-${accent}`}><div className="stat-top"><span>{label}</span><span className="stat-icon"><Icon size={16} /></span></div><strong>{value}</strong><small>{meta}</small></article>;
}

function Tweaks(props: {
  tier: CatalogTier;
  setTier: (tier: CatalogTier) => void;
  premium: boolean;
  catalog?: Catalog;
  catalogs: Partial<Record<CatalogTier, Catalog>>;
  visibleTweaks: Tweak[];
  categories: string[];
  category: string;
  setCategory: (value: string) => void;
  onImportFree: () => void;
  onImportPremium: () => void;
  onApply: () => void;
  onApplyOne: (item: Tweak) => void;
  onUndo: () => void;
  onUndoAction: (actionId: string) => void;
  onSignIn: () => void;
  lastRun: ApplySummary | null;
  applyPlan: ApplyPlan;
  runtime: PlatformRuntime | null;
  busy: boolean;
}) {
  const { tier, setTier, premium, catalog, catalogs, visibleTweaks, categories, category, setCategory, onImportFree, onImportPremium, onApply, onApplyOne, onUndo, onUndoAction, onSignIn, lastRun, applyPlan, runtime, busy } = props;
  const [riskFilter, setRiskFilter] = useState("All risk levels");
  const filtered = visibleTweaks.filter((item) => riskFilter === "All risk levels" || item.risk === riskFilter.toLowerCase());
  const resultFor = (id: number) => lastRun?.result.items.find((result) => result.id === id) ?? applyPlan.items.find((result) => result.id === id);
  const unsupportedCount = applyPlan.items.filter((item) => item.status === "unsupported" || item.status === "unavailable").length;
  const readyCount = applyPlan.items.filter((item) => item.status === "ready").length;
  const selectedCategory = category === "All categories" ? "All tweaks" : category;
  const countForCategory = (value: string) => value === "All categories"
    ? catalog?.tweaks.length ?? 0
    : catalog?.tweaks.filter((item) => item.category === value).length ?? 0;
  return (
    <div className="optimize-page">
      <div className="optimize-heading">
        <div><div className="eyebrow">VOX CONTROL CENTER</div><h1>Optimize</h1><p>Review your tweaks and choose what to change.</p></div>
        <div className="optimize-platform"><Monitor size={15} /> {runtime?.platform ?? "Detecting platform"}</div>
      </div>

      <nav className="category-tabs" aria-label="Tweak categories">
        {categories.map((item) => {
          const Icon = iconForCategory(item);
          const active = category === item;
          return <button key={item} className={`category-tab ${active ? "selected" : ""}`} onClick={() => setCategory(item)} aria-pressed={active}>
            <Icon size={15} /><span>{item === "All categories" ? "All" : item}</span><small>{countForCategory(item)}</small>
          </button>;
        })}
      </nav>

      <div className="optimize-summary">
        <section className="all-tweaks-panel">
          <div className="all-tweaks-title"><span className="all-tweaks-icon"><SlidersHorizontal size={19} /></span><div><h2>{selectedCategory}</h2><small>{catalog ? `${formatCount(catalog)} in the ${tier === "free" ? "Free" : "Premium"} catalog` : "Import your catalog to see your tweaks here"}</small></div></div>
          <p>Every catalog tweak in one place. Only exact, reversible mappings can change your system.</p>
          <div className="category-tags">{categories.slice(1, 5).map((item) => <button key={item} onClick={() => setCategory(item)}><span />{item}</button>)}</div>
        </section>
        <section className="apply-all-panel">
          <div className="apply-all-heading"><span>Apply All</span><small>{readyCount} supported here</small></div>
          <p>{catalog ? `${unsupportedCount} entries remain unsupported or unavailable.` : "Load a catalog before applying any tweaks."}</p>
          <button className="button button-primary apply-all-button" onClick={onApply} disabled={busy || !catalog}><Bolt size={16} /> Review &amp; Apply All</button>
        </section>
      </div>

      <div className="catalog-toolbar">
        <div className="tier-switch" role="group" aria-label="Catalog tier">
          <button className={tier === "free" ? "selected" : ""} onClick={() => setTier("free")}><span>Free</span><small>{catalogs.free?.tweaks.length ?? "—"}</small></button>
          <button className={tier === "premium" ? "selected" : ""} onClick={() => setTier("premium")}><span>Premium</span><small>{catalogs.premium?.tweaks.length ?? "—"}</small></button>
        </div>
        <div className="catalog-toolbar-actions">
          <label className="select-field risk-filter"><span className="sr-only">Risk level</span><span className="select-value">{riskFilter}</span><select value={riskFilter} onChange={(event) => setRiskFilter(event.target.value)}><option>All risk levels</option><option>Low</option><option>Medium</option><option>High</option></select><ChevronDown size={14} /></label>
          <button className="button button-quiet button-small" onClick={tier === "free" ? onImportFree : onImportPremium} disabled={tier === "premium" && !premium}><CloudUpload size={15} /> Import {tier === "free" ? "Free" : "Premium"} JSON</button>
        </div>
      </div>

      {tier === "premium" && !premium ? <div className="locked-panel catalog-locked"><div className="lock-art"><LockKeyhole size={24} /></div><div className="eyebrow">PREMIUM LIBRARY</div><h2>Premium access is tied to your account</h2><p>Premium access is managed on the VOX website and verified by the account service.</p><div className="locked-actions"><button className="button button-primary" onClick={onSignIn}><LockKeyhole size={15} /> Open account page</button><a className="button button-quiet" href={EXTERNAL_SITE} target="_blank" rel="noreferrer">Visit VOX site <ArrowUpRight size={15} /></a></div></div> : catalog ? <>
        <div className="catalog-meta"><span>{formatCount(catalog)} · {unsupportedCount} unsupported/unavailable on {runtime?.platform ?? "this platform"}</span><span className="verified-count"><BadgeCheck size={14} /> {readyCount} verified action{readyCount === 1 ? "" : "s"} ready</span></div>
        {lastRun && <div className={`batch-result ${lastRun.result.failure ? "batch-failure" : ""}`}><Check size={16} /><span><strong>{lastRun.singleItem ? "Tweak result" : "Apply All results"}</strong><small>{lastRun.result.items.filter((item) => item.status === "applied").length} applied · {lastRun.result.items.filter((item) => item.status === "unsupported" || item.status === "unavailable").length} skipped · {lastRun.result.items.filter((item) => item.status === "already-applied").length} already applied{lastRun.result.failure ? " · one action failed" : ""}</small></span><BadgeCheck size={16} /></div>}
        {filtered.length > 0 ? <div className="tweak-grid">{filtered.slice(0, 100).map((item) => {
          const result = resultFor(item.id);
          const rollbackAvailable = Boolean(result?.actionId && runtime?.appliedActions?.includes(result.actionId));
          return <TweakCard key={`${tier}-${item.id}`} item={item} result={result} rollbackAvailable={rollbackAvailable} busy={busy} onApply={() => onApplyOne(item)} onUndo={() => result?.actionId && onUndoAction(result.actionId)} />;
        })}</div> : <div className="empty-state"><Search size={22} /><strong>No matching tweaks</strong><span>Try another category or search term.</span></div>}
        {filtered.length > 100 && <div className="list-limit">Showing 100 of {filtered.length} matches. Refine your search to find other tweaks.</div>}
      </> : <div className="empty-state catalog-empty"><FileJson2 size={24} /><strong>No {tier} catalog loaded</strong><span>The bundled file could not be loaded. Choose a replacement JSON catalog.</span><button className="button button-primary button-small" onClick={tier === "free" ? onImportFree : onImportPremium} disabled={tier === "premium" && !premium}><CloudUpload size={15} /> Import {tier} catalog</button></div>}

      <section className="supported-action-row"><div className="supported-icon"><Sun size={18} /></div><div><strong>Standalone action · Reduce UI Motion</strong><small>Separate from catalog Apply All. {runtime?.actionSupported ? "Available on this platform." : runtime?.actionUnavailableReason}</small></div>{runtime?.actionApplied ? <button className="button button-quiet button-small" onClick={onUndo} disabled={busy}><Undo2 size={14} /> Undo</button> : <span className="supported-tag">{runtime?.actionSupported ? "READY" : "UNAVAILABLE"}</span>}</section>
    </div>
  );
}

function iconForCategory(category: string) {
  const value = category.toLowerCase();
  if (value.includes("privacy") || value.includes("security")) return Shield;
  if (value.includes("graphic") || value.includes("visual") || value.includes("display")) return Eye;
  if (value.includes("game")) return Gamepad2;
  if (value.includes("performance")) return Bolt;
  if (value.includes("cleanup") || value.includes("storage")) return FileJson2;
  return SlidersHorizontal;
}

function TweakCard({ item, result, rollbackAvailable, busy, onApply, onUndo }: { item: Tweak; result?: BatchItemResult; rollbackAvailable: boolean; busy: boolean; onApply: () => void; onUndo: () => void }) {
  const outcome = result?.status ?? "unsupported";
  const outcomeLabel: Record<BatchItemStatus, string> = {
    ready: "Ready to apply",
    unsupported: result?.platform ? `${result.platform} only` : "Not mapped",
    unavailable: "Desktop app required",
    "already-applied": "Applied",
    applied: "Applied",
    failed: "Failed",
    "not-run": "Not run",
  };
  const actionId = result?.actionId;
  const applied = outcome === "applied" || outcome === "already-applied" || Boolean(outcome === "failed" && actionId && rollbackAvailable);
  const toggleEnabled = applied || outcome === "ready";
  const Icon = iconForCategory(item.category);
  return <article className={`tweak-card outcome-card-${outcome}`}>
    <div className="tweak-card-icon"><Icon size={17} /></div>
    <div className="tweak-card-content"><div className="tweak-card-heading"><strong>{item.name}</strong><span className={`tweak-state state-${outcome}`} title={result?.warning}>{outcomeLabel[outcome]}</span></div><small>Catalog ID {item.id} · {item.category}</small>{result?.warning && <small className="tweak-warning">{result.warning}</small>}<span className={`risk-pill risk-${item.risk}`}>{item.risk} risk</span></div>
    <button className={`tweak-switch ${applied ? "on" : ""}`} type="button" role="switch" aria-checked={applied} aria-label={`${applied ? "Undo" : "Apply"} ${item.name}`} title={toggleEnabled ? `${applied ? "Undo" : "Apply"} ${item.name}` : outcomeLabel[outcome]} disabled={busy || !toggleEnabled} onClick={applied ? onUndo : onApply}><span /></button>
  </article>;
}

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return <><div className="page-title-row"><div><div className="eyebrow">THE DETAILS</div><h1>Frequently asked</h1><p>Clear answers about what VOX changes—and what it never will.</p></div><div className="faq-count"><CircleHelp size={17} /> {FAQ_ITEMS.length} answers</div></div><section className="faq-layout"><div className="faq-list">{FAQ_ITEMS.map((item, index) => <article className={`faq-item ${open === index ? "faq-open" : ""}`} key={item.question}><button className="faq-question" aria-expanded={open === index} onClick={() => setOpen(open === index ? null : index)}><span className="faq-number">{String(index + 1).padStart(2, "0")}</span><strong>{item.question}</strong><ChevronDown size={17} /></button>{open === index && <div className="faq-answer">{item.answer}</div>}</article>)}</div><aside className="faq-side"><div className="faq-side-icon"><Shield size={20} /></div><div className="eyebrow">OUR COMMITMENT</div><h3>Safe beats clever.</h3><p>Every system setting deserves a clear preview, a known rollback, and your explicit approval. If any of those are missing, VOX skips it.</p><a href={EXTERNAL_SITE} target="_blank" rel="noreferrer">More about VOX <ArrowUpRight size={14} /></a></aside></section></>;
}

function Settings({ session, premium, runtime, onSignIn, onSignOut }: { session: VoxSession | null; premium: boolean; runtime: PlatformRuntime | null; onSignIn: () => void; onSignOut: () => void }) {
  return <><div className="page-title-row"><div><div className="eyebrow">PREFERENCES</div><h1>Settings</h1><p>Your account, platform, and privacy controls.</p></div></div><section className="settings-card"><div className="settings-section-head"><div className="settings-icon"><Monitor size={17} /></div><div><strong>Device compatibility</strong><small>Native support is checked at runtime.</small></div></div><div className="settings-row"><span>Detected platform</span><strong>{runtime?.platform ?? "Checking..."}</strong></div><div className="settings-row"><span>Verified action status</span><strong className={runtime?.actionSupported ? "text-mint" : ""}>{runtime?.actionSupported ? "Available" : runtime?.actionUnavailableReason ?? "Checking..."}</strong></div></section><section className="settings-card"><div className="settings-section-head"><div className="settings-icon"><LockKeyhole size={17} /></div><div><strong>Account &amp; plan</strong><small>Email/password sign-in uses VOX's Netlify Identity service.</small></div></div><div className="settings-row"><span>Account</span><strong>{session?.user.email ?? "Not signed in"}</strong></div><div className="settings-row"><span>Plan access</span><strong>{premium ? "Premium · verified" : "Free"}</strong></div><div className="settings-actions">{session ? <button className="button button-quiet button-small" onClick={onSignOut}><LogOut size={14} /> Sign out</button> : <button className="button button-primary button-small" onClick={onSignIn}><LockKeyhole size={14} /> Open account page</button>}<a href={EXTERNAL_SITE} target="_blank" rel="noreferrer" className="settings-external">VOX website <ArrowUpRight size={14} /></a></div></section></>;
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  return "Something went wrong. No success was reported.";
}

export default App;
