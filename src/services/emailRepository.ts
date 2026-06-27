import { isSupabaseConfigured, supabase } from "../lib/supabase";

type InvoiceEmailItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
};

type InvoiceEmailTax = {
  name: string;
  rate: number;
  amount: number;
};

export type InvoiceEmailPayload = {
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
  items: InvoiceEmailItem[];
  totals: {
    subtotal: number;
    discount: number;
    tax: number;
    total: number;
  };
  taxes: InvoiceEmailTax[];
};

export async function sendInvoiceEmail(payload: InvoiceEmailPayload) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase no esta configurado. El envio por Resend necesita una Edge Function.");
  }

  const { data, error } = await supabase.functions.invoke("send-invoice-email", {
    body: payload,
  });

  if (error) throw error;
  return data;
}
