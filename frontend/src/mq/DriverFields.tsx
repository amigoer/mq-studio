/**
 * Renders a driver's connection form from its descriptor.
 *
 * Adding a broker family should not mean adding form JSX: the Go descriptor
 * declares the fields, and this draws them. A family whose editing is richer
 * than a flat field list - RocketMQ's multiple NameServer addresses - keeps
 * its own editor and excludes those keys here.
 */
import { useTranslation } from "react-i18next";
import type { FormField } from "@bindings/model/models";
import { FieldType, FieldTarget } from "@bindings/model/models";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export interface DriverFieldsProps {
  fields: FormField[];
  /** Current value per field key, flattened across targets. */
  values: Record<string, string>;
  /** Secret keys already stored, so the form can say "already set". */
  configuredSecrets?: string[];
  onChange: (field: FormField, value: string) => void;
  /** Field keys to render invalid. */
  errors?: Record<string, boolean>;
}

/** A field is hidden until the field it depends on holds one of its values. */
function visible(field: FormField, values: Record<string, string>): boolean {
  const cond = field.visibleWhen;
  if (!cond) return true;
  return cond.equals.includes(values[cond.field] ?? "");
}

export function DriverFields({
  fields,
  values,
  configuredSecrets = [],
  onChange,
  errors = {},
}: DriverFieldsProps) {
  const { t } = useTranslation();

  return (
    <>
      {fields.filter((field) => visible(field, values)).map((field) => {
        const value = values[field.key] ?? field.default ?? "";
        const invalid = errors[field.key];
        // A stored secret is never sent back, so a blank input means "keep it"
        // rather than "empty" - the placeholder has to say which.
        const alreadySet =
          field.target === FieldTarget.TargetSecret &&
          configuredSecrets.includes(field.key);

        return (
          <div key={field.key}>
            <div className="text-muted-foreground mb-1.5 text-fs-115">
              {t(field.labelKey)}
              {field.required && <span className="text-destructive"> *</span>}
            </div>

            {field.type === FieldType.FieldSwitch ? (
              <Switch
                checked={value === "true"}
                onCheckedChange={(on) => onChange(field, on ? "true" : "false")}
                aria-label={t(field.labelKey)}
              />
            ) : field.type === FieldType.FieldSelect ? (
              <Select
                value={value}
                onChange={(e) => onChange(field, e.target.value)}
                aria-label={t(field.labelKey)}
              >
                {(field.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                type={
                  field.type === FieldType.FieldPassword ? "password" : "text"
                }
                inputMode={
                  field.type === FieldType.FieldNumber ? "numeric" : undefined
                }
                className={cn(
                  field.target === FieldTarget.TargetEndpoints &&
                    "font-mono-design",
                  invalid &&
                    "border-destructive focus-visible:border-destructive focus-visible:ring-destructive/25",
                )}
                placeholder={
                  alreadySet
                    ? t("connections.secretAlreadySet")
                    : field.placeholder
                }
                value={value}
                spellCheck={false}
                autoComplete="off"
                aria-invalid={invalid || undefined}
                aria-label={t(field.labelKey)}
                onChange={(e) => {
                  const next =
                    field.type === FieldType.FieldNumber
                      ? e.target.value.replace(/\D/g, "").slice(0, 5)
                      : e.target.value;
                  onChange(field, next);
                }}
              />
            )}
          </div>
        );
      })}
    </>
  );
}
