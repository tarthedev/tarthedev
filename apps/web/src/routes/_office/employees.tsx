import {
  type EmployeeResponse,
  employeeListResponseSchema,
  PEOPLE_ADMIN_ROLES,
  ROLE_LABELS,
  ROLES,
  type Role,
} from "@dwrg/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Loading,
  PageHeader,
  SelectField,
} from "../../components/ui";
import { CreateLoginForm } from "../../features/employees/CreateLoginForm";
import { api, messageOf } from "../../lib/api";
import { homePathFor } from "../../lib/auth";
import { formatDate, formatPhone } from "../../lib/format";
import { BUSINESS_UNIT_LABELS, SKILL_LABELS } from "../../lib/labels";
import { searchOneOf } from "../../lib/search";
import { useTitle } from "../../lib/useTitle";

/** Logins and staff: owners and managers only (docs/03, Security). No pay here. */
export const Route = createFileRoute("/_office/employees")({
  validateSearch: (search: Record<string, unknown>): { role?: Role } => ({
    role: searchOneOf(search.role, ROLES),
  }),
  beforeLoad: ({ context }) => {
    if (!(PEOPLE_ADMIN_ROLES as readonly Role[]).includes(context.me.user.role)) {
      throw redirect({ to: homePathFor(context.me.user.role) });
    }
  },
  component: EmployeesPage,
});

const employeesKey = ["employees"] as const;

function EmployeesPage() {
  useTitle("Employees");
  const { me } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<EmployeeResponse | null>(null);

  const list = useQuery({
    queryKey: [...employeesKey, search.role ?? "all"],
    queryFn: ({ signal }) =>
      api("/api/employees", {
        query: { role: search.role },
        schema: employeeListResponseSchema,
        signal,
      }),
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Employees"
        subtitle="Everyone with a login. Only owners and managers see this."
        actions={
          creating ? null : (
            <Button
              onClick={() => {
                setCreating(true);
                setCreated(null);
              }}
            >
              Create a login
            </Button>
          )
        }
      />

      {created ? (
        <Alert tone="success" title="Login created">
          {created.name} can now sign in as {ROLE_LABELS[created.role]} with {created.email}.
        </Alert>
      ) : null}

      {creating ? (
        <Card title="New login">
          <CreateLoginForm
            actorRole={me.user.role}
            onCancel={() => setCreating(false)}
            onCreated={(employee) => {
              setCreated(employee);
              setCreating(false);
              void queryClient.invalidateQueries({ queryKey: employeesKey });
            }}
          />
        </Card>
      ) : null}

      <div className="max-w-xs">
        <SelectField
          label="Show"
          value={search.role ?? ""}
          onChange={(e) =>
            void navigate({
              search: { role: searchOneOf(e.target.value, ROLES) },
            })
          }
        >
          <option value="">Everyone</option>
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </SelectField>
      </div>

      {list.isPending ? (
        <Loading label="Loading employees…" />
      ) : list.isError ? (
        <Alert tone="error" title="Couldn't load employees">
          {messageOf(list.error)}
        </Alert>
      ) : list.data.items.length === 0 ? (
        <EmptyState>No one with that role yet.</EmptyState>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
          {list.data.items.map((employee) => (
            <li key={employee.userId}>
              <EmployeeRow employee={employee} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmployeeRow({ employee }: { employee: EmployeeResponse }) {
  const skills = employee.skills.map((s) => SKILL_LABELS[s]).join(", ");
  const units = employee.businessUnits.map((u) => BUSINESS_UNIT_LABELS[u]).join(", ");
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-xl font-semibold text-navy">
          {employee.name}
          <Badge tone="navy">{ROLE_LABELS[employee.role]}</Badge>
          {employee.active ? null : <Badge tone="bad">Login turned off</Badge>}
          {employee.hasPassword ? null : <Badge>No password yet</Badge>}
        </p>
        <p className="text-base break-words text-muted">
          {employee.email}
          {employee.phone ? ` · ${formatPhone(employee.phone)}` : ""}
        </p>
        {skills || units ? (
          <p className="text-base text-muted">{[skills, units].filter(Boolean).join(" · ")}</p>
        ) : null}
      </div>
      {employee.hiredOn ? (
        <p className="text-base text-muted">Hired {formatDate(employee.hiredOn)}</p>
      ) : null}
    </div>
  );
}
