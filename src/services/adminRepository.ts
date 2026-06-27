import { supabase } from "../lib/supabase";
import { getCurrentRestaurantId } from "./sessionContext";
import type {
  BotSettings,
  BusinessExpense,
  BusinessSettings,
  EmployeePayment,
  ExpenseType,
  InventoryItem,
  PaymentMethod,
  PayrollPaymentMethod,
  Product,
  RestaurantProfile,
  Role,
  StaffMember,
  TaxRule,
  VoiceBotSettings,
} from "../types";

type StaffRow = {
  id: string;
  full_name: string | null;
  is_active: boolean;
  roles: { name: Role } | Array<{ name: Role }> | null;
};

type InventoryRow = {
  id: string;
  product_id: string;
  stock_quantity: number;
  reorder_level: number;
  unit_cost: number;
  supplier_name: string | null;
  updated_at: string;
  products: { name: string; price: number } | Array<{ name: string; price: number }> | null;
};

type ExpenseRow = {
  id: string;
  expense_date: string;
  category: string;
  expense_type: ExpenseType;
  description: string;
  amount: number;
  payment_method: PaymentMethod;
  vendor: string | null;
};

type EmployeePaymentRow = {
  id: string;
  payment_date: string;
  employee_name: string;
  role_name: string | null;
  amount: number;
  payment_method: PayrollPaymentMethod;
  notes: string | null;
};

type SettingsRow = {
  billing_email: string | null;
  invoice_sender_name: string | null;
  currency_code: string | null;
  currency_locale: string | null;
  printer_mode: "system" | "bridge" | null;
  printer_endpoint: string | null;
};

type TaxRuleRow = {
  id: string;
  name: string;
  rate: number;
  is_active: boolean;
};

type RestaurantRow = {
  id: string;
  name: string;
  rnc: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  logo_url: string | null;
  is_active: boolean;
};

export type InventoryInput = {
  productId: string;
  stockQuantity: number;
  reorderLevel: number;
  unitCost: number;
  supplierName: string;
};

export type ExpenseInput = {
  expenseDate: string;
  category: string;
  type: ExpenseType;
  description: string;
  amount: number;
  paymentMethod: PaymentMethod;
  vendor: string;
};

export type EmployeePaymentInput = {
  paymentDate: string;
  employeeName: string;
  role: string;
  amount: number;
  paymentMethod: PayrollPaymentMethod;
  notes: string;
};

export type RestaurantInput = {
  name: string;
  rnc: string;
  phone: string;
  email: string;
  address: string;
  logoUrl: string;
};

export type AdminSnapshot = {
  settings: BusinessSettings;
  botSettings: BotSettings;
  voiceSettings: VoiceBotSettings;
  restaurant: RestaurantProfile;
  inventory: InventoryItem[];
  expenses: BusinessExpense[];
  employeePayments: EmployeePayment[];
  restaurants: RestaurantProfile[];
};

export type AdminSnapshotScope = {
  inventory?: boolean;
  finance?: boolean;
  restaurants?: boolean;
};

let adminSnapshotRequest: Promise<AdminSnapshot> | null = null;
let adminSnapshotCache: { value: AdminSnapshot; expiresAt: number; cacheKey: string } | null = null;

export function invalidateAdminSnapshot() {
  adminSnapshotCache = null;
}

export async function fetchAdminSnapshot(products: Product[], scope: AdminSnapshotScope = {}, force = false): Promise<AdminSnapshot> {
  const productKey = products.map((product) => product.id).sort().join("|");
  const cacheKey = `${productKey}:${scope.inventory ? 1 : 0}:${scope.finance ? 1 : 0}:${scope.restaurants ? 1 : 0}`;
  if (!force && adminSnapshotCache && adminSnapshotCache.expiresAt > Date.now() && adminSnapshotCache.cacheKey === cacheKey) {
    return adminSnapshotCache.value;
  }
  if (adminSnapshotRequest) return adminSnapshotRequest;

  adminSnapshotRequest = (async () => {
    const [settings, botSettings, voiceSettings, restaurant, inventory, expenses, employeePayments, restaurants] = await Promise.all([
      fetchBusinessSettings(),
      fetchBotSettings(),
      fetchVoiceSettings(),
      fetchCurrentRestaurant(),
      scope.inventory ? fetchInventory(products) : Promise.resolve<InventoryItem[]>([]),
      scope.finance ? fetchExpenses() : Promise.resolve<BusinessExpense[]>([]),
      scope.finance ? fetchEmployeePayments() : Promise.resolve<EmployeePayment[]>([]),
      scope.restaurants ? fetchRestaurants() : Promise.resolve<RestaurantProfile[]>([]),
    ]);
    const value = { settings, botSettings, voiceSettings, restaurant, inventory, expenses, employeePayments, restaurants };
    adminSnapshotCache = { value, expiresAt: Date.now() + 2_000, cacheKey };
    return value;
  })().finally(() => {
    adminSnapshotRequest = null;
  });
  return adminSnapshotRequest;
}

function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase no esta configurado.");
  }
  return supabase;
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function mapRestaurant(row: RestaurantRow): RestaurantProfile {
  return {
    id: row.id,
    name: row.name,
    rnc: row.rnc ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    address: row.address ?? "",
    logoUrl: row.logo_url ?? "",
    active: row.is_active,
  };
}

export async function fetchCurrentRestaurant(): Promise<RestaurantProfile> {
  if (!supabase) {
    return {
      id: "local-restaurant",
      name: localStorage.getItem("restopos.restaurantName") ?? "Restaurante Demo",
      rnc: localStorage.getItem("restopos.restaurantRnc") ?? "101-00000-1",
      phone: localStorage.getItem("restopos.restaurantPhone") ?? "809-000-0000",
      email: localStorage.getItem("restopos.restaurantEmail") ?? "admin@restaurante.com",
      address: localStorage.getItem("restopos.restaurantAddress") ?? "Santo Domingo, Republica Dominicana",
      logoUrl: localStorage.getItem("restopos.restaurantLogoUrl") ?? "",
      active: true,
    };
  }

  const client = requireSupabase();
  const restaurantId = await getCurrentRestaurantId();
  const { data, error } = await client
    .from("restaurants")
    .select("id, name, rnc, phone, email, address, logo_url, is_active")
    .eq("id", restaurantId)
    .single();
  if (error) throw error;
  return mapRestaurant(data as RestaurantRow);
}

export async function saveCurrentRestaurant(input: RestaurantInput) {
  if (!supabase) {
    localStorage.setItem("restopos.restaurantName", input.name);
    localStorage.setItem("restopos.restaurantRnc", input.rnc);
    localStorage.setItem("restopos.restaurantPhone", input.phone);
    localStorage.setItem("restopos.restaurantEmail", input.email);
    localStorage.setItem("restopos.restaurantAddress", input.address);
    localStorage.setItem("restopos.restaurantLogoUrl", input.logoUrl);
    return;
  }

  const client = requireSupabase();
  const restaurantId = await getCurrentRestaurantId();
  const { error } = await client
    .from("restaurants")
    .update({
      name: input.name,
      rnc: input.rnc || null,
      phone: input.phone || null,
      email: input.email || null,
      address: input.address || null,
      logo_url: input.logoUrl || null,
    })
    .eq("id", restaurantId);
  if (error) throw error;
}

export async function fetchRestaurants(): Promise<RestaurantProfile[]> {
  if (!supabase) return [await fetchCurrentRestaurant()];

  const client = requireSupabase();
  const { data, error } = await client
    .from("restaurants")
    .select("id, name, rnc, phone, email, address, logo_url, is_active")
    .order("name", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as RestaurantRow[]).map(mapRestaurant);
}

export async function createRestaurant(input: RestaurantInput): Promise<string> {
  if (!supabase) return `local-restaurant-${Date.now()}`;

  const client = requireSupabase();
  const { data, error } = await client.rpc("create_restaurant", {
    p_name: input.name,
    p_rnc: input.rnc || null,
    p_phone: input.phone || null,
    p_email: input.email || null,
    p_address: input.address || null,
    p_logo_url: input.logoUrl || null,
  });
  if (error) throw error;
  return data as string;
}

export async function fetchStaffMembers(): Promise<StaffMember[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("profiles")
    .select("id, full_name, is_active, roles(name)")
    .order("full_name", { ascending: true });
  if (error) throw error;

  return ((data ?? []) as unknown as StaffRow[]).map((row) => {
    const role = firstRelation(row.roles);
    return {
      id: row.id,
      fullName: row.full_name ?? "Sin nombre",
      role: role?.name ?? "waiter",
      isActive: row.is_active,
    };
  });
}

export async function updateStaffRole(profileId: string, role: Role) {
  const client = requireSupabase();
  const { error } = await client.rpc("update_staff_role", {
    p_profile_id: profileId,
    p_role: role,
  });
  if (error) throw error;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("No se pudo leer el logo seleccionado."));
    reader.readAsDataURL(file);
  });
}

function logoPath(restaurantId: string, file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  return `${restaurantId}/logo-${Date.now()}.${extension}`;
}

function storageUploadError(error: unknown, bucketName: string) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lowerMessage = message.toLowerCase();

  if (
    lowerMessage.includes("bucket") &&
    (lowerMessage.includes("not found") ||
      lowerMessage.includes("not exist") ||
      lowerMessage.includes("not available") ||
      lowerMessage.includes("no encontrado"))
  ) {
    return new Error(
      `El bucket ${bucketName} no existe en Supabase Storage. Ejecuta la migracion 202606180005_restaurant_logo_storage.sql.`,
    );
  }

  if (
    lowerMessage.includes("row-level security") ||
    lowerMessage.includes("policy") ||
    lowerMessage.includes("permission") ||
    lowerMessage.includes("unauthorized") ||
    lowerMessage.includes("not authorized")
  ) {
    return new Error(
      `No tienes permiso para subir al bucket ${bucketName}. Revisa las politicas de Storage y que tu rol tenga MANAGE_SETTINGS.`,
    );
  }

  return error instanceof Error ? error : new Error(message || `No se pudo subir el archivo a ${bucketName}.`);
}

export async function uploadRestaurantLogo(file: File, restaurantId?: string): Promise<string> {
  if (!supabase) return readFileAsDataUrl(file);

  const client = requireSupabase();
  const targetRestaurantId = restaurantId ?? (await getCurrentRestaurantId());
  const path = logoPath(targetRestaurantId, file);
  const { error } = await client.storage.from("restaurant-logos").upload(path, file, {
    cacheControl: "3600",
    contentType: file.type || "image/png",
    upsert: true,
  });
  if (error) throw storageUploadError(error, "restaurant-logos");

  const { data } = client.storage.from("restaurant-logos").getPublicUrl(path);
  return data.publicUrl;
}

export async function updateRestaurantLogo(restaurantId: string, logoUrl: string) {
  if (!supabase) return;

  const client = requireSupabase();
  const { error } = await client.rpc("set_restaurant_logo", {
    p_restaurant_id: restaurantId,
    p_logo_url: logoUrl || null,
  });
  if (error) throw error;
}

export async function fetchInventory(products: Product[]): Promise<InventoryItem[]> {
  if (!supabase) {
    return products.map((product) => ({
      id: `local-${product.id}`,
      productId: product.id,
      productName: product.name,
      productPrice: product.price,
      stockQuantity: 0,
      reorderLevel: 0,
      unitCost: 0,
      supplierName: "",
      updatedAt: "",
    }));
  }

  const { data, error } = await supabase
    .from("inventory_items")
    .select("id, product_id, stock_quantity, reorder_level, unit_cost, supplier_name, updated_at, products(name, price)")
    .order("updated_at", { ascending: false });
  if (error) throw error;

  const rows = ((data ?? []) as unknown as InventoryRow[]).map((row) => {
    const product = firstRelation(row.products);
    return {
      id: row.id,
      productId: row.product_id,
      productName: product?.name ?? "Producto",
      productPrice: Number(product?.price ?? 0),
      stockQuantity: Number(row.stock_quantity),
      reorderLevel: Number(row.reorder_level),
      unitCost: Number(row.unit_cost),
      supplierName: row.supplier_name ?? "",
      updatedAt: row.updated_at,
    };
  });

  const configured = new Set(rows.map((row) => row.productId));
  const missing = products
    .filter((product) => !configured.has(product.id))
    .map((product) => ({
      id: `missing-${product.id}`,
      productId: product.id,
      productName: product.name,
      productPrice: product.price,
      stockQuantity: 0,
      reorderLevel: 0,
      unitCost: 0,
      supplierName: "",
      updatedAt: "",
    }));

  return [...rows, ...missing].sort((a, b) => a.productName.localeCompare(b.productName));
}

export async function saveInventoryItem(input: InventoryInput) {
  const client = requireSupabase();
  const restaurantId = await getCurrentRestaurantId();
  const { error } = await client.from("inventory_items").upsert(
    {
      restaurant_id: restaurantId,
      product_id: input.productId,
      stock_quantity: input.stockQuantity,
      reorder_level: input.reorderLevel,
      unit_cost: input.unitCost,
      supplier_name: input.supplierName || null,
    },
    { onConflict: "restaurant_id,product_id" },
  );
  if (error) throw error;
}

export async function fetchExpenses(): Promise<BusinessExpense[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("business_expenses")
    .select("id, expense_date, category, expense_type, description, amount, payment_method, vendor")
    .order("expense_date", { ascending: false });
  if (error) throw error;

  return ((data ?? []) as ExpenseRow[]).map((row) => ({
    id: row.id,
    expenseDate: row.expense_date,
    category: row.category,
    type: row.expense_type,
    description: row.description,
    amount: Number(row.amount),
    paymentMethod: row.payment_method,
    vendor: row.vendor ?? undefined,
  }));
}

export async function createExpense(input: ExpenseInput) {
  const client = requireSupabase();
  const restaurantId = await getCurrentRestaurantId();
  const { error } = await client.from("business_expenses").insert({
    restaurant_id: restaurantId,
    expense_date: input.expenseDate,
    category: input.category,
    expense_type: input.type,
    description: input.description,
    amount: input.amount,
    payment_method: input.paymentMethod,
    vendor: input.vendor || null,
  });
  if (error) throw error;
}

export async function deleteExpense(expenseId: string) {
  const client = requireSupabase();
  const { error } = await client.from("business_expenses").delete().eq("id", expenseId);
  if (error) throw error;
}

export async function fetchEmployeePayments(): Promise<EmployeePayment[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("employee_payments")
    .select("id, payment_date, employee_name, role_name, amount, payment_method, notes")
    .order("payment_date", { ascending: false });
  if (error) throw error;

  return ((data ?? []) as EmployeePaymentRow[]).map((row) => ({
    id: row.id,
    paymentDate: row.payment_date,
    employeeName: row.employee_name,
    role: row.role_name ?? "",
    amount: Number(row.amount),
    paymentMethod: row.payment_method,
    notes: row.notes ?? undefined,
  }));
}

export async function createEmployeePayment(input: EmployeePaymentInput) {
  const client = requireSupabase();
  const restaurantId = await getCurrentRestaurantId();
  const { error } = await client.from("employee_payments").insert({
    restaurant_id: restaurantId,
    payment_date: input.paymentDate,
    employee_name: input.employeeName,
    role_name: input.role || null,
    amount: input.amount,
    payment_method: input.paymentMethod,
    notes: input.notes || null,
  });
  if (error) throw error;
}

export async function deleteEmployeePayment(paymentId: string) {
  const client = requireSupabase();
  const { error } = await client.from("employee_payments").delete().eq("id", paymentId);
  if (error) throw error;
}

export async function fetchBusinessSettings(): Promise<BusinessSettings> {
  if (!supabase) {
    return {
      billingEmail: localStorage.getItem("restopos.billingEmail") ?? "",
      invoiceSenderName: localStorage.getItem("restopos.invoiceSenderName") ?? "RestoPOS",
      currencyCode: localStorage.getItem("restopos.currencyCode") ?? "DOP",
      currencyLocale: localStorage.getItem("restopos.currencyLocale") ?? "es-DO",
      taxes: JSON.parse(localStorage.getItem("restopos.taxes") ?? "[]") as TaxRule[],
      printerMode: (localStorage.getItem("restopos.printerMode") as "system" | "bridge" | null) ?? "system",
      printerEndpoint: localStorage.getItem("restopos.printerEndpoint") ?? "",
    };
  }

  const [{ data, error }, { data: taxRows, error: taxError }] = await Promise.all([
    supabase
    .from("business_settings")
    .select("billing_email, invoice_sender_name, currency_code, currency_locale, printer_mode, printer_endpoint")
    .maybeSingle(),
    supabase
      .from("tax_rules")
      .select("id, name, rate, is_active")
      .order("name", { ascending: true }),
  ]);
  if (error || taxError) throw error ?? taxError;

  const row = data as SettingsRow | null;
  return {
    billingEmail: row?.billing_email ?? "",
    invoiceSenderName: row?.invoice_sender_name ?? "RestoPOS",
    currencyCode: row?.currency_code ?? "DOP",
    currencyLocale: row?.currency_locale ?? "es-DO",
    printerMode: row?.printer_mode ?? "system",
    printerEndpoint: row?.printer_endpoint ?? "",
    taxes: ((taxRows ?? []) as TaxRuleRow[]).map((tax) => ({
      id: tax.id,
      name: tax.name,
      rate: Number(tax.rate),
      active: tax.is_active,
    })),
  };
}

export async function saveBusinessSettings(settings: BusinessSettings) {
  if (!supabase) {
    localStorage.setItem("restopos.billingEmail", settings.billingEmail);
    localStorage.setItem("restopos.invoiceSenderName", settings.invoiceSenderName);
    localStorage.setItem("restopos.currencyCode", settings.currencyCode);
    localStorage.setItem("restopos.currencyLocale", settings.currencyLocale);
    localStorage.setItem("restopos.taxes", JSON.stringify(settings.taxes));
    localStorage.setItem("restopos.printerMode", settings.printerMode);
    localStorage.setItem("restopos.printerEndpoint", settings.printerEndpoint);
    return;
  }

  const client = requireSupabase();
  const restaurantId = await getCurrentRestaurantId();
  const { error } = await client.from("business_settings").upsert(
    {
      restaurant_id: restaurantId,
      billing_email: settings.billingEmail || null,
      invoice_sender_name: settings.invoiceSenderName || "RestoPOS",
      currency_code: settings.currencyCode || "DOP",
      currency_locale: settings.currencyLocale || "es-DO",
      printer_mode: settings.printerMode || "system",
      printer_endpoint: settings.printerEndpoint || null,
    },
    { onConflict: "restaurant_id" },
  );
  if (error) throw error;

  for (const tax of settings.taxes) {
    if (tax.id.startsWith("local-")) {
      const { error: taxInsertError } = await client.from("tax_rules").insert({
        restaurant_id: restaurantId,
        name: tax.name,
        rate: tax.rate,
        is_active: tax.active,
      });
      if (taxInsertError) throw taxInsertError;
    } else {
      const { error: taxUpdateError } = await client
        .from("tax_rules")
        .update({
          name: tax.name,
          rate: tax.rate,
          is_active: tax.active,
        })
        .eq("id", tax.id);
      if (taxUpdateError) throw taxUpdateError;
    }
  }
}

type BotSettingsRow = {
  is_enabled: boolean;
  whatsapp_phone_number_id: string | null;
  notification_email: string | null;
  extra_prompt: string | null;
};

export async function fetchBotSettings(): Promise<BotSettings> {
  if (!supabase) {
    return {
      isEnabled: localStorage.getItem("restopos.bot.isEnabled") === "true",
      whatsappPhoneNumberId: localStorage.getItem("restopos.bot.phoneNumberId") ?? "",
      notificationEmail: localStorage.getItem("restopos.bot.notificationEmail") ?? "",
      extraPrompt: localStorage.getItem("restopos.bot.extraPrompt") ?? "",
    };
  }

  const client = requireSupabase();
  const { data, error } = await client
    .from("restaurant_bot_settings")
    .select("is_enabled, whatsapp_phone_number_id, notification_email, extra_prompt")
    .maybeSingle();
  if (error) throw error;

  const row = data as BotSettingsRow | null;
  return {
    isEnabled: row?.is_enabled ?? false,
    whatsappPhoneNumberId: row?.whatsapp_phone_number_id ?? "",
    notificationEmail: row?.notification_email ?? "",
    extraPrompt: row?.extra_prompt ?? "",
  };
}

export async function saveBotSettings(settings: BotSettings) {
  if (!supabase) {
    localStorage.setItem("restopos.bot.isEnabled", String(settings.isEnabled));
    localStorage.setItem("restopos.bot.phoneNumberId", settings.whatsappPhoneNumberId);
    localStorage.setItem("restopos.bot.notificationEmail", settings.notificationEmail);
    localStorage.setItem("restopos.bot.extraPrompt", settings.extraPrompt);
    return;
  }

  const client = requireSupabase();
  const restaurantId = await getCurrentRestaurantId();
  const { error } = await client.from("restaurant_bot_settings").upsert(
    {
      restaurant_id: restaurantId,
      is_enabled: settings.isEnabled,
      whatsapp_phone_number_id: settings.whatsappPhoneNumberId || null,
      notification_email: settings.notificationEmail || null,
      extra_prompt: settings.extraPrompt || "",
    },
    { onConflict: "restaurant_id" },
  );
  if (error) throw error;
}

type VoiceSettingsRow = {
  is_enabled: boolean;
  api_key: string | null;
  notification_email: string | null;
  extra_prompt: string | null;
};

export async function fetchVoiceSettings(): Promise<VoiceBotSettings> {
  if (!supabase) {
    return {
      isEnabled: localStorage.getItem("restopos.voiceBot.isEnabled") === "true",
      apiKey: localStorage.getItem("restopos.voiceBot.apiKey") ?? "",
      notificationEmail: localStorage.getItem("restopos.voiceBot.notificationEmail") ?? "",
      extraPrompt: localStorage.getItem("restopos.voiceBot.extraPrompt") ?? "",
    };
  }

  const client = requireSupabase();
  const { data, error } = await client
    .from("restaurant_voice_settings")
    .select("is_enabled, api_key, notification_email, extra_prompt")
    .maybeSingle();
  if (error) throw error;

  const row = data as VoiceSettingsRow | null;
  return {
    isEnabled: row?.is_enabled ?? false,
    apiKey: row?.api_key ?? "",
    notificationEmail: row?.notification_email ?? "",
    extraPrompt: row?.extra_prompt ?? "",
  };
}

export async function saveVoiceSettings(settings: VoiceBotSettings) {
  if (!supabase) {
    localStorage.setItem("restopos.voiceBot.isEnabled", String(settings.isEnabled));
    localStorage.setItem("restopos.voiceBot.notificationEmail", settings.notificationEmail);
    localStorage.setItem("restopos.voiceBot.extraPrompt", settings.extraPrompt);
    return;
  }

  const client = requireSupabase();
  const restaurantId = await getCurrentRestaurantId();
  const { error } = await client.from("restaurant_voice_settings").upsert(
    {
      restaurant_id: restaurantId,
      is_enabled: settings.isEnabled,
      notification_email: settings.notificationEmail || null,
      extra_prompt: settings.extraPrompt || "",
    },
    { onConflict: "restaurant_id" },
  );
  if (error) throw error;
}

export async function regenerateVoiceApiKey(): Promise<string> {
  if (!supabase) {
    const newKey = `voice_local_${Math.random().toString(16).slice(2)}`;
    localStorage.setItem("restopos.voiceBot.apiKey", newKey);
    return newKey;
  }

  const client = requireSupabase();
  const { data, error } = await client.rpc("regenerate_voice_api_key");
  if (error) throw error;
  return data as string;
}
