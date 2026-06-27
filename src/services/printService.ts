import type { BusinessSettings, Order, PaymentMethod, Product, RestaurantProfile, Totals } from "../types";

export type ReceiptPrintPayload = {
  order: Order;
  products: Product[];
  totals: Totals;
  restaurant: RestaurantProfile;
  settings: BusinessSettings;
  paymentMethod: PaymentMethod;
};

export type PrintResult =
  | { status: "sent"; channel: "system" | "bridge" }
  | { status: "fallback"; reason: string };

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function quantityLabel(quantity: number, product?: Product) {
  return product?.saleUnit === "lb" ? `${quantity.toFixed(3)} lb` : String(quantity);
}

function receiptHtml(payload: ReceiptPrintPayload) {
  const { order, products, totals, restaurant, settings, paymentMethod } = payload;
  const money = (value: number) =>
    new Intl.NumberFormat(settings.currencyLocale || "es-DO", {
      style: "currency",
      currency: settings.currencyCode || "DOP",
    }).format(value);
  const rows = order.items
    .map((item) => {
      const product = products.find((candidate) => candidate.id === item.productId);
      const price = item.unitPrice ?? product?.price ?? 0;
      return `<tr><td>${escapeHtml(quantityLabel(item.quantity, product))}</td><td>${escapeHtml(product?.name ?? item.productName ?? "Producto")}</td><td>${escapeHtml(money(price * item.quantity))}</td></tr>`;
    })
    .join("");

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Ticket ${escapeHtml(order.orderNumber ?? order.id)}</title><style>
    @page { size: 80mm auto; margin: 3mm; }
    * { box-sizing: border-box; }
    body { width: 74mm; margin: 0 auto; color: #000; background: #fff; font: 11px/1.35 ui-monospace, SFMono-Regular, Consolas, monospace; }
    h1 { margin: 0; font: 700 18px/1.2 Arial, sans-serif; text-align: center; }
    .center { text-align: center; } .muted { font-size: 10px; }
    .rule { margin: 8px 0; border-top: 1px dashed #000; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { padding: 3px 1px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
    th:first-child, td:first-child { width: 18mm; } th:last-child, td:last-child { width: 23mm; text-align: right; }
    .total-row { display: flex; justify-content: space-between; gap: 8px; margin: 3px 0; }
    .grand { margin-top: 6px; font-size: 15px; font-weight: 800; }
    @media screen { body { padding: 8px; } }
  </style></head><body>
    <h1>${escapeHtml(restaurant.name)}</h1>
    <div class="center muted">${escapeHtml(restaurant.address)}<br>${escapeHtml(restaurant.phone)}${restaurant.rnc ? `<br>RNC ${escapeHtml(restaurant.rnc)}` : ""}</div>
    <div class="rule"></div>
    <div>Orden: <strong>${escapeHtml(order.orderNumber ?? order.id)}</strong></div>
    <div>Mesa: ${escapeHtml(order.tableNumber)} · ${escapeHtml(order.businessDate)}</div>
    <div>Atendido por: ${escapeHtml(order.waiter)}</div>
    <div class="rule"></div>
    <table><thead><tr><th>Cant.</th><th>Producto</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="rule"></div>
    <div class="total-row"><span>Subtotal</span><strong>${escapeHtml(money(totals.subtotal))}</strong></div>
    ${totals.discount ? `<div class="total-row"><span>Descuento</span><strong>-${escapeHtml(money(totals.discount))}</strong></div>` : ""}
    ${totals.taxBreakdown.map((tax) => `<div class="total-row"><span>${escapeHtml(tax.name)}</span><strong>${escapeHtml(money(tax.amount))}</strong></div>`).join("")}
    <div class="total-row grand"><span>TOTAL</span><strong>${escapeHtml(money(totals.total))}</strong></div>
    <div class="total-row"><span>Metodo</span><strong>${escapeHtml(paymentMethod)}</strong></div>
    <div class="rule"></div><p class="center">Gracias por su visita</p>
  </body></html>`;
}

async function printThroughBridge(payload: ReceiptPrintPayload): Promise<PrintResult> {
  const endpoint = payload.settings.printerEndpoint.trim();
  if (!endpoint) return { status: "fallback", reason: "No hay un puente ESC/POS configurado." };
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: "html", paperWidthMm: 80, html: receiptHtml(payload) }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`El servicio respondio ${response.status}.`);
    return { status: "sent", channel: "bridge" };
  } catch (error) {
    return {
      status: "fallback",
      reason: error instanceof Error ? error.message : "No se pudo contactar la impresora.",
    };
  }
}

export function reserveReceiptPrintWindow() {
  return window.open("", "restopos-ticket", "popup,width=420,height=720");
}

function printThroughSystem(payload: ReceiptPrintPayload, reservedWindow?: Window | null): PrintResult {
  const printWindow = reservedWindow ?? reserveReceiptPrintWindow();
  if (!printWindow) return { status: "fallback", reason: "El navegador bloqueo la ventana de impresion." };
  printWindow.document.open();
  printWindow.document.write(receiptHtml(payload));
  printWindow.document.close();
  printWindow.addEventListener("afterprint", () => printWindow.close(), { once: true });
  window.setTimeout(() => {
    printWindow.focus();
    printWindow.print();
  }, 180);
  return { status: "sent", channel: "system" };
}

export async function printReceipt80mm(payload: ReceiptPrintPayload, reservedWindow?: Window | null): Promise<PrintResult> {
  return payload.settings.printerMode === "bridge" ? printThroughBridge(payload) : printThroughSystem(payload, reservedWindow);
}
