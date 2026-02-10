'use client';

import { useState, useEffect, useCallback } from 'react';

interface UseApiReturn<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useApi<T>(url: string, immediate = true): UseApiReturn<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(url);
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      } else {
        setError(json.error || 'Something went wrong');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    if (immediate) fetchData();
  }, [fetchData, immediate]);

  return { data, loading, error, refetch: fetchData };
}

export async function apiPost<T>(url: string, body: Record<string, unknown>): Promise<{ data?: T; error?: string }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (json.success) return { data: json.data };
    return { error: json.error || 'Something went wrong' };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiPut<T>(url: string, body: Record<string, unknown>): Promise<{ data?: T; error?: string }> {
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (json.success) return { data: json.data };
    return { error: json.error || 'Something went wrong' };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiDelete(url: string): Promise<{ error?: string }> {
  try {
    const res = await fetch(url, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) return {};
    return { error: json.error || 'Something went wrong' };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Network error' };
  }
}
