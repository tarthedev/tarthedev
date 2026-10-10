import {
  BUSINESS_UNIT_CODES,
  type BusinessUnitCode,
  type CreateEmployeeRequest,
  canAssignRole,
  type EmployeeResponse,
  employeeSchema,
  type FieldErrors,
  MIN_PASSWORD_LENGTH,
  ROLE_LABELS,
  ROLES,
  type Role,
  SKILLS,
  type Skill,
} from "@dwrg/shared";
import { type FormEvent, useState } from "react";
import { Alert, Button, CheckChip, Field, SelectField } from "../../components/ui";
import { ApiError, api, messageOf } from "../../lib/api";
import { BUSINESS_UNIT_LABELS, SKILL_LABELS } from "../../lib/labels";

interface Draft {
  name: string;
  email: string;
  role: Role | "";
  password: string;
  phone: string;
  skills: Skill[];
  businessUnits: BusinessUnitCode[];
  hiredOn: string;
  reason: string;
}

const EMPTY: Draft = {
  name: "",
  email: "",
  role: "",
  password: "",
  phone: "",
  skills: [],
  businessUnits: [],
  hiredOn: "",
  reason: "",
};

/** The request body: blank optional fields are left out. */
export function toRequest(draft: Draft): CreateEmployeeRequest {
  return {
    name: draft.name,
    email: draft.email,
    role: draft.role as Role,
    password: draft.password,
    ...(draft.phone.trim() ? { phone: draft.phone.trim() } : {}),
    skills: draft.skills,
    businessUnits: draft.businessUnits,
    ...(draft.hiredOn ? { hiredOn: draft.hiredOn } : {}),
    ...(draft.reason.trim() ? { reason: draft.reason.trim() } : {}),
  };
}

/**
 * An owner or manager creates a login with a role (POST /api/employees,
 * audited). Managers can't create owners: the role list only offers what the
 * signed-in person may give.
 */
export function CreateLoginForm({
  actorRole,
  onCreated,
  onCancel,
}: {
  actorRole: Role;
  onCreated: (employee: EmployeeResponse) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [fields, setFields] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const roles = ROLES.filter((role) => canAssignRole(actorRole, role));
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const toggle = <T extends string>(list: T[], value: T, on: boolean): T[] =>
    on ? [...list, value] : list.filter((v) => v !== value);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const created = await api("/api/employees", {
        method: "POST",
        json: toRequest(draft),
        schema: employeeSchema,
      });
      setDraft(EMPTY);
      onCreated(created);
    } catch (caught) {
      if (caught instanceof ApiError) setFields(caught.fields);
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Full name"
          autoComplete="off"
          value={draft.name}
          onChange={(e) => set("name", e.target.value)}
          errors={fields.name}
        />
        <Field
          label="Work email"
          type="email"
          inputMode="email"
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          value={draft.email}
          onChange={(e) => set("email", e.target.value)}
          errors={fields.email}
        />
        <SelectField
          label="Role"
          value={draft.role}
          onChange={(e) => set("role", e.target.value as Role | "")}
          errors={fields.role}
        >
          <option value="">Choose a role</option>
          {roles.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </SelectField>
        <Field
          label="Starting password"
          type="text"
          autoComplete="new-password"
          autoCapitalize="none"
          spellCheck={false}
          hint={`At least ${MIN_PASSWORD_LENGTH} characters. Give it to them in person.`}
          value={draft.password}
          onChange={(e) => set("password", e.target.value)}
          errors={fields.password}
        />
        <Field
          label="Mobile phone (optional)"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          value={draft.phone}
          onChange={(e) => set("phone", e.target.value)}
          errors={fields.phone}
        />
        <Field
          label="Hire date (optional)"
          type="date"
          value={draft.hiredOn}
          onChange={(e) => set("hiredOn", e.target.value)}
          errors={fields.hiredOn}
        />
      </div>
      <fieldset>
        <legend className="mb-2 text-base font-semibold text-navy">Skills</legend>
        <div className="flex flex-wrap gap-2">
          {SKILLS.map((skill) => (
            <CheckChip
              key={skill}
              label={SKILL_LABELS[skill]}
              checked={draft.skills.includes(skill)}
              onChange={(on) => set("skills", toggle(draft.skills, skill, on))}
            />
          ))}
        </div>
        {fields.skills ? (
          <p className="mt-1 font-semibold text-bad">{fields.skills.join(". ")}</p>
        ) : null}
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-base font-semibold text-navy">Departments</legend>
        <div className="flex flex-wrap gap-2">
          {BUSINESS_UNIT_CODES.map((code) => (
            <CheckChip
              key={code}
              label={BUSINESS_UNIT_LABELS[code]}
              checked={draft.businessUnits.includes(code)}
              onChange={(on) => set("businessUnits", toggle(draft.businessUnits, code, on))}
            />
          ))}
        </div>
        {fields.businessUnits ? (
          <p className="mt-1 font-semibold text-bad">{fields.businessUnits.join(". ")}</p>
        ) : null}
      </fieldset>
      <Field
        label="Why (kept in the change log)"
        placeholder="New hire"
        value={draft.reason}
        onChange={(e) => set("reason", e.target.value)}
        errors={fields.reason}
      />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" busy={busy}>
          Create login
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
