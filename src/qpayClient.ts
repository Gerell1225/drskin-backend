import axios from "axios";
import { env } from "./env";


type TokenState = { token: string; exp: number };
let cache: TokenState | null = null;
const now = () => Math.floor(Date.now() / 1000);

async function token(): Promise<string> {
  if (cache && cache.exp > now()) return cache.token;
  const { data } = await axios.post(`${env.QPAY_BASE_URL}/v2/auth/token`, {
    username: env.QPAY_USERNAME,
    password: env.QPAY_PASSWORD
  });
  const ttl = typeof data.expires_in === "number" ? data.expires_in : 900;
  cache = { token: data.access_token, exp: now() + Math.max(60, ttl - 60) };
  return cache.token;
}

export async function qpayCreateInvoice(input: {
  amount: number;
  sender_invoice_no: string;
  invoice_description: string;
  invoice_receiver_code?: string;
  sender_branch_code?: string;       
  callback_url: string;
}) {
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
  return data as {
    invoice_id: string;
    qr_text: string;
    qr_image: string;
    qPay_shortUrl?: string;
    urls?: Array<{ name: string; description: string; logo: string; link: string }>;
  };
}

export async function qpayGetPayment(paymentId: string) {
  const t = await token();
  const { data } = await axios.get(`${env.QPAY_BASE_URL}/v2/payment/${paymentId}`, {
    headers: { Authorization: `Bearer ${t}` }
  });
  return data;
}

export async function qpayRefund(paymentId: string, note?: string, callback_url?: string) {
  const t = await token();
  const { data } = await axios.delete(`${env.QPAY_BASE_URL}/v2/payment/refund/${paymentId}`, {
    headers: { Authorization: `Bearer ${t}` },
    data: { note, callback_url }
  });
  return data;
}
