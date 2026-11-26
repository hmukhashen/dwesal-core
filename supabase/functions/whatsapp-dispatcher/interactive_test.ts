// Run: cd supabase/functions && deno test whatsapp-dispatcher/interactive_test.ts
import { toInteractive } from "./interactive.ts";

function equal(a: unknown, b: unknown) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

function throwsWith(fn: () => unknown, part: string) {
  try {
    fn();
  } catch (e) {
    if ((e as Error).message.includes(part)) return;
    throw new Error(`wrong error: ${(e as Error).message}`);
  }
  throw new Error("expected an error");
}

const buttons = {
  type: "button",
  body: { text: "اختر اللغة / Select your language:" },
  action: {
    buttons: [
      { type: "reply", reply: { id: "language_select#1", title: "العربية" } },
      { type: "reply", reply: { id: "language_select#2", title: "English" } },
    ],
  },
};

const list = {
  type: "list",
  body: { text: "How can we help you today?" },
  footer: { text: "Office" },
  action: {
    button: "Choose",
    sections: [{
      title: "Services",
      rows: Array.from(
        { length: 7 },
        (_, i) => ({ id: `welcome_en#${i + 1}`, title: `Option ${i + 1}` }),
      ),
    }],
  },
};

Deno.test("passes reply buttons and lists through unchanged", () => {
  equal(toInteractive(buttons), buttons);
  equal(toInteractive(list), list);
});

Deno.test("builds a call-to-action URL button", () => {
  const cta = {
    type: "cta_url",
    body: { text: "See the listing" },
    action: {
      name: "cta_url",
      parameters: { display_text: "Open", url: "https://example.com/u/1" },
    },
  };
  equal(toInteractive(cta), cta);
});

Deno.test("refuses what Meta would refuse, saying why", () => {
  throwsWith(
    () =>
      toInteractive({
        ...buttons,
        action: {
          buttons: [...buttons.action.buttons, ...buttons.action.buttons],
        },
      }),
    "1 to 3 buttons",
  );
  throwsWith(
    () =>
      toInteractive({
        ...buttons,
        action: {
          buttons: [{
            type: "reply",
            reply: { id: "a", title: "x".repeat(21) },
          }],
        },
      }),
    "longer than 20",
  );
  throwsWith(
    () =>
      toInteractive({
        ...list,
        action: {
          ...list.action,
          sections: [{
            title: "A",
            rows: Array.from(
              { length: 11 },
              (_, i) => ({ id: `r${i}`, title: "t" }),
            ),
          }],
        },
      }),
    "at most 10 rows",
  );
  throwsWith(() => toInteractive({ ...buttons, body: undefined }), "body");
  throwsWith(() => toInteractive({ ...buttons, type: "flow" }), "unsupported");
  throwsWith(
    () =>
      toInteractive({
        ...buttons,
        action: {
          buttons: [
            buttons.action.buttons[0],
            buttons.action.buttons[0],
          ],
        },
      }),
    "repeated",
  );
});

Deno.test("accepts every message DWESAL's default chatbot tree sends", async () => {
  // Fixture produced by DWESAL's src/lib/chatbot/engine.ts:nodeContent (optional).
  const path = Deno.env.get("DWESAL_INTERACTIVE_FIXTURE");
  if (!path) return;
  const items = JSON.parse(await Deno.readTextFile(path)) as unknown[];
  for (const item of items) equal(toInteractive(item), item);
});
