import React, { useState } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';

interface PasswordInputProps {
  id?: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  disabled?: boolean;
  showLeadingIcon?: boolean;
  inputClassName?: string;
  toggleAriaLabelSubject?: string;
  testId?: string;
}

export const PasswordInput: React.FC<PasswordInputProps> = ({
  id,
  name,
  value,
  onChange,
  placeholder = '••••••••••••',
  autoComplete,
  required = false,
  minLength,
  maxLength,
  disabled = false,
  showLeadingIcon = true,
  inputClassName,
  toggleAriaLabelSubject = 'password',
  testId,
}) => {
  const [visible, setVisible] = useState(false);

  const baseInputClasses =
    inputClassName ??
    `w-full ${showLeadingIcon ? 'pl-9' : 'pl-3'} pr-10 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-hidden focus:border-emerald-500 disabled:opacity-50`;

  return (
    <div className="relative">
      {showLeadingIcon && (
        <Lock
          aria-hidden="true"
          className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
        />
      )}
      <input
        id={id}
        name={name}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        maxLength={maxLength}
        disabled={disabled}
        data-testid={testId}
        className={baseInputClasses}
      />
      <button
        type="button"
        onClick={() => setVisible((prev) => !prev)}
        disabled={disabled}
        aria-label={visible ? `Hide ${toggleAriaLabelSubject}` : `Show ${toggleAriaLabelSubject}`}
        aria-pressed={visible}
        title={visible ? `Hide ${toggleAriaLabelSubject}` : `Show ${toggleAriaLabelSubject}`}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-400 hover:text-emerald-300 focus:outline-hidden focus:ring-1 focus:ring-emerald-500 transition disabled:opacity-40"
      >
        {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
};
