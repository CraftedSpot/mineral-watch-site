import { useState, useCallback, useMemo, useRef } from 'react';

interface FormDirtyResult<T extends Record<string, unknown>> {
  values: T;
  setValue: (key: keyof T, value: unknown) => void;
  isDirty: boolean;
  reset: (newInitial: T) => void;
}

export function useFormDirty<T extends Record<string, unknown>>(initial: T): FormDirtyResult<T> {
  const [values, setValues] = useState<T>(initial);
  const initialRef = useRef(initial);

  const isDirty = useMemo(() => {
    return Object.keys(initialRef.current).some(
      (k) => String(values[k] ?? '') !== String(initialRef.current[k] ?? ''),
    );
  }, [values]);

  const setValue = useCallback((key: keyof T, val: unknown) => {
    setValues((prev) => ({ ...prev, [key]: val }));
  }, []);

  const reset = useCallback((newInitial: T) => {
    initialRef.current = newInitial;
    setValues(newInitial);
  }, []);

  return { values, setValue, isDirty, reset };
}
