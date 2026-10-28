export const transportMessageSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://fable.local/schemas/vertical-slice-transport.v1.json",
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "campaignId", "role", "token"],
      properties: {
        type: { const: "hello" },
        campaignId: { type: "string", minLength: 1, maxLength: 120 },
        role: { enum: ["gm", "player"] },
        token: { type: "string", minLength: 1, maxLength: 2_000 },
        actorId: { type: "string", minLength: 1, maxLength: 120 },
        resumeToken: { type: "string", minLength: 1, maxLength: 240 },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "command"],
      properties: {
        type: { const: "command" },
        command: {
          oneOf: [
            {
              type: "object",
              additionalProperties: false,
              required: ["kind", "requestId", "direction"],
              properties: {
                kind: { const: "player.move" },
                requestId: { type: "string", minLength: 1, maxLength: 120 },
                direction: { enum: ["up", "down", "left", "right"] },
                clientRevision: { type: "integer", minimum: 0 },
              },
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["kind", "requestId", "paused"],
              properties: {
                kind: { const: "gm.pause" },
                requestId: { type: "string", minLength: 1, maxLength: 120 },
                paused: { type: "boolean" },
              },
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["kind", "requestId", "outcome", "reason"],
              properties: {
                kind: { const: "gm.end_expedition" },
                requestId: { type: "string", minLength: 1, maxLength: 120 },
                outcome: { enum: ["success", "retreat", "defeat", "gm_abort"] },
                reason: { type: "string", minLength: 1, maxLength: 1_000 },
              },
            },
          ],
        },
      },
    },
  ],
} as const;
