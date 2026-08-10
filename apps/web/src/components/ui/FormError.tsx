export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return <div role="alert" className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">{message}</div>;
}
