export type Role = "admin" | "waiter" | "kitchen" | "cashier";

export type TableStatus =
  | "available"
  | "occupied"
  | "kitchen"
  | "ready"
  | "payment"
  | "reserved"
  | "out";

export type OrderStatus =
  | "draft"
  | "new"
  | "preparing"
  | "ready"
  | "delivered"
  | "paid"
  | "cancelled";

export type OrderChannel = "dine_in" | "whatsapp" | "voice";

export type DiscountType = "percentage" | "fixed";

export type PaymentMethod = "cash" | "card" | "transfer" | "mixed";
export type SaleUnit = "unit" | "lb";
export type PrinterMode = "system" | "bridge";

export type ExpenseType = "operating" | "payroll" | "inventory" | "tax" | "other";

export type PayrollPaymentMethod = PaymentMethod | "bank";

export interface User {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  title: string;
}

export interface RestaurantProfile {
  id: string;
  name: string;
  rnc: string;
  phone: string;
  email: string;
  address: string;
  logoUrl: string;
  active: boolean;
}

export type TableShape = "circle" | "rect" | "bar";

export interface RestaurantTable {
  id: string;
  number: number;
  name?: string;
  capacity: number;
  status: TableStatus;
  waiter: string;
  occupiedMinutes?: number;
  reservationTime?: string;
  total?: number;
  shape?: TableShape;
  posX?: number;
  posY?: number;
  width?: number;
  height?: number;
  floor?: number;
}

export type ReservationStatus = "confirmed" | "awaited" | "cancelled" | "failed";

export interface Reservation {
  id: string;
  tableId: string;
  tableNumber: number;
  tableName?: string;
  floor: number;
  customerId?: string;
  title?: string;
  fullName: string;
  phone?: string;
  email?: string;
  paxNumber: number;
  reserveDate: string;
  reservationTime: string;
  depositFee: number;
  status: ReservationStatus;
  paymentMethod?: string;
  cardLast4?: string;
  createdAt: string;
}

export interface ReservationInput {
  tableId: string;
  fullName: string;
  paxNumber: number;
  reserveDate: string;
  reservationTime: string;
  title?: string;
  phone?: string;
  email?: string;
  depositFee?: number;
  status?: ReservationStatus;
  paymentMethod?: string;
  cardLast4?: string;
}

export interface Category {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  active: boolean;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  categoryId: string;
  price: number;
  imageUrl: string;
  available: boolean;
  minutes: number;
  saleUnit: SaleUnit;
}

export interface InventoryItem {
  id: string;
  productId: string;
  productName: string;
  productPrice: number;
  stockQuantity: number;
  reorderLevel: number;
  unitCost: number;
  supplierName: string;
  updatedAt: string;
}

export interface BusinessExpense {
  id: string;
  expenseDate: string;
  category: string;
  type: ExpenseType;
  description: string;
  amount: number;
  paymentMethod: PaymentMethod;
  vendor?: string;
}

export interface EmployeePayment {
  id: string;
  paymentDate: string;
  employeeName: string;
  role: string;
  amount: number;
  paymentMethod: PayrollPaymentMethod;
  notes?: string;
}

export interface TaxRule {
  id: string;
  name: string;
  rate: number;
  active: boolean;
}

export interface BusinessSettings {
  billingEmail: string;
  invoiceSenderName: string;
  currencyCode: string;
  currencyLocale: string;
  taxes: TaxRule[];
  printerMode: PrinterMode;
  printerEndpoint: string;
}

export interface BotSettings {
  isEnabled: boolean;
  whatsappPhoneNumberId: string;
  notificationEmail: string;
  extraPrompt: string;
}

export interface VoiceBotSettings {
  isEnabled: boolean;
  apiKey: string;
  notificationEmail: string;
  extraPrompt: string;
}

export interface StaffMember {
  id: string;
  fullName: string;
  role: Role;
  isActive: boolean;
}

export interface Customer {
  id: string;
  type: "person" | "company";
  fullName: string;
  email: string;
  rnc: string;
  phone: string;
  address: string;
  notes: string;
  createdAt: string;
}

export interface Coupon {
  id: string;
  code: string;
  name: string;
  type: DiscountType;
  value: number;
  appliesTo: string;
  active: boolean;
  validity: string;
}

export interface OrderItem {
  productId: string;
  quantity: number;
  productName?: string;
  unitPrice?: number;
  notes?: string;
}

export interface Order {
  id: string;
  orderNumber?: string;
  tableId: string | null;
  tableNumber: number;
  waiter: string;
  status: OrderStatus;
  items: OrderItem[];
  totals?: Totals;
  couponCode?: string;
  createdAt: string;
  createdAtRaw?: string;
  updatedAt: string;
  businessDate: string;
  paidAt?: string;
  paymentMethod?: PaymentMethod;
  customerId?: string;
  customerName?: string;
  customerEmail?: string;
  customerRnc?: string;
  channel?: OrderChannel;
  customerPhone?: string;
  customerDisplayName?: string;
  deliveryAddress?: string;
  cancelReason?: string;
}

export interface ActivityLog {
  id: string;
  user: string;
  action: string;
  entity: string;
  description: string;
  createdAt: string;
}

export interface Totals {
  subtotal: number;
  discount: number;
  tax: number;
  taxBreakdown: Array<{ name: string; rate: number; amount: number }>;
  total: number;
}

export interface ReportFilters {
  startDate: string;
  endDate: string;
  status: "all" | OrderStatus;
  paymentMethod: "all" | PaymentMethod;
  tableNumber: "all" | string;
  waiter: "all" | string;
}

export interface ReportSummary {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  expensesTotal: number;
  payrollTotal: number;
  netProfit: number;
  orderCount: number;
  averageTicket: number;
  byPaymentMethod: Record<PaymentMethod, number>;
  byDay: Array<{ date: string; total: number; orderCount: number }>;
  topProducts: Array<{ productId: string; name: string; quantity: number; total: number }>;
}
