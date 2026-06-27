type NotifyOrderItem = {
  name: string;
  quantity: number;
};

type NotifyOrderPayload = {
  to: string;
  restaurantName: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  items: NotifyOrderItem[];
  total: number;
  currencyCode: string;
  currencyLocale: string;
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

function money(value: number, payload: NotifyOrderPayload) {
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

function textNotification(payload: NotifyOrderPayload) {
  const lines = [
    `Nueva orden por WhatsApp - ${payload.restaurantName}`,
    `Orden ${payload.orderNumber}`,
    `Cliente: ${payload.customerName || "Sin nombre"} (${payload.customerPhone})`,
    "",
    ...payload.items.map((item) => `${item.quantity} x ${item.name}`),
    "",
    `Total: ${money(payload.total, payload)}`,
  ];
  return lines.filter(Boolean).join("\n");
}

function htmlNotification(payload: NotifyOrderPayload) {
  const itemRows = payload.items
    .map(
      (item) => `<tr><td>${item.quantity} x ${escapeHtml(item.name)}</td></tr>`,
    )
    .join("");

  return `
<!doctype html>
<html>
  <head><meta charset="utf-8" /></head>
  <body style="margin:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#13213b;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7fb;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #dbe2ef;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="background:#07172b;color:#ffffff;padding:24px 26px;">
                <div style="font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#a8c1ff;font-weight:700;">Nueva orden por WhatsApp</div>
                <h1 style="margin:8px 0 0;font-size:24px;">${escapeHtml(payload.restaurantName)}</h1>
                <div style="margin-top:6px;font-size:15px;color:#d8e2f5;">Orden #${escapeHtml(payload.orderNumber)}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 26px 4px;color:#63708a;font-size:13px;">
                Cliente<br><strong style="color:#13213b;font-size:16px;">${escapeHtml(payload.customerName || "Sin nombre")}</strong>
                <br>Telefono: ${escapeHtml(payload.customerPhone)}
              </td>
            </tr>
            <tr>
              <td style="padding:8px 26px 20px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  <tr><th align="left" style="padding:10px 0;border-bottom:1px solid #dbe2ef;color:#63708a;font-size:12px;text-transform:uppercase;">Pedido</th></tr>
                  ${itemRows}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 26px 24px;font-size:20px;font-weight:900;color:#159947;">
                Total: ${money(payload.total, payload)}
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

  const payload = (await request.json()) as NotifyOrderPayload;
  if (!payload.to || !payload.orderNumber || !payload.items?.length) {
    return new Response(JSON.stringify({ error: "Missing order data" }), {
      status: 400,
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
      subject: `Nueva orden por WhatsApp ${payload.orderNumber} - ${payload.restaurantName}`,
      html: htmlNotification(payload),
      text: textNotification(payload),
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
