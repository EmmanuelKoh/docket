// Field: an engraved name over a small screen behind a window cut through
// the plate; the value is typed on the screen (e-ink in light, the dark
// screen in dark) in 16px mono. Input, textarea or select. A hint and an
// error print on the plate under it, tied to the control with
// aria-describedby; the error marks it aria-invalid and the screen
// underlines it in red. Classes in app/kit.css.

import {
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
} from 'react';
import { cn } from '@/components/utils';

type FieldFrame = {
  /** Engraved above the window. */
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Class for the whole field. */
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
    className: cn('pk-field-input', controlClassName),
  };

  let field: ReactNode;
  if (as === 'textarea') {
    field = (
      <textarea
        {...(control as TextareaHTMLAttributes<HTMLTextAreaElement>)}
        {...shared}
      />
    );
  } else if (as === 'select') {
    field = (
      <select
        {...(control as SelectHTMLAttributes<HTMLSelectElement>)}
        {...shared}
      />
    );
  } else {
    field = (
      <input
        {...(control as InputHTMLAttributes<HTMLInputElement>)}
        {...shared}
      />
    );
  }

  return (
    <div className={cn('pk-field', className)}>
      <label htmlFor={controlId} className="pk-engr">
        {label}
      </label>
      <span className="pk-field-window">{field}</span>
      {hint ? (
        <p id={hintId} className="pk-note">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="pk-note pk-note--red">
          {error}
        </p>
      ) : null}
    </div>
  );
}
