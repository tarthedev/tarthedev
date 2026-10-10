import type {
  EquipmentSummary,
  ImportBatchDetail,
  ImportPreviewResponse,
  Role,
} from "@dwrg/shared";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LoginForm } from "../src/features/auth/LoginForm";
import { EquipmentTable } from "../src/features/customers/EquipmentTable";
import { CreateLoginForm } from "../src/features/employees/CreateLoginForm";
import { ImportPreviewPanel } from "../src/features/imports/ImportPreviewPanel";
import { ImportReport } from "../src/features/imports/ImportReport";
import { ApiError } from "../src/lib/api";

describe("LoginForm", () => {
  it("asks for both fields before calling the server", () => {
    const onSubmit = vi.fn(async () => {});
    render(<LoginForm onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("alert").textContent).toBe("Enter your email and password.");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("signs in with what was typed", async () => {
    const onSubmit = vi.fn(async () => {});
    render(<LoginForm onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "jeffrey.roberts@demo.dwrg.example" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "demo-password-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        "jeffrey.roberts@demo.dwrg.example",
        "demo-password-123",
      ),
    );
  });

  it("shows the server's message and lets the person try again", async () => {
    const onSubmit = vi.fn(async () => {
      throw new ApiError(401, "unauthorized", "That email and password don't match a login.");
    });
    render(<LoginForm onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.example" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "That email and password don't match a login.",
    );
    expect(screen.getByRole("button", { name: "Sign in" }).hasAttribute("disabled")).toBe(false);
  });

  it("can show the password while typing on the iPad", () => {
    render(<LoginForm onSubmit={async () => {}} />);
    const password = screen.getByLabelText("Password");
    expect(password.getAttribute("type")).toBe("password");
    fireEvent.click(screen.getByLabelText("Show password"));
    expect(password.getAttribute("type")).toBe("text");
  });
});

const unit = (over: Partial<EquipmentSummary>): EquipmentSummary => ({
  id: "e1",
  kind: "furnace",
  brand: "Carrier",
  model: "59SC5",
  serial: "S123",
  installYear: 2010,
  ageYears: 16,
  pastReplacementAge: true,
  warrantyEnd: null,
  notes: null,
  ...over,
});

describe("EquipmentTable", () => {
  it("shows each unit's age and flags the ones past the replacement age in words", () => {
    render(
      <EquipmentTable
        replacementAgeYears={15}
        equipment={[
          unit({}),
          unit({
            id: "e2",
            kind: "ac",
            installYear: 2011,
            ageYears: 15,
            pastReplacementAge: false,
          }),
          unit({
            id: "e3",
            kind: "water_heater",
            brand: null,
            model: null,
            serial: null,
            installYear: null,
            ageYears: null,
            pastReplacementAge: false,
            warrantyEnd: "2027-03-01",
          }),
        ]}
      />,
    );
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    const [old, fifteen, unknown] = rows.map((row) => within(row));
    expect(old?.getByText("Furnace")).toBeTruthy();
    expect(old?.getByText("16 years")).toBeTruthy();
    expect(old?.getByText("Older than 15 years")).toBeTruthy();
    expect(fifteen?.getByText("Air conditioner")).toBeTruthy();
    expect(fifteen?.getByText("15 years")).toBeTruthy();
    expect(fifteen?.queryByText(/Older than/)).toBeNull();
    expect(unknown?.getByText("Brand unknown")).toBeTruthy();
    expect(unknown?.getAllByText("Unknown")).toHaveLength(2);
    expect(unknown?.getByText("Warranty to Mar 1, 2027")).toBeTruthy();
  });

  it("says when a location has no equipment", () => {
    render(<EquipmentTable equipment={[]} replacementAgeYears={15} />);
    expect(screen.getByText("No equipment on file at this location.")).toBeTruthy();
  });
});

const SHA = "a".repeat(64);

const preview = (over: Partial<ImportPreviewResponse> = {}): ImportPreviewResponse => ({
  file: { name: "customers.csv", sizeBytes: 2048, sha256: SHA },
  reportType: "customers",
  detectedReportType: "customers",
  detectionNote: null,
  candidates: [],
  headers: ["Customer ID", "Customer Name"],
  headerRowNumber: 1,
  columns: { stId: "Customer ID", name: "Customer Name" },
  missingColumns: [],
  unmatchedHeaders: ["Tag"],
  fileError: null,
  rowCount: 12,
  rows: [{ rowNumber: 2, stId: "C1", fields: { stId: "C1", name: "Ann Smith" } }],
  errors: [{ rowNumber: 5, column: "Zip", message: "Zip must be 5 digits" }],
  errorCount: 1,
  rejectedRows: 1,
  ...over,
});

describe("ImportPreviewPanel", () => {
  it("shows the detected type, the counts, the row problems and the first rows", () => {
    const onImport = vi.fn();
    render(
      <ImportPreviewPanel
        preview={preview()}
        pickedByHand={false}
        importing={false}
        onImport={onImport}
      />,
    );
    expect(screen.getByText("Customers and locations (with contacts)")).toBeTruthy();
    expect(screen.getByText("Detected from the columns")).toBeTruthy();
    expect(screen.getByText("Rows in the file").nextSibling?.textContent).toBe("12");
    expect(screen.getByText("Ready to import").nextSibling?.textContent).toBe("11");
    expect(screen.getByText("Will be rejected").nextSibling?.textContent).toBe("1");
    expect(screen.getByText("Zip must be 5 digits")).toBeTruthy();
    expect(screen.getByText("Ann Smith")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Import 11 rows" }));
    expect(onImport).toHaveBeenCalledOnce();
  });

  it("offers no import when the whole file is wrong, and lists the closest report types", () => {
    render(
      <ImportPreviewPanel
        preview={preview({
          reportType: null,
          detectedReportType: null,
          fileError: "These columns don't match any report we know.",
          candidates: [
            {
              reportType: "payments",
              label: "Payments",
              missingRequired: ["Payment ID"],
              matchedHeaders: 2,
              scoreBps: 5000,
            },
          ],
          rows: [],
          errors: [],
          errorCount: 0,
          rejectedRows: 0,
        })}
        pickedByHand={false}
        importing={false}
        onImport={() => {}}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "These columns don't match any report we know.",
    );
    expect(screen.getByText("Payments (missing Payment ID)")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Import/ })).toBeNull();
  });
});

const detail = (over: Partial<ImportBatchDetail> = {}): ImportBatchDetail => ({
  id: "b1",
  reportType: "invoices",
  fileName: "invoices.csv",
  fileSha256: SHA,
  storageKey: `rows-only:st-imports/${SHA}.csv`,
  uploadedBy: { id: "u1", name: "Jeffrey Roberts" },
  uploadedAt: "2026-10-09T14:00:00.000Z",
  status: "imported",
  rowsRead: 930,
  inserted: 900,
  updated: 20,
  unchanged: 8,
  rejected: 2,
  error: null,
  completedAt: "2026-10-09T14:00:30.000Z",
  totalsMeaning: { count: "invoices", dollars: "invoice totals" },
  totals: [
    {
      businessUnitCode: "hvac_service",
      year: 2026,
      metric: "dollars",
      ours: 1_234_567,
      servicetitanSummary: 1_234_500,
      diff: 67,
      note: null,
      status: "differs",
    },
    {
      businessUnitCode: "hvac_service",
      year: 2026,
      metric: "count",
      ours: 40,
      servicetitanSummary: 40,
      diff: 0,
      note: null,
      status: "match",
    },
  ],
  summary: { entered: true, matches: false },
  errors: [{ rowNumber: 17, column: null, message: "Unknown business unit 'HVAC-X'" }],
  errorCount: 2,
  ...over,
});

describe("ImportReport", () => {
  it("shows what happened to each row and our totals next to ServiceTitan's in dollars", () => {
    render(<ImportReport detail={detail()} />);
    for (const [label, value] of [
      ["Rows read", "930"],
      ["New", "900"],
      ["Updated", "20"],
      ["Unchanged", "8"],
      ["Rejected", "2"],
    ]) {
      expect(screen.getByText(label as string).nextSibling?.textContent).toBe(value);
    }
    expect(screen.getByText("Doesn't match ServiceTitan's summary yet")).toBeTruthy();
    const dollars = within(screen.getByText("$12,345.67").closest("tr") as HTMLElement);
    expect(dollars.getByText("HVAC Service")).toBeTruthy();
    expect(dollars.getByText("$12,345.00")).toBeTruthy();
    expect(dollars.getByText("+$0.67")).toBeTruthy();
    expect(dollars.getByText("Differs")).toBeTruthy();
    expect(screen.getByText("Matches")).toBeTruthy();
    expect(screen.getByText("Unknown business unit 'HVAC-X'")).toBeTruthy();
    expect(screen.getByText("And 1 more not listed here.")).toBeTruthy();
  });

  it("says plainly when nothing was imported", () => {
    render(
      <ImportReport
        detail={detail({
          status: "failed",
          error: "The file is missing the Invoice # column.",
          inserted: 0,
          updated: 0,
          unchanged: 0,
          rejected: 0,
          totals: [],
          summary: { entered: false, matches: false },
          errors: [],
          errorCount: 0,
        })}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "The file is missing the Invoice # column.",
    );
  });
});

describe("CreateLoginForm", () => {
  const roleOptions = (actorRole: Role) => {
    render(<CreateLoginForm actorRole={actorRole} onCreated={() => {}} onCancel={() => {}} />);
    const select = screen.getByLabelText("Role");
    return within(select)
      .getAllByRole("option")
      .map((o) => o.textContent);
  };

  it("doesn't offer the owner role to a manager", () => {
    expect(roleOptions("manager")).toEqual([
      "Choose a role",
      "Manager",
      "Dispatcher / CSR",
      "Tech",
      "Installer",
    ]);
  });

  it("offers every role to an owner", () => {
    expect(roleOptions("owner")).toContain("Owner");
  });

  it("shows the server's field messages next to the fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: "validation_failed",
                message: "Check the highlighted fields.",
                requestId: "r1",
                fields: { password: ["Must be at least 12 characters"] },
              },
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    const onCreated = vi.fn();
    render(<CreateLoginForm actorRole="owner" onCreated={onCreated} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Create login" }));
    expect(
      (await screen.findByText("Check the highlighted fields.")).closest("[role=alert]"),
    ).toBeTruthy();
    const password = screen.getByLabelText("Starting password");
    expect(password.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Must be at least 12 characters")).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
