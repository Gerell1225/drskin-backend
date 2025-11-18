import { Router } from "express";
import { supabaseAdmin } from "../supabase";
export const orders = Router();
function sanitizeAscii(s, max = 45) {
    return s.replace(/[^A-Za-z0-9_]/g, "").slice(0, max);
}
orders.post("/", async (req, res) => {
    try {
        const { branch_id, service_id, date_iso, time, customer_id, people, note } = req.body ?? {};
        if (!branch_id || !service_id || !date_iso || !time || !customer_id) {
            return res.status(400).json({ error: "missing_fields" });
        }
        const { data, error } = await supabaseAdmin.rpc("create_order_with_items", {
            p_branch_id: branch_id,
            p_service_id: service_id,
            p_date: date_iso,
            p_time: time,
            p_customer_id: customer_id,
            p_people: people ?? null,
            p_note: note ?? null
        });
        if (error)
            return res.status(400).json({ error: error.message });
        return res.json({ order_id: data, sender_invoice_no: sanitizeAscii(data) });
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ error: "order_create_failed" });
    }
});
orders.post("/spend-points", async (req, res) => {
    try {
        const { order_id, points } = req.body ?? {};
        if (!order_id || !Number.isInteger(points) || points <= 0) {
            return res.status(400).json({ error: "invalid_input" });
        }
        const { error } = await supabaseAdmin.rpc("spend_points_for_order", {
            p_order_id: order_id,
            p_points: points
        });
        if (error)
            return res.status(400).json({ error: error.message });
        res.json({ ok: true });
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ error: "spend_points_failed" });
    }
});
orders.post("/cancel-items", async (req, res) => {
    try {
        const { order_id, item_ids, reason, auto_refund } = req.body ?? {};
        if (!order_id || !Array.isArray(item_ids) || item_ids.length === 0) {
            return res.status(400).json({ error: "order_id_and_item_ids_required" });
        }
        const { data: result, error } = await supabaseAdmin.rpc("cancel_order_items", {
            p_order_id: order_id, p_item_ids: item_ids
        });
        if (error)
            return res.status(400).json({ error: error.message });
        const resp = { cancelled_count: result?.cancelled_count ?? 0, refundable_mnt: result?.refundable_mnt ?? 0 };
        if (auto_refund) {
            const { data: itemPayments } = await supabaseAdmin
                .from("payments")
                .select("id, item_id, external_ref, amount_mnt, status, kind")
                .eq("order_id", order_id)
                .eq("provider", "qpay")
                .eq("kind", "charge")
                .eq("status", "paid")
                .in("item_id", item_ids);
            if (!itemPayments || itemPayments.length === 0) {
                resp.note = "No item-level payments found; partial refund not possible for order-level invoice.";
            }
            else {
                const { qpayRefund } = await import("../qpayClient");
                const refunds = [];
                for (const p of itemPayments) {
                    try {
                        const data = await qpayRefund(p.external_ref, reason ?? "Item cancelled");
                        refunds.push({ item_id: p.item_id, payment_id: p.external_ref, ok: true });
                        await supabaseAdmin.rpc("register_payment", {
                            p_order_id: order_id,
                            p_provider: "qpay",
                            p_kind: "refund",
                            p_external_ref: p.external_ref,
                            p_status: "paid",
                            p_amount_mnt: p.amount_mnt,
                            p_raw: data
                        });
                    }
                    catch (err) {
                        refunds.push({ item_id: p.item_id, payment_id: p.external_ref, ok: false, error: err?.response?.data || err?.message });
                    }
                }
                resp.refunds = refunds;
            }
        }
        res.json(resp);
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ error: "cancel_items_failed" });
    }
});
orders.post("/cancel-order", async (req, res) => {
    try {
        const { order_id, reason } = req.body ?? {};
        if (!order_id)
            return res.status(400).json({ error: "order_id required" });
        const { data: items } = await supabaseAdmin
            .from("booking_items").select("id")
            .eq("order_id", order_id).eq("status", "active");
        const allItemIds = (items ?? []).map(x => x.id);
        if (allItemIds.length) {
            const { error } = await supabaseAdmin.rpc("cancel_order_items", {
                p_order_id: order_id, p_item_ids: allItemIds
            });
            if (error)
                return res.status(400).json({ error: error.message });
        }
        const { data: charges } = await supabaseAdmin
            .from("payments")
            .select("external_ref, amount_mnt")
            .eq("order_id", order_id)
            .eq("provider", "qpay")
            .eq("kind", "charge")
            .eq("status", "paid");
        const { qpayRefund } = await import("../qpayClient");
        const refunds = [];
        for (const c of charges ?? []) {
            try {
                const data = await qpayRefund(c.external_ref, reason ?? "Order cancelled");
                refunds.push({ payment_id: c.external_ref, ok: true });
                await supabaseAdmin.rpc("register_payment", {
                    p_order_id: order_id,
                    p_provider: "qpay",
                    p_kind: "refund",
                    p_external_ref: c.external_ref,
                    p_status: "paid",
                    p_amount_mnt: c.amount_mnt,
                    p_raw: data
                });
            }
            catch (err) {
                refunds.push({ payment_id: c.external_ref, ok: false, error: err?.response?.data || err?.message });
            }
        }
        await supabaseAdmin.from("booking_orders").update({ status: "cancelled" }).eq("id", order_id);
        res.json({ ok: true, refunds });
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ error: "cancel_order_failed" });
    }
});
//# sourceMappingURL=order.js.map