import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
} from "recharts";
import {
  Link2,
  Plus,
  ExternalLink,
  Trash2,
  Sparkles,
  RotateCcw,
  MousePointerClick,
  Clock,
  X,
} from "lucide-react";
import { storage } from "./storage";

const STORAGE_KEY = "snip:app-state-v1";
const CODE_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const BROWSERS = ["Chrome", "Safari", "Firefox", "Edge"];
const DEVICES = ["Desktop", "Mobile", "Tablet"];
const COUNTRIES = ["US", "IN", "GB", "DE", "BR", "JP", "CA", "FR"];

const COLORS = {
  bg: "#0E1015",
  panel: "#161920",
  panelAlt: "#1C2029",
  border: "#2A2F3A",
  borderStrong: "#3A4150",
  text: "#E7E9ED",
  textDim: "#9AA3B2",
  textFaint: "#5C6473",
  accent: "#E3A23C",
  accentDim: "#7A5A26",
  accentText: "#F4C878",
  danger: "#D9695F",
  ok: "#4FB587",
};

function genShortCode(existingCodes) {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = "";
    for (let i = 0; i < 7; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    if (!existingCodes.has(code)) return code;
  }
  return String(Date.now().toString(36));
}

function normalizeUrl(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "Enter a URL to shorten." };
  let candidate = trimmed;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = "https://" + candidate;
  }
  try {
    const u = new URL(candidate);
    if (!u.hostname.includes(".")) {
      return { ok: false, error: "That doesn't look like a valid URL." };
    }
    return { ok: true, value: candidate };
  } catch {
    return { ok: false, error: "That doesn't look like a valid URL." };
  }
}

function parseUA(ua) {
  let browser = "Other";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = "Safari";
  let device = "Desktop";
  if (/iPad|Tablet/i.test(ua)) device = "Tablet";
  else if (/Mobi|Android/i.test(ua)) device = "Mobile";
  return { browser, device };
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayLabel(key) {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function aggregate(clicks) {
  const now = Date.now();
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const ts = now - i * 24 * 60 * 60 * 1000;
    days.push({ key: dayKey(ts), label: dayLabel(dayKey(ts)) });
  }
  const dayMap = {};
  days.forEach((d) => (dayMap[d.key] = 0));
  const byBrowser = {};
  const byDevice = {};
  const byCountry = {};

  clicks.forEach((c) => {
    const k = dayKey(c.ts);
    if (k in dayMap) dayMap[k] += 1;
    byBrowser[c.browser] = (byBrowser[c.browser] || 0) + 1;
    byDevice[c.device] = (byDevice[c.device] || 0) + 1;
    byCountry[c.country] = (byCountry[c.country] || 0) + 1;
  });

  return {
    overTime: days.map((d) => ({ label: d.label, clicks: dayMap[d.key] })),
    byBrowser: Object.entries(byBrowser)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    byDevice: Object.entries(byDevice)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    byCountry: Object.entries(byCountry)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6),
  };
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div
      style={{
        background: COLORS.panelAlt,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 4,
        padding: "6px 10px",
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 12,
        color: COLORS.text,
      }}
    >
      <div style={{ color: COLORS.textDim, marginBottom: 2 }}>{label}</div>
      <div>{payload[0].value} clicks</div>
    </div>
  );
}

export default function App() {
  const [state, setState] = useState({ links: {} });
  const [loaded, setLoaded] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [formError, setFormError] = useState("");
  const [selected, setSelected] = useState(null);
  const [copiedCode, setCopiedCode] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [isNarrow, setIsNarrow] = useState(
    typeof window !== "undefined" ? window.innerWidth < 760 : false
  );

  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < 760);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await storage.get(STORAGE_KEY);
        if (cancelled) return;
        if (res && res.value) {
          const parsed = JSON.parse(res.value);
          setState(parsed);
          const codes = Object.keys(parsed.links || {});
          if (codes.length) {
            const mostRecent = codes.sort(
              (a, b) => parsed.links[b].createdAt - parsed.links[a].createdAt
            )[0];
            setSelected(mostRecent);
          }
        }
      } catch {
        // no existing state yet, start fresh
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async (nextState) => {
    setState(nextState);
    try {
      const result = await storage.set(
        STORAGE_KEY,
        JSON.stringify(nextState)
      );
      if (!result) throw new Error("no result");
      setSaveError("");
    } catch {
      setSaveError("Couldn't save changes. They may not persist.");
    }
  }, []);

  const links = state.links || {};
  const linkList = useMemo(
    () => Object.values(links).sort((a, b) => b.createdAt - a.createdAt),
    [links]
  );

  const handleCreate = (e) => {
    e.preventDefault();
    const result = normalizeUrl(urlInput);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    const code = genShortCode(new Set(Object.keys(links)));
    const entry = {
      shortCode: code,
      longUrl: result.value,
      createdAt: Date.now(),
      clicks: [],
    };
    const next = { ...state, links: { ...links, [code]: entry } };
    persist(next);
    setUrlInput("");
    setFormError("");
    setSelected(code);
  };

  const recordClick = (code) => {
    const link = links[code];
    if (!link) return;
    const { browser, device } = parseUA(navigator.userAgent);
    const click = {
      ts: Date.now(),
      browser,
      device,
      country: "Unknown",
    };
    const updated = { ...link, clicks: [...link.clicks, click] };
    persist({ ...state, links: { ...links, [code]: updated } });
    window.open(link.longUrl, "_blank", "noopener,noreferrer");
  };

  const generateSampleTraffic = (code) => {
    const link = links[code];
    if (!link) return;
    const now = Date.now();
    const sample = [];
    const count = 24 + Math.floor(Math.random() * 20);
    for (let i = 0; i < count; i++) {
      const daysBack = Math.random() * 13;
      sample.push({
        ts: now - daysBack * 24 * 60 * 60 * 1000,
        browser: BROWSERS[Math.floor(Math.random() * BROWSERS.length)],
        device: DEVICES[Math.floor(Math.random() * DEVICES.length)],
        country: COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)],
      });
    }
    const updated = {
      ...link,
      clicks: [...link.clicks, ...sample].sort((a, b) => a.ts - b.ts),
    };
    persist({ ...state, links: { ...links, [code]: updated } });
  };

  const deleteLink = (code) => {
    const next = { ...links };
    delete next[code];
    persist({ ...state, links: next });
    if (selected === code) {
      const remaining = Object.values(next).sort(
        (a, b) => b.createdAt - a.createdAt
      );
      setSelected(remaining.length ? remaining[0].shortCode : null);
    }
    setConfirmingDelete(null);
  };

  const resetAll = () => {
    persist({ links: {} });
    setSelected(null);
    setConfirmingReset(false);
  };

  const copyCode = (code) => {
    const text = `${code}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(""), 1400);
  };

  const activeLink = selected ? links[selected] : null;
  const analytics = useMemo(
    () => (activeLink ? aggregate(activeLink.clicks) : null),
    [activeLink]
  );

  if (!loaded) {
    return (
      <div style={styles.page}>
        <div style={{ ...styles.emptyState, marginTop: 80 }}>
          <div style={styles.dimText}>Loading your links…</div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        .snip-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
        .snip-scroll::-webkit-scrollbar-thumb { background: ${COLORS.border}; border-radius: 4px; }
        .snip-row:hover { background: ${COLORS.panelAlt}; }
        .snip-btn { cursor: pointer; }
        .snip-btn:active { transform: scale(0.98); }
        input:focus, textarea:focus { outline: none; }
      `}</style>

      <header style={styles.header}>
        <div style={styles.headerInner}>
          <div style={styles.logoRow}>
            <div style={styles.logoMark}>
              <Link2 size={16} color={COLORS.bg} strokeWidth={2.5} />
            </div>
            <div>
              <div style={styles.wordmark}>snip</div>
              <div style={styles.tagline}>shorten links, watch every click</div>
            </div>
          </div>
          {linkList.length > 0 && (
            <button
              className="snip-btn"
              onClick={() => setConfirmingReset(true)}
              style={styles.ghostSmallBtn}
            >
              <RotateCcw size={13} />
              reset data
            </button>
          )}
        </div>
      </header>

      <div style={styles.noteBar}>
        This runs entirely in your browser as a working demo of the product
        experience — the linked repo implements the real backend (Postgres
        cache-aside reads, a Redis click queue, and a background analytics
        worker). Opening a link here logs a click locally and updates the
        charts below.
      </div>

      {saveError && <div style={styles.errorBar}>{saveError}</div>}

      <main
        style={{
          ...styles.main,
          gridTemplateColumns: isNarrow ? "1fr" : "minmax(0, 360px) minmax(0, 1fr)",
        }}
      >
        <section style={styles.leftCol}>
          <form onSubmit={handleCreate} style={styles.form}>
            <label style={styles.label}>Long URL</label>
            <div style={styles.inputRow}>
              <input
                type="text"
                value={urlInput}
                onChange={(e) => {
                  setUrlInput(e.target.value);
                  if (formError) setFormError("");
                }}
                placeholder="example.com/a/very/long/path"
                style={styles.input}
              />
              <button type="submit" style={styles.primaryBtn} className="snip-btn">
                <Plus size={15} />
                shorten
              </button>
            </div>
            {formError && <div style={styles.fieldError}>{formError}</div>}
          </form>

          <div style={styles.listHeader}>
            <span>your links</span>
            <span style={styles.dimText}>{linkList.length}</span>
          </div>

          {linkList.length === 0 ? (
            <div style={styles.emptyState}>
              <Link2 size={22} color={COLORS.textFaint} />
              <div style={{ marginTop: 10, fontWeight: 500 }}>
                No links yet
              </div>
              <div style={styles.dimText}>
                Paste a URL above to create your first short link.
              </div>
            </div>
          ) : (
            <div className="snip-scroll" style={styles.list}>
              {linkList.map((link) => {
                const total = link.clicks.length;
                const isSelected = selected === link.shortCode;
                return (
                  <div
                    key={link.shortCode}
                    className="snip-row"
                    onClick={() => setSelected(link.shortCode)}
                    style={{
                      ...styles.listRow,
                      background: isSelected ? COLORS.panelAlt : "transparent",
                      borderLeft: isSelected
                        ? `2px solid ${COLORS.accent}`
                        : "2px solid transparent",
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={styles.codeRow}>
                        <span style={styles.codeChip}>/{link.shortCode}</span>
                        {total > 0 && (
                          <span style={styles.clickBadge}>
                            <MousePointerClick size={11} />
                            {total}
                          </span>
                        )}
                      </div>
                      <div style={styles.longUrlText}>{link.longUrl}</div>
                    </div>
                    <div style={styles.rowActions}>
                      <button
                        className="snip-btn"
                        title="Open destination"
                        onClick={(e) => {
                          e.stopPropagation();
                          recordClick(link.shortCode);
                        }}
                        style={styles.iconBtn}
                      >
                        <ExternalLink size={14} />
                      </button>
                      <button
                        className="snip-btn"
                        title="Delete link"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmingDelete(link.shortCode);
                        }}
                        style={styles.iconBtn}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section style={styles.rightCol}>
          {!activeLink ? (
            <div style={{ ...styles.emptyState, marginTop: 60 }}>
              <div style={styles.dimText}>
                Select a link to see its analytics.
              </div>
            </div>
          ) : (
            <>
              <div style={styles.detailHeader}>
                <div style={{ minWidth: 0 }}>
                  <div style={styles.codeRow}>
                    <span style={{ ...styles.codeChip, fontSize: 15 }}>
                      /{activeLink.shortCode}
                    </span>
                    <button
                      className="snip-btn"
                      onClick={() => copyCode(activeLink.shortCode)}
                      style={styles.copyBtn}
                    >
                      {copiedCode === activeLink.shortCode
                        ? "copied"
                        : "copy code"}
                    </button>
                  </div>
                  <div style={styles.longUrlTextFull}>
                    {activeLink.longUrl}
                  </div>
                  <div style={styles.metaRow}>
                    <Clock size={12} />
                    created {formatTime(activeLink.createdAt)}
                  </div>
                </div>
                <div style={styles.detailActions}>
                  <button
                    className="snip-btn"
                    onClick={() => recordClick(activeLink.shortCode)}
                    style={styles.primaryBtnSmall}
                  >
                    <ExternalLink size={13} />
                    open
                  </button>
                  <button
                    className="snip-btn"
                    onClick={() => generateSampleTraffic(activeLink.shortCode)}
                    style={styles.ghostSmallBtn}
                  >
                    <Sparkles size={13} />
                    sample clicks
                  </button>
                </div>
              </div>

              <div
                style={{
                  ...styles.statRow,
                  gridTemplateColumns: isNarrow
                    ? "repeat(2, minmax(0, 1fr))"
                    : "repeat(4, minmax(0, 1fr))",
                }}
              >
                <div style={styles.statCard}>
                  <div style={styles.statLabel}>total clicks</div>
                  <div style={styles.statValue}>
                    {activeLink.clicks.length}
                  </div>
                </div>
                <div style={styles.statCard}>
                  <div style={styles.statLabel}>last 14 days</div>
                  <div style={styles.statValue}>
                    {analytics.overTime.reduce((s, d) => s + d.clicks, 0)}
                  </div>
                </div>
                <div style={styles.statCard}>
                  <div style={styles.statLabel}>top browser</div>
                  <div style={styles.statValue}>
                    {analytics.byBrowser[0]
                      ? analytics.byBrowser[0].name
                      : "—"}
                  </div>
                </div>
                <div style={styles.statCard}>
                  <div style={styles.statLabel}>top device</div>
                  <div style={styles.statValue}>
                    {analytics.byDevice[0] ? analytics.byDevice[0].name : "—"}
                  </div>
                </div>
              </div>

              <div style={styles.panelBlock}>
                <div style={styles.panelTitle}>clicks, last 14 days</div>
                <div style={{ height: 160 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={analytics.overTime}
                      margin={{ top: 6, right: 6, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid
                        stroke={COLORS.border}
                        vertical={false}
                      />
                      <XAxis
                        dataKey="label"
                        tick={{
                          fill: COLORS.textFaint,
                          fontSize: 10,
                          fontFamily: "IBM Plex Mono",
                        }}
                        axisLine={{ stroke: COLORS.border }}
                        tickLine={false}
                        interval={1}
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{
                          fill: COLORS.textFaint,
                          fontSize: 10,
                          fontFamily: "IBM Plex Mono",
                        }}
                        axisLine={false}
                        tickLine={false}
                        width={28}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <Area
                        type="monotone"
                        dataKey="clicks"
                        stroke={COLORS.accent}
                        fill={COLORS.accentDim}
                        strokeWidth={1.5}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div
                style={{
                  ...styles.twoCol,
                  gridTemplateColumns: isNarrow ? "1fr" : "1fr 1fr",
                }}
              >
                <div style={styles.panelBlock}>
                  <div style={styles.panelTitle}>by browser</div>
                  {analytics.byBrowser.length === 0 ? (
                    <div style={styles.dimTextSmall}>No data yet.</div>
                  ) : (
                    <div style={{ height: 130 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={analytics.byBrowser}
                          layout="vertical"
                          margin={{ top: 0, right: 12, left: 0, bottom: 0 }}
                        >
                          <XAxis type="number" hide allowDecimals={false} />
                          <YAxis
                            type="category"
                            dataKey="name"
                            tick={{
                              fill: COLORS.textDim,
                              fontSize: 11,
                              fontFamily: "IBM Plex Mono",
                            }}
                            axisLine={false}
                            tickLine={false}
                            width={56}
                          />
                          <Tooltip content={<ChartTooltip />} cursor={false} />
                          <Bar
                            dataKey="count"
                            fill={COLORS.accent}
                            radius={[0, 2, 2, 0]}
                            barSize={12}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>

                <div style={styles.panelBlock}>
                  <div style={styles.panelTitle}>by device</div>
                  {analytics.byDevice.length === 0 ? (
                    <div style={styles.dimTextSmall}>No data yet.</div>
                  ) : (
                    <div style={{ height: 130 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={analytics.byDevice}
                          layout="vertical"
                          margin={{ top: 0, right: 12, left: 0, bottom: 0 }}
                        >
                          <XAxis type="number" hide allowDecimals={false} />
                          <YAxis
                            type="category"
                            dataKey="name"
                            tick={{
                              fill: COLORS.textDim,
                              fontSize: 11,
                              fontFamily: "IBM Plex Mono",
                            }}
                            axisLine={false}
                            tickLine={false}
                            width={56}
                          />
                          <Tooltip content={<ChartTooltip />} cursor={false} />
                          <Bar
                            dataKey="count"
                            fill={COLORS.ok}
                            radius={[0, 2, 2, 0]}
                            barSize={12}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              </div>

              <div style={styles.panelBlock}>
                <div style={styles.panelTitle}>recent clicks</div>
                {activeLink.clicks.length === 0 ? (
                  <div style={styles.dimTextSmall}>
                    No clicks yet. Open the link or generate sample clicks to
                    see the dashboard in action.
                  </div>
                ) : (
                  <div style={styles.table}>
                    <div style={styles.tableHeadRow}>
                      <span>time</span>
                      <span>browser</span>
                      <span>device</span>
                      <span>country</span>
                    </div>
                    <div className="snip-scroll" style={styles.tableBody}>
                      {[...activeLink.clicks]
                        .sort((a, b) => b.ts - a.ts)
                        .slice(0, 30)
                        .map((c, i) => (
                          <div key={i} style={styles.tableRow}>
                            <span title={formatTime(c.ts)}>
                              {timeAgo(c.ts)}
                            </span>
                            <span>{c.browser}</span>
                            <span>{c.device}</span>
                            <span>{c.country}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </main>

      {confirmingDelete && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <div style={styles.modalHeaderRow}>
              <div style={styles.modalTitle}>Delete link</div>
              <button
                className="snip-btn"
                onClick={() => setConfirmingDelete(null)}
                style={styles.iconBtn}
              >
                <X size={14} />
              </button>
            </div>
            <div style={styles.modalBody}>
              This removes <span style={styles.mono}>/{confirmingDelete}</span>{" "}
              and all {links[confirmingDelete]?.clicks.length || 0} of its
              recorded clicks. This can't be undone.
            </div>
            <div style={styles.modalActions}>
              <button
                className="snip-btn"
                onClick={() => setConfirmingDelete(null)}
                style={styles.ghostSmallBtn}
              >
                cancel
              </button>
              <button
                className="snip-btn"
                onClick={() => deleteLink(confirmingDelete)}
                style={styles.dangerBtn}
              >
                delete link
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmingReset && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <div style={styles.modalHeaderRow}>
              <div style={styles.modalTitle}>Reset all data</div>
              <button
                className="snip-btn"
                onClick={() => setConfirmingReset(false)}
                style={styles.iconBtn}
              >
                <X size={14} />
              </button>
            </div>
            <div style={styles.modalBody}>
              This deletes every short link and click record stored in this
              browser. This can't be undone.
            </div>
            <div style={styles.modalActions}>
              <button
                className="snip-btn"
                onClick={() => setConfirmingReset(false)}
                style={styles.ghostSmallBtn}
              >
                cancel
              </button>
              <button
                className="snip-btn"
                onClick={resetAll}
                style={styles.dangerBtn}
              >
                reset everything
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const mono = "'IBM Plex Mono', monospace";
const sans = "'IBM Plex Sans', sans-serif";

const styles = {
  page: {
    fontFamily: sans,
    background: COLORS.bg,
    color: COLORS.text,
    minHeight: 600,
    width: "100%",
  },
  header: {
    borderBottom: `1px solid ${COLORS.border}`,
    padding: "16px 20px",
  },
  headerInner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    maxWidth: 1040,
    margin: "0 auto",
  },
  logoRow: { display: "flex", alignItems: "center", gap: 10 },
  logoMark: {
    width: 26,
    height: 26,
    borderRadius: 6,
    background: COLORS.accent,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  wordmark: {
    fontFamily: mono,
    fontWeight: 500,
    fontSize: 16,
    letterSpacing: "-0.02em",
    lineHeight: 1.1,
  },
  tagline: { fontSize: 11, color: COLORS.textFaint, marginTop: 1 },
  noteBar: {
    maxWidth: 1040,
    margin: "14px auto 0",
    padding: "10px 14px",
    background: COLORS.panel,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 6,
    fontSize: 12.5,
    lineHeight: 1.6,
    color: COLORS.textDim,
  },
  errorBar: {
    maxWidth: 1040,
    margin: "10px auto 0",
    padding: "8px 14px",
    background: "#2A1917",
    border: `1px solid ${COLORS.danger}`,
    borderRadius: 6,
    fontSize: 12.5,
    color: "#F0A79E",
  },
  main: {
    maxWidth: 1040,
    margin: "0 auto",
    padding: "20px",
    display: "grid",
    gridTemplateColumns: "minmax(0, 360px) minmax(0, 1fr)",
    gap: 20,
  },
  leftCol: { display: "flex", flexDirection: "column", minWidth: 0 },
  rightCol: {
    minWidth: 0,
    background: COLORS.panel,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 8,
    padding: 18,
  },
  form: {
    background: COLORS.panel,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 8,
    padding: 14,
    marginBottom: 16,
  },
  label: {
    fontSize: 11,
    color: COLORS.textFaint,
    display: "block",
    marginBottom: 6,
  },
  inputRow: { display: "flex", gap: 8 },
  input: {
    flex: 1,
    minWidth: 0,
    background: COLORS.panelAlt,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 6,
    padding: "9px 10px",
    color: COLORS.text,
    fontSize: 13,
    fontFamily: mono,
  },
  fieldError: { fontSize: 12, color: COLORS.danger, marginTop: 8 },
  primaryBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: COLORS.accent,
    color: "#241a08",
    border: "none",
    borderRadius: 6,
    padding: "0 14px",
    fontSize: 13,
    fontWeight: 500,
    fontFamily: sans,
  },
  primaryBtnSmall: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    background: COLORS.accent,
    color: "#241a08",
    border: "none",
    borderRadius: 6,
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 500,
    fontFamily: sans,
    whiteSpace: "nowrap",
  },
  ghostSmallBtn: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    background: "transparent",
    color: COLORS.textDim,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 6,
    padding: "6px 12px",
    fontSize: 12,
    fontFamily: sans,
    whiteSpace: "nowrap",
  },
  dangerBtn: {
    background: COLORS.danger,
    color: "#2A0F0C",
    border: "none",
    borderRadius: 6,
    padding: "7px 14px",
    fontSize: 12.5,
    fontWeight: 500,
    fontFamily: sans,
  },
  listHeader: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 11,
    color: COLORS.textFaint,
    padding: "0 2px 8px",
    letterSpacing: "0.02em",
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    maxHeight: 560,
    overflowY: "auto",
  },
  listRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 10px",
    borderRadius: 4,
    cursor: "pointer",
  },
  codeRow: { display: "flex", alignItems: "center", gap: 8 },
  codeChip: {
    fontFamily: mono,
    fontSize: 13,
    color: COLORS.accentText,
    fontWeight: 500,
  },
  clickBadge: {
    display: "flex",
    alignItems: "center",
    gap: 3,
    fontSize: 10.5,
    color: COLORS.textFaint,
    fontFamily: mono,
  },
  longUrlText: {
    fontSize: 12,
    color: COLORS.textDim,
    marginTop: 3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  longUrlTextFull: {
    fontSize: 12.5,
    color: COLORS.textDim,
    marginTop: 4,
    wordBreak: "break-all",
  },
  rowActions: { display: "flex", gap: 2, flexShrink: 0 },
  iconBtn: {
    background: "transparent",
    border: "none",
    color: COLORS.textFaint,
    padding: 5,
    borderRadius: 4,
    display: "flex",
  },
  copyBtn: {
    background: "transparent",
    border: `1px solid ${COLORS.border}`,
    color: COLORS.textDim,
    fontSize: 10.5,
    fontFamily: mono,
    padding: "3px 8px",
    borderRadius: 4,
  },
  emptyState: {
    border: `1px dashed ${COLORS.border}`,
    borderRadius: 8,
    padding: "28px 16px",
    textAlign: "center",
    color: COLORS.textDim,
    fontSize: 13,
  },
  dimText: { color: COLORS.textFaint, fontSize: 12 },
  dimTextSmall: { color: COLORS.textFaint, fontSize: 12, padding: "8px 0" },
  detailHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    paddingBottom: 16,
    borderBottom: `1px solid ${COLORS.border}`,
    marginBottom: 16,
    flexWrap: "wrap",
  },
  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    fontSize: 11,
    color: COLORS.textFaint,
    marginTop: 8,
  },
  detailActions: { display: "flex", gap: 8, flexShrink: 0 },
  statRow: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 10,
    marginBottom: 18,
  },
  statCard: {
    background: COLORS.panelAlt,
    borderRadius: 6,
    padding: "10px 12px",
  },
  statLabel: { fontSize: 10.5, color: COLORS.textFaint, marginBottom: 4 },
  statValue: {
    fontSize: 18,
    fontFamily: mono,
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  panelBlock: { marginBottom: 18 },
  panelTitle: {
    fontSize: 11,
    color: COLORS.textFaint,
    marginBottom: 10,
    letterSpacing: "0.02em",
  },
  twoCol: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 16,
    marginBottom: 18,
  },
  table: { fontFamily: mono, fontSize: 12 },
  tableHeadRow: {
    display: "grid",
    gridTemplateColumns: "1.2fr 1fr 1fr 1fr",
    color: COLORS.textFaint,
    fontSize: 10.5,
    paddingBottom: 6,
    borderBottom: `1px solid ${COLORS.border}`,
  },
  tableBody: { maxHeight: 220, overflowY: "auto" },
  tableRow: {
    display: "grid",
    gridTemplateColumns: "1.2fr 1fr 1fr 1fr",
    padding: "7px 0",
    borderBottom: `1px solid ${COLORS.panelAlt}`,
    color: COLORS.textDim,
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.55)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 50,
  },
  modal: {
    background: COLORS.panel,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 8,
    padding: 18,
    width: 340,
    maxWidth: "90vw",
  },
  modalHeaderRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  modalTitle: { fontSize: 14, fontWeight: 500 },
  modalBody: {
    fontSize: 13,
    color: COLORS.textDim,
    lineHeight: 1.6,
    marginBottom: 16,
  },
  modalActions: { display: "flex", justifyContent: "flex-end", gap: 8 },
  mono: { fontFamily: mono, color: COLORS.accentText },
};
