import { useEffect, useState } from "react";
import api from "@/lib/api";
import { Store } from "lucide-react";

/**
 * Marketplace filter (Phase 5 multi-marketplace). Myntra is the active adapter;
 * other marketplaces appear disabled ("soon") until their loader is activated
 * against real sample files.
 */
export default function MarketplaceSelector({ value, onChange, testId = "marketplace-selector" }) {
  const [mkts, setMkts] = useState([]);

  useEffect(() => {
    api.get("/marketplaces").then((r) => setMkts(r.data.marketplaces || [])).catch(() => {});
  }, []);

  return (
    <div className="inline-flex items-center gap-1.5 border border-border bg-white px-2 py-1 rounded-sm">
      <Store size={12} className="text-slate-400" />
      <select
        data-testid={testId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-xs mono bg-transparent outline-none"
      >
        <option value="all">All marketplaces</option>
        {mkts.map((m) => (
          <option key={m.name} value={m.name} disabled={m.status !== "active"}>
            {m.name}{m.status !== "active" ? " (soon)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
