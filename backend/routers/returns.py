"""Return Orders Management.

Monitor & manage return orders, auto-create seller-support tickets for return-related
issues, and track return status to resolution.

Collection: return_orders
"""
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from db import db
from deps import require_admin
from routers.seller_support import create_ticket

router = APIRouter(prefix="/returns", tags=["returns"])

RETURN_STATUSES = [
    "initiated", "in_transit", "received", "qc_pending", "qc_failed",
    "refunded", "closed", "lost_in_transit", "damaged",
]
# Statuses that warrant a seller-support ticket automatically.
PROBLEM_STATUSES = {"qc_failed", "lost_in_transit", "damaged"}


def _uid():
    return str(uuid.uuid4())


def _iso():
    return datetime.now(timezone.utc).isoformat()


async def _auto_ticket(doc: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Create a support ticket for a problematic return, link it, return the ticket."""
    label = doc.get("return_status", "issue").replace("_", " ")
    body = (
        f"Return issue detected — status '{label}' for SKU {doc.get('sku')}"
        + (f" (Order {doc.get('order_id')})" if doc.get("order_id") else "")
        + f".\nReturn type: {doc.get('return_type') or '-'} · Reason: {doc.get('reason') or '-'}"
        + f" · Refund amount: INR {doc.get('refund_amount') or 0}."
        + "\nKindly investigate and confirm resolution / reimbursement."
    )
    t = await create_ticket(
        subject=f"Return {label} — SKU {doc.get('sku')}",
        portal_name=doc.get("portal_name") or "Myntra", category="return",
        order_id=doc.get("order_id"), sku=doc.get("sku"),
        priority="urgent" if doc.get("return_status") == "lost_in_transit" else "high",
        body=body, source="auto", linked_type="return_order", linked_id=doc["id"],
    )
    await db.return_orders.update_one(
        {"id": doc["id"]},
        {"$set": {"ticket_id": t["id"], "ticket_no": t["ticket_no"],
                  "auto_ticketed": True, "updated_at": _iso()}},
    )
    return t


class ReturnIn(BaseModel):
    portal_name: str = "Myntra"
    order_id: Optional[str] = None
    sku: str
    return_type: str = "customer_return"
    reason: Optional[str] = None
    qty: float = 1.0
    return_status: str = "initiated"
    refund_amount: float = 0.0
    tracking_no: Optional[str] = None
    notes: Optional[str] = None


@router.post("")
async def create_return(payload: ReturnIn):
    if not payload.sku.strip():
        raise HTTPException(400, "SKU is required")
    if payload.return_status not in RETURN_STATUSES:
        raise HTTPException(400, "Invalid return_status")
    now = _iso()
    doc = {
        "id": _uid(), "portal_name": payload.portal_name or "Myntra",
        "order_id": payload.order_id, "sku": payload.sku.strip(),
        "return_type": payload.return_type, "reason": payload.reason,
        "qty": payload.qty, "return_status": payload.return_status,
        "refund_amount": round(payload.refund_amount, 2), "tracking_no": payload.tracking_no,
        "notes": payload.notes, "ticket_id": None, "ticket_no": None,
        "auto_ticketed": False, "created_at": now, "updated_at": now,
    }
    await db.return_orders.insert_one(dict(doc))
    doc.pop("_id", None)
    ticket = None
    if payload.return_status in PROBLEM_STATUSES:
        ticket = await _auto_ticket(doc)
        doc["ticket_id"] = ticket["id"]
        doc["ticket_no"] = ticket["ticket_no"]
        doc["auto_ticketed"] = True
    return {**doc, "auto_ticket": ticket}


@router.get("/summary")
async def returns_summary(portal_name: Optional[str] = None):
    q: Dict[str, Any] = {}
    if portal_name and portal_name != "all":
        q["portal_name"] = portal_name
    agg = await db.return_orders.aggregate([
        {"$match": q},
        {"$group": {"_id": "$return_status", "n": {"$sum": 1},
                    "refund": {"$sum": "$refund_amount"}}},
    ]).to_list(30)
    total = await db.return_orders.count_documents(q)
    by_status = {a["_id"]: {"n": a["n"], "refund": round(a.get("refund", 0), 2)} for a in agg}
    issues = sum(by_status.get(s, {}).get("n", 0) for s in PROBLEM_STATUSES)
    open_ticket_count = await db.return_orders.count_documents({**q, "ticket_id": {"$ne": None}})
    total_refund = sum(v["refund"] for v in by_status.values())
    return {
        "total": total,
        "issues": issues,
        "ticketed": open_ticket_count,
        "total_refund": round(total_refund, 2),
        "by_status": by_status,
    }


@router.get("")
async def list_returns(
    return_status: Optional[str] = None, portal_name: Optional[str] = None,
    return_type: Optional[str] = None, issues_only: bool = False,
    search: Optional[str] = None, limit: int = Query(300, le=2000), skip: int = 0,
):
    q: Dict[str, Any] = {}
    if return_status and return_status != "all":
        q["return_status"] = return_status
    if portal_name and portal_name != "all":
        q["portal_name"] = portal_name
    if return_type and return_type != "all":
        q["return_type"] = return_type
    if issues_only:
        q["return_status"] = {"$in": list(PROBLEM_STATUSES)}
    if search:
        q["$or"] = [{"sku": {"$regex": search, "$options": "i"}},
                    {"order_id": {"$regex": search, "$options": "i"}},
                    {"tracking_no": {"$regex": search, "$options": "i"}}]
    total = await db.return_orders.count_documents(q)
    items = await db.return_orders.find(q, {"_id": 0}).sort(
        "updated_at", -1).skip(skip).limit(limit).to_list(limit)
    return {"total": total, "items": items}


class ReturnPatch(BaseModel):
    return_status: Optional[str] = None
    reason: Optional[str] = None
    refund_amount: Optional[float] = None
    tracking_no: Optional[str] = None
    notes: Optional[str] = None


@router.patch("/{return_id}")
async def update_return(return_id: str, payload: ReturnPatch):
    doc = await db.return_orders.find_one({"id": return_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Return order not found")
    data = payload.model_dump(exclude_none=True)
    if data.get("return_status") and data["return_status"] not in RETURN_STATUSES:
        raise HTTPException(400, "Invalid return_status")
    doc.update(data)
    doc["updated_at"] = _iso()
    await db.return_orders.update_one({"id": return_id}, {"$set": doc})
    # Auto-open a ticket if it just moved into a problem status and none exists yet.
    ticket = None
    if data.get("return_status") in PROBLEM_STATUSES and not doc.get("ticket_id"):
        ticket = await _auto_ticket(doc)
        doc["ticket_id"] = ticket["id"]
        doc["ticket_no"] = ticket["ticket_no"]
        doc["auto_ticketed"] = True
    return {**doc, "auto_ticket": ticket}


@router.post("/{return_id}/create-ticket")
async def create_return_ticket(return_id: str):
    doc = await db.return_orders.find_one({"id": return_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Return order not found")
    if doc.get("ticket_id"):
        raise HTTPException(400, "A ticket is already linked to this return")
    t = await _auto_ticket(doc)
    return {"ok": True, "ticket": t}


@router.post("/scan")
async def scan_returns(_admin=Depends(require_admin)):
    """Derive return orders from ingested sales rows flagged as returns.
    Creates one return_order per (order, sku) not already tracked. Idempotent."""
    created = 0
    skipped = 0
    cursor = db.sales.find(
        {"$or": [{"txn_type": "Return"}, {"order_status": {"$regex": "return", "$options": "i"}}]},
        {"_id": 0, "online_order_id": 1, "sku": 1, "portal_name": 1, "order_status": 1,
         "nsv_val": 1, "report_month": 1},
    )
    async for s in cursor:
        oid = s.get("online_order_id")
        sku = s.get("sku")
        if not sku:
            continue
        exists = await db.return_orders.find_one({"order_id": oid, "sku": sku})
        if exists:
            skipped += 1
            continue
        now = _iso()
        doc = {
            "id": _uid(), "portal_name": s.get("portal_name") or "Myntra",
            "order_id": oid, "sku": sku, "return_type": "customer_return",
            "reason": s.get("order_status"), "qty": 1.0, "return_status": "initiated",
            "refund_amount": round(abs(float(s.get("nsv_val") or 0)), 2),
            "tracking_no": None, "notes": f"Auto-derived from sales ({s.get('report_month') or '-'})",
            "ticket_id": None, "ticket_no": None, "auto_ticketed": False,
            "created_at": now, "updated_at": now,
        }
        await db.return_orders.insert_one(doc)
        created += 1
    return {"created": created, "skipped": skipped}


@router.delete("/{return_id}")
async def delete_return(return_id: str, _admin=Depends(require_admin)):
    r = await db.return_orders.delete_one({"id": return_id})
    if not r.deleted_count:
        raise HTTPException(404, "Return order not found")
    return {"ok": True}
