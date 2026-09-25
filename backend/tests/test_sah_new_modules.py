"""Backend tests for SAH new modules: seller-support, weight, returns + auth/marketplaces/masters."""
import os
import time
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback to frontend .env parse
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

API = f"{BASE_URL}/api"


@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{API}/auth/login",
                      json={"email": "admin@fundle.ai", "password": "admin123"}, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "token" in data and "user" in data
    return data["token"]


@pytest.fixture(scope="session")
def auth(token):
    return {"Authorization": f"Bearer {token}"}


# --- Auth ---
class TestAuth:
    def test_login_invalid(self):
        r = requests.post(f"{API}/auth/login",
                          json={"email": "admin@fundle.ai", "password": "wrong"}, timeout=15)
        assert r.status_code in (400, 401, 403)

    def test_me(self, auth):
        r = requests.get(f"{API}/auth/me", headers=auth, timeout=15)
        assert r.status_code == 200
        assert r.json().get("email") == "admin@fundle.ai"


# --- Marketplaces ---
class TestMarketplaces:
    def test_list(self):
        r = requests.get(f"{API}/marketplaces", timeout=15)
        assert r.status_code == 200
        data = r.json()
        items = data if isinstance(data, list) else data.get("items", data.get("marketplaces", []))
        names = [str(i.get("name", i.get("code", ""))).lower() for i in items]
        blob = " ".join(names)
        assert "myntra" in blob
        assert "amazon" in blob


# --- Masters ---
class TestMasters:
    def test_commission_rules_empty(self, auth):
        r = requests.get(f"{API}/masters/commission-rules", headers=auth, timeout=15)
        assert r.status_code == 200
        data = r.json()
        items = data if isinstance(data, list) else data.get("items", [])
        assert items == [] or len(items) == 0

    def test_tolerance(self, auth):
        r = requests.get(f"{API}/masters/tolerance", headers=auth, timeout=15)
        assert r.status_code == 200

    def test_tax_rates_get_update(self, auth):
        r = requests.get(f"{API}/masters/tax-rates", headers=auth, timeout=15)
        assert r.status_code == 200


# --- Seller Support ---
class TestSellerSupport:
    ticket_id = None

    def test_create(self, auth):
        r = requests.post(f"{API}/support/tickets", headers=auth, json={
            "subject": "TEST_ Support query", "portal_name": "Myntra",
            "category": "general", "body": "Initial body", "priority": "medium",
        }, timeout=15)
        assert r.status_code == 200, r.text
        t = r.json()
        assert t["subject"] == "TEST_ Support query"
        assert t["status"] == "open"
        assert t["ticket_no"].startswith("SAH-")
        TestSellerSupport.ticket_id = t["id"]

    def test_list_and_get(self, auth):
        r = requests.get(f"{API}/support/tickets", headers=auth, timeout=15)
        assert r.status_code == 200
        items = r.json()["items"]
        assert any(t["id"] == TestSellerSupport.ticket_id for t in items)

        r = requests.get(f"{API}/support/tickets/{TestSellerSupport.ticket_id}",
                         headers=auth, timeout=15)
        assert r.status_code == 200

    def test_agent_reply_sets_awaiting(self, auth):
        r = requests.post(
            f"{API}/support/tickets/{TestSellerSupport.ticket_id}/messages",
            headers=auth, json={"author_role": "agent", "body": "Our follow up"}, timeout=15)
        assert r.status_code == 200
        assert r.json()["status"] == "awaiting_seller"

    def test_seller_reply_sets_responded(self, auth):
        r = requests.post(
            f"{API}/support/tickets/{TestSellerSupport.ticket_id}/messages",
            headers=auth, json={"author_role": "seller", "body": "seller reply"}, timeout=15)
        assert r.status_code == 200
        assert r.json()["status"] == "responded"

    def test_mark_resolved(self, auth):
        r = requests.patch(
            f"{API}/support/tickets/{TestSellerSupport.ticket_id}",
            headers=auth, json={"status": "resolved"}, timeout=15)
        assert r.status_code == 200
        g = requests.get(f"{API}/support/tickets/{TestSellerSupport.ticket_id}",
                         headers=auth, timeout=15).json()
        assert g["status"] == "resolved"

    def test_summary(self, auth):
        r = requests.get(f"{API}/support/summary", headers=auth, timeout=15)
        assert r.status_code == 200
        s = r.json()
        assert "total" in s and "open" in s and "resolved" in s


# --- Weight Discrepancies ---
class TestWeight:
    disc_id = None

    def test_create(self, auth):
        r = requests.post(f"{API}/weight/discrepancies", headers=auth, json={
            "portal_name": "Myntra", "sku": "TEST-SKU-1",
            "charged_weight": 1.2, "expected_weight": 1.0,
            "charged_amount": 120, "expected_amount": 100,
        }, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["amount_variance"] == 20.0
        assert d["recoverable_amount"] == 20.0
        assert d["weight_variance"] == pytest.approx(0.2, rel=1e-3)
        assert d["status"] == "identified"
        TestWeight.disc_id = d["id"]

    def test_list_summary(self, auth):
        r = requests.get(f"{API}/weight/discrepancies", headers=auth, timeout=15)
        assert r.status_code == 200
        assert any(x["id"] == TestWeight.disc_id for x in r.json()["items"])
        s = requests.get(f"{API}/weight/summary", headers=auth, timeout=15).json()
        assert s["overcharged_cases"] >= 1
        assert s["total_recoverable"] >= 20.0

    def test_patch(self, auth):
        r = requests.patch(f"{API}/weight/discrepancies/{TestWeight.disc_id}",
                           headers=auth, json={"charged_amount": 150}, timeout=15)
        assert r.status_code == 200
        assert r.json()["amount_variance"] == 50.0

    def test_raise_ticket(self, auth):
        r = requests.post(f"{API}/weight/discrepancies/{TestWeight.disc_id}/raise-ticket",
                          headers=auth, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["ticket"]["category"] == "weight"
        # second raise blocked
        r2 = requests.post(f"{API}/weight/discrepancies/{TestWeight.disc_id}/raise-ticket",
                           headers=auth, timeout=15)
        assert r2.status_code == 400
        # discrepancy is now disputed
        lst = requests.get(f"{API}/weight/discrepancies", headers=auth, timeout=15).json()["items"]
        doc = next(x for x in lst if x["id"] == TestWeight.disc_id)
        assert doc["status"] == "disputed"
        assert doc["ticket_no"]


# --- Return Orders ---
class TestReturns:
    normal_id = None
    problem_id = None

    def test_create_problem_autoticket(self, auth):
        r = requests.post(f"{API}/returns", headers=auth, json={
            "portal_name": "Myntra", "sku": "TEST-RET-1",
            "return_status": "lost_in_transit", "refund_amount": 500,
        }, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["auto_ticketed"] is True
        assert d["ticket_no"] and d["ticket_no"].startswith("SAH-")
        assert d["auto_ticket"]["category"] == "return"
        TestReturns.problem_id = d["id"]

    def test_create_normal_then_patch_to_problem(self, auth):
        r = requests.post(f"{API}/returns", headers=auth, json={
            "portal_name": "Myntra", "sku": "TEST-RET-2",
            "return_status": "initiated", "refund_amount": 200,
        }, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["ticket_no"] is None
        TestReturns.normal_id = d["id"]

        r2 = requests.patch(f"{API}/returns/{TestReturns.normal_id}", headers=auth,
                            json={"return_status": "qc_failed"}, timeout=15)
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["auto_ticket"] is not None
        assert d2["ticket_no"].startswith("SAH-")

    def test_scan(self, auth):
        r = requests.post(f"{API}/returns/scan", headers=auth, timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert "created" in j and "skipped" in j

    def test_summary_and_list(self, auth):
        s = requests.get(f"{API}/returns/summary", headers=auth, timeout=15).json()
        assert s["total"] >= 2
        assert s["issues"] >= 2
        assert s["ticketed"] >= 2

        r = requests.get(f"{API}/returns", headers=auth,
                         params={"issues_only": "true"}, timeout=15)
        assert r.status_code == 200

    def test_cross_module_ticket_visible(self, auth):
        # Weight & return tickets appear in support list with correct category
        r = requests.get(f"{API}/support/tickets", headers=auth,
                         params={"category": "weight"}, timeout=15)
        assert r.status_code == 200
        assert r.json()["total"] >= 1
        r2 = requests.get(f"{API}/support/tickets", headers=auth,
                          params={"category": "return"}, timeout=15)
        assert r2.status_code == 200
        assert r2.json()["total"] >= 2
