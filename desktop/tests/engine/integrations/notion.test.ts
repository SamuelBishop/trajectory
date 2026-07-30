/**
 * Every payload here is invented: made-up page IDs, made-up task titles, a
 * made-up database. Nothing was recorded from a real workspace
 * ([HC-NO-PRIVATE-DATA-COMMITS]), and no test in this file touches the network.
 */

import { describe, expect, it } from "vitest";

import {
  NotionAccessError,
  NotionRateLimitError,
  NotionTasksAdapter,
  checkboxesIn,
  dateStart,
  domainFor,
  isComplete,
  normalizeDatabaseId,
  occurredAt,
  optionName,
  plainText,
  signalId,
} from "../../../src/engine/integrations/notion";
import { notionConfigSchema } from "../../../src/engine/integrations/policy";
import { activitySignalSchema } from "../../../src/engine/domain";

const now = new Date("2026-03-10T09:00:00.000Z");
const DATABASE = "11112222333344445555666677778888";
const HYPHENATED = "11112222-3333-4444-5555-666677778888";

function config(overrides: Record<string, unknown> = {}) {
  return notionConfigSchema.parse({
    database_id: DATABASE,
    default_domain: "career",
    ...overrides,
  });
}

function page(overrides: Record<string, unknown> = {}) {
  return {
    id: "aaaabbbb-cccc-dddd-eeee-ffff00001111",
    url: "https://www.notion.so/Ship-the-importer-aaaabbbbccccddddeeeeffff00001111",
    last_edited_time: "2026-03-09T18:22:11.000Z",
    properties: {
      Name: { type: "title", title: [{ plain_text: "Ship the importer" }] },
      Status: { type: "status", status: { name: "Done" } },
      Due: { type: "date", date: { start: "2026-03-08" } },
    },
    ...overrides,
  };
}

/** Records every request so the tests can assert on what was actually sent. */
function recorder(
  replies: { status?: number; body?: unknown; headers?: Record<string, string> }[],
) {
  const urls: string[] = [];
  const headers: Record<string, string>[] = [];
  const bodies: Record<string, unknown>[] = [];
  let call = 0;
  const httpFetch = ((url: string, init?: RequestInit) => {
    urls.push(url);
    headers.push((init?.headers ?? {}) as Record<string, string>);
    bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    const reply = replies[Math.min(call, replies.length - 1)] ?? {};
    call += 1;
    return Promise.resolve(
      new Response(JSON.stringify(reply.body ?? { results: [] }), {
        status: reply.status ?? 200,
        headers: reply.headers ?? {},
      }),
    );
  }) as unknown as typeof fetch;
  return { urls, headers, bodies, httpFetch };
}

function results(pages: unknown[], extra: Record<string, unknown> = {}) {
  return { body: { results: pages, has_more: false, next_cursor: null, ...extra } };
}

function adapter(
  overrides: Record<string, unknown>,
  httpFetch: typeof fetch,
): NotionTasksAdapter {
  return new NotionTasksAdapter(
    () => Promise.resolve(config(overrides)),
    httpFetch,
    () => now,
  );
}

/**
 * Assert that a call rejected, and hand back the error.
 *
 * A bare `.catch()` would let a call that unexpectedly *succeeded* slip through
 * as a passing test.
 */
async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error("Expected the call to reject, but it resolved.");
}

describe("Notion database identifiers", () => {
  it("accepts the URL people actually copy", () => {
    expect(
      normalizeDatabaseId(
        `https://www.notion.so/myspace/Tasks-${DATABASE}?v=99998888777766665555444433332222`,
      ),
    ).toBe(HYPHENATED);
  });

  it("takes the database from the path rather than the view in the query string", () => {
    // Both are 32-hex. Taking the last match anywhere in the string would read
    // the view ID and query an object that is not the user's database.
    const view = "99998888777766665555444433332222";
    expect(
      normalizeDatabaseId(`https://www.notion.so/Tasks-${DATABASE}?v=${view}`),
    ).not.toContain("9999");
  });

  it("accepts a bare hyphenated ID unchanged", () => {
    expect(normalizeDatabaseId(HYPHENATED)).toBe(HYPHENATED);
  });

  it("rejects text that is not an identifier", () => {
    expect(normalizeDatabaseId("my tasks")).toBe("");
    expect(normalizeDatabaseId("")).toBe("");
  });
});

describe("Notion property readers", () => {
  it("joins the runs Notion splits text into", () => {
    expect(
      plainText({
        type: "title",
        title: [{ plain_text: "Ship the " }, { plain_text: "importer" }],
      }),
    ).toBe("Ship the importer");
  });

  it("reads a name from a status, a select, or a multi-select", () => {
    expect(optionName({ type: "status", status: { name: "Done" } })).toBe("Done");
    expect(optionName({ type: "select", select: { name: "career" } })).toBe("career");
    expect(
      optionName({ type: "multi_select", multi_select: [{ name: "running" }] }),
    ).toBe("running");
    expect(optionName({ type: "select", select: null })).toBeNull();
  });

  it("reduces a date property to a calendar date", () => {
    expect(dateStart({ type: "date", date: { start: "2026-03-08T14:00:00Z" } })).toBe(
      "2026-03-08",
    );
    expect(dateStart({ type: "date", date: null })).toBeNull();
  });

  it("turns a Notion page ID into a signal ID", () => {
    expect(signalId("aaaabbbb-cccc-dddd-eeee-ffff00001111")).toBe(
      "notion_aaaabbbbcccc",
    );
  });
});

describe("deciding whether a task is finished", () => {
  it("matches a configured done value regardless of case", () => {
    expect(isComplete(page(), config())).toBe(true);
    expect(
      isComplete(
        page({
          properties: {
            Status: { type: "status", status: { name: "COMPLETE" } },
          },
        }),
        config(),
      ),
    ).toBe(true);
  });

  it("reads a ticked checkbox as done", () => {
    expect(
      isComplete(
        page({ properties: { Done: { type: "checkbox", checkbox: true } } }),
        config({ status_property: "Done" }),
      ),
    ).toBe(true);
  });

  it("separates a blank status from an absent status column", () => {
    // Blank means the task is open. Absent means the configured column does not
    // exist, which is a configuration error rather than a fact about the task,
    // and collapsing the two would filter every task away without saying why.
    expect(
      isComplete(
        page({ properties: { Status: { type: "status", status: null } } }),
        config(),
      ),
    ).toBe(false);
    expect(
      isComplete(page({ properties: { Name: { type: "title", title: [] } } }), config()),
    ).toBeNull();
  });
});

describe("dating a task", () => {
  it("prefers the completion date over the due date when both exist", () => {
    const withBoth = page({
      properties: {
        ...page().properties,
        "Completed on": { type: "date", date: { start: "2026-03-09" } },
      },
    });
    expect(
      occurredAt(withBoth, config({ completed_property: "Completed on" }), true),
    ).toBe("2026-03-09");
  });

  it("dates an open task by when it is due", () => {
    expect(occurredAt(page(), config(), false)).toBe("2026-03-08");
  });

  it("falls back to the last edit rather than dropping the task", () => {
    const undated = page({
      properties: { Name: { type: "title", title: [{ plain_text: "Untitled" }] } },
    });
    expect(occurredAt(undated, config(), true)).toBe("2026-03-09");
  });
});

describe("choosing a domain", () => {
  it("reads the mapped column before the configured default", () => {
    const tagged = page({
      properties: {
        ...page().properties,
        Area: { type: "select", select: { name: "Running" } },
      },
    });
    expect(domainFor(tagged, config({ domain_property: "Area" }))).toBe("running");
  });

  it("falls back to the default domain when the column is blank", () => {
    expect(domainFor(page(), config({ domain_property: "Area" }))).toBe("career");
  });
});

function dailyPage(overrides: Record<string, unknown> = {}) {
  return {
    id: "dddd1111-2222-3333-4444-555566667777",
    url: "https://www.notion.so/July-30-dddd111122223333444455556666777",
    last_edited_time: "2026-07-30T21:00:00.000Z",
    properties: {
      Name: { type: "title", title: [{ plain_text: "July 30" }] },
      Date: { type: "date", date: { start: "2026-07-30" } },
    },
    ...overrides,
  };
}

function todo(id: string, text: string, checked: boolean, hasChildren = false) {
  return {
    id,
    type: "to_do",
    has_children: hasChildren,
    to_do: { rich_text: [{ plain_text: text }], checked },
  };
}

/** Routes the database query and the per-page block reads to separate replies. */
function daily(pages: unknown[], blocksById: Record<string, unknown[]>) {
  const urls: string[] = [];
  const httpFetch = ((url: string) => {
    urls.push(url);
    if (url.includes("/query")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ results: pages, has_more: false, next_cursor: null }),
        ),
      );
    }
    const id = /\/v1\/blocks\/([^/]+)\/children/.exec(url)?.[1] ?? "";
    return Promise.resolve(
      new Response(
        JSON.stringify({
          results: blocksById[id] ?? [],
          has_more: false,
          next_cursor: null,
        }),
      ),
    );
  }) as unknown as typeof fetch;
  return { urls, httpFetch };
}

describe("reading checkboxes out of a page body", () => {
  it("keeps to-do blocks and ignores every other block type", () => {
    const blocks = [
      { id: "b1", type: "paragraph" },
      todo("b2", "Ship the importer", true),
      { id: "b3", type: "heading_2" },
      todo("b4", "Write the retro", false),
    ];
    expect(checkboxesIn(blocks)).toEqual([
      { id: "b2", text: "Ship the importer", checked: true },
      { id: "b4", text: "Write the retro", checked: false },
    ]);
  });

  it("drops a box with no text rather than storing a blank task", () => {
    expect(checkboxesIn([todo("b1", "   ", true)])).toEqual([]);
  });
});

describe("the Notion tasks adapter in daily-page mode", () => {
  const checkboxConfig = { task_source: "checkboxes" as const, lookback_days: 1 };

  it("dates every box by the page's date column, not by the page title", async () => {
    // "July 30" carries no year. Dating from the title means guessing one, and
    // guessing wrong files this week's work under a previous year.
    const { httpFetch } = daily([dailyPage()], {
      "dddd1111-2222-3333-4444-555566667777": [
        todo("aaaa1111bbbb2222cccc333344445555", "Ship the importer", true),
      ],
    });
    const signals = await adapter(checkboxConfig, httpFetch).fetch(
      null,
      "secret_token",
    );

    expect(signals).toHaveLength(1);
    const signal = activitySignalSchema.parse(signals[0]);
    expect(signal.summary).toBe("Ship the importer");
    expect(signal.occurred_at).toBe("2026-07-30");
    expect(signal.kind).toBe("task");
  });

  it("records whether each box was ticked, so a plan cannot read as done", async () => {
    // The whole reason open boxes are safe to collect. Without this field an
    // aspiration and an achievement are the same record.
    const { httpFetch } = daily([dailyPage()], {
      "dddd1111-2222-3333-4444-555566667777": [
        todo("aaaa1111bbbb2222cccc333344445555", "Shipped the adapter", true),
        todo("bbbb1111cccc2222dddd333344445555", "Strava integration", false),
      ],
    });
    const signals = await adapter(
      { ...checkboxConfig, include_open_tasks: true },
      httpFetch,
    ).fetch(null, "secret_token");

    expect(
      signals.map((entry) => [entry.summary, entry.completed]),
    ).toEqual([
      ["Shipped the adapter", true],
      ["Strava integration", false],
    ]);
  });

  it("leaves unticked boxes out unless they are asked for", async () => {
    const blocks = {
      "dddd1111-2222-3333-4444-555566667777": [
        todo("aaaa1111bbbb2222cccc333344445555", "Ship the importer", true),
        todo("bbbb1111cccc2222dddd333344445555", "Write the retro", false),
      ],
    };
    const first = daily([dailyPage()], blocks);
    expect(
      await adapter(checkboxConfig, first.httpFetch).fetch(null, "secret_token"),
    ).toHaveLength(1);

    const second = daily([dailyPage()], blocks);
    expect(
      await adapter(
        { ...checkboxConfig, include_open_tasks: true },
        second.httpFetch,
      ).fetch(null, "secret_token"),
    ).toHaveLength(2);
  });

  it("says so when every box was thrown away by a setting", async () => {
    // A planning page starts out entirely unticked, so this is the normal first
    // run. Reporting success with nothing stored is indistinguishable from an
    // empty page, and which one happened is the thing the user cannot see.
    const { httpFetch } = daily([dailyPage()], {
      "dddd1111-2222-3333-4444-555566667777": [
        todo("aaaa1111bbbb2222cccc333344445555", "Strava", false),
        todo("bbbb1111cccc2222dddd333344445555", "Screen Time", false),
      ],
    });
    const error = await rejection(
      adapter(checkboxConfig, httpFetch).fetch(null, "secret_token"),
    );

    expect(error.message).toContain("Found 2 checkboxes");
    expect(error.message).toContain("Also collect boxes that are not ticked");
  });

  it("stays quiet when some boxes were ticked", async () => {
    // Skipping unticked boxes is the point of the setting. Only a run that
    // stored nothing at all is worth interrupting the user for.
    const { httpFetch } = daily([dailyPage()], {
      "dddd1111-2222-3333-4444-555566667777": [
        todo("aaaa1111bbbb2222cccc333344445555", "Shipped it", true),
        todo("bbbb1111cccc2222dddd333344445555", "Strava", false),
      ],
    });

    expect(
      await adapter(checkboxConfig, httpFetch).fetch(null, "secret_token"),
    ).toHaveLength(1);
  });

  it("reports a wrong date property ahead of the unticked boxes", async () => {
    // Both faults are present at once on a misconfigured first run. The date
    // property is the one that corrupts every record, so hiding it behind the
    // easier message would send the user to fix the wrong thing.
    const { httpFetch } = daily(
      [
        dailyPage({
          properties: {
            Name: { type: "title", title: [{ plain_text: "July 30" }] },
            Day: { type: "date", date: { start: "2026-07-30" } },
          },
        }),
      ],
      {
        "dddd1111-2222-3333-4444-555566667777": [
          todo("aaaa1111bbbb2222cccc333344445555", "Strava", false),
        ],
      },
    );
    const error = await rejection(
      adapter(checkboxConfig, httpFetch).fetch(null, "secret_token"),
    );

    expect(error.message).toContain('date property named "Date"');
  });

  it("walks into a toggle rather than missing the list inside it", async () => {
    // A daily note usually keeps its to-dos under a heading or inside a toggle,
    // so a flat read of the top level would find almost nothing.
    const { httpFetch } = daily([dailyPage()], {
      "dddd1111-2222-3333-4444-555566667777": [
        { id: "toggle-1", type: "toggle", has_children: true },
      ],
      "toggle-1": [todo("aaaa1111bbbb2222cccc333344445555", "Nested task", true)],
    });
    const signals = await adapter(checkboxConfig, httpFetch).fetch(
      null,
      "secret_token",
    );

    expect(signals.map((entry) => entry.summary)).toEqual(["Nested task"]);
  });

  it("does not store the daily page itself as a task", async () => {
    // The row is a date, not something you did. Emitting it would put "July 30"
    // in the mentor's context as an accomplishment.
    const { httpFetch } = daily([dailyPage()], {
      "dddd1111-2222-3333-4444-555566667777": [
        todo("aaaa1111bbbb2222cccc333344445555", "Ship the importer", true),
      ],
    });
    const signals = await adapter(checkboxConfig, httpFetch).fetch(
      null,
      "secret_token",
    );

    expect(signals.map((entry) => entry.summary)).not.toContain("July 30");
  });

  it("names the real columns when the date property matches none", async () => {
    const { httpFetch } = daily(
      [
        dailyPage({
          properties: {
            Name: { type: "title", title: [{ plain_text: "July 30" }] },
            Day: { type: "date", date: { start: "2026-07-30" } },
          },
        }),
      ],
      {},
    );
    const error = await rejection(
      adapter(checkboxConfig, httpFetch).fetch(null, "secret_token"),
    );

    expect(error.message).toContain('date property named "Date"');
    expect(error.message).toContain("Day");
  });

  it("keeps a page whose body cannot be read from failing the whole sync", async () => {
    // A daily note can hold a linked database or a synced block the integration
    // cannot see. Losing that day's boxes is much cheaper than losing the month.
    const httpFetch = ((url: string) => {
      if (String(url).includes("/query")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              results: [dailyPage(), dailyPage({ id: "eeee1111-2222-3333-4444-555566667777" })],
              has_more: false,
              next_cursor: null,
            }),
          ),
        );
      }
      if (String(url).includes("dddd1111")) {
        return Promise.resolve(new Response("{}", { status: 403 }));
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            results: [todo("aaaa1111bbbb2222cccc333344445555", "Survived", true)],
            has_more: false,
            next_cursor: null,
          }),
        ),
      );
    }) as unknown as typeof fetch;

    const signals = await adapter(checkboxConfig, httpFetch).fetch(
      null,
      "secret_token",
    );
    expect(signals.map((entry) => entry.summary)).toEqual(["Survived"]);
  });
});

describe("the Notion tasks adapter", () => {
  it("maps a completed task to a signal the schema accepts", async () => {
    const { httpFetch } = recorder([results([page()])]);
    const signals = await adapter({}, httpFetch).fetch(null, "secret_token");

    expect(signals).toHaveLength(1);
    const signal = activitySignalSchema.parse(signals[0]);
    expect(signal.kind).toBe("task");
    expect(signal.summary).toBe("Ship the importer");
    expect(signal.occurred_at).toBe("2026-03-09");
    expect(signal.domain).toBe("career");
    expect(signal.integration_id).toBe("notion");
    expect(signal.provenance.manually_reviewed).toBe(false);
  });

  it("resolves property names the user configured", async () => {
    const custom = page({
      properties: {
        Task: { type: "title", title: [{ plain_text: "Write the retro" }] },
        State: { type: "select", select: { name: "Shipped" } },
        Area: { type: "select", select: { name: "Projects" } },
      },
    });
    const { httpFetch } = recorder([results([custom])]);
    const signals = await adapter(
      {
        title_property: "Task",
        status_property: "State",
        done_values: ["Shipped"],
        domain_property: "Area",
      },
      httpFetch,
    ).fetch(null, "secret_token");

    expect(signals).toHaveLength(1);
    expect(signals[0]?.summary).toBe("Write the retro");
    expect(signals[0]?.domain).toBe("projects");
    expect(signals[0]?.completed).toBe(true);
  });

  it("leaves open tasks out unless they are asked for", async () => {
    const open = page({
      properties: {
        ...page().properties,
        Status: { type: "status", status: { name: "In progress" } },
      },
    });
    const { httpFetch } = recorder([results([open])]);
    expect(await adapter({}, httpFetch).fetch(null, "secret_token")).toHaveLength(0);

    const { httpFetch: second } = recorder([results([open])]);
    const collected = await adapter({ include_open_tasks: true }, second).fetch(
      null,
      "secret_token",
    );
    expect(collected).toHaveLength(1);
    // Row mode already worked out completion to decide whether to store the
    // task, then threw the answer away. Keeping it is what lets an open task be
    // collected without being mistaken for a finished one.
    expect(collected[0]?.completed).toBe(false);
  });

  it("follows the cursor through a multi-page response", async () => {
    const { httpFetch, bodies } = recorder([
      { body: { results: [page()], has_more: true, next_cursor: "cursor-two" } },
      {
        body: {
          results: [page({ id: "22223333-4444-5555-6666-777788889999" })],
          has_more: false,
          next_cursor: null,
        },
      },
    ]);
    const signals = await adapter({}, httpFetch).fetch(null, "secret_token");

    expect(signals).toHaveLength(2);
    expect(bodies[0]?.["start_cursor"]).toBeUndefined();
    expect(bodies[1]?.["start_cursor"]).toBe("cursor-two");
  });

  it("sends the pinned API version", async () => {
    const { httpFetch, headers } = recorder([results([page()])]);
    await adapter({}, httpFetch).fetch(null, "secret_token");

    // Unpinned, Notion's 2025-09-03 would move this endpoint to /v1/data_sources
    // and the adapter would start returning nothing.
    expect(headers[0]?.["Notion-Version"]).toBe("2022-06-28");
  });

  it("contacts only api.notion.com", async () => {
    const { httpFetch, urls } = recorder([results([page()])]);
    await adapter({}, httpFetch).fetch(null, "secret_token");

    expect(urls).not.toHaveLength(0);
    for (const url of urls) {
      expect(new URL(url).host).toBe("api.notion.com");
    }
  });

  it("sends only a filter and a cursor, never user content", async () => {
    const { httpFetch, bodies } = recorder([results([page()])]);
    await adapter({}, httpFetch).fetch(null, "secret_token");

    // The whole justification for the network exemption is that adapters send a
    // credential and a query and receive data back. Freezing the request body
    // is what keeps that checkable rather than aspirational.
    expect(Object.keys(bodies[0] ?? {}).sort()).toEqual([
      "filter",
      "page_size",
      "sorts",
    ]);
    expect(bodies[0]?.["filter"]).toEqual({
      timestamp: "last_edited_time",
      last_edited_time: { on_or_after: "2026-03-03" },
    });
  });

  it("resumes from the last sync rather than the lookback window", async () => {
    const { httpFetch, bodies } = recorder([results([page()])]);
    await adapter({}, httpFetch).fetch("2026-01-05", "secret_token");

    // Clamping to the horizon here would silently lose everything edited during
    // a fortnight away from the app: newer than the last sync, older than the
    // window, so nothing ever asks for it again.
    expect(bodies[0]?.["filter"]).toMatchObject({
      last_edited_time: { on_or_after: "2026-01-05" },
    });
  });

  it("keeps a two-day window on the user's calendar, not UTC's", async () => {
    // 18:00 in Denver is already tomorrow in UTC. A horizon derived from
    // toISOString therefore starts a day late, which on a week is invisible and
    // on a daily-review window drops yesterday entirely — every evening, at the
    // hour someone actually sits down to look back at their day.
    const evening = new Date("2026-07-30T18:00:00-06:00");
    const { httpFetch, bodies } = recorder([results([page()])]);
    await new NotionTasksAdapter(
      () => Promise.resolve(config({ lookback_days: 1 })),
      httpFetch,
      () => evening,
    ).fetch(null, "secret_token");

    expect(bodies[0]?.["filter"]).toMatchObject({
      last_edited_time: { on_or_after: "2026-07-29" },
    });
  });

  it("makes no request when no database is chosen", async () => {
    const { httpFetch, urls } = recorder([results([page()])]);
    expect(
      await adapter({ database_id: "" }, httpFetch).fetch(null, "secret_token"),
    ).toHaveLength(0);
    expect(urls).toHaveLength(0);
  });

  it("says an entry is not an identifier rather than querying nothing", async () => {
    const { httpFetch, urls } = recorder([results([])]);
    const error = await rejection(
      adapter({ database_id: "my tasks" }, httpFetch).fetch(null, "secret_token"),
    );
    expect(error.message).toContain("does not look like a Notion database ID");
    expect(urls).toHaveLength(0);
  });

  it("reports an unshared database as a connection step, not an empty week", async () => {
    const { httpFetch } = recorder([
      { status: 404, body: { object: "error", code: "object_not_found" } },
    ]);
    const error = await rejection(adapter({}, httpFetch).fetch(null, "secret_token"));

    expect(error).toBeInstanceOf(NotionAccessError);
    expect(error.message).toContain("connect it to your integration");
  });

  it("names the properties the database really has when the status column is missing", async () => {
    const mismatched = page({
      properties: {
        Name: { type: "title", title: [{ plain_text: "Ship the importer" }] },
        "Task state": { type: "status", status: { name: "Done" } },
      },
    });
    const { httpFetch } = recorder([results([mismatched])]);
    const error = await rejection(adapter({}, httpFetch).fetch(null, "secret_token"));

    // Without this the sync succeeds, stores nothing, and looks exactly like a
    // week with no tasks — the app stating something false about the user.
    expect(error.message).toContain('property named "Status"');
    expect(error.message).toContain("Task state");
  });

  it("stays quiet about a database that is genuinely empty", async () => {
    const { httpFetch } = recorder([results([])]);
    expect(await adapter({}, httpFetch).fetch(null, "secret_token")).toHaveLength(0);
  });

  it("surfaces a rate limit with a wait instead of retrying", async () => {
    const { httpFetch, urls } = recorder([
      { status: 429, headers: { "retry-after": "120" } },
    ]);
    const error = await rejection(adapter({}, httpFetch).fetch(null, "secret_token"));

    expect(error).toBeInstanceOf(NotionRateLimitError);
    expect(error.message).toContain("2 minutes");
    expect(urls).toHaveLength(1);
  });

  it("reports a rejected token without echoing it", async () => {
    const { httpFetch } = recorder([{ status: 401 }]);
    const error = await rejection(
      adapter({}, httpFetch).fetch(null, "secret_notion_token_value"),
    );

    expect(error.message).toContain("Open Settings");
    expect(error.message).not.toContain("secret_notion_token_value");
  });

  it("refuses to query without a credential", async () => {
    const { httpFetch, urls } = recorder([results([page()])]);
    const error = await rejection(adapter({}, httpFetch).fetch(null, ""));

    expect(error.message).toContain("needs a token");
    expect(urls).toHaveLength(0);
  });
});
