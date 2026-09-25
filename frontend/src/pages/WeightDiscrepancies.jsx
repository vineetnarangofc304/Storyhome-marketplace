import { useEffect, useState, useCallback } from "react";
import api, { formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { Scale, Plus, RefreshCw, Search, Save, Trash2, Send } from "lucide-react";
import StatChip from "@/components/StatChip";
import MarketplaceSelector from "@/components/MarketplaceSelector";
import { fmtInt, fmtCurrency } from "@/lib/format";

const STATUS_TONE = {
  identified: "bg-blue-50 text-blue-700 border-blue-200",
  under_review: "bg-amber-50 text-amber-700 border-amber-200",
  disputed: "bg-violet-50 text-violet-700 border-violet-200",
  resolved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  recovered: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-rose-50 text-rose-700 border-rose-200",
};
const STATUSES = ["identified", "under_review", "disputed", "resolved", "rejected", "recovered"];

export default function WeightDiscrepancies() {
  const [summary, setSummary] = useState(null);
  const [items, setItems] = useState([]);
  const [marketplace, setMarketplace] = useState("all");
  const [filters, setFilters] = useState({ status: "", search: "" });
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    const params = { portal_name: marketplace, status: filters.status || undefined, search: filters.search || undefined, limit: 500 };
    const [s, l] = await Promise.all([
      api.get("/weight/summary", { params: { portal_name: marketplace } }),
      api.get("/weight/discrepancies", { params }),
    ]);
    setSummary(s.data);
    setItems(l.data.items);
  }, [marketplace, filters.status, filters.search]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 space-y-4" data-testid="weight-page">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="overline">Weight Charges</div>
          <h1 className="text-2xl font-semibold tracking-tight mt-1 text-slate-900 flex items-center gap-2">
            <Scale size={18} className="text-orange-600" /> Weight-Charge Discrepancies
          </h1>
          <p className="text-sm text-slate-500 mt-1 mono">
            Identify overcharged weights, apply SKU-wise weight corrections, and dispute with seller support.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <MarketplaceSelector value={marketplace} onChange={setMarketplace} testId="weight-marketplace" />
          <button data-testid="btn-new-weight" onClick={() => setShowNew(true)} className="btn btn-primary"><Plus size={12} /> Add discrepancy</button>
          <button data-testid="btn-weight-refresh" onClick={load} className="btn"><RefreshCw size={12} /> Refresh</button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatChip testId="weight-kpi-total" label="Total Cases" value={fmtInt(summary?.total)} />
        <StatChip testId="weight-kpi-open" label="Open (id/review/disputed)" value={fmtInt(summary?.open)} tone="warning" />
        <StatChip testId="weight-kpi-overcharged" label="Overcharged Cases" value={fmtInt(summary?.overcharged_cases)} tone="negative" />
        <StatChip testId="weight-kpi-recoverable" label="Total Recoverable" value={fmtCurrency(summary?.total_recoverable)} tone="positive" />
      </div>

      <div className="border border-border bg-white p-3 rounded-sm flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
          <input data-testid="weight-search" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && load()} placeholder="SKU / order / AWB" className="input pl-7 w-56" />
        </div>
        <select data-testid="weight-filter-status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className="input">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="border border-border bg-white overflow-auto max-h-[calc(100vh-360px)] rounded-sm">
        <table className="w-full text-xs">
          <thead className="grid-header sticky top-0 z-10">
            <tr>
              <th className="grid-cell text-left">SKU</th>
              <th className="grid-cell text-left">Order</th>
              <th className="grid-cell text-left">Market</th>
              <th className="grid-cell text-right">Charged Wt</th>
              <th className="grid-cell text-right">Expected Wt</th>
              <th className="grid-cell text-right">Δ Wt</th>
              <th className="grid-cell text-right">Amt Variance</th>
              <th className="grid-cell text-left">Status</th>
              <th className="grid-cell text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={9} className="grid-cell text-center text-slate-400 py-10">
                No weight discrepancies. Click <span className="mono">Add discrepancy</span> to log one.
              </td></tr>
            ) : items.map((w) => <WeightRow key={w.id} w={w} onChanged={load} />)}
          </tbody>
        </table>
      </div>

      {showNew && <NewWeightModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} marketplace={marketplace} />}
    </div>
  );
}

function WeightRow({ w, onChanged }) {
  const [cw, setCw] = useState(w.charged_weight);
  const [ew, setEw] = useState(w.expected_weight);
  const [status, setStatus] = useState(w.status);
  const save = async () => {
    try {
      await api.patch(`/weight/discrepancies/${w.id}`, { charged_weight: Number(cw), expected_weight: Number(ew), status });
      toast.success("Updated"); onChanged();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const raise = async () => {
    try { const { data } = await api.post(`/weight/discrepancies/${w.id}/raise-ticket`); toast.success(`Ticket ${data.ticket.ticket_no} raised`); onChanged(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const del = async () => {
    if (!window.confirm("Delete discrepancy?")) return;
    try { await api.delete(`/weight/discrepancies/${w.id}`); onChanged(); } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  return (
    <tr className="grid-row" data-testid={`weight-row-${w.id}`}>
      <td className="grid-cell font-medium text-slate-800">{w.sku}</td>
      <td className="grid-cell text-slate-500">{w.order_id || "—"}</td>
      <td className="grid-cell">{w.portal_name}</td>
      <td className="grid-cell text-right"><input data-testid={`weight-cw-${w.id}`} type="number" step="0.001" value={cw} onChange={(e) => setCw(e.target.value)} className="bg-secondary border border-border px-2 py-1 w-20 text-right text-xs mono" /></td>
      <td className="grid-cell text-right"><input data-testid={`weight-ew-${w.id}`} type="number" step="0.001" value={ew} onChange={(e) => setEw(e.target.value)} className="bg-secondary border border-border px-2 py-1 w-20 text-right text-xs mono" /></td>
      <td className={`grid-cell text-right mono ${w.weight_variance > 0 ? "text-rose-600" : "text-slate-500"}`}>{w.weight_variance}</td>
      <td className={`grid-cell text-right mono font-semibold ${w.amount_variance > 0 ? "text-rose-600" : "text-slate-500"}`}>{fmtCurrency(w.amount_variance)}</td>
      <td className="grid-cell">
        <select data-testid={`weight-status-${w.id}`} value={status} onChange={(e) => setStatus(e.target.value)} className={`border px-1.5 py-0.5 rounded-sm text-[10px] mono ${STATUS_TONE[status] || ""}`}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </td>
      <td className="grid-cell text-right">
        <div className="inline-flex gap-1">
          <button data-testid={`weight-save-${w.id}`} onClick={save} className="border border-border hover:bg-secondary p-1" title="Save"><Save size={12} /></button>
          <button data-testid={`weight-raise-${w.id}`} onClick={raise} disabled={!!w.ticket_id} className="border border-border hover:bg-secondary p-1 disabled:opacity-40" title={w.ticket_no ? `Ticket ${w.ticket_no}` : "Raise ticket"}><Send size={12} /></button>
          <button data-testid={`weight-del-${w.id}`} onClick={del} className="border border-border hover:bg-rose-50 hover:text-rose-600 p-1" title="Delete"><Trash2 size={12} /></button>
        </div>
      </td>
    </tr>
  );
}

function NewWeightModal({ onClose, onCreated, marketplace }) {
  const [form, setForm] = useState({
    portal_name: marketplace !== "all" ? marketplace : "Myntra", sku: "", order_id: "", awb: "",
    charged_weight: 0, expected_weight: 0, charged_amount: 0, expected_amount: 0, notes: "",
  });
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!form.sku.trim()) { toast.error("SKU required"); return; }
    setSaving(true);
    try {
      await api.post("/weight/discrepancies", {
        ...form, order_id: form.order_id || null, awb: form.awb || null,
        charged_weight: Number(form.charged_weight), expected_weight: Number(form.expected_weight),
        charged_amount: Number(form.charged_amount), expected_amount: Number(form.expected_amount),
      });
      toast.success("Discrepancy logged"); onCreated();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSaving(false); }
  };
  const F = (k, label, type = "text") => (
    <label className="block"><div className="overline mb-1">{label}</div>
      <input data-testid={`weight-new-${k}`} type={type} step="0.001" className="input w-full" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></label>
  );
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" data-testid="new-weight-modal">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white border border-border rounded-sm w-full max-w-lg p-5 space-y-3">
        <div className="overline">Log Weight-Charge Discrepancy</div>
        <div className="grid grid-cols-2 gap-2">
          {F("sku", "SKU")}
          {F("portal_name", "Marketplace")}
          {F("order_id", "Order ID (optional)")}
          {F("awb", "AWB (optional)")}
          {F("charged_weight", "Charged weight (kg)", "number")}
          {F("expected_weight", "Expected weight (kg)", "number")}
          {F("charged_amount", "Charged amount (₹)", "number")}
          {F("expected_amount", "Expected amount (₹)", "number")}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn">Cancel</button>
          <button data-testid="btn-submit-weight" disabled={saving} onClick={submit} className="btn btn-primary">{saving ? "Saving…" : "Add"}</button>
        </div>
      </div>
    </div>
  );
}
