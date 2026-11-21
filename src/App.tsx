import { useEffect, useMemo, useRef, useState } from "react";
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
  FileJson2,
  Gauge,
  Gamepad2,
  LockKeyhole,
  LogOut,
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
import type { Session } from "@supabase/supabase-js";
import { authConfigured, signInWithGoogle, supabase } from "./auth";
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
type ApplySummary = { tier: CatalogTier; result: BatchExecution };
type PendingApply = { tier: CatalogTier; plan: ApplyPlan };

const ACTION_ID = "reduce-ui-motion";
const EXTERNAL_SITE = "https://vox-tweaking-utility.netlify.app/";
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
      "The Premium catalog is shown only to an account whose Supabase app metadata is explicitly marked premium by your trusted backend. VOX does not include payment handling or let users grant themselves a Premium role.",
  },
  {
    question: "Does VOX disable security features?",
    answer:
      "No. VOX will not disable antivirus, firewall, UAC, security updates, or other security protections. Those catalog rows remain unsupported.",
  },
];

const NAV_ITEMS: { id: Page; label: string; icon: typeof Gauge }[] = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "tweaks", label: "Tweaks", icon: SlidersHorizontal },
  { id: "faq", label: "FAQ", icon: CircleHelp },
  { id: "settings", label: "Settings", icon: Settings2 },
];

function isPremiumSession(session: Session | null): boolean {
  const metadata = session?.user.app_metadata;
  return metadata?.tier === "premium" || (Array.isArray(metadata?.roles) && metadata.roles.includes("premium"));
}

function App() {
  const [page, setPage] = useState<Page>("overview");
  const [tier, setTier] = useState<CatalogTier>("free");
  const [catalogs, setCatalogs] = useState<Partial<Record<CatalogTier, Catalog>>>({});
  const [session, setSession] = useState<Session | null>(null);
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

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void supabase.auth.getSession().then(({ data, error: authError }) => {
      if (active && !authError) setSession(data.session);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active) setSession(nextSession);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
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

  async function signIn() {
    setError("");
    try {
      await signInWithGoogle();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function signOut() {
    if (!supabase) return;
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) setError(signOutError.message);
    else setNotice("Signed out.");
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
      setNotice("Import a catalog before using Apply All. No system changes were made.");
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
          : `No imported catalog tweaks have a verified mapping for ${runtime?.platform ?? "this platform"}. No system changes were made.`;
      setNotice(message);
      return;
    }
    setPendingApply({ tier, plan: applyPlan });
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
    setLastRun({ tier: pending.tier, result });
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

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><span>V</span></div>
          <div><strong>VOX</strong><small>CONTROL CENTER</small></div>
          <button className="icon-button mobile-close" aria-label="Close menu" onClick={() => setMenuOpen(false)}><X size={18} /></button>
        </div>
        <div className="nav-caption">WORKSPACE</div>
        <nav className="nav-list" aria-label="Main navigation">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-item ${page === id ? "active" : ""}`} onClick={() => navigate(id)}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
              {id === "tweaks" && <span className="nav-pulse" />}
            </button>
          ))}
        </nav>
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
            <div className="platform-chip"><Monitor size={14} /> {runtime?.platform ?? "Detecting..."}</div>
            {session ? (
              <button className="user-chip" onClick={() => void signOut()} title="Sign out">
                <span className="avatar">{session.user.email?.slice(0, 1).toUpperCase() ?? "V"}</span>
                <span className="user-email">{session.user.email}</span>{premium && <BadgeCheck size={15} className="premium-icon" />}
                <LogOut size={14} className="logout-icon" />
              </button>
            ) : (
              <button className="button button-quiet button-small" onClick={() => void signIn()} disabled={!authConfigured} title={!authConfigured ? "Configure Supabase to enable sign-in" : "Sign in with Google"}>
                <LockKeyhole size={14} /> {authConfigured ? "Sign in" : "Auth setup"}
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
            setTier={(nextTier) => {
              setTier(nextTier);
              setCategory("All categories");
            }}
            premium={premium}
            catalog={catalog}
            visibleTweaks={visibleTweaks}
            categories={categories}
            search={search}
            setSearch={setSearch}
            category={category}
            setCategory={setCategory}
            onImportFree={() => freeFile.current?.click()}
            onImportPremium={() => premiumFile.current?.click()}
            onApply={requestApplyAll}
            onUndo={() => void undoAction(ACTION_ID)}
            onUndoAction={(actionId) => void undoAction(actionId)}
            onSignIn={() => void signIn()}
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
            onSignIn={() => void signIn()}
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
          <h2 id="apply-title">Apply mapped catalog tweaks?</h2>
          <p>Only these exact, verified catalog entries will run for your current user. Unsupported entries will be skipped.</p>
          {pendingApply.plan.items.filter((item) => item.status === "ready").map((item) => <div className="preview-row" key={item.id}><div className="preview-icon"><Eye size={17} /></div><div><strong>{item.name}</strong><small>Catalog ID {item.id} · {pendingApply.tier} · {runtime?.platform} · reversible</small>{item.warning && <small style={{ color: "#e1b466" }}>{item.warning}</small>}</div><span className="eligible-tag">SUPPORTED</span></div>)}
          <div className="preview-row muted-row"><div className="preview-icon"><FileJson2 size={17} /></div><div><strong>{pendingApply.plan.items.filter((item) => item.status === "unsupported" || item.status === "unavailable").length} unsupported or unavailable records</strong><small>These have no exact mapping here or cannot run in this app context.</small></div><span className="skip-tag">SKIPPED</span></div>
          <div className="modal-warning"><Shield size={15} /> No administrator permission is requested. No catalog command or script will run. Some visual or Explorer changes may require reopening the affected app.</div>
          <div className="modal-actions"><button className="button button-quiet" onClick={() => { setModal(null); setPendingApply(null); }}>Cancel</button><button className="button button-primary" disabled={busy || pendingApply.plan.actionIds.length === 0} onClick={() => void confirmApplyAll()}><Bolt size={16} /> Confirm &amp; apply</button></div>
        </section>
      </div>}
    </div>
  );
}

function Overview(props: {
  runtime: PlatformRuntime | null;
  catalogCount: number;
  premium: boolean;
  onNavigate: (page: Page) => void;
  onImport: () => void;
  onApply: () => void;
  onUndo: () => void;
  onUndoAction: (actionId: string) => void;
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
        <StatCard icon={SlidersHorizontal} label="CATALOG RECORDS" value={String(catalogCount)} meta={catalogCount ? "Imported metadata · not all executable" : "Import the supplied JSON catalog"} accent="violet" />
        <StatCard icon={Shield} label="VERIFIED ACTIONS" value={runtime?.actionSupported ? runtime.platform === "Windows" ? "8 catalog mappings" : "1 standalone action" : "Preview only"} meta={runtime?.actionApplied ? "Reduce UI Motion is applied" : runtime?.platform === "Windows" ? "Current-user Windows preferences" : "Catalog mappings are Windows only"} accent="mint" />
        <StatCard icon={Sparkles} label="YOUR PLAN" value={premium ? "Premium" : "Free"} meta={premium ? "Premium access verified" : "Upgrade access is server-managed"} accent="gold" />
      </section>

      <section className="action-panel">
        <div className="action-visual"><div className="motion-wave wave-a" /><div className="motion-wave wave-b" /><div className="action-glyph"><Moon size={25} /></div></div>
        <div className="action-copy"><div className="eyebrow"><span className="mini-check"><Check size={11} /></span> VERIFIED FOR THIS DEVICE</div><h3>Reduce UI Motion</h3><p>Use your operating system’s reduced-motion preference. VOX backs up the current user setting and provides a one-click rollback.</p><div className="action-meta"><span><BadgeCheck size={14} /> No admin access</span><span><Undo2 size={14} /> Undo available</span></div></div>
        <div className="action-controls">{runtime?.actionApplied ? <button className="button button-quiet" onClick={onUndo} disabled={busy}><Undo2 size={16} /> Undo change</button> : <button className="button button-primary" onClick={onApply} disabled={busy || !runtime?.actionSupported}><Bolt size={16} /> Review &amp; apply</button>}<small>{runtime?.actionSupported ? "Supported on this device" : runtime?.actionUnavailableReason ?? "Checking support…"}</small></div>
      </section>
      <section className="quick-grid">
        <button className="quick-card" onClick={() => onNavigate("tweaks")}><span className="quick-icon"><Gamepad2 size={19} /></span><span><strong>Browse tweak catalogs</strong><small>Import the Free or Premium JSON file</small></span><ArrowUpRight size={16} /></button>
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
  visibleTweaks: Tweak[];
  categories: string[];
  search: string;
  setSearch: (value: string) => void;
  category: string;
  setCategory: (value: string) => void;
  onImportFree: () => void;
  onImportPremium: () => void;
  onApply: () => void;
  onUndo: () => void;
  onSignIn: () => void;
  lastRun: ApplySummary | null;
  applyPlan: ApplyPlan;
  runtime: PlatformRuntime | null;
  busy: boolean;
}) {
  const { tier, setTier, premium, catalog, visibleTweaks, categories, search, setSearch, category, setCategory, onImportFree, onImportPremium, onApply, onUndo, onUndoAction, onSignIn, lastRun, applyPlan, runtime, busy } = props;
  const [riskFilter, setRiskFilter] = useState("All risk levels");
  const filtered = visibleTweaks.filter((item) => riskFilter === "All risk levels" || item.risk === riskFilter.toLowerCase());
  const displayedResults = lastRun?.result.items ?? applyPlan.items;
  const unsupportedCount = applyPlan.items.filter((item) => item.status === "unsupported" || item.status === "unavailable").length;
  return (
    <>
      <div className="page-title-row"><div><div className="eyebrow">TUNING LIBRARY</div><h1>Tweak catalog</h1><p>Only exact, reviewed mappings can run. Unsupported entries stay informational.</p></div><button className="button button-primary" onClick={onApply} disabled={busy || !runtime || !catalog}><Bolt size={16} /> Apply All</button></div>
      <div className="trust-banner"><Shield size={18} /><div><strong>Catalog data is not executable.</strong><span>Commands or scripts inside files are ignored. Unsupported mappings stay unsupported.</span></div><span className="trust-badge"><BadgeCheck size={14} /> STRICT ALLOWLIST</span></div>

      <section className="catalog-panel">
        <div className="catalog-tabs">
          <button className={`catalog-tab ${tier === "free" ? "selected" : ""}`} onClick={() => setTier("free")}><span className="tier-icon"><Bolt size={16} /></span><span><strong>Free</strong>          <small>{catalogsCountLabel(catalog)}</small></span>{tier === "free" && <span className="selected-line" />}</button>
          <button className={`catalog-tab ${tier === "premium" ? "selected" : ""}`} onClick={() => setTier("premium")}><span className="tier-icon tier-icon-premium"><Sparkles size={16} /></span><span><strong>Premium <span className="pro-label">PRO</span></strong><small>{premium ? "Account access verified" : "Sign in with Premium access"}</small></span>{tier === "premium" && <span className="selected-line" />}</button>
          <div className="catalog-tab-actions">{tier === "free" ? <button className="button button-quiet button-small" onClick={onImportFree}><CloudUpload size={15} /> Import Free JSON</button> : <button className="button button-quiet button-small" onClick={onImportPremium} disabled={!premium}><CloudUpload size={15} /> Import Premium JSON</button>}</div>
        </div>

        {tier === "premium" && !premium ? <div className="locked-panel"><div className="lock-art"><LockKeyhole size={24} /></div><div className="eyebrow">PREMIUM LIBRARY</div><h2>Access is tied to your account</h2><p>Sign in with the configured provider. Premium access is granted only by trusted server-side account metadata.</p><div className="locked-actions"><button className="button button-primary" disabled={!authConfigured} onClick={onSignIn}><LockKeyhole size={15} /> {authConfigured ? "Sign in to continue" : "Sign-in setup required"}</button><a className="button button-quiet" href={EXTERNAL_SITE} target="_blank" rel="noreferrer">Visit VOX site <ArrowUpRight size={15} /></a></div></div> : catalog ? <>
          <div className="catalog-summary"><div><strong>{tier === "free" ? "Free" : "Premium"} catalog</strong><span>{formatCount(catalog)} · {unsupportedCount} unsupported or unavailable on {runtime?.platform ?? "this platform"}</span></div><span className="unsupported-count"><span className="status-dot" /> {unsupportedCount} unsupported/unavailable</span></div>
          {lastRun && <div className={`batch-result ${lastRun.result.failure ? "batch-failure" : ""}`}><Check size={16} /><span><strong>Apply All results</strong>          <small>{lastRun.result.items.filter((item) => item.status === "applied").length} applied · {lastRun.result.items.filter((item) => item.status === "unsupported" || item.status === "unavailable").length} skipped as unsupported/unavailable · {lastRun.result.items.filter((item) => item.status === "already-applied").length} already applied{lastRun.result.failure ? " · one action failed" : ""}</small></span><BadgeCheck size={16} /></div>}
          <div className="filter-bar"><label className="search-field"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tweaks..." /></label><label className="select-field"><span className="sr-only">Category</span><span className="select-value">{category}</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={14} /></label><label className="select-field"><span className="sr-only">Risk level</span><span className="select-value">{riskFilter}</span><select value={riskFilter} onChange={(event) => setRiskFilter(event.target.value)}><option>All risk levels</option><option>Low</option><option>Medium</option><option>High</option></select><ChevronDown size={14} /></label></div>
          <div className="tweak-list">{filtered.slice(0, 100).map((item) => <TweakRow key={`${tier}-${item.id}`} item={item} result={displayedResults.find((result) => result.id === item.id)} wasRun={Boolean(lastRun)} onUndoAction={onUndoAction} busy={busy} rollbackAvailable={Boolean(runtime?.appliedActions?.includes(displayedResults.find((result) => result.id === item.id)?.actionId ?? ""))} />)}</div>
          {filtered.length > 100 && <div className="list-limit">Showing first 100 matches. Refine your search to see other entries.</div>}
          {filtered.length === 0 && <div className="empty-state"><Search size={22} /><strong>No matching tweaks</strong><span>Try a different search or category.</span></div>}
        </> : <div className="empty-state"><FileJson2 size={24} /><strong>No {tier} catalog loaded</strong><span>Choose the matching JSON file to inspect its metadata. Files are read locally and never uploaded.</span><button className="button button-quiet button-small" onClick={tier === "free" ? onImportFree : onImportPremium} disabled={tier === "premium" && !premium}><CloudUpload size={15} /> Select {tier} JSON</button></div>}
      </section>
      <section className="supported-action-row"><div className="supported-icon"><Sun size={18} /></div><div><strong>Verified system action · Reduce UI Motion</strong><small>Not sourced from imported catalog metadata. {runtime?.actionSupported ? "Available on this platform." : runtime?.actionUnavailableReason}</small></div>{runtime?.actionApplied ? <button className="button button-quiet button-small" onClick={onUndo} disabled={busy}><Undo2 size={14} /> Undo</button> : <span className="supported-tag">{runtime?.actionSupported ? "READY" : "UNAVAILABLE"}</span>}</section>
    </>
  );
}

function catalogsCountLabel(current?: Catalog) {
  return current ? formatCount(current) : "Not imported";
}

function TweakRow({ item, result, wasRun, onUndoAction, busy, rollbackAvailable }: { item: Tweak; result?: BatchItemResult; wasRun: boolean; onUndoAction: (actionId: string) => void; busy: boolean; rollbackAvailable: boolean }) {
  const outcome = result?.status ?? "unsupported";
  const outcomeLabel: Record<BatchItemStatus, string> = {
    ready: "Mapped · ready",
    unsupported: wasRun ? "Skipped · unsupported" : result?.platform ? `${result.platform} only` : "No verified mapping",
    unavailable: "Unavailable in this app",
    "already-applied": "Already applied",
    applied: "Applied",
    failed: "Failed",
    "not-run": "Not run",
  };
  const actionId = result?.actionId;
  const undoable = actionId !== undefined && rollbackAvailable;
  return <article className="tweak-row"><div className="tweak-category-icon"><Settings2 size={16} /></div><div className="tweak-info"><strong>{item.name}</strong><small title={result?.warning}>{item.category}{result?.warning ? ` · ${result.warning}` : ""}</small></div><span className={`risk-pill risk-${item.risk}`}>{item.risk}</span><span className={`unsupported-pill outcome-${outcome}`}>{outcomeLabel[outcome]}</span>{undoable ? <button className="button button-quiet button-small tweak-undo" onClick={() => onUndoAction(actionId)} disabled={busy}><Undo2 size={13} /> Undo</button> : <button className="icon-button disabled-icon" aria-label={outcomeLabel[outcome]} title={outcomeLabel[outcome]} disabled><LockKeyhole size={15} /></button>}</article>;
}

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return <><div className="page-title-row"><div><div className="eyebrow">THE DETAILS</div><h1>Frequently asked</h1><p>Clear answers about what VOX changes—and what it never will.</p></div><div className="faq-count"><CircleHelp size={17} /> {FAQ_ITEMS.length} answers</div></div><section className="faq-layout"><div className="faq-list">{FAQ_ITEMS.map((item, index) => <article className={`faq-item ${open === index ? "faq-open" : ""}`} key={item.question}><button className="faq-question" aria-expanded={open === index} onClick={() => setOpen(open === index ? null : index)}><span className="faq-number">{String(index + 1).padStart(2, "0")}</span><strong>{item.question}</strong><ChevronDown size={17} /></button>{open === index && <div className="faq-answer">{item.answer}</div>}</article>)}</div><aside className="faq-side"><div className="faq-side-icon"><Shield size={20} /></div><div className="eyebrow">OUR COMMITMENT</div><h3>Safe beats clever.</h3><p>Every system setting deserves a clear preview, a known rollback, and your explicit approval. If any of those are missing, VOX skips it.</p><a href={EXTERNAL_SITE} target="_blank" rel="noreferrer">More about VOX <ArrowUpRight size={14} /></a></aside></section></>;
}

function Settings({ session, premium, runtime, onSignIn, onSignOut }: { session: Session | null; premium: boolean; runtime: PlatformRuntime | null; onSignIn: () => void; onSignOut: () => void }) {
  return <><div className="page-title-row"><div><div className="eyebrow">PREFERENCES</div><h1>Settings</h1><p>Your account, platform, and privacy controls.</p></div></div><section className="settings-card"><div className="settings-section-head"><div className="settings-icon"><Monitor size={17} /></div><div><strong>Device compatibility</strong><small>Native support is checked at runtime.</small></div></div><div className="settings-row"><span>Detected platform</span><strong>{runtime?.platform ?? "Checking..."}</strong></div><div className="settings-row"><span>Verified action status</span><strong className={runtime?.actionSupported ? "text-mint" : ""}>{runtime?.actionSupported ? "Available" : runtime?.actionUnavailableReason ?? "Checking..."}</strong></div></section><section className="settings-card"><div className="settings-section-head"><div className="settings-icon"><LockKeyhole size={17} /></div><div><strong>Account &amp; plan</strong><small>Authentication is provided by Supabase OAuth.</small></div></div><div className="settings-row"><span>Account</span><strong>{session?.user.email ?? "Not signed in"}</strong></div><div className="settings-row"><span>Plan access</span><strong>{premium ? "Premium · verified" : "Free"}</strong></div><div className="settings-actions">{session ? <button className="button button-quiet button-small" onClick={onSignOut}><LogOut size={14} /> Sign out</button> : <button className="button button-primary button-small" onClick={onSignIn} disabled={!authConfigured}><LockKeyhole size={14} /> {authConfigured ? "Sign in with Google" : "Configure sign-in"}</button>}<a href={EXTERNAL_SITE} target="_blank" rel="noreferrer" className="settings-external">VOX website <ArrowUpRight size={14} /></a></div></section></>;
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  return "Something went wrong. No success was reported.";
}

export default App;
