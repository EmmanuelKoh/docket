// Field: a visible label above an inset window (input, textarea or select)
// in 16px mono, with an optional hint and an error line under it. The
// error marks the control aria-invalid and both lines are tied to it with
// aria-describedby. readOnly shows a darker readout window.

import {
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
} from 'react';
import { cn } from '@/components/utils';

type FieldFrame = {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Class for the whole field (label, control, hint, error). */
  className?: string;
  /** Class for the control itself. */
  controlClassName?: string;
};

type InputField = FieldFrame & { as?: 'input' } & Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'className'
  >;
type TextareaField = FieldFrame & { as: 'textarea' } & Omit<
    TextareaHTMLAttributes<HTMLTextAreaElement>,
    'className'
  >;
type SelectField = FieldFrame & { as: 'select' } & Omit<
    SelectHTMLAttributes<HTMLSelectElement>,
    'className'
  >;

export function Field(props: InputField | TextareaField | SelectField) {
  const {
    label,
    hint,
    error,
    className,
    controlClassName,
    as = 'input',
    ...control
  } = props;
  const base = useId();
  const controlId = control.id ?? `${base}-control`;
  const hintId = hint ? `${base}-hint` : undefined;
  const errorId = error ? `${base}-error` : undefined;
  const describedBy =
    [control['aria-describedby'], hintId, errorId].filter(Boolean).join(' ') ||
    undefined;
  const shared = {
    id: controlId,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : control['aria-invalid'],
  };

  let field: ReactNode;
  if (as === 'textarea') {
    field = (
      <textarea
        {...(control as TextareaHTMLAttributes<HTMLTextAreaElement>)}
        {...shared}
        className={cn('hw-field hw-field--multiline', controlClassName)}
      />
    );
  } else if (as === 'select') {
    field = (
      <select
        {...(control as SelectHTMLAttributes<HTMLSelectElement>)}
        {...shared}
        className={cn('hw-field hw-field--select', controlClassName)}
      />
    );
  } else {
    field = (
      <input
        {...(control as InputHTMLAttributes<HTMLInputElement>)}
        {...shared}
        className={cn('hw-field', controlClassName)}
      />
    );
  }

  return (
    <div className={cn('hw-field-group', className)}>
      <label htmlFor={controlId} className="hw-field-label">
        {label}
      </label>
      {field}
      {hint ? (
        <p id={hintId} className="hw-note">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="hw-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
