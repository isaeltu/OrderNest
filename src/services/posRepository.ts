import { supabase } from "../lib/supabase";
import { categories as fallbackCategories, products as fallbackProducts } from "../data";
import { clearSessionContext, getCurrentRestaurantId, setCachedRestaurantId } from "./sessionContext";
import type {
  Category,
  Coupon,
  Customer,
  DiscountType,
  Order,
  OrderStatus,
  PaymentMethod,
  Product,
  Reservation,
  ReservationInput,
  ReservationStatus,
  SaleUnit,
  RestaurantTable,
  Role,
  TableShape,
  TableStatus,
  User,
} from "../types";

type TableRow = {
  id: string;
  number: number;
  name: string | null;
  capacity: number;
  status: RestaurantTable["status"];
  shape: TableShape | null;
  pos_x: number | null;
  pos_y: number | null;
  width: number | null;
  height: number | null;
  floor: number | null;
};

type ReservationRow = {
  id: string;
  table_id: string;
  customer_id: string | null;
  title: string | null;
  full_name: string;
  phone: string | null;
  email: string | null;
  pax_number: number;
  reserve_date: string;
  reservation_time: string;
  deposit_fee: number;
  status: ReservationStatus;
  payment_method: string | null;
  card_last4: string | null;
  created_at: string;
  restaurant_tables: { number: number; name: string | null; floor: number } | Array<{ number: number; name: string | null; floor: number }> | null;
};

type CategoryRow = {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  is_active: boolean;
};

type ProductRow = {
  id: string;
  name: string;
  description: string | null;
  category_id: string;
  price: number;
  image_url: string | null;
  is_available: boolean;
  estimated_minutes: number;
  sale_unit: SaleUnit;
};

type OrderItemInput = {
  productId: string;
  quantity: number;
  unitPrice: number;
  notes?: string;
};

type CouponRow = {
  id: string;
  code: string;
  name: string;
  discount_type: DiscountType;
  discount_value: number;
  is_active: boolean;
  start_date: string | null;
  end_date: string | null;
};

type OrderRow = {
  id: string;
  order_number: string | null;
  customer_id: string | null;
  table_id: string | null;
  status: OrderStatus;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  business_date: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  cancel_reason: string | null;
  channel: Order["channel"];
  customer_phone: string | null;
  customer_display_name: string | null;
  delivery_address: string | null;
  restaurant_tables: { number: number } | Array<{ number: number }> | null;
  profiles: { full_name: string | null } | Array<{ full_name: string | null }> | null;
  customers:
    | { full_name: string | null; email: string | null; rnc: string | null }
    | Array<{ full_name: string | null; email: string | null; rnc: string | null }>
    | null;
  payments: Array<{ payment_method: PaymentMethod }> | null;
  order_items: OrderItemRow[] | null;
};

type OrderItemRow = {
  order_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  notes: string | null;
  products: { name: string | null } | Array<{ name: string | null }> | null;
};

type ProfileRow = {
  full_name: string | null;
  restaurant_id?: string | null;
};

type CustomerRow = {
  id: string;
  customer_type: "person" | "company" | null;
  full_name: string;
  email: string | null;
  rnc: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  created_at: string;
};

type PosData = {
  tables: RestaurantTable[];
  categories: Category[];
  products: Product[];
  coupons: Coupon[];
  orders: Order[];
};

let posDataRequest: Promise<PosData> | null = null;
let posDataCache: { value: PosData; expiresAt: number } | null = null;
let customerRequest: Promise<Customer[]> | null = null;
let customerCache: { value: Customer[]; expiresAt: number } | null = null;
let userProfileRequest: Promise<User> | null = null;
let userProfileCache: { value: User; userId: string; expiresAt: number } | null = null;

export function invalidatePosDataCache() {
  posDataCache = null;
}

export function invalidateCustomerCache() {
  customerCache = null;
}

export type CustomerInput = {
  type: "person" | "company";
  fullName: string;
  email: string;
  rnc: string;
  phone: string;
  address: string;
  notes: string;
};

export type CategoryInput = {
  name: string;
  description: string;
  imageUrl: string;
};

export type ProductInput = {
  name: string;
  description: string;
  categoryId: string;
  price: number;
  imageUrl: string;
  available: boolean;
  minutes: number;
  saleUnit: SaleUnit;
};

export type CouponInput = {
  code: string;
  name: string;
  type: DiscountType;
  value: number;
  active: boolean;
};

export type TableInput = {
  number: number;
  capacity: number;
  status: TableStatus;
};

function findFallbackImage(items: Array<{ name: string; imageUrl: string }>, name: string) {
  return items.find((item) => item.name.toLowerCase() === name.toLowerCase())?.imageUrl ?? "";
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("No se pudo leer la imagen seleccionada."));
    reader.readAsDataURL(file);
  });
}

function storageImagePath(restaurantId: string, folder: string, file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  return `${restaurantId}/${folder}/image-${Date.now()}.${extension}`;
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
  }
  return supabase;
}

export async function signInWithPassword(email: string, password: string) {
  const client = requireSupabase();
  userProfileCache = null;
  userProfileRequest = null;
  clearSessionContext();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function fetchCurrentUserProfile(): Promise<User> {
  const client = requireSupabase();
  const {
    data: { session },
    error: sessionError,
  } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  const user = session?.user;
  if (!user) throw new Error("No authenticated user.");
  if (userProfileCache && userProfileCache.userId === user.id && userProfileCache.expiresAt > Date.now()) {
    return userProfileCache.value;
  }
  if (userProfileRequest) return userProfileRequest;

  userProfileRequest = (async () => {
    const [{ data: profile, error: profileError }, { data: roleName, error: roleError }] = await Promise.all([
      client.from("profiles").select("full_name, restaurant_id").eq("id", user.id).single(),
      client.rpc("current_role_name"),
    ]);
    if (profileError || roleError) throw profileError ?? roleError;
    const profileRow = profile as ProfileRow;
    setCachedRestaurantId(profileRow.restaurant_id);
    const role = roleName as Role;
    if (!["admin", "waiter", "kitchen", "cashier"].includes(role)) {
      throw new Error(`El perfil de ${user.email ?? "este usuario"} no tiene un rol valido asignado.`);
    }
    const value: User = {
      id: user.id,
      fullName: profileRow.full_name ?? user.email ?? "Usuario",
      email: user.email ?? "",
      role,
      title:
        role === "admin"
          ? "Administrador"
          : role === "kitchen"
            ? "Cocina"
            : role === "cashier"
              ? "Cajero"
              : "Mesero",
    };
    userProfileCache = { value, userId: user.id, expiresAt: Date.now() + 30_000 };
    return value;
  })().finally(() => {
    userProfileRequest = null;
  });
  return userProfileRequest;
}

export async function fetchStoredSessionUser(): Promise<User | null> {
  const client = requireSupabase();
  const {
    data: { session },
    error,
  } = await client.auth.getSession();
  if (error) throw error;
  if (!session) return null;

  return fetchCurrentUserProfile();
}

export async function signOut() {
  const client = requireSupabase();
  const { error } = await client.auth.signOut();
  if (error) throw error;
  userProfileCache = null;
  userProfileRequest = null;
  clearSessionContext();
}

export async function requestPasswordReset(email: string) {
  const client = requireSupabase();
  const { error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
  });
  if (error) throw error;
}

export async function updateMyProfile(input: { fullName: string; email?: string; password?: string }) {
  const client = requireSupabase();
  const { error: profileError } = await client.rpc("update_my_profile", {
    p_full_name: input.fullName,
  });
  if (profileError) throw profileError;

  if (input.email || input.password) {
    const { error: authError } = await client.auth.updateUser({
      ...(input.email ? { email: input.email } : {}),
      ...(input.password ? { password: input.password } : {}),
    });
    if (authError) throw authError;
  }

  userProfileCache = null;
}

export async function fetchTables(): Promise<RestaurantTable[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("restaurant_tables")
    .select("id, number, name, capacity, status, shape, pos_x, pos_y, width, height, floor")
    .order("number", { ascending: true });
  if (error) throw error;

  return ((data ?? []) as TableRow[]).map((table) => ({
    id: table.id,
    number: table.number,
    name: table.name ?? undefined,
    capacity: table.capacity,
    status: table.status,
    waiter: "",
    shape: table.shape ?? undefined,
    posX: table.pos_x ?? undefined,
    posY: table.pos_y ?? undefined,
    width: table.width ?? undefined,
    height: table.height ?? undefined,
    floor: table.floor ?? 1,
  }));
}

export async function fetchCategories(): Promise<Category[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("categories")
    .select("id, name, description, image_url, is_active")
    .eq("is_active", true)
    .order("display_order", { ascending: true });
  if (error) throw error;

  return ((data ?? []) as CategoryRow[]).map((category) => ({
    id: category.id,
    name: category.name,
    description: category.description ?? "",
    imageUrl: category.image_url ?? findFallbackImage(fallbackCategories, category.name),
    active: category.is_active,
  }));
}

export async function fetchProducts(): Promise<Product[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("products")
    .select("id, name, description, category_id, price, image_url, is_available, estimated_minutes, sale_unit")
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (error) throw error;

  return ((data ?? []) as ProductRow[]).map((product) => ({
    id: product.id,
    name: product.name,
    description: product.description ?? "",
    categoryId: product.category_id,
    price: Number(product.price),
    imageUrl: product.image_url ?? findFallbackImage(fallbackProducts, product.name),
    available: product.is_available,
    minutes: product.estimated_minutes,
    saleUnit: product.sale_unit ?? "unit",
  }));
}

export async function fetchCoupons(): Promise<Coupon[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("coupons")
    .select("id, code, name, discount_type, discount_value, is_active, start_date, end_date")
    .order("code", { ascending: true });
  if (error) throw error;

  return ((data ?? []) as CouponRow[]).map((coupon) => ({
    id: coupon.id,
    code: coupon.code,
    name: coupon.name,
    type: coupon.discount_type,
    value: Number(coupon.discount_value),
    appliesTo: "Restaurante",
    active: coupon.is_active,
    validity: `${coupon.start_date?.slice(0, 10) ?? "Sin inicio"} - ${coupon.end_date?.slice(0, 10) ?? "Sin fin"}`,
  }));
}

export async function fetchOrders(): Promise<Order[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("orders")
    .select(
      `
      id,
      order_number,
      customer_id,
      table_id,
      status,
      subtotal,
      discount_total,
      tax_total,
      total,
      business_date,
      created_at,
      updated_at,
      closed_at,
      cancel_reason,
      channel,
      customer_phone,
      customer_display_name,
      delivery_address,
      restaurant_tables(number),
      profiles(full_name),
      customers(full_name, email, rnc),
      payments(payment_method),
      order_items(product_id, quantity, unit_price, notes, products(name))
    `,
    )
    .neq("status", "cancelled")
    .order("created_at", { ascending: false });
  if (error) throw error;

  return ((data ?? []) as unknown as OrderRow[]).map((order) => {
    const table = firstRelation(order.restaurant_tables);
    const waiter = firstRelation(order.profiles);
    const customer = firstRelation(order.customers);
    const payment = firstRelation(order.payments);
    const orderItems = order.order_items ?? [];

    return {
      id: order.id,
      orderNumber: order.order_number ?? undefined,
      tableId: order.table_id,
      tableNumber: table?.number ?? 0,
      waiter: waiter?.full_name ?? "Sin mesero",
      status: order.status,
      totals: {
        subtotal: Number(order.subtotal),
        discount: Number(order.discount_total),
        tax: Number(order.tax_total),
        taxBreakdown: Number(order.tax_total)
          ? [{ name: "Impuestos", rate: 0, amount: Number(order.tax_total) }]
          : [],
        total: Number(order.total),
      },
      items: orderItems.map((item) => {
        const product = firstRelation(item.products);
        return {
          productId: item.product_id,
          quantity: item.quantity,
          unitPrice: Number(item.unit_price),
          productName: product?.name ?? "Producto",
          notes: item.notes ?? undefined,
        };
      }),
      createdAt: new Date(order.created_at).toLocaleTimeString("es-DO", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      createdAtRaw: order.created_at,
      updatedAt: new Date(order.updated_at).toLocaleTimeString("es-DO", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      businessDate: order.business_date,
      paidAt: order.closed_at ?? undefined,
      paymentMethod: payment?.payment_method,
      customerId: order.customer_id ?? undefined,
      customerName: customer?.full_name ?? undefined,
      customerEmail: customer?.email ?? undefined,
      customerRnc: customer?.rnc ?? undefined,
      channel: order.channel,
      customerPhone: order.customer_phone ?? undefined,
      customerDisplayName: order.customer_display_name ?? undefined,
      deliveryAddress: order.delivery_address ?? undefined,
      cancelReason: order.cancel_reason ?? undefined,
    };
  });
}

export async function fetchCustomers(force = false): Promise<Customer[]> {
  if (!force && customerCache && customerCache.expiresAt > Date.now()) return customerCache.value;
  if (customerRequest) return customerRequest;
  const client = requireSupabase();
  customerRequest = (async () => {
    const { data, error } = await client
      .from("customers")
      .select("id, customer_type, full_name, email, rnc, phone, address, notes, created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    const value = ((data ?? []) as CustomerRow[]).map((customer) => ({
      id: customer.id,
      type: customer.customer_type ?? "person" as const,
      fullName: customer.full_name,
      email: customer.email ?? "",
      rnc: customer.rnc ?? "",
      phone: customer.phone ?? "",
      address: customer.address ?? "",
      notes: customer.notes ?? "",
      createdAt: customer.created_at,
    }));
    customerCache = { value, expiresAt: Date.now() + 10_000 };
    return value;
  })().finally(() => {
    customerRequest = null;
  });
  return customerRequest;
}

export async function fetchPosData(force = false): Promise<PosData> {
  if (!force && posDataCache && posDataCache.expiresAt > Date.now()) return posDataCache.value;
  if (posDataRequest) return posDataRequest;
  posDataRequest = (async () => {
    const [tables, categories, products, coupons, orders] = await Promise.all([
      fetchTables(),
      fetchCategories(),
      fetchProducts(),
      fetchCoupons(),
      fetchOrders(),
    ]);
    const value = { tables, categories, products, coupons, orders };
    posDataCache = { value, expiresAt: Date.now() + 2_000 };
    return value;
  })().finally(() => {
    posDataRequest = null;
  });
  return posDataRequest;
}

export async function createOrder(tableId: string, items: OrderItemInput[]) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("create_order_with_items", {
    p_table_id: tableId,
    p_items: items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      notes: item.notes ?? null,
    })),
  });
  if (error) throw error;
  invalidatePosDataCache();
  return data as string;
}

export async function upsertCustomer(input: CustomerInput): Promise<string> {
  const client = requireSupabase();
  const { data, error } = await client.rpc("upsert_customer", {
    p_customer_type: input.type,
    p_full_name: input.fullName,
    p_email: input.email || null,
    p_rnc: input.rnc || null,
    p_phone: input.phone || null,
    p_notes: input.notes || null,
    p_address: input.address || null,
  });
  if (error) throw error;
  invalidateCustomerCache();
  return data as string;
}

export async function assignOrderCustomer(orderId: string, customerId: string) {
  const client = requireSupabase();
  const { error } = await client.rpc("assign_order_customer", {
    p_order_id: orderId,
    p_customer_id: customerId,
  });
  if (error) throw error;
}

export async function replaceOrderItems(orderId: string, items: OrderItemInput[]) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("replace_order_items", {
    p_order_id: orderId,
    p_items: items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      notes: item.notes ?? null,
    })),
    p_status: "new",
  });
  if (error) throw error;
  return data as string;
}

export async function sendOrderToKitchen(orderId: string) {
  return updateOrderStatus(orderId, "new");
}

export async function updateOrderStatus(orderId: string, status: OrderStatus) {
  const client = requireSupabase();
  const { error } = await client.rpc("update_kitchen_order_status", {
    p_order_id: orderId,
    p_status: status,
  });
  if (error) throw error;
}

export async function cancelOrder(orderId: string, reason: string) {
  const client = requireSupabase();
  const { error } = await client.rpc("cancel_order", {
    p_order_id: orderId,
    p_reason: reason,
  });
  if (error) throw error;
  invalidatePosDataCache();
}

export async function fetchReservations(): Promise<Reservation[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("reservations")
    .select(
      "id, table_id, customer_id, title, full_name, phone, email, pax_number, reserve_date, reservation_time, deposit_fee, status, payment_method, card_last4, created_at, restaurant_tables(number, name, floor)",
    )
    .order("reserve_date", { ascending: true })
    .order("reservation_time", { ascending: true });
  if (error) throw error;

  return ((data ?? []) as unknown as ReservationRow[]).map((reservation) => {
    const table = firstRelation(reservation.restaurant_tables);
    return {
      id: reservation.id,
      tableId: reservation.table_id,
      tableNumber: table?.number ?? 0,
      tableName: table?.name ?? undefined,
      floor: table?.floor ?? 1,
      customerId: reservation.customer_id ?? undefined,
      title: reservation.title ?? undefined,
      fullName: reservation.full_name,
      phone: reservation.phone ?? undefined,
      email: reservation.email ?? undefined,
      paxNumber: reservation.pax_number,
      reserveDate: reservation.reserve_date,
      reservationTime: reservation.reservation_time,
      depositFee: Number(reservation.deposit_fee),
      status: reservation.status,
      paymentMethod: reservation.payment_method ?? undefined,
      cardLast4: reservation.card_last4 ?? undefined,
      createdAt: reservation.created_at,
    };
  });
}

export async function createReservation(input: ReservationInput): Promise<string> {
  const client = requireSupabase();
  const { data, error } = await client.rpc("create_reservation", {
    p_table_id: input.tableId,
    p_full_name: input.fullName,
    p_pax_number: input.paxNumber,
    p_reserve_date: input.reserveDate,
    p_reservation_time: input.reservationTime,
    p_title: input.title || null,
    p_phone: input.phone || null,
    p_email: input.email || null,
    p_deposit_fee: input.depositFee ?? 0,
    p_status: input.status ?? "confirmed",
    p_payment_method: input.paymentMethod || null,
    p_card_last4: input.cardLast4 || null,
  });
  if (error) throw error;
  return data as string;
}

export async function updateReservationStatus(reservationId: string, status: ReservationStatus) {
  const client = requireSupabase();
  const { error } = await client.rpc("update_reservation_status", {
    p_reservation_id: reservationId,
    p_status: status,
  });
  if (error) throw error;
}

export async function changeReservationTable(reservationId: string, tableId: string) {
  const client = requireSupabase();
  const { error } = await client.rpc("change_reservation_table", {
    p_reservation_id: reservationId,
    p_table_id: tableId,
  });
  if (error) throw error;
}

export async function processPayment(
  orderId: string,
  paymentMethod: PaymentMethod,
  amountPaid: number,
  customer?: { email?: string; name?: string },
) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("process_payment", {
    p_order_id: orderId,
    p_payment_method: paymentMethod,
    p_amount_paid: amountPaid,
    p_customer_email: customer?.email || null,
    p_customer_name: customer?.name || null,
  });
  if (error) throw error;
  return data as string;
}

export async function updateTableStatus(tableId: string, status: TableStatus) {
  const client = requireSupabase();
  const { error } = await client.from("restaurant_tables").update({ status }).eq("id", tableId);
  if (error) throw error;
}

export async function createCategory(input: CategoryInput) {
  const client = requireSupabase();
  const restaurantId = await getCurrentRestaurantId();
  const { error } = await client.from("categories").insert({
    restaurant_id: restaurantId,
    name: input.name,
    description: input.description,
    image_url: input.imageUrl || null,
    is_active: true,
  });
  if (error) throw error;
}

export async function updateCategory(categoryId: string, input: CategoryInput) {
  const client = requireSupabase();
  const { error } = await client
    .from("categories")
    .update({
      name: input.name,
      description: input.description,
      image_url: input.imageUrl || null,
    })
    .eq("id", categoryId);
  if (error) throw error;
}

export async function deleteCategory(categoryId: string) {
  const client = requireSupabase();
  const { error } = await client.from("categories").update({ is_active: false }).eq("id", categoryId);
  if (error) throw error;
}

export async function createProduct(input: ProductInput) {
  const client = requireSupabase();
  const restaurantId = await getCurrentRestaurantId();
  const { error } = await client.from("products").insert({
    restaurant_id: restaurantId,
    category_id: input.categoryId,
    name: input.name,
    description: input.description,
    price: input.price,
    image_url: input.imageUrl || null,
    is_available: input.available,
    is_active: true,
    estimated_minutes: input.minutes,
    sale_unit: input.saleUnit,
  });
  if (error) throw error;
}

export async function uploadProductImage(file: File): Promise<string> {
  if (!supabase) return readFileAsDataUrl(file);

  const client = requireSupabase();
  const restaurantId = await getCurrentRestaurantId();
  const path = storageImagePath(restaurantId, "products", file);
  const { error } = await client.storage.from("product-images").upload(path, file, {
    cacheControl: "3600",
    contentType: file.type || "image/png",
    upsert: true,
  });
  if (error) throw error;

  const { data } = client.storage.from("product-images").getPublicUrl(path);
  return data.publicUrl;
}

export async function updateProduct(productId: string, input: ProductInput) {
  const client = requireSupabase();
  const { error } = await client
    .from("products")
    .update({
      category_id: input.categoryId,
      name: input.name,
      description: input.description,
      price: input.price,
      image_url: input.imageUrl || null,
      is_available: input.available,
      estimated_minutes: input.minutes,
      sale_unit: input.saleUnit,
    })
    .eq("id", productId);
  if (error) throw error;
}

export async function deleteProduct(productId: string) {
  const client = requireSupabase();
  const { error } = await client
    .from("products")
    .update({ is_active: false, is_available: false })
    .eq("id", productId);
  if (error) throw error;
}

export async function createCoupon(input: CouponInput) {
  const client = requireSupabase();
  const restaurantId = await getCurrentRestaurantId();
  const { error } = await client.from("coupons").insert({
    restaurant_id: restaurantId,
    code: input.code.toUpperCase(),
    name: input.name,
    discount_type: input.type,
    discount_value: input.value,
    is_active: input.active,
  });
  if (error) throw error;
}

export async function updateCoupon(couponId: string, input: CouponInput) {
  const client = requireSupabase();
  const { error } = await client
    .from("coupons")
    .update({
      code: input.code.toUpperCase(),
      name: input.name,
      discount_type: input.type,
      discount_value: input.value,
      is_active: input.active,
    })
    .eq("id", couponId);
  if (error) throw error;
}

export async function deleteCoupon(couponId: string) {
  const client = requireSupabase();
  const { error } = await client.from("coupons").update({ is_active: false }).eq("id", couponId);
  if (error) throw error;
}

export async function createTable(input: TableInput) {
  const client = requireSupabase();
  const restaurantId = await getCurrentRestaurantId();
  const { error } = await client.from("restaurant_tables").insert({
    restaurant_id: restaurantId,
    number: input.number,
    capacity: input.capacity,
    status: input.status,
  });
  if (error) throw error;
}

export async function updateTable(tableId: string, input: TableInput) {
  const client = requireSupabase();
  const { error } = await client
    .from("restaurant_tables")
    .update({
      number: input.number,
      capacity: input.capacity,
      status: input.status,
    })
    .eq("id", tableId);
  if (error) throw error;
}

export async function deleteTable(tableId: string) {
  const client = requireSupabase();
  const { error } = await client.from("restaurant_tables").delete().eq("id", tableId);
  if (error) throw error;
}

export type TableLayoutInput = Partial<{
  shape: TableShape;
  posX: number;
  posY: number;
  width: number;
  height: number;
}>;

export async function updateTableLayout(tableId: string, layout: TableLayoutInput) {
  const client = requireSupabase();
  const payload: Record<string, unknown> = {};
  if (layout.shape !== undefined) payload.shape = layout.shape;
  if (layout.posX !== undefined) payload.pos_x = layout.posX;
  if (layout.posY !== undefined) payload.pos_y = layout.posY;
  if (layout.width !== undefined) payload.width = layout.width;
  if (layout.height !== undefined) payload.height = layout.height;

  const { error } = await client.from("restaurant_tables").update(payload).eq("id", tableId);
  if (error) throw error;
}

export function subscribeToKitchenChanges(onOperationalChange: () => void, onInventoryChange?: () => void) {
  const client = requireSupabase();
  let operationalTimer: ReturnType<typeof setTimeout> | undefined;
  let inventoryTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleOperationalChange = () => {
    if (operationalTimer) clearTimeout(operationalTimer);
    operationalTimer = setTimeout(onOperationalChange, 650);
  };
  const scheduleInventoryChange = () => {
    if (!onInventoryChange) return;
    if (inventoryTimer) clearTimeout(inventoryTimer);
    inventoryTimer = setTimeout(onInventoryChange, 650);
  };
  const channel = client
    .channel("kitchen-orders")
    .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, scheduleOperationalChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, scheduleOperationalChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, scheduleOperationalChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "restaurant_tables" }, scheduleOperationalChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "inventory_items" }, scheduleInventoryChange)
    .subscribe();

  return () => {
    if (operationalTimer) clearTimeout(operationalTimer);
    if (inventoryTimer) clearTimeout(inventoryTimer);
    void client.removeChannel(channel);
  };
}
