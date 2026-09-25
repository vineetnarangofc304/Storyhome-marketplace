"""Seller Support — raise queries with marketplace seller support, record replies,
and follow up on cases. General/return/weight query threads with a message log.

Collection: support_tickets
"""
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from db import db
from deps import require_admin

router = APIRouter(prefix="/support", tags=["seller-support"])

TICKET_STATUSES = ["open", "awaiting_seller", "responded", "resolved", "closed"]
CATEGORIES = ["general", "weight", "return", "settlement", "other"]
PRIORITIES = ["low", "medium", "high", "urgent"]


def _uid():
    return str(uuid.uuid4())


def _iso():
    return datetime.now(timezone.utc).isoformat()


def _clean(d):
    d = dict(d)
    d.pop("_id", None)
    return d


async def create_ticket(
    *, subject: str, portal_name: str, category: str = "general",
    order_id: Optional[str] = None, sku: Optional[str] = None,
    priority: str = "medium", body: Optional[str] = None,
    created_by: Optional[str] = None, source: str = "manual",
    linked_type: Optional[str] = None, linked_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Shared helper — used by the Weight and Returns modules to auto-open tickets."""
    now = _iso()
    ticket = {
        "id": _uid(),
        "ticket_no": "SAH-" + uuid.uuid4().hex[:8].upper(),
        "subject": subject,
        "portal_name": portal_name or "Myntra",
        "category": category if category in CATEGORIES else "general",
        "order_id": order_id,
        "sku": sku,
        "status": "open",
        "priority": priority if priority in PRIORITIES else "medium",
        "created_by": created_by,
        "assigned_to": None,
        "source": source,
        "linked_type": linked_type,
        "linked_id": linked_id,
        "messages": [],
        "created_at": now,
        "updated_at": now,
        "last_activity_at": now,
    }
    if body:
        ticket["messages"].append({
            "id": _uid(), "author_role": "agent", "author": created_by or "Ops",
            "body": body, "created_at": now,
        })
    await db.support_tickets.insert_one(dict(ticket))
    return _clean(ticket)


class TicketIn(BaseModel):
    subject: str
    portal_name: str = "Myntra"
    category: str = "general"
    order_id: Optional[str] = None
    sku: Optional[str] = None
    priority: str = "medium"
    body: Optional[str] = None


@router.post("/tickets")
async def open_ticket(payload: TicketIn):
    if not payload.subject.strip():
        raise HTTPException(400, "Subject is required")
    t = await create_ticket(
        subject=payload.subject.strip(), portal_name=payload.portal_name,
        category=payload.category, order_id=payload.order_id, sku=payload.sku,
        priority=payload.priority, body=payload.body, source="manual",
    )
    return t


@router.get("/summary")
async def support_summary(portal_name: Optional[str] = None):
    q: Dict[str, Any] = {}
    if portal_name and portal_name != "all":
        q["portal_name"] = portal_name
    agg = await db.support_tickets.aggregate([
        {"$match": q},
        {"$group": {"_id": "$status", "n": {"$sum": 1}}},
    ]).to_list(20)
    by_status = {a["_id"]: a["n"] for a in agg}
    cat = await db.support_tickets.aggregate([
        {"$match": q},
        {"$group": {"_id": "$category", "n": {"$sum": 1}}},
    ]).to_list(20)
    total = await db.support_tickets.count_documents(q)
    open_like = sum(by_status.get(s, 0) for s in ("open", "awaiting_seller", "responded"))
    return {
        "total": total,
        "open": open_like,
        "resolved": by_status.get("resolved", 0) + by_status.get("closed", 0),
        "by_status": by_status,
        "by_category": {c["_id"]: c["n"] for c in cat},
    }


@router.get("/tickets")
async def list_tickets(
    status: Optional[str] = None, category: Optional[str] = None,
    portal_name: Optional[str] = None, priority: Optional[str] = None,
    search: Optional[str] = None, limit: int = Query(200, le=1000), skip: int = 0,
):
    q: Dict[str, Any] = {}
    if status and status != "all":
        q["status"] = status
    if category and category != "all":
        q["category"] = category
    if portal_name and portal_name != "all":
        q["portal_name"] = portal_name
    if priority and priority != "all":
        q["priority"] = priority
    if search:
        q["$or"] = [
            {"subject": {"$regex": search, "$options": "i"}},
            {"ticket_no": {"$regex": search, "$options": "i"}},
            {"order_id": {"$regex": search, "$options": "i"}},
            {"sku": {"$regex": search, "$options": "i"}},
        ]
    total = await db.support_tickets.count_documents(q)
    items = await db.support_tickets.find(q, {"_id": 0}).sort(
        "last_activity_at", -1).skip(skip).limit(limit).to_list(limit)
    return {"total": total, "items": items}


@router.get("/tickets/{ticket_id}")
async def get_ticket(ticket_id: str):
    t = await db.support_tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Ticket not found")
    return t


class MessageIn(BaseModel):
    author_role: str = "agent"   # agent (us) | seller
    author: Optional[str] = None
    body: str


@router.post("/tickets/{ticket_id}/messages")
async def add_message(ticket_id: str, payload: MessageIn):
    if not payload.body.strip():
        raise HTTPException(400, "Message body required")
    t = await db.support_tickets.find_one({"id": ticket_id})
    if not t:
        raise HTTPException(404, "Ticket not found")
    role = "seller" if payload.author_role == "seller" else "agent"
    now = _iso()
    msg = {"id": _uid(), "author_role": role,
           "author": payload.author or ("Seller Support" if role == "seller" else "Ops"),
           "body": payload.body.strip(), "created_at": now}
    # replying to seller => awaiting_seller; seller replied => responded
    new_status = t.get("status")
    if t.get("status") not in ("resolved", "closed"):
        new_status = "awaiting_seller" if role == "agent" else "responded"
    await db.support_tickets.update_one(
        {"id": ticket_id},
        {"$push": {"messages": msg},
         "$set": {"status": new_status, "updated_at": now, "last_activity_at": now}},
    )
    return {"ok": True, "message": msg, "status": new_status}


class TicketPatch(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    assigned_to: Optional[str] = None


@router.patch("/tickets/{ticket_id}")
async def update_ticket(ticket_id: str, payload: TicketPatch):
    upd: Dict[str, Any] = {"updated_at": _iso()}
    if payload.status:
        if payload.status not in TICKET_STATUSES:
            raise HTTPException(400, "Invalid status")
        upd["status"] = payload.status
    if payload.priority:
        upd["priority"] = payload.priority
    if payload.assigned_to is not None:
        upd["assigned_to"] = payload.assigned_to
    r = await db.support_tickets.update_one({"id": ticket_id}, {"$set": upd})
    if not r.matched_count:
        raise HTTPException(404, "Ticket not found")
    return {"ok": True}


@router.delete("/tickets/{ticket_id}")
async def delete_ticket(ticket_id: str, _admin=Depends(require_admin)):
    r = await db.support_tickets.delete_one({"id": ticket_id})
    if not r.deleted_count:
        raise HTTPException(404, "Ticket not found")
    return {"ok": True}
