import { z } from "zod";
import { instantSchema } from "./common";
import { businessUnitCodeSchema, roleSchema, skillSchema } from "./roles";

/** GET /api/me: the signed-in person. Never includes tokens or pay. */
export const meResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.email(),
    role: roleSchema,
    image: z.string().nullable(),
  }),
  /** Staff details; null for a login without an employee row. */
  employee: z
    .object({
      id: z.string(),
      phone: z.string().nullable(),
      skills: z.array(skillSchema),
      businessUnits: z.array(businessUnitCodeSchema),
    })
    .nullable(),
  session: z.object({
    expiresAt: instantSchema,
  }),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
