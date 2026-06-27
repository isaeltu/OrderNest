import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  categories as initialCategories,
  coupons,
  logs,
  orders as initialOrders,
  products,
  tables as initialTables,
  users,
} from "./data";
import type {
  BotSettings,
  BusinessExpense,
  BusinessSettings,
  Category,
  Coupon,
  Customer,
  DiscountType,
  EmployeePayment,
  ExpenseType,
  InventoryItem,
  Order,
  OrderItem,
  OrderStatus,
  PaymentMethod,
  PayrollPaymentMethod,
  Product,
  ReportFilters,
  ReportSummary,
  Reservation,
  ReservationInput,
  ReservationStatus,
  RestaurantProfile,
  RestaurantTable,
  Role,
  StaffMember,
  TableShape,
  TableStatus,
  TaxRule,
  Totals,
  User,
  VoiceBotSettings,
} from "./types";
import { isSupabaseConfigured } from "./lib/supabase";
import { sendInvoiceEmail as sendInvoiceEmailViaResend, type InvoiceEmailPayload } from "./services/emailRepository";
import {
  calculateTotals,
  createDefaultReportFilters,
  defaultTaxRules,
  filterOrders,
  summarizeOrders,
  toDateInputValue,
} from "./services/reporting";
import { fetchSupabaseReport, fetchSupabaseReportFilters } from "./services/supabaseReports";
import { printReceipt80mm, reserveReceiptPrintWindow } from "./services/printService";
import {
  createEmployeePayment,
  createExpense,
  createRestaurant,
  deleteEmployeePayment,
  deleteExpense,
  fetchAdminSnapshot,
  fetchBusinessSettings,
  fetchCurrentRestaurant,
  fetchEmployeePayments,
  fetchExpenses,
  fetchInventory,
  fetchRestaurants,
  fetchStaffMembers,
  regenerateVoiceApiKey,
  saveBotSettings,
  saveBusinessSettings,
  saveCurrentRestaurant,
  saveInventoryItem,
  saveVoiceSettings,
  updateRestaurantLogo,
  updateStaffRole,
  uploadRestaurantLogo,
  type EmployeePaymentInput,
  type ExpenseInput,
  type InventoryInput,
  type RestaurantInput,
} from "./services/adminRepository";
import {
  cancelOrder as cancelRemoteOrder,
  changeReservationTable,
  createCategory as createRemoteCategory,
  createCoupon as createRemoteCoupon,
  createOrder,
  createProduct as createRemoteProduct,
  createReservation,
  createTable as createRemoteTable,
  deleteCategory as deleteRemoteCategory,
  deleteCoupon as deleteRemoteCoupon,
  deleteProduct as deleteRemoteProduct,
  deleteTable as deleteRemoteTable,
  fetchPosData,
  fetchCustomers,
  fetchCurrentUserProfile,
  fetchReservations,
  fetchStoredSessionUser,
  processPayment,
  replaceOrderItems,
  requestPasswordReset,
  signInWithPassword,
  signOut as signOutFromSupabase,
  subscribeToKitchenChanges,
  updateCategory as updateRemoteCategory,
  updateCoupon as updateRemoteCoupon,
  updateMyProfile,
  updateOrderStatus as updateRemoteOrderStatus,
  updateProduct as updateRemoteProduct,
  updateReservationStatus,
  updateTable as updateRemoteTable,
  updateTableLayout as updateRemoteTableLayout,
  uploadProductImage,
  upsertCustomer,
  assignOrderCustomer,
  type CategoryInput,
  type CouponInput,
  type CustomerInput,
  type ProductInput,
  type TableInput,
  type TableLayoutInput,
} from "./services/posRepository";

type Page =
  | "dashboard"
  | "tables"
  | "pos"
  | "kitchen"
  | "cashier"
  | "history"
  | "customers"
  | "restaurants"
  | "inventory"
  | "finance"
  | "categories"
  | "products"
  | "coupons"
  | "reports"
  | "logs"
  | "settings"
  | "reservation"
  | "notifications"
  | "profile";

const defaultBusinessSettings: BusinessSettings = {
  billingEmail: "",
  invoiceSenderName: "RestoPOS",
  currencyCode: "DOP",
  currencyLocale: "es-DO",
  taxes: defaultTaxRules,
  printerMode: "system",
  printerEndpoint: "",
};

const defaultBotSettings: BotSettings = {
  isEnabled: false,
  whatsappPhoneNumberId: "",
  notificationEmail: "",
  extraPrompt: "",
};

const defaultVoiceSettings: VoiceBotSettings = {
  isEnabled: false,
  apiKey: "",
  notificationEmail: "",
  extraPrompt: "",
};

const defaultRestaurantProfile: RestaurantProfile = {
  id: "local-restaurant",
  name: "Restaurante Demo",
  rnc: "101-00000-1",
  phone: "809-000-0000",
  email: "admin@restaurante.com",
  address: "Santo Domingo, Republica Dominicana",
  logoUrl: "",
  active: true,
};

let activeBusinessSettings = defaultBusinessSettings;

function formatCurrency(value: number, settings = activeBusinessSettings) {
  try {
    return new Intl.NumberFormat(settings.currencyLocale || "es-DO", {
      style: "currency",
      currency: (settings.currencyCode || "DOP").toUpperCase(),
      minimumFractionDigits: 2,
    }).format(value);
  } catch {
    return new Intl.NumberFormat("es-DO", {
      style: "currency",
      currency: "DOP",
      minimumFractionDigits: 2,
    }).format(value);
  }
}

const currency = {
  format: formatCurrency,
};

function normalizeTaxes(taxes?: TaxRule[]) {
  const normalized = (taxes?.length ? taxes : defaultTaxRules).map((tax) => ({
    ...tax,
    id: tax.id || `tax-${Date.now()}`,
    name: tax.name || "Impuesto",
    rate: Number(tax.rate) || 0,
    active: tax.active,
  }));
  return normalized.length ? normalized : defaultTaxRules;
}

type PdfLine = {
  text: string;
  size?: number;
  gap?: number;
};

type PdfCommand = string;

type PdfRasterImage = {
  bytes: Uint8Array;
  width: number;
  height: number;
};

function normalizePdfText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/[()\\]/g, "\\$&");
}

function wrapPdfText(value: string, maxLength = 90) {
  const words = value.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLength && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function concatPdfBytes(parts: Uint8Array[]) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function downloadPdfContent(filename: string, content: string, image?: PdfRasterImage | null) {
  const encoder = new TextEncoder();
  const objects: Array<string | { header: string; bytes: Uint8Array }> = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >>${image ? " /XObject << /Im1 6 0 R >>" : ""} >> /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  if (image) {
    objects.push({
      header: `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>`,
      bytes: image.bytes,
    });
  }

  const chunks: Uint8Array[] = [encoder.encode("%PDF-1.4\n")];
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    if (typeof object === "string") {
      chunks.push(encoder.encode(`${index + 1} 0 obj\n${object}\nendobj\n`));
    } else {
      chunks.push(encoder.encode(`${index + 1} 0 obj\n${object.header}\nstream\n`));
      chunks.push(object.bytes);
      chunks.push(encoder.encode("\nendstream\nendobj\n"));
    }
  });
  const xrefOffset = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const xref = [
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`,
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`,
  ].join("");
  chunks.push(encoder.encode(xref));

  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([concatPdfBytes(chunks)], { type: "application/pdf" }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function loadPdfLogo(logoUrl: string): Promise<PdfRasterImage | null> {
  if (!logoUrl.trim()) return null;
  try {
    const response = await fetch(logoUrl);
    if (!response.ok) return null;
    const bitmap = await createImageBitmap(await response.blob());
    const width = 360;
    const height = 160;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    const scale = Math.min(width / bitmap.width, height / bitmap.height);
    const drawWidth = bitmap.width * scale;
    const drawHeight = bitmap.height * scale;
    context.drawImage(bitmap, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    bitmap.close();
    const jpegBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!jpegBlob) return null;
    return { bytes: new Uint8Array(await jpegBlob.arrayBuffer()), width, height };
  } catch {
    return null;
  }
}

function downloadTextPdf(filename: string, title: string, lines: PdfLine[]) {
  const expandedLines: PdfLine[] = [{ text: title, size: 18, gap: 18 }, ...lines].flatMap((line) =>
    wrapPdfText(line.text).map((text, index) => ({
      text,
      size: line.size,
      gap: index === 0 ? line.gap : 0,
    })),
  );
  let y = 790;
  const content = expandedLines
    .map((line) => {
      y -= line.gap ?? 14;
      const size = line.size ?? 10;
      const command = line.text
        ? `BT /F1 ${size} Tf 50 ${y} Td (${normalizePdfText(line.text)}) Tj ET`
        : "";
      y -= size + 4;
      return command;
    })
    .filter(Boolean)
    .join("\n");

  downloadPdfContent(filename, content);
}

function pdfText(
  text: string,
  x: number,
  y: number,
  size = 10,
  color: [number, number, number] = [0.08, 0.13, 0.22],
  align: "left" | "right" = "left",
): PdfCommand {
  const normalized = normalizePdfText(text);
  const estimatedWidth = normalized.length * size * 0.52;
  const textX = align === "right" ? x - estimatedWidth : x;
  return `BT /F1 ${size} Tf ${color.join(" ")} rg ${textX.toFixed(2)} ${y.toFixed(2)} Td (${normalized}) Tj ET`;
}

function pdfRect(x: number, y: number, width: number, height: number, color: [number, number, number]) {
  return `${color.join(" ")} rg ${x} ${y} ${width} ${height} re f`;
}

function pdfLine(x1: number, y1: number, x2: number, y2: number, color: [number, number, number] = [0.86, 0.89, 0.94]) {
  return `${color.join(" ")} RG 1 w ${x1} ${y1} m ${x2} ${y2} l S`;
}

async function downloadInvoicePdf({
  filename,
  order,
  products,
  settings,
  restaurant,
  totals,
  statusLabel,
}: {
  filename: string;
  order: Order;
  products: Product[];
  settings: BusinessSettings;
  restaurant: RestaurantProfile;
  totals: Totals;
  statusLabel: string;
}) {
  const logo = await loadPdfLogo(restaurant.logoUrl);
  const displayNumber = orderDisplayNumber(order);
  const commands: PdfCommand[] = [];
  const blue: [number, number, number] = [0.23, 0.55, 0.72];
  const dark: [number, number, number] = [0.08, 0.13, 0.22];
  const muted: [number, number, number] = [0.42, 0.49, 0.6];
  const soft: [number, number, number] = [0.95, 0.98, 1];

  commands.push(pdfRect(0, 760, 612, 32, blue));
  if (logo) commands.push("q 112 0 0 50 50 700 cm /Im1 Do Q");
  commands.push(pdfText(restaurant.name || settings.invoiceSenderName || "RestoPOS", logo ? 178 : 50, 722, 20, dark));
  commands.push(pdfText("FACTURA", 562, 724, 22, blue, "right"));
  commands.push(pdfText(`Invoice ID: #${displayNumber}`, 562, 704, 10, muted, "right"));
  commands.push(pdfLine(50, 686, 562, 686));

  const businessLines = [
    restaurant.rnc ? `RNC: ${restaurant.rnc}` : "",
    restaurant.address ? `Direccion: ${restaurant.address}` : "",
    restaurant.phone ? `Telefono: ${restaurant.phone}` : "",
    restaurant.email ? `Correo: ${restaurant.email}` : "",
  ].filter(Boolean);
  commands.push(pdfText("Datos del negocio", 50, 664, 11, blue));
  businessLines.forEach((line, index) => commands.push(pdfText(line, 50, 646 - index * 15, 9, muted)));

  commands.push(pdfRect(382, 596, 180, 76, soft));
  commands.push(pdfText("Factura", 398, 652, 11, blue));
  commands.push(pdfText(`Orden: #${displayNumber}`, 398, 634, 9, dark));
  commands.push(pdfText(`Fecha: ${order.businessDate}`, 398, 619, 9, muted));
  commands.push(pdfText(`Estado: ${statusLabel}`, 398, 604, 9, muted));

  commands.push(pdfRect(50, 496, 512, 88, soft));
  commands.push(pdfText("Cliente", 66, 564, 11, blue));
  commands.push(pdfText("Nombre:", 66, 542, 9, blue));
  commands.push(pdfText((order.customerName || "Consumidor final").slice(0, 34), 120, 542, 9, dark));
  commands.push(pdfText("Correo:", 66, 523, 9, blue));
  commands.push(pdfText((order.customerEmail || "No registrado").slice(0, 38), 120, 523, 9, dark));
  commands.push(pdfText("Mesa:", 66, 504, 9, blue));
  commands.push(pdfText(String(order.tableNumber), 120, 504, 9, dark));
  commands.push(pdfText("Mesero:", 330, 542, 9, blue));
  commands.push(pdfText(order.waiter.slice(0, 30), 382, 542, 9, dark));
  commands.push(pdfText("RNC:", 330, 523, 9, blue));
  commands.push(pdfText(order.customerRnc || "No registrado", 382, 523, 9, dark));

  let y = 460;
  commands.push(pdfRect(50, y, 512, 24, blue));
  commands.push(pdfText("#", 64, y + 8, 9, [1, 1, 1]));
  commands.push(pdfText("Descripcion", 92, y + 8, 9, [1, 1, 1]));
  commands.push(pdfText("Cant.", 365, y + 8, 9, [1, 1, 1]));
  commands.push(pdfText("Precio", 450, y + 8, 9, [1, 1, 1], "right"));
  commands.push(pdfText("Importe", 548, y + 8, 9, [1, 1, 1], "right"));

  y -= 24;
  const visibleItems = order.items.slice(0, 12);
  visibleItems.forEach((item, index) => {
    const product = products.find((catalogProduct) => catalogProduct.id === item.productId);
    const name = product?.name ?? item.productName ?? "Producto";
    const unitPrice = item.unitPrice ?? product?.price ?? 0;
    const lineTotal = unitPrice * item.quantity;
    if (index % 2 === 0) commands.push(pdfRect(50, y - 4, 512, 22, [0.98, 0.99, 1]));
    commands.push(pdfText(String(index + 1), 64, y + 4, 9, muted));
    commands.push(pdfText(name.slice(0, 42), 92, y + 4, 9, dark));
    commands.push(pdfText(String(item.quantity), 380, y + 4, 9, dark, "right"));
    commands.push(pdfText(currency.format(unitPrice, settings), 450, y + 4, 9, dark, "right"));
    commands.push(pdfText(currency.format(lineTotal, settings), 548, y + 4, 9, dark, "right"));
    y -= 24;
  });
  if (order.items.length > visibleItems.length) {
    commands.push(pdfText(`+ ${order.items.length - visibleItems.length} productos adicionales`, 92, y + 4, 9, muted));
    y -= 24;
  }

  commands.push(pdfLine(50, y + 10, 562, y + 10));
  commands.push(pdfText("Notas", 50, y - 18, 10, blue));
  commands.push(pdfText("Gracias por su compra. Conserve esta factura para cualquier reclamacion.", 50, y - 34, 9, muted));

  const totalsX = 562;
  let totalY = y - 18;
  commands.push(pdfText("Subtotal", 390, totalY, 9, muted));
  commands.push(pdfText(currency.format(totals.subtotal, settings), totalsX, totalY, 9, dark, "right"));
  totalY -= 16;
  commands.push(pdfText("Descuento", 390, totalY, 9, muted));
  commands.push(pdfText(`-${currency.format(totals.discount, settings)}`, totalsX, totalY, 9, dark, "right"));
  totals.taxBreakdown.forEach((tax) => {
    totalY -= 16;
    commands.push(pdfText(`${tax.name} (${(tax.rate * 100).toFixed(2)}%)`, 390, totalY, 9, muted));
    commands.push(pdfText(currency.format(tax.amount, settings), totalsX, totalY, 9, dark, "right"));
  });
  totalY -= 10;
  commands.push(pdfLine(390, totalY, 562, totalY));
  totalY -= 22;
  commands.push(pdfText("Total", 390, totalY, 13, dark));
  commands.push(pdfText(currency.format(totals.total, settings), totalsX, totalY, 16, blue, "right"));

  commands.push(pdfLine(50, 74, 562, 74));
  commands.push(pdfText("Gracias por su compra", 50, 52, 11, blue));
  commands.push(pdfText(settings.billingEmail ? `Facturacion: ${settings.billingEmail}` : "Factura generada por RestoPOS", 562, 52, 9, muted, "right"));

  downloadPdfContent(filename, commands.join("\n"), logo);
}

function isDateInRange(date: string, startDate: string, endDate: string) {
  return (!startDate || date >= startDate) && (!endDate || date <= endDate);
}

function financialTotals(
  expenses: BusinessExpense[],
  employeePayments: EmployeePayment[],
  startDate: string,
  endDate: string,
) {
  const expensesTotal = expenses
    .filter((expense) => expense.type !== "payroll" && isDateInRange(expense.expenseDate, startDate, endDate))
    .reduce((sum, expense) => sum + expense.amount, 0);
  const payrollFromExpenses = expenses
    .filter((expense) => expense.type === "payroll" && isDateInRange(expense.expenseDate, startDate, endDate))
    .reduce((sum, expense) => sum + expense.amount, 0);
  const payrollFromEmployees = employeePayments
    .filter((payment) => isDateInRange(payment.paymentDate, startDate, endDate))
    .reduce((sum, payment) => sum + payment.amount, 0);

  return {
    expensesTotal,
    payrollTotal: payrollFromExpenses + payrollFromEmployees,
  };
}

function withConfiguredTaxBreakdown(totals: Totals, taxes: TaxRule[]): Totals {
  const alreadyDetailed = totals.taxBreakdown.some((tax) => tax.rate > 0 && tax.name !== "Impuestos");
  if (alreadyDetailed) return totals;

  const activeTaxes = taxes.filter((tax) => tax.active && tax.rate > 0);
  if (!activeTaxes.length) {
    return {
      ...totals,
      taxBreakdown: totals.tax ? [{ name: "Impuestos", rate: 0, amount: totals.tax }] : [],
    };
  }

  const totalRate = activeTaxes.reduce((sum, tax) => sum + tax.rate, 0);
  const taxable = Math.max(0, totals.subtotal - totals.discount);
  return {
    ...totals,
    taxBreakdown: activeTaxes.map((tax) => ({
      name: tax.name,
      rate: tax.rate,
      amount: totals.tax > 0 && totalRate > 0 ? totals.tax * (tax.rate / totalRate) : taxable * tax.rate,
    })),
  };
}

function orderDisplayNumber(order: Order) {
  return order.orderNumber ?? order.id;
}

function orderTableLabel(order: Order) {
  if (order.tableId) return `Mesa ${order.tableNumber}`;
  if (order.channel === "voice") return "Pedido por llamada";
  if (order.channel === "whatsapp") return "Pedido por WhatsApp";
  return "Sin mesa";
}

function buildInvoiceEmailPayload({
  to,
  order,
  products,
  settings,
  restaurant,
  totals,
}: {
  to: string;
  order: Order;
  products: Product[];
  settings: BusinessSettings;
  restaurant: RestaurantProfile;
  totals: Totals;
}): InvoiceEmailPayload {
  return {
    to,
    restaurantName: restaurant.name || settings.invoiceSenderName || "RestoPOS",
    rnc: restaurant.rnc,
    address: restaurant.address,
    phone: restaurant.phone,
    billingEmail: settings.billingEmail || restaurant.email,
    orderNumber: orderDisplayNumber(order),
    customerName: order.customerName ?? "Consumidor final",
    customerEmail: order.customerEmail ?? "",
    customerRnc: order.customerRnc ?? "",
    tableNumber: order.tableNumber,
    waiter: order.waiter,
    businessDate: order.businessDate,
    paymentMethod: order.paymentMethod ? paymentMethodLabels[order.paymentMethod] : "Pendiente",
    currencyCode: settings.currencyCode,
    currencyLocale: settings.currencyLocale,
    items: order.items.map((item) => {
      const product = products.find((catalogProduct) => catalogProduct.id === item.productId);
      const unitPrice = item.unitPrice ?? product?.price ?? 0;
      return {
        name: product?.name ?? item.productName ?? "Producto",
        quantity: item.quantity,
        unitPrice,
        total: unitPrice * item.quantity,
      };
    }),
    totals: {
      subtotal: totals.subtotal,
      discount: totals.discount,
      tax: totals.tax,
      total: totals.total,
    },
    taxes: totals.taxBreakdown,
  };
}

const SUPER_ADMIN_EMAIL = "isaelcapellanlite@gmail.com";

function isSuperAdminUser(user: Pick<User, "email">) {
  return user.email.trim().toLowerCase() === SUPER_ADMIN_EMAIL;
}

const roleHome: Record<Role, Page> = {
  admin: "dashboard",
  waiter: "tables",
  kitchen: "kitchen",
  cashier: "cashier",
};

const navByRole: Record<Role, { page: Page; label: string; icon: string }[]> = {
  admin: [
    { page: "dashboard", label: "Resumen", icon: "home" },
    { page: "tables", label: "Mesas", icon: "▦" },
    { page: "pos", label: "POS", icon: "▣" },
    { page: "kitchen", label: "Cocina", icon: "◫" },
    { page: "cashier", label: "Pagos", icon: "payments" },
    { page: "customers", label: "Clientes", icon: "@" },
    { page: "history", label: "Ordenes", icon: "orders" },
    { page: "reservation", label: "Reservacion", icon: "reservation" },
    { page: "restaurants", label: "Restaurantes", icon: "R" },
    { page: "inventory", label: "Inventario", icon: "#" },
    { page: "finance", label: "Finanzas", icon: "+" },
    { page: "categories", label: "Categorias", icon: "◇" },
    { page: "products", label: "Productos", icon: "◉" },
    { page: "coupons", label: "Cupones", icon: "%" },
    { page: "reports", label: "Reportes", icon: "▤" },
    { page: "logs", label: "Actividad", icon: "activity" },
    { page: "settings", label: "Configuracion", icon: "settings" },
  ],
  waiter: [
    { page: "tables", label: "Mesas", icon: "▦" },
    { page: "pos", label: "POS", icon: "▣" },
    { page: "kitchen", label: "Cocina", icon: "◫" },
    { page: "reservation", label: "Reservacion", icon: "reservation" },
  ],
  kitchen: [{ page: "kitchen", label: "Cocina", icon: "◫" }],
  cashier: [
    { page: "cashier", label: "Caja", icon: "$" },
    { page: "customers", label: "Clientes", icon: "@" },
    { page: "history", label: "Historial", icon: "≡" },
    { page: "reports", label: "Ventas", icon: "▤" },
  ],
};

const adminNavGroups: Array<{ label: string; pages: Page[] }> = [
  { label: "Operaciones", pages: ["dashboard", "history", "tables", "kitchen", "pos", "cashier", "reservation"] },
  { label: "Ventas", pages: ["customers", "reports", "coupons"] },
  { label: "Inventario", pages: ["products", "categories", "inventory"] },
  { label: "Administracion", pages: ["restaurants", "finance", "logs", "settings"] },
];

function navItemFor(page: Page, role: Role) {
  return navByRole[role].find((item) => item.page === page);
}

const tableLabels: Record<TableStatus, string> = {
  available: "Disponible",
  occupied: "Ocupada",
  kitchen: "En cocina",
  ready: "Lista",
  payment: "Pendiente de pago",
  reserved: "Reservada",
  out: "Fuera de servicio",
};

const orderLabels: Record<OrderStatus, string> = {
  draft: "Borrador",
  new: "Nuevo",
  preparing: "En preparacion",
  ready: "Listo",
  delivered: "Entregado",
  paid: "Pagado",
  cancelled: "Cancelada",
};

const paymentMethodLabels: Record<PaymentMethod, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  transfer: "Transferencia",
  mixed: "Mixto",
};

const payrollPaymentMethodLabels: Record<PayrollPaymentMethod, string> = {
  ...paymentMethodLabels,
  bank: "Banco",
};

const expenseTypeLabels: Record<ExpenseType, string> = {
  operating: "Operativo",
  payroll: "Nomina",
  inventory: "Inventario",
  tax: "Impuestos",
  other: "Otros",
};

const emptyReportSummary: ReportSummary = {
  subtotal: 0,
  discount: 0,
  tax: 0,
  total: 0,
  expensesTotal: 0,
  payrollTotal: 0,
  netProfit: 0,
  orderCount: 0,
  averageTicket: 0,
  byPaymentMethod: {
    cash: 0,
    card: 0,
    transfer: 0,
    mixed: 0,
  },
  byDay: [],
  topProducts: [],
};

function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [page, setPage] = useState<Page>("tables");
  const [tables, setTables] = useState<RestaurantTable[]>(initialTables);
  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const [categories, setCategories] = useState<Category[]>(initialCategories);
  const [catalogProducts, setCatalogProducts] = useState<Product[]>(products);
  const [availableCoupons, setAvailableCoupons] = useState<Coupon[]>(coupons);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);
  const [selectedTableId, setSelectedTableId] = useState("table-5");
  const [selectedCategoryId, setSelectedCategoryId] = useState(initialCategories[0].id);
  const [cart, setCart] = useState<OrderItem[]>(initialOrders[0].items);
  const [couponCode, setCouponCode] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<Coupon | undefined>();
  const [isRestoringSession, setIsRestoringSession] = useState(isSupabaseConfigured);
  const [dataError, setDataError] = useState("");
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [expenses, setExpenses] = useState<BusinessExpense[]>([]);
  const [employeePayments, setEmployeePayments] = useState<EmployeePayment[]>([]);
  const [businessSettings, setBusinessSettings] = useState<BusinessSettings>(defaultBusinessSettings);
  const [botSettings, setBotSettings] = useState<BotSettings>(defaultBotSettings);
  const [voiceSettings, setVoiceSettings] = useState<VoiceBotSettings>(defaultVoiceSettings);
  const [restaurantProfile, setRestaurantProfile] = useState<RestaurantProfile>(defaultRestaurantProfile);
  const [registeredRestaurants, setRegisteredRestaurants] = useState<RestaurantProfile[]>([]);
  const loadedAdminSections = useRef(new Set<string>());
  const lastOperationalWriteRefresh = useRef(0);
  const lastInventoryWriteRefresh = useRef(0);
  const [isLoadingAdminData, setIsLoadingAdminData] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  activeBusinessSettings = businessSettings;

  const user = currentUser ?? users[1];
  const selectedTable = tables.find((table) => table.id === selectedTableId) ?? tables[0] ?? null;
  const lowStockItems = inventory.filter((item) => item.stockQuantity <= item.reorderLevel);
  const totals = useMemo(
    () => calculateTotals(cart, appliedCoupon, catalogProducts, businessSettings.taxes),
    [appliedCoupon, businessSettings.taxes, cart, catalogProducts],
  );

  async function refreshCustomersData() {
    if (!isSupabaseConfigured || !currentUser) return;
    try {
      setCustomers(await fetchCustomers(true));
    } catch (error) {
      loadedAdminSections.current.delete("customers");
      setDataError(error instanceof Error ? error.message : "No se pudieron cargar los clientes.");
    }
  }

  async function refreshReservationsData() {
    if (!isSupabaseConfigured || !currentUser) return;
    try {
      setReservations(await fetchReservations());
    } catch (error) {
      loadedAdminSections.current.delete("reservation");
      setDataError(error instanceof Error ? error.message : "No se pudieron cargar las reservaciones.");
    }
  }

  async function addReservation(input: ReservationInput) {
    await createReservation(input);
    await refreshReservationsData();
  }

  async function setReservationStatus(reservationId: string, status: ReservationStatus) {
    await updateReservationStatus(reservationId, status);
    await refreshReservationsData();
  }

  async function moveReservationTable(reservationId: string, tableId: string) {
    await changeReservationTable(reservationId, tableId);
    await refreshReservationsData();
  }

  async function refreshStaffData() {
    if (!isSupabaseConfigured || !currentUser) return;
    try {
      setStaffMembers(await fetchStaffMembers());
    } catch (error) {
      loadedAdminSections.current.delete("staff");
      setDataError(error instanceof Error ? error.message : "No se pudo cargar el equipo.");
    }
  }

  async function changeStaffRole(profileId: string, role: Role) {
    await updateStaffRole(profileId, role);
    await refreshStaffData();
  }

  async function saveMyProfile(input: { fullName: string; email?: string; password?: string }) {
    await updateMyProfile(input);
    setCurrentUser((previous) => (previous ? { ...previous, fullName: input.fullName, email: input.email ?? previous.email } : previous));
  }

  async function refreshRemoteData({
    includeCustomers = false,
    force = true,
    suppressRealtimeEcho = false,
  }: { includeCustomers?: boolean; force?: boolean; suppressRealtimeEcho?: boolean } = {}) {
    if (!isSupabaseConfigured || !currentUser) return;
    if (suppressRealtimeEcho) lastOperationalWriteRefresh.current = Date.now();
    setIsLoadingData(true);
    try {
      const [data, customerData] = await Promise.all([
        fetchPosData(force),
        includeCustomers ? fetchCustomers(force) : Promise.resolve<Customer[] | null>(null),
      ]);
      setTables(data.tables);
      setCategories(data.categories);
      setCatalogProducts(data.products);
      setAvailableCoupons(data.coupons);
      setOrders(data.orders);
      if (customerData) setCustomers(customerData);
      setSelectedTableId((current) => data.tables.some((table) => table.id === current) ? current : data.tables[0]?.id ?? "");
      setSelectedCategoryId((current) =>
        data.categories.some((category) => category.id === current) ? current : data.categories[0]?.id ?? "",
      );
      setCart((current) => {
        const productIds = new Set(data.products.map((product) => product.id));
        return current.filter((item) => productIds.has(item.productId));
      });
      setDataError("");
      return data.products;
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "No se pudieron cargar los datos de Supabase.");
    } finally {
      setIsLoadingData(false);
    }
  }

  async function refreshAdminData(sourceProducts = catalogProducts, force = true) {
    if (!currentUser) return;
    setIsLoadingAdminData(true);
    try {
      const snapshot = await fetchAdminSnapshot(
        sourceProducts,
        { inventory: currentUser.role === "admin" },
        force,
      );
      setBusinessSettings({ ...snapshot.settings, taxes: normalizeTaxes(snapshot.settings.taxes) });
      setBotSettings(snapshot.botSettings);
      setVoiceSettings(snapshot.voiceSettings);
      setRestaurantProfile(snapshot.restaurant);
      if (currentUser.role === "admin") {
        setInventory(snapshot.inventory);
        loadedAdminSections.current.add("inventory");
      }
    } catch (error) {
      loadedAdminSections.current.delete("inventory");
      setDataError(error instanceof Error ? error.message : "No se pudieron cargar los datos administrativos.");
    } finally {
      setIsLoadingAdminData(false);
    }
  }

  useEffect(() => {
    let isCurrent = true;

    if (!isSupabaseConfigured) {
      setIsRestoringSession(false);
      return;
    }

    fetchStoredSessionUser()
      .then((storedUser) => {
        if (!isCurrent || !storedUser) return;
        setCurrentUser(storedUser);
        setPage(roleHome[storedUser.role]);
      })
      .catch(() => {
        if (isCurrent) setCurrentUser(null);
      })
      .finally(() => {
        if (isCurrent) setIsRestoringSession(false);
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    if (currentUser.role === "admin") loadedAdminSections.current.add("inventory");
    if (currentUser.role === "cashier") loadedAdminSections.current.add("customers");
    void (async () => {
      const loadedProducts = isSupabaseConfigured
        ? await refreshRemoteData({ includeCustomers: currentUser.role === "cashier", force: false })
        : catalogProducts;
      if (!cancelled) await refreshAdminData(loadedProducts ?? catalogProducts, false);
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser || !isSupabaseConfigured) return;

    if ((page === "cashier" || page === "customers") && !loadedAdminSections.current.has("customers")) {
      loadedAdminSections.current.add("customers");
      void refreshCustomersData();
    }
    if ((page === "inventory" || page === "dashboard") && currentUser.role === "admin" && !loadedAdminSections.current.has("inventory")) {
      loadedAdminSections.current.add("inventory");
      void refreshInventoryData();
    }
    if (page === "finance" && currentUser.role === "admin" && !loadedAdminSections.current.has("finance")) {
      loadedAdminSections.current.add("finance");
      void refreshFinanceData();
    }
    if (page === "reservation" && !loadedAdminSections.current.has("reservation")) {
      loadedAdminSections.current.add("reservation");
      void refreshReservationsData();
    }
    if (page === "profile" && currentUser.role === "admin" && !loadedAdminSections.current.has("staff")) {
      loadedAdminSections.current.add("staff");
      void refreshStaffData();
    }
    if (page === "restaurants" && isSuperAdminUser(currentUser) && !loadedAdminSections.current.has("restaurants")) {
      loadedAdminSections.current.add("restaurants");
      void fetchRestaurants().then(setRegisteredRestaurants).catch((error: unknown) => {
        loadedAdminSections.current.delete("restaurants");
        setDataError(error instanceof Error ? error.message : "No se pudieron cargar los restaurantes.");
      });
    }
  }, [currentUser, page]);

  useEffect(() => {
    if (page === "restaurants" && !isSuperAdminUser(user)) setPage("dashboard");
  }, [page, user]);

  useEffect(() => {
    if (!isSupabaseConfigured || !currentUser) return;
    return subscribeToKitchenChanges(
      () => {
        if (Date.now() - lastOperationalWriteRefresh.current < 1_500) return;
        void refreshRemoteData({ force: true });
      },
      () => {
        if (Date.now() - lastInventoryWriteRefresh.current < 1_500) return;
        void refreshInventoryData();
      },
    );
  }, [currentUser]);

  async function login(email: string, password: string) {
    if (isSupabaseConfigured) {
      await signInWithPassword(email, password);
      const nextUser = await fetchCurrentUserProfile();
      setCurrentUser(nextUser);
      setPage(roleHome[nextUser.role]);
      return;
    }

    const found = users.find((item) => item.email.toLowerCase() === email.toLowerCase());
    const nextUser = found ?? users[1];
    setCurrentUser(nextUser);
    setPage(roleHome[nextUser.role]);
  }

  async function logout() {
    if (isSupabaseConfigured) {
      await signOutFromSupabase();
    }
    loadedAdminSections.current.clear();
    setCurrentUser(null);
    setPage("tables");
  }

  function selectTable(table: RestaurantTable) {
    if (table.status === "out") return;
    setSelectedTableId(table.id);
    const order = orders.find((item) => item.tableId === table.id && item.status !== "paid");
    setCart(order?.items ?? []);
    setAppliedCoupon(undefined);
    setCouponCode("");
    setPage("pos");
  }

  function addProduct(product: Product, quantity = 1) {
    if (!product.available) return;
    setCart((items) => {
      const exists = items.find((item) => item.productId === product.id);
      if (exists) {
        return items.map((item) =>
          item.productId === product.id
            ? { ...item, quantity: Number((item.quantity + quantity).toFixed(3)) }
            : item,
        );
      }
      return [...items, { productId: product.id, productName: product.name, unitPrice: product.price, quantity }];
    });
    setTables((items) =>
      items.map((table) =>
        table.id === selectedTableId
          ? { ...table, status: table.status === "available" ? "occupied" : table.status }
          : table,
      ),
    );
  }

  function changeQuantity(productId: string, delta: number) {
    setCart((items) =>
      items
        .map((item) =>
          item.productId === productId
            ? { ...item, quantity: Math.max(0, item.quantity + delta) }
            : item,
        )
        .filter((item) => item.quantity > 0),
    );
  }

  function applyCoupon() {
    const found = availableCoupons.find(
      (coupon) => coupon.code.toLowerCase() === couponCode.trim().toLowerCase() && coupon.active,
    );
    setAppliedCoupon(found);
  }

  async function sendToKitchen() {
    if (cart.length === 0 || !selectedTable) return;
    const existing = orders.find((order) => order.tableId === selectedTableId && order.status !== "paid");
    const orderItems = cart.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: item.unitPrice ?? catalogProducts.find((product) => product.id === item.productId)?.price ?? 0,
      notes: item.notes,
    }));
    if (isSupabaseConfigured) {
      try {
        if (existing) {
          await replaceOrderItems(existing.id, orderItems);
        } else {
          await createOrder(selectedTableId, orderItems);
        }
        setCart([]);
        setAppliedCoupon(undefined);
        setCouponCode("");
        await refreshRemoteData({ suppressRealtimeEcho: true });
        setPage("kitchen");
      } catch (error) {
        setDataError(error instanceof Error ? error.message : "No se pudo enviar la orden a cocina.");
      }
      return;
    }

    const nextOrder: Order = {
      id: existing?.id ?? String(1030 + orders.length),
      orderNumber: existing?.orderNumber ?? `ORD-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(orders.length + 1).padStart(4, "0")}`,
      tableId: selectedTableId,
      tableNumber: selectedTable.number,
      waiter: user.fullName,
      status: "new",
      items: cart,
      couponCode: appliedCoupon?.code,
      createdAt: existing?.createdAt ?? "Ahora",
      updatedAt: "Ahora",
      businessDate: existing?.businessDate ?? new Date().toISOString().slice(0, 10),
    };

    setOrders((items) =>
      existing ? items.map((order) => (order.id === existing.id ? nextOrder : order)) : [nextOrder, ...items],
    );
    setTables((items) =>
      items.map((table) =>
        table.id === selectedTableId ? { ...table, status: "kitchen", total: totals.total } : table,
      ),
    );
    setPage("kitchen");
  }

  async function updateOrderStatus(orderId: string, status: OrderStatus) {
    if (isSupabaseConfigured) {
      try {
        await updateRemoteOrderStatus(orderId, status);
        await refreshRemoteData({ suppressRealtimeEcho: true });
      } catch (error) {
        setDataError(error instanceof Error ? error.message : "No se pudo actualizar la orden.");
      }
      return;
    }

    const order = orders.find((item) => item.id === orderId);
    setOrders((items) =>
      items.map((item) => (item.id === orderId ? { ...item, status, updatedAt: "Ahora" } : item)),
    );
    if (order) {
      const tableStatus: TableStatus =
        status === "preparing" ? "kitchen" : status === "ready" ? "ready" : status === "delivered" ? "payment" : "occupied";
      setTables((items) =>
        items.map((table) => (table.id === order.tableId ? { ...table, status: tableStatus } : table)),
      );
    }
  }

  async function cancelOrder(orderId: string, reason: string) {
    if (isSupabaseConfigured) {
      try {
        await cancelRemoteOrder(orderId, reason);
        await refreshRemoteData({ suppressRealtimeEcho: true });
      } catch (error) {
        setDataError(error instanceof Error ? error.message : "No se pudo cancelar la orden.");
        throw error;
      }
      return;
    }

    const order = orders.find((item) => item.id === orderId);
    setOrders((items) =>
      items.map((item) =>
        item.id === orderId ? { ...item, status: "cancelled", cancelReason: reason, updatedAt: "Ahora" } : item,
      ),
    );
    if (order) {
      setTables((items) =>
        items.map((table) => (table.id === order.tableId ? { ...table, status: "available" } : table)),
      );
    }
  }

  async function payOrder(orderId: string, paymentMethod: PaymentMethod, customer?: Customer) {
    const order = orders.find((item) => item.id === orderId);
    if (!order) return;
    if (isSupabaseConfigured) {
      try {
        const orderTotals = order.totals ?? calculateTotals(
          order.items,
          availableCoupons.find((coupon) => coupon.code === order.couponCode),
          catalogProducts,
          businessSettings.taxes,
        );
        await processPayment(orderId, paymentMethod, orderTotals.total, customer ? {
          email: customer.email,
          name: customer.fullName,
        } : undefined);
        await Promise.all([
          refreshRemoteData({ force: true, suppressRealtimeEcho: true }),
          currentUser?.role === "admin" ? refreshInventoryData(catalogProducts, true) : Promise.resolve(),
        ]);
      } catch (error) {
        setDataError(error instanceof Error ? error.message : "No se pudo cobrar la orden.");
        throw error;
      }
      return;
    }

    const soldByProduct = order.items.reduce<Map<string, number>>((quantities, item) => {
      quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
      return quantities;
    }, new Map());
    const insufficientItem = inventory
      .filter((item) => Boolean(item.updatedAt))
      .find((item) => item.stockQuantity + 0.0001 < (soldByProduct.get(item.productId) ?? 0));
    if (insufficientItem) {
      const requested = soldByProduct.get(insufficientItem.productId) ?? 0;
      const message = `Stock insuficiente para ${insufficientItem.productName}. Disponible: ${insufficientItem.stockQuantity}, solicitado: ${requested}.`;
      setDataError(message);
      throw new Error(message);
    }

    setInventory((items) =>
      items.map((item) => {
        if (!item.updatedAt) return item;
        const soldQuantity = soldByProduct.get(item.productId) ?? 0;
        return soldQuantity
          ? {
              ...item,
              stockQuantity: Number((item.stockQuantity - soldQuantity).toFixed(3)),
              updatedAt: new Date().toISOString(),
            }
          : item;
      }),
    );

    setOrders((items) =>
      items.map((item) =>
        item.id === orderId
          ? {
              ...item,
              status: "paid",
              paymentMethod,
              customerId: customer?.id,
              customerName: customer?.fullName,
              customerEmail: customer?.email,
              customerRnc: customer?.rnc,
              paidAt: new Date().toISOString(),
              businessDate: new Date().toISOString().slice(0, 10),
              updatedAt: "Ahora",
            }
          : item,
      ),
    );
    setTables((items) =>
      items.map((table) =>
        table.id === order.tableId ? { ...table, status: "available", total: undefined } : table,
      ),
    );
    if (order.tableId === selectedTableId) {
      setCart([]);
      setAppliedCoupon(undefined);
      setCouponCode("");
    }
  }

  async function refreshInventoryData(sourceProducts = catalogProducts, suppressRealtimeEcho = false) {
    if (!currentUser || currentUser.role !== "admin") return;
    if (suppressRealtimeEcho) lastInventoryWriteRefresh.current = Date.now();
    try {
      setInventory(await fetchInventory(sourceProducts));
    } catch (error) {
      loadedAdminSections.current.delete("inventory");
      setDataError(error instanceof Error ? error.message : "No se pudo actualizar el inventario.");
    }
  }

  async function refreshFinanceData() {
    if (!currentUser || currentUser.role !== "admin") return;
    try {
      const [expenseData, paymentData] = await Promise.all([fetchExpenses(), fetchEmployeePayments()]);
      setExpenses(expenseData);
      setEmployeePayments(paymentData);
    } catch (error) {
      loadedAdminSections.current.delete("finance");
      setDataError(error instanceof Error ? error.message : "No se pudieron actualizar las finanzas.");
    }
  }

  async function saveCustomer(input: CustomerInput): Promise<Customer> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const normalizedPhone = input.phone.trim();
    if (!normalizedEmail && !normalizedPhone) {
      throw new Error("Indique al menos el correo o el telefono del cliente.");
    }
    const displayName = input.fullName || normalizedEmail || normalizedPhone;

    if (isSupabaseConfigured) {
      const id = await upsertCustomer({ ...input, email: normalizedEmail, phone: normalizedPhone });
      await refreshCustomersData();
      return {
        id,
        type: input.type,
        fullName: displayName,
        email: normalizedEmail,
        rnc: input.rnc,
        phone: normalizedPhone,
        address: input.address,
        notes: input.notes,
        createdAt: new Date().toISOString(),
      };
    }

    const existing = customers.find((customer) =>
      (normalizedEmail && customer.email.toLowerCase() === normalizedEmail) ||
      (normalizedPhone && customer.phone === normalizedPhone),
    );
    const nextCustomer: Customer = {
      id: existing?.id ?? `local-customer-${Date.now()}`,
      type: input.type,
      fullName: displayName,
      email: normalizedEmail,
      rnc: input.rnc,
      phone: normalizedPhone,
      address: input.address,
      notes: input.notes,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    setCustomers((items) =>
      existing
        ? items.map((customer) => (customer.id === existing.id ? nextCustomer : customer))
        : [nextCustomer, ...items],
    );
    return nextCustomer;
  }

  async function assignCustomerToOrder(orderId: string, customer: Customer) {
    if (isSupabaseConfigured) {
      await assignOrderCustomer(orderId, customer.id);
    }
    setOrders((items) =>
      items.map((order) =>
        order.id === orderId
          ? { ...order, customerId: customer.id, customerName: customer.fullName, customerEmail: customer.email, customerRnc: customer.rnc }
          : order,
      ),
    );
  }

  async function saveCategory(input: CategoryInput, categoryId?: string) {
    try {
      if (isSupabaseConfigured) {
        if (categoryId) await updateRemoteCategory(categoryId, input);
        else await createRemoteCategory(input);
        await refreshRemoteData();
        return;
      }

      if (categoryId) {
        setCategories((items) =>
          items.map((category) =>
            category.id === categoryId
              ? { ...category, name: input.name, description: input.description, imageUrl: input.imageUrl }
              : category,
          ),
        );
      } else {
        setCategories((items) => [
          ...items,
          {
            id: `local-category-${Date.now()}`,
            name: input.name,
            description: input.description,
            imageUrl: input.imageUrl,
            active: true,
          },
        ]);
      }
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "No se pudo guardar la categoria.");
    }
  }

  async function removeCategory(categoryId: string) {
    if (!window.confirm("Eliminar categoria?")) return;
    try {
      if (isSupabaseConfigured) {
        await deleteRemoteCategory(categoryId);
        await refreshRemoteData();
        return;
      }
      setCategories((items) => items.filter((category) => category.id !== categoryId));
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "No se pudo eliminar la categoria.");
    }
  }

  async function saveProduct(input: ProductInput, productId?: string, imageFile?: File | null) {
    try {
      const nextInput = imageFile ? { ...input, imageUrl: await uploadProductImage(imageFile) } : input;
      if (isSupabaseConfigured) {
        if (productId) await updateRemoteProduct(productId, nextInput);
        else await createRemoteProduct(nextInput);
        await refreshRemoteData();
        return;
      }

      if (productId) {
        setCatalogProducts((items) =>
          items.map((product) =>
            product.id === productId
              ? {
                  ...product,
                  name: nextInput.name,
                  description: nextInput.description,
                  categoryId: nextInput.categoryId,
                  price: nextInput.price,
                  imageUrl: nextInput.imageUrl,
                  available: nextInput.available,
                  minutes: nextInput.minutes,
                  saleUnit: nextInput.saleUnit,
                }
              : product,
          ),
        );
      } else {
        setCatalogProducts((items) => [
          ...items,
          {
            id: `local-product-${Date.now()}`,
            name: nextInput.name,
            description: nextInput.description,
            categoryId: nextInput.categoryId,
            price: nextInput.price,
            imageUrl: nextInput.imageUrl,
            available: nextInput.available,
            minutes: nextInput.minutes,
            saleUnit: nextInput.saleUnit,
          },
        ]);
      }
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "No se pudo guardar el producto.");
    }
  }

  async function removeProduct(productId: string) {
    if (!window.confirm("Eliminar producto?")) return;
    try {
      if (isSupabaseConfigured) {
        await deleteRemoteProduct(productId);
        await refreshRemoteData();
        return;
      }
      setCatalogProducts((items) => items.filter((product) => product.id !== productId));
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "No se pudo eliminar el producto.");
    }
  }

  async function saveCoupon(input: CouponInput, couponId?: string) {
    try {
      if (isSupabaseConfigured) {
        if (couponId) await updateRemoteCoupon(couponId, input);
        else await createRemoteCoupon(input);
        await refreshRemoteData();
        return;
      }

      if (couponId) {
        setAvailableCoupons((items) =>
          items.map((coupon) =>
            coupon.id === couponId
              ? {
                  ...coupon,
                  code: input.code.toUpperCase(),
                  name: input.name,
                  type: input.type,
                  value: input.value,
                  active: input.active,
                }
              : coupon,
          ),
        );
      } else {
        setAvailableCoupons((items) => [
          ...items,
          {
            id: `local-coupon-${Date.now()}`,
            code: input.code.toUpperCase(),
            name: input.name,
            type: input.type,
            value: input.value,
            appliesTo: "Restaurante",
            active: input.active,
            validity: "Sin vigencia",
          },
        ]);
      }
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "No se pudo guardar el cupon.");
    }
  }

  async function removeCoupon(couponId: string) {
    if (!window.confirm("Eliminar cupon?")) return;
    try {
      if (isSupabaseConfigured) {
        await deleteRemoteCoupon(couponId);
        await refreshRemoteData();
        return;
      }
      setAvailableCoupons((items) => items.filter((coupon) => coupon.id !== couponId));
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "No se pudo eliminar el cupon.");
    }
  }

  async function saveTable(input: TableInput, tableId?: string) {
    try {
      if (isSupabaseConfigured) {
        if (tableId) await updateRemoteTable(tableId, input);
        else await createRemoteTable(input);
        await refreshRemoteData({ suppressRealtimeEcho: true });
        return;
      }

      if (tableId) {
        setTables((items) =>
          items.map((table) =>
            table.id === tableId
              ? { ...table, number: input.number, capacity: input.capacity, status: input.status }
              : table,
          ),
        );
      } else {
        setTables((items) => [
          ...items,
          {
            id: `local-table-${Date.now()}`,
            number: input.number,
            capacity: input.capacity,
            status: input.status,
            waiter: user.fullName,
          },
        ]);
      }
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "No se pudo guardar la mesa.");
    }
  }

  async function saveTableLayout(tableId: string, layout: TableLayoutInput) {
    setTables((items) =>
      items.map((table) => (table.id === tableId ? { ...table, ...layout } : table)),
    );
    if (!isSupabaseConfigured) return;
    try {
      await updateRemoteTableLayout(tableId, layout);
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "No se pudo guardar la posicion de la mesa.");
    }
  }

  async function removeTable(tableId: string) {
    if (!window.confirm("Eliminar mesa?")) return;
    try {
      if (isSupabaseConfigured) {
        await deleteRemoteTable(tableId);
        await refreshRemoteData({ suppressRealtimeEcho: true });
        return;
      }
      setTables((items) => items.filter((table) => table.id !== tableId));
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "No se pudo eliminar la mesa.");
    }
  }

  async function saveInventory(input: InventoryInput) {
    try {
      if (isSupabaseConfigured) {
        await saveInventoryItem(input);
        await refreshInventoryData(catalogProducts, true);
        return;
      }

      setInventory((items) => {
        const product = catalogProducts.find((catalogProduct) => catalogProduct.id === input.productId);
        const nextItem: InventoryItem = {
          id: items.find((item) => item.productId === input.productId)?.id ?? `local-inventory-${input.productId}`,
          productId: input.productId,
          productName: product?.name ?? "Producto",
          productPrice: product?.price ?? 0,
          stockQuantity: input.stockQuantity,
          reorderLevel: input.reorderLevel,
          unitCost: input.unitCost,
          supplierName: input.supplierName,
          updatedAt: new Date().toISOString(),
        };
        return items.some((item) => item.productId === input.productId)
          ? items.map((item) => (item.productId === input.productId ? nextItem : item))
          : [...items, nextItem].sort((a, b) => a.productName.localeCompare(b.productName));
      });
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "No se pudo guardar el inventario.");
    }
  }

  async function addExpense(input: ExpenseInput) {
    try {
      if (isSupabaseConfigured) {
        await createExpense(input);
        await refreshFinanceData();
        return;
      }

      setExpenses((items) => [
        {
          id: `local-expense-${Date.now()}`,
          expenseDate: input.expenseDate,
          category: input.category,
          type: input.type,
          description: input.description,
          amount: input.amount,
          paymentMethod: input.paymentMethod,
          vendor: input.vendor,
        },
        ...items,
      ]);
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "No se pudo registrar el gasto.");
    }
  }

  async function removeExpense(expenseId: string) {
    if (!window.confirm("Eliminar gasto?")) return;
    try {
      if (isSupabaseConfigured) {
        await deleteExpense(expenseId);
        await refreshFinanceData();
        return;
      }
      setExpenses((items) => items.filter((expense) => expense.id !== expenseId));
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "No se pudo eliminar el gasto.");
    }
  }

  async function addEmployeePayment(input: EmployeePaymentInput) {
    try {
      if (isSupabaseConfigured) {
        await createEmployeePayment(input);
        await refreshFinanceData();
        return;
      }

      setEmployeePayments((items) => [
        {
          id: `local-payment-${Date.now()}`,
          paymentDate: input.paymentDate,
          employeeName: input.employeeName,
          role: input.role,
          amount: input.amount,
          paymentMethod: input.paymentMethod,
          notes: input.notes,
        },
        ...items,
      ]);
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "No se pudo registrar el pago.");
    }
  }

  async function removeEmployeePayment(paymentId: string) {
    if (!window.confirm("Eliminar pago a empleado?")) return;
    try {
      if (isSupabaseConfigured) {
        await deleteEmployeePayment(paymentId);
        await refreshFinanceData();
        return;
      }
      setEmployeePayments((items) => items.filter((payment) => payment.id !== paymentId));
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "No se pudo eliminar el pago.");
    }
  }

  async function saveSettings(settings: BusinessSettings) {
    try {
      const normalizedSettings = {
        ...settings,
        currencyCode: settings.currencyCode.trim().toUpperCase() || "DOP",
        currencyLocale: settings.currencyLocale.trim() || "es-DO",
        taxes: normalizeTaxes(settings.taxes),
      };
      await saveBusinessSettings(normalizedSettings);
      setBusinessSettings(normalizedSettings);
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "No se pudo guardar la configuracion.");
    }
  }

  async function saveBotSettingsHandler(settings: BotSettings) {
    try {
      await saveBotSettings(settings);
      setBotSettings(settings);
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "No se pudo guardar la configuracion del bot.");
    }
  }

  async function saveVoiceSettingsHandler(settings: VoiceBotSettings) {
    try {
      await saveVoiceSettings(settings);
      setVoiceSettings(settings);
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "No se pudo guardar la configuracion del bot de voz.");
    }
  }

  async function regenerateVoiceApiKeyHandler() {
    try {
      const apiKey = await regenerateVoiceApiKey();
      setVoiceSettings((current) => ({ ...current, apiKey }));
      return apiKey;
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "No se pudo regenerar la API key de voz.");
      throw error;
    }
  }

  async function saveRestaurantProfile(input: RestaurantInput, logoFile?: File | null) {
    try {
      const logoUrl = logoFile ? await uploadRestaurantLogo(logoFile) : input.logoUrl;
      await saveCurrentRestaurant({ ...input, logoUrl });
      const restaurant = await fetchCurrentRestaurant();
      setRestaurantProfile(restaurant);
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "No se pudo guardar el restaurante.");
    }
  }

  async function addRestaurant(input: RestaurantInput, logoFile?: File | null) {
    try {
      const restaurantId = await createRestaurant(input);
      if (logoFile) {
        const logoUrl = await uploadRestaurantLogo(logoFile, restaurantId);
        await updateRestaurantLogo(restaurantId, logoUrl);
      }
      setRegisteredRestaurants(await fetchRestaurants());
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "No se pudo registrar el restaurante.");
    }
  }

  if (isRestoringSession) {
    return (
      <main className="loading-screen">
        <div className="panel">
          <h2>RestoPOS</h2>
          <p>Restaurando sesion...</p>
        </div>
      </main>
    );
  }

  if (!currentUser) {
    return <LoginScreen onLogin={login} />;
  }

  return (
    <div className="app-shell">
      <Sidebar user={user} page={page} setPage={setPage} onLogout={logout} restaurant={restaurantProfile} />
      <main className="workspace">
        <Header
          user={user}
          page={page}
          selectedTable={selectedTable}
          restaurant={restaurantProfile}
          onMenu={() => setIsMobileMenuOpen(true)}
          onNavigate={setPage}
          lowStockCount={lowStockItems.length}
        />
        {dataError && <div className="app-alert">{dataError}</div>}
        {isLoadingData && <div className="app-alert info">Sincronizando datos...</div>}
        {isLoadingAdminData && <div className="app-alert info">Cargando datos administrativos...</div>}
        {page === "dashboard" && (
          <Dashboard
            tables={tables}
            orders={orders}
            products={catalogProducts}
            coupons={availableCoupons}
            productCount={catalogProducts.length}
            inventory={inventory}
            onNewOrder={() => setPage("tables")}
            onNavigate={setPage}
          />
        )}
        {page === "tables" && (
          <TablesPage
            tables={tables}
            selectedId={selectedTableId}
            onSelect={selectTable}
            onSave={saveTable}
            onDelete={removeTable}
            onLayoutChange={saveTableLayout}
          />
        )}
        {page === "pos" && selectedTable && (
          <PosPage
            table={selectedTable}
            categories={categories}
            products={catalogProducts}
            selectedCategoryId={selectedCategoryId}
            onCategory={setSelectedCategoryId}
            cart={cart}
            totals={totals}
            couponCode={couponCode}
            appliedCoupon={appliedCoupon}
            setCouponCode={setCouponCode}
            onApplyCoupon={applyCoupon}
            onAddProduct={addProduct}
            onQuantity={changeQuantity}
            onSave={() => window.alert("Pedido guardado en pantalla. Usa Enviar a cocina para persistirlo.")}
            onSend={sendToKitchen}
          />
        )}
        {page === "pos" && !selectedTable && (
          <section className="panel page-panel">
            <PanelHeader title="POS" action="+ Nueva Mesa" onAction={() => setPage("tables")} />
            <div className="empty-state">Este restaurante todavia no tiene mesas. Crea una mesa para abrir pedidos.</div>
          </section>
        )}
        {page === "kitchen" && <KitchenPage orders={orders} products={catalogProducts} onStatus={updateOrderStatus} />}
        {page === "reservation" && (
          <ReservationPage
            tables={tables}
            reservations={reservations}
            onCreate={addReservation}
            onStatusChange={setReservationStatus}
            onChangeTable={moveReservationTable}
          />
        )}
        {page === "notifications" && (
          <NotificationsPage inventory={inventory} onDismiss={(id) => setInventory((current) => current.filter((item) => item.id !== id))} />
        )}
        {page === "profile" && (
          <ProfilePage
            user={user}
            staffMembers={staffMembers}
            onSaveProfile={saveMyProfile}
            onChangeStaffRole={changeStaffRole}
            onLogout={logout}
          />
        )}
        {page === "cashier" && (
          <CashierPage
            orders={orders}
            products={catalogProducts}
            coupons={availableCoupons}
            customers={customers}
            settings={businessSettings}
            restaurant={restaurantProfile}
            onPay={payOrder}
            onCancelOrder={cancelOrder}
            onSaveCustomer={saveCustomer}
            onAssignCustomer={assignCustomerToOrder}
          />
        )}
        {page === "history" && (
          <OrderHistoryPage
            orders={orders}
            products={catalogProducts}
            coupons={availableCoupons}
            settings={businessSettings}
            restaurant={restaurantProfile}
          />
        )}
        {page === "customers" && <CustomersPage customers={customers} orders={orders} products={catalogProducts} />}
        {page === "restaurants" && isSuperAdminUser(user) && (
          <RestaurantsPage restaurants={registeredRestaurants} currentRestaurant={restaurantProfile} onCreate={addRestaurant} />
        )}
        {page === "inventory" && (
          <InventoryPage inventory={inventory} products={catalogProducts} categories={categories} onSave={saveInventory} />
        )}
        {page === "finance" && (
          <FinancePage
            expenses={expenses}
            employeePayments={employeePayments}
            onCreateExpense={addExpense}
            onDeleteExpense={removeExpense}
            onCreateEmployeePayment={addEmployeePayment}
            onDeleteEmployeePayment={removeEmployeePayment}
          />
        )}
        {page === "categories" && (
          <CategoriesPage categories={categories} onSave={saveCategory} onDelete={removeCategory} />
        )}
        {page === "products" && (
          <ProductsPage
            products={catalogProducts}
            categories={categories}
            onSave={saveProduct}
            onDelete={removeProduct}
          />
        )}
        {page === "coupons" && (
          <CouponsPage coupons={availableCoupons} onSave={saveCoupon} onDelete={removeCoupon} />
        )}
        {page === "reports" && (
          <ReportsPage
            orders={orders}
            tables={tables}
            products={catalogProducts}
            coupons={availableCoupons}
            expenses={expenses}
            employeePayments={employeePayments}
            taxes={businessSettings.taxes}
          />
        )}
        {page === "logs" && <LogsPage />}
        {page === "settings" && (
          <SettingsPage
            settings={businessSettings}
            botSettings={botSettings}
            voiceSettings={voiceSettings}
            restaurant={restaurantProfile}
            onSave={saveSettings}
            onSaveBotSettings={saveBotSettingsHandler}
            onSaveVoiceSettings={saveVoiceSettingsHandler}
            onRegenerateVoiceApiKey={regenerateVoiceApiKeyHandler}
            onSaveRestaurant={saveRestaurantProfile}
          />
        )}
      </main>
      {isMobileMenuOpen && (
        <MobileMenuDrawer
          user={user}
          page={page}
          restaurant={restaurantProfile}
          setPage={(nextPage) => {
            setPage(nextPage);
            setIsMobileMenuOpen(false);
          }}
          onClose={() => setIsMobileMenuOpen(false)}
          onLogout={logout}
        />
      )}
      <MobileNav user={user} page={page} setPage={setPage} />
    </div>
  );
}

function LoginScreen({ onLogin }: { onLogin: (email: string, password: string) => Promise<void> }) {
  const [view, setView] = useState<"login" | "forgot">("login");
  const [email, setEmail] = useState("mesero@restaurante.com");
  const [password, setPassword] = useState("restaurant2026");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetMessage, setResetMessage] = useState("");
  const [resetError, setResetError] = useState("");
  const [isResetting, setIsResetting] = useState(false);

  return (
    <main className="login-shell">
      <div className="login-brand-centered">
        <h1>RESTOPOS</h1>
      </div>
      <section className="login-card-shell">
        {view === "login" ? (
          <form
            className="login-card centered"
            onSubmit={async (event) => {
              event.preventDefault();
              setError("");
              setIsSubmitting(true);
              try {
                await onLogin(email, password);
              } catch (loginError) {
                setError(loginError instanceof Error ? loginError.message : "No se pudo iniciar sesion.");
              } finally {
                setIsSubmitting(false);
              }
            }}
          >
            <h2>Login!</h2>
            <span>Please enter your credentials below to continue</span>
            <label>
              Username
              <input value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {error && <span className="error-text">{error}</span>}
            <div className="login-options">
              <label className="check-line">
                <input type="checkbox" /> Remember me
              </label>
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setResetEmail(email);
                  setResetMessage("");
                  setResetError("");
                  setView("forgot");
                }}
              >
                Forgot Password?
              </button>
            </div>
            <button className="primary-button centered" type="submit" disabled={isSubmitting}>
              Login
            </button>
            <div className="demo-users">
              {users.map((user) => (
                <button key={user.id} type="button" onClick={() => void onLogin(user.email, password)}>
                  {user.title}
                </button>
              ))}
            </div>
          </form>
        ) : (
          <form
            className="login-card centered"
            onSubmit={async (event) => {
              event.preventDefault();
              setResetError("");
              setResetMessage("");
              setIsResetting(true);
              try {
                if (isSupabaseConfigured) {
                  await requestPasswordReset(resetEmail);
                }
                setResetMessage("Si el correo existe, te enviamos instrucciones para restablecer tu contrasena.");
              } catch (resetErrorValue) {
                setResetError(resetErrorValue instanceof Error ? resetErrorValue.message : "No se pudo enviar el correo.");
              } finally {
                setIsResetting(false);
              }
            }}
          >
            <h2>Forgot your password?</h2>
            <span>Please enter your username or email to recover your password</span>
            <label>
              Username
              <input
                required
                value={resetEmail}
                onChange={(event) => setResetEmail(event.target.value)}
                placeholder="Enter your username"
              />
            </label>
            {resetError && <span className="error-text">{resetError}</span>}
            {resetMessage && <span className="success-text">{resetMessage}</span>}
            <button className="primary-button centered" type="submit" disabled={isResetting}>
              Submit Now
            </button>
            <p className="login-back-link">
              Back to{" "}
              <button type="button" className="link-button" onClick={() => setView("login")}>
                Login!
              </button>
            </p>
          </form>
        )}
      </section>
      <p className="copyright static">© 2026 RestoPOS. Todos los derechos reservados.</p>
    </main>
  );
}

function Sidebar({
  user,
  page,
  setPage,
  onLogout,
  restaurant,
}: {
  user: User;
  page: Page;
  setPage: (page: Page) => void;
  onLogout: () => void;
  restaurant: RestaurantProfile;
}) {
  const navItems = navByRole[user.role];

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        {restaurant.logoUrl ? <img src={restaurant.logoUrl} alt={restaurant.name} /> : <span>{restaurant.name.slice(0, 1)}</span>}
        <div>
          <strong>{restaurant.name}</strong>
          <small>{user.title}</small>
        </div>
      </div>
      <nav>
        {user.role === "admin"
          ? adminNavGroups.map((group) => {
              return (
                <div className="nav-group" key={group.label}>
                  <span className="nav-group-label">{group.label}</span>
                  <div className="nav-group-items">
                      {group.pages.map((itemPage) => {
                        if (itemPage === "restaurants" && !isSuperAdminUser(user)) return null;
                        const item = navItemFor(itemPage, user.role);
                        if (!item) return null;
                        return (
                          <button
                            className={page === item.page ? "active" : ""}
                            key={item.page}
                            onClick={() => setPage(item.page)}
                            title={item.label}
                          >
                            <AppIcon name={item.page} />
                            {item.label}
                          </button>
                        );
                      })}
                  </div>
                </div>
              );
            })
          : navItems.map((item) => (
              <button
                className={page === item.page ? "active" : ""}
                key={item.page}
                onClick={() => setPage(item.page)}
                title={item.label}
              >
                <AppIcon name={item.page} />
                {item.label}
              </button>
            ))}
      </nav>
      <div className="user-chip">
        <div>{user.fullName.slice(0, 1)}</div>
        <span>
          <strong>{user.fullName}</strong>
          {user.title}
        </span>
      </div>
      <button className="sidebar-exit" onClick={onLogout}>
        <AppIcon name="logout" /> Salir
      </button>
    </aside>
  );
}

function Header({
  user,
  page,
  selectedTable,
  restaurant,
  onMenu,
  onNavigate,
  lowStockCount = 0,
}: {
  user: User;
  page: Page;
  selectedTable: RestaurantTable | null;
  restaurant: RestaurantProfile;
  onMenu: () => void;
  onNavigate: (page: Page) => void;
  lowStockCount?: number;
}) {
  const titles: Record<Page, string> = {
    dashboard: "Resumen del dia",
    tables: "Mesas",
    pos: selectedTable ? `Mesa ${selectedTable.number}` : "POS",
    kitchen: "Cocina",
    cashier: "Caja",
    history: "Ordenes",
    customers: "Clientes",
    restaurants: "Restaurantes",
    inventory: "Inventario",
    finance: "Finanzas",
    categories: "Categorias",
    products: "Productos",
    coupons: "Cupones / Descuentos",
    reports: "Reportes",
    logs: "Actividad del sistema",
    settings: "Configuracion",
    reservation: "Reservacion",
    notifications: "Notificaciones",
    profile: "Perfil",
  };

  return (
    <header className="topbar">
      <div>
        <button className="icon-button" title="Menu" aria-label="Abrir menu" onClick={onMenu}>
          <AppIcon name="menu" />
        </button>
        <div>
          <h2>{titles[page]}</h2>
          <span className="restaurant-context">{restaurant.name}</span>
        </div>
        {page === "pos" && selectedTable && <StatusBadge status={selectedTable.status} />}
      </div>
      <div className="topbar-actions">
        <button className="icon-button" title="Buscar" aria-label="Buscar" onClick={() => window.alert("Usa el buscador de cada pantalla para encontrar ordenes, productos o clientes.")}>
          <AppIcon name="search" />
        </button>
        <button
          className="icon-button"
          title="Notificaciones"
          onClick={() => onNavigate("notifications")}
        >
          <AppIcon name="bell" />
          {lowStockCount > 0 && <span className="notification-dot">{lowStockCount}</span>}
        </button>
        <button className="icon-button" title="Imprimir" onClick={() => window.print()}>
          <AppIcon name="print" />
        </button>
        <button className="topbar-profile" onClick={() => onNavigate("profile")} title="Perfil">
          <span>{user.fullName.slice(0, 1)}</span>
          <div><strong>{user.fullName}</strong><small>{user.title}</small></div>
        </button>
      </div>
    </header>
  );
}

function Dashboard({
  tables,
  orders,
  products,
  coupons,
  productCount,
  inventory,
  onNewOrder,
  onNavigate,
}: {
  tables: RestaurantTable[];
  orders: Order[];
  products: Product[];
  coupons: Coupon[];
  productCount: number;
  inventory: InventoryItem[];
  onNewOrder: () => void;
  onNavigate: (page: Page) => void;
}) {
  const today = toDateInputValue(new Date());
  const openOrders = orders.filter((order) => order.status !== "paid");
  const revenue = orders
    .filter((order) => order.status === "paid" && order.businessDate === today)
    .reduce(
      (sum, order) =>
        sum +
        (order.totals ?? calculateTotals(
          order.items,
          coupons.find((coupon) => coupon.code === order.couponCode),
          products,
        )).total,
      0,
    );
  const occupiedTables = tables.filter((table) => table.status !== "available" && table.status !== "out").length;
  const kitchenOrders = openOrders.filter((order) => ["new", "preparing", "ready"].includes(order.status));
  const lowStock = inventory.filter((item) => item.stockQuantity <= item.reorderLevel);
  const recentPaidDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    const key = toDateInputValue(date);
    const total = orders
      .filter((order) => order.status === "paid" && order.businessDate === key)
      .reduce((sum, order) => sum + (order.totals?.total ?? calculateTotals(order.items, undefined, products).total), 0);
    return { key, label: new Intl.DateTimeFormat("es", { weekday: "short" }).format(date), total };
  });
  const maxDailyRevenue = Math.max(...recentPaidDays.map((day) => day.total), 1);

  return (
    <section className="dashboard-page">
      <div className="dashboard-heading">
        <div>
          <p>{new Intl.DateTimeFormat("es-DO", { dateStyle: "full" }).format(new Date())}</p>
          <h3>Resumen de la operacion</h3>
        </div>
        <button className="primary-action" onClick={onNewOrder}>+ Nueva orden</button>
      </div>
      <div className="page-grid dashboard-metrics">
      <MetricCard label="Ventas del dia" value={currency.format(revenue)} tone="green" trend={recentPaidDays.map((day) => day.total)} />
      <MetricCard label="Ordenes activas" value={String(openOrders.length)} tone="blue" trend={recentPaidDays.map((day) => day.total)} />
      <MetricCard
        label="Mesas ocupadas"
        value={`${occupiedTables} / ${tables.length}`}
        tone="orange"
        trend={recentPaidDays.map((day) => day.total)}
      />
      <MetricCard label={lowStock.length ? "Inventario bajo" : "Productos activos"} value={String(lowStock.length || productCount)} tone={lowStock.length ? "orange" : "purple"} trend={recentPaidDays.map((day) => day.total)} />
      </div>
      <div className="dashboard-layout">
        <div className="panel dashboard-sales">
          <PanelHeader title="Ventas de los ultimos 7 dias" action="Ver reportes" onAction={() => onNavigate("reports")} />
          <div className="dashboard-chart" aria-label="Ventas de los ultimos siete dias">
            {recentPaidDays.map((day) => (
              <div key={day.key} title={`${day.key}: ${currency.format(day.total)}`}>
                <strong>{day.total ? currency.format(day.total) : "—"}</strong>
                <span><i style={{ height: `${Math.max((day.total / maxDailyRevenue) * 100, 3)}%` }} /></span>
                <small>{day.label}</small>
              </div>
            ))}
          </div>
        </div>
        <div className="panel dashboard-status">
          <PanelHeader title="Estado del servicio" action="Ver mesas" onAction={() => onNavigate("tables")} />
          <div className="service-status-list">
            <button onClick={() => onNavigate("tables")}><span className="status-dot available" /><span>Mesas disponibles</span><strong>{tables.filter((table) => table.status === "available").length}</strong></button>
            <button onClick={() => onNavigate("kitchen")}><span className="status-dot preparing" /><span>Ordenes en cocina</span><strong>{kitchenOrders.length}</strong></button>
            <button onClick={() => onNavigate("cashier")}><span className="status-dot payment" /><span>Pendientes de cobro</span><strong>{tables.filter((table) => table.status === "payment").length}</strong></button>
            <button onClick={() => onNavigate("inventory")}><span className="status-dot warning" /><span>Productos con poco stock</span><strong>{lowStock.length}</strong></button>
          </div>
        </div>
        <div className="panel dashboard-kitchen">
          <PanelHeader title="Cola de cocina" action="Abrir cocina" onAction={() => onNavigate("kitchen")} />
          <div className="dashboard-order-list">
            {kitchenOrders.slice(0, 5).map((order) => (
              <div key={order.id}><strong>#{orderDisplayNumber(order)}</strong><span>{orderTableLabel(order)}</span><StatusPill status={order.status} /></div>
            ))}
            {!kitchenOrders.length && <div className="empty-state">La cocina esta al dia. Las nuevas ordenes apareceran aqui.</div>}
          </div>
        </div>
        <div className="panel dashboard-activity">
          <PanelHeader title="Actividad reciente" action="Ver registro" onAction={() => onNavigate("logs")} />
          <LogList compact />
        </div>
      </div>
    </section>
  );
}

function TablesPage({
  tables,
  selectedId,
  onSelect,
  onSave,
  onDelete,
  onLayoutChange,
}: {
  tables: RestaurantTable[];
  selectedId: string;
  onSelect: (table: RestaurantTable) => void;
  onSave: (input: TableInput, tableId?: string) => Promise<void>;
  onDelete: (tableId: string) => Promise<void>;
  onLayoutChange: (tableId: string, layout: TableLayoutInput) => Promise<void>;
}) {
  const [editingTable, setEditingTable] = useState<RestaurantTable | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | TableStatus>("all");
  const [view, setView] = useState<"list" | "floor">("list");
  const visibleTables = statusFilter === "all" ? tables : tables.filter((table) => table.status === statusFilter);

  return (
    <section className="panel page-panel">
      <PanelHeader title="Mesas" action="+ Nueva Mesa" onAction={() => setIsCreating(true)} />
      <div className="tabs">
        <button className={view === "list" ? "selected" : ""} onClick={() => setView("list")}>
          Lista
        </button>
        <button className={view === "floor" ? "selected" : ""} onClick={() => setView("floor")}>
          Plano
        </button>
      </div>
      {view === "list" && (
        <div className="tabs">
          <button className={statusFilter === "all" ? "selected" : ""} onClick={() => setStatusFilter("all")}>
            Todas {tables.length}
          </button>
          <button className={statusFilter === "available" ? "selected" : ""} onClick={() => setStatusFilter("available")}>
            Disponibles {tables.filter((table) => table.status === "available").length}
          </button>
          <button className={statusFilter === "occupied" ? "selected" : ""} onClick={() => setStatusFilter("occupied")}>
            Ocupadas {tables.filter((table) => table.status === "occupied").length}
          </button>
          <button className={statusFilter === "reserved" ? "selected" : ""} onClick={() => setStatusFilter("reserved")}>
            Reservadas {tables.filter((table) => table.status === "reserved").length}
          </button>
          <button className={statusFilter === "out" ? "selected" : ""} onClick={() => setStatusFilter("out")}>
            Fuera de servicio {tables.filter((table) => table.status === "out").length}
          </button>
        </div>
      )}
      {view === "list" ? (
        <>
          <div className="table-grid">
            {visibleTables.map((table) => (
              <div
                className={`table-card status-${table.status} ${selectedId === table.id ? "selected" : ""}`}
                key={table.id}
              >
                <button className="table-card-main" onClick={() => onSelect(table)}>
                  <span className="table-icon"><AppIcon name="tables" /></span>
                  <strong>Mesa {table.number}</strong>
                  <small>{table.capacity} personas</small>
                  <StatusBadge status={table.status} />
                  {table.occupiedMinutes && <em>{table.occupiedMinutes} min</em>}
                  {table.reservationTime && <em>{table.reservationTime}</em>}
                </button>
                <ActionButtons onEdit={() => setEditingTable(table)} onDelete={() => void onDelete(table.id)} />
              </div>
            ))}
          </div>
          {visibleTables.length === 0 && (
            <div className="empty-state">No hay mesas registradas para este restaurante.</div>
          )}
        </>
      ) : (
        <FloorPlanView tables={tables} selectedId={selectedId} onSelect={onSelect} onLayoutChange={onLayoutChange} />
      )}
      {(isCreating || editingTable) && (
        <TableFormModal
          table={editingTable}
          onClose={() => {
            setIsCreating(false);
            setEditingTable(null);
          }}
          onSave={async (input) => {
            await onSave(input, editingTable?.id);
            setIsCreating(false);
            setEditingTable(null);
          }}
        />
      )}
    </section>
  );
}

const FLOOR_SHAPES: TableShape[] = ["circle", "rect", "bar"];

function nextShape(shape: TableShape | undefined): TableShape {
  const index = FLOOR_SHAPES.indexOf(shape ?? "rect");
  return FLOOR_SHAPES[(index + 1) % FLOOR_SHAPES.length];
}

function fallbackLayout(index: number): { posX: number; posY: number; width: number; height: number } {
  const columns = 4;
  const cellWidth = 170;
  const cellHeight = 150;
  return {
    posX: 24 + (index % columns) * cellWidth,
    posY: 24 + Math.floor(index / columns) * cellHeight,
    width: 140,
    height: 110,
  };
}

function FloorPlanView({
  tables,
  selectedId,
  onSelect,
  onLayoutChange,
}: {
  tables: RestaurantTable[];
  selectedId: string;
  onSelect: (table: RestaurantTable) => void;
  onLayoutChange: (tableId: string, layout: TableLayoutInput) => Promise<void>;
}) {
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<{ id: string; posX: number; posY: number } | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);

  function layoutFor(table: RestaurantTable, index: number) {
    const fallback = fallbackLayout(index);
    const posX = table.posX ?? fallback.posX;
    const posY = table.posY ?? fallback.posY;
    const width = table.width ?? fallback.width;
    const height = table.height ?? fallback.height;
    if (draft && draft.id === table.id) {
      return { posX: draft.posX, posY: draft.posY, width, height };
    }
    return { posX, posY, width, height };
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>, table: RestaurantTable, index: number) {
    if (!editMode) return;
    const { posX, posY } = layoutFor(table, index);
    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = {
      id: table.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: posX,
      originY: posY,
      moved: false,
    };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) drag.moved = true;
    const board = boardRef.current;
    const maxX = board ? Math.max(0, board.clientWidth - 60) : Infinity;
    const maxY = board ? Math.max(0, board.clientHeight - 60) : Infinity;
    const posX = Math.min(Math.max(0, drag.originX + deltaX), maxX);
    const posY = Math.min(Math.max(0, drag.originY + deltaY), maxY);
    setDraft({ id: drag.id, posX, posY });
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>, table: RestaurantTable) {
    const drag = dragState.current;
    dragState.current = null;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!editMode) return;

    if (drag.moved && draft && draft.id === table.id) {
      void onLayoutChange(table.id, { posX: draft.posX, posY: draft.posY });
    }
    setDraft(null);
  }

  return (
    <div>
      <div className="tabs">
        <button className={editMode ? "selected" : ""} onClick={() => setEditMode((value) => !value)}>
          {editMode ? "Listo" : "Editar plano"}
        </button>
      </div>
      <div className="floor-plan-board" ref={boardRef}>
        {tables.map((table, index) => {
          const { posX, posY, width, height } = layoutFor(table, index);
          const shape = table.shape ?? "rect";
          return (
            <div
              key={table.id}
              className={`floor-table shape-${shape} status-${table.status} ${selectedId === table.id ? "selected" : ""} ${editMode ? "editing" : ""}`}
              style={{ left: posX, top: posY, width, height, zIndex: draft?.id === table.id ? 5 : undefined }}
              onPointerDown={(event) => handlePointerDown(event, table, index)}
              onPointerMove={handlePointerMove}
              onPointerUp={(event) => {
                const moved = dragState.current?.moved;
                handlePointerUp(event, table);
                if (!editMode && !moved) onSelect(table);
              }}
            >
              <strong>Mesa {table.number}</strong>
              <small>{table.capacity} personas</small>
              {editMode && (
                <button
                  type="button"
                  className="floor-table-shape-toggle"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    void onLayoutChange(table.id, { shape: nextShape(table.shape) });
                  }}
                >
                  <AppIcon name="tables" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PosPage({
  table,
  categories,
  products,
  selectedCategoryId,
  onCategory,
  cart,
  totals,
  couponCode,
  appliedCoupon,
  setCouponCode,
  onApplyCoupon,
  onAddProduct,
  onQuantity,
  onSave,
  onSend,
}: {
  table: RestaurantTable;
  categories: Category[];
  products: Product[];
  selectedCategoryId: string;
  onCategory: (id: string) => void;
  cart: OrderItem[];
  totals: Totals;
  couponCode: string;
  appliedCoupon?: Coupon;
  setCouponCode: (code: string) => void;
  onApplyCoupon: () => void;
  onAddProduct: (product: Product, quantity?: number) => void;
  onQuantity: (productId: string, delta: number) => void;
  onSave: () => void;
  onSend: () => void;
}) {
  const [search, setSearch] = useState("");
  const [weightedProduct, setWeightedProduct] = useState<Product | null>(null);
  const visibleProducts = products
    .filter((product) => product.categoryId === selectedCategoryId)
    .filter((product) => `${product.name} ${product.description}`.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <section className="pos-layout">
      <div className="catalog-panel">
        <label className="search-field">
          <span>Buscar productos</span>
          <input
            className="search"
            placeholder="Nombre o descripcion"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className="category-row">
          {categories.map((category) => (
            <button
              key={category.id}
              className={category.id === selectedCategoryId ? "selected" : ""}
              onClick={() => onCategory(category.id)}
            >
              {category.name}
            </button>
          ))}
        </div>
        {categories.length === 0 && (
          <div className="empty-state">Crea categorias y productos para este restaurante antes de tomar pedidos.</div>
        )}
        <div className="product-grid">
          {visibleProducts.map((product) => (
            <button
              className="product-card"
              key={product.id}
              onClick={() => product.saleUnit === "lb" ? setWeightedProduct(product) : onAddProduct(product)}
            >
              {product.imageUrl ? (
                <img src={product.imageUrl} alt={product.name} loading="lazy" decoding="async" />
              ) : (
                <span className="product-image-placeholder">Foto</span>
              )}
              <strong>{product.name}</strong>
              <small>{currency.format(product.price)}{product.saleUnit === "lb" ? " / lb" : ""}</small>
              {product.saleUnit === "lb" && <em className="weight-badge">Por peso</em>}
              <span>{product.minutes} min</span>
            </button>
          ))}
        </div>
        {categories.length > 0 && visibleProducts.length === 0 && (
          <div className="empty-state">No hay productos disponibles en esta categoria.</div>
        )}
      </div>
      <OrderPanel
        table={table}
        cart={cart}
        products={products}
        totals={totals}
        couponCode={couponCode}
        appliedCoupon={appliedCoupon}
        setCouponCode={setCouponCode}
        onApplyCoupon={onApplyCoupon}
        onQuantity={onQuantity}
        onSave={onSave}
        onSend={onSend}
      />
      {weightedProduct && (
        <WeightProductModal
          product={weightedProduct}
          onClose={() => setWeightedProduct(null)}
          onAdd={(weight) => {
            onAddProduct(weightedProduct, weight);
            setWeightedProduct(null);
          }}
        />
      )}
    </section>
  );
}

function WeightProductModal({
  product,
  onClose,
  onAdd,
}: {
  product: Product;
  onClose: () => void;
  onAdd: (weight: number) => void;
}) {
  const [weight, setWeight] = useState("1.000");
  const numericWeight = Number(weight) || 0;

  return (
    <Modal title="Agregar producto por peso" onClose={onClose} className="weight-modal">
      <form
        className="weight-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (numericWeight > 0) onAdd(Number(numericWeight.toFixed(3)));
        }}
      >
        <div className="weight-product-summary">
          <div>
            <span>Producto</span>
            <strong>{product.name}</strong>
          </div>
          <div>
            <span>Precio por libra</span>
            <strong>{currency.format(product.price)}</strong>
          </div>
        </div>
        <label htmlFor="product-weight">Peso en libras</label>
        <div className="weight-control">
          <button type="button" aria-label="Restar un cuarto de libra" onClick={() => setWeight(String(Math.max(0.001, numericWeight - 0.25).toFixed(3)))}>−</button>
          <input
            id="product-weight"
            autoFocus
            required
            inputMode="decimal"
            type="number"
            min="0.001"
            step="0.001"
            value={weight}
            onChange={(event) => setWeight(event.target.value)}
          />
          <span>lb</span>
          <button type="button" aria-label="Agregar un cuarto de libra" onClick={() => setWeight(String((numericWeight + 0.25).toFixed(3)))}>+</button>
        </div>
        <div className="weight-presets" aria-label="Pesos frecuentes">
          {[0.25, 0.5, 1, 2].map((amount) => (
            <button type="button" key={amount} onClick={() => setWeight(amount.toFixed(3))}>{amount} lb</button>
          ))}
        </div>
        <div className="weight-total">
          <span>Total</span>
          <strong>{currency.format(product.price * numericWeight)}</strong>
        </div>
        <div className="form-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Volver</button>
          <button type="submit" className="success-button" disabled={numericWeight <= 0}>Agregar al pedido</button>
        </div>
      </form>
    </Modal>
  );
}

function OrderPanel({
  table,
  cart,
  products,
  totals,
  couponCode,
  appliedCoupon,
  setCouponCode,
  onApplyCoupon,
  onQuantity,
  onSave,
  onSend,
}: {
  table: RestaurantTable;
  cart: OrderItem[];
  products: Product[];
  totals: Totals;
  couponCode: string;
  appliedCoupon?: Coupon;
  setCouponCode: (code: string) => void;
  onApplyCoupon: () => void;
  onQuantity: (productId: string, delta: number) => void;
  onSave: () => void;
  onSend: () => void;
}) {
  return (
    <aside className="order-panel">
      <h3>Pedido Actual</h3>
      <p>Mesa {table.number}</p>
      <div className="cart-list">
        {cart.length === 0 && <div className="empty-state">Agrega productos para iniciar la orden.</div>}
        {cart.map((item) => {
          const product = products.find((catalogProduct) => catalogProduct.id === item.productId);
          return (
            <div className="cart-item" key={item.productId}>
              <div>
                <strong>
                  {product?.saleUnit === "lb" ? `${item.quantity.toFixed(3)} lb` : item.quantity} {product?.name ?? item.productName ?? "Producto"}
                </strong>
                <small>{currency.format(product?.price ?? item.unitPrice ?? 0)}</small>
                {item.notes && <em>Nota: {item.notes}</em>}
              </div>
              <div className="stepper">
                <button aria-label={`Reducir ${product?.name ?? "producto"}`} onClick={() => onQuantity(item.productId, product?.saleUnit === "lb" ? -0.25 : -1)}>−</button>
                <span>{product?.saleUnit === "lb" ? item.quantity.toFixed(3) : item.quantity}</span>
                <button aria-label={`Aumentar ${product?.name ?? "producto"}`} onClick={() => onQuantity(item.productId, product?.saleUnit === "lb" ? 0.25 : 1)}>+</button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="coupon-row">
        <input
          placeholder="Ingresar cupon"
          value={couponCode}
          onChange={(event) => setCouponCode(event.target.value)}
        />
        <button onClick={onApplyCoupon}>Aplicar</button>
      </div>
      {appliedCoupon && <span className="coupon-applied">{appliedCoupon.name}</span>}
      <TotalsBlock totals={totals} />
      <div className="order-actions">
        <button className="secondary-button" onClick={onSave}>Guardar</button>
        <button className="success-button" onClick={onSend} disabled={cart.length === 0}>
          Enviar a cocina
        </button>
      </div>
    </aside>
  );
}

function KitchenPage({
  orders,
  products,
  onStatus,
}: {
  orders: Order[];
  products: Product[];
  onStatus: (orderId: string, status: OrderStatus) => void;
}) {
  const lanes: { status: OrderStatus; label: string; action?: OrderStatus; button?: string }[] = [
    { status: "new", label: "Nuevos", action: "preparing", button: "Marcar en preparacion" },
    { status: "preparing", label: "En preparacion", action: "ready", button: "Marcar como listo" },
    { status: "ready", label: "Listos", action: "delivered", button: "Entregado" },
  ];

  return (
    <section className="kds">
      <div className="kds-header">
        <h3>Cocina</h3>
        <div className="tabs compact">
          <button className="selected">Todos {orders.length}</button>
          {lanes.map((lane) => (
            <button key={lane.status}>
              {lane.label} {orders.filter((order) => order.status === lane.status).length}
            </button>
          ))}
        </div>
      </div>
      <div className="kds-grid">
        {lanes.map((lane) => (
          <div className={`kds-lane lane-${lane.status}`} key={lane.status}>
            {orders
              .filter((order) => order.status === lane.status)
              .map((order) => (
                <KitchenTicket key={order.id} order={order} products={products} lane={lane} onStatus={onStatus} />
              ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function useElapsedMinutes(isoTimestamp?: string): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isoTimestamp) return;
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, [isoTimestamp]);

  if (!isoTimestamp) return null;
  const elapsedMs = now - new Date(isoTimestamp).getTime();
  return Math.max(0, Math.floor(elapsedMs / 60_000));
}

function KitchenTicket({
  order,
  products,
  lane,
  onStatus,
}: {
  order: Order;
  products: Product[];
  lane: { status: OrderStatus; label: string; action?: OrderStatus; button?: string };
  onStatus: (orderId: string, status: OrderStatus) => void;
}) {
  const elapsedMinutes = useElapsedMinutes(order.createdAtRaw);

  return (
    <article className="ticket">
      <header>
        <strong>#{orderDisplayNumber(order)}</strong>
        <span>{orderTableLabel(order)}</span>
        <small>{order.createdAt}</small>
      </header>
      {elapsedMinutes !== null && (
        <span className={`ticket-timer ${elapsedMinutes >= 15 ? "stale" : ""}`}>
          {elapsedMinutes < 1 ? "Recien enviada" : `Hace ${elapsedMinutes} min`}
        </span>
      )}
      <StatusPill status={order.status} />
      <ul>
        {order.items.length === 0 && <li>Orden sin productos registrados</li>}
        {order.items.map((item) => {
          const product = products.find((catalogProduct) => catalogProduct.id === item.productId);
          return (
            <li key={item.productId}>
              {item.quantity} {product?.name ?? item.productName ?? "Producto"}
              {item.notes && <em>Nota: {item.notes}</em>}
            </li>
          );
        })}
      </ul>
      {lane.action && (
        <button onClick={() => onStatus(order.id, lane.action!)}>{lane.button}</button>
      )}
    </article>
  );
}

const RESERVATION_HOURS = Array.from({ length: 11 }, (_, index) => 10 + index);

function reservationStatusLabel(status: ReservationStatus) {
  return { confirmed: "Confirmada", awaited: "En espera", cancelled: "Cancelada", failed: "Fallida" }[status];
}

function ReservationPage({
  tables,
  reservations,
  onCreate,
  onStatusChange,
  onChangeTable,
}: {
  tables: RestaurantTable[];
  reservations: Reservation[];
  onCreate: (input: ReservationInput) => Promise<void>;
  onStatusChange: (reservationId: string, status: ReservationStatus) => Promise<void>;
  onChangeTable: (reservationId: string, tableId: string) => Promise<void>;
}) {
  const floors = useMemo(() => {
    const distinct = Array.from(new Set(tables.map((table) => table.floor ?? 1))).sort((a, b) => a - b);
    return distinct.length ? distinct : [1];
  }, [tables]);
  const [selectedFloor, setSelectedFloor] = useState(floors[0]);
  const [selectedDate, setSelectedDate] = useState(() => toDateInputValue(new Date()));
  const [isCreating, setIsCreating] = useState(false);
  const [activeReservation, setActiveReservation] = useState<Reservation | null>(null);

  const floorOrdinals = ["1st", "2nd", "3rd", "4th", "5th"];
  const rows = tables
    .filter((table) => (table.floor ?? 1) === selectedFloor)
    .sort((a, b) => a.number - b.number);

  function reservationAt(tableId: string, hour: number) {
    return reservations.find(
      (reservation) =>
        reservation.tableId === tableId &&
        reservation.reserveDate === selectedDate &&
        Number(reservation.reservationTime.slice(0, 2)) === hour &&
        reservation.status !== "cancelled",
    );
  }

  return (
    <section className="reservation-page">
      <div className="tabs reservation-floor-tabs">
        {floors.map((floor, index) => (
          <button key={floor} className={floor === selectedFloor ? "selected" : ""} onClick={() => setSelectedFloor(floor)}>
            {floorOrdinals[index] ?? `${index + 1}th`} Floor
          </button>
        ))}
      </div>
      <div className="report-toolbar" style={{ marginBottom: 14 }}>
        <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
        <button className="primary-action" onClick={() => setIsCreating(true)}>
          + Add New Reservation
        </button>
      </div>
      <div className="reservation-grid-wrap">
        <div className="reservation-grid">
          <div className="reservation-grid-header">
            <div />
            {RESERVATION_HOURS.map((hour) => (
              <div key={hour}>{String(hour).padStart(2, "0")}:00</div>
            ))}
          </div>
          {rows.length === 0 && <div className="empty-state">No hay mesas en este piso.</div>}
          {rows.map((table) => (
            <div className="reservation-grid-row" key={table.id}>
              <div className="reservation-grid-row-label">{table.name || `Mesa ${table.number}`}</div>
              {RESERVATION_HOURS.map((hour) => {
                const reservation = reservationAt(table.id, hour);
                return (
                  <div className="reservation-grid-cell" key={hour}>
                    {reservation && (
                      <button
                        type="button"
                        className={`reservation-block ${reservation.status === "confirmed" ? "confirmed" : ""}`}
                        onClick={() => setActiveReservation(reservation)}
                      >
                        <strong>{reservation.fullName}</strong>
                        <span>{reservation.paxNumber} pax</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {isCreating && (
        <AddReservationPanel
          tables={tables}
          defaultDate={selectedDate}
          onClose={() => setIsCreating(false)}
          onSave={async (input) => {
            await onCreate(input);
            setIsCreating(false);
          }}
        />
      )}
      {activeReservation && (
        <ReservationDetailPanel
          reservation={activeReservation}
          tables={tables}
          onClose={() => setActiveReservation(null)}
          onCancel={async () => {
            await onStatusChange(activeReservation.id, "cancelled");
            setActiveReservation(null);
          }}
          onChangeTable={async (tableId) => {
            await onChangeTable(activeReservation.id, tableId);
            setActiveReservation(null);
          }}
        />
      )}
    </section>
  );
}

function AddReservationPanel({
  tables,
  defaultDate,
  onClose,
  onSave,
}: {
  tables: RestaurantTable[];
  defaultDate: string;
  onClose: () => void;
  onSave: (input: ReservationInput) => Promise<void>;
}) {
  const [form, setForm] = useState<ReservationInput>({
    tableId: tables[0]?.id ?? "",
    fullName: "",
    paxNumber: 1,
    reserveDate: defaultDate,
    reservationTime: "12:00",
    title: "Mr",
    phone: "",
    email: "",
    depositFee: 0,
    status: "confirmed",
    paymentMethod: "cash",
  });

  return (
    <SlidePanel title="Add New Reservation" onClose={onClose}>
      <form
        className="entity-form"
        onSubmit={(event) => {
          event.preventDefault();
          void onSave(form);
        }}
      >
        <label>
          Table Number
          <select required value={form.tableId} onChange={(event) => setForm({ ...form, tableId: event.target.value })}>
            {tables.map((table) => (
              <option key={table.id} value={table.id}>
                {table.name || `Mesa ${table.number}`}
              </option>
            ))}
          </select>
        </label>
        <label>
          Pax Number
          <input
            required
            type="number"
            min="1"
            value={form.paxNumber}
            onChange={(event) => setForm({ ...form, paxNumber: Number(event.target.value) })}
          />
        </label>
        <label>
          Reserve Date
          <input
            required
            type="date"
            value={form.reserveDate}
            onChange={(event) => setForm({ ...form, reserveDate: event.target.value })}
          />
        </label>
        <label>
          Reservation Time
          <input
            required
            type="time"
            value={form.reservationTime}
            onChange={(event) => setForm({ ...form, reservationTime: event.target.value })}
          />
        </label>
        <label>
          Deposit Fee
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.depositFee}
            onChange={(event) => setForm({ ...form, depositFee: Number(event.target.value) })}
          />
        </label>
        <label>
          Status
          <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as ReservationStatus })}>
            <option value="confirmed">Confirmed</option>
            <option value="awaited">Awaited</option>
          </select>
        </label>
        <label>
          Full Name
          <input required value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} />
        </label>
        <label>
          Phone Number
          <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
        </label>
        <label>
          Email Address
          <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
        </label>
        <label>
          Payment Method
          <select value={form.paymentMethod} onChange={(event) => setForm({ ...form, paymentMethod: event.target.value })}>
            <option value="cash">Efectivo</option>
            <option value="card">Tarjeta</option>
            <option value="transfer">Transferencia</option>
          </select>
        </label>
        <FormActions onClose={onClose} disabled={!form.tableId || !form.fullName} />
      </form>
    </SlidePanel>
  );
}

function ReservationDetailPanel({
  reservation,
  tables,
  onClose,
  onCancel,
  onChangeTable,
}: {
  reservation: Reservation;
  tables: RestaurantTable[];
  onClose: () => void;
  onCancel: () => Promise<void>;
  onChangeTable: (tableId: string) => Promise<void>;
}) {
  const [newTableId, setNewTableId] = useState("");

  return (
    <SlidePanel title="Reservation Details" onClose={onClose}>
      <div className="reservation-info-grid">
        <div><span>Table</span><strong>{reservation.tableName || `Mesa ${reservation.tableNumber}`}</strong></div>
        <div><span>Pax</span><strong>{reservation.paxNumber} personas</strong></div>
        <div><span>Date</span><strong>{reservation.reserveDate}</strong></div>
        <div><span>Time</span><strong>{reservation.reservationTime.slice(0, 5)}</strong></div>
        <div><span>Deposit</span><strong>{currency.format(reservation.depositFee)}</strong></div>
        <div><span>Status</span><strong>{reservationStatusLabel(reservation.status)}</strong></div>
      </div>
      <div className="reservation-info-grid">
        <div><span>Full Name</span><strong>{reservation.fullName}</strong></div>
        <div><span>Phone</span><strong>{reservation.phone || "-"}</strong></div>
        <div><span>Email</span><strong>{reservation.email || "-"}</strong></div>
        <div><span>Payment Method</span><strong>{reservation.paymentMethod || "-"}</strong></div>
      </div>
      <label>
        Change Table
        <select value={newTableId} onChange={(event) => setNewTableId(event.target.value)}>
          <option value="">Selecciona una mesa</option>
          {tables.filter((table) => table.id !== reservation.tableId).map((table) => (
            <option key={table.id} value={table.id}>
              {table.name || `Mesa ${table.number}`}
            </option>
          ))}
        </select>
      </label>
      <div className="form-actions">
        <button className="link-button" onClick={onCancel}>Cancel Reservation</button>
        <button
          className="primary-button"
          disabled={!newTableId}
          onClick={() => newTableId && void onChangeTable(newTableId)}
        >
          Change Table
        </button>
      </div>
    </SlidePanel>
  );
}

function NotificationsPage({ inventory, onDismiss }: { inventory: InventoryItem[]; onDismiss: (id: string) => void }) {
  const lowStock = inventory.filter((item) => item.stockQuantity <= item.reorderLevel);

  return (
    <section>
      <p className="restaurant-context">
        {lowStock.length === 0 ? "No tienes notificaciones nuevas." : `Tienes ${lowStock.length} alerta(s) de inventario.`}
      </p>
      <div className="notification-list" style={{ marginTop: 14 }}>
        {lowStock.map((item) => (
          <div className="notification-item" key={item.id}>
            <div className="notification-icon">!</div>
            <div>
              <strong>Low Inventory Alert</strong>
              <small>
                {item.productName} esta en {item.stockQuantity} unidades (nivel de reorden: {item.reorderLevel}).
              </small>
            </div>
            <time>{new Date(item.updatedAt).toLocaleDateString("es-DO")}</time>
            <button className="danger-button" onClick={() => onDismiss(item.id)}>Delete</button>
          </div>
        ))}
        {lowStock.length === 0 && <div className="empty-state">Todo el inventario esta en niveles saludables.</div>}
      </div>
    </section>
  );
}

function ProfilePage({
  user,
  staffMembers,
  onSaveProfile,
  onChangeStaffRole,
  onLogout,
}: {
  user: User;
  staffMembers: StaffMember[];
  onSaveProfile: (input: { fullName: string; email?: string; password?: string }) => Promise<void>;
  onChangeStaffRole: (profileId: string, role: Role) => Promise<void>;
  onLogout: () => void;
}) {
  const [tab, setTab] = useState<"profile" | "access">("profile");
  const [fullName, setFullName] = useState(user.fullName);
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState("");
  const [savedMessage, setSavedMessage] = useState("");

  return (
    <div className="profile-layout">
      <nav className="profile-nav">
        <button className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}>
          <AppIcon name="profile" /> My Profile
        </button>
        {user.role === "admin" && (
          <button className={tab === "access" ? "active" : ""} onClick={() => setTab("access")}>
            <AppIcon name="settings" /> Manage Access
          </button>
        )}
        <button onClick={onLogout}>
          <AppIcon name="logout" /> Logout
        </button>
      </nav>
      {tab === "profile" ? (
        <section className="panel">
          <div className="profile-avatar-row">
            <div className="avatar-fallback" style={{ display: "grid", placeItems: "center" }}>{user.fullName.slice(0, 1)}</div>
            <div>
              <h3 style={{ margin: 0 }}>{fullName}</h3>
              <span className="restaurant-context">{user.title}</span>
            </div>
          </div>
          <form
            className="entity-form"
            onSubmit={async (event) => {
              event.preventDefault();
              await onSaveProfile({ fullName, email, password: password || undefined });
              setPassword("");
              setSavedMessage("Perfil actualizado.");
            }}
          >
            <label>
              First Name
              <input required value={fullName} onChange={(event) => setFullName(event.target.value)} />
            </label>
            <label>
              Email
              <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label>
              New Password
              <input type="password" placeholder="Dejar vacio para no cambiar" value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
            <div className="form-actions full-span">
              {savedMessage && <span className="success-text">{savedMessage}</span>}
              <button type="submit" className="primary-button">Save Changes</button>
            </div>
          </form>
        </section>
      ) : (
        <section className="access-list">
          {staffMembers.length === 0 && <div className="empty-state">No hay miembros del equipo registrados.</div>}
          {staffMembers.map((member) => (
            <div className="access-row" key={member.id}>
              <div>
                <strong>{member.fullName}</strong>
                <span className="pill muted">{member.isActive ? "Activo" : "Inactivo"}</span>
              </div>
              <select
                value={member.role}
                onChange={(event) => void onChangeStaffRole(member.id, event.target.value as Role)}
              >
                <option value="admin">Admin</option>
                <option value="waiter">Mesero</option>
                <option value="kitchen">Cocina</option>
                <option value="cashier">Cajero</option>
              </select>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function CashierPage({
  orders,
  products,
  coupons,
  customers,
  settings,
  restaurant,
  onPay,
  onCancelOrder,
  onSaveCustomer,
  onAssignCustomer,
}: {
  orders: Order[];
  products: Product[];
  coupons: Coupon[];
  customers: Customer[];
  settings: BusinessSettings;
  restaurant: RestaurantProfile;
  onPay: (orderId: string, paymentMethod: PaymentMethod, customer?: Customer) => Promise<void>;
  onCancelOrder: (orderId: string, reason: string) => Promise<void>;
  onSaveCustomer: (input: CustomerInput) => Promise<Customer>;
  onAssignCustomer: (orderId: string, customer: Customer) => Promise<void>;
}) {
  const payable = orders.filter((order) => ["ready", "delivered", "new", "preparing"].includes(order.status));
  const [selectedOrderId, setSelectedOrderId] = useState(payable[0]?.id ?? "");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [isCancelOpen, setIsCancelOpen] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [checkoutCustomer, setCheckoutCustomer] = useState<Customer | undefined>();
  const [customerForm, setCustomerForm] = useState<CustomerInput>({
    type: "person",
    fullName: "",
    email: "",
    rnc: "",
    phone: "",
    address: "",
    notes: "",
  });
  const hasCustomerFormInput = Boolean(customerForm.email.trim() || customerForm.phone.trim());
  const selectedOrder = payable.find((order) => order.id === selectedOrderId) ?? payable[0];
  const selectedCustomer = selectedOrder?.customerId
    ? customers.find((customer) => customer.id === selectedOrder.customerId)
    : selectedOrder?.customerEmail
      ? customers.find((customer) => customer.email === selectedOrder.customerEmail)
      : selectedOrder?.customerPhone
        ? customers.find((customer) => customer.phone === selectedOrder.customerPhone)
        : undefined;

  useEffect(() => {
    if (!selectedOrder || selectedCustomer || !selectedOrder.customerPhone) return;
    setCustomerForm((form) =>
      form.phone || form.fullName || form.address
        ? form
        : {
            ...form,
            fullName: selectedOrder.customerDisplayName ?? "",
            phone: selectedOrder.customerPhone ?? "",
            address: selectedOrder.deliveryAddress ?? "",
          },
    );
    // Auto-fills from the data the voice/WhatsApp call already captured, so the
    // cashier never has to re-type a phone number the customer already gave.
  }, [selectedOrder?.id, selectedOrder?.customerPhone, selectedOrder?.customerDisplayName, selectedOrder?.deliveryAddress, selectedCustomer]);
  const totals = selectedOrder
    ? withConfiguredTaxBreakdown(
        selectedOrder.totals ??
          calculateTotals(
            selectedOrder.items,
            coupons.find((coupon) => coupon.code === selectedOrder.couponCode),
            products,
            settings.taxes,
          ),
        settings.taxes,
      )
    : calculateTotals([], undefined, products, settings.taxes);

  function exportInvoicePdf() {
    if (!selectedOrder) return;
    const displayNumber = orderDisplayNumber(selectedOrder);
    downloadInvoicePdf({
      filename: `factura-${displayNumber}.pdf`,
      order: selectedOrder,
      products,
      settings,
      restaurant,
      totals,
      statusLabel: "Pendiente",
    });
  }

  async function printTicket(reservedWindow?: Window | null) {
    if (!selectedOrder) return;
    const result = await printReceipt80mm({
      order: selectedOrder,
      products,
      totals,
      restaurant,
      settings,
      paymentMethod,
    }, reservedWindow);
    if (result.status === "fallback") {
      exportInvoicePdf();
      window.alert(`No se pudo imprimir directamente. Descargamos el PDF del ticket. ${result.reason}`);
    }
  }

  async function saveAndAssignCustomer() {
    if (!selectedOrder || !hasCustomerFormInput) return undefined;
    if (customerForm.type === "company" && !customerForm.rnc.trim()) {
      window.alert("El RNC es obligatorio para clientes empresa.");
      return undefined;
    }
    const customer = await onSaveCustomer(customerForm);
    await onAssignCustomer(selectedOrder.id, customer);
    return customer;
  }

  async function confirmCancelOrder(reason: string) {
    if (!selectedOrder) return;
    setIsCancelling(true);
    try {
      await onCancelOrder(selectedOrder.id, reason);
      setIsCancelOpen(false);
      setSelectedOrderId("");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "No se pudo cancelar la orden.");
    } finally {
      setIsCancelling(false);
    }
  }

  async function sendInvoiceEmail() {
    if (!selectedOrder) return;
    const assignedCustomer = selectedCustomer ?? (hasCustomerFormInput ? await saveAndAssignCustomer() : undefined);
    const customerEmail = assignedCustomer?.email ?? window.prompt("Correo del cliente")?.trim();
    if (!customerEmail) return;
    try {
      await sendInvoiceEmailViaResend(
        buildInvoiceEmailPayload({
          to: customerEmail,
          order: assignedCustomer
            ? {
                ...selectedOrder,
                customerId: assignedCustomer.id,
                customerName: assignedCustomer.fullName,
                customerEmail: assignedCustomer.email,
                customerRnc: assignedCustomer.rnc,
              }
            : selectedOrder,
          products,
          settings,
          restaurant,
          totals,
        }),
      );
      window.alert("Factura enviada por correo.");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "No se pudo enviar la factura por correo.");
    }
  }

  return (
    <section className="cashier-layout">
      <div className="panel">
        <PanelHeader title="Facturas pendientes" />
        <div className="invoice-list">
          {payable.map((order) => (
            <button
              className={order.id === selectedOrder?.id ? "selected" : ""}
              key={order.id}
              onClick={() => setSelectedOrderId(order.id)}
            >
              <strong>{orderTableLabel(order)}</strong>
              <span>Orden #{orderDisplayNumber(order)}</span>
              <small>
                {currency.format(
                  (order.totals ?? calculateTotals(
                    order.items,
                    coupons.find((coupon) => coupon.code === order.couponCode),
                    products,
                    settings.taxes,
                  )).total,
                )}
              </small>
            </button>
          ))}
        </div>
      </div>
      <div className="panel receipt-panel">
        <PanelHeader title="Cobro" action={selectedOrder ? `#${orderDisplayNumber(selectedOrder)}` : undefined} />
        {selectedOrder ? (
          <>
            <div className="receipt-lines">
              {selectedOrder.items.map((item) => {
                const product = products.find((catalogProduct) => catalogProduct.id === item.productId);
                return (
                  <div key={item.productId}>
                    <span>
                      {item.quantity} x {product?.name ?? item.productName ?? "Producto"}
                    </span>
                    <strong>{currency.format((item.unitPrice ?? product?.price ?? 0) * item.quantity)}</strong>
                  </div>
                );
              })}
            </div>
            <TotalsBlock totals={totals} />
            <div className="customer-box">
              <strong>Cliente</strong>
              <select
                value={selectedCustomer?.id ?? ""}
                onChange={(event) => {
                  const customer = customers.find((item) => item.id === event.target.value);
                  if (customer) void onAssignCustomer(selectedOrder.id, customer);
                }}
              >
                <option value="">Consumidor final</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.fullName} - {customer.email || customer.phone || "sin contacto"}
                  </option>
                ))}
              </select>
              {selectedCustomer && (selectedCustomer.phone || selectedCustomer.address) && (
                <small className="customer-captured-info">
                  {selectedCustomer.phone && <>Tel: {selectedCustomer.phone} </>}
                  {selectedCustomer.address && <>· Direccion: {selectedCustomer.address}</>}
                </small>
              )}
              {!selectedCustomer && selectedOrder.customerPhone && (
                <small className="customer-captured-info">
                  Capturado de la llamada: {selectedOrder.customerPhone}
                  {selectedOrder.deliveryAddress && <> · {selectedOrder.deliveryAddress}</>}
                </small>
              )}
              <div className="segmented-control">
                <button
                  type="button"
                  className={customerForm.type === "person" ? "selected" : ""}
                  onClick={() => setCustomerForm({ ...customerForm, type: "person", rnc: "" })}
                >
                  Persona
                </button>
                <button
                  type="button"
                  className={customerForm.type === "company" ? "selected" : ""}
                  onClick={() => setCustomerForm({ ...customerForm, type: "company" })}
                >
                  Empresa
                </button>
              </div>
              <div className="customer-form-row">
                <input
                  placeholder={customerForm.type === "company" ? "Nombre o razon social" : "Nombre"}
                  value={customerForm.fullName}
                  onChange={(event) => setCustomerForm({ ...customerForm, fullName: event.target.value })}
                />
                <input
                  placeholder="Correo"
                  type="email"
                  value={customerForm.email}
                  onChange={(event) => setCustomerForm({ ...customerForm, email: event.target.value })}
                />
                <input
                  placeholder="Telefono"
                  type="tel"
                  value={customerForm.phone}
                  onChange={(event) => setCustomerForm({ ...customerForm, phone: event.target.value })}
                />
                <input
                  placeholder="Direccion"
                  value={customerForm.address}
                  onChange={(event) => setCustomerForm({ ...customerForm, address: event.target.value })}
                />
                {customerForm.type === "company" && (
                  <input
                    placeholder="RNC"
                    value={customerForm.rnc}
                    onChange={(event) => setCustomerForm({ ...customerForm, rnc: event.target.value })}
                  />
                )}
                <button className="secondary-button" type="button" onClick={() => void saveAndAssignCustomer()}>
                  Guardar cliente
                </button>
              </div>
            </div>
            <div className="payment-methods">
              <button
                className={paymentMethod === "cash" ? "selected" : ""}
                onClick={() => setPaymentMethod("cash")}
              >
                Efectivo
              </button>
              <button
                className={paymentMethod === "card" ? "selected" : ""}
                onClick={() => setPaymentMethod("card")}
              >
                Tarjeta
              </button>
              <button
                className={paymentMethod === "transfer" ? "selected" : ""}
                onClick={() => setPaymentMethod("transfer")}
              >
                Transferencia
              </button>
              <button
                className={paymentMethod === "mixed" ? "selected" : ""}
                onClick={() => setPaymentMethod("mixed")}
              >
                Mixto
              </button>
            </div>
            <div className="order-actions">
              <button className="secondary-button" onClick={() => void printTicket()}>
                Imprimir ticket
              </button>
              <button className="secondary-button" onClick={exportInvoicePdf}>
                Exportar PDF
              </button>
              <button
                className="secondary-button"
                onClick={() => void sendInvoiceEmail()}
              >
                Enviar email
              </button>
              <button className="danger-button" type="button" onClick={() => setIsCancelOpen(true)}>
                Cancelar orden
              </button>
              <button
                className="success-button"
                onClick={async () => {
                  const customer = selectedCustomer ?? (hasCustomerFormInput ? await saveAndAssignCustomer() : undefined);
                  if (hasCustomerFormInput && !customer) return;
                  setCheckoutCustomer(customer);
                  setIsPaymentOpen(true);
                }}
              >
                Revisar y cobrar
              </button>
            </div>
          </>
        ) : (
          <div className="empty-state">No hay facturas pendientes.</div>
        )}
      </div>
      {isPaymentOpen && selectedOrder && (
        <PaymentConfirmationModal
          order={selectedOrder}
          paymentMethod={paymentMethod}
          totals={totals}
          customer={checkoutCustomer}
          printerMode={settings.printerMode}
          onClose={() => setIsPaymentOpen(false)}
          onConfirm={async (shouldPrint, reservedWindow) => {
            await onPay(selectedOrder.id, paymentMethod, checkoutCustomer);
            if (shouldPrint) await printTicket(reservedWindow);
            setIsPaymentOpen(false);
          }}
        />
      )}
      {isCancelOpen && selectedOrder && (
        <CancelOrderModal
          order={selectedOrder}
          isSubmitting={isCancelling}
          onClose={() => setIsCancelOpen(false)}
          onConfirm={confirmCancelOrder}
        />
      )}
    </section>
  );
}

function CancelOrderModal({
  order,
  isSubmitting,
  onClose,
  onConfirm,
}: {
  order: Order;
  isSubmitting: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");

  return (
    <Modal title={`Cancelar orden #${orderDisplayNumber(order)}`} onClose={onClose} className="cancel-order-modal">
      <form
        className="cancel-order-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (reason.trim()) void onConfirm(reason.trim());
        }}
      >
        <p>Esta accion no se puede deshacer. La mesa quedara disponible nuevamente.</p>
        <label htmlFor="cancel-reason">Motivo de la cancelacion</label>
        <textarea
          id="cancel-reason"
          required
          autoFocus
          rows={3}
          placeholder="Ej. El cliente cambio de opinion, error al tomar el pedido..."
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <div className="form-actions full-span">
          <button type="button" className="secondary-button" onClick={onClose}>
            Volver
          </button>
          <button type="submit" className="danger-button" disabled={isSubmitting || !reason.trim()}>
            {isSubmitting ? "Cancelando..." : "Confirmar cancelacion"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function OrderHistoryPage({
  orders,
  products,
  coupons,
  settings,
  restaurant,
}: {
  orders: Order[];
  products: Product[];
  coupons: Coupon[];
  settings: BusinessSettings;
  restaurant: RestaurantProfile;
}) {
  const [statusFilter, setStatusFilter] = useState<"all" | OrderStatus>("all");
  const [search, setSearch] = useState("");
  const filteredOrders = orders
    .filter((order) => statusFilter === "all" || order.status === statusFilter)
    .filter((order) => {
      const term = search.trim().toLowerCase();
      if (!term) return true;
      return (
        order.id.toLowerCase().includes(term) ||
        (order.orderNumber?.toLowerCase().includes(term) ?? false) ||
        String(order.tableNumber).includes(term) ||
        order.waiter.toLowerCase().includes(term)
      );
    })
    .slice(0, 80);

  function orderTotals(order: Order) {
    return withConfiguredTaxBreakdown(
      order.totals ??
        calculateTotals(
          order.items,
          coupons.find((coupon) => coupon.code === order.couponCode),
          products,
          settings.taxes,
        ),
      settings.taxes,
    );
  }

  function exportOrderPdf(order: Order) {
    const totals = orderTotals(order);
    const displayNumber = orderDisplayNumber(order);
    downloadInvoicePdf({
      filename: `factura-${displayNumber}.pdf`,
      order,
      products,
      settings,
      restaurant,
      totals,
      statusLabel: `${orderLabels[order.status]} - ${
        order.paymentMethod ? paymentMethodLabels[order.paymentMethod] : "Pendiente"
      }`,
    });
  }

  async function emailOrder(order: Order) {
    const customerEmail = window.prompt("Correo del cliente")?.trim();
    if (!customerEmail) return;
    const totals = orderTotals(order);
    try {
      await sendInvoiceEmailViaResend(
        buildInvoiceEmailPayload({
          to: customerEmail,
          order,
          products,
          settings,
          restaurant,
          totals,
        }),
      );
      window.alert("Factura enviada por correo.");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "No se pudo enviar la factura por correo.");
    }
  }

  return (
    <section className="panel page-panel">
      <PanelHeader title="Ultimas ordenes" />
      <div className="history-toolbar">
        <input
          className="search"
          placeholder="Buscar por orden, mesa o mesero"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | OrderStatus)}>
          <option value="all">Todos los estados</option>
          <option value="paid">Pagadas</option>
          <option value="new">Nuevas</option>
          <option value="preparing">En preparacion</option>
          <option value="ready">Listas</option>
          <option value="delivered">Entregadas</option>
        </select>
      </div>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Orden</th>
              <th>Fecha</th>
              <th>Mesa</th>
              <th>Mesero</th>
              <th>Estado</th>
              <th>Metodo</th>
              <th>Total</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filteredOrders.map((order) => {
              const totals = orderTotals(order);
              return (
                <tr key={order.id}>
                  <td>#{orderDisplayNumber(order)}</td>
                  <td>{order.businessDate}</td>
                  <td>{orderTableLabel(order)}</td>
                  <td>{order.waiter}</td>
                  <td>
                    <StatusPill status={order.status} />
                  </td>
                  <td>{order.paymentMethod ? paymentMethodLabels[order.paymentMethod] : "Pendiente"}</td>
                  <td>{currency.format(totals.total)}</td>
                  <td>
                    <div className="table-actions">
                      <button title="Exportar PDF" onClick={() => exportOrderPdf(order)}>
                        <AppIcon name="print" />
                      </button>
                      <button title="Enviar email" onClick={() => void emailOrder(order)}>
                        <AppIcon name="email" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {filteredOrders.length === 0 && <div className="empty-state">No hay ordenes para estos filtros.</div>}
    </section>
  );
}

type InventoryStatusFilter = "all" | "active" | "inactive" | "low_stock";

function InventoryPage({
  inventory,
  products,
  categories,
  onSave,
}: {
  inventory: InventoryItem[];
  products: Product[];
  categories: Category[];
  onSave: (input: InventoryInput) => Promise<void>;
}) {
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [statusFilter, setStatusFilter] = useState<InventoryStatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [saleUnitFilter, setSaleUnitFilter] = useState("all");
  const [minQuantity, setMinQuantity] = useState("");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");

  const stockValue = inventory.reduce((sum, item) => sum + item.stockQuantity * item.unitCost, 0);
  const productById = new Map(products.map((product) => [product.id, product]));
  const enriched = inventory.map((item) => ({ item, product: productById.get(item.productId) }));
  const lowStockCount = inventory.filter((item) => item.stockQuantity <= item.reorderLevel).length;
  const activeCount = enriched.filter(({ product }) => product?.available).length;
  const inactiveCount = enriched.filter(({ product }) => product && !product.available).length;

  function resetFilters() {
    setStatusFilter("all");
    setCategoryFilter("all");
    setSaleUnitFilter("all");
    setMinQuantity("");
    setPriceMin("");
    setPriceMax("");
  }

  const filtered = enriched.filter(({ item, product }) => {
    if (statusFilter === "active" && !product?.available) return false;
    if (statusFilter === "inactive" && product?.available) return false;
    if (statusFilter === "low_stock" && item.stockQuantity > item.reorderLevel) return false;
    if (categoryFilter !== "all" && product?.categoryId !== categoryFilter) return false;
    if (saleUnitFilter !== "all" && (product?.saleUnit ?? "unit") !== saleUnitFilter) return false;
    if (minQuantity && item.stockQuantity < Number(minQuantity)) return false;
    if (priceMin && item.unitCost < Number(priceMin)) return false;
    if (priceMax && item.unitCost > Number(priceMax)) return false;
    return true;
  });

  return (
    <>
      <div className="page-grid">
        <MetricCard label="Valor inventario" value={currency.format(stockValue)} tone="green" />
        <MetricCard label="Productos con stock" value={String(inventory.length)} tone="blue" />
        <MetricCard label="Bajo reorden" value={String(lowStockCount)} tone="orange" />
        <MetricCard label="Catalogo activo" value={String(products.filter((product) => product.available).length)} tone="purple" />
      </div>
      <div className="inventory-layout">
        <aside className="panel inventory-filters">
          <h3>Estado del producto</h3>
          <div className="inventory-status-grid">
            <button className={statusFilter === "all" ? "selected" : ""} onClick={() => setStatusFilter("all")}>
              <span>Todos</span>
              <strong>{inventory.length}</strong>
            </button>
            <button className={statusFilter === "active" ? "selected" : ""} onClick={() => setStatusFilter("active")}>
              <span>Activos</span>
              <strong>{activeCount}</strong>
            </button>
            <button className={statusFilter === "inactive" ? "selected" : ""} onClick={() => setStatusFilter("inactive")}>
              <span>Inactivos</span>
              <strong>{inactiveCount}</strong>
            </button>
            <button className={statusFilter === "low_stock" ? "selected" : ""} onClick={() => setStatusFilter("low_stock")}>
              <span>Bajo stock</span>
              <strong>{lowStockCount}</strong>
            </button>
          </div>
          <label>
            Categoria
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <option value="all">Todas</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </label>
          <label>
            Unidad de venta
            <select value={saleUnitFilter} onChange={(event) => setSaleUnitFilter(event.target.value)}>
              <option value="all">Todas</option>
              <option value="unit">Por unidad</option>
              <option value="lb">Por libra</option>
            </select>
          </label>
          <label>
            Cantidad minima en stock
            <input type="number" min="0" placeholder="0" value={minQuantity} onChange={(event) => setMinQuantity(event.target.value)} />
          </label>
          <div className="inventory-price-range">
            <label>
              Costo minimo
              <input type="number" min="0" placeholder="0" value={priceMin} onChange={(event) => setPriceMin(event.target.value)} />
            </label>
            <label>
              Costo maximo
              <input type="number" min="0" placeholder="0" value={priceMax} onChange={(event) => setPriceMax(event.target.value)} />
            </label>
          </div>
          <button className="secondary-button full-width" onClick={resetFilters}>Reset Filters</button>
        </aside>
        <div className="inventory-table-wrap">
          <AdminTable
            title="Inventario de productos"
            action="+ Ajustar producto"
            onAction={() => setIsCreating(true)}
            headers={["Producto", "Stock", "Reorden", "Costo", "Valor", "Proveedor", "Estado", "Acciones"]}
            rows={filtered.map(({ item, product }) => {
              const saleUnit = product?.saleUnit;
              const unitLabel = saleUnit === "lb" ? " lb" : " uds";
              return [
                item.productName,
                `${item.stockQuantity.toFixed(saleUnit === "lb" ? 3 : 0)}${unitLabel}`,
                `${item.reorderLevel.toFixed(saleUnit === "lb" ? 3 : 0)}${unitLabel}`,
                currency.format(item.unitCost),
                currency.format(item.stockQuantity * item.unitCost),
                item.supplierName || "-",
                <span className={item.stockQuantity <= item.reorderLevel ? "pill orange" : "pill green"}>
                  {item.stockQuantity <= item.reorderLevel ? "Reponer" : "Disponible"}
                </span>,
                <ActionButtons onEdit={() => setEditingItem(item)} />,
              ];
            })}
          />
        </div>
      </div>
      {(isCreating || editingItem) && (
        <InventoryFormModal
          item={editingItem}
          products={products}
          onClose={() => {
            setIsCreating(false);
            setEditingItem(null);
          }}
          onSave={async (input) => {
            await onSave(input);
            setIsCreating(false);
            setEditingItem(null);
          }}
        />
      )}
    </>
  );
}

function FinancePage({
  expenses,
  employeePayments,
  onCreateExpense,
  onDeleteExpense,
  onCreateEmployeePayment,
  onDeleteEmployeePayment,
}: {
  expenses: BusinessExpense[];
  employeePayments: EmployeePayment[];
  onCreateExpense: (input: ExpenseInput) => Promise<void>;
  onDeleteExpense: (expenseId: string) => Promise<void>;
  onCreateEmployeePayment: (input: EmployeePaymentInput) => Promise<void>;
  onDeleteEmployeePayment: (paymentId: string) => Promise<void>;
}) {
  const [isCreatingExpense, setIsCreatingExpense] = useState(false);
  const [isCreatingPayment, setIsCreatingPayment] = useState(false);
  const expenseTotal = expenses.filter((expense) => expense.type !== "payroll").reduce((sum, expense) => sum + expense.amount, 0);
  const payrollTotal =
    employeePayments.reduce((sum, payment) => sum + payment.amount, 0) +
    expenses.filter((expense) => expense.type === "payroll").reduce((sum, expense) => sum + expense.amount, 0);

  return (
    <>
      <div className="page-grid">
        <MetricCard label="Gastos" value={currency.format(expenseTotal)} tone="orange" />
        <MetricCard label="Nomina" value={currency.format(payrollTotal)} tone="purple" />
        <MetricCard label="Salidas totales" value={currency.format(expenseTotal + payrollTotal)} tone="blue" />
        <MetricCard label="Registros" value={String(expenses.length + employeePayments.length)} tone="green" />
      </div>
      <AdminTable
        title="Gastos del negocio"
        action="+ Nuevo gasto"
        onAction={() => setIsCreatingExpense(true)}
        headers={["Fecha", "Categoria", "Tipo", "Descripcion", "Metodo", "Proveedor", "Monto", "Acciones"]}
        rows={expenses.map((expense) => [
          expense.expenseDate,
          expense.category,
          expenseTypeLabels[expense.type],
          expense.description,
          paymentMethodLabels[expense.paymentMethod],
          expense.vendor || "-",
          currency.format(expense.amount),
          <ActionButtons onDelete={() => void onDeleteExpense(expense.id)} />,
        ])}
      />
      <AdminTable
        title="Pagos a empleados"
        action="+ Nuevo pago"
        onAction={() => setIsCreatingPayment(true)}
        headers={["Fecha", "Empleado", "Puesto", "Metodo", "Notas", "Monto", "Acciones"]}
        rows={employeePayments.map((payment) => [
          payment.paymentDate,
          payment.employeeName,
          payment.role || "-",
          payrollPaymentMethodLabels[payment.paymentMethod],
          payment.notes || "-",
          currency.format(payment.amount),
          <ActionButtons onDelete={() => void onDeleteEmployeePayment(payment.id)} />,
        ])}
      />
      {isCreatingExpense && (
        <ExpenseFormModal
          onClose={() => setIsCreatingExpense(false)}
          onSave={async (input) => {
            await onCreateExpense(input);
            setIsCreatingExpense(false);
          }}
        />
      )}
      {isCreatingPayment && (
        <EmployeePaymentFormModal
          onClose={() => setIsCreatingPayment(false)}
          onSave={async (input) => {
            await onCreateEmployeePayment(input);
            setIsCreatingPayment(false);
          }}
        />
      )}
    </>
  );
}

function CategoriesPage({
  categories,
  onSave,
  onDelete,
}: {
  categories: Category[];
  onSave: (input: CategoryInput, categoryId?: string) => Promise<void>;
  onDelete: (categoryId: string) => Promise<void>;
}) {
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  return (
    <>
      <AdminTable
        title="Categorias"
        action="+ Nueva Categoria"
        onAction={() => setIsCreating(true)}
        headers={["Imagen", "Nombre", "Descripcion", "Estado", "Acciones"]}
        rows={categories.map((category) => [
          <img className="thumb" src={category.imageUrl} alt={category.name} />,
          category.name,
          category.description,
          <span className="pill green">Activa</span>,
          <ActionButtons
            onEdit={() => setEditingCategory(category)}
            onDelete={() => void onDelete(category.id)}
          />,
        ])}
      />
      {(isCreating || editingCategory) && (
        <CategoryFormModal
          category={editingCategory}
          onClose={() => {
            setIsCreating(false);
            setEditingCategory(null);
          }}
          onSave={async (input) => {
            await onSave(input, editingCategory?.id);
            setIsCreating(false);
            setEditingCategory(null);
          }}
        />
      )}
    </>
  );
}

function ProductsPage({
  products,
  categories,
  onSave,
  onDelete,
}: {
  products: Product[];
  categories: Category[];
  onSave: (input: ProductInput, productId?: string, imageFile?: File | null) => Promise<void>;
  onDelete: (productId: string) => Promise<void>;
}) {
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  return (
    <>
      <AdminTable
        title="Productos"
        action="+ Nuevo Producto"
        onAction={() => setIsCreating(true)}
        headers={["Imagen", "Nombre", "Categoria", "Venta", "Precio", "Estado", "Acciones"]}
        rows={products.map((product) => [
          product.imageUrl ? <img className="thumb" src={product.imageUrl} alt={product.name} loading="lazy" decoding="async" /> : <span className="thumb placeholder-thumb">Foto</span>,
          product.name,
          categories.find((category) => category.id === product.categoryId)?.name ?? "",
          product.saleUnit === "lb" ? "Por libra" : "Por unidad",
          `${currency.format(product.price)}${product.saleUnit === "lb" ? " / lb" : ""}`,
          <span className={product.available ? "pill green" : "pill muted"}>
            {product.available ? "Disponible" : "No disponible"}
          </span>,
          <ActionButtons
            onEdit={() => setEditingProduct(product)}
            onDelete={() => void onDelete(product.id)}
          />,
        ])}
      />
      {(isCreating || editingProduct) && (
        <ProductFormModal
          product={editingProduct}
          categories={categories}
          onClose={() => {
            setIsCreating(false);
            setEditingProduct(null);
          }}
          onSave={async (input, imageFile) => {
            await onSave(input, editingProduct?.id, imageFile);
            setIsCreating(false);
            setEditingProduct(null);
          }}
        />
      )}
    </>
  );
}

function CouponsPage({
  coupons,
  onSave,
  onDelete,
}: {
  coupons: Coupon[];
  onSave: (input: CouponInput, couponId?: string) => Promise<void>;
  onDelete: (couponId: string) => Promise<void>;
}) {
  const [editingCoupon, setEditingCoupon] = useState<Coupon | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  return (
    <>
      <AdminTable
        title="Cupones / Descuentos"
        action="+ Nuevo Cupon"
        onAction={() => setIsCreating(true)}
        headers={["Codigo", "Nombre", "Tipo", "Valor", "Aplica a", "Estado", "Vigencia", "Acciones"]}
        rows={coupons.map((coupon) => [
          coupon.code,
          coupon.name,
          coupon.type === "percentage" ? "Porcentaje" : "Monto fijo",
          coupon.type === "percentage" ? `${coupon.value}%` : currency.format(coupon.value),
          coupon.appliesTo,
          <span className={coupon.active ? "pill green" : "pill muted"}>
            {coupon.active ? "Activo" : "Inactivo"}
          </span>,
          coupon.validity,
          <ActionButtons
            onEdit={() => setEditingCoupon(coupon)}
            onDelete={() => void onDelete(coupon.id)}
          />,
        ])}
      />
      {(isCreating || editingCoupon) && (
        <CouponFormModal
          coupon={editingCoupon}
          onClose={() => {
            setIsCreating(false);
            setEditingCoupon(null);
          }}
          onSave={async (input) => {
            await onSave(input, editingCoupon?.id);
            setIsCreating(false);
            setEditingCoupon(null);
          }}
        />
      )}
    </>
  );
}

function InventoryFormModal({
  item,
  products,
  onClose,
  onSave,
}: {
  item: InventoryItem | null;
  products: Product[];
  onClose: () => void;
  onSave: (input: InventoryInput) => Promise<void>;
}) {
  const [form, setForm] = useState<InventoryInput>({
    productId: item?.productId ?? products[0]?.id ?? "",
    stockQuantity: item?.stockQuantity ?? 0,
    reorderLevel: item?.reorderLevel ?? 0,
    unitCost: item?.unitCost ?? 0,
    supplierName: item?.supplierName ?? "",
  });
  const selectedProduct = products.find((product) => product.id === form.productId);
  const quantityStep = selectedProduct?.saleUnit === "lb" ? "0.001" : "1";

  return (
    <SlidePanel title={item ? "Ajustar Inventario" : "Registrar Inventario"} onClose={onClose}>
      <form className="entity-form" onSubmit={(event) => {
        event.preventDefault();
        void onSave(form);
      }}>
        <label className="full-span">
          Producto
          <select required value={form.productId} onChange={(event) => setForm({ ...form, productId: event.target.value })}>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {selectedProduct?.saleUnit === "lb" ? "Stock actual (lb)" : "Stock actual (unidades)"}
          <input
            required
            type="number"
            min="0"
            step={quantityStep}
            value={form.stockQuantity}
            onChange={(event) => setForm({ ...form, stockQuantity: Number(event.target.value) })}
          />
        </label>
        <label>
          {selectedProduct?.saleUnit === "lb" ? "Nivel reorden (lb)" : "Nivel reorden (unidades)"}
          <input
            required
            type="number"
            min="0"
            step={quantityStep}
            value={form.reorderLevel}
            onChange={(event) => setForm({ ...form, reorderLevel: Number(event.target.value) })}
          />
        </label>
        <label>
          Costo unitario
          <input
            required
            type="number"
            min="0"
            step="0.01"
            value={form.unitCost}
            onChange={(event) => setForm({ ...form, unitCost: Number(event.target.value) })}
          />
        </label>
        <label>
          Proveedor
          <input value={form.supplierName} onChange={(event) => setForm({ ...form, supplierName: event.target.value })} />
        </label>
        <FormActions onClose={onClose} disabled={!form.productId} />
      </form>
    </SlidePanel>
  );
}

function CustomersPage({
  customers,
  orders,
  products,
}: {
  customers: Customer[];
  orders: Order[];
  products: Product[];
}) {
  const [selectedCustomerId, setSelectedCustomerId] = useState(customers[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const filteredCustomers = useMemo(() => customers.filter((customer) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return (
      customer.fullName.toLowerCase().includes(term) ||
      customer.email.toLowerCase().includes(term) ||
      customer.phone.toLowerCase().includes(term) ||
      customer.address.toLowerCase().includes(term) ||
      customer.rnc.toLowerCase().includes(term)
    );
  }), [customers, search]);
  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId) ?? filteredCustomers[0] ?? customers[0];
  const customerOrders = selectedCustomer
    ? orders.filter(
        (order) =>
          order.customerId === selectedCustomer.id ||
          (Boolean(selectedCustomer.email) && order.customerEmail?.toLowerCase() === selectedCustomer.email.toLowerCase()) ||
          (Boolean(selectedCustomer.phone) && order.customerPhone === selectedCustomer.phone),
      )
    : [];
  const totalSpent = customerOrders
    .filter((order) => order.status === "paid")
    .reduce((sum, order) => sum + (order.totals?.total ?? calculateTotals(order.items, undefined, products).total), 0);

  return (
    <section className="customers-layout">
      <div className="panel customer-directory">
        <PanelHeader title="Clientes registrados" />
        <input
          className="search"
          placeholder="Buscar por nombre, correo o RNC"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="customer-card-list">
          {filteredCustomers.map((customer) => {
            const matchesCustomer = (order: Order) =>
              order.customerId === customer.id ||
              (Boolean(customer.email) && order.customerEmail?.toLowerCase() === customer.email.toLowerCase()) ||
              (Boolean(customer.phone) && order.customerPhone === customer.phone);
            const customerOrderCount = orders.filter(matchesCustomer).length;
            const spent = orders
              .filter((order) => order.status === "paid")
              .filter(matchesCustomer)
              .reduce((sum, order) => sum + (order.totals?.total ?? calculateTotals(order.items, undefined, products).total), 0);
            return (
              <button
                className={`customer-card ${selectedCustomer?.id === customer.id ? "selected" : ""}`}
                key={customer.id}
                onClick={() => setSelectedCustomerId(customer.id)}
              >
                <div>
                  <strong>{customer.fullName}</strong>
                  <span>{customer.email || customer.phone}</span>
                  {customer.address && <small>{customer.address}</small>}
                  {customer.rnc && <small>RNC {customer.rnc}</small>}
                </div>
                <div>
                  <span className="pill muted">{customer.type === "company" ? "Empresa" : "Persona"}</span>
                  <small>{customerOrderCount} ordenes</small>
                  <strong>{currency.format(spent)}</strong>
                </div>
              </button>
            );
          })}
        </div>
        {filteredCustomers.length === 0 && <div className="empty-state">No hay clientes para esa busqueda.</div>}
      </div>
      <div className="panel">
        <PanelHeader title={selectedCustomer ? `Historial de ${selectedCustomer.fullName}` : "Historial de cliente"} />
        {selectedCustomer ? (
          <>
            <div className="customer-summary">
              <strong>{selectedCustomer.email || selectedCustomer.phone || "Sin contacto"}</strong>
              {selectedCustomer.phone && <span>Tel: {selectedCustomer.phone}</span>}
              {selectedCustomer.address && <span>{selectedCustomer.address}</span>}
              <span>{customerOrders.length} ordenes</span>
              <span>{currency.format(totalSpent)} gastado</span>
            </div>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Orden</th>
                    <th>Fecha</th>
                    <th>Estado</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {customerOrders.map((order) => (
                    <tr key={order.id}>
                      <td>#{orderDisplayNumber(order)}</td>
                      <td>{order.businessDate}</td>
                      <td>{orderLabels[order.status]}</td>
                      <td>{currency.format(order.totals?.total ?? calculateTotals(order.items, undefined, products).total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="empty-state">Todavia no hay clientes registrados.</div>
        )}
      </div>
    </section>
  );
}

function PaymentConfirmationModal({
  order,
  paymentMethod,
  totals,
  customer,
  printerMode,
  onClose,
  onConfirm,
}: {
  order: Order;
  paymentMethod: PaymentMethod;
  totals: Totals;
  customer?: Customer;
  printerMode: "system" | "bridge";
  onClose: () => void;
  onConfirm: (shouldPrint: boolean, reservedWindow?: Window | null) => Promise<void>;
}) {
  const [receivedAmount, setReceivedAmount] = useState(() => totals.total.toFixed(2));
  const [isConfirming, setIsConfirming] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [shouldPrint, setShouldPrint] = useState(true);
  const received = Number(receivedAmount) || 0;
  const change = Math.max(0, received - totals.total);
  const hasEnoughCash = paymentMethod !== "cash" || received >= totals.total;
  const suggestedAmounts = Array.from(
    new Set([
      Number(totals.total.toFixed(2)),
      Math.ceil(totals.total / 100) * 100,
      Math.ceil(totals.total / 500) * 500,
    ]),
  ).filter((amount) => amount >= totals.total);

  return (
    <Modal title="Confirmar cobro" onClose={onClose} className="payment-modal">
      <div className="payment-review">
        <div className="payment-review-meta">
          <div>
            <span>Orden</span>
            <strong>#{orderDisplayNumber(order)} · {orderTableLabel(order)}</strong>
          </div>
          <div>
            <span>Cliente</span>
            <strong>{customer?.fullName ?? "Consumidor final"}</strong>
          </div>
          <div>
            <span>Metodo</span>
            <strong>{paymentMethodLabels[paymentMethod]}</strong>
          </div>
        </div>

        <div className="payment-total" aria-label={`Total a cobrar ${currency.format(totals.total)}`}>
          <span>Total a cobrar</span>
          <strong>{currency.format(totals.total)}</strong>
        </div>

        {paymentMethod === "cash" && (
          <div className="cash-calculator">
            <label htmlFor="received-amount">Monto recibido</label>
            <div className="money-input">
              <span>{settingsCurrencySymbol()}</span>
              <input
                id="received-amount"
                autoFocus
                inputMode="decimal"
                min={totals.total}
                step="0.01"
                type="number"
                value={receivedAmount}
                onChange={(event) => setReceivedAmount(event.target.value)}
              />
            </div>
            <div className="cash-suggestions" aria-label="Montos sugeridos">
              {suggestedAmounts.map((amount) => (
                <button type="button" key={amount} onClick={() => setReceivedAmount(amount.toFixed(2))}>
                  {currency.format(amount)}
                </button>
              ))}
            </div>
            <div className={`change-due ${hasEnoughCash ? "" : "insufficient"}`} aria-live="polite">
              <span>{hasEnoughCash ? "Devolucion al cliente" : "Monto pendiente"}</span>
              <strong>{currency.format(hasEnoughCash ? change : totals.total - received)}</strong>
            </div>
          </div>
        )}

        <p className="payment-note">Al confirmar, la orden quedara pagada y la mesa volvera a estar disponible.</p>
        <label className="print-choice">
          <input type="checkbox" checked={shouldPrint} onChange={(event) => setShouldPrint(event.target.checked)} />
          <span>
            <strong>Imprimir ticket de 80 mm</strong>
            Usa la impresora configurada; si no responde, descarga el PDF.
          </span>
        </label>
        {paymentError && <p className="error-text" role="alert">{paymentError}</p>}
        <div className="form-actions payment-actions">
          <button type="button" className="secondary-button" onClick={onClose} disabled={isConfirming}>
            Volver
          </button>
          <button
            type="button"
            className="success-button"
            disabled={!hasEnoughCash || isConfirming}
            onClick={async () => {
              const reservedWindow = shouldPrint && printerMode === "system" ? reserveReceiptPrintWindow() : undefined;
              setIsConfirming(true);
              setPaymentError("");
              try {
                await onConfirm(shouldPrint, reservedWindow);
              } catch (error) {
                reservedWindow?.close();
                setPaymentError(error instanceof Error ? error.message : "No se pudo confirmar el cobro.");
              } finally {
                setIsConfirming(false);
              }
            }}
          >
            {isConfirming ? "Procesando..." : `Confirmar ${currency.format(totals.total)}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function settingsCurrencySymbol() {
  try {
    return (
      new Intl.NumberFormat(activeBusinessSettings.currencyLocale || "es-DO", {
        style: "currency",
        currency: activeBusinessSettings.currencyCode || "DOP",
      })
        .formatToParts(0)
        .find((part) => part.type === "currency")?.value ?? "$"
    );
  } catch {
    return "$";
  }
}

function ExpenseFormModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (input: ExpenseInput) => Promise<void>;
}) {
  const [form, setForm] = useState<ExpenseInput>({
    expenseDate: toDateInputValue(new Date()),
    category: "",
    type: "operating",
    description: "",
    amount: 0,
    paymentMethod: "cash",
    vendor: "",
  });

  return (
    <Modal title="Nuevo Gasto" onClose={onClose}>
      <form className="entity-form two-columns" onSubmit={(event) => {
        event.preventDefault();
        void onSave(form);
      }}>
        <label>
          Fecha
          <input required type="date" value={form.expenseDate} onChange={(event) => setForm({ ...form, expenseDate: event.target.value })} />
        </label>
        <label>
          Categoria
          <input required value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} />
        </label>
        <label>
          Tipo
          <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as ExpenseType })}>
            <option value="operating">Operativo</option>
            <option value="inventory">Inventario</option>
            <option value="tax">Impuestos</option>
            <option value="payroll">Nomina</option>
            <option value="other">Otros</option>
          </select>
        </label>
        <label>
          Metodo
          <select value={form.paymentMethod} onChange={(event) => setForm({ ...form, paymentMethod: event.target.value as PaymentMethod })}>
            <option value="cash">Efectivo</option>
            <option value="card">Tarjeta</option>
            <option value="transfer">Transferencia</option>
            <option value="mixed">Mixto</option>
          </select>
        </label>
        <label>
          Monto
          <input
            required
            type="number"
            min="0.01"
            step="0.01"
            value={form.amount}
            onChange={(event) => setForm({ ...form, amount: Number(event.target.value) })}
          />
        </label>
        <label>
          Proveedor
          <input value={form.vendor} onChange={(event) => setForm({ ...form, vendor: event.target.value })} />
        </label>
        <label className="full-span">
          Descripcion
          <input required value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        </label>
        <FormActions onClose={onClose} disabled={form.amount <= 0} />
      </form>
    </Modal>
  );
}

function EmployeePaymentFormModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (input: EmployeePaymentInput) => Promise<void>;
}) {
  const [form, setForm] = useState<EmployeePaymentInput>({
    paymentDate: toDateInputValue(new Date()),
    employeeName: "",
    role: "",
    amount: 0,
    paymentMethod: "cash",
    notes: "",
  });

  return (
    <Modal title="Pago a Empleado" onClose={onClose}>
      <form className="entity-form two-columns" onSubmit={(event) => {
        event.preventDefault();
        void onSave(form);
      }}>
        <label>
          Fecha
          <input required type="date" value={form.paymentDate} onChange={(event) => setForm({ ...form, paymentDate: event.target.value })} />
        </label>
        <label>
          Empleado
          <input required value={form.employeeName} onChange={(event) => setForm({ ...form, employeeName: event.target.value })} />
        </label>
        <label>
          Puesto
          <input value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })} />
        </label>
        <label>
          Metodo
          <select
            value={form.paymentMethod}
            onChange={(event) => setForm({ ...form, paymentMethod: event.target.value as PayrollPaymentMethod })}
          >
            <option value="cash">Efectivo</option>
            <option value="bank">Banco</option>
            <option value="transfer">Transferencia</option>
            <option value="card">Tarjeta</option>
            <option value="mixed">Mixto</option>
          </select>
        </label>
        <label>
          Monto
          <input
            required
            type="number"
            min="0.01"
            step="0.01"
            value={form.amount}
            onChange={(event) => setForm({ ...form, amount: Number(event.target.value) })}
          />
        </label>
        <label>
          Notas
          <input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        </label>
        <FormActions onClose={onClose} disabled={form.amount <= 0 || !form.employeeName} />
      </form>
    </Modal>
  );
}

function CategoryFormModal({
  category,
  onClose,
  onSave,
}: {
  category: Category | null;
  onClose: () => void;
  onSave: (input: CategoryInput) => Promise<void>;
}) {
  const [form, setForm] = useState<CategoryInput>({
    name: category?.name ?? "",
    description: category?.description ?? "",
    imageUrl: category?.imageUrl ?? "",
  });

  return (
    <SlidePanel title={category ? "Editar Categoria" : "Nueva Categoria"} onClose={onClose}>
      <form className="entity-form" onSubmit={(event) => {
        event.preventDefault();
        void onSave(form);
      }}>
        <label>
          Nombre
          <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </label>
        <label>
          Descripcion
          <input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        </label>
        <label>
          Imagen URL
          <input value={form.imageUrl} onChange={(event) => setForm({ ...form, imageUrl: event.target.value })} />
        </label>
        <FormActions onClose={onClose} />
      </form>
    </SlidePanel>
  );
}

function ProductFormModal({
  product,
  categories,
  onClose,
  onSave,
}: {
  product: Product | null;
  categories: Category[];
  onClose: () => void;
  onSave: (input: ProductInput, imageFile?: File | null) => Promise<void>;
}) {
  const [form, setForm] = useState<ProductInput>({
    name: product?.name ?? "",
    description: product?.description ?? "",
    categoryId: product?.categoryId ?? categories[0]?.id ?? "",
    price: product?.price ?? 0,
    imageUrl: product?.imageUrl ?? "",
    available: product?.available ?? true,
    minutes: product?.minutes ?? 10,
    saleUnit: product?.saleUnit ?? "unit",
  });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState(product?.imageUrl ?? "");

  useEffect(() => {
    return () => {
      if (imagePreview.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  function selectProductImage(file?: File) {
    setImageFile(file ?? null);
    setImagePreview(file ? URL.createObjectURL(file) : form.imageUrl);
  }

  return (
    <Modal title={product ? "Editar Producto" : "Nuevo Producto"} onClose={onClose}>
      <form className="entity-form two-columns" onSubmit={(event) => {
        event.preventDefault();
        void onSave(form, imageFile);
      }}>
        {categories.length === 0 && (
          <div className="empty-state full-span">Crea una categoria antes de registrar productos.</div>
        )}
        <label>
          Nombre
          <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </label>
        <label>
          Categoria
          <select required value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Modalidad de venta
          <select value={form.saleUnit} onChange={(event) => setForm({ ...form, saleUnit: event.target.value as "unit" | "lb" })}>
            <option value="unit">Por unidad</option>
            <option value="lb">Por libra</option>
          </select>
        </label>
        <label>
          {form.saleUnit === "lb" ? "Precio por libra" : "Precio por unidad"}
          <input
            required
            type="number"
            min="0"
            step="0.01"
            value={form.price}
            onChange={(event) => setForm({ ...form, price: Number(event.target.value) })}
          />
        </label>
        <label>
          Minutos
          <input
            type="number"
            min="1"
            value={form.minutes}
            onChange={(event) => setForm({ ...form, minutes: Number(event.target.value) })}
          />
        </label>
        <label className="full-span">
          Descripcion
          <input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        </label>
        <div className="logo-upload full-span">
          {imagePreview ? (
            <img className="logo-preview" src={imagePreview} alt="Foto del producto" />
          ) : (
            <div className="logo-preview logo-preview-empty">Foto</div>
          )}
          <label>
            Foto del producto
            <input type="file" accept="image/*" onChange={(event) => selectProductImage(event.target.files?.[0])} />
          </label>
        </div>
        <label className="check-line full-span">
          <input
            type="checkbox"
            checked={form.available}
            onChange={(event) => setForm({ ...form, available: event.target.checked })}
          />
          Disponible
        </label>
        <FormActions onClose={onClose} disabled={!form.categoryId || !form.name || form.price < 0} />
      </form>
    </Modal>
  );
}

function CouponFormModal({
  coupon,
  onClose,
  onSave,
}: {
  coupon: Coupon | null;
  onClose: () => void;
  onSave: (input: CouponInput) => Promise<void>;
}) {
  const [form, setForm] = useState<CouponInput>({
    code: coupon?.code ?? "",
    name: coupon?.name ?? "",
    type: coupon?.type ?? "percentage",
    value: coupon?.value ?? 0,
    active: coupon?.active ?? true,
  });

  return (
    <Modal title={coupon ? "Editar Cupon" : "Nuevo Cupon"} onClose={onClose}>
      <form className="entity-form two-columns" onSubmit={(event) => {
        event.preventDefault();
        void onSave(form);
      }}>
        <label>
          Codigo
          <input required value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} />
        </label>
        <label>
          Nombre
          <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </label>
        <label>
          Tipo
          <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as DiscountType })}>
            <option value="percentage">Porcentaje</option>
            <option value="fixed">Monto fijo</option>
          </select>
        </label>
        <label>
          Valor
          <input
            required
            type="number"
            min="0"
            step="0.01"
            value={form.value}
            onChange={(event) => setForm({ ...form, value: Number(event.target.value) })}
          />
        </label>
        <label className="check-line full-span">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(event) => setForm({ ...form, active: event.target.checked })}
          />
          Activo
        </label>
        <FormActions onClose={onClose} />
      </form>
    </Modal>
  );
}

function TableFormModal({
  table,
  onClose,
  onSave,
}: {
  table: RestaurantTable | null;
  onClose: () => void;
  onSave: (input: TableInput) => Promise<void>;
}) {
  const [form, setForm] = useState<TableInput>({
    number: table?.number ?? 1,
    capacity: table?.capacity ?? 4,
    status: table?.status ?? "available",
  });

  return (
    <Modal title={table ? "Editar Mesa" : "Nueva Mesa"} onClose={onClose}>
      <form className="entity-form two-columns" onSubmit={(event) => {
        event.preventDefault();
        void onSave(form);
      }}>
        <label>
          Numero
          <input
            required
            type="number"
            min="1"
            value={form.number}
            onChange={(event) => setForm({ ...form, number: Number(event.target.value) })}
          />
        </label>
        <label>
          Personas
          <input
            required
            type="number"
            min="1"
            value={form.capacity}
            onChange={(event) => setForm({ ...form, capacity: Number(event.target.value) })}
          />
        </label>
        <label className="full-span">
          Estado
          <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as TableStatus })}>
            <option value="available">Disponible</option>
            <option value="occupied">Ocupada</option>
            <option value="reserved">Reservada</option>
            <option value="out">Fuera de servicio</option>
          </select>
        </label>
        <FormActions onClose={onClose} />
      </form>
    </Modal>
  );
}

function Modal({
  title,
  onClose,
  children,
  className = "",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop" role="presentation">
      <section className={`modal-panel ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-header">
          <h3 id="modal-title">{title}</h3>
          <button type="button" onClick={onClose} title="Cerrar" aria-label="Cerrar ventana">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </section>
    </div>,
    document.body,
  );
}

function SlidePanel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return createPortal(
    <div className="slide-panel-backdrop" role="presentation">
      <section className="slide-panel" role="dialog" aria-modal="true" aria-labelledby="slide-panel-title">
        <div className="slide-panel-header">
          <h3 id="slide-panel-title">{title}</h3>
          <button type="button" className="icon-button" onClick={onClose} title="Cerrar" aria-label="Cerrar panel">
            ×
          </button>
        </div>
        <div className="slide-panel-body">{children}</div>
      </section>
    </div>,
    document.body,
  );
}

function FormActions({ onClose, disabled = false }: { onClose: () => void; disabled?: boolean }) {
  return (
    <div className="form-actions full-span">
      <button type="button" className="secondary-button" onClick={onClose}>
        Cancelar
      </button>
      <button type="submit" className="primary-action" disabled={disabled}>
        Guardar
      </button>
    </div>
  );
}

function ReportsPage({
  orders,
  tables,
  products,
  coupons,
  expenses,
  employeePayments,
  taxes,
}: {
  orders: Order[];
  tables: RestaurantTable[];
  products: Product[];
  coupons: Coupon[];
  expenses: BusinessExpense[];
  employeePayments: EmployeePayment[];
  taxes: TaxRule[];
}) {
  const [filters, setFilters] = useState<ReportFilters>(() => createDefaultReportFilters());
  const [remoteSummary, setRemoteSummary] = useState<ReportSummary | null>(null);
  const [remoteTables, setRemoteTables] = useState<Pick<RestaurantTable, "id" | "number">[]>([]);
  const [remoteWaiters, setRemoteWaiters] = useState<string[]>([]);
  const [reportError, setReportError] = useState("");
  const [isLoadingReport, setIsLoadingReport] = useState(false);

  const localFilteredOrders = useMemo(() => filterOrders(orders, filters), [orders, filters]);
  const localSummary = useMemo(() => {
    const salesSummary = summarizeOrders(localFilteredOrders, { products, coupons, taxes });
    const totals = financialTotals(expenses, employeePayments, filters.startDate, filters.endDate);
    return {
      ...salesSummary,
      expensesTotal: totals.expensesTotal,
      payrollTotal: totals.payrollTotal,
      netProfit: salesSummary.total - totals.expensesTotal - totals.payrollTotal,
    };
  }, [coupons, employeePayments, expenses, filters.endDate, filters.startDate, localFilteredOrders, products, taxes]);
  const summary = isSupabaseConfigured ? remoteSummary ?? emptyReportSummary : localSummary;
  const localWaiters = Array.from(new Set(orders.map((order) => order.waiter).filter(Boolean)));
  const reportTables = isSupabaseConfigured ? remoteTables : tables;
  const waiters = isSupabaseConfigured ? remoteWaiters : localWaiters;

  useEffect(() => {
    let isCurrent = true;
    if (!isSupabaseConfigured) {
      setRemoteSummary(null);
      setRemoteTables([]);
      setRemoteWaiters([]);
      setReportError("");
      return;
    }

    setIsLoadingReport(true);
    Promise.all([fetchSupabaseReport(filters), fetchSupabaseReportFilters()])
      .then(([summaryData, filterData]) => {
        if (!isCurrent) return;
        setRemoteSummary(summaryData);
        setRemoteTables(filterData?.tables ?? []);
        setRemoteWaiters(filterData?.waiters ?? []);
        setReportError("");
      })
      .catch((error: Error) => {
        if (!isCurrent) return;
        setRemoteSummary(null);
        setRemoteTables([]);
        setRemoteWaiters([]);
        setReportError(error.message);
      })
      .finally(() => {
        if (isCurrent) setIsLoadingReport(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [filters]);

  function updateFilter<K extends keyof ReportFilters>(key: K, value: ReportFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function exportReportPdf() {
    const resultLabel = summary.netProfit >= 0 ? "Ganancia" : "Perdida";
    downloadTextPdf(`reporte-ventas-${filters.startDate || "inicio"}-${filters.endDate || "fin"}.pdf`, "Resumen de ventas", [
      { text: `Periodo: ${filters.startDate || "Sin inicio"} a ${filters.endDate || "Sin fin"}`, gap: 18 },
      { text: `Estado: ${filters.status}` },
      { text: `Metodo: ${filters.paymentMethod}` },
      { text: `Mesa: ${filters.tableNumber}` },
      { text: `Mesero: ${filters.waiter}` },
      { text: "Resumen financiero", size: 13, gap: 22 },
      { text: `Ventas: ${currency.format(summary.total)}` },
      { text: `Subtotal: ${currency.format(summary.subtotal)}` },
      { text: `Descuentos: ${currency.format(summary.discount)}` },
      { text: `Impuestos: ${currency.format(summary.tax)}` },
      { text: `Gastos: ${currency.format(summary.expensesTotal)}` },
      { text: `Nomina: ${currency.format(summary.payrollTotal)}` },
      { text: `${resultLabel} neta: ${currency.format(summary.netProfit)}`, size: 14, gap: 12 },
      { text: "Ventas por metodo", size: 13, gap: 22 },
      { text: `Efectivo: ${currency.format(summary.byPaymentMethod.cash)}` },
      { text: `Tarjeta: ${currency.format(summary.byPaymentMethod.card)}` },
      { text: `Transferencia: ${currency.format(summary.byPaymentMethod.transfer)}` },
      { text: `Mixto: ${currency.format(summary.byPaymentMethod.mixed)}` },
      { text: "Productos mas vendidos", size: 13, gap: 22 },
      ...summary.topProducts.slice(0, 8).map((product) => ({
        text: `${product.name} - ${product.quantity} uds - ${currency.format(product.total)}`,
      })),
    ]);
  }

  return (
    <section className="reports-page">
      <div className="panel report-filters">
        <div>
          <label>
            Desde
            <input
              type="date"
              value={filters.startDate}
              onChange={(event) => updateFilter("startDate", event.target.value)}
            />
          </label>
          <label>
            Hasta
            <input
              type="date"
              value={filters.endDate}
              onChange={(event) => updateFilter("endDate", event.target.value)}
            />
          </label>
          <label>
            Estado
            <select
              value={filters.status}
              onChange={(event) => updateFilter("status", event.target.value as ReportFilters["status"])}
            >
              <option value="all">Todos</option>
              <option value="paid">Pagadas</option>
              <option value="new">Nuevas</option>
              <option value="preparing">En preparacion</option>
              <option value="ready">Listas</option>
              <option value="delivered">Entregadas</option>
            </select>
          </label>
          <label>
            Metodo
            <select
              value={filters.paymentMethod}
              onChange={(event) =>
                updateFilter("paymentMethod", event.target.value as ReportFilters["paymentMethod"])
              }
            >
              <option value="all">Todos</option>
              <option value="cash">Efectivo</option>
              <option value="card">Tarjeta</option>
              <option value="transfer">Transferencia</option>
              <option value="mixed">Mixto</option>
            </select>
          </label>
          <label>
            Mesa
            <select
              value={filters.tableNumber}
              onChange={(event) => updateFilter("tableNumber", event.target.value)}
            >
              <option value="all">Todas</option>
              {reportTables.map((table) => (
                <option key={table.id} value={String(table.number)}>
                  Mesa {table.number}
                </option>
              ))}
            </select>
          </label>
          <label>
            Mesero
            <select value={filters.waiter} onChange={(event) => updateFilter("waiter", event.target.value)}>
              <option value="all">Todos</option>
              {waiters.map((waiter) => (
                <option key={waiter} value={waiter}>
                  {waiter}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="report-toolbar">
          <span className={isSupabaseConfigured ? "backend-status online" : "backend-status"}>
            {isSupabaseConfigured ? "Supabase conectado" : "Modo demo local"}
          </span>
          <button className="secondary-button" onClick={exportReportPdf}>
            Exportar PDF
          </button>
        </div>
        {isLoadingReport && <small>Cargando reportes...</small>}
        {reportError && <small className="error-text">Reporte remoto no disponible: {reportError}</small>}
      </div>

      <div className="page-grid report-metrics">
        <MetricCard label="Total vendido" value={currency.format(summary.total)} tone="green" />
        <MetricCard label="Gastos" value={currency.format(summary.expensesTotal)} tone="orange" />
        <MetricCard label="Nomina" value={currency.format(summary.payrollTotal)} tone="purple" />
        <MetricCard
          label={summary.netProfit >= 0 ? "Ganancia neta" : "Perdida neta"}
          value={currency.format(summary.netProfit)}
          tone={summary.netProfit >= 0 ? "green" : "orange"}
        />
      </div>

      <div className="report-panels">
        <div className="panel">
          <PanelHeader title="Resumen de rentabilidad" />
          <div className="profit-summary">
            <div>
              <span>Ventas</span>
              <strong>{currency.format(summary.total)}</strong>
            </div>
            <div>
              <span>Gastos</span>
              <strong>-{currency.format(summary.expensesTotal)}</strong>
            </div>
            <div>
              <span>Nomina</span>
              <strong>-{currency.format(summary.payrollTotal)}</strong>
            </div>
            <div className={summary.netProfit >= 0 ? "positive" : "negative"}>
              <span>{summary.netProfit >= 0 ? "Resultado" : "Resultado"}</span>
              <strong>{currency.format(summary.netProfit)}</strong>
            </div>
          </div>
        </div>

        <div className="panel">
          <PanelHeader title="Ventas por metodo" />
          <PaymentMethodChart values={summary.byPaymentMethod} />
        </div>

        <div className="panel wide-report">
          <PanelHeader title="Tendencia de ventas" />
          <SalesTrendChart days={summary.byDay} />
        </div>

        <div className="panel wide-report">
          <PanelHeader title="Productos mas vendidos" />
          <div className="mini-table">
            {summary.topProducts.slice(0, 8).map((product) => (
              <div key={product.productId}>
                <span>{product.name}</span>
                <span>{product.quantity} uds</span>
                <strong>{currency.format(product.total)}</strong>
              </div>
            ))}
            {summary.topProducts.length === 0 && <div className="empty-state">Sin productos vendidos.</div>}
          </div>
        </div>
      </div>
    </section>
  );
}

function LogsPage() {
  return (
    <section className="panel page-panel">
      <PanelHeader title="Logs del Sistema" />
      <LogList />
    </section>
  );
}

function PaymentMethodChart({ values }: { values: ReportSummary["byPaymentMethod"] }) {
  const methods: Array<{ key: PaymentMethod; label: string }> = [
    { key: "cash", label: "Efectivo" },
    { key: "card", label: "Tarjeta" },
    { key: "transfer", label: "Transferencia" },
    { key: "mixed", label: "Mixto" },
  ];
  const max = Math.max(...methods.map(({ key }) => values[key]), 1);
  const total = methods.reduce((sum, { key }) => sum + values[key], 0);
  let cursor = 0;
  const colors = ["#f0a0c4", "#57c98a", "#e8b14d", "#8d8af0"];
  const segments = methods.map(({ key }, index) => {
    const start = cursor;
    cursor += total ? (values[key] / total) * 100 : 0;
    return `${colors[index]} ${start}% ${cursor}%`;
  }).join(", ");

  return (
    <div className="payment-chart" aria-label="Comparacion de ventas por metodo de pago">
      <div className="payment-donut" style={{ background: total ? `conic-gradient(${segments})` : "var(--surface-2)" }} aria-hidden="true">
        <span><small>Total</small><strong>{currency.format(total)}</strong></span>
      </div>
      <div className="payment-chart-legend">
        {methods.map(({ key, label }, index) => (
          <div className="payment-chart-row" key={key}>
            <span><i style={{ background: colors[index] }} />{label}</span>
            <div className="chart-track" aria-hidden="true">
              <i style={{ width: `${(values[key] / max) * 100}%`, background: colors[index] }} />
            </div>
            <strong>{currency.format(values[key])}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function SalesTrendChart({ days }: { days: ReportSummary["byDay"] }) {
  const visibleDays = days.slice(-12);
  const max = Math.max(...visibleDays.map((day) => day.total), 1);

  if (!visibleDays.length) {
    return <div className="empty-state">No hay ventas para estos filtros.</div>;
  }

  return (
    <div className="sales-chart" aria-label="Tendencia de ventas por fecha">
      <div className="sales-chart-bars">
        {visibleDays.map((day) => (
          <div className="sales-chart-column" key={day.date} title={`${day.date}: ${currency.format(day.total)}`}>
            <strong>{currency.format(day.total)}</strong>
            <div className="sales-bar-track" aria-hidden="true">
              <i style={{ height: `${Math.max((day.total / max) * 100, 4)}%` }} />
            </div>
            <span>{new Intl.DateTimeFormat("es", { day: "2-digit", month: "short" }).format(new Date(`${day.date}T12:00:00`))}</span>
            <small>{day.orderCount} ord.</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function RestaurantsPage({
  restaurants,
  currentRestaurant,
  onCreate,
}: {
  restaurants: RestaurantProfile[];
  currentRestaurant: RestaurantProfile;
  onCreate: (input: RestaurantInput, logoFile?: File | null) => Promise<void>;
}) {
  const [isCreating, setIsCreating] = useState(false);

  return (
    <>
      <AdminTable
        title="Restaurantes registrados"
        action="+ Nuevo restaurante"
        onAction={() => setIsCreating(true)}
        headers={["Logo", "Nombre", "RNC", "Telefono", "Correo", "Estado"]}
        rows={restaurants.map((restaurant) => [
          restaurant.logoUrl ? <img className="thumb" src={restaurant.logoUrl} alt={restaurant.name} /> : restaurant.name.slice(0, 1),
          restaurant.name,
          restaurant.rnc || "-",
          restaurant.phone || "-",
          restaurant.email || "-",
          <span className={restaurant.active ? "pill green" : "pill muted"}>
            {restaurant.id === currentRestaurant.id ? "Actual" : restaurant.active ? "Activo" : "Inactivo"}
          </span>,
        ])}
      />
      {isCreating && (
        <RestaurantFormModal
          onClose={() => setIsCreating(false)}
          onSave={async (input, logoFile) => {
            await onCreate(input, logoFile);
            setIsCreating(false);
          }}
        />
      )}
    </>
  );
}

function RestaurantFormModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (input: RestaurantInput, logoFile?: File | null) => Promise<void>;
}) {
  const [form, setForm] = useState<RestaurantInput>({
    name: "",
    rnc: "",
    phone: "",
    email: "",
    address: "",
    logoUrl: "",
  });
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState("");

  useEffect(() => {
    return () => {
      if (logoPreview.startsWith("blob:")) URL.revokeObjectURL(logoPreview);
    };
  }, [logoPreview]);

  function selectLogo(file?: File) {
    setLogoFile(file ?? null);
    setLogoPreview(file ? URL.createObjectURL(file) : "");
  }

  return (
    <Modal title="Nuevo Restaurante" onClose={onClose}>
      <form className="entity-form two-columns" onSubmit={(event) => {
        event.preventDefault();
        void onSave(form, logoFile);
      }}>
        <label>
          Nombre
          <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </label>
        <label>
          RNC
          <input value={form.rnc} onChange={(event) => setForm({ ...form, rnc: event.target.value })} />
        </label>
        <label>
          Telefono
          <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
        </label>
        <label>
          Correo
          <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
        </label>
        <label className="full-span">
          Direccion
          <input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} />
        </label>
        <div className="logo-upload full-span">
          {logoPreview ? (
            <img className="logo-preview" src={logoPreview} alt="Logo del restaurante" />
          ) : (
            <div className="logo-preview logo-preview-empty">Logo</div>
          )}
          <label>
            Logo del restaurante
            <input type="file" accept="image/*" onChange={(event) => selectLogo(event.target.files?.[0])} />
          </label>
        </div>
        <FormActions onClose={onClose} />
      </form>
    </Modal>
  );
}

function SettingsPage({
  settings,
  botSettings,
  voiceSettings,
  restaurant,
  onSave,
  onSaveBotSettings,
  onSaveVoiceSettings,
  onRegenerateVoiceApiKey,
  onSaveRestaurant,
}: {
  settings: BusinessSettings;
  botSettings: BotSettings;
  voiceSettings: VoiceBotSettings;
  restaurant: RestaurantProfile;
  onSave: (settings: BusinessSettings) => Promise<void>;
  onSaveBotSettings: (settings: BotSettings) => Promise<void>;
  onSaveVoiceSettings: (settings: VoiceBotSettings) => Promise<void>;
  onRegenerateVoiceApiKey: () => Promise<string>;
  onSaveRestaurant: (input: RestaurantInput, logoFile?: File | null) => Promise<void>;
}) {
  const [form, setForm] = useState(settings);
  const [botForm, setBotForm] = useState(botSettings);
  const [botSavedMessage, setBotSavedMessage] = useState("");
  const [voiceForm, setVoiceForm] = useState(voiceSettings);
  const [voiceSavedMessage, setVoiceSavedMessage] = useState("");
  const [isRegeneratingVoiceKey, setIsRegeneratingVoiceKey] = useState(false);
  const [restaurantForm, setRestaurantForm] = useState<RestaurantInput>({
    name: restaurant.name,
    rnc: restaurant.rnc,
    phone: restaurant.phone,
    email: restaurant.email,
    address: restaurant.address,
    logoUrl: restaurant.logoUrl,
  });
  const [savedMessage, setSavedMessage] = useState("");
  const [restaurantLogoFile, setRestaurantLogoFile] = useState<File | null>(null);
  const [restaurantLogoPreview, setRestaurantLogoPreview] = useState(restaurant.logoUrl);

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  useEffect(() => {
    setBotForm(botSettings);
  }, [botSettings]);

  useEffect(() => {
    setVoiceForm(voiceSettings);
  }, [voiceSettings]);

  useEffect(() => {
    setRestaurantForm({
      name: restaurant.name,
      rnc: restaurant.rnc,
      phone: restaurant.phone,
      email: restaurant.email,
      address: restaurant.address,
      logoUrl: restaurant.logoUrl,
    });
    setRestaurantLogoFile(null);
    setRestaurantLogoPreview(restaurant.logoUrl);
  }, [restaurant]);

  useEffect(() => {
    return () => {
      if (restaurantLogoPreview.startsWith("blob:")) URL.revokeObjectURL(restaurantLogoPreview);
    };
  }, [restaurantLogoPreview]);

  function selectRestaurantLogo(file?: File) {
    setRestaurantLogoFile(file ?? null);
    setRestaurantLogoPreview(file ? URL.createObjectURL(file) : restaurant.logoUrl);
  }

  async function regenerateVoiceKeyHandler() {
    setIsRegeneratingVoiceKey(true);
    try {
      const apiKey = await onRegenerateVoiceApiKey();
      setVoiceForm((current) => ({ ...current, apiKey }));
      setVoiceSavedMessage("API key regenerada.");
      window.setTimeout(() => setVoiceSavedMessage(""), 2200);
    } catch {
      // onRegenerateVoiceApiKey ya reporta el error en dataError.
    } finally {
      setIsRegeneratingVoiceKey(false);
    }
  }

  function updateTax(taxId: string, patch: Partial<TaxRule>) {
    setForm((current) => ({
      ...current,
      taxes: current.taxes.map((tax) => (tax.id === taxId ? { ...tax, ...patch } : tax)),
    }));
  }

  function addTax() {
    setForm((current) => ({
      ...current,
      taxes: [
        ...current.taxes,
        {
          id: `local-tax-${Date.now()}`,
          name: "Nuevo impuesto",
          rate: 0,
          active: true,
        },
      ],
    }));
  }

  return (
    <section className="settings-grid">
      <div className="panel setting-card wide-setting">
        <h3>Datos del negocio</h3>
        <p>Estos datos aparecen en la app, facturas, PDF y correos.</p>
        <form
          className="entity-form two-columns"
          onSubmit={(event) => {
            event.preventDefault();
            void onSaveRestaurant(restaurantForm, restaurantLogoFile).then(() => {
              setSavedMessage("Datos del negocio guardados.");
              window.setTimeout(() => setSavedMessage(""), 2200);
            });
          }}
        >
          <label>
            Nombre
            <input required value={restaurantForm.name} onChange={(event) => setRestaurantForm({ ...restaurantForm, name: event.target.value })} />
          </label>
          <label>
            RNC
            <input value={restaurantForm.rnc} onChange={(event) => setRestaurantForm({ ...restaurantForm, rnc: event.target.value })} />
          </label>
          <label>
            Telefono
            <input value={restaurantForm.phone} onChange={(event) => setRestaurantForm({ ...restaurantForm, phone: event.target.value })} />
          </label>
          <label>
            Correo
            <input type="email" value={restaurantForm.email} onChange={(event) => setRestaurantForm({ ...restaurantForm, email: event.target.value })} />
          </label>
          <label className="full-span">
            Direccion
            <input value={restaurantForm.address} onChange={(event) => setRestaurantForm({ ...restaurantForm, address: event.target.value })} />
          </label>
          <div className="logo-upload full-span">
            {restaurantLogoPreview ? (
              <img className="logo-preview" src={restaurantLogoPreview} alt="Logo del restaurante" />
            ) : (
              <div className="logo-preview logo-preview-empty">Logo</div>
            )}
            <label>
              Logo del restaurante
              <input type="file" accept="image/*" onChange={(event) => selectRestaurantLogo(event.target.files?.[0])} />
            </label>
          </div>
          <div className="form-actions full-span">
            {savedMessage && <span className="success-text">{savedMessage}</span>}
            <button type="submit" className="primary-action">
              Guardar negocio
            </button>
          </div>
        </form>
      </div>
      <div className="panel setting-card wide-setting">
        <h3>Facturacion</h3>
        <p>Correo, moneda e impuestos usados en facturas, caja y reportes.</p>
        <form
          className="entity-form two-columns"
          onSubmit={(event) => {
            event.preventDefault();
            void onSave(form).then(() => {
              setSavedMessage("Configuracion guardada.");
              window.setTimeout(() => setSavedMessage(""), 2200);
            });
          }}
        >
          <label>
            Nombre remitente
            <input
              required
              value={form.invoiceSenderName}
              onChange={(event) => setForm({ ...form, invoiceSenderName: event.target.value })}
            />
          </label>
          <label>
            Correo
            <input
              type="email"
              value={form.billingEmail}
              onChange={(event) => setForm({ ...form, billingEmail: event.target.value })}
            />
          </label>
          <label>
            Moneda
            <select
              value={form.currencyCode}
              onChange={(event) => {
                const currencyCode = event.target.value;
                const locale = currencyCode === "DOP" ? "es-DO" : currencyCode === "USD" ? "en-US" : currencyCode === "EUR" ? "es-ES" : form.currencyLocale;
                setForm({ ...form, currencyCode, currencyLocale: locale });
              }}
            >
              <option value="DOP">Peso dominicano (DOP)</option>
              <option value="USD">Dolar estadounidense (USD)</option>
              <option value="EUR">Euro (EUR)</option>
              <option value="MXN">Peso mexicano (MXN)</option>
              <option value="COP">Peso colombiano (COP)</option>
              <option value="CRC">Colon costarricense (CRC)</option>
              <option value="PAB">Balboa panameno (PAB)</option>
            </select>
          </label>
          <label>
            Locale
            <input
              required
              value={form.currencyLocale}
              onChange={(event) => setForm({ ...form, currencyLocale: event.target.value })}
            />
          </label>
          <div className="printer-settings full-span">
            <div className="subsection-header">
              <div>
                <h4>Impresora de tickets</h4>
                <p>Plantilla termica optimizada para papel de 80 mm.</p>
              </div>
              <span className="pill green">80 mm</span>
            </div>
            <div className="printer-settings-grid">
              <label>
                Metodo de impresion
                <select
                  value={form.printerMode}
                  onChange={(event) => setForm({ ...form, printerMode: event.target.value as "system" | "bridge" })}
                >
                  <option value="system">Impresora instalada en el sistema</option>
                  <option value="bridge">Puente local ESC/POS</option>
                </select>
              </label>
              {form.printerMode === "bridge" && (
                <label>
                  URL del servicio local
                  <input
                    type="url"
                    placeholder="http://127.0.0.1:9100/print"
                    value={form.printerEndpoint}
                    onChange={(event) => setForm({ ...form, printerEndpoint: event.target.value })}
                  />
                </label>
              )}
            </div>
            <small>
              El modo sistema funciona con impresoras USB o Wi-Fi instaladas. El puente ESC/POS permite impresion directa y activa el PDF automatico cuando no responde.
            </small>
          </div>
          <div className="tax-settings full-span">
            <div className="subsection-header">
              <h4>Impuestos</h4>
              <button type="button" className="secondary-button" onClick={addTax}>
                Agregar impuesto
              </button>
            </div>
            {form.taxes.map((tax) => (
              <div className="tax-row" key={tax.id}>
                <label>
                  Nombre
                  <input value={tax.name} onChange={(event) => updateTax(tax.id, { name: event.target.value })} />
                </label>
                <label>
                  Porcentaje
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={(tax.rate * 100).toFixed(2)}
                    onChange={(event) => updateTax(tax.id, { rate: Number(event.target.value) / 100 })}
                  />
                </label>
                <label className="check-line">
                  <input
                    type="checkbox"
                    checked={tax.active}
                    onChange={(event) => updateTax(tax.id, { active: event.target.checked })}
                  />
                  Activo
                </label>
              </div>
            ))}
          </div>
          <div className="form-actions full-span">
            {savedMessage && <span className="success-text">{savedMessage}</span>}
            <button type="submit" className="primary-action">
              Guardar
            </button>
          </div>
        </form>
      </div>
      <div className="panel setting-card wide-setting">
        <h3>Bot de WhatsApp</h3>
        <p>Toma pedidos por WhatsApp con un flujo de n8n. Configura aqui los datos que necesita el bot; el menu y los precios siempre se leen en vivo desde este sistema.</p>
        <form
          className="entity-form two-columns"
          onSubmit={(event) => {
            event.preventDefault();
            void onSaveBotSettings(botForm).then(() => {
              setBotSavedMessage("Configuracion del bot guardada.");
              window.setTimeout(() => setBotSavedMessage(""), 2200);
            });
          }}
        >
          <label className="check-line full-span">
            <input
              type="checkbox"
              checked={botForm.isEnabled}
              onChange={(event) => setBotForm({ ...botForm, isEnabled: event.target.checked })}
            />
            Activar bot de WhatsApp para este restaurante
          </label>
          <label>
            Phone Number ID (Meta WhatsApp Cloud API)
            <input
              placeholder="Ej. 109876543210234"
              value={botForm.whatsappPhoneNumberId}
              onChange={(event) => setBotForm({ ...botForm, whatsappPhoneNumberId: event.target.value })}
            />
          </label>
          <label>
            Correo de notificacion de pedidos
            <input
              type="email"
              placeholder={settings.billingEmail || "correo@negocio.com"}
              value={botForm.notificationEmail}
              onChange={(event) => setBotForm({ ...botForm, notificationEmail: event.target.value })}
            />
          </label>
          <label className="full-span">
            Instrucciones adicionales para el bot
            <textarea
              rows={4}
              placeholder="Ej. Horario: Lunes a sabado de 11am a 9pm. Domingo cerrado. Tiempo de entrega 30-45 min. Tono amable y cercano."
              value={botForm.extraPrompt}
              onChange={(event) => setBotForm({ ...botForm, extraPrompt: event.target.value })}
            />
          </label>
          <small className="full-span">
            El catalogo de productos, categorias y precios se toma siempre de este sistema; no hace falta repetirlo aqui. Usa este texto para horarios, promociones o el tono de respuesta que debe usar el bot.
          </small>
          <div className="form-actions full-span">
            {botSavedMessage && <span className="success-text">{botSavedMessage}</span>}
            <button type="submit" className="primary-action">
              Guardar bot
            </button>
          </div>
        </form>
      </div>
      <div className="panel setting-card wide-setting">
        <h3>Bot de pedidos por voz</h3>
        <p>
          Recibe pedidos confirmados por un agente de voz con IA (llamadas telefonicas). Configura aqui los datos que
          necesita el webhook; el menu y los precios siempre se leen en vivo desde este sistema.
        </p>
        <form
          className="entity-form two-columns"
          onSubmit={(event) => {
            event.preventDefault();
            void onSaveVoiceSettings(voiceForm).then(() => {
              setVoiceSavedMessage("Configuracion del bot de voz guardada.");
              window.setTimeout(() => setVoiceSavedMessage(""), 2200);
            });
          }}
        >
          <label className="check-line full-span">
            <input
              type="checkbox"
              checked={voiceForm.isEnabled}
              onChange={(event) => setVoiceForm({ ...voiceForm, isEnabled: event.target.checked })}
            />
            Activar bot de voz para este restaurante
          </label>
          <label>
            Correo de notificacion de pedidos
            <input
              type="email"
              placeholder={settings.billingEmail || "correo@negocio.com"}
              value={voiceForm.notificationEmail}
              onChange={(event) => setVoiceForm({ ...voiceForm, notificationEmail: event.target.value })}
            />
          </label>
          <label className="full-span">
            restaurant_id (para el agente de voz)
            <input readOnly value={restaurant.id} onFocus={(event) => event.target.select()} />
          </label>
          <label className="full-span">
            API key (header Authorization: Bearer ...)
            <div className="inline-field-with-action">
              <input readOnly value={voiceForm.apiKey || "(sin generar todavia)"} onFocus={(event) => event.target.select()} />
              <button type="button" className="secondary-button" disabled={isRegeneratingVoiceKey} onClick={() => void regenerateVoiceKeyHandler()}>
                {isRegeneratingVoiceKey ? "Generando..." : voiceForm.apiKey ? "Regenerar" : "Generar"}
              </button>
            </div>
          </label>
          <label className="full-span">
            Instrucciones adicionales para el agente de voz
            <textarea
              rows={4}
              placeholder="Ej. Horario: Lunes a sabado de 11am a 9pm. Domingo cerrado. Tiempo de entrega 30-45 min. Tono amable y cercano."
              value={voiceForm.extraPrompt}
              onChange={(event) => setVoiceForm({ ...voiceForm, extraPrompt: event.target.value })}
            />
          </label>
          <small className="full-span">
            En la plataforma del agente de voz, configura el webhook de la orden hacia esta API key + restaurant_id, y
            ademas una funcion/herramienta que llame a <code>rpc/voice_get_menu</code> (header{" "}
            <code>apikey</code>/<code>Authorization: Bearer</code> con la anon key del proyecto, body{" "}
            <code>{"{\"p_api_key\": \"<esta API key>\"}"}</code>) al inicio de la llamada para inyectar el menu real,
            los precios y estas instrucciones en su prompt. Regenerar la API key invalida la anterior de inmediato:
            actualiza la plataforma de voz despues de regenerarla.
          </small>
          <div className="form-actions full-span">
            {voiceSavedMessage && <span className="success-text">{voiceSavedMessage}</span>}
            <button type="submit" className="primary-action">
              Guardar bot de voz
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

function MobileNav({ user, page, setPage }: { user: User; page: Page; setPage: (page: Page) => void }) {
  const mobilePagesByRole: Record<Role, Page[]> = {
    admin: ["dashboard", "history", "pos", "tables", "settings"],
    waiter: ["tables", "pos", "kitchen"],
    kitchen: ["kitchen"],
    cashier: ["cashier", "customers", "history", "reports"],
  };
  const items = mobilePagesByRole[user.role]
    .map((itemPage) => navItemFor(itemPage, user.role))
    .filter((item): item is { page: Page; label: string; icon: string } => Boolean(item));

  return (
    <nav className="mobile-nav">
      {items.map((item) => (
        <button
          className={page === item.page ? "active" : ""}
          key={item.page}
          onClick={() => setPage(item.page)}
          title={item.label}
        >
          <AppIcon name={item.page} />
          {item.label}
        </button>
      ))}
    </nav>
  );
}

function MobileMenuDrawer({
  user,
  page,
  restaurant,
  setPage,
  onClose,
  onLogout,
}: {
  user: User;
  page: Page;
  restaurant: RestaurantProfile;
  setPage: (page: Page) => void;
  onClose: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="mobile-menu-backdrop">
      <aside className="mobile-menu-panel">
        <div className="mobile-menu-header">
          <div className="sidebar-brand">
            {restaurant.logoUrl ? <img src={restaurant.logoUrl} alt={restaurant.name} /> : <span>{restaurant.name.slice(0, 1)}</span>}
            <div>
              <strong>{restaurant.name}</strong>
              <small>{user.title}</small>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} title="Cerrar menu">
            <AppIcon name="close" />
          </button>
        </div>
        <nav className="mobile-menu-list">
          {user.role === "admin"
            ? adminNavGroups.map((group) => (
                <div className="mobile-menu-group" key={group.label}>
                  <strong>{group.label}</strong>
                  {group.pages.map((itemPage) => {
                    if (itemPage === "restaurants" && !isSuperAdminUser(user)) return null;
                    const item = navItemFor(itemPage, user.role);
                    if (!item) return null;
                    return (
                      <button
                        className={page === item.page ? "active" : ""}
                        key={item.page}
                        onClick={() => setPage(item.page)}
                      >
                        <AppIcon name={item.page} />
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              ))
            : navByRole[user.role].map((item) => (
                <button
                  className={page === item.page ? "active" : ""}
                  key={item.page}
                  onClick={() => setPage(item.page)}
                >
                  <AppIcon name={item.page} />
                  {item.label}
                </button>
              ))}
        </nav>
        <button className="sidebar-exit mobile-menu-exit" onClick={onLogout}>
          <AppIcon name="logout" /> Salir
        </button>
      </aside>
      <button className="mobile-menu-scrim" onClick={onClose} aria-label="Cerrar menu" />
    </div>
  );
}

function AdminTable({
  title,
  action,
  onAction,
  headers,
  rows,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
  headers: string[];
  rows: ReactNode[][];
}) {
  return (
    <section className="panel page-panel">
      <div className="admin-table-heading">
        <div>
          <h3>{title}</h3>
          <span>{rows.length} {rows.length === 1 ? "registro" : "registros"}</span>
        </div>
        {action && <button className="primary-action" onClick={onAction}>{action}</button>}
      </div>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              {headers.map((header) => (
                <th key={header}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <div className="empty-state">Todavia no hay registros. Usa la accion principal para crear el primero.</div>}
    </section>
  );
}

function ActionButtons({ onEdit, onDelete }: { onEdit?: () => void; onDelete?: () => void }) {
  return (
    <div className="table-actions">
      <button title="Editar" onClick={onEdit} disabled={!onEdit}>
        <AppIcon name="edit" />
      </button>
      <button title="Eliminar" onClick={onDelete} disabled={!onDelete}>
        <AppIcon name="trash" />
      </button>
    </div>
  );
}

const iconPaths: Record<string, string[]> = {
  dashboard: ["M3 12h7V3H3v9Z", "M14 21h7v-9h-7v9Z", "M14 3v5h7V3h-7Z", "M3 21h7v-5H3v5Z"],
  tables: ["M4 11h16", "M6 11V7h12v4", "M7 11v8", "M17 11v8", "M3 19h18"],
  pos: ["M4 3h16v14H4z", "M8 21h8", "M12 17v4", "M8 8h8", "M8 12h3"],
  kitchen: ["M6 3v8", "M3 3v5a3 3 0 0 0 6 0V3", "M6 11v10", "M15 3v18", "M15 3c4 2 5 7 0 10"],
  cashier: ["M3 6h18v12H3z", "M3 10h18", "M7 15h3"],
  customers: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M22 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"],
  history: ["M3 5h18v16H3z", "M3 9h18", "M7 3v4", "M17 3v4", "M7 13h4", "M7 17h7"],
  restaurants: ["M3 21h18", "M5 21V7l7-4 7 4v14", "M9 21v-6h6v6", "M9 9h.01", "M15 9h.01"],
  inventory: ["M4 7h16v14H4z", "M2 3h20v4H2z", "M9 11h6"],
  finance: ["M12 2v20", "M17 6.5C17 4.57 14.76 3 12 3S7 4.57 7 6.5 9.24 10 12 10s5 1.57 5 3.5S14.76 17 12 17s-5-1.57-5-3.5"],
  categories: ["M4 4h6v6H4z", "M14 4h6v6h-6z", "M4 14h6v6H4z", "M14 14h6v6h-6z"],
  products: ["M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z", "M3.3 7 12 12l8.7-5", "M12 22V12"],
  coupons: ["M19 5 5 19", "M6.5 5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z", "M17.5 16a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"],
  reports: ["M4 20V10", "M10 20V4", "M16 20v-7", "M22 20H2"],
  logs: ["M4 6h16", "M4 12h16", "M4 18h10"],
  settings: ["M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z", "M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2 3.46-.08-.02a1.7 1.7 0 0 0-1.87-.34l-.35.2a1.7 1.7 0 0 0-.85 1.47V22h-4v-.09a1.7 1.7 0 0 0-.85-1.47l-.35-.2a1.7 1.7 0 0 0-1.87.34l-.08.02-2-3.46.06-.06A1.7 1.7 0 0 0 4.6 15l-.35-.2a1.7 1.7 0 0 0-1.65-.08L2.5 14v-4l.1-.06a1.7 1.7 0 0 0 1.65-.08l.35-.2a1.7 1.7 0 0 0 .85-1.47V8.1l2-3.46.08.02a1.7 1.7 0 0 0 1.87.34l.35-.2a1.7 1.7 0 0 0 .85-1.47V3h4v.09a1.7 1.7 0 0 0 .85 1.47l.35.2a1.7 1.7 0 0 0 1.87-.34l.08-.02 2 3.46-.06.06A1.7 1.7 0 0 0 19.4 10l.35.2a1.7 1.7 0 0 0 1.65.08l.1-.06v4l-.1.06a1.7 1.7 0 0 0-1.65.08Z"],
  menu: ["M4 6h16", "M4 12h16", "M4 18h16"],
  search: ["M21 21l-4.35-4.35", "M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z"],
  bell: ["M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9", "M10 21h4"],
  print: ["M6 9V3h12v6", "M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2", "M6 14h12v7H6z"],
  logout: ["M10 17l5-5-5-5", "M15 12H3", "M21 19V5a2 2 0 0 0-2-2h-6"],
  close: ["M6 6l12 12", "M18 6 6 18"],
  edit: ["M12 20h9", "M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"],
  trash: ["M3 6h18", "M8 6V4h8v2", "M19 6l-1 15H6L5 6", "M10 11v5", "M14 11v5"],
  email: ["M3 5h18v14H3z", "m3 8 6 5 6-5"],
  reservation: ["M8 2v4", "M16 2v4", "M3 9h18", "M4 6h16v14H4z", "M9 14h2v2H9z"],
  profile: ["M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2", "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"],
};

function AppIcon({ name }: { name: string }) {
  const paths = iconPaths[name] ?? iconPaths.dashboard;
  return (
    <svg className="app-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths.map((path, index) => <path d={path} key={`${name}-${index}`} />)}
    </svg>
  );
}

function PanelHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="panel-header">
      <h3>{title}</h3>
      {action && <button onClick={onAction}>{action}</button>}
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone,
  trend,
}: {
  label: string;
  value: string;
  tone: string;
  trend?: number[];
}) {
  const maxTrend = trend && trend.length ? Math.max(...trend, 1) : 1;
  return (
    <article className={`metric-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {trend && (
        <div className="metric-card-trend">
          {trend.map((point, index) => (
            <i key={index} style={{ height: `${Math.max((point / maxTrend) * 100, 8)}%` }} />
          ))}
        </div>
      )}
    </article>
  );
}

function TotalsBlock({ totals }: { totals: Totals }) {
  return (
    <div className="totals">
      <div>
        <span>Subtotal</span>
        <strong>{currency.format(totals.subtotal)}</strong>
      </div>
      <div className="discount">
        <span>Descuento</span>
        <strong>-{currency.format(totals.discount)}</strong>
      </div>
      {totals.taxBreakdown.length ? (
        totals.taxBreakdown.map((tax) => (
          <div key={tax.name}>
            <span>
              {tax.name} ({(tax.rate * 100).toFixed(2)}%)
            </span>
            <strong>{currency.format(tax.amount)}</strong>
          </div>
        ))
      ) : (
        <div>
          <span>Impuestos</span>
          <strong>{currency.format(0)}</strong>
        </div>
      )}
      <div className="grand-total">
        <span>Total</span>
        <strong>{currency.format(totals.total)}</strong>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: TableStatus }) {
  return <span className={`status-badge ${status}`}>{tableLabels[status]}</span>;
}

function StatusPill({ status }: { status: OrderStatus }) {
  return <span className={`status-pill ${status}`}>{orderLabels[status]}</span>;
}

function LogList({ compact = false }: { compact?: boolean }) {
  const actionLabels: Record<string, string> = {
    SEND_ORDER_TO_KITCHEN: "Orden enviada a cocina",
    UPDATE_ORDER_STATUS: "Estado de orden actualizado",
    PROCESS_PAYMENT: "Pago procesado",
  };
  return (
    <div className="log-list">
      {logs.slice(0, compact ? 3 : logs.length).map((log) => (
        <article key={log.id}>
          <strong>{actionLabels[log.action] ?? log.action}</strong>
          <span>{log.description}</span>
          <small>
            {log.user} · {log.createdAt}
          </small>
        </article>
      ))}
    </div>
  );
}

export default App;


