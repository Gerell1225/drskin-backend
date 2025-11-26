import axios from "axios";
import { env } from "./env";
let cache = null;
const now = () => Math.floor(Date.now() / 1000);
async function token() {
    if (cache && cache.exp > now())
        return cache.token;
    const { data } = await axios.post(`${env.QPAY_BASE_URL}/v2/auth/token`, {
        username: env.QPAY_USERNAME,
        password: env.QPAY_PASSWORD
    });
    const ttl = typeof data.expires_in === "number" ? data.expires_in : 900;
    cache = { token: data.access_token, exp: now() + Math.max(60, ttl - 60) };
    return cache.token;
}
export async function qpayCreateInvoice(input) {
    const t = await token();
    const body = {
        invoice_code: env.QPAY_INVOICE_CODE,
        sender_invoice_no: input.sender_invoice_no,
        invoice_receiver_code: input.invoice_receiver_code ?? "terminal",
        invoice_description: input.invoice_description,
        sender_branch_code: input.sender_branch_code,
        amount: input.amount,
        callback_url: input.callback_url
    };
    const { data } = await axios.post(`${env.QPAY_BASE_URL}/v2/invoice`, body, {
        headers: { Authorization: `Bearer ${t}` }
    });
    return data;
}
export async function qpayGetPayment(paymentId) {
    const t = await token();
    const { data } = await axios.get(`${env.QPAY_BASE_URL}/v2/payment/${paymentId}`, {
        headers: { Authorization: `Bearer ${t}` }
    });
    return data;
}
export async function qpayRefund(paymentId, note, callback_url) {
    const t = await token();
    const { data } = await axios.delete(`${env.QPAY_BASE_URL}/v2/payment/refund/${paymentId}`, {
        headers: { Authorization: `Bearer ${t}` },
        data: { note, callback_url }
    });
    return data;
}