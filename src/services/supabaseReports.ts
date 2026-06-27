import { supabase } from "../lib/supabase";
import type { PaymentMethod, ReportFilters, ReportSummary, RestaurantTable } from "../types";

type SalesReportRow = {
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  order_count: number;
  average_ticket: number;
  cash_total: number;
  card_total: number;
  transfer_total: number;
  mixed_total: number;
};

type SalesByDayRow = {
  business_date: string;
  total: number;
  order_count: number;
};

type TopProductRow = {
  product_id: string;
  product_name: string;
  quantity: number;
  total: number;
};

type ProfitLossRow = {
  expenses_total: number;
  payroll_total: number;
  net_profit: number;
};

type ReportTableRow = {
  id: string;
  number: number;
};

type ReportWaiterRow = {
  full_name: string | null;
};

type ReportDashboardPayload = {
  summary?: Partial<SalesReportRow>;
  by_day?: SalesByDayRow[];
  top_products?: TopProductRow[];
  profit?: Partial<ProfitLossRow>;
};

let reportFiltersRequest: Promise<SupabaseReportFiltersData | null> | null = null;
let reportFiltersCache: { value: SupabaseReportFiltersData; expiresAt: number } | null = null;

export type SupabaseReportFiltersData = {
  tables: Pick<RestaurantTable, "id" | "number">[];
  waiters: string[];
};

export async function fetchSupabaseReport(filters: ReportFilters): Promise<ReportSummary | null> {
  if (!supabase) return null;

  const params = {
    p_start_date: filters.startDate || null,
    p_end_date: filters.endDate || null,
    p_status: filters.status === "all" ? null : filters.status,
    p_payment_method: filters.paymentMethod === "all" ? null : filters.paymentMethod,
    p_table_number: filters.tableNumber === "all" ? null : Number(filters.tableNumber),
    p_waiter_name: filters.waiter === "all" ? null : filters.waiter,
  };

  const { data: dashboardData, error: dashboardError } = await supabase.rpc("report_dashboard", params);
  let summary: Partial<SalesReportRow>;
  let dayRows: SalesByDayRow[];
  let productRows: TopProductRow[];
  let profit: Partial<ProfitLossRow>;

  if (!dashboardError && dashboardData) {
    const dashboard = dashboardData as ReportDashboardPayload;
    summary = dashboard.summary ?? {};
    dayRows = dashboard.by_day ?? [];
    productRows = dashboard.top_products ?? [];
    profit = dashboard.profit ?? {};
  } else {
    // Backward-compatible path while the aggregate RPC migration is pending.
    const [summaryResult, dayResult, productResult, profitResult] = await Promise.all([
      supabase.rpc("report_sales_summary", params),
      supabase.rpc("report_sales_by_day", params),
      supabase.rpc("report_top_products", params),
      supabase.rpc("report_profit_loss", {
        p_start_date: filters.startDate || null,
        p_end_date: filters.endDate || null,
      }),
    ]);
    const fallbackError = summaryResult.error ?? dayResult.error ?? productResult.error ?? profitResult.error;
    if (fallbackError) throw fallbackError;
    summary = (summaryResult.data?.[0] ?? {}) as Partial<SalesReportRow>;
    dayRows = (dayResult.data ?? []) as SalesByDayRow[];
    productRows = (productResult.data ?? []) as TopProductRow[];
    profit = (profitResult.data?.[0] ?? {}) as Partial<ProfitLossRow>;
  }
  const paymentTotals: Record<PaymentMethod, number> = {
    cash: Number(summary.cash_total ?? 0),
    card: Number(summary.card_total ?? 0),
    transfer: Number(summary.transfer_total ?? 0),
    mixed: Number(summary.mixed_total ?? 0),
  };

  return {
    subtotal: Number(summary.subtotal ?? 0),
    discount: Number(summary.discount_total ?? 0),
    tax: Number(summary.tax_total ?? 0),
    total: Number(summary.total ?? 0),
    expensesTotal: Number(profit.expenses_total ?? 0),
    payrollTotal: Number(profit.payroll_total ?? 0),
    netProfit: Number(profit.net_profit ?? Number(summary.total ?? 0)),
    orderCount: Number(summary.order_count ?? 0),
    averageTicket: Number(summary.average_ticket ?? 0),
    byPaymentMethod: paymentTotals,
    byDay: dayRows.map((row) => ({
      date: row.business_date,
      total: Number(row.total),
      orderCount: Number(row.order_count),
    })),
    topProducts: productRows.map((row) => ({
      productId: row.product_id,
      name: row.product_name,
      quantity: Number(row.quantity),
      total: Number(row.total),
    })),
  };
}

export async function fetchSupabaseReportFilters(): Promise<SupabaseReportFiltersData | null> {
  if (!supabase) return null;
  if (reportFiltersCache && reportFiltersCache.expiresAt > Date.now()) return reportFiltersCache.value;
  if (reportFiltersRequest) return reportFiltersRequest;

  reportFiltersRequest = (async () => {
    const [{ data: tableRows, error: tableError }, { data: waiterRows, error: waiterError }] = await Promise.all([
      supabase.from("restaurant_tables").select("id, number").order("number", { ascending: true }),
      supabase.from("profiles").select("full_name").order("full_name", { ascending: true }),
    ]);

    if (tableError || waiterError) throw tableError ?? waiterError;

    const value = {
      tables: ((tableRows ?? []) as ReportTableRow[]).map((table) => ({
        id: table.id,
        number: table.number,
      })),
      waiters: Array.from(
        new Set(
          ((waiterRows ?? []) as ReportWaiterRow[])
            .map((waiter) => waiter.full_name?.trim())
            .filter((name): name is string => Boolean(name)),
        ),
      ),
    };
    reportFiltersCache = { value, expiresAt: Date.now() + 60_000 };
    return value;
  })().finally(() => {
    reportFiltersRequest = null;
  });
  return reportFiltersRequest;
}
