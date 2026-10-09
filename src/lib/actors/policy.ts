import { z } from "zod";
import { ProviderError } from "../server/resilience";

const actorIdSchema = z.string().regex(/^\d{1,12}$/);
const localeSchema = z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/);

export function authorizePublicActorRead(actorId: string, locale = "en-US") {
  const parsedId = actorIdSchema.safeParse(actorId);
  const parsedLocale = localeSchema.safeParse(locale);
  if (!parsedId.success) throw new ProviderError("Actor was not found.", 404, "ACTOR_NOT_FOUND");
  if (!parsedLocale.success) throw new ProviderError("Invalid language selection.", 400, "INVALID_LOCALE");
  return { actorId: parsedId.data, locale: parsedLocale.data };
}