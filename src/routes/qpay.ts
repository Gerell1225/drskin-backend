import { Router } from "express";
import { qpayCreateInvoice, qpayGetPayment, qpayRefund } from "../qpayClient";
import { supabaseAdmin } from "../supabase";
import { env } from "../env";

export const qpay = Router();

// helper
const sanitize = (s: string, max = 45) => s.replace(/[^A-Za-z0-9_]/g, "").slice(0, max);

/** Single invoice for whole order (partial refunds not supported) */
qpay.post("/invoice", async (req, res) => {
  try {
    const { order_id } = req.body ?? {};
    if (!order_id) return res.status(400).json({ error: "order_id required" });

    const { data: order, error } = await supabaseAdmin
      .from("booking_orders")
      .select("id, branch_id, amount_due_mnt, status")
      .eq("id", order_id).single();

    if (error || !order) return res.status(404).json({ error: "order_not_found" });
    if (order.amount_due_mnt <= 0) return res.status(400).json({ error: "nothing_to_charge" });

    const sender_invoice_no = sanitize(order_id);
    const branchCode = `BR-${order.branch_id.slice(0, 8)}`;
    const callback_url = `${env.APP_URL}/api/qpay/callback?order_id=${order_id}`;

    const invoice = await qpayCreateInvoice({
      amount: order.amount_due_mnt,
      sender_invoice_no,
      invoice_description: "DrSkin booking",
      invoice_receiver_code: "terminal",
      sender_branch_code: branchCode,
      callback_url
    });

    await supabaseAdmin.rpc("register_payment", {
      p_order_id: order_id,
      p_provider: "qpay",
      p_kind: "charge",
      p_external_ref: invoice.invoice_id,
      p_status: "pending",
      p_amount_mnt: order.amount_due_mnt,
      p_raw: invoice as any
    });

    res.json(invoice);
  } catch (e: any) {
    console.error(e?.response?.data || e);
    res.status(500).json({ error: "qpay_invoice_failed", detail: e?.response?.data || e?.message });
  }
});

/** Recommended: per-item invoice (supports partial refunds) */
qpay.post("/invoice-item", async (req, res) => {
  try {
    const { item_id } = req.body ?? {};
    if (!item_id) return res.status(400).json({ error: "item_id required" });

    const { data: item, error } = await supabaseAdmin
      .from("booking_items")
      .select("id, order_id, price_mnt, status, booking_orders(branch_id)")
      .eq("id", item_id)
      .single();

    if (error || !item) return res.status(404).json({ error: "item_not_found" });
    if (item.status !== "active") return res.status(400).json({ error: "item_not_active" });

    const sender_invoice_no = sanitize(item_id);
    const branchCode = `BR-${(item.booking_orders as any).branch_id.slice(0, 8)}`;
    const callback_url = `${env.APP_URL}/api/qpay/callback?order_id=${item.order_id}&item_id=${item.id}`;

    const invoice = await qpayCreateInvoice({
      amount: item.price_mnt,
      sender_invoice_no,
      invoice_description: "DrSkin booking (per person)",
      invoice_receiver_code: "terminal",
      sender_branch_code: branchCode,
      callback_url
    });

    await supabaseAdmin.rpc("register_payment", {
      p_order_id: item.order_id,
      p_provider: "qpay",
      p_kind: "charge",
      p_external_ref: invoice.invoice_id,
      p_status: "pending",
      p_amount_mnt: item.price_mnt,
      p_raw: invoice as any
    });

    // attach item_id to that pending row
    await supabaseAdmin.from("payments").update({ item_id: item.id })
      .eq("order_id", item.order_id)
      .eq("provider", "qpay").eq("kind", "charge")
      .eq("external_ref", invoice.invoice_id).eq("status", "pending");

    res.json(invoice);
  } catch (e: any) {
    console.error(e?.response?.data || e);
    res.status(500).json({ error: "qpay_invoice_item_failed", detail: e?.response?.data || e?.message });
  }
});

/** QPay callback (verifies & writes paid rows; confirms order when fully paid) */
qpay.post("/callback", async (req, res) => {
  try {
    const payment_id = (req.query.payment_id as string) || (req.body?.payment_id as string);
    const order_id   = req.query.order_id as string | undefined;
    const item_id    = req.query.item_id  as string | undefined;
    if (!payment_id) return res.status(400).json({ ok: false, error: "payment_id missing" });

    const info = await qpayGetPayment(payment_id);
    const statusRaw = (info?.payment_status || info?.status || "").toString().toUpperCase();
    const isPaid = statusRaw === "PAID";
    const amount = Number(info?.payment_amount ?? 0);

    if (isPaid && order_id) {
      await supabaseAdmin.rpc("register_payment", {
        p_order_id: order_id,
        p_provider: "qpay",
        p_kind: "charge",
        p_external_ref: payment_id,
        p_status: "paid",
        p_amount_mnt: amount > 0 ? amount : undefined,
        p_raw: info as any
      });

      if (item_id) {
        await supabaseAdmin.from("payments").update({ item_id })
          .eq("order_id", order_id).eq("provider", "qpay").eq("kind", "charge")
          .eq("external_ref", payment_id).eq("status", "paid");
      }

      // confirm only when fully paid
      const { data: order } = await supabaseAdmin
        .from("booking_orders").select("amount_due_mnt").eq("id", order_id).single();

      const { data: paid } = await supabaseAdmin
        .from("payments")
        .select("amount_mnt")
        .eq("order_id", order_id)
        .eq("provider", "qpay")
        .eq("kind", "charge")
        .eq("status", "paid");

      const totalPaid = (paid ?? []).reduce((s: number, r: any) => s + (r.amount_mnt ?? 0), 0);
      if (order && totalPaid >= (order.amount_due_mnt ?? 0)) {
        await supabaseAdmin.from("booking_orders").update({ status: "confirmed" }).eq("id", order_id);
      }
    }

    res.json({ ok: true, status: statusRaw });
  } catch (e: any) {
    console.error(e?.response?.data || e);
    res.json({ ok: true, error: "callback_error" }); // 200 to stop retries
  }
});

/** Full refund by original payment id (order/item level) */
qpay.post("/refund", async (req, res) => {
  try {
    const { payment_id, note } = req.body ?? {};
    if (!payment_id) return res.status(400).json({ error: "payment_id required" });

    const data = await qpayRefund(payment_id, note, `${env.APP_URL}/api/qpay/callback`);
    res.json({ ok: true, data });
  } catch (e: any) {
    console.error(e?.response?.data || e);
    res.status(500).json({ error: "qpay_refund_failed", detail: e?.response?.data || e?.message });
  }
});
