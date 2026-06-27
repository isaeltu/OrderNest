import type {
  ActivityLog,
  Category,
  Coupon,
  Order,
  Product,
  RestaurantTable,
  User,
} from "./types";

export const users: User[] = [
  {
    id: "u-admin",
    fullName: "Admin Demo",
    email: "admin@restaurante.com",
    role: "admin",
    title: "Administrador",
  },
  {
    id: "u-waiter",
    fullName: "Juan Perez",
    email: "mesero@restaurante.com",
    role: "waiter",
    title: "Mesero",
  },
  {
    id: "u-kitchen",
    fullName: "Cocina Central",
    email: "cocina@restaurante.com",
    role: "kitchen",
    title: "Cocina",
  },
  {
    id: "u-cashier",
    fullName: "Laura Caja",
    email: "caja@restaurante.com",
    role: "cashier",
    title: "Cajero",
  },
];

export const categories: Category[] = [
  {
    id: "drinks",
    name: "Bebidas",
    description: "Bebidas frias y calientes",
    imageUrl:
      "https://images.unsplash.com/photo-1544145945-f90425340c7e?auto=format&fit=crop&w=240&q=80",
    active: true,
  },
  {
    id: "mains",
    name: "Platos Fuertes",
    description: "Platos principales del menu",
    imageUrl:
      "https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=240&q=80",
    active: true,
  },
  {
    id: "rice",
    name: "Arroces",
    description: "Variedad de arroces",
    imageUrl:
      "https://images.unsplash.com/photo-1603133872878-684f208fb84b?auto=format&fit=crop&w=240&q=80",
    active: true,
  },
  {
    id: "meats",
    name: "Carnes",
    description: "Carnes y proteinas",
    imageUrl:
      "https://images.unsplash.com/photo-1558030006-450675393462?auto=format&fit=crop&w=240&q=80",
    active: true,
  },
  {
    id: "desserts",
    name: "Postres",
    description: "Dulces de la casa",
    imageUrl:
      "https://images.unsplash.com/photo-1551024506-0bccd828d307?auto=format&fit=crop&w=240&q=80",
    active: true,
  },
];

export const products: Product[] = [
  {
    id: "coke",
    name: "Coca Cola",
    description: "Refresco regular",
    categoryId: "drinks",
    price: 120,
    imageUrl:
      "https://images.unsplash.com/photo-1629203851122-3726ecdf080e?auto=format&fit=crop&w=240&q=80",
    available: true,
    minutes: 1,
    saleUnit: "unit",
  },
  {
    id: "juice",
    name: "Jugo Natural",
    description: "Jugo de naranja natural",
    categoryId: "drinks",
    price: 150,
    imageUrl:
      "https://images.unsplash.com/photo-1600271886742-f049cd451bba?auto=format&fit=crop&w=240&q=80",
    available: true,
    minutes: 3,
    saleUnit: "unit",
  },
  {
    id: "water",
    name: "Agua",
    description: "Botella fria",
    categoryId: "drinks",
    price: 80,
    imageUrl:
      "https://images.unsplash.com/photo-1564419320461-6870880221ad?auto=format&fit=crop&w=240&q=80",
    available: true,
    minutes: 1,
    saleUnit: "unit",
  },
  {
    id: "lemonade",
    name: "Limonada",
    description: "Limonada con hierbabuena",
    categoryId: "drinks",
    price: 150,
    imageUrl:
      "https://images.unsplash.com/photo-1621263764928-df1444c5e859?auto=format&fit=crop&w=240&q=80",
    available: true,
    minutes: 4,
    saleUnit: "unit",
  },
  {
    id: "chicken",
    name: "Pollo a la Parrilla",
    description: "Pechuga marinada con guarnicion",
    categoryId: "mains",
    price: 450,
    imageUrl:
      "https://images.unsplash.com/photo-1532550907401-a500c9a57435?auto=format&fit=crop&w=240&q=80",
    available: true,
    minutes: 18,
    saleUnit: "unit",
  },
  {
    id: "beef",
    name: "Carne Guisada",
    description: "Carne suave en salsa criolla",
    categoryId: "meats",
    price: 400,
    imageUrl:
      "https://images.unsplash.com/photo-1600891964092-4316c288032e?auto=format&fit=crop&w=240&q=80",
    available: true,
    minutes: 16,
    saleUnit: "lb",
  },
  {
    id: "rice-white",
    name: "Arroz Blanco",
    description: "Arroz del dia",
    categoryId: "rice",
    price: 120,
    imageUrl:
      "https://images.unsplash.com/photo-1536304993881-ff6e9eefa2a6?auto=format&fit=crop&w=240&q=80",
    available: true,
    minutes: 8,
    saleUnit: "unit",
  },
  {
    id: "flan",
    name: "Flan de Leche",
    description: "Postre tradicional",
    categoryId: "desserts",
    price: 180,
    imageUrl:
      "https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=240&q=80",
    available: true,
    minutes: 2,
    saleUnit: "unit",
  },
];

export const tables: RestaurantTable[] = Array.from({ length: 12 }, (_, index) => {
  const number = index + 1;
  const statuses: RestaurantTable["status"][] = [
    "available",
    "available",
    "occupied",
    "occupied",
    "payment",
    "available",
    "reserved",
    "available",
    "out",
    "available",
    "available",
    "kitchen",
  ];

  return {
    id: `table-${number}`,
    number,
    capacity: number % 4 === 0 ? 6 : number % 3 === 0 ? 2 : 4,
    status: statuses[index],
    waiter: number % 2 === 0 ? "Maria" : "Juan Perez",
    occupiedMinutes: statuses[index] === "occupied" ? 30 + number * 4 : undefined,
    reservationTime: statuses[index] === "reserved" ? "7:00 PM" : undefined,
    total: statuses[index] !== "available" && statuses[index] !== "reserved" ? 690 : undefined,
  };
});

export const orders: Order[] = [
  {
    id: "1025",
    tableId: "table-5",
    tableNumber: 5,
    waiter: "Juan Perez",
    status: "new",
    items: [
      { productId: "chicken", quantity: 1, notes: "Sin sal" },
      { productId: "rice-white", quantity: 2 },
      { productId: "coke", quantity: 1 },
    ],
    createdAt: "10:23 AM",
    updatedAt: "10:23 AM",
    businessDate: "2026-06-17",
  },
  {
    id: "1024",
    tableId: "table-3",
    tableNumber: 3,
    waiter: "Maria",
    status: "preparing",
    items: [
      { productId: "beef", quantity: 1 },
      { productId: "water", quantity: 1 },
    ],
    createdAt: "10:18 AM",
    updatedAt: "10:21 AM",
    businessDate: "2026-06-17",
  },
  {
    id: "1023",
    tableId: "table-1",
    tableNumber: 1,
    waiter: "Juan Perez",
    status: "ready",
    items: [
      { productId: "chicken", quantity: 1 },
      { productId: "rice-white", quantity: 1 },
    ],
    createdAt: "10:15 AM",
    updatedAt: "10:35 AM",
    businessDate: "2026-06-17",
  },
  {
    id: "1022",
    tableId: "table-4",
    tableNumber: 4,
    waiter: "Maria",
    status: "paid",
    items: [
      { productId: "beef", quantity: 2 },
      { productId: "juice", quantity: 2 },
      { productId: "flan", quantity: 1 },
    ],
    createdAt: "09:40 AM",
    updatedAt: "10:05 AM",
    businessDate: "2026-06-17",
    paidAt: "2026-06-17T10:05:00",
    paymentMethod: "cash",
  },
  {
    id: "1021",
    tableId: "table-8",
    tableNumber: 8,
    waiter: "Juan Perez",
    status: "paid",
    items: [
      { productId: "chicken", quantity: 2 },
      { productId: "rice-white", quantity: 2 },
      { productId: "lemonade", quantity: 2 },
    ],
    couponCode: "PLATOS15",
    createdAt: "08:55 PM",
    updatedAt: "09:28 PM",
    businessDate: "2026-06-16",
    paidAt: "2026-06-16T21:28:00",
    paymentMethod: "card",
  },
  {
    id: "1020",
    tableId: "table-10",
    tableNumber: 10,
    waiter: "Maria",
    status: "paid",
    items: [
      { productId: "beef", quantity: 1 },
      { productId: "water", quantity: 2 },
      { productId: "flan", quantity: 2 },
    ],
    createdAt: "07:30 PM",
    updatedAt: "08:00 PM",
    businessDate: "2026-06-15",
    paidAt: "2026-06-15T20:00:00",
    paymentMethod: "transfer",
  },
  {
    id: "1019",
    tableId: "table-2",
    tableNumber: 2,
    waiter: "Juan Perez",
    status: "paid",
    items: [
      { productId: "chicken", quantity: 1 },
      { productId: "beef", quantity: 1 },
      { productId: "coke", quantity: 2 },
    ],
    couponCode: "POLLO50",
    createdAt: "02:15 PM",
    updatedAt: "02:52 PM",
    businessDate: "2026-06-10",
    paidAt: "2026-06-10T14:52:00",
    paymentMethod: "mixed",
  },
];

export const coupons: Coupon[] = [
  {
    id: "cp-1",
    code: "BEBIDAS10",
    name: "10% Bebidas",
    type: "percentage",
    value: 10,
    appliesTo: "Categoria: Bebidas",
    active: true,
    validity: "01/06/2026 - 31/12/2026",
  },
  {
    id: "cp-2",
    code: "PLATOS15",
    name: "15% Platos Fuertes",
    type: "percentage",
    value: 15,
    appliesTo: "Categoria: Platos Fuertes",
    active: true,
    validity: "01/06/2026 - 31/12/2026",
  },
  {
    id: "cp-3",
    code: "POLLO50",
    name: "RD$50 Pollo Parrilla",
    type: "fixed",
    value: 50,
    appliesTo: "Producto: Pollo a la Parrilla",
    active: true,
    validity: "01/06/2026 - 31/12/2026",
  },
];

export const logs: ActivityLog[] = [
  {
    id: "log-1",
    user: "Juan Perez",
    action: "SEND_ORDER_TO_KITCHEN",
    entity: "Order #1025",
    description: "Envio orden de Mesa 5 a cocina",
    createdAt: "10:23 AM",
  },
  {
    id: "log-2",
    user: "Maria",
    action: "UPDATE_ORDER_STATUS",
    entity: "Order #1024",
    description: "Marco orden como en preparacion",
    createdAt: "10:21 AM",
  },
  {
    id: "log-3",
    user: "Laura Caja",
    action: "PROCESS_PAYMENT",
    entity: "Order #1019",
    description: "Cobro factura RD$ 1,245.00",
    createdAt: "09:58 AM",
  },
];
