import express from "express";
import cors from "cors";
import helmet from "helmet";
import { env, ALLOWED } from "./env";
import { qpay } from "./routes/qpay";
import { orders } from "./routes/order";
const app = express();
app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.use(cors({
    origin(origin, cb) {
        if (!origin)
            return cb(null, true);
        if (ALLOWED.includes(origin))
            return cb(null, true);
        return cb(new Error("CORS blocked"), false);
    }
}));
app.get("/api/health", (_, res) => res.json({ ok: true, ts: Date.now() }));
app.use("/api/orders", orders);
app.use("/api/qpay", qpay);
app.listen(Number(env.PORT), () => {
    console.log(`drskin-backend listening on :${env.PORT}`);
});
//# sourceMappingURL=server.js.map