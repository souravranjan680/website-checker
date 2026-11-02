import type { ComponentProps, ReactNode } from 'react';
import { Controller, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';

/**
 * Form fields connected to React Hook Form. Each one links its label, input,
 * description and error message for screen readers (aria-invalid / aria-describedby).
 */
interface BaseProps<T extends FieldValues> {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  description?: ReactNode;
}

function ids(name: string) {
  const id = `field-${name.replace(/\W/g, '-')}`;
  return { id, descriptionId: `${id}-description`, errorId: `${id}-error` };
}

export function TextField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  ...inputProps
}: BaseProps<T> & Omit<ComponentProps<'input'>, 'name'>) {
  const { id, descriptionId, errorId } = ids(name);
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined}>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <Input
            {...inputProps}
            {...field}
            value={field.value ?? ''}
            id={id}
            aria-invalid={fieldState.invalid}
            aria-describedby={
              [description && descriptionId, fieldState.error && errorId]
                .filter(Boolean)
                .join(' ') || undefined
            }
          />
          {description ? (
            <FieldDescription id={descriptionId}>{description}</FieldDescription>
          ) : null}
          <FieldError id={errorId} errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}

export function NumberField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  min,
  max,
}: BaseProps<T> & { min?: number; max?: number }) {
  const { id, descriptionId, errorId } = ids(name);
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined}>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <Input
            id={id}
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            name={field.name}
            ref={field.ref}
            onBlur={field.onBlur}
            value={Number.isNaN(field.value) ? '' : field.value}
            onChange={(event) =>
              field.onChange(event.target.value === '' ? Number.NaN : Number(event.target.value))
            }
            aria-invalid={fieldState.invalid}
            aria-describedby={
              [description && descriptionId, fieldState.error && errorId]
                .filter(Boolean)
                .join(' ') || undefined
            }
          />
          {description ? (
            <FieldDescription id={descriptionId}>{description}</FieldDescription>
          ) : null}
          <FieldError id={errorId} errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}

export function TextareaField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  ...textareaProps
}: BaseProps<T> & Omit<ComponentProps<'textarea'>, 'name'>) {
  const { id, descriptionId, errorId } = ids(name);
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined}>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <Textarea
            {...textareaProps}
            {...field}
            value={field.value ?? ''}
            id={id}
            aria-invalid={fieldState.invalid}
            aria-describedby={
              [description && descriptionId, fieldState.error && errorId]
                .filter(Boolean)
                .join(' ') || undefined
            }
          />
          {description ? (
            <FieldDescription id={descriptionId}>{description}</FieldDescription>
          ) : null}
          <FieldError id={errorId} errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}

export function SelectField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  options,
  placeholder,
}: BaseProps<T> & { options: { value: string; label: string }[]; placeholder?: string }) {
  const { id, descriptionId, errorId } = ids(name);
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined}>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <NativeSelect
            {...field}
            id={id}
            className="w-full"
            aria-invalid={fieldState.invalid}
            aria-describedby={
              [description && descriptionId, fieldState.error && errorId]
                .filter(Boolean)
                .join(' ') || undefined
            }
          >
            {placeholder ? <NativeSelectOption value="">{placeholder}</NativeSelectOption> : null}
            {options.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {description ? (
            <FieldDescription id={descriptionId}>{description}</FieldDescription>
          ) : null}
          <FieldError id={errorId} errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}

export function CheckboxField<T extends FieldValues>({
  control,
  name,
  label,
  description,
}: BaseProps<T>) {
  const { id, descriptionId, errorId } = ids(name);
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field orientation="horizontal" data-invalid={fieldState.invalid || undefined}>
          <Checkbox
            id={id}
            name={field.name}
            ref={field.ref}
            checked={field.value === true}
            onCheckedChange={(checked) => field.onChange(checked === true)}
            onBlur={field.onBlur}
            aria-invalid={fieldState.invalid}
            aria-describedby={
              [description && descriptionId, fieldState.error && errorId]
                .filter(Boolean)
                .join(' ') || undefined
            }
          />
          <FieldContent>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            {description ? (
              <FieldDescription id={descriptionId}>{description}</FieldDescription>
            ) : null}
            <FieldError id={errorId} errors={[fieldState.error]} />
          </FieldContent>
        </Field>
      )}
    />
  );
}
