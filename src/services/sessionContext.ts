import { supabase } from "../lib/supabase";

let restaurantIdCache: string | null = null;
let restaurantIdRequest: Promise<string> | null = null;

export function setCachedRestaurantId(restaurantId?: string | null) {
  restaurantIdCache = restaurantId || null;
}

export function clearSessionContext() {
  restaurantIdCache = null;
  restaurantIdRequest = null;
}

export async function getCurrentRestaurantId() {
  if (restaurantIdCache) return restaurantIdCache;
  if (restaurantIdRequest) return restaurantIdRequest;
  if (!supabase) throw new Error("Supabase no esta configurado.");

  restaurantIdRequest = (async () => {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    const user = sessionData.session?.user;
    if (!user) throw new Error("No authenticated user.");

    const metadataRestaurantId = user.user_metadata?.restaurant_id as string | undefined;
    if (metadataRestaurantId) {
      restaurantIdCache = metadataRestaurantId;
      return metadataRestaurantId;
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("restaurant_id")
      .eq("id", user.id)
      .single();
    if (error) throw error;
    if (!data.restaurant_id) throw new Error("Este usuario no tiene restaurante asignado.");
    restaurantIdCache = data.restaurant_id as string;
    return restaurantIdCache;
  })().finally(() => {
    restaurantIdRequest = null;
  });

  return restaurantIdRequest;
}
