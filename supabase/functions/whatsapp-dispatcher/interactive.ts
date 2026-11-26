// Outgoing interactive messages (reply buttons, lists, a call-to-action URL
// button), checked against the Cloud API's limits before the send so a bad
// row fails with a readable reason instead of Meta's generic 131009.
// https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-reply-buttons-messages
// https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-list-messages
// https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-cta-url-messages

import type { OutgoingInteractive } from "../_shared/types/whatsapp_endpoint_types.ts";

const LIMITS = {
  body: 1024,
  header: 60,
  footer: 60,
  buttons: 3,
  buttonId: 256,
  buttonTitle: 20,
  listButton: 20,
  sections: 10,
  rows: 10,
  sectionTitle: 24,
  rowId: 200,
  rowTitle: 24,
  rowDescription: 72,
  ctaText: 20,
};

type Obj = Record<string, unknown>;

function obj(v: unknown, what: string): Obj {
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    throw new Error(`Interactive message: ${what} must be an object`);
  }
  return v as Obj;
}

function str(
  v: unknown,
  what: string,
  max: number,
  required = true,
): string | undefined {
  if (v === undefined || v === null || v === "") {
    if (required) throw new Error(`Interactive message: ${what} is required`);
    return undefined;
  }
  if (typeof v !== "string") {
    throw new Error(`Interactive message: ${what} must be text`);
  }
  if ([...v].length > max) {
    throw new Error(
      `Interactive message: ${what} is longer than ${max} characters`,
    );
  }
  return v;
}

function textBlock(v: unknown, what: string, max: number) {
  if (v === undefined || v === null) return undefined;
  const text = str(obj(v, what).text, `${what} text`, max)!;
  return { text };
}

function header(v: unknown) {
  if (v === undefined || v === null) return undefined;
  const h = obj(v, "header");
  if (h.type !== "text") {
    throw new Error("Interactive message: only a text header is supported");
  }
  return {
    type: "text" as const,
    text: str(h.text, "header text", LIMITS.header)!,
  };
}

/** The message's `interactive` object as the Cloud API takes it, or an error naming what is wrong. */
export function toInteractive(data: unknown): OutgoingInteractive {
  const d = obj(data, "data");
  const body = textBlock(d.body, "body", LIMITS.body);
  if (!body) throw new Error("Interactive message: body is required");
  const common = {
    ...(d.header ? { header: header(d.header) } : {}),
    body,
    ...(d.footer
      ? { footer: textBlock(d.footer, "footer", LIMITS.footer) }
      : {}),
  };
  const action = obj(d.action, "action");

  if (d.type === "button") {
    const buttons = action.buttons;
    if (
      !Array.isArray(buttons) || buttons.length < 1 ||
      buttons.length > LIMITS.buttons
    ) {
      throw new Error(
        `Interactive message: a button message takes 1 to ${LIMITS.buttons} buttons`,
      );
    }
    const ids = new Set<string>();
    return {
      type: "button",
      ...common,
      action: {
        buttons: buttons.map((b, i) => {
          const reply = obj(
            obj(b, `button ${i + 1}`).reply,
            `button ${i + 1} reply`,
          );
          const id = str(reply.id, `button ${i + 1} id`, LIMITS.buttonId)!;
          if (ids.has(id)) {
            throw new Error(`Interactive message: button id ${id} is repeated`);
          }
          ids.add(id);
          return {
            type: "reply" as const,
            reply: {
              id,
              title: str(
                reply.title,
                `button ${i + 1} title`,
                LIMITS.buttonTitle,
              )!,
            },
          };
        }),
      },
    };
  }

  if (d.type === "list") {
    const sections = action.sections;
    if (
      !Array.isArray(sections) || sections.length < 1 ||
      sections.length > LIMITS.sections
    ) {
      throw new Error(
        `Interactive message: a list takes 1 to ${LIMITS.sections} sections`,
      );
    }
    const ids = new Set<string>();
    let rows = 0;
    const out = sections.map((s, i) => {
      const sec = obj(s, `section ${i + 1}`);
      if (!Array.isArray(sec.rows) || sec.rows.length < 1) {
        throw new Error(`Interactive message: section ${i + 1} has no rows`);
      }
      rows += sec.rows.length;
      const title = str(
        sec.title,
        `section ${i + 1} title`,
        LIMITS.sectionTitle,
        sections.length > 1,
      );
      return {
        ...(title ? { title } : {}),
        rows: sec.rows.map((r: unknown, j: number) => {
          const row = obj(r, `row ${j + 1}`);
          const id = str(row.id, `row ${j + 1} id`, LIMITS.rowId)!;
          if (ids.has(id)) {
            throw new Error(`Interactive message: row id ${id} is repeated`);
          }
          ids.add(id);
          const description = str(
            row.description,
            `row ${j + 1} description`,
            LIMITS.rowDescription,
            false,
          );
          return {
            id,
            title: str(row.title, `row ${j + 1} title`, LIMITS.rowTitle)!,
            ...(description ? { description } : {}),
          };
        }),
      };
    });
    if (rows > LIMITS.rows) {
      throw new Error(
        `Interactive message: a list takes at most ${LIMITS.rows} rows`,
      );
    }
    return {
      type: "list",
      ...common,
      action: {
        button: str(action.button, "list button", LIMITS.listButton)!,
        sections: out,
      },
    };
  }

  if (d.type === "cta_url") {
    const p = obj(action.parameters, "action parameters");
    const url = str(p.url, "url", 2000)!;
    if (!/^https?:\/\//.test(url)) {
      throw new Error("Interactive message: url must start with http(s)://");
    }
    return {
      type: "cta_url",
      ...common,
      action: {
        name: "cta_url",
        parameters: {
          display_text: str(p.display_text, "display text", LIMITS.ctaText)!,
          url,
        },
      },
    };
  }

  throw new Error(`Interactive message: unsupported type ${String(d.type)}`);
}
