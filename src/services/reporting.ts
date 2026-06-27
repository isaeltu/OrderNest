import { coupons as fallbackCoupons, products as fallbackProducts } from "../data";
import type {
  Coupon,
  Order,
  OrderItem,
  PaymentMethod,
  ReportFilters,
  ReportSummary,
  TaxRule,
  Totals,
} from "../types";

const paymentMethods: PaymentMethod[] = ["cash", "card", "transfer", "mixed"];

export const defaultTaxRules: TaxRule[] = [
  {
    id: "itbis-18",
    name: "ITBIS",
    rate: 0.18,
    active: true,
  },
];

type SummaryOptions = {
  products?: typeof fallbackProducts;
  coupons?: Coupon[];
  taxes?: TaxRule[];
};

export function toDateInputValue(date: Date) {
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 10);
}

export function findCoupon(code?: string, sourceCoupons: Coupon[] = fallbackCoupons): Coupon | undefined {
  if (!code) return undefined;
  return sourceCoupons.find((coupon) => coupon.code.toLowerCase() === code.toLowerCase());
}

export function getProduct(productId: string, sourceProducts = fallbackProducts) {
  return sourceProducts.find((product) => product.id === productId);
}

export function calculateTotals(
  items: OrderItem[],
  coupon?: Coupon,
  sourceProducts = fallbackProducts,
  taxRules: TaxRule[] = defaultTaxRules,
): Totals {
  const subtotal = items.reduce((sum, item) => {
    const product = getProduct(item.productId, sourceProducts);
    return sum + (item.unitPrice ?? product?.price ?? 0) * item.quantity;
  }, 0);
  const discount = coupon
    ? coupon.type === "percentage"
      ? subtotal * (coupon.value / 100)
      : Math.min(subtotal, coupon.value)
    : 0;
  const taxable = Math.max(0, subtotal - discount);
  const activeTaxes = taxRules.filter((tax) => tax.active && tax.rate > 0);
  const taxBreakdown = activeTaxes.map((tax) => ({
    name: tax.name,
    rate: tax.rate,
    amount: taxable * tax.rate,
  }));
  const tax = taxBreakdown.reduce((sum, taxLine) => sum + taxLine.amount, 0);
  return {
    subtotal,
    discount,
    tax,
    taxBreakdown,
    total: taxable + tax,
  };
}

export function filterOrders(orders: Order[], filters: ReportFilters) {
  return orders.filter((order) => {
    const inStart = !filters.startDate || order.businessDate >= filters.startDate;
    const inEnd = !filters.endDate || order.businessDate <= filters.endDate;
    const statusMatch = filters.status === "all" || order.status === filters.status;
    const paymentMatch =
      filters.paymentMethod === "all" || order.paymentMethod === filters.paymentMethod;
    const tableMatch =
      filters.tableNumber === "all" || String(order.tableNumber) === filters.tableNumber;
    const waiterMatch = filters.waiter === "all" || order.waiter === filters.waiter;
    return inStart && inEnd && statusMatch && paymentMatch && tableMatch && waiterMatch;
  });
}

export function summarizeOrders(orders: Order[], options: SummaryOptions = {}): ReportSummary {
  const sourceProducts = options.products ?? fallbackProducts;
  const sourceCoupons = options.coupons ?? fallbackCoupons;
  const initialPaymentTotals = paymentMethods.reduce(
    (acc, method) => ({ ...acc, [method]: 0 }),
    {} as Record<PaymentMethod, number>,
  );

  const summary = orders.reduce(
    (acc, order) => {
      const totals =
        order.totals ??
        calculateTotals(order.items, findCoupon(order.couponCode, sourceCoupons), sourceProducts, options.taxes);
      acc.subtotal += totals.subtotal;
      acc.discount += totals.discount;
      acc.tax += totals.tax;
      acc.total += totals.total;
      acc.orderCount += 1;
      if (order.paymentMethod) {
        acc.byPaymentMethod[order.paymentMethod] += totals.total;
      }

      const day = acc.byDay.find((item) => item.date === order.businessDate);
      if (day) {
        day.total += totals.total;
        day.orderCount += 1;
      } else {
        acc.byDay.push({ date: order.businessDate, total: totals.total, orderCount: 1 });
      }

      for (const item of order.items) {
        const product = getProduct(item.productId, sourceProducts);
        const existing = acc.topProducts.find((productRow) => productRow.productId === item.productId);
        const unitPrice = item.unitPrice ?? product?.price ?? 0;
        const lineTotal = unitPrice * item.quantity;
        if (existing) {
          existing.quantity += item.quantity;
          existing.total += lineTotal;
        } else {
          acc.topProducts.push({
            productId: item.productId,
            name: product?.name ?? item.productName ?? "Producto",
            quantity: item.quantity,
            total: lineTotal,
          });
        }
      }

      return acc;
    },
    {
      subtotal: 0,
      discount: 0,
      tax: 0,
      total: 0,
      expensesTotal: 0,
      payrollTotal: 0,
      netProfit: 0,
      orderCount: 0,
      averageTicket: 0,
      byPaymentMethod: initialPaymentTotals,
      byDay: [],
      topProducts: [],
    } as ReportSummary,
  );

  summary.averageTicket = summary.orderCount ? summary.total / summary.orderCount : 0;
  summary.netProfit = summary.total - summary.expensesTotal - summary.payrollTotal;
  summary.byDay.sort((a, b) => a.date.localeCompare(b.date));
  summary.topProducts.sort((a, b) => b.total - a.total);
  return summary;
}

export function createDefaultReportFilters(): ReportFilters {
  const today = new Date();
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  return {
    startDate: toDateInputValue(startOfMonth),
    endDate: toDateInputValue(today),
    status: "paid",
    paymentMethod: "all",
    tableNumber: "all",
    waiter: "all",
  };
}
