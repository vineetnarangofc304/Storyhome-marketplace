"""Weight-Charge Discrepancy Management.

Identify & manage marketplace weight-charge discrepancies, apply SKU-wise weight
corrections, raise seller-support tickets, and track status to resolution.

Collection: weight_discrepancies
"""
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from db import db
from deps import require_admin
from routers.seller_support import create_ticket

router = APIRouter(prefix="/weight", tags=["weight-discrepancy"])

STATUSES = ["identified", "under_review", "disputed", "resolved", "rejected", "recovered"]


def _uid():
    return str(uuid.uuid4())


def _iso():
    return datetime.now(timezone.utc).isoformat()


def _round(v):
    try:
        return round(float(v or 0), 3)
    except Exception:
        return 0.0


def _derive(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Compute weight & amount variance from charged vs expected."""
    cw = _round(doc.get("charged_weight"))
    ew = _round(doc.get("expected_weight"))
    ca = round(float(doc.get("charged_amount") or 0), 2)
    ea = round(float(doc.get("expected_amount") or 0), 2)
    doc["charged_weight"] = cw
    doc["expected_weight"] = ew
    doc["charged_amount"] = ca
    doc["expected_amount"] = ea
    doc["weight_variance"] = round(cw - ew, 3)
    doc["amount_variance"] = round(ca - ea, 2)
    # overcharged (charged > expected) => recoverable from marketplace
    doc["recoverable_amount"] = round(max(ca - ea, 0), 2)
    return doc


class WeightIn(BaseModel):
    portal_name: str = "Myntra"
    order_id: Optional[str] = None
    sku: str
    awb: Optional[str] = None
    charged_weight: float = 0.0
    expected_weight: float = 0.0
    charged_amount: float = 0.0
    expected_amount: float = 0.0
    notes: Optional[str] = None


@router.post("/discrepancies")
async def create_discrepancy(payload: WeightIn):
    if not payload.sku.strip():
        raise HTTPException(400, "SKU is required")
    now = _iso()
    doc = _derive({
        "id": _uid(),
        "portal_name": payload.portal_name or "Myntra",
        "order_id": payload.order_id, "sku": payload.sku.strip(), "awb": payload.awb,
        "charged_weight": payload.charged_weight, "expected_weight": payload.expected_weight,
        "charged_amount": payload.charged_amount, "expected_amount": payload.expected_amount,
        "status": "identified", "notes": payload.notes,
        "ticket_id": None, "ticket_no": None,
        "created_at": now, "updated_at": now,
    })
    await db.weight_discrepancies.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@router.get("/summary")
async def weight_summary(portal_name: Optional[str] = None):
    q: Dict[str, Any] = {}
    if portal_name and portal_name != "all":
        q["portal_name"] = portal_name
    agg = await db.weight_discrepancies.aggregate([
        {"$match": q},
        {"$group": {"_id": "$status", "n": {"$sum": 1},
                    "recoverable": {"$sum": "$recoverable_amount"}}},
    ]).to_list(20)
    total = await db.weight_discrepancies.count_documents(q)
    tot = await db.weight_discrepancies.aggregate([
        {"$match": q},
        {"$group": {"_id": None, "recoverable": {"$sum": "$recoverable_amount"},
                    "overcharged": {"$sum": {"$cond": [{"$gt": ["$amount_variance", 0]}, 1, 0]}}}},
    ]).to_list(1)
    t = tot[0] if tot else {}
    return {
        "total": total,
        "total_recoverable": round(t.get("recoverable", 0) or 0, 2),
        "overcharged_cases": t.get("overcharged", 0),
        "open": sum(a["n"] for a in agg if a["_id"] in ("identified", "under_review", "disputed")),
        "by_status": {a["_id"]: {"n": a["n"], "recoverable": round(a.get("recoverable", 0), 2)} for a in agg},
    }


@router.get("/discrepancies")
async def list_discrepancies(
    status: Optional[str] = None, portal_name: Optional[str] = None,
    search: Optional[str] = None, limit: int = Query(300, le=2000), skip: int = 0,
    sort_by: str = "amount_variance", sort_dir: str = "desc",
):
    q: Dict[str, Any] = {}
    if status and status != "all":
        q["status"] = status
    if portal_name and portal_name != "all":
        q["portal_name"] = portal_name
    if search:
        q["$or"] = [{"sku": {"$regex": search, "$options": "i"}},
                    {"order_id": {"$regex": search, "$options": "i"}},
                    {"awb": {"$regex": search, "$options": "i"}}]
    total = await db.weight_discrepancies.count_documents(q)
    items = await db.weight_discrepancies.find(q, {"_id": 0}).sort(
        sort_by, -1 if sort_dir == "desc" else 1).skip(skip).limit(limit).to_list(limit)
    return {"total": total, "items": items}


class WeightPatch(BaseModel):
    charged_weight: Optional[float] = None
    expected_weight: Optional[float] = None
    charged_amount: Optional[float] = None
    expected_amount: Optional[float] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    awb: Optional[str] = None


@router.patch("/discrepancies/{disc_id}")
async def update_discrepancy(disc_id: str, payload: WeightPatch):
    doc = await db.weight_discrepancies.find_one({"id": disc_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Discrepancy not found")
    data = payload.model_dump(exclude_none=True)
    if data.get("status") and data["status"] not in STATUSES:
        raise HTTPException(400, "Invalid status")
    doc.update(data)
    doc = _derive(doc)
    doc["updated_at"] = _iso()
    await db.weight_discrepancies.update_one({"id": disc_id}, {"$set": doc})
    return doc


@router.post("/discrepancies/{disc_id}/raise-ticket")
async def raise_ticket(disc_id: str):
    doc = await db.weight_discrepancies.find_one({"id": disc_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Discrepancy not found")
    if doc.get("ticket_id"):
        raise HTTPException(400, "A ticket is already linked to this discrepancy")
    body = (
        f"We have identified a weight-charge discrepancy for SKU {doc.get('sku')}"
        + (f" (Order {doc.get('order_id')})" if doc.get("order_id") else "")
        + f".\nCharged weight: {doc.get('charged_weight')} kg vs expected {doc.get('expected_weight')} kg."
        + f"\nCharged amount: INR {doc.get('charged_amount')} vs expected INR {doc.get('expected_amount')}"
        + f" (variance INR {doc.get('amount_variance')}).\nKindly review and correct the weight-based charge."
    )
    t = await create_ticket(
        subject=f"Weight-charge discrepancy — SKU {doc.get('sku')}",
        portal_name=doc.get("portal_name") or "Myntra", category="weight",
        order_id=doc.get("order_id"), sku=doc.get("sku"), priority="high",
        body=body, source="auto", linked_type="weight_discrepancy", linked_id=disc_id,
    )
    await db.weight_discrepancies.update_one(
        {"id": disc_id},
        {"$set": {"ticket_id": t["id"], "ticket_no": t["ticket_no"],
                  "status": "disputed", "updated_at": _iso()}},
    )
    return {"ok": True, "ticket": t}


@router.delete("/discrepancies/{disc_id}")
async def delete_discrepancy(disc_id: str, _admin=Depends(require_admin)):
    r = await db.weight_discrepancies.delete_one({"id": disc_id})
    if not r.deleted_count:
        raise HTTPException(404, "Discrepancy not found")
    return {"ok": True}
