import { checkRateLimit } from "../_shared/rateLimit.ts";

type InvoiceItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
};

type InvoiceTax = {
  name: string;
  rate: number;
  amount: number;
};

type InvoicePayload = {
  to: string;
  restaurantName: string;
  rnc: string;
  address: string;
  phone: string;
  billingEmail: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  customerRnc: string;
  tableNumber: number;
  waiter: string;
  businessDate: string;
  paymentMethod: string;
  currencyCode: string;
  currencyLocale: string;
  items: InvoiceItem[];
  totals: {
    subtotal: number;
    discount: number;
    tax: number;
    total: number;
  };
  taxes: InvoiceTax[];
};

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGINS") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function validateInvoicePayload(payload: InvoicePayload): string | null {
  if (typeof payload.to !== "string" || !EMAIL_PATTERN.test(payload.to)) {
    return "El correo destinatario (to) no es valido.";
  }
  if (typeof payload.orderNumber !== "string" || payload.orderNumber.length > 50) {
    return "orderNumber invalido.";
  }
  if (!payload.totals || typeof payload.totals.total !== "number" || !Number.isFinite(payload.totals.total)) {
    return "totals invalido.";
  }
  if (!Array.isArray(payload.items) || payload.items.length > 200) {
    return "items invalido.";
  }
  for (const item of payload.items) {
    if (typeof item.name !== "string" || item.name.length === 0 || item.name.length > 200) {
      return "Un item de la factura tiene un nombre invalido.";
    }
    if (typeof item.quantity !== "number" || !Number.isFinite(item.quantity) || item.quantity <= 0) {
      return "Un item de la factura tiene una cantidad invalida.";
    }
  }
  return null;
}

function money(value: number, payload: InvoicePayload) {
  try {
    return new Intl.NumberFormat(payload.currencyLocale || "es-DO", {
      style: "currency",
      currency: (payload.currencyCode || "DOP").toUpperCase(),
      minimumFractionDigits: 2,
    }).format(Number(value) || 0);
  } catch {
    return new Intl.NumberFormat("es-DO", {
      style: "currency",
      currency: "DOP",
      minimumFractionDigits: 2,
    }).format(Number(value) || 0);
  }
}

function textInvoice(payload: InvoicePayload) {
  const lines = [
    `${payload.restaurantName}`,
    payload.rnc ? `RNC ${payload.rnc}` : "",
    payload.address ? `Direccion ${payload.address}` : "",
    payload.phone ? `Telefono ${payload.phone}` : "",
    `Factura ${payload.orderNumber}`,
    payload.customerName ? `Cliente ${payload.customerName}` : "",
    payload.customerEmail ? `Correo cliente ${payload.customerEmail}` : "",
    payload.customerRnc ? `RNC cliente ${payload.customerRnc}` : "",
    `Mesa ${payload.tableNumber}`,
    `Fecha ${payload.businessDate}`,
    "",
    ...payload.items.map((item) => `${item.quantity} x ${item.name}: ${money(item.total, payload)}`),
    "",
    `Subtotal: ${money(payload.totals.subtotal, payload)}`,
    `Descuento: ${money(payload.totals.discount, payload)}`,
    ...payload.taxes.map((tax) => `${tax.name} (${(tax.rate * 100).toFixed(2)}%): ${money(tax.amount, payload)}`),
    `Total: ${money(payload.totals.total, payload)}`,
  ];
  return lines.filter(Boolean).join("\n");
}

function htmlInvoice(payload: InvoicePayload) {
  const itemRows = payload.items
    .map(
      (item) => `
        <tr>
          <td>
            <strong>${escapeHtml(item.name)}</strong>
            <span>${item.quantity} x ${money(item.unitPrice, payload)}</span>
          </td>
          <td align="right">${money(item.total, payload)}</td>
        </tr>
      `,
    )
    .join("");

  const taxRows = payload.taxes
    .map(
      (tax) => `
        <tr>
          <td>${escapeHtml(tax.name)} <span>(${(tax.rate * 100).toFixed(2)}%)</span></td>
          <td align="right">${money(tax.amount, payload)}</td>
        </tr>
      `,
    )
    .join("");

  return `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Factura ${escapeHtml(payload.orderNumber)}</title>
  </head>
  <body style="margin:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#13213b;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7fb;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#ffffff;border:1px solid #dbe2ef;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="background:#07172b;color:#ffffff;padding:28px 30px;">
                <div style="font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#a8c1ff;font-weight:700;">Factura de venta</div>
                <h1 style="margin:8px 0 4px;font-size:28px;line-height:1.15;">${escapeHtml(payload.restaurantName)}</h1>
                <div style="font-size:15px;color:#d8e2f5;">Orden #${escapeHtml(payload.orderNumber)}</div>
                <div style="margin-top:12px;font-size:13px;color:#d8e2f5;line-height:1.5;">
                  ${payload.rnc ? `RNC: ${escapeHtml(payload.rnc)}<br>` : ""}
                  ${payload.address ? `${escapeHtml(payload.address)}<br>` : ""}
                  ${payload.phone ? `Tel: ${escapeHtml(payload.phone)}` : ""}
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 30px 8px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="padding:10px 0;color:#63708a;font-size:13px;">Cliente<br><strong style="color:#13213b;font-size:16px;">${escapeHtml(payload.customerName || "Consumidor final")}</strong>${payload.customerRnc ? `<br><span>RNC: ${escapeHtml(payload.customerRnc)}</span>` : ""}</td>
                    <td style="padding:10px 0;color:#63708a;font-size:13px;">Mesa<br><strong style="color:#13213b;font-size:16px;">${payload.tableNumber}</strong></td>
                    <td style="padding:10px 0;color:#63708a;font-size:13px;">Fecha<br><strong style="color:#13213b;font-size:16px;">${escapeHtml(payload.businessDate)}</strong></td>
                    <td style="padding:10px 0;color:#63708a;font-size:13px;">Metodo<br><strong style="color:#13213b;font-size:16px;">${escapeHtml(payload.paymentMethod)}</strong></td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 30px 20px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  <tr>
                    <th align="left" style="padding:12px 0;border-bottom:1px solid #dbe2ef;color:#63708a;font-size:12px;text-transform:uppercase;">Detalle</th>
                    <th align="right" style="padding:12px 0;border-bottom:1px solid #dbe2ef;color:#63708a;font-size:12px;text-transform:uppercase;">Total</th>
                  </tr>
                  ${itemRows}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 30px 26px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fbff;border:1px solid #dbe2ef;border-radius:12px;padding:10px 16px;">
                  <tr>
                    <td style="padding:8px 0;color:#63708a;">Subtotal</td>
                    <td align="right" style="padding:8px 0;font-weight:700;">${money(payload.totals.subtotal, payload)}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;color:#63708a;">Descuento</td>
                    <td align="right" style="padding:8px 0;font-weight:700;">-${money(payload.totals.discount, payload)}</td>
                  </tr>
                  ${taxRows}
                  <tr>
                    <td style="padding:14px 0 8px;border-top:1px solid #dbe2ef;font-size:18px;font-weight:800;">Total</td>
                    <td align="right" style="padding:14px 0 8px;border-top:1px solid #dbe2ef;font-size:22px;font-weight:900;color:#159947;">${money(payload.totals.total, payload)}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 30px;background:#f8fbff;color:#63708a;font-size:13px;">
                Gracias por su visita. Para consultas, responda a este correo${payload.billingEmail ? ` o escriba a ${escapeHtml(payload.billingEmail)}` : ""}.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") ?? "RestoPOS <onboarding@resend.dev>";

  if (!resendApiKey) {
    return new Response(JSON.stringify({ error: "RESEND_API_KEY is not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const payload = (await request.json()) as InvoicePayload;
  if (!payload.to || !payload.orderNumber || !payload.items?.length) {
    return new Response(JSON.stringify({ error: "Missing invoice data" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const validationError = validateInvoicePayload(payload);
  if (validationError) {
    return new Response(JSON.stringify({ error: validationError }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const withinLimit = await checkRateLimit(`send-invoice-email:${payload.to}`, 15);
  if (!withinLimit) {
    return new Response(JSON.stringify({ error: "Demasiadas solicitudes, intenta de nuevo en un momento." }), {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [payload.to],
      reply_to: payload.billingEmail || undefined,
      subject: `Factura ${payload.orderNumber} - ${payload.restaurantName}`,
      html: htmlInvoice(payload),
      text: textInvoice(payload),
    }),
  });

  const result = await response.json();
  if (!response.ok) {
    return new Response(JSON.stringify({ error: result.message ?? "Resend error", details: result }), {
      status: response.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, result }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
