import axios, { AxiosError } from 'axios';

export type UserRole = 'patient' | 'guardian';

export function parseUserRole(raw: unknown): UserRole {
  const r = String(raw ?? '').trim().toLowerCase();
  return r === 'guardian' ? 'guardian' : 'patient';
}

export type AppUser = {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
};

const STORAGE_TOKEN = 'dementia_web_token';
const STORAGE_USER = 'dementia_web_user';
const STORAGE_API = 'dementia_web_api_base';
const STORAGE_PATIENT = 'dementia_web_selected_patient';

export function defaultApiBase(): string {
  const root = (process.env.REACT_APP_BACKEND_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
  return `${root}/api`;
}

export function loadStoredSession(): {
  token: string | null;
  user: AppUser | null;
  apiBaseUrl: string;
  selectedPatientId: string | null;
} {
  const token = localStorage.getItem(STORAGE_TOKEN);
  const userRaw = localStorage.getItem(STORAGE_USER);
  let user: AppUser | null = null;
  if (userRaw) {
    try {
      const j = JSON.parse(userRaw) as Record<string, unknown>;
      user = {
        id: String(j.id ?? ''),
        fullName: String(j.fullName ?? ''),
        email: String(j.email ?? ''),
        role: parseUserRole(j.role),
      };
    } catch {
      user = null;
    }
  }
  const apiBaseUrl = localStorage.getItem(STORAGE_API)?.trim() || defaultApiBase();
  const selectedPatientId = localStorage.getItem(STORAGE_PATIENT);
  return { token, user, apiBaseUrl, selectedPatientId };
}

export function persistSession(opts: {
  token: string;
  user: AppUser;
  apiBaseUrl?: string;
  selectedPatientId?: string | null;
}) {
  localStorage.setItem(STORAGE_TOKEN, opts.token);
  localStorage.setItem(STORAGE_USER, JSON.stringify(opts.user));
  if (opts.apiBaseUrl) localStorage.setItem(STORAGE_API, opts.apiBaseUrl);
  if (opts.selectedPatientId !== undefined) {
    if (opts.selectedPatientId) localStorage.setItem(STORAGE_PATIENT, opts.selectedPatientId);
    else localStorage.removeItem(STORAGE_PATIENT);
  }
}

export function persistApiBase(apiBaseUrl: string) {
  localStorage.setItem(STORAGE_API, apiBaseUrl);
}

export function persistSelectedPatient(patientId: string | null) {
  if (patientId) localStorage.setItem(STORAGE_PATIENT, patientId);
  else localStorage.removeItem(STORAGE_PATIENT);
}

export function clearSession() {
  localStorage.removeItem(STORAGE_TOKEN);
  localStorage.removeItem(STORAGE_USER);
  localStorage.removeItem(STORAGE_PATIENT);
}

export function socketOriginFromApiBase(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/\/api\/?$/i, '');
}

export function createHttp(apiBaseUrl: string, token: string | null) {
  const instance = axios.create({
    baseURL: apiBaseUrl.replace(/\/$/, ''),
    timeout: 30000,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return instance;
}

type ApiErrBody = { message?: string; detail?: string | Array<{ msg?: string }> };

export function getErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const ax = err as AxiosError<ApiErrBody>;
    const data = ax.response?.data;
    if (data && typeof data === 'object') {
      if (typeof data.message === 'string') return data.message;
      const { detail } = data;
      if (typeof detail === 'string') return detail;
      if (Array.isArray(detail) && detail[0] && typeof detail[0] === 'object') {
        const m = (detail[0] as { msg?: string }).msg;
        if (typeof m === 'string') return m;
      }
    }
    return ax.message || 'Request failed';
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
