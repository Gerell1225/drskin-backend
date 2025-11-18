export declare function qpayCreateInvoice(input: {
    amount: number;
    sender_invoice_no: string;
    invoice_description: string;
    invoice_receiver_code?: string;
    sender_branch_code?: string;
    callback_url: string;
}): Promise<{
    invoice_id: string;
    qr_text: string;
    qr_image: string;
    qPay_shortUrl?: string;
    urls?: Array<{
        name: string;
        description: string;
        logo: string;
        link: string;
    }>;
}>;
export declare function qpayGetPayment(paymentId: string): Promise<any>;
export declare function qpayRefund(paymentId: string, note?: string, callback_url?: string): Promise<any>;
//# sourceMappingURL=qpayClient.d.ts.map