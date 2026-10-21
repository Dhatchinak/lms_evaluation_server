import { uniqueCourses } from '../shared/criteria.js';

export const DEMO_MODE = process.env.DEMO_MODE === 'true';

function safeFaculty(data) {
  if (!data || typeof data !== 'object' || typeof data.staff_id !== 'string') {
    throw new Error('The ERP response did not contain a valid faculty record.');
  }
  if (data.isActive === false) {
    const error = new Error('This faculty account is not active.');
    (error as Error & {status:number}).status = 403;
    throw error;
  }
  // IMPORTANT: whitelist only requested fields. Never forward ERP password, phone,
  // address, DOB, identifiers, personal email or raw class schedule to the browser.
  return {
    staffId: String(data.staff_id),
    name: `${data.salute ? `${data.salute} ` : ''}${data.name ?? ''}`.trim(),
    department: String(data.department_name ?? ''),
    designation: String(data.designation ?? ''),
    courses: uniqueCourses(data.class_attend),
  };
}

export async function fetchFaculty(staffId) {
  if (DEMO_MODE) throw Object.assign(new Error('Demo mode is disabled for this live ERP build.'), {status:503});
  const base = process.env.ERP_API_BASE || 'https://apierp.bhc.edu.in/api/staff';
  const response = await fetch(`${base.replace(/\/$/, '')}/${encodeURIComponent(staffId)}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Referer: process.env.ERP_REFERER || 'http://117.232.64.75',
    },
    signal: AbortSignal.timeout(12000),
    redirect: 'error',
  });
  if (response.status === 404) {
    const error = new Error('No faculty record was found for that staff ID.');
    (error as Error & {status:number}).status = 404;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(`The ERP service is temporarily unavailable (${response.status}).`);
    (error as Error & {status:number}).status = 502;
    throw error;
  }
  const raw: Record<string, unknown> = await response.json() as Record<string, unknown>;
  const embedded = (raw.data ?? {}) as Record<string, unknown>;
  const data = (embedded.staff ?? raw.data ?? raw.staff ?? raw) as Record<string, unknown>;
  if (String(data?.staff_id).toUpperCase() !== staffId.toUpperCase()) {
    const error = new Error('ERP returned a faculty ID that did not match the request.');
    (error as Error & {status:number}).status = 502;
    throw error;
  }
  return safeFaculty(data);
}
