import { useEffect, useState, useCallback } from "react";
import api, { formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { PackageOpen, Plus, RefreshCw, Search, Send, Trash2, ScanLine, AlertTriangle } from "lucide-react";
import StatChip from "@/components/StatChip";
import MarketplaceSelector from "@/components/MarketplaceSelector";
import { fmtInt, fmtCurrency } from "@/lib/format";

const RETURN_STATUSES = [
  "initiated", "in_transit", "received", "qc_pending", "qc_failed",
  "refunded", "closed", "lost_in_transit", "damaged",
];
const PROBLEM = new Set(["qc_failed", "lost_in_transit", "damaged"]);
const STATUS_TONE = {
  initiated: "bg-blue-50 text-blue-700 border-blue-200",
  in_transit: "bg-sky-50 text-sky-700 border-sky-200",
  received: "bg-indigo-50 text-indigo-700 border-indigo-200",
  qc_pending: "bg-amber-50 text-amber-700 border-amber-200",
  qc_failed: "bg-rose-50 text-rose-700 border-rose-200",
  refunded: "bg-emerald-50 text-emerald-700 border-emerald-200",
  closed: "bg-slate-100 text-slate-600 border-slate-200",
  lost_in_transit: "bg-rose-100 text-rose-700 border-rose-300",
  damaged: "bg-rose-50 text-rose-700 border-rose-200",
};

export default function ReturnOrders() {
  const [summary, setSummary] = useState(null);
  const [items, setItems] = useState([]);
  const [marketplace, setMarketplace] = useState("all");
  const [filters, setFilters] = useState({ return_status: "", issues_only: false, search: "" });
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    const params = {
      portal_name: marketplace, return_status: filters.return_status || undefined,
      issues_only: filters.issues_only || undefined, search: filters.search || undefined, limit: 500,
    };
    const [s, l] = await Promise.all([
      api.get("/returns/summary", { params: { portal_name: marketplace } }),
      api.get("/returns", { params }),
    ]);
    setSummary(s.data);
    setItems(l.data.items);
  }, [marketplace, filters.return_status, filters.issues_only, filters.search]);
  useEffect(() => { load(); }, [load]);

  const scan = async () => {
    try {
      const { data } = await api.post("/returns/scan");
      toast.success(`${data.created} return orders derived · ${data.skipped} already tracked`);
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  return (
    <div className="p-6 space-y-4" data-testid="returns-page">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="overline">Returns</div>
          <h1 className="text-2xl font-semibold tracking-tight mt-1 text-slate-900 flex items-center gap-2">
            <PackageOpen size={18} className="text-emerald-600" /> Return Orders Management
          </h1>
          <p className="text-sm text-slate-500 mt-1 mono">
            Monitor return orders; problem statuses auto-raise seller-support tickets and track to resolution.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <MarketplaceSelector value={marketplace} onChange={setMarketplace} testId="returns-marketplace" />
          <button data-testid="btn-scan-returns" onClick={scan} className="btn"><ScanLine size={12} /> Scan sales</button>
          <button data-testid="btn-new-return" onClick={() => setShowNew(true)} className="btn btn-primary"><Plus size={12} /> Add return</button>
          <button data-testid="btn-returns-refresh" onClick={load} className="btn"><RefreshCw size={12} /> Refresh</button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatChip testId="returns-kpi-total" label="Total Returns" value={fmtInt(summary?.total)} />
        <StatChip testId="returns-kpi-issues" label="Issue Returns" value={fmtInt(summary?.issues)} tone="critical" />
        <StatChip testId="returns-kpi-ticketed" label="Tickets Raised" value={fmtInt(summary?.ticketed)} tone="warning" />
        <StatChip testId="returns-kpi-refund" label="Refund Value" value={fmtCurrency(summary?.total_refund)} />
      </div>

      <div className="border border-border bg-white p-3 rounded-sm flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
          <input data-testid="returns-search" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && load()} placeholder="SKU / order / tracking" className="input pl-7 w-56" />
        </div>
        <select data-testid="returns-filter-status" value={filters.return_status} onChange={(e) => setFilters({ ...filters, return_status: e.target.value })} className="input">
          <option value="">All statuses</option>
          {RETURN_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
        </select>
        <label className="inline-flex items-center gap-1.5 text-xs mono text-slate-600 cursor-pointer">
          <input data-testid="returns-issues-only" type="checkbox" checked={filters.issues_only} onChange={(e) => setFilters({ ...filters, issues_only: e.target.checked })} />
          <AlertTriangle size={12} className="text-rose-500" /> Issues only
        </label>
      </div>

      <div className="border border-border bg-white overflow-auto max-h-[calc(100vh-360px)] rounded-sm">
        <table className="w-full text-xs">
          <thead className="grid-header sticky top-0 z-10">
            <tr>
              <th className="grid-cell text-left">SKU</th>
              <th className="grid-cell text-left">Order</th>
              <th className="grid-cell text-left">Market</th>
              <th className="grid-cell text-left">Type</th>
              <th className="grid-cell text-left">Reason</th>
              <th className="grid-cell text-right">Refund</th>
              <th className="grid-cell text-left">Status</th>
              <th className="grid-cell text-left">Ticket</th>
              <th className="grid-cell text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={9} className="grid-cell text-center text-slate-400 py-10">
                No return orders. Use <span className="mono">Scan sales</span> to derive from ingested returns, or <span className="mono">Add return</span>.
              </td></tr>
            ) : items.map((r) => <ReturnRow key={r.id} r={r} onChanged={load} />)}
          </tbody>
        </table>
      </div>

      {showNew && <NewReturnModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} marketplace={marketplace} />}
    </div>
  );
}

function ReturnRow({ r, onChanged }) {
  const [status, setStatus] = useState(r.return_status);
  const changeStatus = async (val) => {
    setStatus(val);
    try {
      const { data } = await api.patch(`/returns/${r.id}`, { return_status: val });
      if (data.auto_ticket) toast.success(`Auto-raised ticket ${data.auto_ticket.ticket_no}`);
      else toast.success("Status updated");
      onChanged();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const raise = async () => {
    try { const { data } = await api.post(`/returns/${r.id}/create-ticket`); toast.success(`Ticket ${data.ticket.ticket_no} raised`); onChanged(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const del = async () => {
    if (!window.confirm("Delete return order?")) return;
    try { await api.delete(`/returns/${r.id}`); onChanged(); } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  return (
    <tr className="grid-row" data-testid={`return-row-${r.id}`}>
      <td className="grid-cell font-medium text-slate-800">{r.sku}</td>
      <td className="grid-cell text-slate-500">{r.order_id || "—"}</td>
      <td className="grid-cell">{r.portal_name}</td>
      <td className="grid-cell">{(r.return_type || "").replace(/_/g, " ")}</td>
      <td className="grid-cell text-slate-500 max-w-[160px] truncate" title={r.reason}>{r.reason || "—"}</td>
      <td className="grid-cell text-right mono">{fmtCurrency(r.refund_amount)}</td>
      <td className="grid-cell">
        <select data-testid={`return-status-${r.id}`} value={status} onChange={(e) => changeStatus(e.target.value)} className={`border px-1.5 py-0.5 rounded-sm text-[10px] mono ${STATUS_TONE[status] || ""}`}>
          {RETURN_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
        </select>
      </td>
      <td className="grid-cell mono text-[10px] text-slate-500">{r.ticket_no || "—"}</td>
      <td className="grid-cell text-right">
        <div className="inline-flex gap-1">
          <button data-testid={`return-raise-${r.id}`} onClick={raise} disabled={!!r.ticket_id} className="border border-border hover:bg-secondary p-1 disabled:opacity-40" title={r.ticket_no ? `Ticket ${r.ticket_no}` : "Create ticket"}><Send size={12} /></button>
          <button data-testid={`return-del-${r.id}`} onClick={del} className="border border-border hover:bg-rose-50 hover:text-rose-600 p-1" title="Delete"><Trash2 size={12} /></button>
        </div>
      </td>
    </tr>
  );
}

function NewReturnModal({ onClose, onCreated, marketplace }) {
  const [form, setForm] = useState({
    portal_name: marketplace !== "all" ? marketplace : "Myntra", sku: "", order_id: "",
    return_type: "customer_return", reason: "", qty: 1, return_status: "initiated",
    refund_amount: 0, tracking_no: "",
  });
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!form.sku.trim()) { toast.error("SKU required"); return; }
    setSaving(true);
    try {
      const { data } = await api.post("/returns", {
        ...form, order_id: form.order_id || null, reason: form.reason || null,
        tracking_no: form.tracking_no || null, qty: Number(form.qty), refund_amount: Number(form.refund_amount),
      });
      if (data.auto_ticket) toast.success(`Return added · ticket ${data.auto_ticket.ticket_no} auto-raised`);
      else toast.success("Return added");
      onCreated();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" data-testid="new-return-modal">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white border border-border rounded-sm w-full max-w-lg p-5 space-y-3">
        <div className="overline">Add Return Order</div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block"><div className="overline mb-1">SKU</div>
            <input data-testid="return-new-sku" className="input w-full" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></label>
          <label className="block"><div className="overline mb-1">Marketplace</div>
            <input data-testid="return-new-portal" className="input w-full" value={form.portal_name} onChange={(e) => setForm({ ...form, portal_name: e.target.value })} /></label>
          <label className="block"><div className="overline mb-1">Order ID (optional)</div>
            <input data-testid="return-new-order" className="input w-full" value={form.order_id} onChange={(e) => setForm({ ...form, order_id: e.target.value })} /></label>
          <label className="block"><div className="overline mb-1">Return type</div>
            <select data-testid="return-new-type" className="input w-full" value={form.return_type} onChange={(e) => setForm({ ...form, return_type: e.target.value })}>
              {["customer_return", "rto", "courier_return"].map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}</select></label>
          <label className="block"><div className="overline mb-1">Status</div>
            <select data-testid="return-new-status" className="input w-full" value={form.return_status} onChange={(e) => setForm({ ...form, return_status: e.target.value })}>
              {RETURN_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</select></label>
          <label className="block"><div className="overline mb-1">Refund amount (₹)</div>
            <input data-testid="return-new-refund" type="number" className="input w-full" value={form.refund_amount} onChange={(e) => setForm({ ...form, refund_amount: e.target.value })} /></label>
          <label className="block col-span-2"><div className="overline mb-1">Reason (optional)</div>
            <input data-testid="return-new-reason" className="input w-full" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
        </div>
        <p className="text-[11px] text-slate-500 mono">Setting status to <b>qc_failed</b>, <b>damaged</b> or <b>lost_in_transit</b> auto-raises a seller-support ticket.</p>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn">Cancel</button>
          <button data-testid="btn-submit-return" disabled={saving} onClick={submit} className="btn btn-primary">{saving ? "Saving…" : "Add"}</button>
        </div>
      </div>
    </div>
  );
}
