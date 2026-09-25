import { useEffect, useState, useCallback } from "react";
import api, { formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { LifeBuoy, Plus, RefreshCw, Search, X, Send, MessageSquare } from "lucide-react";
import StatChip from "@/components/StatChip";
import MarketplaceSelector from "@/components/MarketplaceSelector";
import { fmtInt } from "@/lib/format";

const STATUS_TONE = {
  open: "bg-blue-50 text-blue-700 border-blue-200",
  awaiting_seller: "bg-amber-50 text-amber-700 border-amber-200",
  responded: "bg-violet-50 text-violet-700 border-violet-200",
  resolved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  closed: "bg-slate-100 text-slate-600 border-slate-200",
};
const PRIO_TONE = {
  urgent: "bg-rose-50 text-rose-700 border-rose-200",
  high: "bg-orange-50 text-orange-700 border-orange-200",
  medium: "bg-slate-50 text-slate-600 border-slate-200",
  low: "bg-slate-50 text-slate-500 border-slate-200",
};
const Badge = ({ tone, children }) => (
  <span className={`inline-block border px-2 py-0.5 rounded-sm text-[10px] mono uppercase tracking-wide ${tone}`}>{children}</span>
);

export default function SellerSupport() {
  const [summary, setSummary] = useState(null);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [marketplace, setMarketplace] = useState("all");
  const [filters, setFilters] = useState({ status: "", category: "", search: "" });
  const [showNew, setShowNew] = useState(false);
  const [drawerId, setDrawerId] = useState(null);

  const load = useCallback(async () => {
    const params = {
      portal_name: marketplace, status: filters.status || undefined,
      category: filters.category || undefined, search: filters.search || undefined, limit: 500,
    };
    const [s, l] = await Promise.all([
      api.get("/support/summary", { params: { portal_name: marketplace } }),
      api.get("/support/tickets", { params }),
    ]);
    setSummary(s.data);
    setItems(l.data.items);
    setTotal(l.data.total);
  }, [marketplace, filters.status, filters.category, filters.search]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 space-y-4" data-testid="seller-support-page">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="overline">Seller Support</div>
          <h1 className="text-2xl font-semibold tracking-tight mt-1 text-slate-900 flex items-center gap-2">
            <LifeBuoy size={18} className="text-blue-600" /> Seller Support Queries
          </h1>
          <p className="text-sm text-slate-500 mt-1 mono">
            {fmtInt(total)} tickets · Raise queries with marketplace seller support, log replies and follow up to closure.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <MarketplaceSelector value={marketplace} onChange={setMarketplace} testId="support-marketplace" />
          <button data-testid="btn-new-ticket" onClick={() => setShowNew(true)} className="btn btn-primary"><Plus size={12} /> New query</button>
          <button data-testid="btn-support-refresh" onClick={load} className="btn"><RefreshCw size={12} /> Refresh</button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatChip testId="support-kpi-total" label="Total Tickets" value={fmtInt(summary?.total)} />
        <StatChip testId="support-kpi-open" label="Open / In-flight" value={fmtInt(summary?.open)} tone="warning" />
        <StatChip testId="support-kpi-awaiting" label="Awaiting Seller" value={fmtInt(summary?.by_status?.awaiting_seller)} tone="neutral" />
        <StatChip testId="support-kpi-resolved" label="Resolved / Closed" value={fmtInt(summary?.resolved)} tone="positive" />
      </div>

      <div className="border border-border bg-white p-3 rounded-sm flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
          <input data-testid="support-search" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && load()} placeholder="Subject / order / SKU" className="input pl-7 w-56" />
        </div>
        <select data-testid="support-filter-status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className="input">
          <option value="">All statuses</option>
          {["open", "awaiting_seller", "responded", "resolved", "closed"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select data-testid="support-filter-category" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })} className="input">
          <option value="">All categories</option>
          {["general", "weight", "return", "settlement", "other"].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="border border-border bg-white overflow-auto max-h-[calc(100vh-360px)] rounded-sm">
        <table className="w-full text-xs">
          <thead className="grid-header sticky top-0 z-10">
            <tr>
              <th className="grid-cell text-left">Ticket</th>
              <th className="grid-cell text-left">Subject</th>
              <th className="grid-cell text-left">Marketplace</th>
              <th className="grid-cell text-left">Category</th>
              <th className="grid-cell text-left">Priority</th>
              <th className="grid-cell text-left">Status</th>
              <th className="grid-cell text-right">Msgs</th>
              <th className="grid-cell text-left">Last activity</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={8} className="grid-cell text-center text-slate-400 py-10">
                No tickets yet. Click <span className="mono">New query</span> to raise one with seller support.
              </td></tr>
            ) : items.map((t) => (
              <tr key={t.id} className="grid-row cursor-pointer hover:bg-slate-50" data-testid={`ticket-row-${t.id}`} onClick={() => setDrawerId(t.id)}>
                <td className="grid-cell mono text-slate-700">{t.ticket_no}</td>
                <td className="grid-cell font-medium text-slate-800">{t.subject}</td>
                <td className="grid-cell">{t.portal_name}</td>
                <td className="grid-cell">{t.category}</td>
                <td className="grid-cell"><Badge tone={PRIO_TONE[t.priority]}>{t.priority}</Badge></td>
                <td className="grid-cell"><Badge tone={STATUS_TONE[t.status]}>{t.status?.replace("_", " ")}</Badge></td>
                <td className="grid-cell text-right">{(t.messages || []).length}</td>
                <td className="grid-cell text-slate-500">{t.last_activity_at ? new Date(t.last_activity_at).toLocaleString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showNew && <NewTicketModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} marketplace={marketplace} />}
      {drawerId && <TicketDrawer id={drawerId} onClose={() => { setDrawerId(null); load(); }} />}
    </div>
  );
}

function NewTicketModal({ onClose, onCreated, marketplace }) {
  const [form, setForm] = useState({
    subject: "", portal_name: marketplace !== "all" ? marketplace : "Myntra",
    category: "general", priority: "medium", order_id: "", sku: "", body: "",
  });
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!form.subject.trim()) { toast.error("Subject required"); return; }
    setSaving(true);
    try {
      await api.post("/support/tickets", {
        ...form, order_id: form.order_id || null, sku: form.sku || null, body: form.body || null,
      });
      toast.success("Ticket raised");
      onCreated();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" data-testid="new-ticket-modal">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white border border-border rounded-sm w-full max-w-lg p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="overline">Raise Seller Support Query</div>
          <button onClick={onClose} className="btn"><X size={14} /></button>
        </div>
        <label className="block"><div className="overline mb-1">Subject</div>
          <input data-testid="new-ticket-subject" className="input w-full" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block"><div className="overline mb-1">Marketplace</div>
            <input data-testid="new-ticket-portal" className="input w-full" value={form.portal_name} onChange={(e) => setForm({ ...form, portal_name: e.target.value })} /></label>
          <label className="block"><div className="overline mb-1">Category</div>
            <select data-testid="new-ticket-category" className="input w-full" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {["general", "weight", "return", "settlement", "other"].map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          <label className="block"><div className="overline mb-1">Order ID (optional)</div>
            <input data-testid="new-ticket-order" className="input w-full" value={form.order_id} onChange={(e) => setForm({ ...form, order_id: e.target.value })} /></label>
          <label className="block"><div className="overline mb-1">SKU (optional)</div>
            <input data-testid="new-ticket-sku" className="input w-full" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></label>
        </div>
        <label className="block"><div className="overline mb-1">Priority</div>
          <select data-testid="new-ticket-priority" className="input w-full" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            {["low", "medium", "high", "urgent"].map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
        <label className="block"><div className="overline mb-1">Message to seller support</div>
          <textarea data-testid="new-ticket-body" rows={3} className="input w-full" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></label>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn">Cancel</button>
          <button data-testid="btn-submit-ticket" disabled={saving} onClick={submit} className="btn btn-primary">{saving ? "Raising…" : "Raise ticket"}</button>
        </div>
      </div>
    </div>
  );
}

function TicketDrawer({ id, onClose }) {
  const [t, setT] = useState(null);
  const [reply, setReply] = useState({ author_role: "agent", body: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data } = await api.get(`/support/tickets/${id}`);
    setT(data);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const send = async () => {
    if (!reply.body.trim()) return;
    setSaving(true);
    try {
      await api.post(`/support/tickets/${id}/messages`, reply);
      setReply({ ...reply, body: "" });
      await load();
      toast.success("Message added");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSaving(false); }
  };
  const setStatus = async (status) => {
    try { await api.patch(`/support/tickets/${id}`, { status }); await load(); toast.success(`Marked ${status}`); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  return (
    <div className="fixed inset-0 z-40" data-testid="ticket-drawer">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-2xl bg-white border-l border-border overflow-auto flex flex-col">
        <div className="p-5 border-b border-border flex items-start justify-between">
          <div>
            <div className="overline">Ticket {t?.ticket_no}</div>
            <div className="text-lg mt-1 text-slate-900">{t?.subject || "…"}</div>
            {t && <div className="mt-2 flex flex-wrap gap-2">
              <Badge tone={STATUS_TONE[t.status]}>{t.status?.replace("_", " ")}</Badge>
              <Badge tone={PRIO_TONE[t.priority]}>{t.priority}</Badge>
              <span className="text-xs mono text-slate-500">{t.portal_name} · {t.category}{t.order_id ? ` · ${t.order_id}` : ""}{t.sku ? ` · ${t.sku}` : ""}</span>
            </div>}
          </div>
          <button data-testid="close-ticket-drawer" onClick={onClose} className="btn"><X size={14} /></button>
        </div>

        {!t ? <div className="p-8 text-center text-slate-400 mono text-xs">Loading…</div> : (
          <>
            <div className="p-5 flex-1 space-y-3 overflow-auto">
              <div className="overline flex items-center gap-1"><MessageSquare size={12} /> Conversation</div>
              {(t.messages || []).length === 0 && <div className="text-xs text-slate-400 mono">No messages yet.</div>}
              {(t.messages || []).map((m) => (
                <div key={m.id} className={`p-3 rounded-sm border text-sm ${m.author_role === "seller" ? "bg-violet-50/50 border-violet-200 ml-8" : "bg-slate-50 border-slate-200 mr-8"}`} data-testid={`msg-${m.id}`}>
                  <div className="flex items-center justify-between text-[10px] mono uppercase tracking-wide text-slate-500">
                    <span>{m.author_role === "seller" ? "Seller Support" : "Us / Ops"} · {m.author}</span>
                    <span>{new Date(m.created_at).toLocaleString()}</span>
                  </div>
                  <div className="mt-1 text-slate-700 whitespace-pre-wrap">{m.body}</div>
                </div>
              ))}
            </div>

            <div className="p-4 border-t border-border space-y-2 bg-slate-50/40">
              <div className="flex gap-2">
                <select data-testid="reply-role" value={reply.author_role} onChange={(e) => setReply({ ...reply, author_role: e.target.value })} className="input text-xs">
                  <option value="agent">Our follow-up</option>
                  <option value="seller">Record seller reply</option>
                </select>
                <div className="flex gap-1 ml-auto">
                  <button data-testid="btn-mark-resolved" onClick={() => setStatus("resolved")} className="btn text-xs">Resolve</button>
                  <button data-testid="btn-mark-closed" onClick={() => setStatus("closed")} className="btn text-xs">Close</button>
                </div>
              </div>
              <textarea data-testid="reply-body" rows={2} value={reply.body} onChange={(e) => setReply({ ...reply, body: e.target.value })} placeholder="Type a message / follow-up…" className="input w-full text-xs" />
              <button data-testid="btn-send-reply" disabled={saving} onClick={send} className="btn btn-primary text-xs"><Send size={12} /> {saving ? "Sending…" : "Add message"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
