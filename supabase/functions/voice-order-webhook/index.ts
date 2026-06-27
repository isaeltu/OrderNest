// Webhook receiver for orders confirmed by a phone voice AI agent (Twilio call_sid
// based). Per the agreed contract this must ALWAYS answer HTTP 200 with
// {"status":"ok","order_id":...} or {"status":"error","message":...} -- business
// errors (invalid restaurant, item not on the menu, etc.) are never surfaced as
// 4xx/5xx, since the calling system reads "message" to explain the problem by voice.
//
// All real validation (api_key -> restaurant lookup, call_sid dedupe, fuzzy item
// matching against the live menu) happens in the security-definer function
// public.voice_create_order, called here via PostgREST with the project's anon key.
// This function must be deployed with --no-verify-jwt: the Authorization header
// here carries the restaurant's own voice api_key, not a Supabase JWT.

// Browsers aren't the real caller here (a voice platform's server is), so CORS
// doesn't gate much in practice -- this only exists to match the other two
// functions' pattern instead of leaving a stray hardcoded "*".
import { checkRateLimit } from "../_shared/rateLimit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGINS") ?? "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type VoiceOrderItem = {
  name: string;
  quantity: number;
  notes?: string;
};

type VoiceOrderPayload = {
  event?: string;
  restaurant_id?: string;
  call_sid?: string;
  customer?: { name?: string; phone?: string };
  order?: {
    items?: VoiceOrderItem[];
    delivery_type?: "pickup" | "delivery";
    delivery_address?: string;
    special_instructions?: string;
  };
  created_at?: string;
};

function ok(orderId: string) {
  return new Response(JSON.stringify({ status: "ok", order_id: orderId }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(message: string) {
  return new Response(JSON.stringify({ status: "error", message }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return fail("Method not allowed, use POST.");
  }

  try {
    const apiKey = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!apiKey) {
      return fail("Falta el header Authorization: Bearer <api_key_del_restaurante>.");
    }

    const withinLimit = await checkRateLimit(`voice-order-webhook:${apiKey}`, 15);
    if (!withinLimit) {
      return fail("Demasiadas solicitudes, intenta de nuevo en un momento.");
    }

    let payload: VoiceOrderPayload;
    try {
      payload = await request.json();
    } catch {
      return fail("Body invalido: se esperaba JSON.");
    }

    const items = payload.order?.items ?? [];
    if (!Array.isArray(items) || items.length === 0) {
      return fail("El pedido debe tener al menos un producto en order.items.");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !supabaseAnonKey) {
      return fail("El servidor no esta configurado correctamente.");
    }

    const rpcResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/voice_create_order`, {
      method: "POST",
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_api_key: apiKey,
        p_restaurant_id: payload.restaurant_id ?? null,
        p_call_sid: payload.call_sid ?? null,
        p_customer_name: payload.customer?.name ?? null,
        p_customer_phone: payload.customer?.phone ?? null,
        p_items: items,
        p_delivery_type: payload.order?.delivery_type ?? null,
        p_delivery_address: payload.order?.delivery_address ?? null,
        p_special_instructions: payload.order?.special_instructions ?? null,
      }),
    });

    const result = await rpcResponse.json().catch(() => null);

    if (!rpcResponse.ok) {
      return fail(result?.message ?? "No se pudo registrar el pedido.");
    }

    const orderId = result?.orderId;
    if (!orderId) {
      return fail("No se pudo registrar el pedido.");
    }

    return ok(String(orderId));
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Error inesperado procesando el pedido.");
  }
});
